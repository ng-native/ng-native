/**
 * Every app entry point imports `expo`, so a release build runs Expo's runtime as a debug build
 * does.
 *
 * `@expo/metro-config` lists `expo/src/winter` among the modules run before the app, but Metro
 * runs one only when it is already in the bundle. In debug, `mount()`'s reload hook reaches
 * `expo`; in release that code is folded away, so without an import of its own an app ran on
 * React Native's `fetch`, whose response has no `body`, and its own `URL` and the rest, while the
 * same app in debug had Expo's. Kept to the app's `main.ts` rather than `@ng-native/platform`,
 * where Expo is optional and which the test suite loads in Node.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ENTRY_POINTS = [
  'template/src/main.ts',
  'packages/nx/files/src/main.ts',
  'packages/schematics/files/src/main.ts',
  'examples/canary/src/main.ts',
  'examples/habits/src/main.ts',
  'examples/music/src/main.ts',
  'examples/notes/src/main.ts',
  'examples/runs/src/main.ts',
  'examples/wallet/src/main.ts',
];

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8');

describe("an app's entry point", () => {
  for (const file of ENTRY_POINTS) {
    it(`imports expo before it mounts, in ${file}`, () => {
      const source = read(file);
      const runtime = source.search(/^import 'expo';$/m);
      assert.notEqual(runtime, -1, `${file} does not import 'expo'`);
      assert.ok(runtime < source.indexOf('mount('), `${file} mounts before it imports 'expo'`);
    });
  }

  it('is written as the manual setup guide shows it', () => {
    const guide = read('apps/documentation/src/content/guide/manual-setup.md');
    const entry = guide.slice(guide.indexOf('// src/main.ts'));
    assert.match(entry.slice(0, entry.indexOf('```')), /^import 'expo';$/m);
  });
});
