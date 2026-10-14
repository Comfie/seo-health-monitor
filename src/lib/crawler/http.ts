import zlib from "node:zlib";
import { Readable } from "node:stream";
import { Agent, request } from "undici";
import { USER_AGENT } from "@/lib/config";
import { assertSafeUrl, safeLookup, SsrfError } from "./ssrf";

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  headers: Record<string, string>;
  body: Buffer;
  redirectChain: RedirectHop[];
  truncated: boolean;
  timeMs: number;
  error?: string;
  errorCode?: string;
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
}

const agent = new Agent({
  connect: { lookup: safeLookup, timeout: 10_000 },
  headersTimeout: 20_000,
  bodyTimeout: 20_000,
  keepAliveTimeout: 5_000,
  connections: 8,
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Destroys a stream without letting the resulting abort error crash the process. */
function discard(stream: Readable | NodeJS.ReadWriteStream): void {
  const s = stream as Readable;
  s.on("error", () => {});
  s.destroy();
}

function flattenHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function decoderFor(encoding: string | undefined): NodeJS.ReadWriteStream | null {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

/** Reads at most maxBytes of decompressed body; stops reading (and flags truncation) beyond that. */
async function readLimited(
  body: Readable,
  encoding: string | undefined,
  maxBytes: number,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const decoder = decoderFor(encoding);
  const stream: Readable = decoder ? (body.pipe(decoder) as unknown as Readable) : body;
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size + buf.length > maxBytes) {
        chunks.push(buf.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(buf);
      size += buf.length;
    }
  } finally {
    discard(body);
    if (decoder) discard(decoder);
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

function describeError(err: unknown): { message: string; code?: string } {
  if (err instanceof SsrfError) return { message: err.message, code: "SSRF_BLOCKED" };
  const e = err as { name?: string; code?: string; message?: string; cause?: unknown };
  if (e?.cause instanceof SsrfError) return { message: e.cause.message, code: "SSRF_BLOCKED" };
  if (e?.name === "TimeoutError" || e?.name === "AbortError" || /timeout/i.test(e?.code ?? "")) {
    return { message: "The request timed out.", code: "TIMEOUT" };
  }
  switch (e?.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return { message: "The domain name could not be resolved (DNS lookup failed).", code: e.code };
    case "ECONNREFUSED":
      return { message: "The server refused the connection.", code: e.code };
    case "ECONNRESET":
      return { message: "The connection was reset by the server.", code: e.code };
    case "CERT_HAS_EXPIRED":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return { message: `The site's TLS certificate is not valid (${e.code}).`, code: e.code };
  }
  return { message: e?.message ?? String(err), code: e?.code };
}

/**
 * HTTP client for crawling untrusted sites: SSRF-checked on every hop and every
 * DNS answer, redirects followed manually, response size and time capped.
 * Never throws; failures are reported in `error`.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
  const { method = "GET", timeoutMs = 15_000, maxBytes = 3_000_000, maxRedirects = 5 } = options;
  const started = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const redirectChain: RedirectHop[] = [];
  const seen = new Set<string>();
  let current = url;

  const result = (partial: Partial<FetchResult>): FetchResult => ({
    requestedUrl: url,
    finalUrl: current,
    status: null,
    headers: {},
    body: Buffer.alloc(0),
    redirectChain,
    truncated: false,
    timeMs: Math.round(performance.now() - started),
    ...partial,
  });

  try {
    for (let hop = 0; ; hop++) {
      assertSafeUrl(current);
      seen.add(current);
      const res = await request(current, {
        method,
        dispatcher: agent,
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: options.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en;q=0.9,*;q=0.5",
        },
      });
      const headers = flattenHeaders(res.headers);
      const location = headers["location"];

      if (REDIRECT_STATUSES.has(res.statusCode) && location) {
        discard(res.body);
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          return result({ status: res.statusCode, headers, error: `Invalid redirect location: ${location}`, errorCode: "BAD_REDIRECT" });
        }
        redirectChain.push({ url: current, status: res.statusCode, location: next });
        if (seen.has(next)) {
          return result({ status: res.statusCode, headers, error: "Redirect loop detected.", errorCode: "REDIRECT_LOOP" });
        }
        if (hop + 1 > maxRedirects) {
          return result({ status: res.statusCode, headers, error: `More than ${maxRedirects} redirects.`, errorCode: "TOO_MANY_REDIRECTS" });
        }
        current = next;
        continue;
      }

      if (method === "HEAD") {
        discard(res.body);
        return result({ status: res.statusCode, headers });
      }
      const { buffer, truncated } = await readLimited(res.body, headers["content-encoding"], maxBytes);
      return result({ status: res.statusCode, headers, body: buffer, truncated });
    }
  } catch (err) {
    const { message, code } = describeError(err);
    return result({ error: message, errorCode: code });
  }
}

export function decodeBody(res: FetchResult): string {
  const type = res.headers["content-type"] ?? "";
  const charset = /charset=([^;]+)/i.exec(type)?.[1]?.trim().toLowerCase();
  try {
    return new TextDecoder(charset && charset !== "utf8" ? charset : "utf-8").decode(res.body);
  } catch {
    return res.body.toString("utf8");
  }
}

export function isHtmlResponse(res: FetchResult): boolean {
  const type = (res.headers["content-type"] ?? "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml")) return true;
  if (!type) return /^\s*(<!doctype html|<html)/i.test(res.body.subarray(0, 512).toString("utf8"));
  return false;
}
