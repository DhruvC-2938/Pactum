import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import * as sdk from '../src/index';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('environment compatibility', () => {
  test('loads the SDK in the active test environment', () => {
    expect(sdk).toBeDefined();
  });

  test('publishes distinct import, require, and browser export targets', () => {
    expect(packageJson.exports['.'].import).toBe('./dist/index.mjs');
    expect(packageJson.exports['.'].require).toBe('./dist/index.cjs');
    expect(packageJson.exports['.'].browser.import).toBe('./dist/browser/index.mjs');
  });

  test('build emits CommonJS, Node ESM, and browser ESM bundles', () => {
    expect(existsSync(join(dist, 'index.cjs'))).toBe(true);
    expect(existsSync(join(dist, 'index.mjs'))).toBe(true);
    expect(existsSync(join(dist, 'browser', 'index.mjs'))).toBe(true);
  });

  test('browser bundle does not contain forbidden Node.js builtins', () => {
    const browserBundle = readFileSync(join(dist, 'browser', 'index.mjs'), 'utf8');

    expect(browserBundle).not.toMatch(/(?:node:)?fs/u);
    expect(browserBundle).not.toMatch(/(?:node:)?crypto/u);
  });
});
