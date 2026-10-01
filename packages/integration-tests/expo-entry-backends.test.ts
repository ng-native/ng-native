/**
 * Each Expo entry point bundles with only its own native module installed.
 *
 * Metro resolves every `require` it finds while it builds the graph, whether or not the code that
 * calls it ever runs, and fails the build on one it cannot resolve. So an entry point that reached
 * two modules made an app install both: `@ng-native/expo/store` once held `Storage` and
 * `SecureStorage`, and `@ng-native/expo/player` `audioPlayer` and `videoPlayer`. Each now has an
 * entry point of its own, and this asks Metro's own dependency collector which modules each one
 * needs. The module an entry point is for stays a required dependency, so an app that uses it
 * without installing it still fails to build, with the module named.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
// The Metro an app gets, reached the way an app reaches it: through Expo's Metro config.
const fromExpo = createRequire(require.resolve('expo/package.json'));
const fromConfig = createRequire(fromExpo.resolve('@expo/metro-config/package.json'));
const fromMetro = createRequire(fromConfig.resolve('metro/package.json'));
const collectDependencies = fromMetro('metro/private/ModuleGraph/worker/collectDependencies')
  .default as (
  ast: unknown,
  options: object,
) => { dependencies: { name: string; data: { isOptional?: boolean } }[] };
const { parse } = fromConfig('@babel/parser') as {
  parse: (code: string, options: object) => unknown;
};

const BACKENDS = [
  '@react-native-async-storage/async-storage',
  'expo-secure-store',
  'expo-audio',
  'expo-video',
];

/** The native modules Metro collects for `entry`, each with whether it is optional. */
function backendsOf(entry: string): Record<string, 'required' | 'optional'> {
  const source = readFileSync(require.resolve(entry), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const { dependencies } = collectDependencies(ast, {
    asyncRequireModulePath: 'expo-asyncRequire',
    dependencyMapName: null,
    dynamicRequires: 'reject',
    inlineableCalls: [],
    keepRequireNames: true,
    allowOptionalDependencies: true,
    unstable_allowRequireContext: false,
    unstable_isESMImportAtSource: null,
  });
  return Object.fromEntries(
    dependencies
      .filter(({ name }) => BACKENDS.includes(name))
      .map(({ name, data }) => [name, data.isOptional ? 'optional' : 'required']),
  );
}

describe('the native module each Expo entry point needs', () => {
  for (const [entry, needs] of [
    ['@ng-native/expo/store', {}],
    ['@ng-native/expo/async-storage', { '@react-native-async-storage/async-storage': 'required' }],
    ['@ng-native/expo/secure-store', { 'expo-secure-store': 'required' }],
    ['@ng-native/expo/player', {}],
    ['@ng-native/expo/audio', { 'expo-audio': 'required' }],
    ['@ng-native/expo/video', { 'expo-video': 'required' }],
  ] as const) {
    it(`${entry} needs ${Object.keys(needs).join(' and ') || 'none of them'}`, () => {
      assert.deepEqual(backendsOf(entry), needs);
    });
  }
});
