/**
 * `ng-native-desktop package`: the app as something to hand to someone.
 *
 * - `--format app` (the default): an ad-hoc signed `.app`, for this Mac and for testing.
 * - `--format dmg`: Developer ID signed with the hardened runtime, notarised and stapled, in a
 *   `.dmg`. With `--feed-url`, Sparkle is embedded with that appcast and the `.zip` it updates from
 *   is made beside the `.dmg`.
 * - `--format mas`: sandboxed, signed for the Mac App Store, in a `.pkg`. Capabilities the App
 *   Sandbox forbids are named before it is built.
 *
 * Release builds are universal (arm64 and x86_64) with a minimum of macOS 14. The bundle comes from
 * `expo export:embed`, which lays the assets out the way React Native's asset resolver reads them
 * beside an embedded bundle. Credentials come from the environment (see `notaryArguments`), never
 * from app.json. Packaging needs full Xcode, for `actool` to compile the icon.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { hostCapabilities } from './app-config.mjs';
import { plist } from './plist.mjs';
import { prepareHost, UsageError } from './host.mjs';

/** The oldest macOS a packaged app runs on. */
export const MINIMUM_MACOS = '14.0';

/** Where the packages go, in the app's directory, unless `--output` says otherwise. */
export const DEFAULT_OUTPUT = 'dist/macos';

const FORMATS = ['app', 'dmg', 'mas'];

export const PACKAGE_USAGE = `Usage: ng-native-desktop package [--format app|dmg|mas] [--output <dir>] [--feed-url <url> [--sparkle-key <key>]]

Builds the app for release, universal for arm64 and x86_64, into dist/macos. Needs full Xcode.

  --format app      an ad-hoc signed .app (default)
  --format dmg      a Developer ID signed, notarised and stapled .dmg
  --format mas      a sandboxed Mac App Store .pkg
  --output <dir>    where the packages go (default: dist/macos)
  --feed-url <url>  dmg only: the Sparkle appcast the app updates from, embedding Sparkle
  --sparkle-key <key>  with --feed-url: Sparkle's public EdDSA key, which updates are checked
                    against (or NGN_SPARKLE_PUBLIC_KEY)

Signing and notarising read the environment:
  NGN_SIGN_IDENTITY             the codesign identity (dmg: Developer ID Application, mas: Apple Distribution)
  NGN_NOTARY_PROFILE            a notarytool keychain profile, or
  APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER        an App Store Connect API key, or
  APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID     an Apple ID
  mas: NGN_INSTALLER_IDENTITY, NGN_PROVISIONING_PROFILE and APPLE_TEAM_ID`;

/**
 * @typedef {{ command: 'package', format: 'app' | 'dmg' | 'mas', output: string, feedUrl: string | undefined, sparkleKey: string | undefined }} PackageCommand
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
  return {
    command: 'package',
    format: /** @type {'app' | 'dmg' | 'mas'} */ (format),
    output: values.output,
    feedUrl,
    sparkleKey,
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
 * The credentials `notarytool` takes, from the environment: a keychain profile, an App Store
 * Connect API key (the one to use in CI), or an Apple ID with an app-specific password. Throws
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
    {
      names: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
      flags: ['--apple-id', '--password', '--team-id'],
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
    // The Apple ID group shares APPLE_TEAM_ID with mas, so the team alone does not start it.
    if (set.length > 0 && !(set.length === 1 && set[0] === 'APPLE_TEAM_ID')) {
      const missing = names.filter((name) => !env[name]);
      throw new UsageError(`Notarising with ${set.join(', ')} needs ${missing.join(' and ')} too.`);
    }
  }
  throw new UsageError(
    '--format dmg notarises the app, and found no credentials. Set NGN_NOTARY_PROFILE to a ' +
      'notarytool keychain profile, or APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or ' +
      'APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.',
  );
}

/**
 * The environment variables a format needs, by name, each checked before anything is built.
 *
 * @param {'app' | 'dmg' | 'mas'} format
 * @param {Record<string, string | undefined>} env
 */
function credentials(format, env) {
  if (format === 'app') return null;
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
    throw new UsageError(`--format ${format} needs ${missing.join(', ')} set in the environment.`);
  }
  return {
    identity: String(env['NGN_SIGN_IDENTITY']),
    installer: env['NGN_INSTALLER_IDENTITY'],
    profile: env['NGN_PROVISIONING_PROFILE'],
    team: env['APPLE_TEAM_ID'],
    notary: format === 'dmg' ? notaryArguments(env) : [],
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
      CFBundleTypeIconFile: type.icon,
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

/**
 * The entitlements the app is signed with: none for `app`; for `dmg` the hardened runtime's for
 * the devices and data the usage strings declare; for `mas` the App Sandbox with those, the
 * network, the files the user picks, and the app's identity on the team.
 *
 * @param {DesktopAppConfig} config
 * @param {'app' | 'dmg' | 'mas'} format
 * @param {{ bundleIdentifier: string, team?: string }} identity
 * @returns {string | null}
 */
export function entitlements(config, format, { bundleIdentifier, team }) {
  if (format === 'app') return null;
  /** @type {Record<string, string | boolean>} */
  const granted = Object.fromEntries(
    config.permissions.sandboxEntitlements.map((entitlement) => [entitlement, true]),
  );
  if (format === 'dmg') return plist(granted);
  return plist({
    'com.apple.security.app-sandbox': true,
    'com.apple.security.network.client': true,
    'com.apple.security.files.user-selected.read-write': true,
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
    const contents = images.map(({ pixels: _, ...entry }) => entry);
    sys.writeFile(
      path.join(set, 'Contents.json'),
      JSON.stringify({ images: contents, info: { version: 1 } }, null, 2),
    );
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
 * Submits `file` to Apple's notary service and waits, failing unless Apple accepts it. The status
 * is read from notarytool's JSON, so a rejected submission never reads as done.
 *
 * @param {System} sys
 * @param {string} file
 * @param {string[]} notary
 */
function notarise(sys, file, notary) {
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
    sys.run('xcrun', ['stapler', 'staple', file]),
    `stapler could not staple ${path.basename(file)}.`,
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
  const keys = credentials(options.format, sys.env);
  const sparkleKey = sparkleKeyFor(options, sys.env);
  const { cwd, expo, config, buildDir } = prepareHost(sys, { universal: true });
  if (options.format === 'mas') for (const line of sandboxProblems(config)) sys.warn(line);
  const bundleIdentifier = config.bundleIdentifier ?? fallbackIdentifier(options.format, expo);

  const output = path.resolve(cwd, options.output);
  const staging = path.join(cwd, '.expo', 'ng-native-desktop', 'package');
  const app = path.join(output, `${config.name}.app`);
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  sys.remove(app);
  sys.remove(staging);

  expectSuccess(
    sys.expo(cwd, [
      'export:embed',
      '--platform',
      'macos',
      '--dev',
      'false',
      '--bundle-output',
      path.join(resources, 'main.jsbundle'),
      '--assets-dest',
      resources,
    ]),
    'expo export:embed did not bundle the app for macos; the output above says why.',
  );
  sys.copy(path.join(buildDir, 'appkit', 'ngn-macos'), path.join(contents, 'MacOS', config.name));
  const iconName = config.icon
    ? compileIcon(sys, path.resolve(cwd, config.icon), resources, staging)
    : null;
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
    made.push(...shipDmg(sys, { config, app, output, staging, bundleIdentifier, keys, options }));
  } else if (keys) {
    made.push(shipMas(sys, { config, app, output, staging, bundleIdentifier, keys }));
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
 * is a feed, then makes, signs, notarises and staples the `.dmg`.
 *
 * @param {System} sys
 * @param {{ config: DesktopAppConfig, app: string, output: string, staging: string, bundleIdentifier: string, keys: NonNullable<ReturnType<typeof credentials>>, options: PackageCommand }} build
 * @returns {string[]} the files made beside the app
 */
function shipDmg(sys, { config, app, output, staging, bundleIdentifier, keys, options }) {
  const file = path.join(staging, 'entitlements.plist');
  sys.writeFile(file, /** @type {string} */ (entitlements(config, 'dmg', { bundleIdentifier })));
  /** @param {string} target @param {boolean} withEntitlements */
  const sign = (target, withEntitlements) =>
    expectSuccess(
      sys.run('codesign', [
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        ...(withEntitlements ? ['--entitlements', file] : []),
        '--sign',
        keys.identity,
        target,
      ]),
      `codesign could not sign ${path.basename(target)}.`,
    );
  if (options.feedUrl) sign(path.join(app, 'Contents', 'Frameworks', 'Sparkle.framework'), false);
  sign(app, true);

  const submission = path.join(staging, `${config.name}.zip`);
  zip(sys, app, submission);
  notarise(sys, submission, keys.notary);

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
    sys.run('codesign', ['--force', '--timestamp', '--sign', keys.identity, dmg]),
    'codesign could not sign the disk image.',
  );
  notarise(sys, dmg, keys.notary);
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
 * Embeds the provisioning profile, signs inside the App Sandbox and makes the installer package.
 *
 * @param {System} sys
 * @param {{ config: DesktopAppConfig, app: string, output: string, staging: string, bundleIdentifier: string, keys: NonNullable<ReturnType<typeof credentials>> }} build
 */
function shipMas(sys, { config, app, output, staging, bundleIdentifier, keys }) {
  sys.copy(
    path.resolve(String(keys.profile)),
    path.join(app, 'Contents', 'embedded.provisionprofile'),
  );
  const file = path.join(staging, 'entitlements.plist');
  const granted = entitlements(config, 'mas', { bundleIdentifier, team: keys.team });
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
