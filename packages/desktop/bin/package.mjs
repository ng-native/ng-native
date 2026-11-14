/**
 * `ng-native-desktop package`: the app as something to hand to someone.
 *
 * - `--format app` (the default): an ad-hoc signed `.app`, for this Mac and for testing.
 * - `--format dmg`: Developer ID signed with the hardened runtime, notarised and stapled, in a
 *   `.dmg`. With `--feed-url`, Sparkle is embedded with that appcast and the `.zip` it updates from
 *   is made beside the `.dmg`. `--skip-notarize` makes the same `.dmg` without Apple, signed with
 *   `NGN_SIGN_IDENTITY` or ad hoc, for testing the package on this Mac only.
 * - `--format mas`: sandboxed, signed for the Mac App Store, in a `.pkg`. Capabilities the App
 *   Sandbox forbids are named before it is built.
 *
 * Release builds are universal (arm64 and x86_64) with a minimum of macOS 14. The bundle comes from
 * `expo export:embed`, which lays the assets out the way React Native's asset resolver reads them
 * beside an embedded bundle, compiled to Hermes bytecode by the `hermesc` built with the host's
 * Hermes, so the bytecode is the version the host runs. Credentials come from the environment (see `notaryArguments`), never
 * from app.json. Packaging needs full Xcode, for `actool` to compile the icon.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { hostCapabilities } from './app-config.mjs';
import { plist } from './plist.mjs';
import { prepareHost, readExpoConfig, UsageError } from './host.mjs';

/** The oldest macOS a packaged app runs on. */
export const MINIMUM_MACOS = '14.0';

/** Where the packages go, in the app's directory, unless `--output` says otherwise. */
export const DEFAULT_OUTPUT = 'dist/macos';

const FORMATS = ['app', 'dmg', 'mas'];

export const PACKAGE_USAGE = `Usage: ng-native-desktop package [--format app|dmg|mas] [--output <dir>] [--feed-url <url> [--sparkle-key <key>]] [--skip-notarize]

Builds the app for release, universal for arm64 and x86_64, into dist/macos. Needs full Xcode.

  --format app      an ad-hoc signed .app (default)
  --format dmg      a Developer ID signed, notarised and stapled .dmg
  --format mas      a sandboxed Mac App Store .pkg
  --output <dir>    where the packages go (default: dist/macos)
  --feed-url <url>  dmg only: the Sparkle appcast the app updates from, embedding Sparkle
  --sparkle-key <key>  with --feed-url: Sparkle's public EdDSA key, which updates are checked
                    against (or NGN_SPARKLE_PUBLIC_KEY)
  --skip-notarize   dmg only, for testing on this Mac: no notarisation, and signed ad hoc
                    unless NGN_SIGN_IDENTITY is set. Gatekeeper refuses it on any other Mac.

Signing and notarising read the environment:
  NGN_SIGN_IDENTITY             the codesign identity (dmg: Developer ID Application, mas: Apple Distribution)
  NGN_NOTARY_PROFILE            a notarytool keychain profile (xcrun notarytool store-credentials), or
  APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER        an App Store Connect API key
  mas: NGN_INSTALLER_IDENTITY, NGN_PROVISIONING_PROFILE and APPLE_TEAM_ID
  dmg with ios.usesAppleSignIn: NGN_PROVISIONING_PROFILE (Developer ID) and APPLE_TEAM_ID`;

/**
 * @typedef {{ command: 'package', format: 'app' | 'dmg' | 'mas', output: string, feedUrl: string | undefined, sparkleKey: string | undefined, skipNotarize: boolean }} PackageCommand
 * @typedef {import('./host.mjs').system} System
 * @typedef {import('./app-config.mjs').DesktopAppConfig} DesktopAppConfig
 */

/**
 * @param {string[]} args the arguments after `package`
 * @returns {PackageCommand}
 */
export function parsePackage(args) {
  const { values } = parseArgs({
    args,
    options: {
      format: { type: 'string', default: 'app' },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      'feed-url': { type: 'string' },
      'sparkle-key': { type: 'string' },
      'skip-notarize': { type: 'boolean', default: false },
    },
  });
  const format = values.format;
  if (!FORMATS.includes(format)) {
    throw new UsageError(`--format takes app, dmg or mas, not "${format}".`);
  }
  const feedUrl = values['feed-url'];
  if (feedUrl !== undefined) {
    if (format !== 'dmg') {
      throw new UsageError(
        `--feed-url is for --format dmg only: ${format === 'mas' ? 'the Mac App Store updates a mas build itself' : 'an app build has no updater'}.`,
      );
    }
    if (!/^https:\/\/[^\s/]+/.test(feedUrl)) {
      throw new UsageError(
        `--feed-url takes the https URL of a Sparkle appcast, not "${feedUrl}".`,
      );
    }
  }
  const sparkleKey = values['sparkle-key'];
  if (sparkleKey !== undefined && feedUrl === undefined) {
    throw new UsageError(
      '--sparkle-key goes with --feed-url, the appcast whose updates it checks.',
    );
  }
  const skipNotarize = values['skip-notarize'];
  if (skipNotarize && format !== 'dmg') {
    throw new UsageError(
      `--skip-notarize is for --format dmg only: ${format === 'mas' ? 'the Mac App Store notarises a mas build itself' : 'an app build is never notarised'}.`,
    );
  }
  return {
    command: 'package',
    format: /** @type {'app' | 'dmg' | 'mas'} */ (format),
    output: values.output,
    feedUrl,
    sparkleKey,
    skipNotarize,
  };
}

/**
 * Stops before anything is built unless full Xcode is selected: the Command Line Tools have no
 * `actool`, which compiles the app icon (and macOS 26's `.icon` files).
 *
 * @param {System} sys
 */
export function checkXcode(sys) {
  const fix =
    'Packaging needs full Xcode for the app icon, which the Command Line Tools cannot compile. ' +
    'Install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app';
  const selected = sys.run('xcode-select', ['-p'], { capture: true });
  if (selected.status !== 0 || /CommandLineTools/.test(selected.stdout)) throw new UsageError(fix);
  if (sys.run('xcrun', ['--find', 'actool'], { capture: true }).status !== 0) {
    throw new UsageError(fix);
  }
}

/**
 * The credentials `notarytool` takes, from the environment: a keychain profile or an App Store
 * Connect API key (the one to use in CI). An app-specific password is refused, because notarytool
 * takes it only as an argument, which any process can read. Throws
 * naming what is missing, so a half-set group never reads as no notarisation.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function notaryArguments(env) {
  if (env['NGN_NOTARY_PROFILE']) return ['--keychain-profile', env['NGN_NOTARY_PROFILE']];
  const groups = [
    {
      names: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
      flags: ['--key', '--key-id', '--issuer'],
    },
  ];
  for (const { names, flags } of groups) {
    const set = names.filter((name) => env[name]);
    if (set.length === names.length) {
      return names.flatMap((name, index) => [
        /** @type {string} */ (flags[index]),
        String(env[name]),
      ]);
    }
    if (set.length > 0) {
      const missing = names.filter((name) => !env[name]);
      throw new UsageError(`Notarising with ${set.join(', ')} needs ${missing.join(' and ')} too.`);
    }
  }
  // notarytool takes an app-specific password only as a --password argument, which every process
  // on the Mac can read, so it is read from the keychain instead.
  const password = env['APPLE_APP_SPECIFIC_PASSWORD']
    ? 'APPLE_APP_SPECIFIC_PASSWORD is not read, because notarytool would take it as an argument ' +
      'any process can see. Store it in the keychain once with xcrun notarytool store-credentials ' +
      '<profile>, which prompts for it, and set NGN_NOTARY_PROFILE to the profile. '
    : '';
  throw new UsageError(
    `${password}--format dmg notarises the app, and found no credentials. Set NGN_NOTARY_PROFILE ` +
      'to a notarytool keychain profile, or APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER.',
  );
}

/** What each refusal of a dmg's credentials adds, for someone only trying the package out. */
const SKIP_NOTARIZE_HINT =
  ' To try the package on this Mac without them, add --skip-notarize, which makes a dmg no other Mac opens.';

/**
 * A `--skip-notarize` dmg's signing: `NGN_SIGN_IDENTITY` when set, else ad hoc, and no notary.
 *
 * @param {string | undefined} feedUrl
 * @param {Record<string, string | undefined>} env
 */
function localSigning(feedUrl, env) {
  const identity = env['NGN_SIGN_IDENTITY'];
  if (!identity && feedUrl) {
    throw new UsageError(
      '--feed-url needs NGN_SIGN_IDENTITY even with --skip-notarize: Sparkle loads only into an ' +
        'app signed with a Team ID, and an ad hoc signature has none.',
    );
  }
  return {
    identity: identity || '-',
    installer: undefined,
    // A dmg signed for Sign in with Apple embeds a profile, under --skip-notarize too.
    profile: env['NGN_PROVISIONING_PROFILE'],
    team: env['APPLE_TEAM_ID'],
    notary: null,
  };
}

/**
 * What a dmg signed for Sign in with Apple needs: a restricted entitlement is honoured only in an
 * app signed with a Team ID whose embedded profile grants it, a Developer ID profile for a dmg.
 */
const DMG_SIGN_IN = ['NGN_SIGN_IDENTITY', 'NGN_PROVISIONING_PROFILE', 'APPLE_TEAM_ID'];

/**
 * The environment variables a format needs, by name, each checked before anything is built. A
 * `dmg` with `--skip-notarize` needs none: it signs with `NGN_SIGN_IDENTITY` when that is set and
 * ad hoc (`-`) when not, and never asks Apple.
 *
 * @param {PackageCommand} options
 * @param {Record<string, string | undefined>} env
 */
function credentials({ format, skipNotarize, feedUrl }, env) {
  if (format === 'app') return null;
  if (format === 'dmg' && skipNotarize) return localSigning(feedUrl, env);
  const required =
    format === 'dmg'
      ? ['NGN_SIGN_IDENTITY']
      : [
          'NGN_SIGN_IDENTITY',
          'NGN_INSTALLER_IDENTITY',
          'NGN_PROVISIONING_PROFILE',
          'APPLE_TEAM_ID',
        ];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    const hint = format === 'dmg' ? SKIP_NOTARIZE_HINT : '';
    throw new UsageError(
      `--format ${format} needs ${missing.join(', ')} set in the environment.${hint}`,
    );
  }
  let notary = null;
  if (format === 'dmg') {
    try {
      notary = notaryArguments(env);
    } catch (error) {
      if (error instanceof UsageError) throw new UsageError(error.message + SKIP_NOTARIZE_HINT);
      throw error;
    }
  }
  return {
    identity: String(env['NGN_SIGN_IDENTITY']),
    installer: env['NGN_INSTALLER_IDENTITY'],
    profile: env['NGN_PROVISIONING_PROFILE'],
    team: env['APPLE_TEAM_ID'],
    notary,
  };
}

/**
 * What a `mas` build cannot do inside the App Sandbox, one line each. Those capabilities report
 * themselves absent in the build.
 *
 * @param {DesktopAppConfig} config
 */
export function sandboxProblems(config) {
  const capabilities = config.options.capabilities ?? {};
  const problems = [];
  if ((capabilities.spawn ?? []).length > 0) {
    problems.push(
      'capabilities.spawn: the App Sandbox runs no program outside the app, so Processes.spawn is absent in a mas build.',
    );
  }
  if ((capabilities.paths ?? []).length > 0) {
    problems.push(
      'capabilities.paths: the App Sandbox reaches only the files the user picks, so declared paths are absent in a mas build.',
    );
  }
  return problems;
}

/**
 * The app's `Info.plist`: the Expo keys' settings, the document types and URL schemes, what the
 * host reads before JavaScript runs (the bundle, the capabilities, the updates server and how it
 * was distributed, and the certificate updates are signed with), and Sparkle's feed and public key
 * in a `dmg` that has one. Sparkle checks for updates on its own schedule by default
 * (`SUEnableAutomaticChecks`), so it does not ask the user on the second launch whether to.
 *
 * @param {DesktopAppConfig} config
 * @param {{ format: 'app' | 'dmg' | 'mas', executable: string, bundleIdentifier: string, iconName: string | null, feedUrl?: string, sparkleKey?: string, updatesCertificate?: string }} options
 */
export function infoPlist(
  config,
  { format, executable, bundleIdentifier, iconName, feedUrl, sparkleKey, updatesCertificate },
) {
  const signing = updatesCertificate
    ? {
        NGNUpdatesCodeSigningCertificate: updatesCertificate,
        NGNUpdatesCodeSigningKeyId: config.updatesCodeSigning?.keyId ?? 'main',
        NGNUpdatesCodeSigningAlg: config.updatesCodeSigning?.alg ?? 'rsa-v1_5-sha256',
      }
    : {};
  const { options, permissions } = config;
  return plist({
    CFBundleDevelopmentRegion: 'en',
    CFBundleDisplayName: config.name,
    CFBundleExecutable: executable,
    CFBundleIdentifier: bundleIdentifier,
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: config.name,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: config.version,
    CFBundleVersion: config.buildNumber,
    CFBundleIconName: iconName,
    CFBundleIconFile: iconName,
    CFBundleURLTypes:
      config.schemes.length > 0
        ? [{ CFBundleURLName: bundleIdentifier, CFBundleURLSchemes: config.schemes }]
        : undefined,
    CFBundleDocumentTypes: options.documentTypes?.map((type) => ({
      CFBundleTypeName: type.name,
      CFBundleTypeRole: type.role === 'viewer' ? 'Viewer' : 'Editor',
      CFBundleTypeExtensions: [...type.extensions],
      LSItemContentTypes: type.utis ? [...type.utis] : undefined,
      CFBundleTypeIconFile: type.icon ? path.basename(type.icon) : undefined,
    })),
    LSMinimumSystemVersion: MINIMUM_MACOS,
    NSHighResolutionCapable: true,
    NSPrincipalClass: 'NSApplication',
    ...permissions.usageStrings,
    NGNBundleFile: 'main.jsbundle',
    NGNModuleName: 'main',
    NGNDistribution: format,
    NGNCapabilities: hostCapabilities(options),
    NGNUpdatesURL: config.updatesUrl,
    NGNRuntimeVersion: config.runtimeVersion,
    ...signing,
    SUFeedURL: feedUrl,
    SUPublicEDKey: feedUrl ? sparkleKey : undefined,
    SUEnableAutomaticChecks: feedUrl ? true : undefined,
  });
}

/** The package whose use signs an app for Sign in with Apple. */
const APPLE_AUTHENTICATION = 'expo-apple-authentication';

/**
 * Whether each format is signed with the Sign in with Apple entitlement, decided as the iOS build
 * decides it: a `mas` build whenever the app uses `expo-apple-authentication` (its config plugin
 * listed, or the package installed, which Expo applies the plugin for) or sets
 * `ios.usesAppleSignIn`; a `dmg` only when `ios.usesAppleSignIn` asks, since it then needs a
 * Developer ID profile that a dmg has no other use for.
 *
 * @param {import('./app-config.mjs').ExpoConfig} expo
 * @param {boolean} installed whether the app has `expo-apple-authentication` installed
 */
export function appleSignIn(expo, installed) {
  const listed = (expo.plugins ?? []).some(
    (entry) => (Array.isArray(entry) ? entry[0] : entry) === APPLE_AUTHENTICATION,
  );
  const asked = expo.ios?.usesAppleSignIn === true;
  return { mas: asked || listed || installed, dmg: asked };
}

/**
 * Whether this build is signed for Sign in with Apple (`appleSignIn`). A dmg that is needs a
 * signing identity, a Developer ID profile and its team, checked before anything is built: macOS
 * opens no app with a restricted entitlement and no profile granting it.
 *
 * @param {System} sys
 * @param {import('./app-config.mjs').ExpoConfig} expo
 * @param {'app' | 'dmg' | 'mas'} format
 */
function signsInWithApple(sys, expo, format) {
  const uses = appleSignIn(expo, sys.resolvePackage(sys.cwd(), APPLE_AUTHENTICATION) !== null);
  if (format === 'mas') return uses.mas;
  if (format !== 'dmg' || !uses.dmg) return false;
  const missing = DMG_SIGN_IN.filter((name) => !sys.env[name]);
  if (missing.length > 0) {
    throw new UsageError(
      `Sign in with Apple (ios.usesAppleSignIn) in a dmg needs ${missing.join(', ')} set in the ` +
        'environment: a Developer ID provisioning profile with the Sign in with Apple capability, ' +
        'and its team. Without them macOS would not open the app.',
    );
  }
  return true;
}

/**
 * The entitlements the app is signed with: none for `app`; for `dmg` the hardened runtime's for
 * the devices and data the usage strings declare; for `mas` the App Sandbox with those, the
 * network, the files the user picks, and the app's identity on the team. `appleSignIn` adds Sign
 * in with Apple, and to a `dmg` the app's identity on the team, which its profile is for.
 *
 * @param {DesktopAppConfig} config
 * @param {'app' | 'dmg' | 'mas'} format
 * @param {{ bundleIdentifier: string, team?: string, appleSignIn?: boolean }} identity
 * @returns {string | null}
 */
export function entitlements(config, format, { bundleIdentifier, team, appleSignIn = false }) {
  if (format === 'app') return null;
  /** @type {import('./plist.mjs').PlistDict} */
  const granted = Object.fromEntries(
    config.permissions.sandboxEntitlements.map((entitlement) => [entitlement, true]),
  );
  if (appleSignIn) granted['com.apple.developer.applesignin'] = ['Default'];
  if (format === 'dmg') {
    if (!appleSignIn) return plist(granted);
    return plist({
      ...granted,
      'com.apple.application-identifier': `${team}.${bundleIdentifier}`,
      'com.apple.developer.team-identifier': team,
    });
  }
  return plist({
    'com.apple.security.app-sandbox': true,
    'com.apple.security.network.client': true,
    'com.apple.security.files.user-selected.read-write': true,
    // The bookmarks that keep the user's picks reachable in later launches.
    'com.apple.security.files.bookmarks.app-scope': true,
    ...granted,
    'com.apple.application-identifier': `${team}.${bundleIdentifier}`,
    'com.apple.developer.team-identifier': team,
  });
}

/** The point sizes of a macOS app icon, each at 1x and 2x. */
const ICON_SIZES = [16, 32, 128, 256, 512];

/**
 * Compiles the app icon into `resources` with `actool`, and answers its name for `Info.plist`. An
 * Icon Composer `.icon` folder goes to `actool` as it is; an image is first scaled into an asset
 * catalog's icon set with `sips`.
 *
 * @param {System} sys
 * @param {string} icon the icon's absolute path
 * @param {string} resources the bundle's Resources folder
 * @param {string} staging a folder for what is built on the way
 */
export function compileIcon(sys, icon, resources, staging) {
  const composer = icon.endsWith('.icon');
  const name = composer ? path.basename(icon, '.icon') : 'AppIcon';
  let input = icon;
  if (!composer) {
    const catalog = path.join(staging, 'Assets.xcassets');
    const set = path.join(catalog, 'AppIcon.appiconset');
    const images = ICON_SIZES.flatMap((size) =>
      [1, 2].map((scale) => ({
        size: `${size}x${size}`,
        scale: `${scale}x`,
        idiom: 'mac',
        filename: `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`,
        pixels: size * scale,
      })),
    );
    sys.writeFile(path.join(catalog, 'Contents.json'), JSON.stringify({ info: { version: 1 } }));
    // Written first: it makes the set's folder, and sips writes into a folder only when it is there.
    const contents = images.map(({ pixels: _, ...entry }) => entry);
    sys.writeFile(
      path.join(set, 'Contents.json'),
      JSON.stringify({ images: contents, info: { version: 1 } }, null, 2),
    );
    for (const image of images) {
      const out = path.join(set, image.filename);
      const px = String(image.pixels);
      expectSuccess(
        sys.run('sips', ['-s', 'format', 'png', '-z', px, px, icon, '--out', out], {
          capture: true,
        }),
        `sips could not scale ${icon} to ${px} pixels.`,
      );
    }
    input = catalog;
  }
  expectSuccess(
    sys.run('xcrun', [
      'actool',
      input,
      '--compile',
      resources,
      '--platform',
      'macosx',
      '--minimum-deployment-target',
      MINIMUM_MACOS,
      '--app-icon',
      name,
      '--output-partial-info-plist',
      path.join(staging, 'icon-info.plist'),
    ]),
    `actool could not compile the app icon ${icon}.`,
  );
  return name;
}

/**
 * @param {{ status: number }} result
 * @param {string} message
 */
function expectSuccess(result, message) {
  if (result.status !== 0) throw new Error(message);
}

/**
 * Submits `file` to Apple's notary service and waits, failing unless Apple accepts it, then staples
 * the ticket to `staple`. The status is read from notarytool's JSON, so a rejected submission never
 * reads as done. stapler takes an app or a dmg and refuses a zip, so an app sent as a zip is
 * stapled itself.
 *
 * @param {System} sys
 * @param {string} file
 * @param {string[]} notary
 * @param {string} [staple]
 */
function notarise(sys, file, notary, staple = file) {
  const result = sys.run(
    'xcrun',
    ['notarytool', 'submit', file, '--wait', '--output-format', 'json', ...notary],
    { capture: true },
  );
  /** @type {{ status?: string, id?: string } | null} */
  let answer = null;
  try {
    answer = JSON.parse(result.stdout);
  } catch {
    answer = null;
  }
  if (result.status !== 0 || answer?.status !== 'Accepted') {
    const id = answer?.id ? ` Run xcrun notarytool log ${answer.id} for Apple's reasons.` : '';
    throw new Error(
      `Apple did not notarise ${path.basename(file)}: ${answer?.status ?? 'no answer'}.${id}`,
    );
  }
  expectSuccess(
    sys.run('xcrun', ['stapler', 'staple', staple]),
    `stapler could not staple ${path.basename(staple)}.`,
  );
}

/**
 * Sparkle's public EdDSA key for a package with a feed: `--sparkle-key`, else
 * `NGN_SPARKLE_PUBLIC_KEY`. Without one Sparkle would refuse every update, so it stops first.
 *
 * @param {PackageCommand} options
 * @param {Record<string, string | undefined>} env
 */
function sparkleKeyFor(options, env) {
  if (!options.feedUrl) return undefined;
  const key = options.sparkleKey ?? env['NGN_SPARKLE_PUBLIC_KEY'];
  if (!key) {
    throw new UsageError(
      "--feed-url needs Sparkle's public EdDSA key, which Sparkle checks each update against: " +
        "pass --sparkle-key or set NGN_SPARKLE_PUBLIC_KEY to the key Sparkle's generate_keys prints.",
    );
  }
  return key;
}

/**
 * The PEM certificate update manifests are signed with, read from `updates.codeSigningCertificate`.
 *
 * @param {System} sys
 * @param {string} cwd
 * @param {DesktopAppConfig} config
 */
function certificateOf(sys, cwd, config) {
  const signing = config.updatesCodeSigning;
  return signing ? sys.readFile(path.resolve(cwd, signing.certificate)) : undefined;
}

/**
 * The `hermesc` the host build in `buildDir` puts beside its binary, built with the Hermes the
 * binary links. Expo's own compiler can be another Hermes version, whose bytecode the host would
 * refuse.
 *
 * @param {System} sys
 * @param {string} buildDir
 */
export function hermesCompiler(sys, buildDir) {
  const hermesc = path.join(buildDir, 'appkit', 'hermesc');
  if (!sys.exists(hermesc)) {
    throw new Error(
      `The desktop host in ${buildDir} has no hermesc beside it, so the bundle cannot be compiled ` +
        'to Hermes bytecode. Delete that folder and package again to rebuild it.',
    );
  }
  return hermesc;
}

/**
 * Compiles the JavaScript bundle at `source` to Hermes bytecode at `out`, optimised as React
 * Native's iOS release build does.
 *
 * @param {System} sys
 * @param {string} hermesc
 * @param {string} source
 * @param {string} out
 */
function compileBytecode(sys, hermesc, source, out) {
  expectSuccess(
    sys.run(hermesc, ['-emit-binary', '-O', '-w', '-max-diagnostic-width=80', '-out', out, source]),
    'hermesc could not compile the bundle to Hermes bytecode; the output above says why.',
  );
}

/**
 * Copies each document type's icon into `resources`. The plist names it by its file, which has to
 * be in the bundle for Finder to find it.
 *
 * @param {System} sys
 * @param {string} cwd
 * @param {DesktopAppConfig} config
 * @param {string} resources
 */
function copyDocumentIcons(sys, cwd, config, resources) {
  for (const type of config.options.documentTypes ?? []) {
    if (type.icon) {
      sys.copy(path.resolve(cwd, type.icon), path.join(resources, path.basename(type.icon)));
    }
  }
}

/**
 * Builds the app and makes the package `options.format` asks for. Returns the exit status.
 *
 * @param {PackageCommand} options
 * @param {System} sys
 */
export async function packageApp(options, sys) {
  if (sys.platform !== 'darwin') {
    throw new UsageError('Packaging for macOS runs on macOS only.');
  }
  checkXcode(sys);
  const expo = readExpoConfig(sys, sys.cwd());
  const signIn = signsInWithApple(sys, expo, options.format);
  const keys = credentials(options, sys.env);
  const sparkleKey = sparkleKeyFor(options, sys.env);
  const { cwd, config, buildDir } = prepareHost(sys, { universal: true, release: true, expo });
  const hermesc = hermesCompiler(sys, buildDir);
  if (options.format === 'mas') for (const line of sandboxProblems(config)) sys.warn(line);
  const bundleIdentifier = config.bundleIdentifier ?? fallbackIdentifier(options.format, expo);

  const output = path.resolve(cwd, options.output);
  const staging = path.join(cwd, '.expo', 'ng-native-desktop', 'package');
  const app = path.join(output, `${config.name}.app`);
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  sys.remove(app);
  sys.remove(staging);

  const javascript = path.join(staging, 'main.js');
  expectSuccess(
    sys.expo(cwd, [
      'export:embed',
      '--platform',
      'macos',
      '--dev',
      'false',
      '--bundle-output',
      javascript,
      '--assets-dest',
      resources,
    ]),
    'expo export:embed did not bundle the app for macos; the output above says why.',
  );
  compileBytecode(sys, hermesc, javascript, path.join(resources, 'main.jsbundle'));
  const executable = path.join(contents, 'MacOS', config.name);
  sys.copy(path.join(buildDir, 'appkit', 'ngn-macos'), executable);
  // Local symbols only, which nothing resolves at run time; the exported ones stay.
  expectSuccess(sys.run('strip', ['-x', executable]), `strip could not strip ${executable}.`);
  const iconName = config.icon
    ? compileIcon(sys, path.resolve(cwd, config.icon), resources, staging)
    : null;
  copyDocumentIcons(sys, cwd, config, resources);
  if (options.feedUrl) embedSparkle(sys, buildDir, contents);
  sys.writeFile(
    path.join(contents, 'Info.plist'),
    infoPlist(config, {
      format: options.format,
      executable: config.name,
      bundleIdentifier,
      iconName,
      feedUrl: options.feedUrl,
      sparkleKey,
      updatesCertificate: certificateOf(sys, cwd, config),
    }),
  );
  sys.writeFile(path.join(contents, 'PkgInfo'), 'APPL????');

  const made = [app];
  if (options.format === 'app') {
    expectSuccess(sys.run('codesign', ['--force', '--sign', '-', app]), 'codesign failed.');
  } else if (options.format === 'dmg' && keys) {
    made.push(
      ...shipDmg(sys, { config, app, output, staging, bundleIdentifier, keys, options, signIn }),
    );
  } else if (keys) {
    made.push(shipMas(sys, { config, app, output, staging, bundleIdentifier, keys, signIn }));
  }
  for (const file of made) console.log(path.relative(cwd, file));
  return 0;
}

/**
 * A `dmg` or `mas` build needs the app's own bundle identifier; an `app` build for this Mac makes
 * one up from the slug.
 *
 * @param {'app' | 'dmg' | 'mas'} format
 * @param {import('./app-config.mjs').ExpoConfig} expo
 */
function fallbackIdentifier(format, expo) {
  if (format !== 'app') {
    throw new UsageError(
      `--format ${format} signs the app with its bundle identifier, and app.json sets none. Set ` +
        'expo.ios.bundleIdentifier, which macOS shares with iOS.',
    );
  }
  const slug = (expo.slug ?? expo.name ?? 'app').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `dev.ngnative.${slug || 'app'}`;
}

/**
 * Sparkle, from the host build, into the app's Frameworks.
 *
 * @param {System} sys
 * @param {string} buildDir
 * @param {string} contents
 */
function embedSparkle(sys, buildDir, contents) {
  const sparkle = path.join(buildDir, 'appkit', 'Sparkle.framework');
  if (!sys.exists(sparkle)) {
    throw new Error(
      'This desktop host was built without Sparkle, so --feed-url cannot be embedded. Package ' +
        'without --feed-url, or update @ng-native/desktop.',
    );
  }
  sys.copy(sparkle, path.join(contents, 'Frameworks', 'Sparkle.framework'));
}

/**
 * Signs with the hardened runtime, notarises and staples the app, zips it for Sparkle when there
 * is a feed, then makes, signs, notarises and staples the `.dmg`. With no notary credentials
 * (`--skip-notarize`) nothing goes to Apple, and an ad hoc signature takes no timestamp, which
 * only a real identity can get.
 *
 * @param {System} sys
 * @param {{ config: DesktopAppConfig, app: string, output: string, staging: string, bundleIdentifier: string, keys: NonNullable<ReturnType<typeof credentials>>, options: PackageCommand, signIn: boolean }} build
 * @returns {string[]} the files made beside the app
 */
function shipDmg(sys, { config, app, output, staging, bundleIdentifier, keys, options, signIn }) {
  if (signIn) embedProfile(sys, keys, app);
  const file = path.join(staging, 'entitlements.plist');
  const granted = entitlements(config, 'dmg', {
    bundleIdentifier,
    team: keys.team,
    appleSignIn: signIn,
  });
  sys.writeFile(file, /** @type {string} */ (granted));
  const timestamp = keys.identity === '-' ? '--timestamp=none' : '--timestamp';
  /** @param {string} target @param {boolean} withEntitlements */
  const sign = (target, withEntitlements) =>
    expectSuccess(
      sys.run('codesign', [
        '--force',
        '--options',
        'runtime',
        timestamp,
        ...(withEntitlements ? ['--entitlements', file] : []),
        '--sign',
        keys.identity,
        target,
      ]),
      `codesign could not sign ${path.basename(target)}.`,
    );
  if (options.feedUrl) sign(path.join(app, 'Contents', 'Frameworks', 'Sparkle.framework'), false);
  sign(app, true);

  if (keys.notary) {
    const submission = path.join(staging, `${config.name}.zip`);
    zip(sys, app, submission);
    notarise(sys, submission, keys.notary, app);
  }

  const made = [];
  if (options.feedUrl) {
    const update = path.join(output, `${config.name}.zip`);
    zip(sys, app, update);
    made.push(update);
  }
  const dmg = path.join(output, `${config.name}.dmg`);
  expectSuccess(
    sys.run('hdiutil', [
      'create',
      '-volname',
      config.name,
      '-srcfolder',
      app,
      '-ov',
      '-format',
      'UDZO',
      dmg,
    ]),
    'hdiutil could not make the disk image.',
  );
  expectSuccess(
    sys.run('codesign', ['--force', timestamp, '--sign', keys.identity, dmg]),
    'codesign could not sign the disk image.',
  );
  if (keys.notary) {
    notarise(sys, dmg, keys.notary);
  } else {
    sys.warn(
      `${path.basename(dmg)} is not notarised (--skip-notarize): it is for testing on this Mac ` +
        'only, and Gatekeeper refuses it on any other.',
    );
  }
  made.push(dmg);
  return made;
}

/**
 * @param {System} sys
 * @param {string} app
 * @param {string} to
 */
function zip(sys, app, to) {
  expectSuccess(
    sys.run('ditto', ['-c', '-k', '--keepParent', app, to]),
    `ditto could not zip ${path.basename(app)}.`,
  );
}

/**
 * The provisioning profile in `NGN_PROVISIONING_PROFILE`, embedded where macOS reads it.
 *
 * @param {System} sys
 * @param {NonNullable<ReturnType<typeof credentials>>} keys
 * @param {string} app
 */
function embedProfile(sys, keys, app) {
  sys.copy(
    path.resolve(String(keys.profile)),
    path.join(app, 'Contents', 'embedded.provisionprofile'),
  );
}

/**
 * Embeds the provisioning profile, signs inside the App Sandbox and makes the installer package.
 *
 * @param {System} sys
 * @param {{ config: DesktopAppConfig, app: string, output: string, staging: string, bundleIdentifier: string, keys: NonNullable<ReturnType<typeof credentials>>, signIn: boolean }} build
 */
function shipMas(sys, { config, app, output, staging, bundleIdentifier, keys, signIn }) {
  embedProfile(sys, keys, app);
  const file = path.join(staging, 'entitlements.plist');
  const granted = entitlements(config, 'mas', {
    bundleIdentifier,
    team: keys.team,
    appleSignIn: signIn,
  });
  sys.writeFile(file, /** @type {string} */ (granted));
  expectSuccess(
    sys.run('codesign', [
      '--force',
      '--timestamp',
      '--entitlements',
      file,
      '--sign',
      keys.identity,
      app,
    ]),
    `codesign could not sign ${path.basename(app)}.`,
  );
  const pkg = path.join(output, `${config.name}.pkg`);
  expectSuccess(
    sys.run('productbuild', [
      '--component',
      app,
      '/Applications',
      '--sign',
      String(keys.installer),
      pkg,
    ]),
    'productbuild could not make the installer package.',
  );
  return pkg;
}
