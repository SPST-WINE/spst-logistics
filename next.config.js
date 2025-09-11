/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/back-office/:path*', destination: '/api/back-office/:path*' },
      { source: '/assets/esm/:path*', destination: '/api/back-office/:path*' }, // ← cattura vecchi URL
      { source: '/quote/:slug', destination: '/api/quotes/view/:slug' },
    ];
  },
  async headers() {
    return [
      {
        source: '/assets/esm/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin',  value: 'https://www.spst.it' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: '*' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
      {
        source: '/back-office/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin',  value: 'https://www.spst.it' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: '*' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin',  value: 'https://www.spst.it' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, x-requested-with' },
          { key: 'Access-Control-Max-Age',       value: '86400' },
        ],
      },
    ];
  },
  reactStrictMode: true,
};
module.exports = nextConfig;
next.config.js
