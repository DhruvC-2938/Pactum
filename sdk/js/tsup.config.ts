import { defineConfig, type Options } from 'tsup';

const browserBundleGuard = `node -e "const { readFileSync, readdirSync } = require('node:fs'); const { join } = require('node:path'); const forbidden = ['fs', 'crypto']; const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const path = join(dir, entry.name); return entry.isDirectory() ? walk(path) : path; }); for (const file of walk(join(process.cwd(), 'dist', 'browser')).filter((file) => /\\.(?:mjs|js)$/.test(file))) { const bundle = readFileSync(file, 'utf8'); for (const builtin of forbidden) { const patterns = [new RegExp('(?:node:)?' + builtin, 'u'), new RegExp('require\\\\([\\'\\"](?:node:)?' + builtin + '[\\'\\"]\\\\)', 'u'), new RegExp('from [\\'\\"](?:node:)?' + builtin + '[\\'\\"]', 'u')]; if (patterns.some((pattern) => pattern.test(bundle))) throw new Error('Browser bundle ' + file + ' contains forbidden Node.js builtin: ' + builtin); } }"`;

const shared: Options = {
  entry: ['src/index.ts'],
  clean: false,
  dts: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    platform: 'node',
    target: 'node20',
    format: ['cjs', 'esm'],
    outDir: 'dist',
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.mjs' };
    },
  },
  {
    ...shared,
    platform: 'browser',
    target: ['es2020'],
    format: ['esm'],
    outDir: 'dist/browser',
    onSuccess: browserBundleGuard,
    outExtension() {
      return { js: '.mjs' };
    },
  },
]);
