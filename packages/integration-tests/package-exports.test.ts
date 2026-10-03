/**
 * The entry points an app writes, resolved by Metro's own resolver.
 *
 * `@ng-native/expo/battery` is a file at `src/battery.ts`, and the only thing connecting
 * the two is the `exports` map in the package's `package.json`. Nothing else in the suite would
 * notice if that stopped working: TypeScript resolves it, Node resolves it, and the failure would
 * appear for the first time on a device, as a red screen from the bundler.
 *
 * Adding an `exports` field is also the moment a package stops resolving anything not listed, so
 * this pins the negative too.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { resolve } = require('metro-resolver') as {
  resolve: (context: object, specifier: string, platform: string) => { filePath: string };
};

const root = path.resolve(import.meta.dirname, '../..');

/** What Metro's `PackageCache` hands the resolver: subpath exports are driven entirely by this. */
function packageForModule(absolutePath: string) {
  let dir =
    existsSync(absolutePath) && statSync(absolutePath).isDirectory()
      ? absolutePath
      : path.dirname(absolutePath);
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      return {
        rootPath: dir,
        packageJsonPath: manifest,
        packageJson: JSON.parse(readFileSync(manifest, 'utf8')),
        packageRelativePath: path.relative(dir, absolutePath),
      };
    }
    dir = path.dirname(dir);
  }
  return null;
}

/** Metro's resolution context, with the defaults `@expo/metro-config` ships. */
function context(from: string) {
  return {
    originModulePath: from,
    originModuleDir: path.dirname(from),
    // On by default in metro-config, and what makes an `exports` map load-bearing rather than
    // decorative. If an app ever turns it off, every deep entry point here stops resolving.
    unstable_enablePackageExports: true,
    unstable_conditionNames: new Set(['react-native', 'require', 'import']),
    unstable_conditionsByPlatform: { web: new Set(['browser']) },
    unstable_logWarning: () => {},
    mainFields: ['react-native', 'browser', 'main'],
    sourceExts: ['ts', 'tsx', 'js', 'json'],
    assetExts: new Set(['png']),
    nodeModulesPaths: [],
    extraNodeModules: null,
    resolveAsset: () => null,
    redirectModulePath: (p: string) => p,
    allowHaste: false,
    disableHierarchicalLookup: false,
    doesFileExist: (p: string) => existsSync(p) && statSync(p).isFile(),
    fileSystemLookup: (p: string) => {
      try {
        const stat = statSync(p);
        // Realpaths, as Metro's own lookup does: a workspace package is a symlink from
        // node_modules into packages/, and without following it every path here is the link.
        return { exists: true, type: stat.isDirectory() ? 'd' : 'f', realPath: realpathSync(p) };
      } catch {
        return { exists: false };
      }
    },
    getPackage: (p: string) => JSON.parse(readFileSync(p, 'utf8')),
    getPackageForModule: packageForModule,
    isAssetFile: () => false,
  };
}

// Resolved as the canary would: it is the example that declares both packages, and under a
// strict installer an app only resolves what it declares - which is the whole point of checking
// this against a real resolver rather than a hoisted node_modules that answers everything.
const from = path.join(root, 'examples/canary/src/app/app.ts');
const resolved = (specifier: string) =>
  path.relative(root, resolve(context(from), specifier, 'ios').filePath);

describe('the entry points Metro has to resolve', () => {
  it('maps a bare package to its barrel', () => {
    assert.equal(resolved('@ng-native/expo'), 'packages/expo/src/index.ts');
    assert.equal(resolved('@ng-native/components'), 'packages/components/src/index.ts');
    assert.equal(resolved('@ng-native/device'), 'packages/device/src/index.ts');
  });

  it('maps every per-module entry point into src, which is where the file is', () => {
    // One per Expo module, so importing haptics does not make an app install the video player.
    for (const name of [
      'apple-sign-in',
      'assets',
      'background-task',
      'battery',
      'brightness',
      'clipboard',
      'crypto',
      'database',
      'document-picker',
      'file-system',
      'fonts',
      'haptics',
      'image-editor',
      'keep-awake',
      'locale',
      'media-library',
      'network',
      'notifications',
      'orientation',
      'player',
      'screen-capture',
      'sensors',
      'splash-screen',
      'store',
      'store-review',
      'tracking',
      'updates',
    ]) {
      assert.equal(
        resolved(`@ng-native/expo/${name}`),
        `packages/expo/src/${name}.ts`,
        `@ng-native/expo/${name}`,
      );
    }

    // The three that reach an optional peer, and so stay out of the barrel.
    for (const name of ['animations', 'gestures', 'reanimated']) {
      assert.equal(resolved(`@ng-native/components/${name}`), `packages/components/src/${name}.ts`);
    }
  });

  it('gives a browser build its own entry where a device needs a native library', () => {
    // One import in an app, two graphs: React Native's on a device, a React-free one in a
    // browser, which could not load React Native's Flow source if it tried.
    const on = (platform: string, specifier: string) =>
      path.relative(root, resolve(context(from), specifier, platform).filePath);
    for (const name of ['animations', 'gestures', 'reanimated']) {
      const specifier = `@ng-native/components/${name}`;
      for (const platform of ['ios', 'android']) {
        assert.equal(on(platform, specifier), `packages/components/src/${name}.ts`, platform);
      }
      assert.equal(on('web', specifier), `packages/components/src/${name}-web.ts`);
      // Node has no `browser` condition either, so this suite's own imports see the native entry.
      assert.equal(
        path.relative(root, realpathSync(createRequire(from).resolve(specifier))),
        `packages/components/src/${name}.ts`,
      );
    }
  });

  it('fails a specifier that maps to nothing', () => {
    assert.throws(() => resolved('@ng-native/expo/nope'));
    // A file that exists but is not an entry point: the map is the whole public surface.
    assert.throws(() => resolved('@ng-native/expo/observed'));
  });

  it('warns rather than refuses when a path reaches past the map, unlike Node', async () => {
    // Worth knowing which way each tool errs. Metro logs and falls back to file-based
    // resolution, so `@ng-native/expo/src/battery.ts` would quietly work on a device;
    // Node and TypeScript both refuse it outright. The strict check therefore happens at
    // typecheck and test time, which is the right way round - but it does mean Metro alone
    // would never tell you an app was reaching past the entry points.
    const warnings: string[] = [];
    const lenient = { ...context(from), unstable_logWarning: (m: string) => warnings.push(m) };
    const past = resolve(lenient, '@ng-native/expo/src/battery.ts', 'ios');

    assert.match(path.relative(root, past.filePath), /packages\/expo\/src\/battery\.ts$/);
    assert.equal(warnings.length, 1, 'it says so, at least');

    // Node refuses it: `./src/battery.ts` is not in the map.
    //
    // Held in a variable because TypeScript refuses the specifier outright - writing it literally
    // fails `tsc` with TS2307, which is the third tool agreeing and is why this is safe to leave
    // as the one lenient link in the chain.
    const reachingPast = '@ng-native/expo/src/battery.ts';
    await assert.rejects(
      () => import(reachingPast),
      { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
      'Node refuses the same path',
    );
  });
});

describe('the entry points a published package has', () => {
  // The workspace resolves `exports`, which name source; npm gets `publishConfig.exports`, which
  // name the build. Nothing but this keeps the two in step: a subpath added to one only would work
  // in every test here and be missing, or dangling, for an app.
  const BUILT = [
    'fabric',
    'analog',
    'platform',
    'device',
    'router',
    'icons',
    'components',
    'expo',
    'web',
    'testing',
  ];
  const targets = (entry: unknown): string[] =>
    typeof entry === 'string' ? [entry] : Object.values(entry as object).flatMap(targets);

  for (const name of BUILT) {
    it(`@ng-native/${name} publishes the build of every source entry point`, () => {
      const manifest = JSON.parse(
        readFileSync(path.join(root, 'packages', name, 'package.json'), 'utf8'),
      );
      const published = manifest.publishConfig.exports;
      assert.deepEqual(Object.keys(published), Object.keys(manifest.exports));
      assert.deepEqual(manifest.files.includes('dist'), true);
      for (const [subpath, entry] of Object.entries(manifest.exports)) {
        const built = targets(published[subpath]);
        for (const source of targets(entry).filter((t) => t.startsWith('./src/'))) {
          const stem = source.replace(/^\.\/src\//, './dist/').replace(/\.(ts|css)$/, '');
          const expected = source.endsWith('.css') ? [`${stem}.css`] : [`${stem}.js`];
          for (const file of expected) assert.ok(built.includes(file), `${subpath}: ${file}`);
          if (source.endsWith('.ts'))
            assert.equal(
              (published[subpath] as { types?: string }).types?.startsWith('./dist/'),
              true,
              `${subpath}: types`,
            );
        }
      }
    });
  }
});
