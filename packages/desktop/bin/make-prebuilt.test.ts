import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../native/scripts/', import.meta.url));
const MANIFEST = '<manifest>';

/**
 * Runs make-prebuilt.mjs on an empty app, so it stops before anything is built, with any manifest
 * (`MANIFEST`) in the app's temp folder.
 */
function makePrebuilt(args: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ngn-make-prebuilt-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(scripts, 'make-prebuilt.mjs'),
        dir,
        path.join(dir, 'out'),
        ...args.map((arg) => (arg === MANIFEST ? path.join(dir, 'prebuilt.json') : arg)),
      ],
      // No NODE_PATH (pnpm sets one for scripts), so react-native is never found and nothing builds.
      { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' }, timeout: 30_000 },
    );
    return { ...result, wroteOut: existsSync(path.join(dir, 'out')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('make-prebuilt.mjs', () => {
  it('needs an absolute https or http --base-url to write a manifest entry, before it builds', () => {
    for (const args of [
      ['--manifest', MANIFEST],
      ['--manifest', MANIFEST, '--base-url', ''],
      ['--manifest', MANIFEST, '--base-url', '/releases/download/v1'],
      ['--manifest', MANIFEST, '--base-url', 'file:///tmp/hosts'],
      ['--base-url', 'releases/v1'],
    ]) {
      const result = makePrebuilt(args);
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
      assert.match(result.stderr, /--base-url/, args.join(' '));
      assert.ok(!result.wroteOut, 'nothing built or written');
    }
  });

  it('gets past the URL check with an absolute --base-url', () => {
    const result = makePrebuilt([
      '--manifest',
      MANIFEST,
      '--base-url',
      'https://github.com/ng-native/ng-native/releases/download/v1',
    ]);
    // Stopped by the empty app instead.
    assert.match(result.stderr, /react-native is not installed/);
  });

  it('builds in a directory of its own and archives that build, not the shared cache', () => {
    const source = readFileSync(path.join(scripts, 'make-prebuilt.mjs'), 'utf8');
    assert.match(source, /'--build-dir',\s*buildRoot/);
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    assert.match(build, /--build-dir\) build_dir="\$2"; shift ;;/);
    assert.match(build, /BUILD="\$\{build_dir:-\$host_dir\/\$backend-/);
  });
});
