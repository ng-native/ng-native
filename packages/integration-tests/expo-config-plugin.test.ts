/**
 * `["@ng-native/expo", { "pointerEvents": true }]` in app.json. React Native's pointer events are
 * off unless an app turns them on, on both platforms, so what the option writes is what native reads
 * at launch, and leaving the option out takes back what an earlier prebuild wrote.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);

type MetaData = { $: Record<string, string> };
type Manifest = { manifest: { application?: { 'meta-data'?: MetaData[] }[] } };
type Mod = (config: Record<string, unknown>) => Promise<{ modResults: unknown }>;
type Options = { pointerEvents?: boolean };

const plugin = require('@ng-native/expo/app.plugin.cjs') as ((
  config: Record<string, unknown>,
  options?: Options,
) => { mods: { ios: Record<string, Mod>; android: Record<string, Mod> } }) & {
  infoPlist: (plist: Record<string, unknown>, options?: Options) => Record<string, unknown>;
  androidManifest: (manifest: Manifest, options?: Options) => Manifest;
};

const KEY = 'NgNativePointerEvents';
const NAME = 'dev.ngnative.expo.POINTER_EVENTS';
const emptyManifest = (): Manifest => ({ manifest: { application: [{}] } });
const values = (manifest: Manifest) =>
  (manifest.manifest.application?.[0]?.['meta-data'] ?? [])
    .filter((item) => item.$['android:name'] === NAME)
    .map((item) => item.$['android:value']);

describe('the pointerEvents option', () => {
  it('is off unless it is asked for', () => {
    assert.deepEqual(plugin.infoPlist({}), {});
    assert.deepEqual(plugin.infoPlist({}, { pointerEvents: false }), {});
    assert.deepEqual(values(plugin.androidManifest(emptyManifest())), []);
    assert.deepEqual(values(plugin.androidManifest(emptyManifest(), { pointerEvents: false })), []);
  });

  it('writes what each platform reads at launch', () => {
    assert.deepEqual(plugin.infoPlist({}, { pointerEvents: true }), { [KEY]: true });
    assert.deepEqual(values(plugin.androidManifest(emptyManifest(), { pointerEvents: true })), [
      'true',
    ]);
  });

  it('does not add a second entry to a manifest that has one', () => {
    const once = plugin.androidManifest(emptyManifest(), { pointerEvents: true });
    assert.deepEqual(values(plugin.androidManifest(once, { pointerEvents: true })), ['true']);
  });

  it('takes back what an earlier prebuild wrote, and only that', () => {
    assert.deepEqual(plugin.infoPlist({ [KEY]: true, Other: 1 }), { Other: 1 });
    const other = { $: { 'android:name': 'other', 'android:value': 'kept' } };
    const manifest = plugin.androidManifest(emptyManifest(), { pointerEvents: true });
    manifest.manifest.application![0]!['meta-data']!.push(other);
    const taken = plugin.androidManifest(manifest);
    assert.deepEqual(taken.manifest.application![0]!['meta-data'], [other]);
  });

  it('refuses a value that is not a boolean, rather than leaving hover off', () => {
    assert.throws(
      () => plugin.infoPlist({}, { pointerEvents: 'yes' as unknown as boolean }),
      /pointerEvents/,
    );
  });

  it('fails on a manifest with no application', () => {
    assert.throws(() => plugin.androidManifest({ manifest: {} }, { pointerEvents: true }));
  });

  it("registers each change as Expo's mod for its file", async () => {
    const config = { name: 'App', slug: 'app', _internal: { projectRoot: process.cwd() } };
    const { mods } = plugin(config, { pointerEvents: true });
    const run = async (mod: Mod, modResults: unknown) =>
      (await mod({ ...config, modResults, modRequest: {} })).modResults;
    assert.deepEqual(await run(mods.ios['infoPlist']!, {}), { [KEY]: true });
    assert.deepEqual(values((await run(mods.android['manifest']!, emptyManifest())) as Manifest), [
      'true',
    ]);
  });
});
