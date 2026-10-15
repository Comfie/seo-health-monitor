import "server-only";
import { recordEvent } from "./telemetry";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, lt, ne } from "drizzle-orm";
import { runChecks } from "@/lib/audit/checks";
import { technicalChecks } from "@/lib/audit/checks/technical";
import { inlinksFrom } from "@/lib/audit/pipeline";
import { computeCounts, computeScores } from "@/lib/audit/scoring";
import type { AuditContext, CrawlResult, PageData, SearchConsoleContext } from "@/lib/audit/types";
import { collectSnapshot, googleFailureMessage, type CollectedSnapshot } from "@/lib/integrations/search-console/collect";
import {
  GoogleApiError, buildAuthUrl, exchangeCode, identityFromIdToken, listProperties, propertyMatchesSite, refreshAccessToken, revokeToken, type OAuthClient,
} from "@/lib/integrations/search-console/google";
import { decrypt, encrypt, pkceChallenge, randomToken, safeEqual } from "@/lib/security/crypto";
import type { ReportSearchConsole } from "@/lib/reports/search-summary";
import type { GoogleConfig } from "./config";
import type { SaasDb } from "./db";
import { completeRefresh, dropQueuedRefreshes, enqueueRefresh, failRefresh, latestRefresh, type RefreshLease } from "./gsc-jobs";
import { DEFAULT_TIMING, LeaseLostError, type QueueTiming } from "./jobs";
import { activity } from "./operations-schema";
import * as schema from "./schema";
import { AccessDeniedError, assertTenant, type TenantContext } from "./tenant";

/**
 * Tenant-scoped Google Search Console for the customer beta.
 *
 * - Every Google account, property link, snapshot and refresh job carries the tenant ID and
 *   composite foreign keys bind them to that tenant's websites.
 * - Customer entry points derive the tenant from the verified session (`TenantContext`);
 *   worker entry points take it from the claimed job row. Nothing reads it from a request.
 * - Refresh tokens are encrypted with the beta's own secret and a tenant-bound key, cached
 *   access tokens are keyed by tenant + account + credential version, and no view returns
 *   token material.
 */

export type GoogleReady = Extract<GoogleConfig, { state: "ready" }>;
type Tx = Parameters<Parameters<SaasDb["transaction"]>[0]>[0];
type Db = SaasDb | Tx;
type AccountRow = typeof schema.googleAccounts.$inferSelect;

export type SearchConsoleErrorCode = "not_configured" | "not_connected" | "reconnect" | "property_unavailable" | "property_unsuitable" | "not_linked" | "google_error";
export class SearchConsoleError extends Error {
  constructor(readonly code: SearchConsoleErrorCode, message: string) {
    super(message);
  }
}

export const REVOKED_MESSAGE = "Google access was revoked or expired. Reconnect Search Console.";
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const ALLOWED_SCOPES = new Set(["openid", "email", "https://www.googleapis.com/auth/userinfo.email", REQUIRED_SCOPE]);
const STATE_TTL_MS = 10 * 60_000;
/** Browser binding for a pending authorisation (HttpOnly, scoped to the Google routes). */
export const GSC_BROWSER_COOKIE = "shm_beta_gsc";
export const GSC_COOKIE_PATH = "/api/beta/google";
// The preserved Phase 1 callback and new connect route share /api, including after rewrites.
export const googleCookiePath = (google: GoogleConfig) => google.redirectUri.endsWith('/api/integrations/google/callback') ? '/api' : GSC_COOKIE_PATH;
export const SEARCH_PAGE = "/beta/search-console";

const tokenPurpose = (tenantId: string) => `beta-google-refresh-token:${tenantId}`;
const verifierPurpose = (stateHash: string) => `beta-google-oauth-verifier:${stateHash}`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");
const oauthClient = (g: GoogleReady): OAuthClient => ({ clientId: g.clientId, clientSecret: g.clientSecret, redirectUri: g.redirectUri });
const INDEX_CHECK = technicalChecks.filter((c) => c.id === "tech-index-status");

/** Only the beta Search Console page (optionally one numeric website) is a valid return target. */
export function safeSearchReturn(path: string | null | undefined) {
  return path && /^\/beta\/search-console(\?site=[1-9]\d{0,9})?$/.test(path) ? path : SEARCH_PAGE;
}

// ---------------------------------------------------------------------------------------------
// Access tokens: process memory only, keyed by tenant, account and credential version.

const cacheRef = globalThis as typeof globalThis & { __shmBetaGscTokens?: Map<string, { token: string; expiresAt: number }> };
const tokenCache = () => (cacheRef.__shmBetaGscTokens ??= new Map());
const cacheKey = (account: Pick<AccountRow, "tenantId" | "id" | "connectedAt" | "updatedAt">) => `${account.tenantId}:${account.id}:${(account.updatedAt ?? account.connectedAt).getTime()}`;
function forgetTenant(tenantId: string) {
  for (const key of tokenCache().keys()) if (key.startsWith(`${tenantId}:`)) tokenCache().delete(key);
}
function remember(key: string, token: string, expiresIn: number, now: number) {
  const cache = tokenCache();
  if (cache.size > 1000) for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  cache.set(key, { token, expiresAt: now + Math.max(0, expiresIn - 60) * 1000 });
}

/** Test seam: forget every cached access token. */
export function clearSearchConsoleTokenCache() {
  tokenCache().clear();
}

async function accountOf(db: Db, tenantId: string) {
  const [row] = await db.select().from(schema.googleAccounts).where(eq(schema.googleAccounts.tenantId, tenantId)).limit(1);
  return row ?? null;
}

async function linkOf(db: Db, tenantId: string, siteId: number) {
  const [row] = await db.select().from(schema.searchConsoleConnections)
    .where(and(eq(schema.searchConsoleConnections.tenantId, tenantId), eq(schema.searchConsoleConnections.siteId, siteId))).limit(1);
  return row ?? null;
}

/** Marks this exact credential revoked (a concurrent reconnect with a new token is left alone). */
async function markRevoked(db: Db, account: AccountRow) {
  const updated = await db.update(schema.googleAccounts).set({ status: "revoked", lastError: REVOKED_MESSAGE })
    .where(and(eq(schema.googleAccounts.tenantId, account.tenantId), eq(schema.googleAccounts.id, account.id), eq(schema.googleAccounts.encryptedRefreshToken, account.encryptedRefreshToken)))
    .returning({ id: schema.googleAccounts.id });
  if (updated.length) {
    await db.update(schema.searchConsoleConnections).set({ status: "revoked", lastError: REVOKED_MESSAGE })
      .where(and(eq(schema.searchConsoleConnections.tenantId, account.tenantId), eq(schema.searchConsoleConnections.googleAccountId, account.id)));
  }
  forgetTenant(account.tenantId);
}

/** A usable access token for this tenant's own Google account. */
export async function tenantAccessToken(db: SaasDb, google: GoogleReady, tenantId: string, now = Date.now()) {
  const account = await accountOf(db, tenantId);
  if (!account) throw new SearchConsoleError("not_connected", "Connect Google Search Console first.");
  if (account.status !== "active") throw new SearchConsoleError("reconnect", REVOKED_MESSAGE);
  const key = cacheKey(account);
  const cached = tokenCache().get(key);
  if (cached && cached.expiresAt > now) return { token: cached.token, account };
  const refresh = decrypt(account.encryptedRefreshToken, tokenPurpose(tenantId), google.tokenSecret);
  if (!refresh) {
    await markRevoked(db, account);
    throw new SearchConsoleError("reconnect", "The stored Google authorisation can't be used. Reconnect Search Console.");
  }
  try {
    const tokens = await refreshAccessToken(oauthClient(google), refresh);
    remember(key, tokens.access_token, tokens.expires_in, now);
    if (account.lastError) await db.update(schema.googleAccounts).set({ lastError: null }).where(and(eq(schema.googleAccounts.tenantId, tenantId), eq(schema.googleAccounts.id, account.id)));
    return { token: tokens.access_token, account };
  } catch (error) {
    await recordEvent(db, "google.refresh_failure", tenantId);
    if (error instanceof GoogleApiError && error.needsReconnect) {
      await markRevoked(db, account);
      throw new SearchConsoleError("reconnect", REVOKED_MESSAGE);
    }
    throw new SearchConsoleError("google_error", googleFailureMessage(error));
  }
}

/**
 * Revokes a grant at Google unless the same Google user is also connected to another account
 * of this app: Google revokes per user and client, so revoking here would silently end the
 * other account's access. The local credential is deleted either way by the caller.
 */
async function revokeUnlessShared(db: Db, google: GoogleReady, account: AccountRow) {
  // A legacy deployment or an imported grant may exist outside this database. Never revoke
  // at Google when the operator intentionally shares a client; local disconnect still erases it.
  if (google.sharedLegacyClient || !account.googleSubject) return false;
  if (account.googleSubject) {
    const [other] = await db.select({ id: schema.googleAccounts.id }).from(schema.googleAccounts)
      .where(and(eq(schema.googleAccounts.googleSubject, account.googleSubject), ne(schema.googleAccounts.tenantId, account.tenantId))).limit(1);
    if (other) return false;
  }
  const refresh = decrypt(account.encryptedRefreshToken, tokenPurpose(account.tenantId), google.tokenSecret);
  return refresh ? revokeToken(refresh).catch(() => false) : false;
}

// ---------------------------------------------------------------------------------------------
// Audit integration: index status for the tenant's own linked property only.

export type PagePriority = { url: string; depth: number; inlinks: number };
const byImportance = (a: PagePriority, b: PagePriority) => a.depth - b.depth || b.inlinks - a.inlinks || a.url.localeCompare(b.url);

export function crawlPriorities(crawl: Pick<CrawlResult, "pages" | "inlinks">): PagePriority[] {
  return crawl.pages.filter((p) => p.status === 200).map((p) => ({ url: p.finalUrl, depth: p.depth, inlinks: crawl.inlinks[p.finalUrl]?.length ?? 0 })).sort(byImportance);
}

async function latestCompletedAudit(db: Db, tenantId: string, siteId: number) {
  const [audit] = await db.select({ id: schema.audits.id }).from(schema.audits)
    .where(and(eq(schema.audits.tenantId, tenantId), eq(schema.audits.siteId, siteId), eq(schema.audits.status, "completed")))
    .orderBy(desc(schema.audits.completedAt), desc(schema.audits.id)).limit(1);
  return audit ?? null;
}

async function auditPriorities(db: Db, tenantId: string, auditId: number): Promise<PagePriority[]> {
  const rows = await db.select({ data: schema.pages.data }).from(schema.pages).where(and(eq(schema.pages.tenantId, tenantId), eq(schema.pages.auditId, auditId))).orderBy(asc(schema.pages.id));
  const pages = rows.map((r) => r.data as unknown as PageData);
  return crawlPriorities({ pages, inlinks: inlinksFrom(pages) });
}

/** Search Console context for one website from this tenant's stored data (no Google call). */
export async function storedContext(db: Db, google: GoogleConfig, tenantId: string, siteId: number, pages?: PagePriority[]): Promise<SearchConsoleContext> {
  if (google.state !== "ready") return { configured: false, linked: false };
  const account = await accountOf(db, tenantId);
  if (!account) return { configured: false, linked: false };
  const link = await linkOf(db, tenantId, siteId);
  if (!link) return { configured: true, linked: false };
  if (account.status !== "active") return { configured: true, linked: true, property: link.property, unverifiedReason: REVOKED_MESSAGE };
  const [snapshot] = await db.select().from(schema.searchSnapshots)
    .where(and(eq(schema.searchSnapshots.tenantId, tenantId), eq(schema.searchSnapshots.siteId, siteId), eq(schema.searchSnapshots.property, link.property), eq(schema.searchSnapshots.status, "ok")))
    .orderBy(desc(schema.searchSnapshots.fetchedAt), desc(schema.searchSnapshots.id)).limit(1);
  const wanted = pages ? new Set(pages.map((p) => p.url)) : null;
  const inspections = (snapshot?.inspections ?? []).filter((i) => !wanted || wanted.has(i.url));
  return { configured: true, linked: true, property: link.property, fetchedAt: snapshot?.fetchedAt, inspections, pages };
}

/**
 * Re-evaluates only the weight-0 "Google index coverage" check of a completed audit, so
 * linking, refreshing or disconnecting updates the audit without a re-crawl. Scores are
 * recomputed but cannot change (weight 0); the issue counts can.
 */
async function writeIndexCheck(db: Db, tenantId: string, auditId: number, ctx: SearchConsoleContext) {
  const [result] = runChecks({ searchConsole: ctx } as AuditContext, INDEX_CHECK);
  const own = <T extends typeof schema.checks | typeof schema.issues>(t: T) => and(eq(t.tenantId, tenantId), eq(t.auditId, auditId));
  await db.transaction(async (tx) => {
    const [audit] = await tx.select({ id: schema.audits.id }).from(schema.audits).where(and(eq(schema.audits.tenantId, tenantId), eq(schema.audits.id, auditId), eq(schema.audits.status, "completed"))).for("update");
    if (!audit) return;
    await tx.delete(schema.checks).where(and(own(schema.checks), eq(schema.checks.checkId, result.id)));
    await tx.delete(schema.issues).where(and(own(schema.issues), eq(schema.issues.checkId, result.id)));
    await tx.insert(schema.checks).values({
      tenantId, auditId, checkId: result.id, category: result.category, title: result.title, description: result.description, status: result.status, score: result.score,
      weight: result.weight, summary: result.summary, unavailableReason: result.unavailableReason ?? null, affectedCount: result.issues.length,
    });
    if (result.issues.length) {
      await tx.insert(schema.issues).values(result.issues.map((i) => ({
        tenantId, auditId, issueKey: i.key, checkId: i.checkId, category: i.category, severity: i.severity, title: i.title, url: i.url, evidence: i.evidence,
        why: i.why, fix: i.fix, implementation: i.implementation, benefit: i.benefit, impact: i.impact, confidence: i.confidence, effort: i.effort, priorityScore: i.priorityScore,
      }))).onConflictDoNothing();
    }
    const allChecks = await tx.select().from(schema.checks).where(own(schema.checks));
    const allIssues = await tx.select().from(schema.issues).where(own(schema.issues));
    const scores = computeScores(allChecks);
    await tx.update(schema.audits).set({ overallScore: scores.overall, categoryScores: scores.categories, counts: { ...computeCounts(allChecks, allIssues) } })
      .where(and(eq(schema.audits.tenantId, tenantId), eq(schema.audits.id, auditId)));
  });
}

export async function applyIndexCheckToLatestAudit(db: Db, google: GoogleConfig, tenantId: string, siteId: number) {
  const audit = await latestCompletedAudit(db, tenantId, siteId);
  if (!audit) return null;
  const pages = await auditPriorities(db, tenantId, audit.id);
  await writeIndexCheck(db, tenantId, audit.id, await storedContext(db, google, tenantId, siteId, pages));
  return audit.id;
}

const snapshotRow = (tenantId: string, siteId: number, property: string, auditId: number | null, data: CollectedSnapshot, now: Date) => ({
  tenantId, siteId, auditId, property, status: "ok" as const, startDate: data.startDate, endDate: data.endDate, ...data.totals, previous: data.previous,
  daily: data.daily, topQueries: data.topQueries, topPages: data.topPages, inspections: data.inspections, fetchedAt: now,
});
const errorRow = (tenantId: string, siteId: number, property: string, auditId: number | null, message: string, now: Date) => ({
  tenantId, siteId, auditId, property, status: "error" as const, error: message, startDate: now.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10), fetchedAt: now,
});

export type AuditSearchConsole = { context: SearchConsoleContext; snapshot: ReturnType<typeof snapshotRow> | ReturnType<typeof errorRow> | null };

/**
 * Worker side of an audit: fetches fresh Search Console data with the audit tenant's own
 * credential (tenant from the job lease). Never throws; Google problems make the index check
 * "not verified" with the reason, and are stored as an error snapshot.
 */
export async function collectForAudit(db: SaasDb, google: GoogleConfig | undefined, lease: { tenantId: string; auditId: number }, siteId: number, crawl: Pick<CrawlResult, "pages" | "inlinks">, now = new Date()): Promise<AuditSearchConsole> {
  if (!google || google.state !== "ready") return { context: { configured: false, linked: false }, snapshot: null };
  const pages = crawlPriorities(crawl);
  const base = await storedContext(db, google, lease.tenantId, siteId, pages);
  if (!base.linked || base.unverifiedReason || !base.property) return { context: base, snapshot: null };
  const property = base.property;
  try {
    const { token } = await tenantAccessToken(db, google, lease.tenantId, now.getTime());
    const data = await collectSnapshot(token, property, { pageUrls: pages.map((p) => p.url), maxInspections: google.maxInspections, today: now });
    return {
      context: { configured: true, linked: true, property, fetchedAt: now, inspections: data.inspections, pages },
      snapshot: snapshotRow(lease.tenantId, siteId, property, lease.auditId, data, now),
    };
  } catch (error) {
    if (error instanceof GoogleApiError && error.needsReconnect) {
      const account = await accountOf(db, lease.tenantId);
      if (account) await markRevoked(db, account);
    }
    const message = error instanceof SearchConsoleError ? error.message : googleFailureMessage(error);
    return { context: { ...base, unverifiedReason: message }, snapshot: errorRow(lease.tenantId, siteId, property, lease.auditId, message, now) };
  }
}

/** Inserts the audit's snapshot inside the audit's fenced completion transaction. */
export async function storeAuditSnapshot(tx: Tx, snapshot: AuditSearchConsole["snapshot"]) {
  if (snapshot) await tx.insert(schema.searchSnapshots).values(snapshot);
}

// ---------------------------------------------------------------------------------------------
// Background refresh job (tenant and website from the job row).

export type RefreshOutcome = "completed" | "retry" | "failed" | "stale";

export async function runRefreshJob(deps: { db: SaasDb; google?: GoogleConfig; timing?: QueueTiming; now?: () => Date }, lease: RefreshLease): Promise<RefreshOutcome> {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const timing = deps.timing ?? DEFAULT_TIMING;
  try {
    const google = deps.google;
    if (!google || google.state !== "ready") throw new SearchConsoleError("not_configured", "Search Console is not available for the beta.");
    const link = await linkOf(db, lease.tenantId, lease.siteId);
    if (!link) {
      // Unlinked after it was queued: nothing to fetch.
      await completeRefresh(db, lease, async () => {}, now());
      return "completed";
    }
    const { token } = await tenantAccessToken(db, google, lease.tenantId, now().getTime());
    const audit = await latestCompletedAudit(db, lease.tenantId, lease.siteId);
    const pages = audit ? await auditPriorities(db, lease.tenantId, audit.id) : [];
    const data = await collectSnapshot(token, link.property, { pageUrls: pages.map((p) => p.url), maxInspections: google.maxInspections, today: now() });
    const at = now();
    await completeRefresh(db, lease, async (tx) => {
      const [current] = await tx.select().from(schema.searchConsoleConnections)
        .where(and(eq(schema.searchConsoleConnections.tenantId, lease.tenantId), eq(schema.searchConsoleConnections.siteId, lease.siteId))).for("update");
      // Unlinked or switched to another property meanwhile: discard this data.
      if (!current || current.property !== link.property || current.googleAccountId !== link.googleAccountId) return;
      await tx.insert(schema.searchSnapshots).values(snapshotRow(lease.tenantId, lease.siteId, link.property, null, data, at));
      await tx.update(schema.searchConsoleConnections).set({ lastRefreshedAt: at, lastError: null, status: "connected" }).where(eq(schema.searchConsoleConnections.id, current.id));
      if (audit) await writeIndexCheck(tx, lease.tenantId, audit.id, await storedContext(tx, google, lease.tenantId, lease.siteId, pages));
      await tx.insert(activity).values({ id: randomUUID(), tenantId: lease.tenantId, actorId: null, action: "search_console.refreshed", metadata: { websiteId: lease.siteId } });
    }, at);
    return "completed";
  } catch (error) {
    if (error instanceof LeaseLostError) return "stale";
    if (error instanceof GoogleApiError && error.needsReconnect) {
      const account = await accountOf(db, lease.tenantId).catch(() => null);
      if (account) await markRevoked(db, account).catch(() => {});
    }
    const reconnect = (error instanceof SearchConsoleError && ["reconnect", "not_connected", "not_configured"].includes(error.code)) || (error instanceof GoogleApiError && error.needsReconnect);
    const message = error instanceof SearchConsoleError ? error.message : googleFailureMessage(error);
    // Job and error class only: provider errors and URLs can contain customer data.
    console.error(`[beta-worker] search console job ${lease.jobId} attempt ${lease.attempts} failed: ${(error as Error)?.name ?? "Error"}`);
    try {
      return await failRefresh(db, lease, { message, retryable: !reconnect }, timing, now(), async (tx) => {
        await tx.update(schema.searchConsoleConnections).set({ lastError: message })
          .where(and(eq(schema.searchConsoleConnections.tenantId, lease.tenantId), eq(schema.searchConsoleConnections.siteId, lease.siteId)));
      });
    } catch {
      return "stale";
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Customer entry points (session-derived tenant).

export type CallbackOutcome = "connected" | "state_invalid" | "session_mismatch" | "denied" | "no_code" | "no_refresh_token" | "scope_missing" | "scope_too_broad" | "identity_missing" | "failed";

const propertyType = (property: string) => (property.startsWith("sc-domain:") ? "domain" : "url-prefix") as "domain" | "url-prefix";
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function customerSearchConsole(db: SaasDb, context: TenantContext, google: GoogleConfig) {
  const tenantId = context.tenantId;
  const ready = () => {
    if (google.state !== "ready") throw new SearchConsoleError("not_configured", "Google Search Console is not available for the beta yet.");
    return google;
  };
  async function ownedSite(siteId: number) {
    await assertTenant(db, context);
    if (!Number.isSafeInteger(siteId) || siteId <= 0) throw new AccessDeniedError();
    const [site] = await db.select().from(schema.sites).where(and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.id, siteId))).limit(1);
    if (!site) throw new AccessDeniedError();
    return site;
  }
  const log = (dbOrTx: Db, action: string, metadata: Record<string, string | number | boolean> = {}) =>
    dbOrTx.insert(activity).values({ id: randomUUID(), tenantId, actorId: context.userId, action, metadata });

  async function properties() {
    const g = ready();
    await assertTenant(db, context);
    const { token } = await tenantAccessToken(db, g, tenantId);
    try {
      return (await listProperties(token)).map((p) => ({ property: p.siteUrl, permissionLevel: p.permissionLevel, type: propertyType(p.siteUrl) }));
    } catch (error) {
      if (error instanceof GoogleApiError && error.needsReconnect) {
        const account = await accountOf(db, tenantId);
        if (account) await markRevoked(db, account);
        throw new SearchConsoleError("reconnect", REVOKED_MESSAGE);
      }
      throw new SearchConsoleError("google_error", googleFailureMessage(error));
    }
  }

  return {
    properties,

    /** Connection state for the customer: never token material or Google's raw responses. */
    async status() {
      await assertTenant(db, context);
      const account = await accountOf(db, tenantId);
      const links = await db.select({ link: schema.searchConsoleConnections, host: schema.sites.host }).from(schema.searchConsoleConnections)
        .innerJoin(schema.sites, and(eq(schema.sites.tenantId, schema.searchConsoleConnections.tenantId), eq(schema.sites.id, schema.searchConsoleConnections.siteId)))
        .where(eq(schema.searchConsoleConnections.tenantId, tenantId)).orderBy(asc(schema.sites.host));
      return {
        configured: google.state === "ready",
        account: account ? { email: account.email, status: account.status, connectedAt: account.connectedAt.toISOString(), lastError: account.lastError } : null,
        links: await Promise.all(links.map(async ({ link, host }) => {
          const job = await latestRefresh(db, tenantId, link.siteId);
          return {
            websiteId: link.siteId, host, property: link.property, propertyType: propertyType(link.property), permissionLevel: link.permissionLevel,
            status: link.status, lastRefreshedAt: iso(link.lastRefreshedAt), lastError: link.lastError, refresh: job ? job.state : null,
          };
        })),
      };
    },

    /** Starts OAuth: state + PKCE verifier stored server-side, bound to tenant, user, session and browser. */
    async startAuthorisation(input: { sessionId: string; returnTo?: string | null }, now = new Date()) {
      const g = ready();
      await assertTenant(db, context);
      const state = randomToken(32);
      const verifier = randomToken(48);
      const browserNonce = randomToken(32);
      const stateHash = sha256(state);
      await db.delete(schema.googleOauthStates).where(and(eq(schema.googleOauthStates.tenantId, tenantId), lt(schema.googleOauthStates.expiresAt, now)));
      await db.insert(schema.googleOauthStates).values({
        stateHash, tenantId, userId: context.userId, sessionId: input.sessionId, browserHash: sha256(browserNonce),
        encryptedVerifier: encrypt(verifier, verifierPurpose(stateHash), g.tokenSecret), returnTo: safeSearchReturn(input.returnTo),
        expiresAt: new Date(now.getTime() + STATE_TTL_MS), createdAt: now,
      });
      return { url: buildAuthUrl(oauthClient(g), state, pkceChallenge(verifier), { includeGrantedScopes: false }), browserNonce };
    },

    /**
     * OAuth callback. The state is consumed before any other check, so it works at most once
     * whatever the outcome. It must belong to this tenant, user, session and browser; a link
     * started by someone else (or in another session) is refused and nothing is stored.
     */
    async completeAuthorisation(input: { state: string | null; code: string | null; error: string | null; sessionId: string; browserNonce: string | undefined }, now = new Date()): Promise<{ outcome: CallbackOutcome; returnTo: string }> {
      const g = ready();
      await assertTenant(db, context);
      if (!input.state || input.state.length > 200) return { outcome: "state_invalid", returnTo: SEARCH_PAGE };
      const stateHash = sha256(input.state);
      const [row] = await db.update(schema.googleOauthStates).set({ consumedAt: now })
        .where(and(eq(schema.googleOauthStates.stateHash, stateHash), isNull(schema.googleOauthStates.consumedAt))).returning();
      if (!row || row.expiresAt <= now) return { outcome: "state_invalid", returnTo: SEARCH_PAGE };
      const bound = row.tenantId === tenantId && row.userId === context.userId && row.sessionId === input.sessionId
        && !!input.browserNonce && safeEqual(row.browserHash, sha256(input.browserNonce));
      if (!bound) {
        await log(db, "google.callback_rejected");
        return { outcome: "session_mismatch", returnTo: SEARCH_PAGE };
      }
      const returnTo = row.returnTo;
      if (input.error) return { outcome: input.error === "access_denied" ? "denied" : "failed", returnTo };
      if (!input.code || input.code.length > 2048) return { outcome: "no_code", returnTo };
      const verifier = decrypt(row.encryptedVerifier, verifierPurpose(stateHash), g.tokenSecret);
      if (!verifier) return { outcome: "failed", returnTo };

      let tokens;
      try {
        tokens = await exchangeCode(oauthClient(g), input.code, verifier);
      } catch {
        return { outcome: "failed", returnTo };
      }
      // Tokens that fail these checks are discarded, never revoked: revoking would also end the
      // same Google user's grant for any other account of this app.
      const granted = tokens.scope.split(/\s+/).filter(Boolean);
      if (!granted.includes(REQUIRED_SCOPE)) return { outcome: "scope_missing", returnTo };
      if (granted.some((s) => !ALLOWED_SCOPES.has(s))) return { outcome: "scope_too_broad", returnTo };
      if (!tokens.refresh_token) return { outcome: "no_refresh_token", returnTo };
      const identity = identityFromIdToken(tokens.id_token);
      if (!identity) return { outcome: "identity_missing", returnTo };

      const sealed = encrypt(tokens.refresh_token, tokenPurpose(tenantId), g.tokenSecret);
      const result = await db.transaction(async (tx) => {
        const [tenant] = await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(and(eq(schema.tenants.id, tenantId), eq(schema.tenants.status, "active"))).for("update");
        if (!tenant) throw new AccessDeniedError();
        const existing = await accountOf(tx, tenantId);
        const values = { userId: context.userId, email: identity.email, encryptedRefreshToken: sealed, scopes: granted.join(" "), status: "active" as const, lastError: null, googleSubject: identity.subject, updatedAt: now };
        if (existing && existing.googleSubject === identity.subject) {
          await tx.update(schema.googleAccounts).set(values).where(and(eq(schema.googleAccounts.tenantId, tenantId), eq(schema.googleAccounts.id, existing.id)));
          await tx.update(schema.searchConsoleConnections).set({ status: "connected", lastError: null })
            .where(and(eq(schema.searchConsoleConnections.tenantId, tenantId), eq(schema.searchConsoleConnections.googleAccountId, existing.id)));
          await log(tx, "google.connected", { replacedAccount: false });
          return { accountId: existing.id, previous: null, unlinkedSites: [] as number[] };
        }
        // A different Google account replaces the old one; its property links go with it,
        // because the new account has not been shown to have access to those properties.
        const unlinkedSites = existing
          ? (await tx.select({ siteId: schema.searchConsoleConnections.siteId }).from(schema.searchConsoleConnections)
            .where(and(eq(schema.searchConsoleConnections.tenantId, tenantId), eq(schema.searchConsoleConnections.googleAccountId, existing.id)))).map((r) => r.siteId)
          : [];
        if (existing) {
          await dropQueuedRefreshes(tx, tenantId);
          await tx.delete(schema.googleAccounts).where(and(eq(schema.googleAccounts.tenantId, tenantId), eq(schema.googleAccounts.id, existing.id)));
        }
        const [created] = await tx.insert(schema.googleAccounts).values({ tenantId, ...values, connectedAt: now }).returning({ id: schema.googleAccounts.id });
        await log(tx, "google.connected", { replacedAccount: !!existing });
        return { accountId: created.id, previous: existing, unlinkedSites };
      });
      forgetTenant(tenantId);
      remember(`${tenantId}:${result.accountId}:${now.getTime()}`, tokens.access_token, tokens.expires_in, Date.now());
      if (result.previous) await revokeUnlessShared(db, g, result.previous);
      for (const siteId of result.unlinkedSites) await applyIndexCheckToLatestAudit(db, g, tenantId, siteId);
      return { outcome: "connected", returnTo };
    },

    /**
     * Links one of this tenant's websites to a property. The property must be in the list Google
     * returns for this tenant's own authorisation right now, and must cover the website's host.
     */
    async link(siteId: number, property: unknown, now = new Date()) {
      const site = await ownedSite(siteId);
      const g = ready();
      if (typeof property !== "string" || property.length < 3 || property.length > 300) throw new SearchConsoleError("property_unavailable", "Choose a Search Console property from your connected Google account.");
      const match = (await properties()).find((p) => p.property === property);
      if (!match || match.permissionLevel === "siteUnverifiedUser") throw new SearchConsoleError("property_unavailable", "That property isn't available to your connected Google account.");
      if (!propertyMatchesSite(property, site.host)) {
        throw new SearchConsoleError("property_unsuitable", `That property doesn't cover ${site.host}. Choose a domain property for ${site.host} or a URL-prefix property on the same host.`);
      }
      await db.transaction(async (tx) => {
        const [tenant] = await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(and(eq(schema.tenants.id, tenantId), eq(schema.tenants.status, "active"))).for("update");
        if (!tenant) throw new AccessDeniedError();
        const [stillOwned] = await tx.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.id, site.id)));
        if (!stillOwned) throw new AccessDeniedError();
        const account = await accountOf(tx, tenantId);
        if (!account || account.status !== "active") throw new SearchConsoleError("reconnect", REVOKED_MESSAGE);
        const existing = await linkOf(tx, tenantId, site.id);
        const changed = !existing || existing.property !== property || existing.googleAccountId !== account.id;
        await tx.insert(schema.searchConsoleConnections).values({
          tenantId, siteId: site.id, googleAccountId: account.id, property, status: "connected", scopes: account.scopes, connectedAt: now, permissionLevel: match.permissionLevel,
        }).onConflictDoUpdate({
          target: [schema.searchConsoleConnections.tenantId, schema.searchConsoleConnections.siteId],
          set: { googleAccountId: account.id, property, status: "connected", scopes: account.scopes, permissionLevel: match.permissionLevel, lastError: null, ...(changed ? { connectedAt: now, lastRefreshedAt: null } : {}) },
        });
        await log(tx, "search_console.linked", { websiteId: site.id, propertyType: propertyType(property) });
        await enqueueRefresh(tx, { tenantId, siteId: site.id, requestedBy: context.userId, now });
      });
      await applyIndexCheckToLatestAudit(db, g, tenantId, site.id);
      return { websiteId: site.id, property, propertyType: propertyType(property), refresh: "queued" as const };
    },

    async unlink(siteId: number) {
      const site = await ownedSite(siteId);
      const removed = await db.transaction(async (tx) => {
        const rows = await tx.delete(schema.searchConsoleConnections)
          .where(and(eq(schema.searchConsoleConnections.tenantId, tenantId), eq(schema.searchConsoleConnections.siteId, site.id))).returning({ id: schema.searchConsoleConnections.id });
        await dropQueuedRefreshes(tx, tenantId, site.id);
        if (rows.length) await log(tx, "search_console.unlinked", { websiteId: site.id });
        return rows.length > 0;
      });
      await applyIndexCheckToLatestAudit(db, google, tenantId, site.id);
      return { unlinked: removed };
    },

    /** Deletes this tenant's Google credential and links, and revokes the grant where that is safe. */
    async disconnect() {
      await assertTenant(db, context);
      const account = await accountOf(db, tenantId);
      if (!account) return { disconnected: false, revokedAtGoogle: false };
      const linked = (await db.select({ siteId: schema.searchConsoleConnections.siteId }).from(schema.searchConsoleConnections)
        .where(eq(schema.searchConsoleConnections.tenantId, tenantId))).map((r) => r.siteId);
      const revokedAtGoogle = google.state === "ready" ? await revokeUnlessShared(db, google, account) : false;
      await db.transaction(async (tx) => {
        await dropQueuedRefreshes(tx, tenantId);
        await tx.delete(schema.googleAccounts).where(and(eq(schema.googleAccounts.tenantId, tenantId), eq(schema.googleAccounts.id, account.id)));
        await tx.delete(schema.googleOauthStates).where(eq(schema.googleOauthStates.tenantId, tenantId));
        await log(tx, "google.disconnected", { revokedAtGoogle });
      });
      forgetTenant(tenantId);
      for (const siteId of linked) await applyIndexCheckToLatestAudit(db, google, tenantId, siteId);
      return { disconnected: true, revokedAtGoogle };
    },

    /** Queues a background refresh for one linked website. */
    async requestRefresh(siteId: number, now = new Date()) {
      const site = await ownedSite(siteId);
      ready();
      const link = await linkOf(db, tenantId, site.id);
      if (!link) throw new SearchConsoleError("not_linked", "Link this website to a Search Console property first.");
      const account = await accountOf(db, tenantId);
      if (!account || account.status !== "active") throw new SearchConsoleError("reconnect", REVOKED_MESSAGE);
      const result = await enqueueRefresh(db, { tenantId, siteId: site.id, requestedBy: context.userId, now });
      if (result === "queued") await log(db, "search_console.refresh_requested", { websiteId: site.id });
      return { refresh: result };
    },

    /** Stored Search Console data for one website, for its currently linked property only. */
    async overview(siteId: number) {
      const site = await ownedSite(siteId);
      const link = await linkOf(db, tenantId, site.id);
      const job = await latestRefresh(db, tenantId, site.id);
      const websiteView = { id: site.id, host: site.host, url: site.displayUrl };
      if (!link) return { website: websiteView, link: null, latest: null, lastAttempt: null, history: [], refresh: job?.state ?? null };
      const rows = await db.select().from(schema.searchSnapshots)
        .where(and(eq(schema.searchSnapshots.tenantId, tenantId), eq(schema.searchSnapshots.siteId, site.id), eq(schema.searchSnapshots.property, link.property)))
        .orderBy(desc(schema.searchSnapshots.fetchedAt), desc(schema.searchSnapshots.id)).limit(60);
      const view = (s: (typeof rows)[number]) => ({
        id: s.id, auditId: s.auditId, property: s.property, status: s.status, error: s.error, startDate: s.startDate, endDate: s.endDate,
        clicks: s.clicks, impressions: s.impressions, ctr: s.ctr, position: s.position, previous: s.previous, daily: s.daily ?? [],
        topQueries: s.topQueries ?? [], topPages: s.topPages ?? [], inspections: s.inspections ?? [], fetchedAt: s.fetchedAt.toISOString(),
      });
      const latest = rows.find((s) => s.status === "ok");
      return {
        website: websiteView,
        link: { property: link.property, propertyType: propertyType(link.property), permissionLevel: link.permissionLevel, status: link.status, lastRefreshedAt: iso(link.lastRefreshedAt), lastError: link.lastError },
        latest: latest ? view(latest) : null,
        lastAttempt: rows[0] ? { status: rows[0].status, error: rows[0].error, fetchedAt: rows[0].fetchedAt.toISOString() } : null,
        history: rows.filter((s) => s.status === "ok").reverse().map((s) => ({ fetchedAt: s.fetchedAt.toISOString(), auditId: s.auditId, clicks: s.clicks ?? 0, impressions: s.impressions ?? 0, ctr: s.ctr ?? 0, position: s.position ?? 0 })),
        refresh: job?.state ?? null,
      };
    },
  };
}

/** Owner-authorised Search Console summary attached to an audit's reports (or a clear "not verified"). */
export async function auditSearchSummary(db: SaasDb, google: GoogleConfig, context: TenantContext, siteId: number): Promise<ReportSearchConsole> {
  await assertTenant(db, context);
  const ctx = await storedContext(db, google, context.tenantId, siteId);
  if (!ctx.configured || !ctx.linked) return { verified: false, note: "Search Console is not connected for this website, so Google traffic and index status are not verified." };
  if (ctx.unverifiedReason) return { verified: false, note: ctx.unverifiedReason };
  const [snapshot] = await db.select().from(schema.searchSnapshots)
    .where(and(eq(schema.searchSnapshots.tenantId, context.tenantId), eq(schema.searchSnapshots.siteId, siteId), eq(schema.searchSnapshots.property, ctx.property!), eq(schema.searchSnapshots.status, "ok")))
    .orderBy(desc(schema.searchSnapshots.fetchedAt), desc(schema.searchSnapshots.id)).limit(1);
  if (!snapshot) return { verified: false, note: "Search Console is linked, but no data has been fetched yet." };
  return {
    verified: true,
    source: "Google Search Console (owner-authorised)",
    property: snapshot.property,
    period: { start: snapshot.startDate, end: snapshot.endDate },
    fetchedAt: snapshot.fetchedAt.toISOString(),
    clicks: snapshot.clicks ?? 0, impressions: snapshot.impressions ?? 0, ctr: snapshot.ctr ?? 0, position: snapshot.impressions ? (snapshot.position ?? null) : null,
    previous: snapshot.previous ?? null,
    topQueries: (snapshot.topQueries ?? []).slice(0, 10),
    topPages: (snapshot.topPages ?? []).slice(0, 10),
    indexing: {
      inspected: (snapshot.inspections ?? []).filter((i) => !i.error).length,
      notIndexed: (snapshot.inspections ?? []).filter((i) => !i.error && i.verdict !== "PASS").map((i) => ({ url: i.url, coverage: i.coverageState ?? i.verdict })),
    },
  };
}
