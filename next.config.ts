import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Official card art is served from the Pokemon TCG API's image CDN.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
    ],
  },
  experimental: {
    serverActions: {
      // Card photos are uploaded at up to ~4000px; the 1MB default is far too small.
      bodySizeLimit: '12mb',
    },
  },
};

export default nextConfig;
