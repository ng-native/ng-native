/**
 * A tab icon written as SVG markup. Neither platform's tab bar draws SVG, so the markup is drawn
 * once by a renderer the app provides (`@ng-native/icons` has one) and reaches native as a
 * template image, tinted like a symbol.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ErrorHandler, type Type, type ViewContainerRef, type WritableSignal } from '@angular/core';
import type { Routes } from '@angular/router';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter, withSvgIcons } from '../router/src/provide-native-router.ts';
import type { TabIcon } from '../router/src/native-tab.ts';
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

/** One call to the renderer, which the test answers when it chooses. */
interface Drawing {
  readonly svg: string;
  readonly size: number;
  readonly at: ViewContainerRef;
  answer(source: unknown): Promise<void>;
}

let drawings: Drawing[] = [];

/** A renderer that draws nothing and answers when a test says so, as a device does later. */
class FakeSvgRenderer {
  render(svg: string, size: number, at: ViewContainerRef): Promise<unknown> {
    if (svg === '<svg id="broken"/>') return Promise.reject(new Error('could not draw'));
    return new Promise((resolve) => {
      drawings.push({
        svg,
        size,
        at,
        answer: async (source) => {
          resolve(source);
          await idle();
        },
      });
    });
  }
}

const icon = () => mod['icon'] as WritableSignal<TabIcon | undefined>;
const selectedIcon = () => mod['selectedIcon'] as WritableSignal<TabIcon | undefined>;

async function start(renderer: boolean, platform: 'ios' | 'android' = 'ios') {
  registerPlatformComponents(platform);
  registerScreenComponents();
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(
        mod['routes'] as Routes,
        ...(renderer ? [withSvgIcons(FakeSvgRenderer)] : []),
      ),
    ],
  });
  await idle();
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName.startsWith('RNSTabsScreen'));
  const home = () => screens()[0]!;
  return { ...app, home, screens };
}

beforeEach(() => {
  drawings = [];
  icon().set({ svg: '<svg id="home"/>' });
  selectedIcon().set(undefined);
});

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
});

describe('an SVG tab icon', () => {
  it('is drawn by the renderer, and native is given what it drew as a template image', async () => {
    const { home } = await start(true);
    const drawing = drawings.find((d) => d.svg === '<svg id="home"/>')!;
    assert.equal(drawing.size, 25, 'the size of a tab bar icon on iOS, unless the icon says');
    await drawing.answer({ uri: 'data:image/png;base64,home', scale: 3 });
    assert.equal(home().props['iconType'], 'template', 'tinted like a symbol');
    assert.deepEqual(home().props['iconImageSource'], {
      uri: 'data:image/png;base64,home',
      scale: 3,
    });
  });

  it('takes the size the icon gives', async () => {
    await start(true);
    assert.equal(drawings.find((d) => d.svg === '<svg id=search/>')!.size, 30);
  });

  it('is drawn beside the tab bar, which is on screen, not in a tab that may not be', async () => {
    const { fabric } = await start(true);
    const outlet = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS');
    const drawnAt = drawings[0]!.at.element.nativeElement as { committed?: { tag: number } };
    assert.equal(drawnAt.committed?.tag, outlet?.reactTag, 'beside the outlet that holds the bar');
  });

  it('shows no icon until it has been drawn', async () => {
    const { home } = await start(true);
    assert.equal(home().props['iconType'], undefined);
    assert.equal(home().props['iconImageSource'], undefined);
  });

  it('keeps the newest markup when an older drawing finishes after it', async () => {
    const { home } = await start(true);
    const first = drawings.find((d) => d.svg === '<svg id="home"/>')!;
    icon().set({ svg: '<svg id="away"/>' });
    await idle();
    const second = drawings.find((d) => d.svg === '<svg id="away"/>')!;
    await second.answer({ uri: 'away' });
    await first.answer({ uri: 'home' });
    assert.deepEqual(home().props['iconImageSource'], { uri: 'away' });
  });

  it('lets go of the drawing when the icon stops being SVG', async () => {
    const { home } = await start(true);
    await drawings[0]!.answer({ uri: 'home' });
    icon().set({ sfSymbol: 'house' });
    await idle();
    assert.equal(home().props['iconType'], 'sfSymbol');
    assert.equal(home().props['iconImageSource'], null);
    icon().set({ svg: '<svg id="home"/>' });
    await idle();
    assert.equal(home().props['iconImageSource'], null, 'and draws it again when it is');
    await drawings.at(-1)!.answer({ uri: 'again' });
    assert.deepEqual(home().props['iconImageSource'], { uri: 'again' });
  });

  it('draws a selected icon too', async () => {
    const { home } = await start(true);
    selectedIcon().set({ svg: '<svg id="chosen"/>' });
    await idle();
    await drawings.find((d) => d.svg === '<svg id="home"/>')!.answer({ uri: 'home' });
    await drawings.find((d) => d.svg === '<svg id="chosen"/>')!.answer({ uri: 'chosen' });
    assert.equal(home().props['iconType'], 'template');
    assert.deepEqual(home().props['selectedIconImageSource'], { uri: 'chosen' });
  });

  it('holds a selected icon drawn first until the icon it replaces is, which native needs', async () => {
    const { home, componentRef } = await start(true);
    const reported: unknown[] = [];
    const errors = componentRef.injector.get(ErrorHandler);
    const handle = errors.handleError;
    errors.handleError = (error: unknown) => reported.push(error);
    try {
      selectedIcon().set({ svg: '<svg id="chosen"/>' });
      await idle();
      await drawings.find((d) => d.svg === '<svg id="chosen"/>')!.answer({ uri: 'chosen' });
      assert.equal(home().props['selectedIconImageSource'], undefined, 'no selected icon alone');
      await drawings.find((d) => d.svg === '<svg id="home"/>')!.answer({ uri: 'home' });
      assert.deepEqual(home().props['selectedIconImageSource'], { uri: 'chosen' });
      assert.deepEqual(reported, [], 'and nothing refused on the way');
    } finally {
      errors.handleError = handle;
    }
  });

  it('does not draw the same markup again when the icon is written out again', async () => {
    await start(true);
    icon().set({ svg: '<svg id="home"/>' });
    await idle();
    assert.equal(drawings.filter((d) => d.svg === '<svg id="home"/>').length, 1);
  });

  it('is an image resource on Android', async () => {
    const { home } = await start(true, 'android');
    const drawing = drawings.find((d) => d.svg === '<svg id="home"/>')!;
    assert.equal(drawing.size, 24, 'the size of a navigation bar icon on Android');
    await drawing.answer({ uri: 'home' });
    assert.deepEqual(home().props['imageIconResource'], { uri: 'home' });
  });

  it('reports a renderer that fails, and shows the tab without an icon', async () => {
    const { home, componentRef } = await start(true);
    const reported: unknown[] = [];
    const errors = componentRef.injector.get(ErrorHandler);
    const handle = errors.handleError;
    errors.handleError = (error: unknown) => reported.push(error);
    try {
      icon().set({ svg: '<svg id="broken"/>' });
      await idle();
      assert.match(String(reported[0]), /could not draw/);
      assert.equal(home().props['iconImageSource'] ?? null, null);
    } finally {
      errors.handleError = handle;
    }
  });

  it('says what is missing when the app has no renderer, and shows the tab without an icon', async () => {
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => warned.push(message);
    try {
      const { home } = await start(false);
      assert.equal(home().props['iconType'], undefined);
      assert.match(String(warned[0]), /withSvgIcons/);
    } finally {
      console.warn = warn;
    }
  });
});
