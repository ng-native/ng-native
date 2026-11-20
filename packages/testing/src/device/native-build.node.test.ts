/**
 * Where a device run's development build is kept, and when one is used again: by the native
 * fingerprint, which leaves out an `ios` or `android` folder the run generated.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { nativeBuild } from './native-build.ts';

/** A project whose `expo` has a stand-in `@expo/fingerprint`, which records what it was asked. */
function project(): { root: string; asked: () => object[]; done: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'native-build-'));
  writeFileSync(path.join(root, 'package.json'), '{}');
  const expo = path.join(root, 'node_modules/expo');
  mkdirSync(path.join(expo, 'node_modules/@expo/fingerprint'), { recursive: true });
  writeFileSync(path.join(expo, 'package.json'), '{"name":"expo"}');
  const log = path.join(root, 'asked.json');
  writeFileSync(log, '[]');
  writeFileSync(
    path.join(expo, 'node_modules/@expo/fingerprint/index.js'),
    `const fs = require('fs');
     exports.createProjectHashAsync = async (root, options) => {
       fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify([...JSON.parse(fs.readFileSync(${JSON.stringify(log)}, 'utf8')), options]));
       return 'abc123';
     };`,
  );
  return {
    root,
    asked: () => JSON.parse(readFileSync(log, 'utf8')) as object[],
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('the development build a device run uses', () => {
  it('is the one kept under its OS and fingerprint, with nothing built', async () => {
    const { root, done } = project();
    try {
      const kept = path.join(root, 'node_modules/.cache/ng-native-device-tests/ios-abc123');
      mkdirSync(path.join(kept, 'App.app'), { recursive: true });
      assert.equal((await nativeBuild(root, 'ios')).path, path.join(kept, 'App.app'));
      const apk = path.join(
        root,
        'node_modules/.cache/ng-native-device-tests/android-abc123-x86_64',
      );
      mkdirSync(apk, { recursive: true });
      writeFileSync(path.join(apk, 'app-debug.apk'), '');
      assert.equal(
        (await nativeBuild(root, 'android', { abi: 'x86_64' })).path,
        path.join(apk, 'app-debug.apk'),
        'kept for its ABI too',
      );
    } finally {
      done();
    }
  });

  it('is fingerprinted without a native folder the run generated, and with one of the project', async () => {
    const { root, asked, done } = project();
    try {
      const kept = path.join(root, 'node_modules/.cache/ng-native-device-tests/ios-abc123');
      mkdirSync(path.join(kept, 'App.app'), { recursive: true });
      mkdirSync(path.join(root, 'ios'));
      await nativeBuild(root, 'ios');
      writeFileSync(path.join(root, 'ios/.ng-native-generated'), '');
      await nativeBuild(root, 'ios');
      assert.deepEqual(asked(), [
        { platforms: ['ios'] },
        { platforms: ['ios'], ignorePaths: ['ios/**'] },
      ]);
    } finally {
      done();
    }
  });

  it('puts back the app config and scripts that prebuild rewrites, even when the build fails', async () => {
    const { root, done } = project();
    try {
      const pkg = path.join(root, 'package.json');
      writeFileSync(pkg, '{"scripts":{"ios":"expo start --ios"}}');
      mkdirSync(path.join(root, 'node_modules/expo/bin'), { recursive: true });
      writeFileSync(
        path.join(root, 'node_modules/expo/bin/cli.js'),
        `const fs = require('fs');
         fs.writeFileSync('package.json', '{"scripts":{"ios":"expo run:ios"}}');
         fs.writeFileSync('app.json', '{"expo":{"ios":{"bundleIdentifier":"com.someone.app"}}}');
         fs.mkdirSync('ios');
         process.exit(1);`,
      );
      await assert.rejects(nativeBuild(root, 'ios'), /build for device tests failed/);
      assert.equal(readFileSync(pkg, 'utf8'), '{"scripts":{"ios":"expo start --ios"}}');
      assert.equal(existsSync(path.join(root, 'ios')), false, 'the half-made ios folder is gone');
      assert.equal(existsSync(path.join(root, 'app.json')), false, 'one it made is removed');
    } finally {
      done();
    }
  });
});
