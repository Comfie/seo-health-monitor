import { hasAppSecret, hmac, safeEqual } from "./crypto";

/**
 * Single-owner authentication: one password from AUTH_PASSWORD, a signed
 * session cookie, and same-origin checks for state-changing requests.
 * Deliberately dependency-free and import-safe for the proxy (no "server-only").
 */

export const SESSION_COOKIE = "shm_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

export type AuthMode = "password" | "disabled" | "open-dev" | "misconfigured";

export function authMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  if (env.AUTH_DISABLED === "true") return "disabled";
  if (env.AUTH_PASSWORD && env.AUTH_PASSWORD.length >= 12 && hasAppSecret()) return "password";
  if (env.NODE_ENV !== "production" && !env.AUTH_PASSWORD) return "open-dev";
  return "misconfigured";
}

export function authProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  if (authMode(env) !== "misconfigured") return null;
  if (env.AUTH_PASSWORD && env.AUTH_PASSWORD.length < 12) return "AUTH_PASSWORD must be at least 12 characters.";
  if (env.AUTH_PASSWORD && !hasAppSecret()) return "APP_SECRET must be set (32+ random characters) to sign sessions.";
  return "Set AUTH_PASSWORD and APP_SECRET to run in production (or AUTH_DISABLED=true behind your own authenticating proxy).";
}

/** Changing AUTH_PASSWORD changes the fingerprint and so invalidates every session. */
function passwordFingerprint(): string {
  return hmac(process.env.AUTH_PASSWORD ?? "", "password-fingerprint").slice(0, 22);
}

export function verifyPassword(input: string): boolean {
  const expected = process.env.AUTH_PASSWORD;
  if (!expected || !input) return false;
  // Compare fixed-length MACs so timing doesn't leak length or content.
  return safeEqual(hmac(input, "password-check"), hmac(expected, "password-check"));
}

export function createSessionToken(now = Date.now()): string {
  const exp = now + SESSION_TTL_MS;
  return `${exp}.${hmac(`${exp}.${passwordFingerprint()}`, "session")}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  return safeEqual(sig, hmac(`${exp}.${passwordFingerprint()}`, "session"));
}

export function readCookie(headers: Headers, name: string): string | undefined {
  const raw = headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * CSRF guard for POST/PUT/PATCH/DELETE: browsers always send Origin on these,
 * so a present Origin must match this app. Requests without Origin (non-browser
 * clients) carry no ambient cookies and still need a valid session.
 */
export function isSameOrigin(request: Request, appUrl = process.env.APP_URL): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set<string>([new URL(request.url).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      /* ignore malformed APP_URL */
    }
  }
  return allowed.has(origin);
}

/** True when the request may access protected resources under the current auth mode. */
export function isAuthenticated(request: Request): boolean {
  const mode = authMode();
  if (mode === "disabled" || mode === "open-dev") return true;
  if (mode === "misconfigured") return false;
  return verifySessionToken(readCookie(request.headers, SESSION_COOKIE));
}

/**
 * Whether the browser reached us over HTTPS (directly or via a TLS-terminating proxy).
 * Secure cookies sent over plain HTTP are dropped by browsers, which would break sign-in.
 */
export function isHttpsRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  return new URL(request.url).protocol === "https:";
}
