/**
 * Which `@expo/metro-config` the Metro transformer wraps: the app's `expo`'s own. A package
 * manager can put another version beside `@ng-native/metro`, as pnpm does when it resolves the
 * optional peer to the newest release, and that copy belongs to a different SDK than the app.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';

const require = createRequire(import.meta.url);

/** A file with its directories. */
function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A fresh copy of the transformer, loaded with `cwd` as the working directory, as Metro's are. */
function loadFrom(cwd: string): { getCacheKey(): string } {
  const id = require.resolve('@ng-native/metro/transformer.cjs');
  const cached = require.cache[id];
  const previous = process.cwd();
  try {
    process.chdir(cwd);
    delete require.cache[id];
    return require(id) as { getCacheKey(): string };
  } finally {
    process.chdir(previous);
    if (cached) require.cache[id] = cached;
    else delete require.cache[id];
  }
}

it("wraps the transformer the app's expo has, over the one beside @ng-native/metro", () => {
  const app = mkdtempSync(path.join(realpathSync(tmpdir()), 'metro-upstream-'));
  const expo = path.join(app, 'node_modules', 'expo');
  write(path.join(expo, 'package.json'), JSON.stringify({ name: 'expo', version: '57.0.0' }));
  const config = path.join(expo, 'node_modules', '@expo', 'metro-config');
  write(
    path.join(config, 'package.json'),
    JSON.stringify({ name: '@expo/metro-config', version: '57.0.0' }),
  );
  write(
    path.join(config, 'build', 'babel-transformer.js'),
    "module.exports = { getCacheKey: () => 'the-app-expo:', transform: () => ({}) };",
  );

  try {
    assert.match(loadFrom(app).getCacheKey(), /^the-app-expo:/);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

it('wraps the one it can reach itself when no expo is found from the working directory', () => {
  const elsewhere = mkdtempSync(path.join(realpathSync(tmpdir()), 'metro-upstream-'));
  try {
    assert.equal(typeof loadFrom(elsewhere).getCacheKey(), 'string');
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

it('reports an expo it cannot read, rather than wrapping another SDK', () => {
  const app = mkdtempSync(path.join(realpathSync(tmpdir()), 'metro-upstream-'));
  write(path.join(app, 'node_modules', 'expo', 'package.json'), '{ not json');
  try {
    assert.throws(() => loadFrom(app), /package\.json|JSON/);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
