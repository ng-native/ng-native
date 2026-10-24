/**
 * A template tab icon, drawn as a mask and tinted, in the form the installed react-native-screens
 * reads. 4.29 dropped `iconType: 'template'` for `iconType: 'image'` with an
 * `iconImageRenderingMode` per state, and native aborts the app on an `iconType` value it does not
 * know: an Expo SDK 58 app closed as its tab bar was created.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type, WritableSignal } from '@angular/core';
import type { Routes } from '@angular/router';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter, withSvgIcons } from '../router/src/provide-native-router.ts';
import type { TabIcon } from '../router/src/native-tab.ts';
import { SCREENS_VERSION, screensReadsRenderingModes } from '../router/src/screens-version.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/svg-tabs.ts', import.meta.url)));
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

/** Draws every SVG at once, as the URI of its markup. */
class InstantSvgRenderer {
  render(svg: string): Promise<unknown> {
    return Promise.resolve({ uri: svg });
  }
}

const icon = () => mod['icon'] as WritableSignal<TabIcon | undefined>;
const selectedIcon = () => mod['selectedIcon'] as WritableSignal<TabIcon | undefined>;

/** Renders the tabs, with react-native-screens at `version`, or the installed one when absent. */
async function start(version?: string, platform: 'ios' | 'android' = 'ios') {
  registerPlatformComponents(platform);
  registerScreenComponents();
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(mod['routes'] as Routes, withSvgIcons(InstantSvgRenderer)),
      ...(version ? [{ provide: SCREENS_VERSION, useValue: version }] : []),
    ],
  });
  await idle();
  const home = () =>
    flatten(app.fabric.committed).find((node) => node.viewName.startsWith('RNSTabsScreen'))!;
  return { ...app, home };
}

beforeEach(() => {
  icon().set({ template: { uri: 'home' } });
  selectedIcon().set(undefined);
});

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
  icon().set({ svg: '<svg id="home"/>' });
});

describe('a template tab icon with react-native-screens 4.29 or later', () => {
  it('is an image with a template rendering mode, never an iconType native aborts on', async () => {
    const { home } = await start('4.30.0');
    assert.equal(home().props['iconType'], 'image');
    assert.equal(home().props['iconImageRenderingMode'], 'template');
    assert.deepEqual(home().props['iconImageSource'], { uri: 'home' });
  });

  it('is the same for an SVG icon, which is drawn as a template', async () => {
    icon().set({ svg: '<svg id="home"/>' });
    const { home } = await start('4.29.0');
    assert.equal(home().props['iconType'], 'image');
    assert.equal(home().props['iconImageRenderingMode'], 'template');
    assert.deepEqual(home().props['iconImageSource'], { uri: '<svg id="home"/>' });
  });

  it('gives the selected icon its own rendering mode, which native reads apart', async () => {
    selectedIcon().set({ template: { uri: 'chosen' } });
    const { home } = await start('4.30.0');
    assert.equal(home().props['iconType'], 'image');
    assert.equal(home().props['selectedIconImageRenderingMode'], 'template');
    assert.deepEqual(home().props['selectedIconImageSource'], { uri: 'chosen' });
  });

  it('leaves an image drawn as authored', async () => {
    icon().set({ image: { uri: 'logo' } });
    selectedIcon().set({ image: { uri: 'logo-on' } });
    const { home } = await start('4.30.0');
    assert.equal(home().props['iconType'], 'image');
    assert.equal(home().props['iconImageRenderingMode'] ?? null, null);
    assert.equal(home().props['selectedIconImageRenderingMode'] ?? null, null);
  });

  it('takes the rendering modes away when the icon stops being a template', async () => {
    selectedIcon().set({ template: { uri: 'chosen' } });
    const { home } = await start('4.30.0');
    icon().set({ sfSymbol: 'house' });
    selectedIcon().set(undefined);
    await idle();
    assert.equal(home().props['iconType'], 'sfSymbol');
    assert.equal(home().props['iconImageRenderingMode'], null, 'removed, not left as it was');
    assert.equal(home().props['selectedIconImageRenderingMode'], null);
  });

  it('turns template on when an image icon becomes one', async () => {
    icon().set({ image: { uri: 'logo' } });
    const { home } = await start('4.30.0');
    icon().set({ template: { uri: 'home' } });
    await idle();
    assert.equal(home().props['iconType'], 'image');
    assert.equal(home().props['iconImageRenderingMode'], 'template');
  });

  it('changes nothing on Android, which takes an image resource', async () => {
    const { home } = await start('4.30.0', 'android');
    assert.deepEqual(home().props['imageIconResource'], { uri: 'home' });
    assert.equal(home().props['iconType'], undefined);
    assert.equal(home().props['iconImageRenderingMode'], undefined);
  });
});

describe('a template tab icon with an older react-native-screens', () => {
  it('is the template iconType 4.26 to 4.28 read', async () => {
    selectedIcon().set({ template: { uri: 'chosen' } });
    const { home } = await start('4.28.3');
    assert.equal(home().props['iconType'], 'template');
    assert.equal(home().props['iconImageRenderingMode'], undefined);
    assert.equal(home().props['selectedIconImageRenderingMode'], undefined);
  });
});

describe('the react-native-screens version', () => {
  it('splits at 4.29, by number rather than by text', () => {
    assert.equal(screensReadsRenderingModes('4.26.2'), false);
    assert.equal(screensReadsRenderingModes('4.28.9'), false);
    assert.equal(screensReadsRenderingModes('4.29.0'), true);
    assert.equal(screensReadsRenderingModes('4.30.0-rc.1'), true);
    assert.equal(screensReadsRenderingModes('4.100.0'), true);
    assert.equal(screensReadsRenderingModes('5.0.0'), true);
  });

  it('is the installed package by default', async () => {
    const router = fileURLToPath(new URL('../router/package.json', import.meta.url));
    const manifest = createRequire(router).resolve('react-native-screens/package.json');
    const installed = (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
    const { home } = await start();
    assert.equal(
      home().props['iconType'],
      screensReadsRenderingModes(installed) ? 'image' : 'template',
      `for react-native-screens ${installed}`,
    );
  });
});
