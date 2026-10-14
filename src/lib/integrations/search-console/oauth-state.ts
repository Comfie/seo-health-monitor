import { decrypt, encrypt, randomToken } from "@/lib/security/crypto";

export const OAUTH_COOKIE = "gsc_oauth";
const PURPOSE = "oauth-state";
const TTL_MS = 10 * 60_000;

interface OAuthState {
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

/** Creates the CSRF state + PKCE verifier, sealed into an encrypted cookie value. */
export function createOAuthState(returnTo: string): { state: string; verifier: string; cookie: string } {
  const value: OAuthState = { state: randomToken(24), verifier: randomToken(48), returnTo: safeReturnTo(returnTo), exp: Date.now() + TTL_MS };
  return { state: value.state, verifier: value.verifier, cookie: encrypt(JSON.stringify(value), PURPOSE) };
}

/** Validates the callback's state against the cookie. Returns null on any mismatch or expiry. */
export function readOAuthState(cookie: string | undefined, state: string | null): OAuthState | null {
  if (!cookie || !state) return null;
  const raw = decrypt(cookie, PURPOSE);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as OAuthState;
    if (value.state !== state || value.exp < Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

/** Only same-app relative paths, never protocol-relative or absolute URLs (open-redirect guard). */
export function safeReturnTo(path: string | null | undefined): string {
  return path && /^\/(?!\/)[\w\-/?=&.%]*$/.test(path) ? path : "/search-console";
}
