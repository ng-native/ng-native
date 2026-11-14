/**
 * `@ng-native/schematics:expo`: an Expo CLI command, run in the project.
 *
 * `ng serve native` is `expo start`, `ng build native` is `expo export` and
 * `ng run native:run-ios` is `expo run:ios`. Nothing is translated: Metro builds an Angular Native
 * app, Expo drives Metro, and this is how `ng` reaches it.
 *
 * Two commands are not the Expo CLI's, because its `run` commands are a fixed list with no
 * `run:macos`: `macos` is `ng-native-desktop run`, which builds the desktop host and opens the app
 * from the dev server `ng serve` runs, and `package` is `ng-native-desktop package`, which makes the
 * `.app`, `.dmg` or Mac App Store package. Both come from `@ng-native/desktop`.
 */
const { createBuilder } = require('@angular-devkit/architect');
const { spawnBin } = require('./spawn-bin.cjs');

/** The commands `ng-native-desktop` runs in place of the Expo CLI, by its subcommand. */
const DESKTOP_COMMANDS = { macos: 'run', package: 'package' };

/**
 * The Expo CLI's arguments for a target's options.
 *
 * @param {{ command: string, args?: string[], platform?: string, port?: number, clear?: boolean }} options
 */
function expoArgs(options) {
  const args = [options.command, ...(options.args ?? [])];
  if (options.platform) args.push('--platform', options.platform);
  if (options.port) args.push('--port', String(options.port));
  if (options.clear) args.push('--clear');
  return args;
}

/**
 * `ng-native-desktop`'s arguments for a `macos` or `package` target. The port is the dev server's
 * the host loads the app from.
 *
 * @param {{ command: 'macos' | 'package', args?: string[], port?: number }} options
 */
function desktopArgs(options) {
  const args = [DESKTOP_COMMANDS[options.command], ...(options.args ?? [])];
  if (options.port) args.push('--port', String(options.port));
  return args;
}

/**
 * @param {{ command: string, args?: string[], platform?: string, port?: number, clear?: boolean }} options
 * @param {import('@angular-devkit/architect').BuilderContext} context
 */
function runCommand(options, context) {
  if (options.command in DESKTOP_COMMANDS) {
    return spawnBin('@ng-native/desktop', desktopArgs(options), context, 'ng-native-desktop');
  }
  return spawnBin('expo', expoArgs(options), context);
}

module.exports = createBuilder(runCommand);
module.exports.expoArgs = expoArgs;
module.exports.desktopArgs = desktopArgs;
module.exports.runCommand = runCommand;
