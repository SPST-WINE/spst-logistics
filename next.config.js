// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      // API route Pages Router (senza estensione .js)
      'api/docs/unified/render': [
        './node_modules/@sparticuz/chromium/bin/*',
        './node_modules/@sparticuz/chromium/lib/*',
        './node_modules/@sparticuz/chromium/queries.json'
      ]
    }
  },
  async headers() {
    return [
      {
        source: '/back-office/:path*',
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
