import crypto from "node:crypto";

export class MissingSecretError extends Error {}

/** Minimum length for APP_SECRET; `openssl rand -base64 32` produces 44 characters. */
export const MIN_SECRET_LENGTH = 32;

function secret(): string {
  const value = process.env.APP_SECRET?.trim();
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new MissingSecretError(`APP_SECRET must be set to a random string of at least ${MIN_SECRET_LENGTH} characters (e.g. \`openssl rand -base64 32\`).`);
  }
  return value;
}

export function hasAppSecret(): boolean {
  const value = process.env.APP_SECRET?.trim();
  return !!value && value.length >= MIN_SECRET_LENGTH;
}

/**
 * Derives independent keys per purpose so one key is never reused for two jobs.
 * `root` overrides APP_SECRET for components with their own secret (the customer beta).
 */
function deriveKey(purpose: string, root?: string): Buffer {
  if (root !== undefined && root.length < MIN_SECRET_LENGTH) throw new MissingSecretError(`Encryption secrets must be at least ${MIN_SECRET_LENGTH} characters.`);
  return Buffer.from(crypto.hkdfSync("sha256", root ?? secret(), "seo-health-monitor", purpose, 32));
}

/** AES-256-GCM; output is base64url(iv | tag | ciphertext). */
export function encrypt(plaintext: string, purpose = "encryption", root?: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(purpose, root), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Returns null for tampered, truncated or foreign ciphertext instead of throwing. */
export function decrypt(token: string, purpose = "encryption", root?: string): string | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(purpose, root), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof MissingSecretError) throw err;
    return null;
  }
}

export function hmac(value: string, purpose: string): string {
  return crypto.createHmac("sha256", deriveKey(purpose)).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** PKCE S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
