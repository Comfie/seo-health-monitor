import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy. Next.js injects inline bootstrap scripts, so
 * 'unsafe-inline' is required for scripts without a nonce setup; everything
 * else is locked to this origin. Dev adds 'unsafe-eval' for React Refresh.
 */
const directives = (formAction: string) => [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action ${formAction}`,
  "object-src 'none'",
].join("; ");
const csp = directives("'self'");
// The beta Search Console page posts a form to /api/beta/google/connect, which redirects to
// Google's consent screen. Browsers apply form-action to that redirect, and send "Origin: null"
// on form posts under no-referrer (failing the canonical-Origin check). This page's URL holds no
// tokens, so it uses same-origin (nothing is sent cross-origin, including to Google).
const googleConnectCsp = directives("'self' https://accounts.google.com");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "pdfkit", "pg"],
  // Migrations are read from disk at runtime; include them in the standalone trace.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Invitation and reset tokens appear in beta URLs; never leak them via Referer.
      { source: "/beta/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/beta/search-console", headers: [{ key: "Content-Security-Policy", value: googleConnectCsp }, { key: "Referrer-Policy", value: "same-origin" }] },
      { source: "/search-console", headers: [{ key: "Content-Security-Policy", value: googleConnectCsp }, { key: "Referrer-Policy", value: "same-origin" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
