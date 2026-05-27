/** @type {import('next').NextConfig} */

const securityHeaders = [
  // Prevent clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  // Prevent MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Stop referrer leaking to external sites
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Force HTTPS for 1 year, include subdomains
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Disable browser features that aren't needed
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Basic XSS protection for older browsers
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Content Security Policy — allows same-origin + Supabase + NextAuth
  //
  // # Status & history
  //
  // Two prior attempts at a strict nonce-based CSP failed:
  //   1. Direct enforcement (broke production — framework chunks blocked
  //      under 'strict-dynamic' because Next.js wasn't applying nonces).
  //   2. Report-only observation (deployed safely — but reports showed
  //      Next.js 16's `getScriptNonceFromHeader` doesn't extract our
  //      nonce, even with dynamic rendering forced and headers() read
  //      in the layout. Appears to be a Next.js 16 / Turbopack quirk).
  //
  // Current state: report-only nonce CSP runs alongside this enforced
  // policy (set in proxy.ts), so we keep visibility without enforcement.
  //
  // Hardening within current constraints: 'unsafe-eval' is REMOVED.
  // React production doesn't use eval/new Function. This closes the
  // most dangerous half of our previous "unsafe" surface — an XSS
  // attacker with a script injection now can't pivot to dynamic code
  // construction.
  //
  // 'unsafe-inline' is kept (Next.js framework still emits inline
  // scripts without nonces). This is the imperfect baseline we'll
  // live with until either:
  //   - Next.js 16 fixes nonce propagation, OR
  //   - We migrate off Turbopack to use experimental SRI, OR
  //   - We accept the dynamic rendering cost AND find a way to make
  //     the framework actually apply nonces.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // unsafe-inline kept for framework scripts; unsafe-eval REMOVED.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig = {
  // Build a self-contained "standalone" output that Docker can run with
  // just `node server.js` — no need to copy node_modules into the image.
  // This dramatically shrinks the production image (~150MB instead of
  // ~800MB) and is the recommended approach for containerized Next.js.
  //
  // Required because our Kamal deploy builds a Docker image from this
  // project. The Dockerfile copies .next/standalone and .next/static
  // into a minimal node:alpine final stage.
  output: "standalone",

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
