/**
 * `nx g @ng-native/nx:library`: the workspace's own library generator, with tests that render on
 * the fake Fabric in place of the ones it would write.
 *
 * `@nx/angular` and `@nx/js` are not installed here, so their library generators are replaced by
 * fakes writing the files each writes with `--unitTestRunner=none`, as Nx 23.2 does.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Tree } from '@nx/devkit';

const require = createRequire(import.meta.url);
const { createTreeWithEmptyWorkspace } = require('@nx/devkit/testing') as {
  createTreeWithEmptyWorkspace: () => Tree;
};
const { addProjectConfiguration, readJson, readProjectConfiguration, updateJson, writeJson } =
  require('@nx/devkit') as typeof import('@nx/devkit');
const { library, bases, generatorDefaults } = require('./index.cjs');
const { componentSource, testSource } = require('../component/sources.cjs');
const native = require('../native-app.cjs');

type Options = { directory: string; name?: string; tags?: string; [option: string]: unknown };
const calls: { base: string; options: Options }[] = [];
const original = { ...bases };
afterEach(() => {
  Object.assign(bases, original);
  calls.length = 0;
});

/** What `@nx/angular:library packages/ui --unitTestRunner=none` writes. */
function fakeAngular(tree: Tree, options: Options) {
  calls.push({ base: 'angular', options });
  const root = options.directory;
  const name = options.name ?? root.split('/').pop()!;
  addProjectConfiguration(tree, name, {
    root,
    sourceRoot: `${root}/src`,
    projectType: 'library',
    prefix: 'lib',
    tags: options.tags ? options.tags.split(',') : [],
    targets: { lint: { executor: '@nx/eslint:lint' } },
  } as Parameters<typeof addProjectConfiguration>[2]);
  writeJson(tree, `${root}/tsconfig.json`, {
    extends: '../../tsconfig.base.json',
    files: [],
    include: [],
    references: [{ path: './tsconfig.lib.json' }],
  });
  writeJson(tree, `${root}/tsconfig.lib.json`, {
    extends: './tsconfig.json',
    compilerOptions: { outDir: '../../dist/out-tsc', types: [] },
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  });
  tree.write(`${root}/src/index.ts`, `export * from './lib/${name}/${name}';\n`);
  tree.write(`${root}/src/lib/${name}/${name}.ts`, 'export class Ui {}\n');
  tree.write(`${root}/src/lib/${name}/${name}.html`, `<p>${name} works!</p>\n`);
  tree.write(`${root}/src/lib/${name}/${name}.css`, '');
}

/** What `@nx/js:library packages/ui --bundler=none --unitTestRunner=none` writes. */
function fakeJs(tree: Tree, options: Options) {
  calls.push({ base: 'js', options });
  const root = options.directory;
  const name = options.name ?? root.split('/').pop()!;
  writeJson(tree, `${root}/package.json`, {
    name: `@org/${name}`,
    version: '0.0.1',
    private: true,
    type: 'module',
    dependencies: {},
  });
  writeJson(tree, `${root}/tsconfig.json`, {
    extends: '../../tsconfig.base.json',
    files: [],
    include: [],
    references: [{ path: './tsconfig.lib.json' }],
  });
  writeJson(tree, `${root}/tsconfig.lib.json`, {
    extends: '../../tsconfig.base.json',
    compilerOptions: { rootDir: 'src', outDir: 'dist', types: ['node'] },
    include: ['src/**/*.ts'],
    references: [],
  });
  tree.write(`${root}/src/index.ts`, `export * from './lib/${name}.js';\n`);
  tree.write(
    `${root}/src/lib/${name}.ts`,
    `export function ${name}(): string {\n  return '${name}';\n}\n`,
  );
}

/** The `angular-monorepo` preset's shape: one root package.json, path aliases, `@nx/angular`. */
function integrated() {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    dependencies: { '@angular/core': '~22.1.4' },
    devDependencies: { nx: '23.2.0', '@nx/angular': '23.2.0', vitest: '~4.1.0' },
  }));
  bases.angular = async (tree: Tree, options: Options) => fakeAngular(tree, options);
  bases.js = async () => assert.fail('@nx/js in a workspace with @nx/angular');
  return tree;
}

/** The TypeScript preset's shape: pnpm workspaces, no path aliases, and no `@nx/angular`. */
function tsPreset() {
  const tree = createTreeWithEmptyWorkspace();
  updateJson(tree, 'package.json', (manifest) => ({
    ...manifest,
    name: '@org/source',
    devDependencies: { nx: '23.2.0', '@nx/js': '23.2.0' },
  }));
  writeJson(tree, 'tsconfig.base.json', { compilerOptions: { composite: true } });
  tree.write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
  bases.js = async (tree: Tree, options: Options) => fakeJs(tree, options);
  bases.angular = async () => assert.fail('@nx/angular in a workspace without it');
  return tree;
}

const generate = (tree: Tree, options: object) =>
  library(tree, { skipFormat: true, skipInstall: true, ...options });

describe('in a workspace with @nx/angular', () => {
  it("runs @nx/angular's library generator without its tests, passing the options on", async () => {
    const tree = integrated();
    await generate(tree, { directory: 'packages/ui', tags: 'scope:shared' });
    assert.deepEqual(calls, [
      {
        base: 'angular',
        options: {
          directory: 'packages/ui',
          name: undefined,
          tags: 'scope:shared',
          unitTestRunner: 'none',
          skipFormat: true,
        },
      },
    ]);
  });

  it('replaces its component with a native one and a test for the fake Fabric', async () => {
    const tree = integrated();
    await generate(tree, { directory: 'packages/ui' });
    const folder = 'packages/ui/src/lib/ui';
    assert.deepEqual(tree.children(folder).sort(), ['ui.test.ts', 'ui.ts']);
    assert.equal(
      tree.read(`${folder}/ui.ts`, 'utf-8'),
      componentSource('Ui', 'lib-ui', 'ui works'),
    );
    assert.equal(tree.read(`${folder}/ui.test.ts`, 'utf-8'), testSource('Ui', 'ui', 'ui works'));
  });

  it("writes the app's Vitest config, with Nx's path aliases", async () => {
    const tree = integrated();
    await generate(tree, { directory: 'packages/ui' });
    assert.equal(tree.read('packages/ui/vitest.config.mts', 'utf-8'), native.vitestConfig(true));
  });

  it("adds a test target that runs Vitest once, as the app's does", async () => {
    const tree = integrated();
    await generate(tree, { directory: 'packages/ui' });
    const { targets } = readProjectConfiguration(tree, 'ui');
    assert.deepEqual(targets?.test, {
      executor: 'nx:run-commands',
      options: { cwd: 'packages/ui', command: 'vitest run' },
      cache: true,
      inputs: ['default', '^production'],
    });
    assert.ok(targets?.lint, 'keeps the targets it had');
  });

  it('writes a tsconfig.spec.json for the tests, referenced from tsconfig.json', async () => {
    // A test imports its component as `./ui.ts`, as the template's do.
    const tree = integrated();
    await generate(tree, { directory: 'packages/ui' });
    assert.deepEqual(readJson(tree, 'packages/ui/tsconfig.spec.json'), {
      extends: './tsconfig.json',
      compilerOptions: { noEmit: true, allowImportingTsExtensions: true },
      include: ['vitest.config.mts', 'src/**/*.test.ts'],
    });
    assert.deepEqual(readJson(tree, 'packages/ui/tsconfig.json').references, [
      { path: './tsconfig.lib.json' },
      { path: './tsconfig.spec.json' },
    ]);
  });

  it('adds what the component and its test import to the root, keeping versions it has', async () => {
    const tree = integrated();
    await generate(tree, { directory: 'packages/ui' });
    const { dependencies, devDependencies } = readJson(tree, 'package.json');
    assert.equal(
      dependencies['@ng-native/components'],
      native.dependencies['@ng-native/components'],
    );
    assert.equal(dependencies['@angular/core'], '~22.1.4');
    assert.equal(
      devDependencies['@ng-native/testing'],
      native.devDependencies['@ng-native/testing'],
    );
    assert.equal(devDependencies.vitest, '~4.1.0');
    assert.equal(devDependencies['@nx/vite'], '23.2.0');
  });

  it('takes --name for a project named other than its directory', async () => {
    const tree = integrated();
    await generate(tree, { directory: 'packages/shared/ui', name: 'shared-ui' });
    assert.ok(tree.exists('packages/shared/ui/src/lib/shared-ui/shared-ui.test.ts'));
    assert.match(
      tree.read('packages/shared/ui/src/lib/shared-ui/shared-ui.ts', 'utf-8') ?? '',
      /export class SharedUi \{\}/,
    );
  });
});

describe('the options it runs the base generator with', () => {
  // Called from another generator, @nx/angular:library gets no schema defaults, and wrote a
  // library with `strict` off and a `strict: false` default into nx.json.
  function installed() {
    const root = mkdtempSync(path.join(tmpdir(), 'ngn-defaults-'));
    const pkg = path.join(root, 'node_modules/@fake/angular');
    mkdirSync(path.join(pkg, 'library'), { recursive: true });
    const write = (file: string, value: object) =>
      writeFileSync(path.join(pkg, file), JSON.stringify(value));
    write('package.json', { name: '@fake/angular', generators: './generators.json' });
    write('generators.json', { generators: { library: { schema: './library/schema.json' } } });
    write('library/schema.json', {
      properties: {
        directory: { type: 'string' },
        strict: { type: 'boolean', default: true },
        linter: { type: 'string', default: 'eslint' },
        unitTestRunner: { type: 'string', default: 'vitest-angular' },
      },
    });
    return root;
  }

  it("starts from the schema's defaults, as nx g does", () => {
    const root = installed();
    try {
      const tree = createTreeWithEmptyWorkspace();
      assert.deepEqual(generatorDefaults(tree, '@fake/angular', 'library', root), {
        strict: true,
        linter: 'eslint',
        unitTestRunner: 'vitest-angular',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets the workspace's nx.json defaults win over the schema's", () => {
    const root = installed();
    try {
      const tree = createTreeWithEmptyWorkspace();
      updateJson(tree, 'nx.json', (nxJson) => ({
        ...nxJson,
        generators: {
          '@fake/angular:library': { linter: 'none' },
          '@fake/angular': { library: { strict: false } },
        },
      }));
      const defaults = generatorDefaults(tree, '@fake/angular', 'library', root);
      assert.equal(defaults.linter, 'none');
      assert.equal(defaults.strict, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('has none for a package the workspace has not installed', () => {
    assert.deepEqual(
      generatorDefaults(createTreeWithEmptyWorkspace(), '@fake/none', 'library'),
      {},
    );
  });
});

describe('in the TypeScript preset', () => {
  it("runs @nx/js's library generator, with no bundler and without its tests", async () => {
    const tree = tsPreset();
    await generate(tree, { directory: 'packages/ui' });
    assert.deepEqual(calls, [
      {
        base: 'js',
        options: {
          directory: 'packages/ui',
          name: undefined,
          tags: undefined,
          unitTestRunner: 'none',
          bundler: 'none',
          skipFormat: true,
        },
      },
    ]);
  });

  it('makes the file it writes a native component, with a test beside it', async () => {
    const tree = tsPreset();
    await generate(tree, { directory: 'packages/ui' });
    assert.equal(
      tree.read('packages/ui/src/lib/ui.ts', 'utf-8'),
      componentSource('Ui', 'ui', 'ui works'),
    );
    assert.equal(
      tree.read('packages/ui/src/lib/ui.test.ts', 'utf-8'),
      testSource('Ui', 'ui', 'ui works'),
    );
  });

  it("writes the template's Vitest config, with no path aliases to resolve", async () => {
    const tree = tsPreset();
    await generate(tree, { directory: 'packages/ui' });
    assert.equal(tree.read('packages/ui/vitest.config.mts', 'utf-8'), native.vitestConfig(false));
    assert.equal(readJson(tree, 'package.json').devDependencies['@nx/vite'], undefined);
  });

  it('keeps the tests out of the build, and typechecks them in a project reference of their own', async () => {
    const tree = tsPreset();
    await generate(tree, { directory: 'packages/ui' });
    assert.deepEqual(readJson(tree, 'packages/ui/tsconfig.lib.json').exclude, ['src/**/*.test.ts']);
    assert.deepEqual(readJson(tree, 'packages/ui/tsconfig.spec.json'), {
      extends: '../../tsconfig.base.json',
      compilerOptions: { outDir: './out-tsc/vitest', allowImportingTsExtensions: true },
      include: ['vitest.config.mts', 'src/**/*.test.ts'],
      references: [{ path: './tsconfig.lib.json' }],
    });
    assert.deepEqual(readJson(tree, 'packages/ui/tsconfig.json').references, [
      { path: './tsconfig.lib.json' },
      { path: './tsconfig.spec.json' },
    ]);
  });

  it("lists what it imports in the library's own package.json, which pnpm links from", async () => {
    const tree = tsPreset();
    await generate(tree, { directory: 'packages/ui' });
    const manifest = readJson(tree, 'packages/ui/package.json');
    assert.deepEqual(manifest.dependencies, {
      '@angular/core': native.dependencies['@angular/core'],
      '@ng-native/components': native.dependencies['@ng-native/components'],
    });
    assert.deepEqual(manifest.devDependencies, {
      '@ng-native/testing': native.devDependencies['@ng-native/testing'],
      vitest: native.devDependencies.vitest,
    });
    assert.equal(manifest.nx.targets.test.options.command, 'vitest run');
  });
});
