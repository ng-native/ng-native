#!/usr/bin/env node
/**
 * `ng-native-turbo`, which `npx @ng-native/turbo` runs:
 *
 * - `init` makes the generators part of `turbo gen` and adds the tasks the apps run.
 * - `sync` lists in each app the native modules its libraries use. With `--check` it changes
 *   nothing and exits 1 when an app lacks one, for CI.
 *
 * The generators themselves run through `turbo gen`, which `init` sets up.
 */
const { workspaceFiles, findRoot } = require('./files.cjs');
const { init } = require('./init/index.cjs');
const { sync } = require('./sync/index.cjs');

const USAGE = `Usage: ng-native-turbo <command>

  init            Make Angular Native's generators part of turbo gen, and add the tasks the apps run
  sync [--check]  List in each app the native modules its libraries use; --check changes nothing
                  and fails when an app lacks one

Then: turbo gen ng-native-app, ng-native-library, ng-native-component or ng-native-sync.`;

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<number>} the exit code
 */
async function main(args, cwd) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (command === 'init') {
    // Where it is run, or the workspace root above, which a `turbo.json` or workspace list marks.
    console.log(await init(workspaceFiles(findRoot(cwd) ?? cwd)));
    return 0;
  }
  if (command === 'sync') {
    const root = findRoot(cwd);
    if (!root) {
      console.error('No Turborepo workspace here: run sync from inside one.');
      return 1;
    }
    const check = rest.includes('--check');
    const { changes } = await sync(workspaceFiles(root), { check });
    if (!changes.length) {
      console.log('Every app lists the native modules it needs.');
      return 0;
    }
    for (const change of changes) console.log(change);
    if (!check) return 0;
    console.error(
      'An app does not list a native module its libraries use, or its config plugin, which Expo ' +
        'applies only from app.json. Run ng-native-turbo sync to add them.',
    );
    return 1;
  }
  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2), process.cwd()).then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}

module.exports = { main };
