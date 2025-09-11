// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/back-office/:path*', // o '/api/back-office/:path*' se usi API routes
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'https://www.spst.it' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
