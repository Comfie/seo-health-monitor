import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";

export class SsrfError extends Error {
  code = "SSRF_BLOCKED";
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".corp"];

/** Extra IPv4 ranges ipaddr.js reports as "unicast" but that are not publicly routable. */
const EXTRA_BLOCKED_V4: [string, number][] = [
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["240.0.0.0", 4],
];

/** True only for globally routable unicast addresses. */
export function isPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  if (addr.range() !== "unicast") return false;
  if (addr.kind() === "ipv4") {
    const v4 = addr as ipaddr.IPv4;
    return !EXTRA_BLOCKED_V4.some(([range, bits]) => v4.match(ipaddr.IPv4.parse(range), bits));
  }
  return true;
}

/**
 * Rejects URLs that could reach internal resources before any network activity.
 * DNS answers are checked separately at connect time by `safeLookup`.
 */
export function assertSafeUrl(input: string | URL): URL {
  const url = typeof input === "string" ? new URL(input) : input;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Blocked unsupported protocol ${url.protocol}`);
  }
  if (url.username || url.password) throw new SsrfError("Blocked URL containing credentials");
  if (!ALLOWED_PORTS.has(url.port)) throw new SsrfError(`Blocked non-standard port ${url.port}`);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfError(`Blocked internal hostname ${host}`);
  }
  if (net.isIP(host) && !isPublicIp(host)) {
    throw new SsrfError(`Blocked private or reserved IP address ${host}`);
  }
  return url;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * DNS lookup used for every outbound socket. Resolving and validating at connect
 * time closes the DNS-rebinding gap between "check" and "use".
 */
export function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((a) => !isPublicIp(a.address));
    if (list.length === 0 || blocked) {
      const error = new SsrfError(
        `Blocked ${hostname}: it resolves to a private or reserved address${blocked ? ` (${blocked.address})` : ""}`,
      ) as SsrfError & NodeJS.ErrnoException;
      return callback(error, []);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}
