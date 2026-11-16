/**
 * `@ng-native/schematics:vitest`: the project's tests, once.
 *
 * Not `@angular/build:unit-test`, which compiles the tests with the workspace's web build and runs
 * them against a DOM. An Angular Native test renders onto the fake Fabric from
 * `@ng-native/testing`, compiled by the same transform Metro uses, and that is set up in the
 * project's own `vitest.config.mts`.
 */
const { createBuilder } = require('@angular-devkit/architect');
const { spawnBin } = require('./spawn-bin.cjs');

/** @param {{ watch?: boolean, filter?: string, project?: string }} options */
function vitestArgs(options) {
  const args = [options.watch ? 'watch' : 'run'];
  if (options.project) args.push('--project', options.project);
  if (options.filter) args.push(options.filter);
  return args;
}

module.exports = createBuilder((options, context) =>
  spawnBin('vitest', vitestArgs(options), context),
);
module.exports.vitestArgs = vitestArgs;
