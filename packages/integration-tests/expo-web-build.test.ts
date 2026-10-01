/**
 * `@ng-native/expo` in a browser app, through `ngNativeWeb()`: Vite's own build and dependency
 * pre-bundle over every entry point, compiled and installed the way an app gets the package.
 *
 * Each service reaches its Expo module through a `require` inside a `catch`, and the
 * documentation says the service is inert on the web. A bundler resolves that `require` all the
 * same, so the package has to come through the build and the pre-bundle in both installs an app
 * has: no Expo at all, and Expo installed for a native app beside the web one.
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

const require = createRequire(import.meta.url);
const packageDir = (name: string) => path.dirname(require.resolve(`${name}/package.json`));
const expoSource = fileURLToPath(new URL('../expo/', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(expoSource, 'package.json'), 'utf8'));
const entryPoints = Object.keys(manifest.exports as Record<string, unknown>)
  .filter((key) => key !== './package.json')
  .map((key) => `@ng-native/expo${key.slice(1)}`);

/** What `Battery`'s source answers with no battery to read. */
const INERT = { level: null, state: null, saving: null };

interface WithBattery {
  Battery: { SOURCE: { ɵprov: { factory(): unknown } } };
}

/**
 * An app whose `main.js` imports every entry point of `@ng-native/expo`, compiled with `ngc` as
 * the package publishes it, beside a React Native that throws when it is evaluated.
 */
function app(withExpo: boolean): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ng-native-expo-web-')));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const link = (name: string) => {
    mkdirSync(path.dirname(path.join(root, 'node_modules', name)), { recursive: true });
    symlinkSync(realpathSync(packageDir(name)), path.join(root, 'node_modules', name), 'dir');
  };

  // The package's own build, into the app rather than into `packages/expo/dist`.
  const ngc = path.join(packageDir('@angular/compiler-cli'), 'bundles/src/bin/ngc.js');
  const outDir = path.join(root, 'node_modules/@ng-native/expo/dist');
  execFileSync(process.execPath, [ngc, '-p', 'tsconfig.build.json', '--outDir', outDir], {
    cwd: expoSource,
    stdio: 'pipe',
  });
  write(
    'node_modules/@ng-native/expo/package.json',
    JSON.stringify({ name: manifest.name, type: 'module', ...manifest.publishConfig }),
  );
  link('@angular/core');
  link('@ng-native/fabric');
  if (withExpo) for (const name of ['expo', 'expo-battery']) link(name);
  write(
    'node_modules/react-native/package.json',
    JSON.stringify({ name: 'react-native', main: 'index.js' }),
  );
  write('node_modules/react-native/index.js', "throw new Error('React Native in a browser');\n");
  write(
    'main.js',
    entryPoints.map((entry, i) => `export * as entry${i} from '${entry}';\n`).join('') +
      "export { Battery } from '@ng-native/expo/battery';\n",
  );
  return root;
}

/** Imports a module Vite wrote, in Node, which has no `require` in an ES module either. */
const evaluate = async <T>(file: string): Promise<T> =>
  import(`${pathToFileURL(file).href}?${Date.now()}`);

for (const withExpo of [false, true]) {
  describe(`@ng-native/expo through Vite, ${withExpo ? 'with' : 'without'} Expo installed`, () => {
    let root: string;
    before(() => (root = app(withExpo)));
    after(() => rmSync(root, { recursive: true, force: true }));

    const shared = () => ({ root, configFile: false as const, logLevel: 'silent' as const });

    it('builds, and a service is inert', async () => {
      await build({
        ...shared(),
        plugins: ngNativeWeb(),
        build: {
          outDir: 'build',
          minify: false,
          lib: { entry: 'main.js', formats: ['es'], fileName: 'main' },
        },
      });
      const { Battery } = await evaluate<WithBattery>(path.join(root, 'build/main.mjs'));
      assert.deepEqual(Battery.SOURCE.ɵprov.factory(), INERT);
    });

    it('pre-bundles for the dev server, and a service is inert', async () => {
      const resolved = await resolveConfig(
        { ...shared(), plugins: ngNativeWeb(), optimizeDeps: { include: entryPoints } },
        'serve',
      );
      const { optimized } = await optimizeDeps(resolved, true);
      for (const entry of entryPoints) await evaluate(optimized[entry]!.file);
      const { Battery } = await evaluate<WithBattery>(optimized['@ng-native/expo/battery']!.file);
      assert.deepEqual(Battery.SOURCE.ɵprov.factory(), INERT);
    });
  });
}
