/**
 * `ng add @ng-native/schematics`: the application schematic, with the name defaulted.
 *
 * `ng add` has already installed this package by the time this runs. What it adds is a second
 * project, the native app, and leaves the workspace's existing projects as they were: an Angular
 * CLI workspace cannot become a native app, because `@angular/build` has no native target, so the
 * native app lives beside the web one and Metro builds it.
 */
const { application } = require('../application/index.cjs');

/** @param {{ name?: string, directory?: string, bundleIdentifier?: string, skipInstall?: boolean }} options */
function ngAdd(options) {
  return application({ ...options, name: options.name ?? 'native', prefix: 'app' });
}

module.exports = { ngAdd };
