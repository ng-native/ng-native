/**
 * `scripts/expo-ui-native-props.mjs`: each prop a typed `ui-*` component sends is one `@expo/ui`'s
 * native view declares. Run here against the `@expo/ui` this workspace installs, and weekly by the
 * Latest versions workflow against the newest one `@ng-native/expo`'s peer range allows.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const script = new URL('../../scripts/expo-ui-native-props.mjs', import.meta.url);
const { divergences } = (await import(script.href)) as {
  divergences(expoUi: string, source?: string): Promise<{ found: string[]; stale: string[] }>;
};
const installed = path.dirname(
  createRequire(require.resolve('@ng-native/expo/package.json')).resolve('@expo/ui/package.json'),
);

/** A copy of the installed `@expo/ui`'s native sources, with `edit` applied to one file of it. */
async function edited<T>(
  file: string,
  edit: (text: string) => string,
  check: (copy: string) => Promise<T>,
): Promise<T> {
  const copy = mkdtempSync(path.join(tmpdir(), 'expo-ui-props-'));
  try {
    for (const part of ['package.json', 'ios', 'android/src/main']) {
      cpSync(path.join(installed, part), path.join(copy, part), { recursive: true });
    }
    const target = path.join(copy, file);
    writeFileSync(target, edit(readFileSync(target, 'utf8')));
    return await check(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

describe('the props typed ui-* components send', () => {
  it('are each declared by the installed @expo/ui, or known', async () => {
    const { found, stale } = await divergences(installed);
    assert.deepEqual(found, []);
    // Known for a newer @expo/ui only: 57.0.22 and later have no AccessoryWidgetBackgroundView in
    // the app, for the reason beside it in KNOWN. Bumping the pinned version past it empties this.
    assert.deepEqual(stale, ['accessory-widget-background view ios']);
  });

  it("fails on a view host whose native view declares no form of matchContents, as in #910's", async () => {
    const found = await edited(
      'ios/RNHostView.swift',
      (text) => text.replace(/@Field var matchContents\w*: Bool = false\n/g, ''),
      async (copy) => (await divergences(copy)).found,
    );
    assert.deepEqual(found, [
      '<ui-view-host> sends matchContents, or matchContentsHorizontal and matchContentsVertical on ios, and RNHostView declares none.',
    ]);
  });

  it('fails on a prop the native view renamed', async () => {
    const found = await edited(
      'ios/SliderView.swift',
      (text) => text.replace('@Field var value: Float?', '@Field var currentValue: Float?'),
      async (copy) => (await divergences(copy)).found,
    );
    assert.deepEqual(found, [
      "<ui-slider> sends 'value' on ios, which SliderView does not declare.",
    ]);
  });

  it('fails, rather than passing, when it reads no host bindings', async () => {
    const source = readFileSync(require.resolve('@ng-native/expo/expo-ui-components'), 'utf8');
    // The same components, with each binding written in double quotes the pattern does not read.
    const unread = source.replace(/'\[(\w+)\]': '([^']*)'/g, '"[$1]": "$2"');
    await assert.rejects(divergences(installed, unread), /Found 0 host bindings/);
  });

  it('fails, rather than passing, when it finds no native views', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'expo-ui-props-'));
    try {
      mkdirSync(path.join(empty, 'ios'));
      mkdirSync(path.join(empty, 'android/src/main'), { recursive: true });
      await assert.rejects(divergences(empty), /Found 0 ios views/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
