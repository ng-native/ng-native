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
const { chunkOutsideServerRoot } = require('@ng-native/metro/config.cjs') as {
  chunkOutsideServerRoot(
    url: string,
    roots: {
      serverRoot: string;
      sourceExts: readonly string[];
      watchFolders: readonly string[];
    },
  ): string | undefined;
};

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
   * An integrated Nx workspace has no package-manager workspaces, so Expo's server root is the
   * app's directory, and a lazy route into a library beside it asked for a chunk Metro could not
   * find: "Could not load bundle" on the device.
   */
  describe('a lazy chunk from outside the server root', () => {
    const query = 'platform=ios&dev=true&lazy=true&modulesOnly=true&runModule=false';
    const workspace = () => {
      const root = mkdtempSync(path.join(tmpdir(), 'ng-native-chunks-'));
      for (const file of [
        'apps/mobile/src/main.ts',
        'apps/mobile/src/lazy.ts',
        'packages/settings/src/index.ts',
        'packages/settings/src/page.ios.ts',
      ]) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), 'export {};\n');
      }
      return root;
    };
    /** The config `withNxMetro(getDefaultConfig(app))` hands over in such a workspace. */
    const nxConfig = (root: string, serverRoot = path.join(root, 'apps/mobile')) => {
      const config = {
        ...base(),
        projectRoot: path.join(root, 'apps/mobile'),
        watchFolders: [path.join(root, 'apps'), path.join(root, 'packages')],
        server: {
          unstable_serverRoot: serverRoot,
          rewriteRequestUrl: (url: string) =>
            url.replace('/.expo/.virtual-metro-entry', '/src/main'),
        },
      };
      return withAngularNative(config) as MetroConfig & {
        server: { rewriteRequestUrl(url: string): string };
      };
    };
    /**
     * What the device asks for: the path Expo's serializer writes into the dependency map, from
     * the server root, which the URL normalizes.
     */
    const requestFor = (serverRoot: string, file: string) => {
      const relative = path.relative(serverRoot, file).replace(/\.ts$/, '');
      const url = new URL(`/${relative}.bundle?${query}`, 'http://localhost:8081');
      return url.pathname + url.search;
    };

    /** The file Metro bundles for a request, read as Metro reads it: `bundleEntry` first. */
    const entryOf = (serverRoot: string, url: string) => {
      const request = new URL(url, 'http://localhost:8081');
      const entry = request.searchParams.get('bundleEntry') ?? request.pathname.slice(1);
      return path.resolve(serverRoot, entry.replace(/\.(bundle|map)$/, ''));
    };

    it("is asked for by its path from the server root, which the URL's normalizing lost", () => {
      const root = workspace();
      try {
        const app = path.join(root, 'apps/mobile');
        const { rewriteRequestUrl } = nxConfig(root).server;
        const request = requestFor(app, path.join(root, 'packages/settings/src/index.ts'));
        assert.equal(request, `/packages/settings/src/index.bundle?${query}`, 'the ".." is gone');
        const rewritten = rewriteRequestUrl(request);
        assert.equal(
          entryOf(app, rewritten),
          path.join(root, 'packages/settings/src/index'),
          `Metro bundles the library's file for ${rewritten}`,
        );

        const page = rewriteRequestUrl(
          requestFor(app, path.join(root, 'packages/settings/src/page.ios.ts')),
        );
        assert.equal(
          entryOf(app, page),
          path.join(root, 'packages/settings/src/page.ios'),
          'a platform file keeps its platform',
        );
        const whole = rewriteRequestUrl(`http://localhost:8081${request}`);
        assert.ok(whole.startsWith('http://localhost:8081/'), 'a whole URL stays one');
        assert.equal(entryOf(app, whole), path.join(root, 'packages/settings/src/index'));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("works out again the path a chunk's own lazy import copied from its query", () => {
      const root = workspace();
      try {
        const app = path.join(root, 'apps/mobile');
        const { rewriteRequestUrl } = nxConfig(root).server;
        const parent = new URL(
          rewriteRequestUrl(requestFor(app, path.join(root, 'packages/settings/src/index.ts'))),
          'http://localhost:8081',
        ).search;
        const nested = `/packages/settings/src/page.ios.bundle${parent}`;
        assert.equal(
          entryOf(app, rewriteRequestUrl(nested)),
          path.join(root, 'packages/settings/src/page.ios'),
        );
        const back = `/src/lazy.bundle${parent}`;
        assert.equal(
          entryOf(app, rewriteRequestUrl(back)),
          path.join(app, 'src/lazy'),
          "a chunk back in the app, imported from the library's",
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('leaves a chunk under the server root, a missing one, the entry and the rewrite before it alone', () => {
      const root = workspace();
      try {
        const { rewriteRequestUrl } = nxConfig(root).server;
        const lazy = requestFor(
          path.join(root, 'apps/mobile'),
          path.join(root, 'apps/mobile/src/lazy.ts'),
        );
        assert.equal(rewriteRequestUrl(lazy), lazy);
        const missing = `/packages/settings/src/gone.bundle?${query}`;
        assert.equal(rewriteRequestUrl(missing), missing, 'Metro reports it as it always has');
        assert.equal(
          rewriteRequestUrl('/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true'),
          '/src/main.bundle?platform=ios&dev=true',
        );
        const library = requestFor(root, path.join(root, 'packages/settings/src/index.ts'));
        assert.equal(
          nxConfig(root, root).server.rewriteRequestUrl(library),
          library,
          'with the workspace as the server root, as in a pnpm or npm workspace',
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('wraps the rewrite once when applied twice', () => {
      const once = nxConfig('/ws');
      // The preset changes the config it is given, so the wrapper is read before it runs again.
      const wrapped = once.server.rewriteRequestUrl;
      const twice = withAngularNative(once) as typeof once;
      assert.equal(twice.server.rewriteRequestUrl, wrapped);
    });

    it("puts the library's path in a source map request too, and keeps the URL's hash", () => {
      const root = workspace();
      try {
        const roots = {
          serverRoot: path.join(root, 'apps/mobile'),
          sourceExts: ['ts'],
          watchFolders: [root],
        };
        const map = chunkOutsideServerRoot(
          `/packages/settings/src/index.map?${query}#line`,
          roots,
        )!;
        const request = new URL(map, 'http://localhost:8081');
        assert.equal(request.pathname, '/packages/settings/src/index.map');
        assert.equal(
          request.searchParams.get('bundleEntry'),
          '../../packages/settings/src/index.map',
        );
        assert.equal(request.hash, '#line');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('finds a file whose name the URL percent-encoded', () => {
      const root = workspace();
      try {
        writeFileSync(path.join(root, 'packages/settings/src/two words.ts'), 'export {};\n');
        const url = chunkOutsideServerRoot(`/packages/settings/src/two%20words.bundle?${query}`, {
          serverRoot: path.join(root, 'apps/mobile'),
          sourceExts: ['ts'],
          watchFolders: [root],
        })!;
        assert.equal(
          new URL(url, 'http://localhost:8081').searchParams.get('bundleEntry'),
          '../../packages/settings/src/two words.bundle',
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    /**
     * The URL keeps a `..` it has percent-encoded, slashes and all, and decoding it would send the
     * lookup out of the directory it climbed to. The dev server answers anyone on the network.
     */
    it('leaves alone a request whose decoded name climbs out, or starts at a root', () => {
      const root = mkdtempSync(path.join(tmpdir(), 'ng-native-chunks-'));
      try {
        const workspace = path.join(root, 'workspace');
        mkdirSync(path.join(workspace, 'apps/mobile'), { recursive: true });
        mkdirSync(path.join(root, 'elsewhere'), { recursive: true });
        writeFileSync(path.join(root, 'elsewhere/secret.ts'), 'export {};\n');
        const roots = {
          serverRoot: path.join(workspace, 'apps/mobile'),
          sourceExts: ['ts'],
          watchFolders: [root],
        };
        for (const name of [
          '..%2Felsewhere%2Fsecret',
          '%2E%2E%2Felsewhere%2Fsecret',
          'apps%2F..%2F..%2Felsewhere%2Fsecret',
          '%2F..%2Felsewhere%2Fsecret',
          '..%5Celsewhere%5Csecret',
          'C%3A%2Felsewhere%2Fsecret',
          '%E0%A4%A',
        ]) {
          const request = `/${name}.bundle?${query}`;
          assert.equal(chunkOutsideServerRoot(request, roots), undefined, request);
        }
        const inherited = `/..%2Felsewhere%2Fsecret.bundle?${query}&bundleEntry=../x.bundle`;
        assert.equal(
          chunkOutsideServerRoot(inherited, roots),
          `/..%2Felsewhere%2Fsecret.bundle?${query}`,
          'an inherited path is dropped, as for a chunk that is not there',
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    /**
     * Each directory above the server root is searched, up to the root of the disk, but Metro
     * bundles only files it watches. A file found anywhere else would only tell the network it is
     * there, so the search ends at the watch folders.
     */
    it('looks for a chunk only in the server root and the watch folders', () => {
      const root = mkdtempSync(path.join(tmpdir(), 'ng-native-chunks-'));
      try {
        const workspace = path.join(root, 'workspace');
        for (const file of ['apps/mobile/src/main.ts', 'packages/settings/src/index.ts']) {
          mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
          writeFileSync(path.join(workspace, file), 'export {};\n');
        }
        mkdirSync(path.join(root, 'private'), { recursive: true });
        writeFileSync(path.join(root, 'private/config.ts'), 'export {};\n');
        const roots = {
          serverRoot: path.join(workspace, 'apps/mobile'),
          sourceExts: ['ts'],
          watchFolders: [workspace],
        };
        const outside = `/private/config.bundle?${query}`;
        assert.equal(chunkOutsideServerRoot(outside, roots), undefined, 'above the workspace');
        const library = chunkOutsideServerRoot(
          `/packages/settings/src/index.bundle?${query}`,
          roots,
        )!;
        assert.equal(
          new URL(library, 'http://localhost:8081').searchParams.get('bundleEntry'),
          '../../packages/settings/src/index.bundle',
          'in the workspace, which Metro watches',
        );

        const { rewriteRequestUrl } = nxConfig(workspace).server;
        assert.equal(rewriteRequestUrl(outside), outside, "with the preset, Nx's watch folders");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('answers nothing for a request that is not a lazy chunk', () => {
      const root = workspace();
      try {
        const roots = {
          serverRoot: path.join(root, 'apps/mobile'),
          sourceExts: ['ts'],
          watchFolders: [root],
        };
        const eager = '/packages/settings/src/index.bundle?platform=ios&dev=true';
        assert.equal(chunkOutsideServerRoot(eager, roots), undefined, 'not modulesOnly');
        assert.equal(chunkOutsideServerRoot(`/status?${query}`, roots), undefined, 'not a bundle');
        assert.equal(
          chunkOutsideServerRoot(`/assets/icon.png?${query}`, roots),
          undefined,
          'an asset',
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('drops an inherited path that leads to no file, rather than send Metro after it', () => {
      const root = workspace();
      try {
        const inherited = `/packages/settings/src/gone.bundle?${query}&bundleEntry=../../packages/settings/src/index.bundle`;
        const url = chunkOutsideServerRoot(inherited, {
          serverRoot: path.join(root, 'apps/mobile'),
          sourceExts: ['ts'],
          watchFolders: [root],
        });
        assert.equal(url, `/packages/settings/src/gone.bundle?${query}`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('is installed with no rewrite of its own before it, from the project root', () => {
      const root = workspace();
      try {
        const app = path.join(root, 'apps/mobile');
        const config = withAngularNative(
          { ...base(), projectRoot: app },
          { workspaceRoot: root },
        ) as MetroConfig & {
          server: { rewriteRequestUrl(url: string): string };
        };
        const rewritten = config.server.rewriteRequestUrl(
          requestFor(app, path.join(root, 'packages/settings/src/index.ts')),
        );
        assert.equal(entryOf(app, rewritten), path.join(root, 'packages/settings/src/index'));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
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

describe("a library's component CSS", () => {
  const EXPO = '/app/node_modules/@expo/metro-config/build/transform-worker/transform-worker.js';

  it("records the packages on the transformer config, and in Metro's cacheVersion", () => {
    const config = base();
    config.transformerPath = EXPO;
    withAngularNative(config, { libraryStyles: ['x-ui', '@acme/ui', 'x-ui'] });
    assert.deepEqual(
      (config.transformer as { angularNativeLibraryStyles?: string[] }).angularNativeLibraryStyles,
      ['x-ui', '@acme/ui'],
    );
    // Sorted, so the order the app wrote them in is not a reason to start the cache afresh.
    assert.match(
      (config.transformer as { cacheVersion?: string }).cacheVersion!,
      /library-styles-@acme\/ui,x-ui/,
    );
  });

  it('records nothing when the option is not given, so every library is styled', () => {
    const config = base();
    config.transformerPath = EXPO;
    withAngularNative(config, {});
    assert.equal('angularNativeLibraryStyles' in config.transformer, false);
    assert.equal(process.env['ANGULAR_NATIVE_LIBRARY_STYLES'], undefined);
    assert.doesNotMatch(
      (config.transformer as { cacheVersion?: string }).cacheVersion!,
      /library-styles/,
    );
  });

  it('records an empty list for `false` and for no names, which styles no library', () => {
    for (const libraryStyles of [false, []] as const) {
      const config = base();
      config.transformerPath = EXPO;
      try {
        withAngularNative(config, { libraryStyles: libraryStyles as never });
        assert.deepEqual(
          (config.transformer as { angularNativeLibraryStyles?: string[] })
            .angularNativeLibraryStyles,
          [],
        );
        assert.equal(process.env['ANGULAR_NATIVE_LIBRARY_STYLES'], '');
        assert.match(
          (config.transformer as { cacheVersion?: string }).cacheVersion!,
          /library-styles-none/,
        );
      } finally {
        delete process.env['ANGULAR_NATIVE_LIBRARY_STYLES'];
      }
    }
  });

  it('refuses a list that is not package names, rather than matching nothing in silence', () => {
    for (const libraryStyles of ['@acme/ui', [''], [1], [{ name: '@acme/ui' }]]) {
      const config = base();
      config.transformerPath = EXPO;
      assert.throws(
        () => withAngularNative(config, { libraryStyles: libraryStyles as string[] }),
        /libraryStyles must be a list of npm package names, or false/,
      );
    }
  });

  it('refuses a name no npm package can have, saying what to write instead', () => {
    const refused: [string, RegExp][] = [
      ['@acme/ui/button', /'@acme\/ui\/button' is an entry point of '@acme\/ui'.*name '@acme\/ui'/],
      ['acme-ui/button', /'acme-ui\/button' is an entry point of 'acme-ui'.*name 'acme-ui'/],
      [' @acme/ui', /' @acme\/ui' has white space/],
      ['@acme/ui ', /'@acme\/ui ' has white space/],
      ['@ACME/ui', /'@ACME\/ui' has capital letters.*'@acme\/ui'/],
      ['./libs/ui', /'\.\/libs\/ui' is a path/],
      ['/libs/ui', /'\/libs\/ui' is a path/],
      ['@acme', /'@acme' is a scope/],
    ];
    for (const [name, message] of refused) {
      const config = base();
      config.transformerPath = EXPO;
      assert.throws(() => withAngularNative(config, { libraryStyles: [name] }), message, name);
    }
    for (const name of ['acme-ui', '@acme/ui', '@a.b/c-d_e', 'x~y']) {
      const config = base();
      config.transformerPath = EXPO;
      withAngularNative(config, { libraryStyles: [name] });
    }
  });

  it("refuses the option in front of a transform worker that is not Expo's, which it cannot reach", () => {
    const config = base();
    config.transformerPath = '/app/my-worker.js';
    assert.throws(
      () => withAngularNative(config, { libraryStyles: ['@acme/ui'] }),
      /libraryStyles needs this preset in front of Expo's transform worker.*my-worker\.js/,
    );
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
