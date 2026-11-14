import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../native/scripts/codegen-library.sh', import.meta.url));
const reactNative = path.dirname(
  createRequire(import.meta.url).resolve('react-native/package.json'),
);
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-codegen-library-')));
after(() => rmSync(root, { recursive: true, force: true }));

/**
 * A library with one interface-only component, `FakeDetector`, whose descriptor its own C++
 * declares (as react-native-gesture-handler's RNGestureHandlerDetector), with a
 * react/renderer/components/fakelib folder at each of `folders`.
 */
function library(name: string, folders: string[]) {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      codegenConfig: { name: 'fakelib', type: 'components', jsSrcsDir: './src' },
    }),
  );
  writeFileSync(
    path.join(dir, 'react-native.config.js'),
    "module.exports = { dependency: { platforms: { android: { componentDescriptors: ['FakeDetectorComponentDescriptor'] } } } };\n",
  );
  writeFileSync(
    path.join(dir, 'src', 'FakeDetectorNativeComponent.ts'),
    [
      "import type { ViewProps } from 'react-native';",
      "import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';",
      'export interface NativeProps extends ViewProps {}',
      "export default codegenNativeComponent<NativeProps>('FakeDetector', { interfaceOnly: true });",
      '',
    ].join('\n'),
  );
  for (const folder of folders) {
    const components = path.join(dir, folder, 'react/renderer/components/fakelib');
    mkdirSync(components, { recursive: true });
    writeFileSync(path.join(components, 'FakeDetectorComponentDescriptor.h'), '');
  }
  return dir;
}

/** The library's own C++ folder, as the library.cmake the script writes names it. */
function commonDir(lib: string) {
  const cache = path.join(root, `cache-${path.basename(lib)}`);
  const run = spawnSync('bash', [script, reactNative, lib], {
    encoding: 'utf8',
    env: { ...process.env, NGN_DESKTOP_CACHE: cache },
  });
  assert.equal(run.status, 0, run.stderr);
  const cmake = readFileSync(path.join(run.stdout.trim(), 'library.cmake'), 'utf8');
  return /set\(NGN_LIBRARY_COMMON_DIR "(.*)"\)/.exec(cmake)?.[1];
}

describe('codegen-library.sh', () => {
  it("finds a library's own C++ outside common/cpp, as react-native-gesture-handler's shared/shadowNodes", () => {
    const lib = library('shared-lib', ['shared/shadowNodes']);
    assert.equal(commonDir(lib), path.join(lib, 'shared/shadowNodes'));
  });

  it('prefers common/cpp, and never takes a folder from build output, dependencies or other platforms', () => {
    const both = library('both-lib', ['shared/shadowNodes', 'common/cpp']);
    assert.equal(commonDir(both), path.join(both, 'common/cpp'));
    const elsewhere = library('elsewhere-lib', [
      'android/build/generated/source/codegen/jni',
      'node_modules/dep/cpp',
      'windows/cpp',
    ]);
    assert.equal(commonDir(elsewhere), '');
  });
});
