/**
 * The build side of the package: the libraries and the app's directories written for a browser,
 * named to the transformer, and the transformer's cache told of both.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';

const { aliasOf, withWebCompat, webCompat } = createRequire(import.meta.url)('../build.cjs') as {
  aliasOf(moduleName: string, importer: string | undefined): string | null;
  withWebCompat<T extends object>(
    config: T,
    options?: { libraries: string[]; sources?: unknown },
  ): T & { transformer: { cacheVersion: string }; resolver: { resolveRequest: Resolve } };
  webCompat(options?: { libraries: string[]; sources?: unknown }): {
    name: string;
    enforce: string;
    resolveId: ResolveId;
  };
};
type Context = { originModulePath: string; resolveRequest: Resolve };
type Resolve = (context: Context, moduleName: string, platform: string | null) => unknown;
type ResolveId = (
  this: { resolve(source: string, importer?: string, options?: object): Promise<unknown> },
  source: string,
  importer: string | undefined,
  options: object,
) => Promise<unknown>;

const LIBRARIES = 'ANGULAR_NATIVE_LIBRARY_BROWSER';
const SOURCES = 'ANGULAR_NATIVE_SOURCE_BROWSER';
const WEB = { libraries: ['@acme/web'] };

/** What each run leaves in the environment is taken back, and what was there put back. */
let before: Record<string, string | undefined> = {};
beforeEach(() => {
  before = { [LIBRARIES]: process.env[LIBRARIES], [SOURCES]: process.env[SOURCES] };
  delete process.env[LIBRARIES];
  delete process.env[SOURCES];
});
afterEach(() => {
  for (const [name, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("a library's sheets read as a browser reads them, asked for by the build side", () => {
  it('is asked of Metro, with a cache version that says so', () => {
    const config = withWebCompat(
      { transformer: { cacheVersion: 'app' } },
      { libraries: ['@b/web', '@a/web'] },
    );
    assert.equal(process.env[LIBRARIES], '@b/web,@a/web');
    // Named in the cache version: a library transformed before it was named is cached without.
    assert.equal(config.transformer.cacheVersion, 'app-library-browser-@a/web,@b/web');
    // And Metro's own, which every transformer's cache key starts from, a custom one's included.
    assert.match(
      (config as { cacheVersion?: string }).cacheVersion ?? '',
      /library-browser-@a\/web,@b\/web/,
    );
  });

  it('has Metro give the window its listeners before any module runs', () => {
    const first = () => ['/rn/console.js'];
    const config = withWebCompat({ serializer: { getPolyfills: first } }, WEB) as unknown as {
      serializer: { getPolyfills(options: unknown): string[] };
    };
    const polyfills = config.serializer.getPolyfills({ platform: 'ios' });
    assert.equal(polyfills[0], '/rn/console.js');
    assert.equal(polyfills.at(-1), path.join(import.meta.dirname, '..', 'before-modules.js'));
    // And with no polyfills of the config's own.
    const bare = withWebCompat({}, WEB) as unknown as typeof config;
    assert.deepEqual(bare.serializer.getPolyfills({}), [polyfills.at(-1)]);
  });

  it('is asked of Vitest', () => {
    const plugin = webCompat({ libraries: ['@a/web'], sources: ['/abs/ui'] });
    assert.equal(process.env[LIBRARIES], '@a/web');
    assert.equal(process.env[SOURCES], '/abs/ui');
    assert.deepEqual([plugin.name, plugin.enforce], ['ng-native-web-compat', 'pre']);
  });

  it('is asked for the libraries it names, and refuses to guess where it names none', () => {
    for (const options of [undefined, {}, { libraries: [] }, { libraries: [''] }]) {
      assert.throws(() => withWebCompat({}, options as never), /libraries/);
      assert.throws(() => webCompat(options as never), /libraries/);
    }
    assert.equal(process.env[LIBRARIES], undefined);
  });

  it('keeps the rest of the config as it was', () => {
    const resolver = { sourceExts: ['ts'] };
    const config = withWebCompat({ projectRoot: '/app', resolver }, WEB);
    assert.deepEqual((config.resolver as typeof resolver).sourceExts, ['ts']);
    assert.equal(config.projectRoot, '/app');
    assert.equal(config.transformer.cacheVersion, 'library-browser-@acme/web');
  });
});

describe('withWebCompat, given directories of the app written for a browser', () => {
  it('names them to the build by where they are, from the project', () => {
    withWebCompat({ projectRoot: '/app' }, { ...WEB, sources: ['./src/helm', '/abs/ui'] });
    assert.equal(process.env[SOURCES], ['/app/src/helm', '/abs/ui'].join(path.delimiter));
  });

  it('names them in the cache version too, so a directory added is never served stale', () => {
    const without = withWebCompat({ projectRoot: '/app' }, WEB);
    const named = withWebCompat({ projectRoot: '/app' }, { ...WEB, sources: ['./src/helm'] });
    assert.notEqual(named.transformer.cacheVersion, without.transformer.cacheVersion);
    assert.match(named.transformer.cacheVersion, /\/app\/src\/helm/);
  });

  it('names none where none are given, whatever was named before', () => {
    process.env[SOURCES] = '/stale';
    withWebCompat({}, WEB);
    assert.equal(process.env[SOURCES], undefined);
  });

  it('refuses one that is not a path', () => {
    assert.throws(() => withWebCompat({}, { ...WEB, sources: [''] }), /sources/);
    assert.throws(() => withWebCompat({}, { ...WEB, sources: './src/helm' }), /sources/);
  });
});

const SHIM = '@ng-native/web-compat/ng-icons';
const LIBRARY = '/app/node_modules/@spartan-ng/helm/checkbox.mjs';

describe('the alias for a library that imports @ng-icons/core', () => {
  it('is the shim, for a library and for the app', () => {
    assert.equal(aliasOf('@ng-icons/core', LIBRARY), SHIM);
    assert.equal(aliasOf('@ng-icons/core', '/app/src/app/helm/checkbox.ts'), SHIM);
  });

  it('is nothing for the shim itself and for the native icons, which need the real module', () => {
    const icons = path.dirname(
      createRequire(import.meta.url).resolve('@ng-native/icons/package.json'),
    );
    for (const own of [
      path.join(import.meta.dirname, 'ng-icons.ts'),
      '/app/node_modules/@ng-native/web-compat/dist/ng-icons.js',
      path.join(icons, 'src/ng-icon.ts'),
      '/app/node_modules/@ng-native/icons/dist/index.js',
      '/app/node_modules/.pnpm/@ng-native+icons@1.0.0/node_modules/@ng-native/icons/dist/index.js',
      'C:\\app\\node_modules\\@ng-native\\icons\\dist\\index.js',
    ]) {
      assert.equal(aliasOf('@ng-icons/core', own), null, own);
    }
  });

  it('is nothing for the native icons on Windows, written with either slash', () => {
    const icons = path.dirname(
      createRequire(import.meta.url).resolve('@ng-native/icons/package.json'),
    );
    const back = `${icons.replaceAll('/', '\\')}\\src\\ng-icon.ts`;
    const forward = `${icons.replaceAll('\\', '/')}/src/ng-icon.ts`;
    assert.equal(aliasOf('@ng-icons/core', back), null, back);
    assert.equal(aliasOf('@ng-icons/core', forward), null, forward);
  });

  it("is the shim for an app's own packages of the same directory names", () => {
    // A monorepo's own `packages/icons` is a library like any other, whatever it is called.
    assert.equal(aliasOf('@ng-icons/core', '/app/packages/icons/src/icon.ts'), SHIM);
    assert.equal(aliasOf('@ng-icons/core', '/app/packages/web-compat/src/x.ts'), SHIM);
  });

  it('is nothing for any other module, an icon set included', () => {
    assert.equal(aliasOf('@ng-icons/lucide', LIBRARY), null);
    assert.equal(aliasOf('@ng-icons/core/package.json', LIBRARY), null);
    assert.equal(aliasOf('@angular/core', LIBRARY), null);
  });

  it('is a module that is @ng-icons/core with the icon component the native one', async () => {
    const shim = await import('./ng-icons.ts');
    const real = await import('@ng-icons/core');
    const { NgIcon } = await import('@ng-native/icons');
    assert.equal(shim.NgIcon, NgIcon);
    assert.equal(shim.NgIconComponent, NgIcon);
    assert.equal(shim.provideIcons, real.provideIcons);
  });
});

describe('withWebCompat, resolving @ng-icons/core for Metro', () => {
  const asked: [string, string][] = [];
  const context = (originModulePath: string): Context => ({
    originModulePath,
    resolveRequest: (inner, moduleName) => {
      asked.push(['default', moduleName]);
      return { filePath: moduleName, from: inner.originModulePath };
    },
  });

  it('resolves the import to the shim, through the resolver Metro would have used', () => {
    asked.length = 0;
    const config = withWebCompat({}, WEB);
    const found = config.resolver.resolveRequest(context(LIBRARY), '@ng-icons/core', 'ios');
    assert.deepEqual(found, { filePath: SHIM, from: LIBRARY });
    config.resolver.resolveRequest(context(LIBRARY), '@angular/core', 'ios');
    assert.deepEqual(asked, [
      ['default', SHIM],
      ['default', '@angular/core'],
    ]);
  });

  it('goes through a resolver the config already had', () => {
    asked.length = 0;
    const own: Resolve = (inner, moduleName) => {
      asked.push(['own', moduleName]);
      return inner.resolveRequest(inner, moduleName, null);
    };
    const config = withWebCompat({ resolver: { resolveRequest: own } }, WEB);
    config.resolver.resolveRequest(context(LIBRARY), '@ng-icons/core', 'android');
    assert.deepEqual(asked, [
      ['own', SHIM],
      ['default', SHIM],
    ]);
  });
});

describe('webCompat, resolving @ng-icons/core for Vite', () => {
  it('resolves the import to the shim before any other plugin, and nothing else', async () => {
    const plugin = webCompat(WEB);
    assert.equal(plugin.enforce, 'pre');
    const resolved: unknown[] = [];
    const host = {
      resolve: async (source: string, importer?: string, options?: object) => {
        resolved.push([source, importer, options]);
        return { id: `/resolved/${source}` };
      },
    };
    const found = await plugin.resolveId.call(host, '@ng-icons/core', LIBRARY, { ssr: true });
    assert.deepEqual(found, { id: `/resolved/${SHIM}` });
    assert.deepEqual(resolved, [[SHIM, LIBRARY, { ssr: true, skipSelf: true }]]);
    assert.equal(await plugin.resolveId.call(host, '@ng-icons/lucide', LIBRARY, {}), null);
    const icons = path.dirname(
      createRequire(import.meta.url).resolve('@ng-native/icons/package.json'),
    );
    const own = path.join(icons, 'src/ng-icon.ts');
    assert.equal(await plugin.resolveId.call(host, '@ng-icons/core', own, {}), null);
  });
});
