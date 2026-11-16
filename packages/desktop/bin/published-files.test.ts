/**
 * What `npm pack` puts in the published package against what an app's build configures from it.
 *
 * `ng-native-desktop run` and `package` build the host from the installed package's `native/`, so
 * a source CMake names that `files` leaves out stops the configure on every app's first run. The
 * core tests, and the fakes they link, are the repo's own: the published package leaves them out
 * and the builds an app makes never configure them.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const nativeDir = path.join(packageDir, 'native');

/** The files `npm pack` publishes, relative to the package. */
function packed(): Set<string> {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [{ files }] = JSON.parse(out) as [{ files: { path: string }[] }];
  return new Set(files.map((file) => file.path));
}

/** `text` without its `if(NGN_TESTS)` blocks, each up to the `endif()` that closes it. */
function withoutTests(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let depth = 0;
  for (const line of lines) {
    const opens = /^\s*if\s*\(/.test(line);
    const closes = /^\s*endif\s*\(/.test(line);
    if (depth === 0 && /^\s*if\s*\(\s*NGN_TESTS\s*\)/.test(line)) depth = 1;
    else if (depth > 0 && opens) depth++;
    else if (depth > 0 && closes) depth--;
    else if (depth === 0) kept.push(line);
  }
  return kept.join('\n');
}

/**
 * The files under `native/` that the CMake build names, as paths in the package: those in the
 * top-level list and the `cmake/` modules (relative to `native/`), and the AppKit target's
 * (relative to `native/appkit/`). Globs stay globs.
 */
function configured(tests: boolean): string[] {
  const read = (file: string) => {
    const text = readFileSync(path.join(nativeDir, file), 'utf8');
    return tests ? text : withoutTests(text);
  };
  const fromRoot = [
    'CMakeLists.txt',
    ...readdirSync(path.join(nativeDir, 'cmake'))
      .filter((file) => file.endsWith('.cmake'))
      .map((file) => `cmake/${file}`),
  ].flatMap((file) =>
    [
      ...read(file).matchAll(
        /(?<=^|[\s(]|_DIR\}\/)((?:core|appkit|shim)\/[\w./*-]+\.(?:cpp|mm|swift|js|h))\b/gm,
      ),
    ].map(([, source]) => `native/${source}`),
  );
  const fromAppkit = [
    ...read('appkit/CMakeLists.txt').matchAll(/^\s+([\w-]+\.(?:mm|swift|cpp))\s*\)?\s*$/gm),
  ].map(([, source]) => `native/appkit/${source}`);
  return [...new Set([...fromRoot, ...fromAppkit])];
}

/** Whether `pattern`, a path with `*` for any one segment's characters, names a packed file. */
function shipped(files: Set<string>, pattern: string): boolean {
  if (!pattern.includes('*')) return files.has(pattern);
  const re = new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`);
  return [...files].some((file) => re.test(file));
}

describe('the published package', () => {
  const files = packed();

  it('has every source the build an app makes configures, with the core tests off', () => {
    const sources = configured(false);
    assert.ok(sources.includes('native/core/src/view-tree.cpp'), 'the core is found');
    assert.ok(sources.includes('native/appkit/main.mm'), 'the AppKit target is found');
    assert.ok(sources.includes('native/appkit/expo-ui.swift'), 'the Swift sources are found');
    const missing = sources.filter((source) => !shipped(files, source));
    assert.deepEqual(missing, []);
  });

  it('leaves out the core tests and their fakes, which only the repo builds', () => {
    const testsOnly = configured(true).filter((source) => !configured(false).includes(source));
    assert.ok(testsOnly.includes('native/core/testing/fake-backend.cpp'), 'the tests are found');
    assert.deepEqual(
      [...files].filter((file) => /^native\/(core\/test|appkit\/tests\/)/.test(file)),
      [],
    );
  });
});

describe('build.sh', () => {
  const build = path.join(nativeDir, 'scripts', 'build.sh');
  const reactNative = path.dirname(
    execFileSync('node', ['-p', "require.resolve('react-native/package.json')"], {
      cwd: packageDir,
      encoding: 'utf8',
    }).trim(),
  );

  it('builds without the core tests under --no-tests, so --test has none to run', () => {
    // The options are read, and checked against each other, before anything is fetched or built.
    const result = spawnSync('bash', [build, reactNative, '--no-tests', '--test'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--test needs the core tests, which --no-tests leaves out/);
  });
});
