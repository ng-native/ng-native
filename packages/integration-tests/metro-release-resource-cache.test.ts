/**
 * A release build from a warm Metro cache, after an edit to nothing but an external template or
 * stylesheet.
 *
 * Metro keys a cached transform on the file's own content, and a component's template and sheet
 * are compiled into its own module. So two `npx expo export` runs, with only `card.html` edited
 * between them, shipped the same bundle twice: the component's module came back from the cache
 * with the first template in it, and only `--clear` showed the edit.
 *
 * Each build here is a real Metro release build against one cache directory, with every package
 * resolved to an empty module so only the app's own files are transformed.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { named, sfnt } from './font-files.ts';

const require = createRequire(import.meta.url);
const expo = path.dirname(require.resolve('expo/package.json'));
const metro = require.resolve('metro', { paths: [expo] });
const Metro = require(metro) as {
  runBuild(config: object, options: object): Promise<{ code: string }>;
};
const { FileStore } = require(require.resolve('metro-cache', { paths: [expo] })) as {
  FileStore: new (options: { root: string }) => object;
};
const { resolve } = require(
  require.resolve('metro-resolver', { paths: [path.dirname(metro)] }),
) as {
  resolve(context: object, name: string, platform: string): unknown;
};
const { getDefaultConfig } = require('expo/metro-config') as {
  getDefaultConfig(root: string): Record<string, unknown>;
};
const { withAngularNative } = require('@ng-native/metro/config.cjs') as {
  withAngularNative(config: object): Record<string, unknown>;
};

// Real, because Metro watches the project under the path it is given and macOS links the temp
// directory from somewhere else.
const scratch = mkdtempSync(path.join(realpathSync(tmpdir()), 'metro-release-resource-cache-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

/** A project and a cache of its own, with the files written into the project. */
function project(files: Record<string, string>): { root: string; cache: string } {
  const root = path.join(scratch, `app-${made}`);
  const cache = path.join(scratch, `cache-${made++}`);
  mkdirSync(root);
  write(root, { 'package.json': '{ "name": "app", "private": true }', ...files });
  return { root, cache };
}

function write(root: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(root, name), content);
  }
}

/**
 * A Metro release build of `index.ts`, as `npx expo export` makes one, reading and writing `cache`,
 * with each import named in `replacements` resolved as the one it is mapped to.
 */
async function releaseBuild(
  root: string,
  cache: string | object,
  replacements: Record<string, string> = {},
): Promise<string> {
  const config = getDefaultConfig(root);
  config['cacheStores'] = [typeof cache === 'string' ? new FileStore({ root: cache }) : cache];
  withAngularNative(config);
  Object.assign(config, {
    reporter: { update() {} },
    resetCache: false,
    maxWorkers: 1,
    watchFolders: [root, path.resolve(import.meta.dirname, '../..')],
  });
  // Crawl with Node, not the shared watchman daemon: a stuck daemon would hang the build with no
  // timeout, and every temp app would leave a watch behind.
  (config['resolver'] as { useWatchman?: boolean }).useWatchman = false;
  (config['resolver'] as { resolveRequest?: unknown }).resolveRequest = (
    context: object,
    name: string,
    platform: string,
  ) =>
    name.startsWith('.') || path.isAbsolute(name)
      ? resolve({ ...context, resolveRequest: resolve }, replacements[name] ?? name, platform)
      : { type: 'empty' };
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const options = { entry: 'index.ts', dev: false, minify: false, platform: 'ios' };
    return (await Metro.runBuild(config, options)).code;
  } finally {
    process.chdir(cwd);
  }
}

const card = (decorator: string) => `import { Component } from '@angular/core';
@Component({ selector: 'card', ${decorator} })
export class Card {}
`;
/** Whether a bundle has the text in it: asked this way, a failure does not print the bundle. */
const shipped = (code: string, text: string) => code.includes(text);

const INDEX = `import { Card } from './card';\nexport default Card;\n`;

describe('a release build from a warm Metro cache', () => {
  it('ships an external template edited since the last build', async () => {
    const { root, cache } = project({
      'index.ts': INDEX,
      'card.ts': card(`templateUrl: './card.html'`),
      'card.html': '<view><text>FIRST_TEMPLATE</text></view>',
    });
    assert.ok(shipped(await releaseBuild(root, cache), 'FIRST_TEMPLATE'));

    write(root, { 'card.html': '<view><text>SECOND_TEMPLATE</text></view>' });
    const code = await releaseBuild(root, cache);
    assert.ok(shipped(code, 'SECOND_TEMPLATE'), 'the edit is in the bundle');
    assert.ok(!shipped(code, 'FIRST_TEMPLATE'), 'what the edit replaced is not');
  });

  it('ships each of several stylesheets edited since the last build', async () => {
    const { root, cache } = project({
      'index.ts': INDEX,
      'card.ts': card(
        `template: '<view class="base"></view>', styleUrls: ['./base.css', './card.css']`,
      ),
      'base.css': '.base { opacity: 0.5 }',
      'card.css': '.first-rule { opacity: 0.25 }',
    });
    assert.ok(shipped(await releaseBuild(root, cache), 'first-rule'));

    write(root, { 'card.css': '.second-rule { opacity: 0.25 }' });
    const code = await releaseBuild(root, cache);
    assert.ok(shipped(code, 'second-rule'), 'the edit is in the bundle');
    assert.ok(!shipped(code, 'first-rule'), 'what the edit replaced is not');
    assert.ok(shipped(code, '"base"'), 'the stylesheet that did not change is still in the sheet');
  });

  it('takes a template moved inline, and the file again once it is back with other text', async () => {
    const { root, cache } = project({
      'index.ts': INDEX,
      'card.ts': card(`templateUrl: './card.html'`),
      'card.html': '<view><text>FIRST_TEMPLATE</text></view>',
    });
    assert.ok(shipped(await releaseBuild(root, cache), 'FIRST_TEMPLATE'));

    unlinkSync(path.join(root, 'card.html'));
    write(root, { 'card.ts': card(`template: '<view><text>INLINE_TEMPLATE</text></view>'`) });
    const inline = await releaseBuild(root, cache);
    assert.ok(shipped(inline, 'INLINE_TEMPLATE'), 'the edit is in the bundle');
    assert.ok(!shipped(inline, 'FIRST_TEMPLATE'), 'what the edit replaced is not');

    // The component's file is as it was for the first build, so its first transform is the one
    // the cache holds under its key, compiled against a template that is no longer the file's.
    write(root, {
      'card.ts': card(`templateUrl: './card.html'`),
      'card.html': '<view><text>THIRD_TEMPLATE</text></view>',
    });
    const back = await releaseBuild(root, cache);
    assert.ok(shipped(back, 'THIRD_TEMPLATE'), 'the edit is in the bundle');
    assert.ok(!shipped(back, 'FIRST_TEMPLATE'), 'what the edit replaced is not');
  });

  it('ships the PostScript name of a font file replaced since the last build', async () => {
    const { root, cache } = project({
      'index.ts': INDEX,
      'card.ts': card(
        `template: '<view></view>', styles: \`@font-face { font-family: Brand; src: url('./brand.ttf') }\``,
      ),
    });
    writeFileSync(path.join(root, 'brand.ttf'), sfnt(named('Brand-First')));
    assert.ok(shipped(await releaseBuild(root, cache), 'Brand-First'));

    writeFileSync(path.join(root, 'brand.ttf'), sfnt(named('Brand-Second')));
    const code = await releaseBuild(root, cache);
    assert.ok(shipped(code, 'Brand-Second'), 'the new name is in the bundle');
    assert.ok(!shipped(code, 'Brand-First'), 'the name it replaced is not');
  });

  it('builds a module importing a stylesheet a resolver replaces with another file', async () => {
    const { root, cache } = project({
      'index.ts': `import './theme.css';\n${INDEX}`,
      'card.ts': card(`template: '<view><text>FIRST_TEMPLATE</text></view>'`),
      'theme.ios.css': '.theme { opacity: 0.5 }',
    });
    const replacements = { './theme.css': './theme.ios.css' };
    assert.ok(shipped(await releaseBuild(root, cache, replacements), 'FIRST_TEMPLATE'));
    const warm = await releaseBuild(root, cache, replacements);
    assert.ok(shipped(warm, 'FIRST_TEMPLATE'), 'from the warm cache');
  });

  it('still reuses a transform when nothing it read has changed', async () => {
    const { root, cache } = project({
      'index.ts': INDEX,
      'card.ts': card(`templateUrl: './card.html', styleUrl: './card.css'`),
      'card.html': '<view class="card"><text>FIRST_TEMPLATE</text></view>',
      'card.css': '.card { opacity: 0.5 }',
    });
    const store = new FileStore({ root: cache }) as {
      get(key: Buffer): unknown;
      set(key: Buffer, value: unknown): Promise<void>;
      clear(): void;
    };
    const written: unknown[] = [];
    const counting = {
      get: (key: Buffer) => store.get(key),
      set: (key: Buffer, value: unknown) => (written.push(value), store.set(key, value)),
      clear: () => store.clear(),
    };
    await releaseBuild(root, counting);
    assert.ok(written.length > 0, 'the first build fills the cache');

    // Metro writes back only what it transformed again, which a hit for every file is not.
    written.length = 0;
    assert.ok(shipped(await releaseBuild(root, counting), 'FIRST_TEMPLATE'));
    assert.equal(written.length, 0);
  });
});
