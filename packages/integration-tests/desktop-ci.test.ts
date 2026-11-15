/**
 * What the Desktop host workflow depends on: `scripts/desktop-host-pins.mjs`, which decides whether
 * a lockfile change reaches the host, and the compiler launcher the desktop build scripts pass to
 * CMake, which the workflow sets to ccache.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const pinsScript = new URL('../../scripts/desktop-host-pins.mjs', import.meta.url);
const { HOST_PACKAGES, hostPins, pinsChanged } = (await import(pinsScript.href)) as {
  HOST_PACKAGES: string[];
  hostPins(lockfile: string): string[];
  pinsChanged(base: string, head: string): boolean;
};

const scripts = new URL('../desktop/native/scripts/', import.meta.url);
const launcher = (...args: string[]) =>
  spawnSync('bash', [new URL('compiler-launcher.sh', scripts).pathname, ...args], {
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
    const run = spawnSync('node', [pinsScript.pathname, 'no-such-ref-for-desktop-pins'], {
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

  it('names nothing when none is set, so a local build is unchanged', () => {
    assert.equal(launcher('').stdout, '');
    assert.equal(launcher().stdout, '');
  });

  it('is what build.sh and build-hermes.sh read from NGN_COMPILER_LAUNCHER', () => {
    for (const name of ['build.sh', 'build-hermes.sh']) {
      const script = readFileSync(new URL(name, scripts), 'utf8');
      assert.match(script, /compiler-launcher\.sh" "\$\{NGN_COMPILER_LAUNCHER:-\}"/, name);
      assert.match(script, /\$\{launcher_args\[@\]\+"\$\{launcher_args\[@\]\}"\}/, name);
    }
  });
});
