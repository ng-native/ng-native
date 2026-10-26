/**
 * The transformer reads an icon set while it transforms the app's own file, so the set is an input
 * of that file's transform, and Metro's cache has to know it. Without the set in the key, a set
 * upgraded with an icon redrawn left every file importing it with the old SVG in a release build,
 * and in a dev server after a restart, until a `--clear`.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const expo = path.dirname(require.resolve('expo/package.json'));
const Metro = require(require.resolve('metro', { paths: [expo] })) as {
  runBuild(config: object, options: object): Promise<{ code: string }>;
};
const { FileStore } = require(require.resolve('metro-cache', { paths: [expo] })) as {
  FileStore: new (options: { root: string }) => object;
};
const { resolve } = require(
  require.resolve('metro-resolver', {
    paths: [path.dirname(require.resolve('metro', { paths: [expo] }))],
  }),
) as { resolve(context: object, name: string, platform: string): unknown };
const { getDefaultConfig } = require('expo/metro-config') as {
  getDefaultConfig(root: string): Record<string, unknown>;
};
const { withAngularNative } = require('@ng-native/metro/config.cjs') as {
  withAngularNative(config: object, options?: { projectRoot?: string }): Record<string, unknown>;
};
const { iconSetVersions } = require('@ng-native/metro/inline-icons.cjs') as {
  iconSetVersions(projectRoot: string): string | undefined;
};

/** A release build of `root`'s `index.ts`, with Metro's cache in `cache`. */
async function releaseBuild(root: string, cache: string): Promise<string> {
  const config = withAngularNative(getDefaultConfig(root));
  Object.assign(config, {
    cacheStores: [new FileStore({ root: cache })],
    reporter: { update() {} },
    resetCache: false,
    maxWorkers: 1,
    watchFolders: [root, path.resolve(import.meta.dirname, '../..')],
  });
  // Only the app's own files: anything a package would bring in is left out of the bundle.
  // Crawl with Node, not the shared watchman daemon: a stuck daemon would hang the build with no
  // timeout, and every temp app would leave a watch behind.
  (config['resolver'] as { useWatchman?: boolean }).useWatchman = false;
  (config['resolver'] as { resolveRequest?: unknown }).resolveRequest = (
    context: object,
    name: string,
    platform: string,
  ) =>
    name.startsWith('.') || path.isAbsolute(name)
      ? resolve({ ...context, resolveRequest: resolve }, name, platform)
      : { type: 'empty' };
  const cwd = process.cwd();
  process.chdir(root);
  try {
    return (
      await Metro.runBuild(config, {
        entry: 'index.ts',
        dev: false,
        minify: false,
        platform: 'ios',
      })
    ).code;
  } finally {
    process.chdir(cwd);
  }
}

/** Publishes `@ng-icons/fakeset` at `version` into `root`, its one icon carrying `marker`. */
function publishSet(root: string, version: string, marker: string): void {
  const set = path.join(root, 'node_modules', '@ng-icons', 'fakeset');
  mkdirSync(path.join(set, 'fesm2022'), { recursive: true });
  writeFileSync(
    path.join(set, 'package.json'),
    JSON.stringify({
      name: '@ng-icons/fakeset',
      version,
      type: 'module',
      exports: { '.': { default: './fesm2022/ng-icons-fakeset.mjs' } },
    }),
  );
  writeFileSync(
    path.join(set, 'fesm2022', 'ng-icons-fakeset.mjs'),
    `const fakeStar = \`<svg data-v="${marker}"></svg>\`;\n\nexport { fakeStar };\n`,
  );
}

function app(): { root: string; cache: string; done(): void } {
  // Real, since Metro's file map holds `/private/var` where macOS's tmpdir says `/var`.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'icons-cache-')));
  const root = path.join(dir, 'app');
  mkdirSync(root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', private: true }));
  writeFileSync(
    path.join(root, 'index.ts'),
    "import { fakeStar } from '@ng-icons/fakeset';\n(globalThis as { icon?: string }).icon = fakeStar;\n",
  );
  return {
    root,
    cache: path.join(dir, 'cache'),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The marker of the icon the bundle carries, or none: the bundle itself is too long to print. */
function icon(code: string): string | undefined {
  return /data-v=\\?"(\w+)/.exec(code)?.[1];
}

describe('an icon set in the transform cache key', () => {
  it('rebuilds a file importing a set when the set is upgraded', { timeout: 120_000 }, async () => {
    const { root, cache, done } = app();
    try {
      publishSet(root, '1.0.0', 'ICON_ONE');
      assert.equal(icon(await releaseBuild(root, cache)), 'ICON_ONE');

      publishSet(root, '1.1.0', 'ICON_TWO');
      assert.equal(icon(await releaseBuild(root, cache)), 'ICON_TWO');
    } finally {
      done();
    }
  });

  it('rebuilds a file importing a set when the set is removed', { timeout: 120_000 }, async () => {
    const { root, cache, done } = app();
    try {
      publishSet(root, '1.0.0', 'ICON_ONE');
      assert.equal(icon(await releaseBuild(root, cache)), 'ICON_ONE');

      rmSync(path.join(root, 'node_modules', '@ng-icons'), { recursive: true });
      assert.equal(icon(await releaseBuild(root, cache)), undefined);
    } finally {
      done();
    }
  });

  it('reads the sets of an app below the config root', () => {
    const { root, done } = app();
    try {
      const parent = path.dirname(root);
      writeFileSync(path.join(parent, 'package.json'), JSON.stringify({ private: true }));
      const cacheVersion = () =>
        (
          withAngularNative(getDefaultConfig(parent), { projectRoot: root })['transformer'] as {
            cacheVersion: string;
          }
        ).cacheVersion;

      publishSet(root, '1.0.0', 'ICON_ONE');
      const before = cacheVersion();
      publishSet(root, '1.1.0', 'ICON_TWO');
      const upgraded = cacheVersion();
      assert.notEqual(upgraded, before);

      rmSync(path.join(root, 'node_modules', '@ng-icons'), { recursive: true });
      assert.notEqual(cacheVersion(), upgraded);
    } finally {
      done();
    }
  });

  it("reads a set from pnpm's store, which a workspace package's set is only in", () => {
    const { root, done } = app();
    try {
      const store = path.join(root, 'node_modules', '.pnpm');
      mkdirSync(path.join(store, '@ng-icons+fakeset@1.0.0_@ng-icons+core@1.0.0'), {
        recursive: true,
      });
      mkdirSync(path.join(store, '@ng-icons+core@1.0.0'));
      const before = iconSetVersions(root);
      // Core holds no icon the transformer reads, so only the set's own folder counts.
      assert.equal(before, 'ng-icons-@ng-icons+fakeset@1.0.0_@ng-icons+core@1.0.0');

      rmSync(path.join(store, '@ng-icons+fakeset@1.0.0_@ng-icons+core@1.0.0'), { recursive: true });
      mkdirSync(path.join(store, '@ng-icons+fakeset@1.1.0_@ng-icons+core@1.0.0'));
      assert.notEqual(iconSetVersions(root), before);
    } finally {
      done();
    }
  });
});
