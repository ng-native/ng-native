/**
 * `npx @ng-native/turbo init`: makes this package's generators part of `turbo gen`, and gives the
 * workspace the tasks an Angular Native app runs.
 *
 * `turbo gen` runs the generators `turbo/generators/config.ts` registers, so `init` writes one that
 * registers these, or says what to add to the one the workspace has. It adds `@ng-native/turbo` to
 * the root's dev dependencies, which is where the config imports it from, `@turbo/gen` for the
 * config's types, and `turbo` when the root has none. In `turbo.json`, or `turbo.jsonc` where the
 * workspace has that instead, it adds each task the apps' scripts name that the workspace does not
 * define yet, and leaves the ones it does alone. With pnpm, it declines `esbuild`'s install script
 * in `pnpm-workspace.yaml`'s `allowBuilds`, unless the workspace has decided it already.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const native = require('../native-app.cjs');
const { asSaved } = require('@ng-native/migrate/save-exact.cjs');
const { declineBuilds } = require('@ng-native/migrate/decline-builds.cjs');
const { commandsFor, packageManager } = require('../workspace.cjs');

/** @typedef {ReturnType<typeof import('../files.cjs').workspaceFiles>} Files */

const CONFIG = 'turbo/generators/config.ts';

/**
 * Every generator config `turbo gen` loads, in the order it looks: it takes the first there is, so
 * a `config.ts` beside a workspace's `config.js` would hide the workspace's own generators.
 */
const CONFIGS = ['ts', 'js', 'cjs', 'mts', 'mjs'].map((ext) => `turbo/generators/config.${ext}`);

/** The config `turbo gen` loads, registering this package's generators. */
const CONFIG_SOURCE = `import type { PlopTypes } from '@turbo/gen';
import { ngNative } from '@ng-native/turbo';

// Angular Native's generators: turbo gen ng-native-app, ng-native-library, ng-native-component
// and ng-native-sync. See https://ng-native.com/packages/turbo
export default function generator(plop: PlopTypes.NodePlopAPI): void {
  ngNative(plop);
}
`;

/**
 * The tasks the apps and libraries run, as `init` adds them to a `turbo.json` that lacks them. An
 * app's own `turbo.json` says what its `build` and `typecheck` cache.
 */
const TASKS = {
  build: { dependsOn: ['^build'], inputs: ['$TURBO_DEFAULT$', '.env*'], outputs: ['dist/**'] },
  typecheck: { dependsOn: ['^typecheck'] },
  test: { dependsOn: ['^test'] },
  lint: {},
  dev: { cache: false, persistent: true },
};

/**
 * The dependencies with an install script that every app, library and the generators bring:
 * `esbuild`, through `@turbo/gen` and through the Vite of each package's Vitest. Its script only
 * checks the binary its optional dependency for the OS installs, so it is declined, as this
 * repository declines it. pnpm 11 refuses to install until it is decided.
 */
const DECLINED_BUILDS = ['esbuild'];

/** The `turbo` this package is tested with, for a workspace that has none. */
const TURBO = '^2.11.0';

/** This package's version, which the `@ng-native` packages share. */
function ownVersion() {
  return JSON.parse(readFileSync(path.join(native.packageDir(), 'package.json'), 'utf8')).version;
}

/**
 * Adds the tasks the workspace's `turbo.json`, or `turbo.jsonc`, lacks, or writes a `turbo.json`
 * with them all where it has neither: Turborepo stops when a directory has both.
 *
 * @param {Files} files
 * @returns {{ file: string, added: string[] }} the file, and the tasks added to it
 */
function addTasks(files) {
  const file = ['turbo.json', 'turbo.jsonc'].find((name) => files.exists(name));
  if (!file) {
    files.writeJson('turbo.json', { $schema: 'https://turborepo.com/schema.json', tasks: TASKS });
    return { file: 'turbo.json', added: Object.keys(TASKS) };
  }
  let config;
  try {
    config = files.readJson(file);
  } catch {
    throw new Error(
      `${file} is not plain JSON (it may have comments), so init leaves it alone. Add the ` +
        `tasks it lacks of ${Object.keys(TASKS).join(', ')} by hand: see ` +
        'https://ng-native.com/packages/turbo',
    );
  }
  const tasks = config.tasks ?? config.pipeline ?? {};
  const added = Object.keys(TASKS).filter((task) => !(task in tasks));
  if (!added.length) return { file, added };
  const key = config.tasks || !config.pipeline ? 'tasks' : 'pipeline';
  config[key] = { ...tasks, ...Object.fromEntries(added.map((task) => [task, TASKS[task]])) };
  files.writeJson(file, config);
  return { file, added };
}

/**
 * @param {Files} files
 * @returns {Promise<string>}
 */
async function init(files) {
  if (!files.exists('package.json')) {
    throw new Error(`${files.root} has no package.json: run init from the workspace's root.`);
  }
  const { file, added } = addTasks(files);
  const undecided = declineBuilds(files, DECLINED_BUILDS);

  const existing = CONFIGS.find((file) => files.exists(file));
  let configNote = '';
  if (!existing) {
    files.write(CONFIG, CONFIG_SOURCE);
  } else if (!files.read(existing)?.includes('@ng-native/turbo')) {
    configNote =
      ` ${existing} already exists, so it was left alone: import { ngNative } from ` +
      `'@ng-native/turbo' and call ngNative(plop) in its generator function.`;
  }

  const root = files.readJson('package.json');
  const has = { ...root.dependencies, ...root.devDependencies };
  // `@turbo/gen` at the workspace's own `turbo` range, so the config's types match the CLI.
  const turbo = has.turbo ?? TURBO;
  /** @type {Record<string, string>} */
  const wanted = { '@ng-native/turbo': ownVersion() };
  if (!has['@turbo/gen']) wanted['@turbo/gen'] = turbo;
  if (!has.turbo) wanted.turbo = turbo;
  const saved = await asSaved(files, wanted, has.turbo ? ['@turbo/gen'] : []);
  files.updateJson('package.json', (manifest) => ({
    ...manifest,
    devDependencies: Object.fromEntries(
      Object.entries({ ...manifest.devDependencies, ...saved }).sort(([a], [b]) =>
        a < b ? -1 : 1,
      ),
    ),
  }));

  const run = commandsFor(packageManager(files));
  return (
    `Added @ng-native/turbo to the workspace` +
    (added.length ? `, and the ${added.join(', ')} tasks to ${file}` : '') +
    `. Run ${run.install}, then ${run.gen('ng-native-app')} to add an app.` +
    configNote +
    (undecided ? ` ${undecided}` : '')
  );
}

module.exports = { init, TASKS, CONFIG, CONFIG_SOURCE, DECLINED_BUILDS };
