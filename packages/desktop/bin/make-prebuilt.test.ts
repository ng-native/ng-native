import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { publishPrebuilt } from './prebuilt.mjs';

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
      // The archive's name would land in the query or the fragment.
      ['--manifest', MANIFEST, '--base-url', 'https://example.com/releases?token=abc'],
      ['--manifest', MANIFEST, '--base-url', 'https://example.com/releases#v1'],
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

  it('publishes through publishPrebuilt, so runs into the same folder never mix their files', () => {
    const source = readFileSync(path.join(scripts, 'make-prebuilt.mjs'), 'utf8');
    assert.match(source, /publishPrebuilt\(/);
    assert.doesNotMatch(source, /writeFileSync\(path\.join\(out, 'prebuilt-host\.json'\)/);
  });
});

describe('publishPrebuilt', () => {
  const host = { reactNative: '0.88.0', url: 'https://e.com/h.tar.gz', sha256: 'a', libraries: {} };

  /** An out folder holding a packed archive at a temp name, as make-prebuilt.mjs leaves it. */
  function packed() {
    const out = mkdtempSync(path.join(tmpdir(), 'ngn-publish-prebuilt-'));
    const archive = path.join(out, '.archive.partial');
    writeFileSync(archive, 'archive');
    return { out, archive };
  }

  it('moves the archive in and writes its entry and the manifest, and leaves nothing else', () => {
    const { out, archive } = packed();
    try {
      const manifest = path.join(out, 'prebuilt.json');
      writeFileSync(manifest, JSON.stringify({ version: 1, hosts: [] }));
      publishPrebuilt({ out, archive, name: 'h.tar.gz', host, manifest });
      assert.equal(readFileSync(path.join(out, 'h.tar.gz'), 'utf8'), 'archive');
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(out, 'prebuilt-host.json'), 'utf8')),
        host,
      );
      assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')).hosts, [host]);
      assert.deepEqual(readdirSync(out).sort(), [
        'h.tar.gz',
        'prebuilt-host.json',
        'prebuilt.json',
      ]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('waits while another run publishes into the same folder, then publishes its own pair', () => {
    const { out, archive } = packed();
    const lock = path.join(out, '.make-prebuilt.lock');
    try {
      mkdirSync(lock);
      // The other run lets go after a moment.
      const other = spawn(process.execPath, [
        '-e',
        `setTimeout(() => require('node:fs').rmSync(${JSON.stringify(lock)}, { recursive: true }), 300)`,
      ]);
      const started = Date.now();
      publishPrebuilt({ out, archive, name: 'h.tar.gz', host }, { wait: 10_000 });
      assert.ok(Date.now() - started >= 250, 'it waited for the lock');
      assert.ok(existsSync(path.join(out, 'h.tar.gz')));
      assert.ok(!existsSync(lock), 'its own lock is gone');
      other.kill();
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('stops, naming the lock, when another run holds it too long, and publishes nothing', () => {
    const { out, archive } = packed();
    try {
      mkdirSync(path.join(out, '.make-prebuilt.lock'));
      assert.throws(
        () => publishPrebuilt({ out, archive, name: 'h.tar.gz', host }, { wait: 100 }),
        /\.make-prebuilt\.lock/,
      );
      assert.ok(!existsSync(path.join(out, 'h.tar.gz')));
      assert.ok(!existsSync(path.join(out, 'prebuilt-host.json')));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
