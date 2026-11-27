import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { workspace } from '../test-workspace.ts';

const require = createRequire(import.meta.url);
const { init, TASKS, CONFIG, CONFIG_SOURCE, DECLINED_BUILDS } = require('./index.cjs');
const native = require('../native-app.cjs');

const { version } = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'),
);

describe('init', () => {
  it('registers the generators with turbo gen, and installs this package at the root', async () => {
    const files = workspace({ 'package.json': JSON.stringify({ name: 'my-turborepo' }) });
    await init(files);
    assert.equal(files.read(CONFIG), CONFIG_SOURCE);
    assert.match(CONFIG_SOURCE, /import \{ ngNative \} from '@ng-native\/turbo';/);
    assert.match(CONFIG_SOURCE, /ngNative\(plop\);/);
    const { devDependencies } = files.readJson('package.json');
    assert.equal(devDependencies['@ng-native/turbo'], version);
    assert.equal(devDependencies.turbo, '^2.11.0');
    assert.equal(devDependencies['@turbo/gen'], '^2.11.0');
  });

  it("gives @turbo/gen the workspace's own turbo range, and leaves turbo as it is", async () => {
    const files = workspace({
      'package.json': JSON.stringify({ name: 'root', devDependencies: { turbo: '^2.5.0' } }),
    });
    await init(files);
    const { devDependencies } = files.readJson('package.json');
    assert.deepEqual(devDependencies, {
      '@ng-native/turbo': version,
      '@turbo/gen': '^2.5.0',
      turbo: '^2.5.0',
    });
  });

  it('writes a turbo.json with the tasks the apps run, where there is none', async () => {
    const files = workspace();
    await init(files);
    assert.deepEqual(files.readJson('turbo.json').tasks, TASKS);
    // The app's turbo.json extends these, so a build task it caches has to be here.
    assert.deepEqual(
      Object.keys(native.TURBO_JSON.tasks).filter((task) => !(task in TASKS)),
      [],
    );
    for (const script of Object.keys(native.scripts(native.DEFAULT_PORT, true))) {
      if (['start', 'ios', 'android'].includes(script)) continue;
      assert.ok(script in TASKS, `turbo run ${script} has no task`);
    }
  });

  it("adds only the tasks a turbo.json lacks, and keeps the workspace's own", async () => {
    const own = { build: { outputs: ['.next/**'] }, 'check-types': {} };
    const files = workspace({ 'turbo.json': JSON.stringify({ ui: 'tui', tasks: own }) });
    const message = await init(files);
    const config = files.readJson('turbo.json');
    assert.equal(config.ui, 'tui');
    assert.deepEqual(config.tasks.build, own.build);
    assert.deepEqual(Object.keys(config.tasks), [
      'build',
      'check-types',
      'typecheck',
      'test',
      'lint',
      'dev',
    ]);
    assert.match(message, /the typecheck, test, lint, dev tasks/);
  });

  it("adds them to Turborepo 1's pipeline", async () => {
    const files = workspace({ 'turbo.json': JSON.stringify({ pipeline: { build: {} } }) });
    await init(files);
    const config = files.readJson('turbo.json');
    assert.equal(config.tasks, undefined);
    assert.ok('dev' in config.pipeline);
  });

  it('leaves a turbo.json with comments, and a generator config of its own, as they are', async () => {
    const turbo = '{\n  // tasks\n  "tasks": {}\n}\n';
    const config = 'export default function generator(plop) {}\n';
    const files = workspace({ 'turbo.json': turbo, [CONFIG]: config });
    await assert.rejects(init(files), /not plain JSON/);
    assert.equal(files.read('turbo.json'), turbo);

    const message = await init(workspace({ [CONFIG]: config }));
    assert.match(message, /already exists, so it was left alone: import \{ ngNative \}/);
  });

  it('adds the tasks to a turbo.jsonc, and writes no turbo.json beside it, which turbo refuses', async () => {
    const files = workspace({ 'turbo.jsonc': JSON.stringify({ tasks: { build: {} } }) });
    assert.match(await init(files), /, and the typecheck, test, lint, dev tasks to turbo\.jsonc\./);
    assert.equal(files.exists('turbo.json'), false);
    assert.deepEqual(Object.keys(files.readJson('turbo.jsonc').tasks), Object.keys(TASKS));

    const commented = '{\n  // tasks\n  "tasks": {}\n}\n';
    const other = workspace({ 'turbo.jsonc': commented });
    await assert.rejects(init(other), /^Error: turbo\.jsonc is not plain JSON/);
    assert.equal(other.read('turbo.jsonc'), commented);
    assert.equal(other.exists('turbo.json'), false);
  });

  it("leaves a generator config of the workspace's in JavaScript, which a config.ts would hide", async () => {
    for (const ext of ['js', 'cjs', 'mts', 'mjs']) {
      const own = 'module.exports = function generator(plop) {};\n';
      const files = workspace({ [`turbo/generators/config.${ext}`]: own });
      const message = await init(files);
      assert.equal(files.exists(CONFIG), false, ext);
      assert.equal(files.read(`turbo/generators/config.${ext}`), own, ext);
      assert.match(
        message,
        new RegExp(`config\\.${ext} already exists, so it was left alone`),
        ext,
      );
    }
  });

  it("leaves a turbo.json that has every task as it is written, in the workspace's own style", async () => {
    const turbo =
      '{ "tasks": { "build": {}, "typecheck": {}, "test": {}, "lint": {}, "dev": {} } }';
    const files = workspace({ 'turbo.json': turbo });
    await init(files);
    assert.equal(files.read('turbo.json'), turbo);
  });

  it('does nothing more when run again', async () => {
    const files = workspace();
    await init(files);
    const before = [files.read('turbo.json'), files.read('package.json'), files.read(CONFIG)];
    await init(files);
    assert.deepEqual(
      [files.read('turbo.json'), files.read('package.json'), files.read(CONFIG)],
      before,
    );
  });
  describe('on pnpm 11, which refuses an install while a build is undecided', () => {
    const settings = async (yaml: string | null, manager = 'pnpm@11.25.0') => {
      const files = workspace({
        'package.json': JSON.stringify({ name: 'my-turborepo', packageManager: manager }),
        'pnpm-workspace.yaml': yaml,
      });
      const message = await init(files);
      return { yaml: files.read('pnpm-workspace.yaml'), message };
    };
    const packages = "packages:\n  - 'apps/*'\n  - 'packages/*'\n";

    it('declines esbuild in a new allowBuilds', async () => {
      assert.deepEqual(DECLINED_BUILDS, ['esbuild']);
      assert.equal(
        (await settings(packages)).yaml,
        `${packages}\nallowBuilds:\n  esbuild: false\n`,
      );
    });

    it('adds esbuild to an allowBuilds the workspace has, and keeps its decisions', async () => {
      assert.equal(
        (await settings(`${packages}allowBuilds:\n  sharp: true\n`)).yaml,
        `${packages}allowBuilds:\n  sharp: true\n  esbuild: false\n`,
      );
      const allowed = `${packages}allowBuilds:\n  esbuild: true\n`;
      assert.equal((await settings(allowed)).yaml, allowed);
    });

    it('settles the placeholder pnpm writes after it refuses an install', async () => {
      assert.equal(
        (await settings(`${packages}allowBuilds:\n  esbuild: set this to true or false\n`)).yaml,
        `${packages}allowBuilds:\n  esbuild: false\n`,
      );
    });

    it('says what to add to an allowBuilds it cannot edit as text', async () => {
      const flow = `${packages}allowBuilds: { sharp: true }\n`;
      const { yaml, message } = await settings(flow);
      assert.equal(yaml, flow);
      assert.match(message, /allowBuilds in a form this cannot add to\. Add esbuild: false/);
    });

    it('leaves a workspace without pnpm alone', async () => {
      const files = workspace({
        'package.json': JSON.stringify({ name: 'my-turborepo', workspaces: ['apps/*'] }),
        'pnpm-workspace.yaml': null,
      });
      await init(files);
      assert.equal(files.exists('pnpm-workspace.yaml'), false);
    });
  });
});
