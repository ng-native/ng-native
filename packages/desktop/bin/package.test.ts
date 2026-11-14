import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { main, system } from './cli.mjs';
import { desktopAppConfig } from './app-config.mjs';
import {
  checkXcode,
  entitlements,
  infoPlist,
  notaryArguments,
  packageApp,
  parsePackage,
  sandboxProblems,
} from './package.mjs';
import { plist } from './plist.mjs';

const BUILD = '/cache/rn-0.88.0/host/appkit-arm64-x86_64-RelWithDebInfo';

type Call = { command: string; args: string[] };

/**
 * A Mac with full Xcode whose tools succeed, recording each one run and each file written. A tool
 * answers from `answers` by its name and first argument (`xcrun notarytool`), where it is given.
 */
function fakeMac(
  overrides: Partial<typeof system> = {},
  answers: Record<string, { status: number; stdout?: string }> = {},
) {
  const calls: Call[] = [];
  const written: Record<string, string> = {};
  const copied: [string, string][] = [];
  const removed: string[] = [];
  const sys: typeof system = {
    platform: 'darwin',
    env: {},
    cwd: () => '/apps/notes',
    resolveReactNative: () => '/apps/notes/node_modules/react-native',
    resolvePackage: () => null,
    expoConfig: () => ({
      name: 'Notes',
      slug: 'notes',
      version: '2.0.0',
      icon: './assets/icon.png',
      scheme: 'notes',
      platforms: ['macos'],
      experiments: { outOfTreePlatforms: true },
      ios: { bundleIdentifier: 'com.example.notes', buildNumber: '7' },
    }),
    expo(from, args) {
      calls.push({ command: 'expo', args: [from, ...args] });
      return { status: 0 };
    },
    links: () => ({ libraries: [], appModules: [], withoutDesktop: [], problems: [] }),
    exists: () => false,
    remove: (file) => void removed.push(file),
    copy: (from, to) => void copied.push([from, to]),
    writeFile: (file, text) => void (written[file] = text),
    readFile: () => '',
    warn: () => {},
    run(command, args) {
      calls.push({ command, args });
      const key = `${command} ${args[0]}`;
      if (answers[key]) return { stdout: '', ...answers[key] };
      if (command.endsWith('build.sh')) return { status: 0, stdout: `${BUILD}\n` };
      if (command === 'xcode-select') {
        return { status: 0, stdout: '/Applications/Xcode.app/Contents/Developer\n' };
      }
      if (key === 'xcrun notarytool') {
        return { status: 0, stdout: JSON.stringify({ id: 'abc-123', status: 'Accepted' }) };
      }
      return { status: 0, stdout: '' };
    },
    ...overrides,
  };
  return { sys, calls, written, copied, removed };
}

/** The tools run after the host is built, by name and first argument. */
const tools = (calls: Call[]) =>
  calls
    .filter((call) => !call.command.endsWith('build.sh'))
    .map((call) => `${call.command} ${call.args[0]}`);

const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const log = console.log;
  console.log = () => {};
  try {
    return await work();
  } finally {
    console.log = log;
  }
};

const DMG_ENV = {
  NGN_SIGN_IDENTITY: 'Developer ID Application: Example (TEAM123)',
  NGN_NOTARY_PROFILE: 'notes',
};
const MAS_ENV = {
  NGN_SIGN_IDENTITY: 'Apple Distribution: Example (TEAM123)',
  NGN_INSTALLER_IDENTITY: '3rd Party Mac Developer Installer: Example (TEAM123)',
  NGN_PROVISIONING_PROFILE: '/secrets/notes.provisionprofile',
  APPLE_TEAM_ID: 'TEAM123',
};

describe('parsePackage', () => {
  it('takes a format, an output folder and a feed URL, app and dist/macos by default', () => {
    assert.deepEqual(parsePackage([]), {
      command: 'package',
      format: 'app',
      output: 'dist/macos',
      feedUrl: undefined,
      sparkleKey: undefined,
    });
    assert.deepEqual(
      parsePackage(['--format', 'dmg', '--feed-url', 'https://example.com/appcast.xml']),
      {
        command: 'package',
        format: 'dmg',
        output: 'dist/macos',
        feedUrl: 'https://example.com/appcast.xml',
        sparkleKey: undefined,
      },
    );
    assert.equal(
      parsePackage(['--format', 'dmg', '--feed-url', 'https://e.com/a.xml', '--sparkle-key', 'K='])
        .sparkleKey,
      'K=',
    );
  });

  it('refuses another format, a feed URL off dmg, and a feed that is not https', () => {
    assert.throws(() => parsePackage(['--format', 'zip']), /--format takes app, dmg or mas/);
    assert.throws(
      () => parsePackage(['--format', 'mas', '--feed-url', 'https://e.com/a.xml']),
      /--feed-url is for --format dmg only: the Mac App Store updates/,
    );
    assert.throws(
      () => parsePackage(['--feed-url', 'https://e.com/a.xml']),
      /--feed-url is for --format dmg only/,
    );
    assert.throws(
      () => parsePackage(['--format', 'dmg', '--feed-url', 'http://e.com/a.xml']),
      /https URL of a Sparkle appcast/,
    );
    assert.throws(
      () => parsePackage(['--format', 'dmg', '--sparkle-key', 'K=']),
      /--sparkle-key goes with --feed-url/,
    );
  });
});

describe('checkXcode', () => {
  it('stops on the Command Line Tools, which cannot compile the icon, before anything builds', () => {
    const { sys } = fakeMac(
      {},
      {
        'xcode-select -p': { status: 0, stdout: '/Library/Developer/CommandLineTools\n' },
      },
    );
    assert.throws(() => checkXcode(sys), /needs full Xcode for the app icon[\s\S]*xcode-select -s/);
  });

  it('stops when actool is not there', () => {
    const { sys } = fakeMac({}, { 'xcrun --find': { status: 1 } });
    assert.throws(() => checkXcode(sys), /needs full Xcode/);
  });

  it('passes with Xcode selected', () => {
    assert.doesNotThrow(() => checkXcode(fakeMac().sys));
  });
});

describe('notaryArguments', () => {
  it('takes a keychain profile, an API key or an Apple ID, in that order', () => {
    assert.deepEqual(notaryArguments({ NGN_NOTARY_PROFILE: 'p', APPLE_ID: 'x' }), [
      '--keychain-profile',
      'p',
    ]);
    assert.deepEqual(
      notaryArguments({ APPLE_API_KEY: '/k.p8', APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I' }),
      ['--key', '/k.p8', '--key-id', 'K', '--issuer', 'I'],
    );
    assert.deepEqual(
      notaryArguments({
        APPLE_ID: 'me@example.com',
        APPLE_APP_SPECIFIC_PASSWORD: 'pw',
        APPLE_TEAM_ID: 'T',
      }),
      ['--apple-id', 'me@example.com', '--password', 'pw', '--team-id', 'T'],
    );
  });

  it('names what a half-set group is missing, and says how to set any when there are none', () => {
    assert.throws(
      () => notaryArguments({ APPLE_API_KEY: '/k.p8' }),
      /APPLE_API_KEY needs APPLE_API_KEY_ID and APPLE_API_ISSUER too/,
    );
    assert.throws(
      () => notaryArguments({ APPLE_ID: 'me@example.com', APPLE_TEAM_ID: 'T' }),
      /needs APPLE_APP_SPECIFIC_PASSWORD too/,
    );
    assert.throws(() => notaryArguments({}), /found no credentials. Set NGN_NOTARY_PROFILE/);
    assert.throws(() => notaryArguments({ APPLE_TEAM_ID: 'T' }), /found no credentials/);
  });
});

describe('infoPlist', () => {
  it("writes the Expo keys' settings, the schemes, documents and what the host reads first", () => {
    const config = desktopAppConfig({
      name: 'Notes',
      version: '2.0.0',
      scheme: 'notes',
      updates: { url: 'https://updates.example.com' },
      runtimeVersion: '2',
      ios: { buildNumber: '7', infoPlist: { NSMicrophoneUsageDescription: 'Dictation' } },
      plugins: [
        [
          '@ng-native/desktop',
          {
            documentTypes: [{ name: 'Markdown', extensions: ['md'], role: 'viewer' }],
            capabilities: { env: ['HOME'], paths: [{ path: '~/Notes' }] },
          },
        ],
      ],
    });
    const text = infoPlist(config, {
      format: 'dmg',
      executable: 'Notes',
      bundleIdentifier: 'com.example.notes',
      iconName: 'AppIcon',
      feedUrl: 'https://example.com/appcast.xml',
      sparkleKey: 'pfIShU4dEXqPd5ObYNfDBiQWcXozk7estwzTnF9BamQ=',
      updatesCertificate: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    });
    const expected = [
      ['CFBundleIdentifier', '<string>com.example.notes</string>'],
      ['CFBundleShortVersionString', '<string>2.0.0</string>'],
      ['CFBundleVersion', '<string>7</string>'],
      ['CFBundleIconName', '<string>AppIcon</string>'],
      ['LSMinimumSystemVersion', '<string>14.0</string>'],
      ['NSMicrophoneUsageDescription', '<string>Dictation</string>'],
      ['NGNBundleFile', '<string>main.jsbundle</string>'],
      ['NGNDistribution', '<string>dmg</string>'],
      ['NGNUpdatesURL', '<string>https://updates.example.com</string>'],
      ['NGNRuntimeVersion', '<string>2</string>'],
      ['SUFeedURL', '<string>https://example.com/appcast.xml</string>'],
      ['SUPublicEDKey', '<string>pfIShU4dEXqPd5ObYNfDBiQWcXozk7estwzTnF9BamQ=</string>'],
      ['SUEnableAutomaticChecks', '<true/>'],
      ['NGNUpdatesCodeSigningCertificate', '<string>-----BEGIN CERTIFICATE-----\nMIIB'],
      ['NGNUpdatesCodeSigningKeyId', '<string>main</string>'],
      ['NGNUpdatesCodeSigningAlg', '<string>rsa-v1_5-sha256</string>'],
    ];
    for (const [key, value] of expected) {
      assert.match(text, new RegExp(`<key>${key}</key>\\n\\t*${value}`), key);
    }
    assert.match(text, /<key>CFBundleURLSchemes<\/key>\n\t*<array>\n\t*<string>notes<\/string>/);
    assert.match(text, /<key>CFBundleTypeRole<\/key>\n\t*<string>Viewer<\/string>/);
    assert.match(text, /<key>access<\/key>\n\t*<string>read<\/string>/);
  });

  it('leaves out Sparkle, the updates server and the icon where there are none', () => {
    const text = infoPlist(desktopAppConfig({ name: 'Notes' }), {
      format: 'app',
      executable: 'Notes',
      bundleIdentifier: 'dev.ngnative.notes',
      iconName: null,
    });
    for (const key of [
      'SUFeedURL',
      'SUPublicEDKey',
      'SUEnableAutomaticChecks',
      'NGNUpdatesURL',
      'NGNUpdatesCodeSigningCertificate',
      'CFBundleIconName',
      'CFBundleURLTypes',
    ]) {
      assert.doesNotMatch(text, new RegExp(`<key>${key}</key>`), key);
    }
  });
});

describe('entitlements', () => {
  const config = desktopAppConfig({
    ios: { infoPlist: { NSCameraUsageDescription: 'Scan' } },
  });

  it('signs an app build with none, and a dmg with the devices its usage strings declare', () => {
    assert.equal(entitlements(config, 'app', { bundleIdentifier: 'a.b' }), null);
    assert.equal(
      entitlements(config, 'dmg', { bundleIdentifier: 'a.b' }),
      plist({ 'com.apple.security.device.camera': true }),
    );
  });

  it("sandboxes a mas build, with the network, the user's picks and the team's identity", () => {
    const text = entitlements(config, 'mas', {
      bundleIdentifier: 'com.example.notes',
      team: 'T1',
    })!;
    for (const key of [
      'com.apple.security.app-sandbox',
      'com.apple.security.network.client',
      'com.apple.security.files.user-selected.read-write',
      'com.apple.security.device.camera',
    ]) {
      assert.match(text, new RegExp(`<key>${key.replace(/\./g, '\\.')}</key>\\n\\t<true/>`), key);
    }
    assert.match(
      text,
      /<key>com\.apple\.application-identifier<\/key>\n\t<string>T1\.com\.example\.notes<\/string>/,
    );
  });
});

describe('sandboxProblems', () => {
  it('names the capabilities a mas build cannot have', () => {
    const config = desktopAppConfig({
      plugins: [
        [
          '@ng-native/desktop',
          {
            capabilities: {
              spawn: [{ program: 'git' }],
              paths: [{ path: '~/Projects' }],
              env: ['HOME'],
            },
          },
        ],
      ],
    });
    const problems = sandboxProblems(config);
    assert.equal(problems.length, 2);
    assert.match(problems[0]!, /^capabilities\.spawn: .*Processes\.spawn is absent in a mas build/);
    assert.match(problems[1]!, /^capabilities\.paths: /);
    assert.deepEqual(sandboxProblems(desktopAppConfig({})), []);
  });
});

describe('packageApp', () => {
  it('bundles with expo export:embed, builds the universal host and ad-hoc signs an app', async () => {
    const { sys, calls, written, copied } = fakeMac();
    assert.equal(await quiet(() => packageApp(parsePackage([]), sys)), 0);
    const build = calls.find((call) => call.command.endsWith('build.sh'))!;
    assert.ok(build.args.includes('--universal'), 'a release build is universal');
    const app = '/apps/notes/dist/macos/Notes.app';
    assert.deepEqual(calls.find((call) => call.command === 'expo')!.args, [
      '/apps/notes',
      'export:embed',
      '--platform',
      'macos',
      '--dev',
      'false',
      '--bundle-output',
      `${app}/Contents/Resources/main.jsbundle`,
      '--assets-dest',
      `${app}/Contents/Resources`,
    ]);
    assert.deepEqual(copied, [[`${BUILD}/appkit/ngn-macos`, `${app}/Contents/MacOS/Notes`]]);
    assert.match(written[`${app}/Contents/Info.plist`]!, /<string>com\.example\.notes<\/string>/);
    assert.equal(written[`${app}/Contents/PkgInfo`], 'APPL????');
    assert.deepEqual(calls.at(-1), { command: 'codesign', args: ['--force', '--sign', '-', app] });
  });

  it('checks for Xcode before it builds anything', async () => {
    const { sys, calls } = fakeMac(
      {},
      {
        'xcode-select -p': { status: 0, stdout: '/Library/Developer/CommandLineTools\n' },
      },
    );
    await assert.rejects(packageApp(parsePackage([]), sys), /needs full Xcode/);
    assert.deepEqual(
      calls.map((call) => call.command),
      ['xcode-select'],
    );
  });

  it('scales an image icon into an icon set and compiles it with actool', async () => {
    const { sys, calls, written } = fakeMac();
    await quiet(() => packageApp(parsePackage([]), sys));
    const sips = calls.filter((call) => call.command === 'sips');
    assert.equal(sips.length, 10, 'five sizes at 1x and 2x');
    assert.ok(sips.every((call) => call.args.includes('/apps/notes/assets/icon.png')));
    const actool = calls.find((call) => call.args[0] === 'actool')!;
    assert.equal(actool.args[1], '/apps/notes/.expo/ng-native-desktop/package/Assets.xcassets');
    assert.deepEqual(actool.args.slice(actool.args.indexOf('--app-icon'), -2), [
      '--app-icon',
      'AppIcon',
    ]);
    const set = JSON.parse(
      written[
        '/apps/notes/.expo/ng-native-desktop/package/Assets.xcassets/AppIcon.appiconset/Contents.json'
      ]!,
    );
    assert.deepEqual(set.images[1], {
      size: '16x16',
      scale: '2x',
      idiom: 'mac',
      filename: 'icon_16x16@2x.png',
    });
  });

  it('compiles an Icon Composer .icon as it is, named for the file', async () => {
    const { sys, calls, written } = fakeMac({
      expoConfig: () => ({
        name: 'Notes',
        platforms: ['macos'],
        experiments: { outOfTreePlatforms: true },
        ios: { bundleIdentifier: 'com.example.notes', icon: './assets/Notes.icon' },
      }),
    });
    await quiet(() => packageApp(parsePackage([]), sys));
    assert.equal(calls.filter((call) => call.command === 'sips').length, 0);
    const actool = calls.find((call) => call.args[0] === 'actool')!;
    assert.equal(actool.args[1], '/apps/notes/assets/Notes.icon');
    assert.ok(actool.args.includes('Notes'));
    assert.match(
      written['/apps/notes/dist/macos/Notes.app/Contents/Info.plist']!,
      /<key>CFBundleIconName<\/key>\n\t<string>Notes<\/string>/,
    );
  });

  it('signs with the hardened runtime, notarises and staples the app and the dmg', async () => {
    const { sys, calls } = fakeMac({ env: DMG_ENV });
    await quiet(() => packageApp(parsePackage(['--format', 'dmg']), sys));
    assert.deepEqual(tools(calls).slice(tools(calls).indexOf('codesign --force')), [
      'codesign --force',
      'ditto -c',
      'xcrun notarytool',
      'xcrun stapler',
      'hdiutil create',
      'codesign --force',
      'xcrun notarytool',
      'xcrun stapler',
    ]);
    const signApp = calls.find((call) => call.command === 'codesign')!;
    assert.deepEqual(signApp.args.slice(0, 4), ['--force', '--options', 'runtime', '--timestamp']);
    assert.ok(signApp.args.includes(DMG_ENV.NGN_SIGN_IDENTITY));
    const notary = calls.filter((call) => call.args[0] === 'notarytool');
    assert.deepEqual(notary.at(-1)!.args, [
      'notarytool',
      'submit',
      '/apps/notes/dist/macos/Notes.dmg',
      '--wait',
      '--output-format',
      'json',
      '--keychain-profile',
      'notes',
    ]);
    assert.equal(
      calls.filter((call) => call.command === 'ditto').length,
      1,
      'no Sparkle zip without a feed',
    );
  });

  it('fails when Apple rejects the submission, naming the log to read, and staples nothing', async () => {
    const { sys, calls } = fakeMac(
      { env: DMG_ENV },
      {
        'xcrun notarytool': { status: 0, stdout: JSON.stringify({ id: 'r-1', status: 'Invalid' }) },
      },
    );
    await assert.rejects(
      packageApp(parsePackage(['--format', 'dmg']), sys),
      /Apple did not notarise Notes\.zip: Invalid\. Run xcrun notarytool log r-1/,
    );
    assert.equal(calls.filter((call) => call.args[0] === 'stapler').length, 0);
  });

  it('fails on a notarytool that answers nothing it can read', async () => {
    const { sys } = fakeMac({ env: DMG_ENV }, { 'xcrun notarytool': { status: 1, stdout: '' } });
    await assert.rejects(packageApp(parsePackage(['--format', 'dmg']), sys), /no answer/);
  });

  it('embeds Sparkle with a feed, signs it first and zips the stapled app beside the dmg', async () => {
    const { sys, calls, copied, written } = fakeMac({
      env: { ...DMG_ENV, NGN_SPARKLE_PUBLIC_KEY: 'EDKEY=' },
      exists: () => true,
    });
    await quiet(() =>
      packageApp(parsePackage(['--format', 'dmg', '--feed-url', 'https://e.com/appcast.xml']), sys),
    );
    const app = '/apps/notes/dist/macos/Notes.app';
    assert.deepEqual(copied.at(-1), [
      `${BUILD}/appkit/Sparkle.framework`,
      `${app}/Contents/Frameworks/Sparkle.framework`,
    ]);
    const signed = calls
      .filter((call) => call.command === 'codesign')
      .map((call) => call.args.at(-1));
    assert.deepEqual(signed, [
      `${app}/Contents/Frameworks/Sparkle.framework`,
      app,
      '/apps/notes/dist/macos/Notes.dmg',
    ]);
    const zips = calls.filter((call) => call.command === 'ditto').map((call) => call.args.at(-1));
    assert.deepEqual(zips, [
      '/apps/notes/.expo/ng-native-desktop/package/Notes.zip',
      '/apps/notes/dist/macos/Notes.zip',
    ]);
    const stapled = calls.findIndex((call) => call.args[0] === 'stapler');
    const updateZip = calls.findIndex(
      (call) => call.args.at(-1) === '/apps/notes/dist/macos/Notes.zip',
    );
    assert.ok(stapled < updateZip, 'the zip Sparkle updates from holds the stapled app');
    assert.match(written[`${app}/Contents/Info.plist`]!, /<key>SUFeedURL<\/key>/);
    assert.match(
      written[`${app}/Contents/Info.plist`]!,
      /<key>SUPublicEDKey<\/key>\n\t*<string>EDKEY=<\/string>/,
    );
  });

  it('stops before it builds when a feed has no Sparkle public key to check updates with', async () => {
    const { sys, calls } = fakeMac({ env: DMG_ENV, exists: () => true });
    await assert.rejects(
      packageApp(parsePackage(['--format', 'dmg', '--feed-url', 'https://e.com/a.xml']), sys),
      /needs Sparkle's public EdDSA key/,
    );
    assert.ok(!calls.some((call) => call.command.endsWith('build.sh')), 'nothing built');
  });

  it("writes the updates server's code signing certificate into Info.plist", async () => {
    const read: string[] = [];
    const { sys, written } = fakeMac({
      expoConfig: () => ({
        name: 'Notes',
        platforms: ['macos'],
        experiments: { outOfTreePlatforms: true },
        ios: { bundleIdentifier: 'com.example.notes' },
        updates: {
          url: 'https://u.example.com',
          codeSigningCertificate: './certs/certificate.pem',
          codeSigningMetadata: { keyid: 'release', alg: 'rsa-v1_5-sha256' },
        },
      }),
      readFile: (file: string) => (read.push(file), '-----BEGIN CERTIFICATE-----\nX\n'),
    });
    await quiet(() => packageApp(parsePackage([]), sys));
    assert.deepEqual(read, ['/apps/notes/certs/certificate.pem']);
    const info = written['/apps/notes/dist/macos/Notes.app/Contents/Info.plist']!;
    assert.match(info, /<key>NGNUpdatesCodeSigningKeyId<\/key>\n\t*<string>release<\/string>/);
    assert.match(info, /<key>NGNUpdatesCodeSigningCertificate<\/key>\n\t*<string>-----BEGIN/);
  });

  it('stops when the host was built without Sparkle, rather than shipping no updater', async () => {
    const { sys } = fakeMac({ env: { ...DMG_ENV, NGN_SPARKLE_PUBLIC_KEY: 'EDKEY=' } });
    await assert.rejects(
      packageApp(parsePackage(['--format', 'dmg', '--feed-url', 'https://e.com/a.xml']), sys),
      /built without Sparkle/,
    );
  });

  it('needs its credentials before it builds: a dmg its identity and notary, a mas its four', async () => {
    for (const [args, env, message] of [
      [['--format', 'dmg'], {}, /--format dmg needs NGN_SIGN_IDENTITY/],
      [['--format', 'dmg'], { NGN_SIGN_IDENTITY: 'x' }, /found no credentials/],
      [
        ['--format', 'mas'],
        { NGN_SIGN_IDENTITY: 'x' },
        /--format mas needs NGN_INSTALLER_IDENTITY, NGN_PROVISIONING_PROFILE, APPLE_TEAM_ID/,
      ],
    ] as const) {
      const { sys, calls } = fakeMac({ env });
      await assert.rejects(packageApp(parsePackage([...args]), sys), message);
      assert.ok(!calls.some((call) => call.command.endsWith('build.sh')), 'nothing built');
    }
  });

  it('needs the bundle identifier for dmg and mas, and makes one up for an app', async () => {
    const config = () => ({
      slug: 'my-notes',
      platforms: ['macos'],
      experiments: { outOfTreePlatforms: true },
    });
    const { sys, written } = fakeMac({ expoConfig: config });
    await quiet(() => packageApp(parsePackage([]), sys));
    assert.match(
      written['/apps/notes/dist/macos/my-notes.app/Contents/Info.plist']!,
      /<string>dev\.ngnative\.mynotes<\/string>/,
    );
    const signed = fakeMac({ expoConfig: config, env: DMG_ENV }).sys;
    await assert.rejects(
      packageApp(parsePackage(['--format', 'dmg']), signed),
      /Set expo\.ios\.bundleIdentifier/,
    );
  });

  it('sandboxes a mas build with its profile and makes the installer package', async () => {
    const warnings: string[] = [];
    const { sys, calls, copied, written } = fakeMac({
      env: MAS_ENV,
      warn: (line) => void warnings.push(line),
      expoConfig: () => ({
        name: 'Notes',
        platforms: ['macos'],
        experiments: { outOfTreePlatforms: true },
        ios: { bundleIdentifier: 'com.example.notes' },
        plugins: [['@ng-native/desktop', { capabilities: { spawn: [{ program: 'git' }] } }]],
      }),
    });
    await quiet(() => packageApp(parsePackage(['--format', 'mas']), sys));
    const app = '/apps/notes/dist/macos/Notes.app';
    assert.deepEqual(copied.at(-1), [
      '/secrets/notes.provisionprofile',
      `${app}/Contents/embedded.provisionprofile`,
    ]);
    assert.match(
      written['/apps/notes/.expo/ng-native-desktop/package/entitlements.plist']!,
      /com\.apple\.security\.app-sandbox/,
    );
    assert.deepEqual(calls.at(-1), {
      command: 'productbuild',
      args: [
        '--component',
        app,
        '/Applications',
        '--sign',
        MAS_ENV.NGN_INSTALLER_IDENTITY,
        '/apps/notes/dist/macos/Notes.pkg',
      ],
    });
    assert.ok(!calls.some((call) => call.args[0] === 'notarytool'), 'the App Store reviews it');
    assert.match(warnings.join('\n'), /Processes\.spawn is absent in a mas build/);
  });

  it('writes into --output, relative to the app', async () => {
    const { sys, calls } = fakeMac();
    await quiet(() => packageApp(parsePackage(['--output', 'out']), sys));
    assert.deepEqual(calls.at(-1)!.args.at(-1), '/apps/notes/out/Notes.app');
  });

  it('is what ng-native-desktop package runs, failing with the usage on a bad format', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (message: string) => errors.push(message);
    try {
      assert.equal(await main(['package', '--format', 'exe'], fakeMac().sys), 2);
    } finally {
      console.error = original;
    }
    assert.match(errors[0]!, /--format takes app, dmg or mas[\s\S]*ng-native-desktop package/);
    assert.equal(await quiet(() => main(['package'], fakeMac().sys)), 0);
  });
});
