/**
 * The templates and stylesheets a transform reads, in a dev build: where they are read from, and
 * that Metro's cache knows a module made from them is stale once one changes.
 *
 * Real Metro release builds, as `metro-release-resource-cache.test.ts` makes them, with every
 * package resolved to an empty module so only the app's own files are transformed.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

const scratch = mkdtempSync(path.join(realpathSync(tmpdir()), 'metro-resource-read-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let made = 0;

function project(files: Record<string, string>): { root: string; cache: string } {
  const root = path.join(scratch, `app-${made}`);
  const cache = path.join(scratch, `cache-${made++}`);
  mkdirSync(root);
  write(root, { 'package.json': '{ "name": "app", "private": true }', ...files });
  return { root, cache };
}

function write(root: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
}

type Store = {
  get(key: Buffer): unknown;
  set(key: Buffer, value: unknown): Promise<void>;
  clear(): void;
};

/** A build for one platform, reading and writing `store`. The caller decides the directory. */
async function build(root: string, store: object, platform: string, dev = false): Promise<string> {
  const config = getDefaultConfig(root);
  config['cacheStores'] = [store];
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
    platformName: string,
  ) =>
    name.startsWith('.') || path.isAbsolute(name)
      ? resolve({ ...context, resolveRequest: resolve }, name, platformName)
      : { type: 'empty' };
  const options = { entry: 'index.ts', dev, minify: false, platform };
  return (await Metro.runBuild(config, options)).code;
}

/**
 * A dev build, for what it transformed: each transform Metro wrote to the cache, which is each
 * file it did not take from it. `runBuild` cannot write a dev bundle's source map out of a dev
 * server ("Unexpected module with full source map"), which is after every file is transformed.
 */
async function devTransforms(root: string, cache: string): Promise<string[]> {
  const store = new FileStore({ root: cache }) as Store;
  const written: string[] = [];
  const counting = {
    get: (key: Buffer) => store.get(key),
    set: (key: Buffer, value: unknown) => (
      written.push(JSON.stringify(value)),
      store.set(key, value)
    ),
    clear: () => store.clear(),
  };
  try {
    await build(root, counting, 'ios', true);
  } catch (error) {
    if (!/full source map/.test(String((error as Error).message))) throw error;
  }
  return written;
}

async function inDirectory<T>(directory: string, run: () => Promise<T>): Promise<T> {
  const cwd = process.cwd();
  process.chdir(directory);
  try {
    return await run();
  } finally {
    process.chdir(cwd);
  }
}

const card = (decorator: string) => `import { Component } from '@angular/core';
@Component({ selector: 'card', ${decorator} })
export class Card {}
`;
const INDEX = `import { Card } from './card';\nexport default Card;\n`;

describe('the resource cache', () => {
  it('leaves no module with the old template in a dev bundle built again after a template edit', async () => {
    // A dev server stopped, `card.html` edited, and the server started again on its warm cache.
    // The stylesheet's module carries the hot update for its component, compiled against the
    // template as it was, and its own text has not changed, so Metro serves it from the cache.
    // It runs after the template's module, and would put the old template back.
    const { root, cache } = project({
      'index.ts': INDEX,
      'card.ts': card(`templateUrl: './card.html', styleUrl: './card.css'`),
      'card.html': '<view class="card"><text>FIRST_TEMPLATE</text></view>',
      'card.css': '.card { opacity: 0.5 }',
    });
    await inDirectory(root, async () => {
      const first = await devTransforms(root, cache);
      const holding = (written: string[], text: string) =>
        written.filter((value) => value.includes(text)).length;
      // The component's module, and the module of each of its two resources.
      assert.equal(holding(first, 'FIRST_TEMPLATE'), 3, 'three modules carry the template');

      write(root, { 'card.html': '<view class="card"><text>SECOND_TEMPLATE</text></view>' });
      const second = await devTransforms(root, cache);
      assert.equal(
        holding(second, 'SECOND_TEMPLATE'),
        3,
        'each of the three is transformed again, and none is served with the old template',
      );
    });
  });

  it("leaves no resource module compiled against the component's old file after it is edited", async () => {
    // The same, with the component's own file edited: each resource's module compiles the sheet
    // the component's own `styles` are part of.
    const decorator = (mark: string) =>
      `templateUrl: './card.html', styleUrl: './card.css', styles: '.${mark} { opacity: 0.3 }'`;
    const { root, cache } = project({
      'index.ts': INDEX,
      'card.ts': card(decorator('first-owner')),
      'card.html': '<view class="card"><text>card</text></view>',
      'card.css': '.card { opacity: 0.5 }',
    });
    await inDirectory(root, async () => {
      const holding = (written: string[], text: string) =>
        written.filter((value) => value.includes(text)).length;
      assert.equal(holding(await devTransforms(root, cache), 'first-owner'), 3);

      write(root, { 'card.ts': card(decorator('second-owner')) });
      assert.equal(holding(await devTransforms(root, cache), 'second-owner'), 3);
    });
  });

  it('builds a component with a templateUrl when Metro is started outside the project', async () => {
    // `npx expo export apps/mobile` from the workspace root: Expo does not change directory, and
    // Metro names each file from the project root.
    const { root, cache } = project({
      'index.ts': INDEX,
      'card.ts': card(`templateUrl: './card.html'`),
      'card.html': '<view><text>FIRST_TEMPLATE</text></view>',
    });
    const store = new FileStore({ root: cache });
    const code = await inDirectory(scratch, () => build(root, store, 'ios'));
    assert.ok(code.includes('FIRST_TEMPLATE'));
  });
});

describe('a stylesheet shared by components', () => {
  // `compileForHmrSync` reports a warning about an aliased `@if` and a `@switch` beside an update
  // that is complete. The stylesheet's module took it for a template that did not compile, threw,
  // and the dev bundle failed with a syntax error on the stylesheet.
  const files = (switched: string) => ({
    'index.ts': `import { When } from './when';\nimport { Which } from './which';\nexport default [When, Which];\n`,
    'when.ts': `import { Component, signal } from '@angular/core';
@Component({ selector: 'when', styleUrl: './shared.css', template: '@if (a(); as x) { <text>{{ x }}</text> }' })
export class When { a = signal(1); }
`,
    'which.ts': `import { Component, signal } from '@angular/core';
@Component({ selector: 'which', styleUrl: './shared.css', template: '${switched}' })
export class Which { a = signal(1); }
`,
    'shared.css': '.shared { opacity: 0.5 }',
  });

  it('builds a dev bundle with an aliased @if and a @switch in its components', async () => {
    const { root, cache } = project(
      files('@switch (a()) { @case (1) { <text>one</text> } @default { <text>more</text> } }'),
    );
    await inDirectory(root, async () => {
      const written = await devTransforms(root, cache);
      const sheet = written.filter(
        (value) => value.includes('When_ApplyMetadata') && value.includes('Which_ApplyMetadata'),
      );
      assert.equal(sheet.length, 1, "the stylesheet's module carries the update for both");
    });
  });

  it('still fails on a template that does not compile, naming the component', () => {
    const { root } = project(files('@switch (a()) { <text>no case</text> }'));
    const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
      transformAngular(src: string, file: string, options: object): { code: string };
    };
    const sheet = path.join(root, 'shared.css');
    assert.throws(
      () => transformAngular('.shared { opacity: 0.5 }', sheet, { dev: true, projectRoot: root }),
      /shared\.css: Which's template did not compile/,
    );
  });

  // The transformer retries a file that failed through Babel, for a syntax error with a place. A
  // stylesheet or a template file is not JavaScript, so Babel's error there would hide the
  // component's, and a dev server may report the resource's failure before the component's own.
  const reportsTheComponent = (root: string, file: string, src: string) =>
    assert.throws(
      () =>
        (
          require('@ng-native/metro/transformer.cjs') as { transform(params: object): unknown }
        ).transform({
          src,
          filename: path.join(root, file),
          options: { dev: true, platform: 'ios', projectRoot: root },
        }),
      (error: Error) => {
        assert.match(error.message, /Which's template did not compile/);
        assert.doesNotMatch(error.message, /Unexpected token/);
        return true;
      },
    );

  it("reports the component's error, not a syntax error in the stylesheet, from the transformer", () => {
    const { root } = project(files('@switch (a()) { <text>no case</text> }'));
    reportsTheComponent(root, 'shared.css', '.shared { opacity: 0.5 }');
  });

  it("reports the component's error, not a syntax error in its template file", () => {
    const template = '@switch (a()) { <text>no case</text> }';
    const { root } = project({
      'index.ts': `import { Which } from './which';\nexport default [Which];\n`,
      'which.ts': `import { Component, signal } from '@angular/core';
@Component({ selector: 'which', templateUrl: './which.html' })
export class Which { a = signal(1); }
`,
      'which.html': template,
    });
    reportsTheComponent(root, 'which.html', template);
  });

  it("reports the component's error for a stylesheet in a folder named like a script", () => {
    const { root } = project({
      'index.ts': `import { Which } from './which';\nexport default [Which];\n`,
      'which.ts': `import { Component, signal } from '@angular/core';
@Component({ selector: 'which', styleUrl: './chart.js/shared.css', template: '@switch (a()) { <text>no case</text> }' })
export class Which { a = signal(1); }
`,
      'chart.js/shared.css': '.shared { opacity: 0.5 }',
    });
    reportsTheComponent(root, 'chart.js/shared.css', '.shared { opacity: 0.5 }');
  });
});
