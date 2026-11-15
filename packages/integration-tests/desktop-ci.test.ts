/**
 * What the Desktop host workflow depends on: `scripts/desktop-host-pins.mjs`, which decides whether
 * a lockfile change reaches the host, and the compiler launcher the desktop build scripts pass to
 * CMake, which the workflow sets to ccache.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const pinsScript = new URL('../../scripts/desktop-host-pins.mjs', import.meta.url);
const { HOST_PACKAGES, hostPins, pinsChanged } = (await import(pinsScript.href)) as {
  HOST_PACKAGES: string[];
  hostPins(lockfile: string): string[];
  pinsChanged(base: string, head: string): boolean;
};

const scripts = new URL('../desktop/native/scripts/', import.meta.url);
const launcher = (...args: string[]) =>
  spawnSync('bash', [fileURLToPath(new URL('compiler-launcher.sh', scripts)), ...args], {
    encoding: 'utf8',
  });

const lock = (packages: string[], snapshots = '') =>
  `lockfileVersion: '9.0'\n\npackages:\n\n${packages.map((p) => `  ${p}:\n    resolution: {integrity: x}\n\n`).join('')}snapshots:\n\n${snapshots}`;

describe('the host pins in the lockfile', () => {
  it('reads the host packages from the packages section, whatever else resolves', () => {
    const pins = hostPins(
      lock(
        [
          'react-native@0.88.0',
          'react-native-svg@15.16.0',
          "'@react-native-async-storage/async-storage@2.2.0'",
          'left-pad@1.0.0',
          'react-native-fantom@0.88.0',
        ],
        '  react-native-webview@14.0.1(react@19):\n    dependencies: {}\n',
      ),
    );
    // A snapshot's peer-suffixed key is not a package, and an unlisted package is no pin.
    assert.deepEqual(pins, [
      '@react-native-async-storage/async-storage@2.2.0',
      'react-native-svg@15.16.0',
      'react-native@0.88.0',
    ]);
  });

  it('changes for a version bump, an added package and a removed one', () => {
    const base = lock(['react-native@0.88.0', 'react-native-screens@4.30.0']);
    assert.ok(pinsChanged(base, lock(['react-native@0.88.1', 'react-native-screens@4.30.0'])));
    assert.ok(pinsChanged(base, lock(['react-native@0.88.0'])));
    assert.ok(
      pinsChanged(
        base,
        lock(['react-native@0.88.0', 'react-native-screens@4.30.0', 'react-native-svg@1.0.0']),
      ),
    );
    assert.ok(
      pinsChanged(
        base,
        lock(['react-native@0.88.0', 'react-native-screens@4.30.0', 'react-native-screens@4.31.0']),
      ),
    );
  });

  it('does not change for a lockfile edit that leaves them as they were', () => {
    const base = lock(['react-native@0.88.0', 'left-pad@1.0.0']);
    assert.ok(!pinsChanged(base, lock(['left-pad@1.0.1', 'react-native@0.88.0', 'other@2.0.0'])));
  });

  it('finds every host package in this repository lockfile', () => {
    const pins = hostPins(readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'));
    for (const name of HOST_PACKAGES) {
      assert.ok(
        pins.some((pin) => pin.startsWith(`${name}@`)),
        `${name} has no pin: renamed, or dropped from the lockfile`,
      );
    }
  });

  it('fails closed: a base ref it cannot read means the host builds', () => {
    const run = spawnSync('node', [fileURLToPath(pinsScript), 'no-such-ref-for-desktop-pins'], {
      encoding: 'utf8',
    });
    assert.equal(run.stdout.trim(), 'true');
  });
});

describe('the compiler launcher of the desktop build', () => {
  it('names C and C++ launchers on Linux, and Objective-C ones too on macOS', () => {
    assert.deepEqual(launcher('ccache', 'Linux').stdout.trim().split('\n'), [
      '-DCMAKE_C_COMPILER_LAUNCHER=ccache',
      '-DCMAKE_CXX_COMPILER_LAUNCHER=ccache',
    ]);
    assert.deepEqual(launcher('ccache', 'Darwin').stdout.trim().split('\n'), [
      '-DCMAKE_C_COMPILER_LAUNCHER=ccache',
      '-DCMAKE_CXX_COMPILER_LAUNCHER=ccache',
      '-DCMAKE_OBJC_COMPILER_LAUNCHER=ccache',
      '-DCMAKE_OBJCXX_COMPILER_LAUNCHER=ccache',
    ]);
  });

  it('clears each launcher when none is set, so a build directory never keeps an earlier one', () => {
    assert.deepEqual(launcher('', 'Linux').stdout.trim().split('\n'), [
      '-DCMAKE_C_COMPILER_LAUNCHER=',
      '-DCMAKE_CXX_COMPILER_LAUNCHER=',
    ]);
    assert.deepEqual(launcher('', 'Darwin').stdout.trim().split('\n'), [
      '-DCMAKE_C_COMPILER_LAUNCHER=',
      '-DCMAKE_CXX_COMPILER_LAUNCHER=',
      '-DCMAKE_OBJC_COMPILER_LAUNCHER=',
      '-DCMAKE_OBJCXX_COMPILER_LAUNCHER=',
    ]);
  });

  it('is what build.sh and build-hermes.sh read from NGN_COMPILER_LAUNCHER', () => {
    for (const name of ['build.sh', 'build-hermes.sh']) {
      const script = readFileSync(new URL(name, scripts), 'utf8');
      assert.match(script, /compiler-launcher\.sh" "\$\{NGN_COMPILER_LAUNCHER:-\}"/, name);
      assert.match(script, /\$\{launcher_args\[@\]\+"\$\{launcher_args\[@\]\}"\}/, name);
    }
  });
});

describe('the desktop build scripts', () => {
  // A react-native package at a path with an apostrophe, at a version no pin names, and a cache of
  // its own: each script reads the version, then stops where that version or the cache stops it.
  const fixture = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ngn-scripts-')));
    const rn = join(root, "O'Brien", 'react-native');
    mkdirSync(rn, { recursive: true });
    writeFileSync(
      join(rn, 'package.json'),
      JSON.stringify({ name: 'react-native', version: '0.0.1' }),
    );
    return { root, rn, env: { ...process.env, NGN_DESKTOP_CACHE: join(root, 'cache') } };
  };
  const script = (name: string, args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync('bash', [fileURLToPath(new URL(name, scripts)), ...args], { encoding: 'utf8', env });

  it('read the react-native version from a path with an apostrophe in it', () => {
    const { root, rn, env } = fixture();
    try {
      for (const name of ['fetch.sh', 'build.sh']) {
        const run = script(name, [rn, ...(name === 'build.sh' ? ['--backend', 'none'] : [])], env);
        assert.match(run.stderr, /react-native 0\.0\.1 is not supported/, name);
      }
      assert.match(script('build-hermes.sh', [rn], env).stderr, /run fetch\.sh first/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('find a library codegen by its codegenConfig.name, not its Android target name', () => {
    const { root, rn, env } = fixture();
    try {
      const lib = join(root, 'node_modules', 'foo');
      mkdirSync(lib, { recursive: true });
      writeFileSync(
        join(lib, 'package.json'),
        JSON.stringify({ name: 'foo', version: '1.0.0', codegenConfig: { name: 'NativeFooSpec' } }),
      );
      writeFileSync(
        join(lib, 'react-native.config.js'),
        "module.exports = { dependency: { platforms: { android: { libraryName: 'foo' } } } };",
      );
      // Generated already, so the script answers the directory without running the codegen. The
      // directory is named for the codegen name and a hash of the stamp.
      const stamp = `foo@1.0.0 ${lib} 3`;
      const key = createHash('sha1').update(stamp).digest('hex').slice(0, 12);
      const out = join(root, 'cache', 'rn-0.0.1', 'libraries', `NativeFooSpec-${key}`);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'stamp'), `${stamp}\n`);
      const run = script('codegen-library.sh', [rn, lib], env);
      assert.equal(run.stdout.trim(), out, run.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
