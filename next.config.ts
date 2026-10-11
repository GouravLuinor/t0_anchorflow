import type { NextConfig } from "next";

// Production runs the standalone build (`node server.js` from .next/standalone)
// under PM2 as `anchor-norai` on port 3004, reverse-proxied to
// anchor.norai.tech — output:"standalone" keeps that PM2/Docker package
// self-contained (bundled deps, no repo-wide deploy).

// CSP is the privacy moat in transport form: the app is fully client-side, so
// every allowed origin here is one fewer egress path a payload could take.
// - api.github.com is Anchorflow's ONLY app-data egress: read-only,
//   unauthenticated GETs of public ref-resolution endpoints made by the
//   visitor's own browser (there is no server-side relay, so the origin must
//   be allow-listed for the browser to speak to it at all).
// - supabase hosts are whitelisted only because optional OAuth
//   (Google/GitHub) uses them; unset env keys → zero runtime connections.
// - googleusercontent / githubusercontent exist solely to render OAuth
//   provider avatars.
// - unsafe-inline styles are required by Next's runtime CSS and the
//   next-themes no-flash boot script; strict-dynamic script hashing is future
//   work once the inline boot script is eliminated.
// - worker-src covers the compute Web Worker pipeline (same-origin chunks;
//   blob: tolerates blob-URL workers in dev).
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js bootstraps with an inline script; HMR in dev additionally needs
  // eval. Production carries inline-only.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://avatars.githubusercontent.com https://*.githubusercontent.com",
  "font-src 'self' data:",
  // Anchorflow connect-src profile: api.github.com (browser-direct resolver)
  // + optional env-gated Supabase OAuth hosts.
  "connect-src 'self' https://api.github.com https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Don't advertise the framework; a client-only workstation gains nothing
  // from the X-Powered-By fingerprint.
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    // One security posture for everything, HTML and static assets alike.
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
