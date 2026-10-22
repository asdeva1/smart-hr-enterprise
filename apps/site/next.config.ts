import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://smart-hr-web.vercel.app').replace(/\/+$/, '');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The forms talk to this site, and Next forwards /v1 requests to the API, so the browser never needs the
  // API's address and no cookie crosses sites. The API must list this site's address in CORS_ORIGINS.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');
    return target ? [{ source: '/v1/:path*', destination: `${target}/v1/:path*` }] : [];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          ...securityHeaders,
          // Razorpay's payment window is the only third party this site loads.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://*.razorpay.com",
              "font-src 'self' data:",
              "connect-src 'self' https://*.razorpay.com https://lumberjack.razorpay.com",
              'frame-src https://api.razorpay.com https://checkout.razorpay.com',
              `form-action 'self' ${appUrl}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default config;
