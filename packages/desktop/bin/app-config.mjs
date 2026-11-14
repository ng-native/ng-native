/**
 * What the desktop build reads from an app's Expo config. Settings Expo already has a key for come
 * from that key, the same one the iOS build reads: the bundle identifier, the URL schemes, the
 * icon, the version, the updates URL and the usage strings. The `@ng-native/desktop` plugin options
 * hold only what has no Expo key: document types, capabilities and the deny-list.
 *
 * The config plugin (`app.plugin.cjs`) and the `ng-native-desktop` command both read options
 * through here, so an option the plugin accepts is one the command can build.
 */
import { macosPermissions, validateDesktopOptions } from '@ng-native/device/desktop-options';

/** The name the plugin is listed under in `expo.plugins`. */
export const PLUGIN_NAME = '@ng-native/desktop';

/**
 * @typedef {import('@ng-native/device/desktop-options').DesktopOptions} DesktopOptions
 * @typedef {import('@ng-native/device/desktop-options').MacosPermissions} MacosPermissions
 *
 * @typedef {{
 *   name?: string,
 *   slug?: string,
 *   version?: string,
 *   scheme?: string | string[],
 *   icon?: string,
 *   runtimeVersion?: unknown,
 *   platforms?: string[],
 *   experiments?: { outOfTreePlatforms?: boolean },
 *   updates?: { url?: string, enabled?: boolean },
 *   ios?: {
 *     bundleIdentifier?: string,
 *     buildNumber?: string,
 *     scheme?: string | string[],
 *     icon?: string | { light?: string, dark?: string, tinted?: string },
 *     infoPlist?: Record<string, unknown>,
 *   },
 *   plugins?: unknown[],
 * }} ExpoConfig
 *
 * @typedef {{
 *   name: string,
 *   version: string,
 *   buildNumber: string,
 *   bundleIdentifier: string | null,
 *   schemes: string[],
 *   icon: string | null,
 *   updatesUrl: string | null,
 *   runtimeVersion: string | null,
 *   permissions: MacosPermissions,
 *   options: DesktopOptions,
 * }} DesktopAppConfig
 */

/**
 * The plugin's options as `expo.plugins` lists them, or undefined when the plugin is listed bare
 * or not at all.
 *
 * @param {ExpoConfig} config
 * @returns {unknown}
 */
export function pluginOptions(config) {
  for (const entry of config.plugins ?? []) {
    if (Array.isArray(entry) && entry[0] === PLUGIN_NAME) return entry[1];
  }
  return undefined;
}

/**
 * The desktop build's settings for an app, from its resolved Expo config. Throws, listing every
 * problem, when the plugin options are not valid.
 *
 * - `bundleIdentifier` is `ios.bundleIdentifier`: macOS and iOS share Apple's identifier, and a
 *   universal purchase needs them to be the same. Null when the app sets none.
 * - `schemes` are `scheme` and `ios.scheme`, which deep links open the app by.
 * - `icon` is `ios.icon` (an Icon Composer `.icon` folder or an image, its light variant when it
 *   has variants), else `icon`.
 * - `updatesUrl` is `updates.url`, the bundle server, unless updates are turned off.
 *
 * @param {ExpoConfig} config
 * @returns {DesktopAppConfig}
 */
export function desktopAppConfig(config) {
  const options = validateDesktopOptions(pluginOptions(config));
  const ios = config.ios ?? {};
  const version = config.version ?? '1.0.0';
  return {
    name: config.name ?? config.slug ?? 'ng-native',
    version,
    buildNumber: ios.buildNumber ?? version,
    bundleIdentifier: ios.bundleIdentifier ?? null,
    schemes: schemes(config),
    icon: iosIcon(ios.icon) ?? config.icon ?? null,
    updatesUrl: updatesUrl(config.updates),
    runtimeVersion: typeof config.runtimeVersion === 'string' ? config.runtimeVersion : null,
    permissions: macosPermissions(config),
    options,
  };
}

/**
 * @param {ExpoConfig} config
 * @returns {string[]}
 */
function schemes(config) {
  const all = [config.scheme, config.ios?.scheme].flat();
  /** @param {unknown} scheme @returns {scheme is string} */
  const named = (scheme) => typeof scheme === 'string' && scheme !== '';
  return [...new Set(all.filter(named))];
}

/** @param {NonNullable<ExpoConfig['ios']>['icon']} icon */
function iosIcon(icon) {
  if (typeof icon === 'string') return icon;
  return icon?.light ?? null;
}

/** @param {ExpoConfig['updates']} updates */
function updatesUrl(updates) {
  return updates?.enabled === false ? null : (updates?.url ?? null);
}
