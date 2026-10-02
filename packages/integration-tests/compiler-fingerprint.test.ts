/**
 * Telling Metro that our compiler changed.
 *
 * Metro caches a transform result against the file's content and its own version, and knows
 * nothing about the transformer it called. So editing this project's compiler and restarting the
 * dev server is not enough: every file whose own text has not changed keeps the output it was
 * given by the old compiler, and only the files you also happen to edit pick the change up. The
 * failure is a half-applied compiler, which is worse to read than one that did not apply at all.
 *
 * A fingerprint of the compiler's own sources goes into `cacheVersion`, which is the documented
 * lever for exactly this, and changes the cache key for everything the moment the compiler moves.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, type FSWatcher } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { compilerFingerprint, watchCompiler } = require('@ng-native/metro/config.cjs') as {
  compilerFingerprint(dir: string): string;
  watchCompiler(dir: string, fingerprint: string): FSWatcher;
};

/** A throwaway directory that looks like the compiler's own. */
function sandbox(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'fingerprint-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

describe('the compiler fingerprint', () => {
  it('is the same for the same sources', () => {
    const a = sandbox({ 'transform.cjs': 'one', 'css/compile.cjs': 'two' });
    const b = sandbox({ 'transform.cjs': 'one', 'css/compile.cjs': 'two' });
    assert.equal(compilerFingerprint(a), compilerFingerprint(b));
    rmSync(a, { recursive: true });
    rmSync(b, { recursive: true });
  });

  it('changes when a source changes, which is the whole point', () => {
    const dir = sandbox({ 'transform.cjs': 'one' });
    const before = compilerFingerprint(dir);
    writeFileSync(path.join(dir, 'transform.cjs'), 'one, but different');
    assert.notEqual(compilerFingerprint(dir), before);
    rmSync(dir, { recursive: true });
  });

  it('changes when a source is added, since a new rule is a new compiler', () => {
    const dir = sandbox({ 'transform.cjs': 'one' });
    const before = compilerFingerprint(dir);
    writeFileSync(path.join(dir, 'extra.cjs'), 'more');
    assert.notEqual(compilerFingerprint(dir), before);
    rmSync(dir, { recursive: true });
  });

  it('changes when a source is renamed, since a require names the file', () => {
    const a = sandbox({ 'one.cjs': 'same' });
    const b = sandbox({ 'two.cjs': 'same' });
    assert.notEqual(compilerFingerprint(a), compilerFingerprint(b));
    rmSync(a, { recursive: true });
    rmSync(b, { recursive: true });
  });

  it('reaches into subdirectories, where the CSS compiler lives', () => {
    const dir = sandbox({ 'transform.cjs': 'one', 'css/compile.cjs': 'two' });
    const before = compilerFingerprint(dir);
    writeFileSync(path.join(dir, 'css', 'compile.cjs'), 'two, but different');
    assert.notEqual(compilerFingerprint(dir), before);
    rmSync(dir, { recursive: true });
  });

  it('ignores what cannot change the output', () => {
    // A README beside the compiler is not the compiler. Hashing everything would invalidate every
    // app's cache on a typo fix, and a cache that clears too eagerly gets turned off.
    const dir = sandbox({ 'transform.cjs': 'one' });
    const before = compilerFingerprint(dir);
    writeFileSync(path.join(dir, 'README.md'), 'notes');
    assert.equal(compilerFingerprint(dir), before);
    rmSync(dir, { recursive: true });
  });

  it('answers for the real compiler, which is what a config asks it', () => {
    const real = compilerFingerprint(path.dirname(require.resolve('@ng-native/metro/config.cjs')));
    assert.match(real, /^[0-9a-f]{16}$/);
  });
});

/**
 * The cache key covers a server started after an edit. One already running loaded the compiler
 * once, so an edit while it is up reaches nothing until a restart, and the watcher says so.
 */
describe('the compiler watcher', () => {
  /** Polls until `done` holds, since a file system event arrives a little after the write. */
  async function until(done: () => boolean, ms = 5000) {
    for (const start = Date.now(); !done() && Date.now() - start < ms;) await delay(20);
  }

  it('warns once when a source changes while the server is up, and not for a README', async (t) => {
    const dir = sandbox({ 'transform.cjs': 'one', 'css/compile.cjs': 'two' });
    const warn = t.mock.method(console, 'warn', () => {});
    const watcher = watchCompiler(dir, compilerFingerprint(dir));
    try {
      writeFileSync(path.join(dir, 'README.md'), 'notes');
      await delay(300);
      assert.equal(warn.mock.callCount(), 0, 'a README is not the compiler');

      writeFileSync(path.join(dir, 'css', 'compile.cjs'), 'two, but different');
      await until(() => warn.mock.callCount() > 0);
      assert.equal(warn.mock.callCount(), 1);
      assert.match(
        String(warn.mock.calls[0]!.arguments[0]),
        /compiler changed on disk.*restarted/s,
      );

      writeFileSync(path.join(dir, 'transform.cjs'), 'one, but different');
      await delay(300);
      assert.equal(warn.mock.callCount(), 1, 'said once, not on every save after');
    } finally {
      watcher.close();
      rmSync(dir, { recursive: true });
    }
  });

  it('says nothing when a source is saved unchanged', async (t) => {
    const dir = sandbox({ 'transform.cjs': 'one' });
    const warn = t.mock.method(console, 'warn', () => {});
    const watcher = watchCompiler(dir, compilerFingerprint(dir));
    try {
      writeFileSync(path.join(dir, 'transform.cjs'), 'one');
      await delay(300);
      assert.equal(warn.mock.callCount(), 0);
    } finally {
      watcher.close();
      rmSync(dir, { recursive: true });
    }
  });
});
