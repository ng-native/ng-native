import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const librariesCmake = fileURLToPath(new URL('../native/cmake/libraries.cmake', import.meta.url));
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-libraries-cmake-')));
after(() => rmSync(root, { recursive: true, force: true }));

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * The registration cmake/libraries.cmake generates for one library, `fakelib`, whose own C++ (in
 * `common`) holds `headers`, and which registers `descriptors`.
 */
function registration(name: string, headers: Record<string, string>, descriptors: string[]) {
  const dir = path.join(root, name);
  const common = path.join(dir, 'common');
  write(
    path.join(dir, 'lib/codegen/react/renderer/components/fakelib/ComponentDescriptors.cpp'),
    '',
  );
  for (const [header, text] of Object.entries(headers)) {
    write(path.join(common, 'react/renderer/components/fakelib', header), text);
  }
  write(
    path.join(dir, 'lib/library.cmake'),
    [
      'set(NGN_LIBRARY_NAME "fakelib")',
      `set(NGN_LIBRARY_COMMON_DIR "${common}")`,
      `set(NGN_LIBRARY_DESCRIPTORS "${descriptors.join(';')}")`,
      '',
    ].join('\n'),
  );
  write(
    path.join(dir, 'src/CMakeLists.txt'),
    `cmake_minimum_required(VERSION 3.20)\nproject(fixture CXX)\ninclude(${librariesCmake})\n`,
  );
  const build = path.join(dir, 'build');
  const run = spawnSync(
    'cmake',
    ['-S', path.join(dir, 'src'), '-B', build, `-DNGN_LIBRARIES=${path.join(dir, 'lib')}`],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  return readFileSync(path.join(build, 'generated/library-components.cpp'), 'utf8');
}

describe('cmake/libraries.cmake', () => {
  it("includes the library's own header for each descriptor it registers, whatever the header is named", () => {
    const out = registration(
      'named',
      {
        'FakeViewComponentDescriptor.h': 'class FakeViewComponentDescriptor {};\n',
        // react-native-keyboard-controller's: the library's prefix before the descriptor's name.
        'RNKCFakeAreaComponentDescriptor.h':
          'class FakeAreaComponentDescriptor final\n    : public Base {};\n',
        // react-native-svg's: one header declaring several.
        'FakeComponentDescriptors.h':
          'using FakeCircleComponentDescriptor = Concrete<A>;\nusing FakeLineComponentDescriptor = Concrete<B>;\n',
        // A header for a descriptor the library does not register is left out.
        'RNKCFakeUnusedComponentDescriptor.h': 'class FakeUnusedComponentDescriptor {};\n',
      },
      [
        'FakeViewComponentDescriptor',
        'FakeAreaComponentDescriptor',
        'FakeCircleComponentDescriptor',
      ],
    );
    assert.match(
      out,
      /#include <react\/renderer\/components\/fakelib\/FakeViewComponentDescriptor\.h>/,
    );
    assert.match(
      out,
      /#include <react\/renderer\/components\/fakelib\/RNKCFakeAreaComponentDescriptor\.h>/,
    );
    assert.match(
      out,
      /#include <react\/renderer\/components\/fakelib\/FakeComponentDescriptors\.h>/,
    );
    assert.doesNotMatch(out, /RNKCFakeUnusedComponentDescriptor/);
    for (const d of [
      'FakeViewComponentDescriptor',
      'FakeAreaComponentDescriptor',
      'FakeCircleComponentDescriptor',
    ]) {
      assert.match(out, new RegExp(`concreteComponentDescriptorProvider<${d}>`));
    }
  });
});
