/**
 * `linux` as a Metro platform, in the parts `linux-export.test.ts` reaches only through a whole
 * export: the Babel plugin and `Platform` answering for Linux, the preset's resolution, the
 * out-of-tree flag, and `registerLinux` teaching the installed Expo a platform it does not know.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const babel = require('@babel/core') as {
  transformSync(code: string, options: object): { code?: string | null } | null;
};
const plugin = require('@ng-native/metro/macos-babel.cjs');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { checkOutOfTreePlatforms, withMacosPlugins } = require('@ng-native/metro/macos.cjs') as {
  checkOutOfTreePlatforms(expo: object | undefined, argv?: readonly string[]): void;
  withMacosPlugins<P extends { options?: { platform?: string }; plugins?: unknown[] }>(
    params: P,
  ): P;
};

const reactNative = path.dirname(require.resolve('react-native/package.json'));
const IN_REACT_NATIVE = path.join(reactNative, 'Libraries/Alert/Alert.js');

/** `code` through the plugin alone, for a `linux` bundle, as a file at `filename`. */
function transform(code: string, filename = IN_REACT_NATIVE): string {
  return babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [[plugin, { platform: 'linux' }]],
  })!.code!;
}

describe("the desktop Babel plugin for Linux, on React Native's own files", () => {
  it("makes a check for 'ios' match 'linux' too, and one against 'ios' fail on it", () => {
    assert.equal(
      transform("if (Platform.OS === 'ios') a();"),
      `if (Platform.OS === 'ios' || Platform.OS === "linux") a();`,
    );
    assert.equal(
      transform("const b = Platform.OS !== 'ios';"),
      `const b = Platform.OS !== 'ios' && Platform.OS !== "linux";`,
    );
  });

  it("leaves the app's own checks alone, so app code sees 'linux'", () => {
    const code = "if (Platform.OS === 'ios') a();";
    assert.equal(transform(code, '/app/src/main.ts'), code);
  });
});

describe('the desktop Babel plugin for Linux, on Platform.select', () => {
  const IMPORT = "import { Platform } from 'react-native';\n";
  const select = (code: string): string =>
    transform(IMPORT + code, '/app/a.js').slice(IMPORT.length);

  it('answers from linux, then ios, then native, then default, and never from macos', () => {
    assert.equal(select('x = Platform.select({ ios: 1, linux: 5 });'), 'x = 5;');
    assert.equal(select('x = Platform.select({ macos: 4, ios: 1 });'), 'x = 1;');
    assert.equal(select('x = Platform.select({ native: 3, default: 4 });'), 'x = 3;');
    assert.equal(select('x = Platform.select({ macos: 4 });'), 'x = undefined;');
  });
});

describe("React Native's Platform on a desktop OS", () => {
  it('reports the OS, and selects from it, then ios, native and default', () => {
    // An ES module in a CommonJS package, as Metro reads it: its one export, evaluated alone.
    const source = readFileSync(
      require.resolve('@ng-native/metro/macos/desktop-platform.js'),
      'utf8',
    );
    const desktopPlatform = new Function(
      source.replace('export function', 'return function'),
    )() as (
      ios: object,
      os: string,
    ) => { OS: string; Version: string; select(spec: object): unknown };
    const linux = desktopPlatform({ OS: 'ios', Version: '26.0' }, 'linux');
    assert.equal(linux.OS, 'linux');
    assert.equal(linux.Version, '26.0');
    assert.equal(linux.select({ linux: 5, ios: 1 }), 5);
    assert.equal(linux.select({ macos: 4, ios: 1 }), 1);
    assert.equal(linux.select({ native: 3, default: 4 }), 3);
    assert.equal(linux.select({ macos: 4, default: 6 }), 6);
  });
});

describe('the transformer on Linux', () => {
  it('adds the plugin, told the OS, to a linux file', () => {
    assert.deepEqual(withMacosPlugins({ options: { platform: 'linux' }, plugins: ['a'] }).plugins, [
      'a',
      [plugin, { platform: 'linux' }],
    ]);
  });
});

describe('the preset resolving for Linux', () => {
  type Resolve = (context: object, name: string, platform: string) => unknown;
  const config = withAngularNative({
    projectRoot: '/app',
    transformer: { asyncRequireModulePath: 'expo/internal/async-require-module' },
    resolver: { sourceExts: ['ts', 'js'] },
    serializer: { getPolyfills: () => [] },
  }) as { resolver: { resolveRequest: Resolve } };
  const resolved = (name: string, platform: string, from = '/app/src/main.ts') =>
    config.resolver.resolveRequest(
      {
        originModulePath: from,
        resolveRequest: (_: object, request: string) => ({
          type: 'sourceFile',
          filePath: request.startsWith('/') ? request : `/resolved/${request}`,
        }),
      },
      name,
      platform,
    );

  it('empties expo/* and every expo- package', () => {
    assert.deepEqual(resolved('expo-crypto', 'linux'), { type: 'empty' });
    assert.deepEqual(resolved('expo/fetch', 'linux'), { type: 'empty' });
  });

  it("gives expo Linux's runtime, which installs the Intl polyfills, and macOS its own", () => {
    const linux = resolved('expo', 'linux') as { filePath: string };
    assert.equal(linux.filePath, require.resolve('@ng-native/metro/macos/expo-runtime.linux.js'));
    const macos = resolved('expo', 'macos') as { filePath: string };
    assert.equal(macos.filePath, require.resolve('@ng-native/metro/macos/expo-runtime.js'));
  });

  it("takes Linux's Platform in place of React Native's iOS one", () => {
    const ios = path.join(reactNative, 'Libraries/Utilities/Platform.ios.js');
    assert.equal(
      (resolved(ios, 'linux') as { filePath: string }).filePath,
      require.resolve('@ng-native/metro/macos/Platform.linux.js'),
    );
    assert.equal(
      (resolved(ios, 'macos') as { filePath: string }).filePath,
      require.resolve('@ng-native/metro/macos/Platform.macos.js'),
    );
  });
});

describe('the Intl polyfills a Linux bundle installs', () => {
  it('are each a file @ng-native/metro can resolve', () => {
    const intl = require.resolve('@ng-native/metro/macos/intl.js');
    const fromMetro = createRequire(intl);
    const source = readFileSync(intl, 'utf8');
    const imports = [...source.matchAll(/^import '([^']+)';$/gm)].map((match) => match[1]!);
    assert.ok(imports.length >= 8, imports.join(', '));
    for (const name of imports) assert.ok(fromMetro.resolve(name), name);
  });
});

describe("Expo's out-of-tree platforms flag, for Linux", () => {
  it('is asked for, naming Linux, when expo.platforms lists linux or the command names it', () => {
    assert.throws(
      () => checkOutOfTreePlatforms({ platforms: ['linux'] }, []),
      /Linux needs "experiments".*\n?.*leaves linux out/,
    );
    assert.throws(() => checkOutOfTreePlatforms({ platforms: ['ios'] }, ['export', '-p', 'linux']));
    assert.doesNotThrow(() =>
      checkOutOfTreePlatforms(
        { platforms: ['linux'], experiments: { outOfTreePlatforms: true } },
        [],
      ),
    );
  });
});

/**
 * Runs `script` in a Node process of its own, from this package, so the Expo modules it changes
 * are never this process's. Answers what it prints, as JSON.
 */
function inProcess(script: string): unknown {
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: import.meta.dirname,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

/** What the installed Expo answers about `linux`, before or after `registerLinux`. */
const ASK_EXPO = (register: boolean) => `
const path = require('node:path');
const root = ${JSON.stringify(import.meta.dirname)};
${register ? "require('@ng-native/metro/linux.cjs').registerLinux(root);" : ''}
const expoDir = path.dirname(require.resolve('expo/package.json', { paths: [root] }));
const near = { paths: [expoDir] };
const cliDir = path.dirname(require.resolve('@expo/cli/package.json', near));
const platforms = require(require.resolve('@expo/platforms', { paths: [cliDir] }));
const answer = (call) => { try { return call(); } catch (error) { return 'throws: ' + error.message; } };
const autolinking = require(require.resolve('expo-modules-autolinking/exports', near));
console.log(JSON.stringify({
  known: platforms.KNOWN_PLATFORMS.includes('linux'),
  outOfTree: platforms.OUT_OF_TREE_PLATFORMS.includes('linux'),
  extensions: platforms.PLATFORM_EXTENSIONS.linux ?? null,
  host: platforms.REACT_NATIVE_HOST_PACKAGES.linux ?? null,
  support: answer(() => autolinking.getSupportPackageForPlatform('linux')),
  supportMacos: answer(() => autolinking.getSupportPackageForPlatform('macos')),
}));
`;

describe('registerLinux, against the Expo installed', () => {
  it('starts from an Expo that refuses linux, so the registration is still needed', () => {
    // When this fails, Expo has learnt linux itself, or moved the data registerLinux changes:
    // look again at whether linux.cjs is still needed, and what it must change.
    assert.deepEqual(inProcess(ASK_EXPO(false)), {
      known: false,
      outOfTree: false,
      extensions: null,
      host: null,
      support: 'throws: No support package is known for platform "linux"',
      supportMacos: 'react-native-macos',
    });
  });

  it("teaches Expo's platform list and autolinking linux, with React Native's iOS files", () => {
    assert.deepEqual(inProcess(ASK_EXPO(true)), {
      known: true,
      outOfTree: true,
      extensions: ['linux', 'ios', 'native'],
      host: 'react-native',
      support: 'react-native',
      supportMacos: 'react-native-macos',
    });
  });
});

describe('the Metro preset, for an app whose expo.platforms lists linux', () => {
  it('registers linux itself, and adds it to the lists getDefaultConfig built, as expo start needs', () => {
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'linux-preset-'));
    try {
      symlinkSync(path.join(import.meta.dirname, 'node_modules'), path.join(root, 'node_modules'));
      writeFileSync(path.join(root, 'package.json'), '{ "name": "app", "main": "index.js" }\n');
      const app = (platforms: string[]) =>
        writeFileSync(
          path.join(root, 'app.json'),
          JSON.stringify({
            expo: { name: 'app', platforms, experiments: { outOfTreePlatforms: true } },
          }),
        );
      const preset = `
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const config = withAngularNative(getDefaultConfig(process.cwd()));
const platforms = require(require.resolve('@expo/platforms', {
  paths: [require('node:path').dirname(require.resolve('@expo/cli/package.json', {
    paths: [require('node:path').dirname(require.resolve('expo/package.json'))],
  }))],
}));
console.log(JSON.stringify({
  served: config.resolver.platforms.includes('linux'),
  conditions: config.resolver.unstable_conditionsByPlatform.linux ?? null,
  known: platforms.KNOWN_PLATFORMS.includes('linux'),
}));
`;
      const ask = () =>
        JSON.parse(execFileSync(process.execPath, ['-e', preset], { cwd: root, encoding: 'utf8' }));
      app(['ios', 'linux']);
      assert.deepEqual(ask(), { served: true, conditions: ['react-native'], known: true });
      app(['ios', 'macos']);
      assert.deepEqual(ask(), { served: false, conditions: null, known: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
