/**
 * `@ng-native/components/reanimated` and `/gestures` in a browser app, through `ngNativeWeb()`:
 * Vite's own build and dependency pre-bundle, over the package compiled and installed the way an
 * app gets it.
 *
 * Both reach Reanimated and Gesture Handler on a device. A browser has neither, so the two entry
 * points have to come through the build and the pre-bundle in both installs an app has: neither
 * library installed, and both installed for a native app beside the web one. What they export
 * there is inert: the directives do nothing, and a shared value is a plain holder.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ngNativeWeb } from '@ng-native/web/vite';
import { build, optimizeDeps, resolveConfig } from 'vite';

const source = fileURLToPath(new URL('../components/', import.meta.url));
const require = createRequire(path.join(source, 'package.json'));
const packageDir = (name: string) => path.dirname(require.resolve(`${name}/package.json`));
const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
const entryPoints = ['@ng-native/components/reanimated', '@ng-native/components/gestures'];
const NATIVE = ['react-native-reanimated', 'react-native-worklets', 'react-native-gesture-handler'];

interface Exports {
  sharedValue<T>(initial: T): {
    value: T;
    get(): T;
    set(value: T | ((value: T) => T)): void;
    modify(modifier: (value: T) => T): void;
    addListener(id: number, listener: (value: T) => void): void;
    removeListener(id: number): void;
  };
  workletStyle(values: unknown[], updater: () => object): { values: unknown[] };
  WorkletStyle: unknown;
  WorkletScroll: unknown;
  NativeGesture: unknown;
  GestureRoot: unknown;
}

/**
 * Writes an app into `root` whose `main.js` imports both entry points of `@ng-native/components`,
 * compiled with `ngc` as the package publishes it, beside a React Native that throws when it is
 * evaluated.
 */
function app(root: string, withNative: boolean): void {
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const link = (name: string, dir = packageDir(name)) => {
    mkdirSync(path.dirname(path.join(root, 'node_modules', name)), { recursive: true });
    symlinkSync(realpathSync(dir), path.join(root, 'node_modules', name), 'dir');
  };

  const ngc = path.join(packageDir('@angular/compiler-cli'), 'bundles/src/bin/ngc.js');
  const outDir = path.join(root, 'node_modules/@ng-native/components/dist');
  execFileSync(process.execPath, [ngc, '-p', 'tsconfig.build.json', '--outDir', outDir], {
    cwd: source,
    stdio: 'pipe',
  });
  write(
    'node_modules/@ng-native/components/package.json',
    JSON.stringify({ name: manifest.name, type: 'module', ...manifest.publishConfig }),
  );
  link('@angular/core');
  link('@ng-native/fabric');
  link('@ng-native/device');
  if (withNative) {
    const reanimated = packageDir('react-native-reanimated');
    link('react-native-reanimated', reanimated);
    link(
      'react-native-worklets',
      path.dirname(createRequire(reanimated + '/').resolve('react-native-worklets/package.json')),
    );
    link('react-native-gesture-handler');
  }
  write(
    'node_modules/react-native/package.json',
    JSON.stringify({ name: 'react-native', main: 'index.js' }),
  );
  write('node_modules/react-native/index.js', "throw new Error('React Native in a browser');\n");
  write('main.js', entryPoints.map((entry) => `export * from '${entry}';\n`).join(''));
}

/** Imports a module Vite wrote, in Node, which has no `require` in an ES module either. */
const evaluate = async <T>(file: string): Promise<T> =>
  import(`${pathToFileURL(file).href}?${Date.now()}`);

function assertInert(exports: Exports): void {
  for (const name of ['WorkletStyle', 'WorkletScroll', 'NativeGesture', 'GestureRoot'] as const) {
    assert.equal(typeof exports[name], 'function', name);
  }
  // Reanimated's public surface outside a worklet, so code that drives a value still runs.
  const offset = exports.sharedValue(1);
  const heard: number[] = [];
  offset.addListener(1, (value) => heard.push(value));
  offset.value = 2;
  offset.set((value) => value + 1);
  offset.modify((value) => value * 2);
  offset.removeListener(1);
  offset.set(0);
  assert.equal(offset.get(), 0);
  assert.deepEqual(heard, [2, 3, 6]);
  assert.deepEqual(exports.workletStyle([offset], () => ({})).values, [offset]);
}

for (const withNative of [false, true]) {
  const installed = withNative ? 'with Reanimated and Gesture Handler' : 'with neither';
  describe(`@ng-native/components/reanimated and /gestures through Vite, ${installed}`, () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-components-web-')));
    before(() => app(root, withNative));
    after(() => rmSync(root, { recursive: true, force: true }));

    const shared = () => ({ root, configFile: false as const, logLevel: 'silent' as const });

    it('builds, and both entry points are inert', async () => {
      await build({
        ...shared(),
        plugins: ngNativeWeb(),
        build: {
          outDir: 'build',
          minify: false,
          lib: { entry: 'main.js', formats: ['es'], fileName: 'main' },
        },
      });
      assertInert(await evaluate<Exports>(path.join(root, 'build/main.mjs')));
    });

    it('pre-bundles for the dev server, and both entry points are inert', async () => {
      const resolved = await resolveConfig(
        { ...shared(), plugins: ngNativeWeb(), optimizeDeps: { include: entryPoints } },
        'serve',
      );
      const { optimized } = await optimizeDeps(resolved, true);
      const [reanimated, gestures] = await Promise.all(
        entryPoints.map((entry) => evaluate<Exports>(optimized[entry]!.file)),
      );
      assertInert({ ...reanimated!, ...gestures! });
    });
  });
}
