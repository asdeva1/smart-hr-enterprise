import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Self-hosted images (in-house and dedicated) build a standalone server; Vercel ignores this.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: new URL('../..', import.meta.url).pathname }
    : {}),
  poweredByHeader: false,
  // On Vercel the API lives on another site, and browsers would not send the lax session cookie to it. When
  // API_PROXY_TARGET is set, the browser talks to this site and Next forwards /v1 requests to the API.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');
    return target
      ? [
          { source: '/v1/:path*', destination: `${target}/v1/:path*` },
          { source: '/health/:path*', destination: `${target}/health/:path*` },
        ]
      : [];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
