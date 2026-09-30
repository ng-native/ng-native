/**
 * The Metro preset.
 *
 * Setting a Metro config up by hand is where this framework is easiest to get subtly wrong: miss
 * the transformer and nothing Angular compiles, miss a source extension and external templates
 * stop invalidating, miss a polyfill and a release build runs every dev-mode assertion or
 * `animate.leave` silently does nothing. The preset is what makes those unforgettable, so it is
 * worth a test of its own.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { withAngularNative } = require('@ng-native/metro/config.cjs');

type Resolve = (context: { resolveRequest: Resolve }, name: string, platform: string) => unknown;

interface MetroConfig {
  projectRoot?: string;
  watchFolders?: string[];
  transformerPath?: string;
  transformer: { babelTransformerPath?: string; angularNativeUpstreamTransformer?: string };
  resolver: {
    sourceExts: string[];
    assetExts?: string[];
    nodeModulesPaths?: string[];
    resolveRequest?: Resolve;
    unstable_conditionNames?: string[];
  };
  serializer: { getPolyfills(options: unknown): string[] };
}

/** What `getDefaultConfig` hands over, reduced to the parts the preset touches. */
const base = (): MetroConfig => ({
  projectRoot: '/app',
  transformer: {},
  resolver: { sourceExts: ['ts', 'tsx', 'js'] },
  serializer: { getPolyfills: () => ['/rn/polyfill.js'] },
});

describe('the Metro preset', () => {
  it('installs the Angular transformer', () => {
    const config = withAngularNative(base()) as MetroConfig;
    assert.match(config.transformer.babelTransformerPath!, /transformer\.cjs$/);
  });

  it('adds the extensions external templates and stylesheets need', () => {
    const config = withAngularNative(base()) as MetroConfig;
    for (const ext of ['html', 'css', 'scss']) {
      assert.ok(config.resolver.sourceExts.includes(ext), `${ext} is resolvable`);
    }
    assert.ok(config.resolver.sourceExts.includes('ts'), 'and what was there already is kept');
  });

  it("takes html back from Expo's asset extensions", () => {
    // Metro checks assets first, so a template listed there is bundled as an asset record our
    // transformer never sees, and its edits never reach the component.
    const config = base();
    config.resolver.assetExts = ['png', 'html'];
    const out = withAngularNative(config) as MetroConfig;
    assert.deepEqual(out.resolver.assetExts, ['png']);
  });

  it('keeps the polyfills React Native ships and adds ours', () => {
    const config = withAngularNative(base()) as MetroConfig;
    const polyfills = config.serializer.getPolyfills({});

    assert.equal(polyfills[0], '/rn/polyfill.js', 'React Native still goes first');
    assert.ok(
      polyfills.some((p) => p.endsWith('ng-dev-mode.js')),
      'without it a release bundle runs every dev-mode assertion',
    );
    assert.ok(
      polyfills.some((p) => p.endsWith('animation-globals.js')),
      'without it animate.enter and animate.leave are silently no-ops',
    );
    assert.ok(
      polyfills.some((p) => p.endsWith('finalization-registry.js')),
      'without it Angular 22.2 throws on Hermes before the app registers',
    );
  });

  /**
   * Angular's dev build and its i18n runtime test `node instanceof Node`, and the only nodes that
   * reach them are the engine's. The stand-in must say yes to those and no to everything else:
   * it is a global, so an app's own code and its test runner's matchers ask it too, and Vitest's
   * `toContain` treats anything that is a `Node` as a DOM element.
   */
  describe('the Node stand-in', () => {
    const load = () => {
      const file = require.resolve('@ng-native/metro/polyfills/animation-globals.js');
      const context = vm.createContext({ setTimeout, clearTimeout });
      vm.runInContext(readFileSync(file, 'utf8'), context);
      return context as { Node: { new (): object } };
    };

    it('is not what an array or a plain object is an instance of', () => {
      const { Node } = load();
      assert.equal([] instanceof Node, false);
      assert.equal({} instanceof Node, false);
    });

    it('is what an engine node is an instance of', async () => {
      const { Node } = load();
      const { Engine } = await import('@ng-native/fabric');
      const { createFakeFabric } = await import('@ng-native/testing');
      const engine = new Engine(createFakeFabric(), 1);
      assert.equal(engine.createElement('view') instanceof Node, true);
      assert.equal(engine.createText('hi') instanceof Node, true);
      assert.equal(engine.createAnchor() instanceof Node, true);
    });
  });

  /**
   * Angular 22.2 builds a `FinalizationRegistry` when `@angular/core` is first evaluated, for its
   * signal debug graph, and Hermes has `WeakRef` but no `FinalizationRegistry`. Without a stand-in
   * the bundle throws before `main` is registered, on both platforms, in release builds too.
   */
  describe('the FinalizationRegistry stand-in', () => {
    const load = (sandbox: Record<string, unknown>) => {
      const file = require.resolve('@ng-native/metro/polyfills/finalization-registry.js');
      const context = vm.createContext({});
      // A fresh context has the language's own; take it away, as Hermes does, unless one is given.
      vm.runInContext('delete globalThis.FinalizationRegistry', context);
      Object.assign(context, sandbox);
      vm.runInContext(readFileSync(file, 'utf8'), context);
      return context as { FinalizationRegistry?: new (cleanup: () => void) => object };
    };

    it('gives Hermes one that accepts what Angular registers', () => {
      const context = load({});
      const Registry = context.FinalizationRegistry!;
      assert.equal(typeof Registry, 'function');
      const registry = new Registry(() => {}) as {
        register(target: object, held: unknown, token?: object): void;
        unregister(token: object): boolean;
      };
      const target = {};
      assert.equal(registry.register(target, { id: '1' }, target), undefined);
      assert.equal(registry.unregister(target), false);
    });

    it('leaves a real one alone', () => {
      class Real {}
      assert.equal(load({ FinalizationRegistry: Real }).FinalizationRegistry, Real);
    });
  });

  /**
   * A library in Nx's TypeScript preset writes `export * from './lib/ui.js'` for `./lib/ui.ts`,
   * the way TypeScript's own module resolution expects. tsc and Vitest follow it; Metro looks for
   * a `.js` file that does not exist, and the app could not import the library at all.
   */
  describe('a relative .js import of a .ts file', () => {
    /** Metro's resolver, as it would answer for a library whose only file is `lib/ui.ts`. */
    const metro: Resolve = (_context, name) => {
      if (name === './lib/ui' || name === './lib/ui.ts')
        return { type: 'sourceFile', filePath: '/lib/ui.ts' };
      throw new Error(`Unable to resolve ${name}`);
    };
    const resolve = (config: MetroConfig, name: string) =>
      config.resolver.resolveRequest!({ resolveRequest: metro }, name, 'ios');

    it('resolves to the .ts file', () => {
      const config = withAngularNative(base()) as MetroConfig;
      assert.deepEqual(resolve(config, './lib/ui.js'), {
        type: 'sourceFile',
        filePath: '/lib/ui.ts',
      });
    });

    it('goes through a resolver something else installed first, as withNxMetro does', () => {
      const config = base();
      const asked: string[] = [];
      config.resolver.resolveRequest = (context, name, platform) => {
        asked.push(name);
        return metro(context, name, platform);
      };
      const wrapped = withAngularNative(config) as MetroConfig;
      assert.deepEqual(resolve(wrapped, './lib/ui.js'), {
        type: 'sourceFile',
        filePath: '/lib/ui.ts',
      });
      assert.deepEqual(asked, ['./lib/ui.js', './lib/ui']);
    });

    it('still fails for a .js file that is not there as .ts either, and for a package name', () => {
      const config = withAngularNative(base()) as MetroConfig;
      assert.throws(
        () => resolve(config, './lib/missing.js'),
        /Unable to resolve \.\/lib\/missing\.js/,
      );
      assert.throws(() => resolve(config, 'some-package.js'), /Unable to resolve some-package\.js/);
    });
  });

  /**
   * babel-preset-expo writes `@babel/runtime` imports into every file it transforms, those in
   * packages that never declared it included, for the version Expo read from the app's project.
   * Looked up from such a file under pnpm, the first copy found is the one in
   * `node_modules/.pnpm/node_modules`, which an install before the app's pin can leave on Babel 8.
   */
  describe("an @babel/runtime import Expo's Babel preset wrote", () => {
    type Context = { resolveRequest: Resolve; originModulePath?: string };
    const origin = '/ws/node_modules/.pnpm/react-native@0.86.3/node_modules/react-native/index.js';
    /** Metro's resolver, in a workspace whose hidden hoist holds Babel 8's runtime. */
    const metro: Resolve = (context, name) => {
      const from = (context as Context).originModulePath!;
      if (!name.startsWith('@babel/runtime')) throw new Error(`Unable to resolve ${name}`);
      const copy = from.includes('/.pnpm/') ? '@babel+runtime@8.0.0' : '@babel+runtime@7.29.7';
      return { type: 'sourceFile', filePath: `/ws/node_modules/.pnpm/${copy}/${name}.js` };
    };
    const resolve = (name: string, resolveRequest = metro) => {
      const config = withAngularNative({ ...base(), projectRoot: '/ws/apps/mobile' });
      return (config as MetroConfig).resolver.resolveRequest!(
        { resolveRequest, originModulePath: origin } as Context,
        name,
        'ios',
      );
    };

    it("resolves to the copy the app's project resolves, wherever the import is", () => {
      assert.deepEqual(resolve('@babel/runtime/helpers/interopRequireDefault'), {
        type: 'sourceFile',
        filePath:
          '/ws/node_modules/.pnpm/@babel+runtime@7.29.7/@babel/runtime/helpers/interopRequireDefault.js',
      });
    });

    it('falls back to where the import is when the project resolves no copy', () => {
      const onlyFromNodeModules: Resolve = (context, name) => {
        if (!(context as Context).originModulePath!.includes('/node_modules/'))
          throw new Error(`Unable to resolve ${name}`);
        return metro(context, name, 'ios');
      };
      assert.deepEqual(resolve('@babel/runtime/regenerator', onlyFromNodeModules), {
        type: 'sourceFile',
        filePath: '/ws/node_modules/.pnpm/@babel+runtime@8.0.0/@babel/runtime/regenerator.js',
      });
    });

    it('leaves every other package resolving from where the import is', () => {
      const origins: string[] = [];
      const record: Resolve = (context) => {
        origins.push((context as Context).originModulePath!);
        return { type: 'sourceFile', filePath: '/x.js' };
      };
      resolve('@babel/runtime-corejs3/helpers/x', record);
      resolve('react', record);
      assert.deepEqual(origins, [origin, origin]);
    });
  });

  /**
   * pnpm installs a package once per set of peers it resolves. A workspace library that lists
   * `@ng-native/components` but not the app's `@babel/core` gets react-native's Babel peer at 8
   * where the app has 7, so both, and every package peering on them, land in a second directory
   * at the same version. Looked up from the library, Metro bundled that second copy: two
   * component registries and a second React Native.
   */
  describe('a package a workspace library installed in a second peer context', () => {
    type Context = {
      resolveRequest: Resolve;
      originModulePath: string;
      getPackage(packageJsonPath: string): { name: string; version: string } | null;
      getPackageForModule(file: string): {
        packageJson: { name: string; version: string };
        rootPath: string;
      } | null;
    };
    const store = '/ws/node_modules/.pnpm';
    const appCopy = `${store}/@ng-native+components@0.1.2_babel7/node_modules/@ng-native/components`;
    const libCopy = `${store}/@ng-native+components@0.1.2_babel8/node_modules/@ng-native/components`;
    const appNative = `${store}/react-native@0.86.3_babel7/node_modules/react-native`;
    const libNative = `${store}/react-native@0.86.3_babel8/node_modules/react-native`;
    const library = '/ws/libs/mobile-ui/button/src/index.ts';
    const versions: Record<string, string> = {
      [appCopy]: '0.1.2',
      [libCopy]: '0.1.2',
      [appNative]: '0.86.3',
      [libNative]: '0.86.3',
    };
    /** Metro's resolver: the app's project reaches the app's copies, anything else the library's. */
    const metro: Resolve = (context, name) => {
      const from = (context as Context).originModulePath;
      const ofApp = from.startsWith('/ws/apps/mobile/') || from.startsWith(appCopy);
      const [components, native] = ofApp ? [appCopy, appNative] : [libCopy, libNative];
      const root = name.startsWith('react-native') ? native : components;
      const subpath = name.replace(/^(@ng-native\/components|react-native)\/?/, '') || 'index';
      return { type: 'sourceFile', filePath: `${root}/src/${subpath}.ts` };
    };
    /** A workspace package, linked: its real path has no `node_modules` in it. */
    const linked = '/ws/packages/components';
    const packageAt = (root: string) => ({
      name: root === linked ? '@ng-native/components' : root.split('/node_modules/').pop()!,
      version: versions[root]!,
    });
    const getPackage = (file: string) => {
      const root = path.dirname(file);
      return root in versions ? packageAt(root) : null;
    };
    const getPackageForModule = (file: string) => {
      const root = Object.keys(versions).find((dir) => file.startsWith(`${dir}/`));
      return root ? { packageJson: packageAt(root), rootPath: root } : null;
    };
    const resolve = (name: string, originModulePath = library, resolveRequest = metro) => {
      const config = withAngularNative({ ...base(), projectRoot: '/ws/apps/mobile' });
      return (config as MetroConfig).resolver.resolveRequest!(
        { resolveRequest, originModulePath, getPackage, getPackageForModule } as Context,
        name,
        'ios',
      );
    };

    it("resolves to the app's copy from the library", () => {
      assert.deepEqual(resolve('@ng-native/components'), {
        type: 'sourceFile',
        filePath: `${appCopy}/src/index.ts`,
      });
    });

    it("resolves a subpath to the app's copy too", () => {
      assert.deepEqual(resolve('@ng-native/components/gestures'), {
        type: 'sourceFile',
        filePath: `${appCopy}/src/gestures.ts`,
      });
    });

    it("resolves to the app's copy from inside a package in the library's context", () => {
      assert.deepEqual(resolve('react-native', `${libCopy}/src/index.ts`), {
        type: 'sourceFile',
        filePath: `${appNative}/src/index.ts`,
      });
    });

    it('keeps the copy a library resolves at a version of its own', () => {
      versions[libCopy] = '0.2.0';
      try {
        assert.deepEqual(resolve('@ng-native/components'), {
          type: 'sourceFile',
          filePath: `${libCopy}/src/index.ts`,
        });
      } finally {
        versions[libCopy] = '0.1.2';
      }
    });

    it("resolves to the app's copy when the app's is a linked workspace package", () => {
      versions[linked] = '0.1.2';
      const appLinked: Resolve = (context, name, platform) =>
        (context as Context).originModulePath.startsWith('/ws/apps/mobile/')
          ? { type: 'sourceFile', filePath: `${linked}/src/index.ts` }
          : metro(context, name, platform);
      try {
        assert.deepEqual(resolve('@ng-native/components', library, appLinked), {
          type: 'sourceFile',
          filePath: `${linked}/src/index.ts`,
        });
      } finally {
        delete versions[linked];
      }
    });

    it('warns once when a library brings a second version of an @ng-native package', () => {
      const other = `${store}/@ng-native+device@0.1.1/node_modules/@ng-native/device`;
      const device: Resolve = (context) => ({
        type: 'sourceFile',
        filePath: (context as Context).originModulePath.startsWith('/ws/apps/mobile/')
          ? `${store}/@ng-native+device@0.1.2/node_modules/@ng-native/device/src/index.ts`
          : `${other}/src/index.ts`,
      });
      const warnings: string[] = [];
      const warn = console.warn;
      console.warn = (message: string) => void warnings.push(message);
      try {
        resolve('@ng-native/device', '/ws/apps/mobile/src/main.ts', device);
        assert.deepEqual(warnings, []);
        resolve('@ng-native/device', library, device);
        resolve('@ng-native/device', library, device);
      } finally {
        console.warn = warn;
      }
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /@ng-native\/device.*\n.*device@0\.1\.2.*\n.*device@0\.1\.1/s);
    });

    it("warns once when the app's linked workspace package and a library's copy differ in version", () => {
      // The app links @ng-native/router from its source folder, whose real path has no
      // node_modules in it, and the library installed 0.1.1 from the registry.
      const source = '/ws/packages/router';
      const installed = `${store}/@ng-native+router@0.1.1/node_modules/@ng-native/router`;
      const manifests: Record<string, { name: string; version: string }> = {
        [source]: { name: '@ng-native/router', version: '0.2.0' },
        [installed]: { name: '@ng-native/router', version: '0.1.1' },
      };
      const router: Resolve = (context) => ({
        type: 'sourceFile',
        filePath: `${(context as Context).originModulePath.startsWith('/ws/apps/mobile/') ? source : installed}/src/index.ts`,
      });
      const config = withAngularNative({
        ...base(),
        projectRoot: '/ws/apps/mobile',
      }) as MetroConfig;
      const from = (originModulePath: string) =>
        config.resolver.resolveRequest!(
          {
            resolveRequest: router,
            originModulePath,
            getPackage: (file: string) => manifests[path.dirname(file)] ?? null,
            getPackageForModule: (file: string) => {
              const root = Object.keys(manifests).find((dir) => file.startsWith(`${dir}/`));
              return root ? { packageJson: manifests[root]!, rootPath: root } : null;
            },
          } as Context,
          '@ng-native/router',
          'ios',
        );
      const warnings: string[] = [];
      const warn = console.warn;
      console.warn = (message: string) => void warnings.push(message);
      try {
        from('/ws/apps/mobile/src/main.ts');
        from('/ws/apps/mobile/src/main.ts');
        assert.deepEqual(warnings, []);
        from(library);
        from(library);
      } finally {
        console.warn = warn;
      }
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /@ng-native\/router.*\n.*packages\/router\n.*router@0\.1\.1/s);
    });

    it('keeps the copy a library resolves when the app has none', () => {
      const appHasNone: Resolve = (context, name, platform) => {
        if ((context as Context).originModulePath.startsWith('/ws/apps/mobile/'))
          throw new Error(`Unable to resolve ${name}`);
        return metro(context, name, platform);
      };
      assert.deepEqual(resolve('@ng-native/components', library, appHasNone), {
        type: 'sourceFile',
        filePath: `${libCopy}/src/index.ts`,
      });
    });
  });

  /**
   * Two copies of Angular in one bundle fail far from their cause: a component compiled against
   * one asks the other's injector, and the device shows NG0203 at mount. A Metro cache left from
   * before an upgrade did exactly that. The preset says so where the developer is looking.
   */
  describe('two copies of @angular/core', () => {
    const at =
      (root: string): Resolve =>
      () => ({
        type: 'sourceFile',
        filePath: `${root}/node_modules/@angular/core/fesm2022/core.mjs`,
      });

    it('warns once, naming both, when a second copy resolves', () => {
      const config = withAngularNative(base()) as MetroConfig;
      const warnings: string[] = [];
      const warn = console.warn;
      console.warn = (message: string) => void warnings.push(message);
      try {
        const resolve = (root: string) =>
          config.resolver.resolveRequest!({ resolveRequest: at(root) }, '@angular/core', 'ios');
        resolve('/store/core@22.2.0');
        resolve('/store/core@22.2.0');
        assert.deepEqual(warnings, []);
        resolve('/store/core@22.1.5');
        resolve('/store/core@22.1.5');
      } finally {
        console.warn = warn;
      }
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /core@22\.2\.0.*\n.*core@22\.1\.5/s);
      assert.match(warnings[0]!, /--clear/);
    });
  });

  it("puts the installed Angular's version in Metro's cache key, so an upgrade starts afresh", () => {
    const config = withAngularNative(base()) as MetroConfig & {
      transformer: { cacheVersion?: string };
    };
    const { version } = require('@angular/core/package.json');
    assert.match(
      config.transformer.cacheVersion!,
      new RegExp(`angular-${version.replace(/\./g, '\\.')}`),
    );
  });

  it("puts the worklets Babel plugin's package in Metro's cache key, so installing it starts afresh", () => {
    // babel-preset-expo adds the plugin only when it resolves, and Metro's key knew nothing of
    // that, so files transformed before the install kept their worklets untransformed.
    const root = mkdtempSync(path.join(tmpdir(), 'ng-native-worklets-'));
    try {
      const key = () =>
        (
          withAngularNative({ ...base(), projectRoot: root }) as MetroConfig & {
            transformer: { cacheVersion?: string };
          }
        ).transformer.cacheVersion!;
      const before = key();
      assert.doesNotMatch(before, /react-native-worklets/);

      mkdirSync(path.join(root, 'node_modules/react-native-worklets'), { recursive: true });
      writeFileSync(
        path.join(root, 'node_modules/react-native-worklets/package.json'),
        JSON.stringify({ name: 'react-native-worklets', version: '0.6.1' }),
      );
      assert.match(key(), /react-native-worklets-0\.6\.1/);
      assert.notEqual(key(), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves with the app's tsconfig customConditions, as tsc does", () => {
    // Nx's TypeScript preset exports a library's source only under a custom condition named in
    // tsconfig; without it Metro took the dist entry, which is not built, and failed.
    const root = mkdtempSync(path.join(tmpdir(), 'ng-native-conditions-'));
    writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { customConditions: ['react-native', '@org/source'] } }),
    );
    try {
      const config = withAngularNative({ ...base(), projectRoot: root }) as MetroConfig;
      assert.deepEqual(config.resolver.unstable_conditionNames, ['@org/source']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads customConditions from a tsconfig with comments and trailing commas, as tsc does', () => {
    // tsconfig.json is JSON with comments. Read as plain JSON, one comment or trailing comma
    // dropped every condition without a word, and the library behind one failed to resolve.
    const root = mkdtempSync(path.join(tmpdir(), 'ng-native-conditions-'));
    writeFileSync(
      path.join(root, 'tsconfig.json'),
      [
        '{',
        '  // Nx writes the workspace conditions here.',
        '  "compilerOptions": {',
        '    /* a block comment, with a "string" and a // in it */',
        '    "paths": { "@org/*": ["libs/*"] },',
        '    "customConditions": ["react-native", "@org/source",],',
        '  },',
        '}',
      ].join('\n'),
    );
    try {
      const config = withAngularNative({ ...base(), projectRoot: root }) as MetroConfig;
      assert.deepEqual(config.resolver.unstable_conditionNames, ['@org/source']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('folds ngDevMode to false when it minifies, as the Angular CLI does for production', () => {
    // The release polyfill already sets it false at run time; folding it lets the minifier drop
    // every dev-mode branch too. On the canary that was 197 KB and 147 setClassMetadata calls.
    const config = {
      ...base(),
      transformer: {
        minifierPath: 'metro-minify-terser',
        minifierConfig: { compress: { reduce_funcs: false } },
      },
    };
    const out = withAngularNative(config) as {
      transformer: { minifierConfig: { compress: Record<string, unknown> } };
    };
    assert.deepEqual(out.transformer.minifierConfig.compress['global_defs'], { ngDevMode: false });
    assert.equal(
      out.transformer.minifierConfig.compress['reduce_funcs'],
      false,
      'and keeps the rest',
    );
  });

  it('leaves a minifier that is not terser alone', () => {
    const config = { ...base(), transformer: { minifierPath: 'metro-minify-esbuild' } };
    const out = withAngularNative(config) as { transformer: { minifierConfig?: unknown } };
    assert.equal(out.transformer.minifierConfig, undefined);
  });

  it('leaves any polyfill the app added in place', () => {
    const config = base();
    config.serializer.getPolyfills = () => ['/rn/polyfill.js', '/app/mine.js'];
    const polyfills = (withAngularNative(config) as MetroConfig).serializer.getPolyfills({});
    assert.ok(polyfills.includes('/app/mine.js'));
  });

  it('is idempotent, so applying it twice changes nothing', () => {
    const once = withAngularNative(base()) as MetroConfig;
    const twice = withAngularNative(withAngularNative(base())) as MetroConfig;
    assert.deepEqual(twice.resolver.sourceExts, once.resolver.sourceExts);
    assert.deepEqual(
      twice.serializer.getPolyfills({}),
      once.serializer.getPolyfills({}),
      'a polyfill added twice would be evaluated twice',
    );
  });

  /** Monorepo wiring is not something an app installing from npm should have to think about. */
  it('only touches watch folders when told where the workspace is', () => {
    assert.equal(withAngularNative(base()).watchFolders, undefined);

    const config = withAngularNative(base(), { workspaceRoot: '/work' }) as MetroConfig;
    assert.deepEqual(config.watchFolders, ['/work']);
    assert.deepEqual(config.resolver.nodeModulesPaths, ['/app/node_modules', '/work/node_modules']);
  });

  /**
   * Expo's worker empties every native stylesheet before any babel transformer sees it, so an
   * edited `styleUrl` would have nothing to carry its update to the device in.
   */
  describe("Expo's transform worker", () => {
    const tag = (name: string) => `module.exports = { transform: () => ${JSON.stringify(name)} };`;

    /** A stand-in for Expo's worker and the one it hands source files to, laid out as Expo's is. */
    function fakeExpo() {
      const root = mkdtempSync(path.join(tmpdir(), 'ng-native-worker-'));
      const dir = path.join(root, 'node_modules/@expo/metro-config/build/transform-worker');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'transform-worker.js'), tag('expo'));
      writeFileSync(path.join(dir, 'metro-transform-worker.js'), tag('babel'));
      return { root, worker: path.join(dir, 'transform-worker.js') };
    }

    it('is wrapped, so a native stylesheet in dev reaches our transformer', () => {
      const { root, worker } = fakeExpo();
      try {
        const config = withAngularNative({
          ...base(),
          projectRoot: root,
          transformerPath: worker,
        }) as MetroConfig;
        assert.match(config.transformerPath!, /transform-worker\.cjs$/);

        const ours = require(config.transformerPath!) as {
          transform(...args: unknown[]): unknown;
        };
        const run = (file: string, options: object) =>
          ours.transform(config.transformer, root, file, Buffer.from(''), options);

        assert.equal(run('/app/a.css', { dev: true, platform: 'ios' }), 'babel');
        assert.equal(run('/app/a.css', { dev: false, platform: 'ios' }), 'expo', 'release: empty');
        assert.equal(run('/app/a.css', { dev: true, platform: 'web' }), 'expo', "web is Expo's");
        assert.equal(run('/app/a.module.css', { dev: true, platform: 'ios' }), 'expo');
        assert.equal(run('/app/a.ts', { dev: true, platform: 'ios' }), 'expo');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('leaves a worker the app configured itself alone', () => {
      const config = withAngularNative({
        ...base(),
        transformerPath: '/app/my-worker.js',
      }) as MetroConfig;
      assert.equal(config.transformerPath, '/app/my-worker.js');
    });
  });
});

describe("the tsconfig's custom conditions", () => {
  it('adds each once, beside the conditions Metro already has, and never react-native', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'conditions-'));
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      '{ "compilerOptions": { "customConditions": ["source", "react-native", "app"] } }',
    );
    try {
      const config = base();
      config.projectRoot = dir;
      config.resolver.unstable_conditionNames = ['react-native', 'source'];
      withAngularNative(config);
      assert.deepEqual(config.resolver.unstable_conditionNames, ['react-native', 'source', 'app']);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
