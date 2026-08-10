import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Official card art is served from the Pokemon TCG API's image CDN.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
    ],
  },
  /**
   * Keep native and worker-spawning packages out of the bundle.
   *
   * tesseract.js resolves its worker script by path at runtime. Once bundled,
   * that path is rewritten and the worker fails to load — the production server
   * threw `Cannot find module '/ROOT/node_modules/tesseract.js/src/worker-script/
   * node/index.js'` and every scan hung until the request timed out. sharp and
   * better-sqlite3 are native addons and cannot be bundled either.
   */
  serverExternalPackages: ['tesseract.js', 'sharp', 'better-sqlite3'],

  // Note: `experimental.serverActions.bodySizeLimit` was removed as dead config.
  // It bounds Server Actions only, and this app has none — photo uploads go
  // through the POST /api/scan route handler, which the setting never applied to.
};

export default nextConfig;
