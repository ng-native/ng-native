/**
 * Every migration, in the one place each is written.
 *
 * `version` is the release that needs it: `nx migrate`, `ng update` and `ng-native-migrate` run a
 * migration when an upgrade crosses its version, from the version an app is on to the one it moves
 * to. A new migration takes the version of the release it ships in. `sync-app-versions` alone
 * takes this package's own, which every release moves, so every upgrade runs it.
 *
 * `packages/nx/migrations.json` and `packages/schematics/migrations.json` list each one too,
 * because that is where `nx migrate` and `ng update` look. A test in `packages/integration-tests`
 * fails when they do not match this list.
 *
 * @typedef {object} Migration
 * @property {string} name
 * @property {string} version
 * @property {string} description
 * @property {(host: import('./host.cjs').Host) => string[]} run Changes the files, and answers
 *   what is left for the developer to do, one line each.
 */
const { syncAppVersions } = require('./sync-app-versions.cjs');
const { version } = require('./package.json');

/** @type {Migration[]} */
const migrations = [
  {
    name: 'sync-app-versions',
    version,
    description:
      "Move the @ng-native packages each project's own package.json lists to the new version.",
    run: syncAppVersions,
  },
];

module.exports = { migrations };
