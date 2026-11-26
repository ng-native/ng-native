import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
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

  it('takes debug or release for --flavour, before it builds', () => {
    for (const flavour of ['', 'Debug', 'dev', 'profile']) {
      const result = makePrebuilt(['--flavour', flavour]);
      assert.equal(result.status, 2, `${flavour}: ${result.stderr}`);
      assert.match(result.stderr, /--flavour takes debug or release/);
      assert.ok(!result.wroteOut, 'nothing built or written');
    }
    for (const flavour of ['debug', 'release']) {
      // Stopped by the empty app instead.
      assert.match(makePrebuilt(['--flavour', flavour]).stderr, /react-native is not installed/);
    }
  });

  it('takes an exact version for --react-native, before it builds', () => {
    // It names a cache folder and goes to npm as it is.
    for (const version of ['', 'latest', '0.88', '^0.88.1', '0.88.1/..']) {
      const result = makePrebuilt(['--react-native', version]);
      assert.equal(result.status, 2, `${version}: ${result.stderr}`);
      assert.match(result.stderr, /--react-native takes a version such as 0\.88\.1/);
      assert.ok(!result.wroteOut, 'nothing built or written');
    }
    assert.match(
      makePrebuilt(['--react-native', '0.88.1']).stderr,
      /react-native is not installed/,
    );
    // Installed into the folder for these exact versions, which no build of other versions shares.
    const source = readFileSync(path.join(scripts, 'make-prebuilt.mjs'), 'utf8');
    assert.match(source, /const dir = hostAppDir\([^;]*\[reactNative\]\), dependencies\);/);
  });

  it('builds the release host as a packaged app ships it and the debug host as a dev run builds it', () => {
    const source = readFileSync(path.join(scripts, 'make-prebuilt.mjs'), 'utf8');
    assert.match(source, /flavour: \{ type: 'string', default: 'release' \}/);
    assert.match(source, /flavour === 'release' \? '--release' : '--no-tests'/);
    // Stripped before packing, so the debug host is built without debug info.
    assert.match(source, /flavour === 'release' \? \[\] : \['--no-debug-info'\]/);
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    assert.match(build, /--no-debug-info\) debug_info=0/);
    // Set with debug info too, so a build after one without it in the same directory gets it back.
    assert.match(
      build,
      /flags="-O2 -g -DNDEBUG"\n\s*\[ "\$debug_info" = 0 \] && flags="-O2 -DNDEBUG"/,
    );
    assert.match(build, /-DCMAKE_\$\{lang\}_FLAGS_RELWITHDEBINFO=\$flags/);
    assert.match(build, /\$\{flags_args\[@\]\+"\$\{flags_args\[@\]\}"\}/);
    assert.match(source, /prebuiltName\(desktopVersion, reactNative, flavour, platform\)/);
    assert.match(source, /const host = \{\s*reactNative,\s*flavour,/);
  });

  it('gets past the URL check with an absolute --base-url', () => {
    const result = makePrebuilt([
      '--manifest',
      MANIFEST,
      '--base-url',
      'https://github.com/coralogix/ng-native/releases/download/v1',
    ]);
    // Stopped by the empty app instead.
    assert.match(result.stderr, /react-native is not installed/);
  });

  it('builds in a directory of its own and archives that build, not the shared cache', () => {
    const source = readFileSync(path.join(scripts, 'make-prebuilt.mjs'), 'utf8');
    assert.match(source, /'--build-dir',\s*buildRoot/);
    const build = readFileSync(path.join(scripts, 'build.sh'), 'utf8');
    assert.match(build, /--build-dir\) build_dir="\$2"; shift ;;/);
    assert.match(build, /BUILD="\$\{build_dir:-\$host_dir\/\$variant-/);
  });

  it('publishes through publishPrebuilt, so runs into the same folder never mix their files', () => {
    const source = readFileSync(path.join(scripts, 'make-prebuilt.mjs'), 'utf8');
    assert.match(source, /publishPrebuilt\(/);
    assert.doesNotMatch(source, /writeFileSync\(path\.join\(out, 'prebuilt-host/);
  });
});

describe('publishPrebuilt', () => {
  const host = {
    reactNative: '0.88.0',
    flavour: 'release' as const,
    url: 'https://e.com/h.tar.gz',
    sha256: 'a',
    libraries: {},
  };

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
        JSON.parse(readFileSync(path.join(out, 'prebuilt-host-rn-0.88.0-release.json'), 'utf8')),
        host,
      );
      assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')).hosts, [host]);
      assert.deepEqual(readdirSync(out).sort(), [
        'h.tar.gz',
        'prebuilt-host-rn-0.88.0-release.json',
        'prebuilt.json',
      ]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('publishes both flavours into one folder and manifest, each with its own entry', () => {
    const { out, archive } = packed();
    try {
      const manifest = path.join(out, 'prebuilt.json');
      writeFileSync(manifest, JSON.stringify({ version: 1, hosts: [] }));
      const debug = {
        ...host,
        flavour: 'debug' as const,
        url: 'https://e.com/d.tar.gz',
        sha256: 'd',
      };
      publishPrebuilt({ out, archive, name: 'h.tar.gz', host, manifest });
      const second = path.join(out, '.debug.partial');
      writeFileSync(second, 'debug build');
      publishPrebuilt({ out, archive: second, name: 'd.tar.gz', host: debug, manifest });
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(out, 'prebuilt-host-rn-0.88.0-release.json'), 'utf8')),
        host,
      );
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(out, 'prebuilt-host-rn-0.88.0-debug.json'), 'utf8')),
        debug,
      );
      assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')).hosts, [host, debug]);
      assert.deepEqual(readdirSync(out).sort(), [
        'd.tar.gz',
        'h.tar.gz',
        'prebuilt-host-rn-0.88.0-debug.json',
        'prebuilt-host-rn-0.88.0-release.json',
        'prebuilt.json',
      ]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('publishes a Linux host beside the macOS one of the same flavour, each with its own entry', () => {
    const { out, archive } = packed();
    try {
      const linux = { ...host, os: 'linux' as const, arch: 'arm64' as const, sha256: 'l' };
      publishPrebuilt({ out, archive, name: 'h.tar.gz', host });
      const second = path.join(out, '.linux.partial');
      writeFileSync(second, 'linux build');
      publishPrebuilt({ out, archive: second, name: 'l.tar.gz', host: linux });
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(out, 'prebuilt-host-rn-0.88.0-release.json'), 'utf8')),
        host,
      );
      assert.deepEqual(
        JSON.parse(
          readFileSync(path.join(out, 'prebuilt-host-rn-0.88.0-linux-arm64-release.json'), 'utf8'),
        ),
        linux,
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('publishes a host for another React Native version beside this one, each with its own entry', () => {
    const { out, archive } = packed();
    try {
      const manifest = path.join(out, 'prebuilt.json');
      writeFileSync(manifest, JSON.stringify({ version: 1, hosts: [] }));
      const next = { ...host, reactNative: '0.88.1', sha256: 'n' };
      publishPrebuilt({ out, archive, name: 'h.tar.gz', host, manifest });
      const second = path.join(out, '.next.partial');
      writeFileSync(second, 'next build');
      publishPrebuilt({ out, archive: second, name: 'n.tar.gz', host: next, manifest });
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(out, 'prebuilt-host-rn-0.88.1-release.json'), 'utf8')),
        next,
      );
      // Neither replaces the other in the manifest.
      assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')).hosts, [host, next]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('takes macos or linux for --os, builds a Linux host only on Linux, with the cache flags too', () => {
    const windows = makePrebuilt(['--os', 'windows']);
    assert.equal(windows.status, 2);
    assert.match(windows.stderr, /--os takes macos or linux/);
    for (const flag of [
      [],
      ['--host-cache', '/tmp/c'],
      ['--reuse', '/tmp/p.json'],
      ['--print-key'],
    ]) {
      const linux = makePrebuilt(['--os', 'linux', ...flag]);
      if (process.platform === 'linux') {
        assert.match(linux.stderr, /react-native is not installed/, flag.join(' '));
      } else {
        assert.equal(linux.status, 2, flag.join(' '));
        assert.match(linux.stderr, /--os linux builds on Linux only/);
      }
      assert.ok(!linux.wroteOut, 'nothing built or written');
    }
  });

  it('never replaces an archive a run already published, which a manifest may point to', () => {
    const { out, archive } = packed();
    try {
      const manifest = path.join(out, 'prebuilt.json');
      writeFileSync(manifest, JSON.stringify({ version: 1, hosts: [] }));
      publishPrebuilt({ out, archive, name: 'h.tar.gz', host, manifest });
      // Another build of the same name, published without --manifest.
      const second = path.join(out, '.second.partial');
      writeFileSync(second, 'another build');
      assert.throws(
        () =>
          publishPrebuilt({
            out,
            archive: second,
            name: 'h.tar.gz',
            host: { ...host, sha256: 'b' },
          }),
        (error: Error) => error.message.includes(path.join(out, 'h.tar.gz')),
      );
      assert.equal(readFileSync(path.join(out, 'h.tar.gz'), 'utf8'), 'archive');
      assert.equal(
        JSON.parse(readFileSync(path.join(out, 'prebuilt-host-rn-0.88.0-release.json'), 'utf8'))
          .sha256,
        'a',
      );
      assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')).hosts, [host]);
      assert.ok(!existsSync(second), 'its own packed archive is removed');
      assert.ok(!existsSync(path.join(out, '.make-prebuilt.lock')), 'its lock let go');
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
      assert.ok(!existsSync(path.join(out, 'prebuilt-host-rn-0.88.0-release.json')));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('locks the folder of a manifest elsewhere too, and lets go of both when it cannot', () => {
    const { out, archive } = packed();
    const elsewhere = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-publish-manifest-')));
    try {
      const manifest = path.join(elsewhere, 'prebuilt.json');
      writeFileSync(manifest, JSON.stringify({ version: 1, hosts: [] }));
      // Another run, for another React Native version, is updating that manifest.
      mkdirSync(path.join(elsewhere, '.make-prebuilt.lock'));
      assert.throws(
        () => publishPrebuilt({ out, archive, name: 'h.tar.gz', host, manifest }, { wait: 100 }),
        (error: Error) => error.message.includes(path.join(elsewhere, '.make-prebuilt.lock')),
      );
      assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')).hosts, []);
      assert.ok(!existsSync(path.join(out, 'h.tar.gz')), 'nothing published');
      assert.ok(!existsSync(path.join(out, '.make-prebuilt.lock')), 'its own lock let go');

      // Free, both folders are locked and let go, and the entry is written.
      rmSync(path.join(elsewhere, '.make-prebuilt.lock'), { recursive: true });
      publishPrebuilt({ out, archive, name: 'h.tar.gz', host, manifest }, { wait: 100 });
      assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')).hosts, [host]);
      assert.deepEqual(readdirSync(elsewhere), ['prebuilt.json']);
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
