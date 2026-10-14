import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { SaasDb } from "./db";
import * as authSchema from "./auth-schema";
import { hasClaimedInvitation } from "./invitations";
import { provisionPersonalTenant } from "./tenant";

export type AuthMail = { to: string; url: string; purpose: "verify-email" | "reset-password" };
export type SaasAuth = ReturnType<typeof createSaasAuth>;

export const AUTH_BASE_PATH = "/api/beta/auth";
export const VERIFIED_CALLBACK = "/beta/login?verified=1";

/**
 * The only library endpoints reachable over HTTP. Sign-up is deliberately absent:
 * accounts are created by the invitation route, which claims a token first.
 * Everything else (social sign-in, email change, account deletion, ...) is unreachable.
 */
const HTTP_ENDPOINTS: Record<string, RegExp> = {
  GET: /^\/(verify-email|reset-password\/[^/]+)$/,
  // get-session/list-sessions/revoke-session are excluded because they expose raw session
  // tokens to page JavaScript (defeating HttpOnly); pages read sessions server-side.
  POST: /^\/(sign-in\/email|sign-out|send-verification-email|request-password-reset|reset-password|change-password|update-user|revoke-other-sessions|revoke-sessions)$/,
};

export function createSaasAuth(options: {
  db: SaasDb;
  origin: string;
  secret: string;
  registration?: "closed" | "invite-only";
  /** Only a header the verified reverse proxy overwrites (never one a client can set). */
  trustedIpHeader?: string;
  sendMail: (mail: AuthMail) => Promise<void>;
}) {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || (origin.protocol !== "https:" && !(origin.protocol === "http:" && origin.hostname === "localhost"))) {
    throw new Error("Authentication requires an HTTPS origin (HTTP localhost allowed for tests).");
  }
  if (options.secret.trim().length < 32) throw new Error("A separate 32+ character authentication secret is required.");
  const auth = betterAuth({
    appName: "SEO Health Monitor",
    baseURL: options.origin,
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    database: drizzleAdapter(options.db, { provider: "pg", schema: authSchema, transaction: true }),
    trustedOrigins: [options.origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: options.registration !== "invite-only",
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => options.sendMail({ to: user.email, url, purpose: "reset-password" }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      // One fixed landing page for every verification link (sign-up, resend on sign-in,
      // explicit resend); a caller-supplied callbackURL is never used.
      sendVerificationEmail: async ({ user, url }) => {
        const link = new URL(url);
        link.searchParams.set("callbackURL", VERIFIED_CALLBACK);
        await options.sendMail({ to: user.email, url: link.toString(), purpose: "verify-email" });
      },
      // Create the personal tenant as soon as the address is proven. Failures (for example
      // a revoked invitation) are retried, and enforced, by requireTenant() on first use.
      afterEmailVerification: async (user) => {
        await provisionPersonalTenant(options.db, user).catch(() => undefined);
      },
    },
    session: {
      expiresIn: 7 * 24 * 3600,
      updateAge: 24 * 3600,
      freshAge: 15 * 60,
      cookieCache: { enabled: false },
    },
    account: { accountLinking: { enabled: false } },
    logger: { disabled: true },
    advanced: {
      cookiePrefix: "shm_beta",
      useSecureCookies: origin.protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // No untrusted forwarding headers until the staging proxy chain is verified.
      // Missing IPs share a conservative global limiter rather than bypassing it.
      ipAddress: { ipAddressHeaders: options.trustedIpHeader ? [options.trustedIpHeader] : [] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 3 },
        "/send-verification-email": { window: 3600, max: 3 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        // Server-side calls must come from the invitation route, which claims the token first.
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
        if (options.registration !== "invite-only" || !email || !(await hasClaimedInvitation(options.db, email))) {
          throw new APIError("FORBIDDEN", { message: "Registration is unavailable. Check your beta invitation." });
        }
      }),
    },
  });
  return {
    ...auth,
    handler: async (request: Request) => {
      // Canonical configured origin only; never trust forwarded host headers.
      // Also covers first-request login/signup CSRF before a cookie exists.
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") !== options.origin) {
        return Response.json({ error: "Cross-origin request blocked." }, { status: 403 });
      }
      const path = new URL(request.url).pathname.slice(AUTH_BASE_PATH.length);
      if (!HTTP_ENDPOINTS[request.method]?.test(path)) {
        return Response.json({ error: "Not found." }, { status: 404, headers: { "cache-control": "no-store" } });
      }
      const response = await auth.handler(request);
      response.headers.set("cache-control", "no-store");
      if (response.status === 429) response.headers.set("retry-after", response.headers.get("x-retry-after") ?? "60");
      return response;
    },
  };
}
