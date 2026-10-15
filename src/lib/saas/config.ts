import { authMode } from "@/lib/security/auth";

export type EmailConfig =
  | { transport: "resend"; apiKey: string; from: string; allowlist: string[] }
  | { transport: "log"; allowlist: string[] };

/**
 * Customer Search Console. Optional: when it is not configured (or unsafe) only Search
 * Console is unavailable; the rest of the beta keeps working.
 */
export type GoogleConfig =
  | { state: "ready"; clientId: string; clientSecret: string; tokenSecret: string; redirectUri: string; maxInspections: number }
  | { state: "unavailable"; problem: string; redirectUri: string };

export type BetaConfig = {
  databaseUrl: string;
  origin: string;
  authSecret: string;
  registration: "closed" | "invite-only";
  invitationsEnabled: boolean;
  invitationTtlHours: number;
  trustedIpHeader?: string;
  email: EmailConfig;
  google: GoogleConfig;
};

export type BetaConfigState =
  | { state: "disabled" }
  | { state: "misconfigured"; problem: string }
  | { state: "ready"; config: BetaConfig };

const value = (env: NodeJS.ProcessEnv, name: string) => env[name]?.trim() || undefined;

/**
 * The customer beta is off unless PHASE2_ENABLED=true. It refuses to start in any
 * configuration where a customer could reach the global Phase 1 data: the legacy
 * owner area must stay behind its password (AUTH_DISABLED is never allowed).
 */
export function readBetaConfig(env: NodeJS.ProcessEnv = process.env): BetaConfigState {
  if (value(env, "PHASE2_ENABLED") !== "true") return { state: "disabled" };
  const fail = (problem: string) => ({ state: "misconfigured", problem }) as const;
  const production = env.NODE_ENV === "production";
  const legacy = authMode(env);
  if (legacy === "disabled") return fail("AUTH_DISABLED would expose global Phase 1 data to beta customers.");
  if (production && legacy !== "password") return fail("The legacy owner area must use AUTH_PASSWORD before the beta can run.");

  const databaseUrl = value(env, "PHASE2_DATABASE_URL");
  if (!databaseUrl) return fail("PHASE2_DATABASE_URL is required.");
  const scheme = databaseUrl.split(":")[0];
  if (scheme === "pglite" ? production : !["postgres", "postgresql"].includes(scheme)) return fail("PHASE2_DATABASE_URL must be a PostgreSQL URL (pglite: is local development only).");
  if ([env.DATABASE_URL, env.PRODUCTION_DATABASE_URL].includes(databaseUrl)) return fail("PHASE2_DATABASE_URL must not be a production database URL.");

  const origin = value(env, "PHASE2_ORIGIN");
  try {
    const parsed = new URL(origin ?? "");
    if (parsed.origin !== origin) throw new Error();
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && parsed.hostname === "localhost" && !production)) throw new Error();
  } catch {
    return fail("PHASE2_ORIGIN must be the canonical https:// origin (http://localhost in development).");
  }

  const authSecret = value(env, "PHASE2_AUTH_SECRET");
  if (!authSecret || authSecret.length < 32) return fail("PHASE2_AUTH_SECRET must be 32+ random characters.");
  if (authSecret === value(env, "APP_SECRET")) return fail("PHASE2_AUTH_SECRET must differ from APP_SECRET.");

  const registration = value(env, "PHASE2_REGISTRATION") ?? "closed";
  // Unrestricted public registration is deliberately not a supported value.
  if (registration !== "closed" && registration !== "invite-only") return fail("PHASE2_REGISTRATION must be closed or invite-only.");

  const allowlist = (value(env, "EMAIL_RECIPIENT_ALLOWLIST") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const transport = value(env, "EMAIL_TRANSPORT") ?? (production ? "resend" : "log");
  let email: EmailConfig;
  if (transport === "resend") {
    const apiKey = value(env, "RESEND_API_KEY");
    const from = value(env, "EMAIL_FROM");
    if (!apiKey || !from) return fail("RESEND_API_KEY and EMAIL_FROM are required for email delivery.");
    email = { transport, apiKey, from, allowlist };
  } else if (transport === "log" && !production) {
    email = { transport, allowlist };
  } else {
    return fail("EMAIL_TRANSPORT must be resend (log is development only).");
  }

  const google = readGoogleConfig(env, origin!, authSecret);
  const ttl = Number.parseInt(value(env, "PHASE2_INVITATION_TTL_HOURS") ?? "72", 10);
  return {
    state: "ready",
    config: {
      databaseUrl,
      origin: origin!,
      authSecret,
      registration,
      invitationsEnabled: value(env, "PHASE2_INVITATIONS_ENABLED") === "true",
      invitationTtlHours: Number.isFinite(ttl) ? Math.min(336, Math.max(1, ttl)) : 72,
      trustedIpHeader: value(env, "PHASE2_TRUSTED_IP_HEADER"),
      email,
      google,
    },
  };
}

/**
 * The beta uses its own Google OAuth client and its own token-encryption secret. Reusing
 * the Phase 1 client would mean editing a production integration (redirect URIs) and would
 * let a beta revocation end Phase 1's grant for the same Google user, so it is refused.
 */
export function readGoogleConfig(env: NodeJS.ProcessEnv, origin: string, authSecret: string): GoogleConfig {
  const redirectUri = `${origin}/api/beta/google/callback`;
  const clientId = value(env, "PHASE2_GOOGLE_CLIENT_ID");
  const clientSecret = value(env, "PHASE2_GOOGLE_CLIENT_SECRET");
  const tokenSecret = value(env, "PHASE2_GOOGLE_TOKEN_SECRET");
  const unavailable = (problem: string) => ({ state: "unavailable", problem, redirectUri }) as const;
  if (!clientId && !clientSecret && !tokenSecret) return unavailable("Search Console is not configured for the beta.");
  if (!clientId || !clientSecret || !tokenSecret) return unavailable("PHASE2_GOOGLE_CLIENT_ID, PHASE2_GOOGLE_CLIENT_SECRET and PHASE2_GOOGLE_TOKEN_SECRET are all required.");
  if (clientId === value(env, "GOOGLE_CLIENT_ID")) return unavailable("PHASE2_GOOGLE_CLIENT_ID must be a separate OAuth client from Phase 1's GOOGLE_CLIENT_ID.");
  if (tokenSecret.length < 32) return unavailable("PHASE2_GOOGLE_TOKEN_SECRET must be 32+ random characters.");
  if ([value(env, "APP_SECRET"), authSecret].includes(tokenSecret)) return unavailable("PHASE2_GOOGLE_TOKEN_SECRET must differ from APP_SECRET and PHASE2_AUTH_SECRET.");
  const inspections = Number.parseInt(value(env, "PHASE2_GSC_MAX_INSPECTIONS") ?? "10", 10);
  return { state: "ready", clientId, clientSecret, tokenSecret, redirectUri, maxInspections: Number.isFinite(inspections) ? Math.min(50, Math.max(0, inspections)) : 10 };
}
