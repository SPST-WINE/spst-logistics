/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/back-office-standalone.html',
        destination: '/back-office',  // o la tua rotta reale
        permanent: true,
      },
    ];
  },
};
module.exports = nextConfig;
