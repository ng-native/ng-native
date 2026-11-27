/**
 * The generators as `turbo gen` sees them: what `ngNative(plop)` registers, and an action run with
 * the answers Turborepo passes, the workspace's root among them.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { workspace } from './test-workspace.ts';

const require = createRequire(import.meta.url);
const { ngNative } = require('./index.cjs');

type Generator = {
  description: string;
  prompts: { name: string; message?: unknown; default?: unknown }[];
  actions: ((answers: object) => Promise<string>)[];
};

function registered() {
  const generators: Record<string, Generator> = {};
  ngNative({ setGenerator: (name: string, config: Generator) => (generators[name] = config) });
  return generators;
}

describe('ngNative(plop)', () => {
  it('is the export index.d.ts declares, by name and as the default', () => {
    const module = require('./index.cjs');
    assert.equal(typeof module.ngNative, 'function');
    assert.equal(module.default, module.ngNative);
    // Callable as the module itself, which is what a default import of CommonJS gives in Node.
    assert.equal(module, module.ngNative);
    const declared = readFileSync(path.join(import.meta.dirname, 'index.d.ts'), 'utf8');
    assert.match(declared, /export declare function ngNative\(plop: GeneratorRegistry\): void;/);
    assert.match(declared, /export default ngNative;/);
  });

  it('registers the four generators, each prompting in the order --args fills', () => {
    const generators = registered();
    const prompts = Object.fromEntries(
      Object.entries(generators).map(([name, { prompts }]) => [name, prompts.map((p) => p.name)]),
    );
    assert.deepEqual(prompts, {
      'ng-native-app': ['directory', 'linter'],
      'ng-native-library': ['directory'],
      'ng-native-component': ['name', 'package'],
      'ng-native-sync': [],
    });
  });

  it('writes into the root turbo gen passes, wherever it was run from', async () => {
    const files = workspace();
    const [action] = registered()['ng-native-library'].actions;
    const message = await action({
      directory: 'packages/design-kit',
      turbo: { paths: { root: files.root } },
    });
    assert.match(message, /Created @repo\/design-kit in packages\/design-kit/);
    assert.ok(files.exists('packages/design-kit/src/lib/design-kit.ts'));
  });

  it("puts a library where create-turbo's own is not, when the default is taken", async () => {
    const files = workspace();
    assert.ok(files.exists('packages/ui/package.json'));
    const { prompts, actions } = registered()['ng-native-library'];
    const directory = prompts[0].default as string;
    assert.equal(directory, 'packages/native-ui');
    await actions[0]({ directory, turbo: { paths: { root: files.root } } });
    assert.equal(files.readJson('packages/native-ui/package.json').name, '@repo/native-ui');
  });

  it("drops a failure's full stop, which turbo gen follows with one of its own", async () => {
    const files = workspace({ 'packages/ui/package.json': '{}' });
    const [action] = registered()['ng-native-library'].actions;
    await assert.rejects(
      action({ directory: 'packages/ui', turbo: { paths: { root: files.root } } }),
      (error: Error) =>
        error.message === 'packages/ui already has a package.json. Choose another directory',
    );
  });

  it("lists the workspace's apps and libraries in the component's prompt, from where it runs", () => {
    const files = workspace({
      'turbo.json': '{}',
      'apps/mobile/package.json': JSON.stringify({
        name: '@acme/mobile',
        dependencies: { '@ng-native/platform': '0.25.0' },
      }),
      'apps/mobile/app.json': '{}',
      'packages/ui/package.json': JSON.stringify({
        name: '@acme/ui',
        peerDependencies: { '@ng-native/components': '>=0.25.0' },
      }),
    });
    const [, which] = registered()['ng-native-component'].prompts;
    const cwd = process.cwd();
    process.chdir(`${files.root}/packages/ui`);
    try {
      assert.equal(
        (which.message as () => string)(),
        'Which app or library should it go in? (@acme/mobile, @acme/ui)',
      );
      assert.equal((which.default as () => string)(), '@acme/mobile');
    } finally {
      process.chdir(cwd);
    }
  });

  it('runs sync as a generator, saying what it added', async () => {
    const files = workspace();
    const [action] = registered()['ng-native-sync'].actions;
    assert.equal(
      await action({ turbo: { paths: { root: files.root } } }),
      'Every app lists the native modules it needs.',
    );
  });
});
