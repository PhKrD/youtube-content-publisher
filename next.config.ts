import type { NextConfig } from "next";
import path from "node:path";

/**
 * Security headers (Section 51).
 *
 * Notes on specific choices:
 *  - `frame-ancestors 'none'` + X-Frame-Options: this app has no legitimate
 *    embedding use case, and clickjacking a "Publish to YouTube" button would
 *    be irreversible.
 *  - `'unsafe-inline'` is present for styles only. Next.js injects inline
 *    style attributes during hydration; script-src has no such allowance.
 *  - `img-src` permits Google's CDNs because user avatars, channel art and
 *    playlist thumbnails are served from them.
 *  - Permissions-Policy denies camera/microphone/geolocation outright: the app
 *    never needs them, and denying them limits the blast radius of an XSS.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com https://i.ytimg.com https://yt3.ggpht.com",
  "media-src 'self' blob: data:",
  // Browser uploads go straight to Google's resumable endpoints, so those
  // origins must be permitted here or every upload is blocked by CSP.
  "connect-src 'self' https://www.googleapis.com https://*.googleapis.com https://accounts.google.com",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // HSTS is only meaningful over HTTPS; harmless on localhost since browsers
  // ignore it for http origins.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack walks up and finds an
  // unrelated lockfile in the home directory and warns about it.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },

  // Fail the build on type errors rather than shipping them. (Next 16 removed
  // the `eslint` key along with `next lint`; linting runs as its own step in
  // `npm run lint` and in CI.)
  typescript: { ignoreBuildErrors: false },

  poweredByHeader: false,

  // `pg` and the Prisma client are native/server-only; keep them out of any
  // client or edge bundle.
  serverExternalPackages: ["@prisma/client", "pg", "googleapis", "google-auth-library"],

  // Enable compression for better performance
  compress: true,

  // Optimize images automatically
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.ggpht.com',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: 'yt3.ggpht.com',
      },
    ],
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
