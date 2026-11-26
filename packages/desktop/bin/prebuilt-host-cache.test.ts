import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { plist } from './plist.mjs';

import {
  hostAppDir,
  hostInputsKey,
  LINUX_HOST,
  readHostCache,
  treeDigests,
  writeHostCache,
} from '../native/scripts/prebuilt-host-cache.mjs';

const scripts = fileURLToPath(new URL('../native/scripts/', import.meta.url));

/** A temp folder for `body`, removed after it. */
function inTemp(body: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ngn-host-cache-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A built host's `appkit` folder in `dir`, with `make` writing each binary. */
function fakeHost(dir: string, make = (file: string) => writeFileSync(file, path.basename(file))) {
  const appkit = path.join(dir, 'build', 'appkit');
  const framework = path.join(appkit, 'Sparkle.framework');
  mkdirSync(path.join(framework, 'Versions', 'B'), { recursive: true });
  writeFileSync(path.join(framework, 'Versions', 'B', 'Sparkle'), 'sparkle');
  symlinkSync('B', path.join(framework, 'Versions', 'Current'));
  symlinkSync('Versions/Current/Sparkle', path.join(framework, 'Sparkle'));
  // React Native's Hermes, a versioned framework like Sparkle's.
  const hermes = path.join(appkit, 'hermesvm.framework');
  mkdirSync(path.join(hermes, 'Versions', '1', 'Resources'), { recursive: true });
  make(path.join(hermes, 'Versions', '1', 'hermesvm'));
  writeFileSync(
    path.join(hermes, 'Versions', '1', 'Resources', 'Info.plist'),
    plist({
      CFBundleExecutable: 'hermesvm',
      CFBundleIdentifier: 'dev.hermesengine.macosx',
      CFBundlePackageType: 'FMWK',
    }),
  );
  symlinkSync('1', path.join(hermes, 'Versions', 'Current'));
  symlinkSync('Versions/Current/hermesvm', path.join(hermes, 'hermesvm'));
  symlinkSync('Versions/Current/Resources', path.join(hermes, 'Resources'));
  make(path.join(appkit, 'ngn-macos'));
  make(path.join(appkit, 'hermesc'));
  return appkit;
}

const inputs = {
  flavour: 'release',
  reactNative: '0.88.0',
  libraries: { 'react-native-screens': '4.0.0', 'react-native-svg': '15.0.0' },
  sources: [['native/CMakeLists.txt', 'a']] as [string, string][],
  toolchain: 'Apple clang 17\n26.0',
  signing: '-',
};

describe('hostAppDir', () => {
  it('gives each set of versions a folder of its own, so one install never rewrites another', () => {
    const versions = { 'react-native': '0.88.1', 'react-native-screens': '4.30.1' };
    const dir = hostAppDir('/cache/rn-0.88.1', versions);
    assert.equal(path.dirname(dir), '/cache/rn-0.88.1');
    // The same versions, in any order, share one, so a compiler cache keeps its paths.
    assert.equal(
      hostAppDir('/cache/rn-0.88.1', {
        'react-native-screens': '4.30.1',
        'react-native': '0.88.1',
      }),
      dir,
    );
    // A library at another version, or one more library, is another install.
    assert.notEqual(
      hostAppDir('/cache/rn-0.88.1', { ...versions, 'react-native-screens': '4.31.0' }),
      dir,
    );
    assert.notEqual(
      hostAppDir('/cache/rn-0.88.1', { ...versions, 'react-native-svg': '15.16.0' }),
      dir,
    );
  });
});

describe('hostInputsKey', () => {
  it('changes with every input, and not with the order of the libraries', () => {
    const key = hostInputsKey(inputs);
    for (const changed of [
      { ...inputs, flavour: 'debug' },
      { ...inputs, reactNative: '0.88.1' },
      { ...inputs, libraries: { ...inputs.libraries, 'react-native-svg': '15.0.1' } },
      { ...inputs, libraries: { 'react-native-screens': '4.0.0' } },
      { ...inputs, sources: [['native/CMakeLists.txt', 'b']] as [string, string][] },
      { ...inputs, toolchain: 'Apple clang 18\n26.0' },
      { ...inputs, signing: 'Developer ID Application: Someone' },
      { ...inputs, platform: { os: 'linux', arch: 'x64' } },
    ]) {
      assert.notEqual(hostInputsKey(changed), key, JSON.stringify(changed));
    }
    assert.equal(
      hostInputsKey({
        ...inputs,
        libraries: { 'react-native-svg': '15.0.0', 'react-native-screens': '4.0.0' },
      }),
      key,
    );
    const linux = { ...inputs, platform: { os: 'linux', arch: 'x64' } };
    assert.notEqual(
      hostInputsKey({ ...linux, platform: { os: 'linux', arch: 'arm64' } }),
      hostInputsKey(linux),
      'one key per Linux architecture',
    );
  });
});

describe('treeDigests', () => {
  it('digests each file by its contents and each link by its target, never following it', () => {
    inTemp((dir) => {
      const appkit = fakeHost(dir);
      const digests = new Map(treeDigests(appkit, appkit));
      assert.equal(digests.get('Sparkle.framework/Sparkle'), 'link:Versions/Current/Sparkle');
      assert.equal(digests.get('Sparkle.framework/Versions/Current'), 'link:B');
      assert.match(digests.get('ngn-macos') ?? '', /^[0-9a-f]{64}$/);
      assert.deepEqual(
        [...digests.keys()],
        [...digests.keys()].sort(),
        'sorted, so the same tree digests the same',
      );
    });
  });
});

describe('the host cache', () => {
  it('gives back the host saved under the same key, files and links as they were', () => {
    inTemp((dir) => {
      const appkit = fakeHost(dir);
      const cache = path.join(dir, 'cache');
      writeHostCache(cache, 'k1', appkit);
      const read = readHostCache(cache, 'k1');
      assert.equal(read.host, path.join(cache, 'appkit'));
      assert.deepEqual(treeDigests(read.host!, read.host!), treeDigests(appkit, appkit));
    });
  });

  it('is never used when missing, from other inputs, short of a file or changed in any byte', () => {
    inTemp((dir) => {
      const appkit = fakeHost(dir);
      const cache = path.join(dir, 'cache');
      assert.match(readHostCache(cache, 'k1').reason ?? '', /no built host/);

      writeHostCache(cache, 'k1', appkit);
      assert.match(readHostCache(cache, 'k2').reason ?? '', /other inputs/);

      writeFileSync(path.join(cache, 'appkit', 'hermesc'), 'hermesC');
      assert.match(readHostCache(cache, 'k1').reason ?? '', /not as it was saved/);

      writeHostCache(cache, 'k1', appkit);
      rmSync(path.join(cache, 'appkit', 'Sparkle.framework', 'Versions', 'Current'));
      assert.match(readHostCache(cache, 'k1').reason ?? '', /not as it was saved/);

      writeHostCache(cache, 'k1', appkit);
      rmSync(path.join(cache, 'appkit', 'ngn-macos'));
      assert.match(readHostCache(cache, 'k1').reason ?? '', /has no ngn-macos/);

      writeHostCache(cache, 'k1', appkit);
      writeFileSync(path.join(cache, 'host.json'), '{"key":');
      assert.match(readHostCache(cache, 'k1').reason ?? '', /unreadable/);

      for (const record of ['null', '"k1"', '[]', '7']) {
        writeFileSync(path.join(cache, 'host.json'), record);
        assert.match(readHostCache(cache, 'k1').reason ?? '', /not a host record/, record);
      }
    });
  });

  it("keeps a Linux host's files in its own folder, and is never used short of one", () => {
    inTemp((dir) => {
      const gtk = path.join(dir, 'build', 'gtk');
      mkdirSync(gtk, { recursive: true });
      writeFileSync(path.join(gtk, 'ngn-linux'), 'host');
      writeFileSync(path.join(gtk, 'hermesc'), 'hermesc');
      const cache = path.join(dir, 'cache');
      writeHostCache(cache, 'k1', gtk, LINUX_HOST);
      const read = readHostCache(cache, 'k1', LINUX_HOST);
      assert.equal(read.host, path.join(cache, 'gtk'));
      assert.deepEqual(treeDigests(read.host!, read.host!), treeDigests(gtk, gtk));
      // A macOS host's files are not in it.
      assert.match(readHostCache(cache, 'k1').reason ?? '', /has no ngn-macos/);
      rmSync(path.join(cache, 'gtk', 'ngn-linux'));
      assert.match(readHostCache(cache, 'k1', LINUX_HOST).reason ?? '', /has no ngn-linux/);
    });
  });

  it('replaces what the folder held, so a file of an older host never stays', () => {
    inTemp((dir) => {
      const appkit = fakeHost(dir);
      const cache = path.join(dir, 'cache');
      mkdirSync(path.join(cache, 'appkit'), { recursive: true });
      writeFileSync(path.join(cache, 'appkit', 'stale'), 'old');
      writeHostCache(cache, 'k1', appkit);
      assert.ok(!existsSync(path.join(cache, 'appkit', 'stale')));
      assert.ok(readHostCache(cache, 'k1').host);
    });
  });
});

describe('make-prebuilt.mjs --host-cache', { skip: process.platform !== 'darwin' }, () => {
  /** An app with only react-native's package.json: enough to key and pack, never to build. */
  function app(dir: string) {
    const rn = path.join(dir, 'app', 'node_modules', 'react-native');
    mkdirSync(rn, { recursive: true });
    writeFileSync(path.join(dir, 'app', 'package.json'), '{"name":"app"}');
    writeFileSync(path.join(rn, 'package.json'), '{"name":"react-native","version":"0.88.0"}');
    return path.join(dir, 'app');
  }

  /** A universal executable, as the build leaves ngn-macos and hermesc. */
  function universal(file: string) {
    const source = `${file}.c`;
    writeFileSync(source, 'int main(void) { return 0; }\n');
    const result = spawnSync('clang', ['-arch', 'arm64', '-arch', 'x86_64', '-o', file, source], {
      encoding: 'utf8',
    });
    rmSync(source);
    assert.equal(result.status, 0, result.stderr);
  }

  function makePrebuilt(args: string[]) {
    return spawnSync(process.execPath, [path.join(scripts, 'make-prebuilt.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '', NGN_SIGN_IDENTITY: '' },
      timeout: 60_000,
    });
  }

  it('packs the host saved under the inputs key with no build, and builds when it is changed', () => {
    inTemp((dir) => {
      const appDir = app(dir);
      const appkit = fakeHost(dir, universal);
      const key = makePrebuilt([appDir, '--print-key', '--flavour', 'release']);
      assert.equal(key.status, 0, key.stderr);
      assert.match(key.stdout.trim(), /^[0-9a-f]{64}$/);
      assert.notEqual(
        makePrebuilt([appDir, '--print-key', '--flavour', 'debug']).stdout,
        key.stdout,
        'one key per flavour',
      );

      const cache = path.join(dir, 'cache');
      writeHostCache(cache, key.stdout.trim(), appkit);
      const out = path.join(dir, 'out');
      const args = [appDir, out, '--host-cache', cache, '--version', '9.9.9'];
      const hit = makePrebuilt([...args, '--base-url', 'https://e.com/v9.9.9']);
      assert.equal(hit.status, 0, hit.stderr);
      assert.match(hit.stderr, /packing the host built from these inputs/);
      const entry = JSON.parse(
        readFileSync(path.join(out, 'prebuilt-host-rn-0.88.0-release.json'), 'utf8'),
      );
      assert.equal(
        entry.url,
        'https://e.com/v9.9.9/ng-native-desktop-host-9.9.9-rn-0.88.0-macos-universal.tar.gz',
      );
      const listing = spawnSync('tar', ['-tzf', path.join(out, path.basename(entry.url))], {
        encoding: 'utf8',
      }).stdout;
      for (const file of [
        'appkit/ngn-macos',
        'appkit/hermesc',
        'appkit/hermesvm.framework/hermesvm',
        'appkit/Sparkle.framework/Sparkle',
      ]) {
        assert.ok(listing.split('\n').includes(file), `${file} in ${listing}`);
      }
      // Signed in the archive only: the cache keeps the build's files for the next run.
      assert.ok(readHostCache(cache, key.stdout.trim()).host, 'the cache is unchanged');

      // A changed byte builds instead, which this app cannot: it fails rather than pack the cache.
      writeFileSync(path.join(cache, 'appkit', 'hermesc'), 'tampered');
      const miss = makePrebuilt([...args, '--version', '9.9.10', '--base-url', 'https://e.com/v']);
      assert.notEqual(miss.status, 0);
      assert.match(miss.stderr, /not as it was saved; building the host/);
      assert.ok(
        !existsSync(
          path.join(out, 'ng-native-desktop-host-9.9.10-rn-0.88.0-macos-universal.tar.gz'),
        ),
      );
    });
  });

  /** make-prebuilt.mjs run without blocking, so a server in this process can answer it. */
  function makePrebuiltAsync(args: string[]) {
    return new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [path.join(scripts, 'make-prebuilt.mjs'), ...args], {
        env: { ...process.env, NODE_PATH: '', NGN_SIGN_IDENTITY: '' },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (status) => resolve({ status, stderr }));
    });
  }

  it('reuses an earlier release archive byte for byte when its entry has the inputs key, and builds otherwise', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngn-host-reuse-'));
    /** What the server answers with for the archive. */
    let served: Buffer | null = null;
    const server = createServer((_request, response) => {
      if (served) response.end(served);
      else response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    try {
      const appDir = app(dir);
      const key = makePrebuilt([appDir, '--print-key']).stdout.trim();
      // The earlier release, packed from a cached host.
      const cache = path.join(dir, 'cache');
      writeHostCache(cache, key, fakeHost(dir, universal));
      const earlier = path.join(dir, 'earlier');
      const first = makePrebuilt([
        appDir,
        earlier,
        '--host-cache',
        cache,
        '--version',
        '1.0.0',
        '--base-url',
        base,
      ]);
      assert.equal(first.status, 0, first.stderr);
      const entry = JSON.parse(
        readFileSync(path.join(earlier, 'prebuilt-host-rn-0.88.0-release.json'), 'utf8'),
      );
      assert.equal(entry.inputs, key, 'the entry records the inputs key');
      const archive = readFileSync(path.join(earlier, path.basename(entry.url)));
      const manifest = path.join(dir, 'prebuilt.json');
      const writeManifest = (host: object) =>
        writeFileSync(manifest, JSON.stringify({ version: 1, hosts: [host] }));
      writeManifest(entry);

      served = archive;
      const out = path.join(dir, 'out');
      const reused = await makePrebuiltAsync([
        appDir,
        out,
        '--reuse',
        manifest,
        '--version',
        '1.0.1',
        '--base-url',
        base,
      ]);
      assert.equal(reused.status, 0, reused.stderr);
      assert.match(reused.stderr, /reusing the host/);
      const next = JSON.parse(
        readFileSync(path.join(out, 'prebuilt-host-rn-0.88.0-release.json'), 'utf8'),
      );
      assert.equal(next.sha256, entry.sha256);
      assert.equal(next.inputs, key);
      assert.match(next.url, /host-1\.0\.1-rn/);
      assert.deepEqual(readFileSync(path.join(out, path.basename(next.url))), archive);

      // Each of these builds instead, which this app cannot: it fails, never publishing the archive.
      for (const [why, host, body] of [
        [/other inputs/, { ...entry, inputs: 'another' }, archive],
        [/does not match the SHA-256/, entry, Buffer.from('not the archive')],
        [/answered 404/, entry, null],
        [/has no release host/, { ...entry, flavour: 'debug' }, archive],
      ] as const) {
        writeManifest(host);
        served = body;
        const missOut = path.join(dir, `miss-${String(why).length}`);
        const miss = await makePrebuiltAsync([
          appDir,
          missOut,
          '--reuse',
          manifest,
          '--version',
          '1.0.2',
          '--base-url',
          base,
        ]);
        assert.notEqual(miss.status, 0, String(why));
        assert.match(miss.stderr, why);
        assert.match(miss.stderr, /not reusing it/);
        assert.ok(
          !existsSync(path.join(missOut, 'prebuilt-host-rn-0.88.0-release.json')),
          String(why),
        );
      }

      // With --reuse-only, each of those is a miss that builds nothing and says so.
      for (const [host, body] of [
        [{ ...entry, inputs: 'another' }, archive],
        [entry, Buffer.from('not the archive')],
        [entry, null],
      ] as const) {
        writeManifest(host);
        served = body;
        const missOut = path.join(dir, 'reuse-only-miss');
        const miss = await makePrebuiltAsync([
          appDir,
          missOut,
          '--reuse',
          manifest,
          '--reuse-only',
          '--version',
          '1.0.2',
          '--base-url',
          base,
        ]);
        assert.equal(miss.status, 3, miss.stderr);
        assert.match(miss.stderr, /--reuse-only: nothing to reuse, so nothing is built/);
        assert.doesNotMatch(miss.stderr, /build\.sh/);
        assert.ok(!existsSync(path.join(missOut, 'prebuilt-host-rn-0.88.0-release.json')));
      }
      writeManifest(entry);
      served = archive;
      const only = await makePrebuiltAsync([
        appDir,
        path.join(dir, 'reuse-only-hit'),
        '--reuse',
        manifest,
        '--reuse-only',
        '--version',
        '1.0.3',
        '--base-url',
        base,
      ]);
      assert.equal(only.status, 0, only.stderr);
      assert.match(only.stderr, /reusing the host/);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes --reuse-only only with --reuse', () => {
    inTemp((dir) => {
      const result = makePrebuilt([app(dir), path.join(dir, 'out'), '--reuse-only']);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /--reuse-only needs --reuse/);
      assert.ok(!existsSync(path.join(dir, 'out')));
    });
  });

  it('takes only a missing or empty --build-dir, before it builds', () => {
    inTemp((dir) => {
      mkdirSync(path.join(dir, 'build'));
      writeFileSync(path.join(dir, 'build', 'CMakeCache.txt'), '');
      const result = makePrebuilt([
        app(dir),
        path.join(dir, 'out'),
        '--build-dir',
        path.join(dir, 'build'),
      ]);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /--build-dir takes a missing or empty folder/);
      assert.ok(!existsSync(path.join(dir, 'out')));
    });
  });
});

describe(
  'make-prebuilt.mjs --os linux, --host-cache and --reuse',
  { skip: process.platform !== 'linux' },
  () => {
    /** An app with only react-native's package.json: enough to key and pack, never to build. */
    function app(dir: string) {
      const rn = path.join(dir, 'app', 'node_modules', 'react-native');
      mkdirSync(rn, { recursive: true });
      writeFileSync(path.join(dir, 'app', 'package.json'), '{"name":"app"}');
      writeFileSync(path.join(rn, 'package.json'), '{"name":"react-native","version":"0.88.0"}');
      return path.join(dir, 'app');
    }

    /** A GTK host's `gtk` folder in `dir`, each file an executable for this machine. */
    function linuxHost(dir: string) {
      const gtk = path.join(dir, 'build', 'gtk');
      mkdirSync(gtk, { recursive: true });
      const source = path.join(dir, 'main.c');
      writeFileSync(source, 'int main(void) { return 0; }\n');
      for (const file of LINUX_HOST.files) {
        const result = spawnSync('cc', ['-o', path.join(gtk, file), source], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      }
      return gtk;
    }

    const env = { ...process.env, NODE_PATH: '' };
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    /** The manifest entry's file for this machine's Linux release host. */
    const ENTRY = `prebuilt-host-rn-0.88.0-linux-${arch}-release.json`;
    const printKey = (appDir: string, ...args: string[]) => {
      const result = spawnSync(
        process.execPath,
        [path.join(scripts, 'make-prebuilt.mjs'), appDir, '--print-key', ...args],
        { encoding: 'utf8', env },
      );
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };

    /** make-prebuilt.mjs run without blocking, so a server in this process can answer it. */
    function makePrebuiltAsync(args: string[]) {
      return new Promise<{ status: number | null; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [path.join(scripts, 'make-prebuilt.mjs'), ...args], {
          env,
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('close', (status) => resolve({ status, stderr }));
      });
    }

    it('packs the cached host, then reuses its archive in the next release, for this architecture only', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'ngn-host-linux-'));
      let served: Buffer | null = null;
      const server = createServer((_request, response) => {
        if (served) response.end(served);
        else response.writeHead(404).end();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      try {
        const appDir = app(dir);
        const key = printKey(appDir, '--os', 'linux');
        assert.match(key, /^[0-9a-f]{64}$/);
        assert.notEqual(printKey(appDir, '--os', 'linux', '--flavour', 'debug'), key);

        const cache = path.join(dir, 'cache');
        writeHostCache(cache, key, linuxHost(dir), LINUX_HOST);
        const earlier = path.join(dir, 'earlier');
        const first = await makePrebuiltAsync([
          appDir,
          earlier,
          '--os',
          'linux',
          '--host-cache',
          cache,
          '--version',
          '1.0.0',
          '--base-url',
          base,
        ]);
        assert.equal(first.status, 0, first.stderr);
        assert.match(first.stderr, /packing the host built from these inputs/);
        const entry = JSON.parse(readFileSync(path.join(earlier, ENTRY), 'utf8'));
        assert.equal(entry.os, 'linux');
        assert.equal(entry.inputs, key, 'the entry records the inputs key');
        const packed = path.join(earlier, path.basename(entry.url));
        const listing = spawnSync('tar', ['-tzf', packed], { encoding: 'utf8' }).stdout;
        for (const file of ['gtk/ngn-linux', 'gtk/hermesc']) {
          assert.ok(listing.split('\n').includes(file), `${file} in ${listing}`);
        }
        assert.ok(readHostCache(cache, key, LINUX_HOST).host, 'stripped in the archive only');

        const manifest = path.join(dir, 'prebuilt.json');
        const writeManifest = (host: object) =>
          writeFileSync(manifest, JSON.stringify({ version: 1, hosts: [host] }));
        const archive = readFileSync(packed);
        writeManifest(entry);
        served = archive;
        const out = path.join(dir, 'out');
        const reused = await makePrebuiltAsync([
          appDir,
          out,
          '--os',
          'linux',
          '--reuse',
          manifest,
          '--reuse-only',
          '--version',
          '1.0.1',
          '--base-url',
          base,
        ]);
        assert.equal(reused.status, 0, reused.stderr);
        assert.match(reused.stderr, /reusing the host/);
        const next = JSON.parse(readFileSync(path.join(out, ENTRY), 'utf8'));
        assert.equal(next.sha256, entry.sha256);
        assert.equal(next.arch, entry.arch);
        assert.match(next.url, /host-1\.0\.1-rn/);
        assert.deepEqual(readFileSync(path.join(out, path.basename(next.url))), archive);

        // The other architecture's entry, or a macOS one, is never this host's.
        const other = entry.arch === 'x64' ? 'arm64' : 'x64';
        const { os: _os, arch: _arch, ...mac } = entry;
        for (const host of [{ ...entry, arch: other }, mac]) {
          writeManifest(host);
          const missOut = path.join(dir, 'miss');
          const miss = await makePrebuiltAsync([
            appDir,
            missOut,
            '--os',
            'linux',
            '--reuse',
            manifest,
            '--reuse-only',
            '--version',
            '1.0.2',
            '--base-url',
            base,
          ]);
          assert.equal(miss.status, 3, miss.stderr);
          assert.match(miss.stderr, /has no Linux (x64|arm64) release host/);
          assert.ok(!existsSync(path.join(missOut, ENTRY)));
        }
      } finally {
        server.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
