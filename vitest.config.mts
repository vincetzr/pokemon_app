import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      // `server-only` throws on import outside a React Server Component, which
      // would fail any test that touches a server module. Next resolves it via
      // the "react-server" export condition to a no-op; do the same here.
      'server-only': resolve(root, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
