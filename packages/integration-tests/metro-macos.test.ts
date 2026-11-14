/**
 * The parts of `macos` as a Metro platform that `macos-export.test.ts` reaches only through a whole
 * export: which of React Native's files the Babel plugin rewrites, what it leaves alone, which
 * requests the preset empties, and the error for an app that asks for macOS without Expo's flag.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const babel = require('@babel/core') as {
  transformSync(code: string, options: object): { code?: string | null } | null;
};
const plugin = require('@ng-native/metro/macos-babel.cjs');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { checkOutOfTreePlatforms, requestedPlatforms, withMacosPlugins } =
  require('@ng-native/metro/macos.cjs') as {
    checkOutOfTreePlatforms(expo: object | undefined, argv?: readonly string[]): void;
    requestedPlatforms(argv: readonly string[]): string[];
    withMacosPlugins<P extends { options?: { platform?: string }; plugins?: unknown[] }>(
      params: P,
    ): P;
  };

const reactNative = path.dirname(require.resolve('react-native/package.json'));
const IN_REACT_NATIVE = path.join(reactNative, 'Libraries/Alert/Alert.js');

/** `code` through the plugin alone, as a file at `filename`. */
function transform(code: string, filename = IN_REACT_NATIVE): string {
  return babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [plugin],
  })!.code!;
}

describe("the macOS Babel plugin, on React Native's own files", () => {
  it("makes a check for 'ios' match 'macos' too", () => {
    assert.equal(
      transform("if (Platform.OS === 'ios') a();"),
      `if (Platform.OS === 'ios' || Platform.OS === "macos") a();`,
    );
  });

  it("makes a check against 'ios' fail on 'macos' too", () => {
    assert.equal(
      transform("const b = Platform.OS !== 'ios';"),
      `const b = Platform.OS !== 'ios' && Platform.OS !== "macos";`,
    );
  });

  it('reads a check written the other way round, and loose equality', () => {
    assert.equal(
      transform("x = 'ios' == _Platform.default.OS;"),
      `x = 'ios' == _Platform.default.OS || _Platform.default.OS == "macos";`,
    );
  });

  it('leaves a check for another OS alone', () => {
    const code = "if (Platform.OS === 'android') a();";
    assert.equal(transform(code), code);
  });

  it("leaves the app's own checks alone, so app code sees 'macos'", () => {
    const code = "if (Platform.OS === 'ios') a();";
    assert.equal(transform(code, '/app/src/main.ts'), code);
  });
});

describe('the macOS Babel plugin, on Platform.select', () => {
  it('answers from macos, then ios, then native, then default', () => {
    assert.equal(transform('x = Platform.select({ ios: 1, macos: 2 });', '/app/a.js'), 'x = 2;');
    assert.equal(transform('x = Platform.select({ android: 0, ios: 1 });', '/app/a.js'), 'x = 1;');
    assert.equal(
      transform('x = Platform.select({ native: 3, default: 4 });', '/app/a.js'),
      'x = 3;',
    );
    assert.equal(transform('x = Platform.select({ default: 4 });', '/app/a.js'), 'x = 4;');
    assert.equal(transform('x = Platform.select({ android: 0 });', '/app/a.js'), 'x = undefined;');
  });

  it('leaves a select whose keys are not all written out to run', () => {
    const code = 'x = Platform.select({\n  ...more,\n  ios: 1\n});';
    assert.equal(transform(code, '/app/a.js'), code);
  });
});

describe('the macOS Babel plugin, against the React Native installed', () => {
  /** Every file of React Native's own JavaScript a `macos` bundle can take. */
  function* sources(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== '__mocks__') yield* sources(full);
      } else if (/\.js$/.test(entry.name) && !/\.(ios|android)\.js$/.test(entry.name)) {
        yield full;
      }
    }
  }
  const files = ['Libraries', 'src'].flatMap((dir) => [...sources(path.join(reactNative, dir))]);
  const mentions = files.filter((file) => /['"]ios['"]/.test(readFileSync(file, 'utf8')));
  const relative = (file: string) => path.relative(reactNative, file).split(path.sep).join('/');

  it("finds every mention of 'ios' to be a comparison with Platform.OS it rewrites", () => {
    const COMPARISON = /\.OS\s*[!=]==?\s*['"]ios['"]|['"]ios['"]\s*[!=]==?\s*[\w.]+\.OS\b/g;
    const other = mentions.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /['"]ios['"]/.test(line.replace(COMPARISON, '')))
        .map((line) => `${relative(file)}: ${line.trim()}`),
    );
    // Types and their comments only: no code branches on them.
    assert.deepEqual(
      other.filter((line) => !line.startsWith('Libraries/Utilities/PlatformTypes.js:')),
      [],
      'React Native compares with ios in a form the plugin does not rewrite',
    );
  });

  // A React Native upgrade that adds an iOS branch shows up here: read it for whether iOS
  // behaviour is right for a Mac, and give it an override in macos.cjs if it is not.
  it('rewrites the files it was checked against', () => {
    const rewritten = mentions
      .filter((file) => {
        const code = readFileSync(file, 'utf8');
        return /\.OS\s*[!=]==?\s*['"]ios['"]/.test(code);
      })
      .map(relative)
      .sort();
    assert.deepEqual(rewritten, [
      'Libraries/Alert/Alert.js',
      'Libraries/Animated/shouldUseTurboAnimatedModule.js',
      'Libraries/AppState/AppState.js',
      'Libraries/Components/AccessibilityInfo/AccessibilityInfo.js',
      'Libraries/Components/ActivityIndicator/ActivityIndicator.js',
      'Libraries/Components/Button.js',
      'Libraries/Components/Keyboard/Keyboard.js',
      'Libraries/Components/Keyboard/KeyboardAvoidingView.js',
      'Libraries/Components/RefreshControl/RefreshControl.js',
      'Libraries/Components/ScrollView/ScrollView.js',
      'Libraries/Components/StatusBar/StatusBar.js',
      'Libraries/Components/TextInput/InputAccessoryView.js',
      'Libraries/Components/TextInput/TextInput.js',
      'Libraries/Components/TextInput/TextInputState.js',
      'Libraries/EventEmitter/NativeEventEmitter.js',
      'Libraries/Linking/Linking.js',
      'Libraries/Lists/SectionList.js',
      'Libraries/Lists/SectionListModern.js',
      'Libraries/Modal/Modal.js',
      'Libraries/NativeComponent/ViewConfigIgnore.js',
      'Libraries/Pressability/Pressability.js',
      'Libraries/PushNotificationIOS/PushNotificationIOS.js',
      'Libraries/ReactNative/PaperUIManager.js',
      'Libraries/Settings/Settings.js',
      'Libraries/Share/Share.js',
      'Libraries/Text/Text.js',
      'Libraries/Utilities/DevSettings.js',
      'Libraries/Utilities/HMRClient.js',
      'Libraries/Vibration/Vibration.js',
      'Libraries/WebSocket/WebSocket.js',
      'Libraries/WebSocket/WebSocketInterceptor.js',
      'src/private/animated/NativeAnimatedHelper.js',
      'src/private/specs_DEPRECATED/modules/NativeExceptionsManager.js',
    ]);
  });
});

describe('the transformer on macOS', () => {
  it('adds the plugin to a macos file only', () => {
    const ios = { options: { platform: 'ios' }, plugins: ['a'] };
    assert.equal(withMacosPlugins(ios), ios);
    assert.deepEqual(withMacosPlugins({ options: { platform: 'macos' }, plugins: ['a'] }).plugins, [
      'a',
      plugin,
    ]);
  });
});

describe('the preset resolving for macOS', () => {
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
          filePath: `/resolved/${request}`,
        }),
      },
      name,
      platform,
    );

  it('empties expo/* and every expo- package', () => {
    assert.deepEqual(resolved('expo-crypto', 'macos'), { type: 'empty' });
    assert.deepEqual(resolved('expo/fetch', 'macos'), { type: 'empty' });
  });

  it('gives expo the runtime module', () => {
    const runtime = resolved('expo', 'macos') as { filePath: string };
    assert.equal(runtime.filePath, require.resolve('@ng-native/metro/macos/expo-runtime.js'));
  });

  it('keeps the module a lazy import() loads, and Expo files importing each other', () => {
    assert.deepEqual(resolved('expo/internal/async-require-module', 'macos'), {
      type: 'sourceFile',
      filePath: '/resolved/expo/internal/async-require-module',
    });
    const inExpo = '/app/node_modules/expo/src/async-require/hmr.ts';
    assert.deepEqual(resolved('expo-modules-core', 'macos', inExpo), {
      type: 'sourceFile',
      filePath: '/resolved/expo-modules-core',
    });
  });

  it('leaves Expo alone on iOS', () => {
    assert.deepEqual(resolved('expo-crypto', 'ios'), {
      type: 'sourceFile',
      filePath: '/resolved/expo-crypto',
    });
  });
});

describe("Expo's out-of-tree platforms flag", () => {
  const flag = { experiments: { outOfTreePlatforms: true } };

  it('is asked for when expo.platforms lists macos', () => {
    assert.throws(
      () => checkOutOfTreePlatforms({ platforms: ['ios', 'macos'] }, []),
      /"outOfTreePlatforms": true/,
    );
    assert.doesNotThrow(() => checkOutOfTreePlatforms({ platforms: ['macos'], ...flag }, []));
  });

  it('is asked for when the command names macos', () => {
    for (const argv of [
      ['export', '-p', 'macos'],
      ['export', '--platform=macos'],
    ]) {
      assert.throws(() => checkOutOfTreePlatforms({ platforms: ['ios'] }, argv));
    }
    assert.deepEqual(requestedPlatforms(['export', '-p', 'ios', '--platform', 'macos']), [
      'ios',
      'macos',
    ]);
  });

  it('is not asked for by an app that never mentions macos', () => {
    assert.doesNotThrow(() => checkOutOfTreePlatforms({ platforms: ['ios', 'android'] }, []));
    assert.doesNotThrow(() => checkOutOfTreePlatforms(undefined, ['-p', 'macos']));
  });
});
