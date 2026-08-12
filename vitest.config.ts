import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Alias the workspace packages to their TypeScript source so tests run without
// a prior build step. Keep this list in sync with packages/*.
export default defineConfig({
  resolve: {
    alias: {
      '@cem/shared': r('./packages/shared/src/index.ts'),
      '@cem/core': r('./packages/core/src/index.ts'),
      '@cem/crypto': r('./packages/crypto/src/index.ts'),
      '@cem/scanner': r('./packages/scanner/src/index.ts'),
      '@cem/markdown': r('./packages/markdown/src/index.ts'),
      '@cem/mcp': r('./packages/mcp/src/index.ts'),
      '@cem/profiles': r('./packages/profiles/src/index.ts'),
      '@cem/diagnostics': r('./packages/diagnostics/src/index.ts'),
      '@cem/backup': r('./packages/backup/src/index.ts'),
      '@cem/restore': r('./packages/restore/src/index.ts'),
      '@cem/sync': r('./packages/sync/src/index.ts'),
      '@cem/usage': r('./packages/usage/src/index.ts'),
      '@cem/server-inventory': r('./packages/server-inventory/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/release/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/index.ts', '**/*.test.ts', '**/types.ts', '**/*.d.ts'],
    },
  },
});
