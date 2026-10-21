/**
 * The build side of the package: the libraries and the app's directories written for a browser,
 * named to the transformer, and the transformer's cache told of both.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';

const { withWebCompat, webCompat } = createRequire(import.meta.url)('../build.cjs') as {
  withWebCompat<T extends object>(
    config: T,
    options?: { libraries: string[]; sources?: unknown },
  ): T & { transformer: { cacheVersion: string } };
  webCompat(options?: { libraries: string[]; sources?: unknown }): {
    name: string;
    enforce: string;
  };
};

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
    assert.deepEqual(plugin, { name: 'ng-native-web-compat', enforce: 'pre' });
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
    assert.equal(config.resolver, resolver);
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
