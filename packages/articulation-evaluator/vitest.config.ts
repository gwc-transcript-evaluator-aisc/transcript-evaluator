import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Vitest/Vite doesn't know what to do with a bare `.md` import by default -- only
 * esbuild's Lambda bundling step (configured via `loader: { '.md': 'text' }` in
 * lib/articulation-evaluator-stack.ts) does. This mirrors that behavior for tests so
 * `import standards from './context/cal-getc-standards.md'` resolves to the raw text. */
function rawMarkdown(): Plugin {
  return {
    name: 'raw-markdown',
    transform(code, id) {
      if (!id.endsWith('.md')) return undefined;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [rawMarkdown()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // config.ts reads these at module import time (before any test's beforeEach runs),
    // so defaults belong here rather than being set from within test bodies.
    env: {
      CATALOG_TABLE_NAME: 'CatalogTableTest',
      EVALUATIONS_TABLE_NAME: 'EvaluationsTableTest',
    },
  },
});
