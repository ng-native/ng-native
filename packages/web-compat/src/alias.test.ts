/**
 * The build side of the package: a library's own import of `@ng-icons/core` is given the icon
 * component that draws natively, by Metro for the app and by Vite for its tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const { aliasOf, withWebCompat, webCompat } = createRequire(import.meta.url)('../build.cjs') as {
  aliasOf(moduleName: string, importer: string | undefined): string | null;
  withWebCompat<T extends object>(config: T): T & { resolver: { resolveRequest: Resolve } };
  webCompat(): { name: string; enforce: string; resolveId: ResolveId };
};
type Context = { originModulePath: string; resolveRequest: Resolve };
type Resolve = (context: Context, moduleName: string, platform: string | null) => unknown;
type ResolveId = (
  this: { resolve(source: string, importer?: string, options?: object): Promise<unknown> },
  source: string,
  importer: string | undefined,
  options: object,
) => Promise<unknown>;

const SHIM = '@ng-native/web-compat/ng-icons';
const LIBRARY = '/app/node_modules/@spartan-ng/helm/checkbox.mjs';

describe('the alias for a library that imports @ng-icons/core', () => {
  it('is the shim, for a library and for the app', () => {
    assert.equal(aliasOf('@ng-icons/core', LIBRARY), SHIM);
    assert.equal(aliasOf('@ng-icons/core', '/app/src/app/helm/checkbox.ts'), SHIM);
  });

  it('is nothing for the shim itself and for the native icons, which need the real module', () => {
    for (const own of [
      '/repo/packages/web-compat/src/ng-icons.ts',
      '/app/node_modules/@ng-native/web-compat/dist/ng-icons.js',
      '/repo/packages/icons/src/ng-icon.ts',
      '/app/node_modules/@ng-native/icons/dist/index.js',
      'C:\\app\\node_modules\\@ng-native\\icons\\dist\\index.js',
    ]) {
      assert.equal(aliasOf('@ng-icons/core', own), null, own);
    }
  });

  it('is nothing for any other module, an icon set included', () => {
    assert.equal(aliasOf('@ng-icons/lucide', LIBRARY), null);
    assert.equal(aliasOf('@ng-icons/core/package.json', LIBRARY), null);
    assert.equal(aliasOf('@angular/core', LIBRARY), null);
  });
});

describe('withWebCompat, for Metro', () => {
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
    const config = withWebCompat({ resolver: { sourceExts: ['ts'] } });
    assert.deepEqual(config.resolver.sourceExts, ['ts'], 'and keeps the rest of the config');
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
    const config = withWebCompat({ resolver: { resolveRequest: own } });
    config.resolver.resolveRequest(context(LIBRARY), '@ng-icons/core', 'android');
    assert.deepEqual(asked, [
      ['own', SHIM],
      ['default', SHIM],
    ]);
  });
});

describe('webCompat, for Vite', () => {
  it('resolves the import to the shim before any other plugin, and nothing else', async () => {
    const plugin = webCompat();
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
    const own = '/repo/packages/icons/src/ng-icon.ts';
    assert.equal(await plugin.resolveId.call(host, '@ng-icons/core', own, {}), null);
  });
});
