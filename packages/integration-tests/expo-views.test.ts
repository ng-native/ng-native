/**
 * The typed native views: `<expo-glass>`, `<expo-glass-container>`, `<expo-symbol>` and
 * `<apple-sign-in-button>`. Each input reaches its view as the prop native reads, with what the
 * module's React wrapper would have done to it first - a symbol's size, type and colours, the
 * Apple button's type and style as the numbers native takes.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { liquidGlassAvailable, registerExpoViews } from '@ng-native/expo';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children)]);

async function render() {
  const mod = await compileFixture('fixtures/expo-views.ts');
  registerExpoViews('expo-glass', 'expo-glass-container', 'expo-symbol', 'apple-sign-in-button');
  const fabric = createFakeFabric();
  const app = mount(1, mod['ExpoViewsFixture'] as Type<unknown>, fabric);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const byId = (id: string) => all(fabric.committed).find((node) => node.props['nativeID'] === id)!;
  return { app, fabric, byId };
}

describe('the typed native views', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => unmount?.());

  it('commits each as its module s view', async () => {
    const { app, byId } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.equal(byId('glass').viewName, 'ViewManagerAdapter_ExpoGlassEffect_GlassView');
    assert.equal(byId('container').viewName, 'ViewManagerAdapter_ExpoGlassEffect_GlassContainer');
    assert.equal(byId('heart').viewName, 'ViewManagerAdapter_SymbolModule');
    assert.equal(byId('apple').viewName, 'ViewManagerAdapter_ExpoAppleAuthentication');
  });

  it('passes the glass effect s props through, and leaves unset ones to native', async () => {
    const { app, byId } = await render();
    unmount = () => app.applicationRef.destroy();
    const glass = byId('glass').props;
    assert.equal(glass['glassEffectStyle'], 'clear');
    assert.equal(glass['tintColor'], '#ff000033');
    assert.equal(glass['isInteractive'], true, 'a bare attribute is on');
    assert.equal(byId('container').props['spacing'], 12, 'a static number is a number');
    assert.equal(byId('plain').props['glassEffectStyle'], undefined);
    assert.equal(byId('plain').props['isInteractive'], undefined);
  });

  it('sizes, types and colours a symbol as the React wrapper does', async () => {
    const { app, byId } = await render();
    unmount = () => app.applicationRef.destroy();
    const heart = byId('heart').props;
    assert.equal(heart['name'], 'heart.fill');
    assert.equal(heart['type'], 'monochrome', 'the type native needs, unset');
    assert.equal(heart['tintColor'], 'red');
    assert.equal(heart['weight'], 'bold');
    assert.equal(heart['animated'], false);
    assert.equal(heart['width'], 32);
    assert.equal(heart['height'], 32);

    const palette = byId('palette').props;
    assert.equal(palette['type'], 'palette');
    assert.deepEqual(palette['colors'], ['#fff', '#fc0']);
    assert.equal(palette['animated'], true, 'an animation spec is what animates it');
    assert.deepEqual(palette['animationSpec'], { effect: { type: 'bounce' } });

    const plain = byId('default').props;
    assert.equal(plain['width'], 24, 'the wrapper s default size');
    assert.equal(plain['height'], 24);

    const unsized = byId('unsized').props;
    assert.equal(unsized['width'], 24, 'a size bound to undefined is the default too');
    assert.deepEqual(unsized['colors'], ['red'], 'one colour is a list of one');
  });

  it('gives the Apple button its type and style as native s numbers, and reports a press', async () => {
    const { app, fabric, byId } = await render();
    unmount = () => app.applicationRef.destroy();
    const apple = byId('apple');
    assert.equal(apple.props['buttonType'], 1, 'continue');
    assert.equal(apple.props['buttonStyle'], 2, 'black');
    assert.equal(apple.props['cornerRadius'], 8);
    const plain = byId('plain-apple').props;
    assert.equal(plain['buttonType'], 0, 'sign-in unless set');
    assert.equal(plain['buttonStyle'], 2, 'black unless set');

    fabric.emit(apple, 'topButtonPress', {});
    app.applicationRef.tick();
    assert.equal((app.componentRef.instance as { presses(): number }).presses(), 1);
  });
});

describe('a symbol s size', () => {
  const global = globalThis as { expo?: unknown };
  const before = global.expo;
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    unmount = undefined;
    global.expo = before;
  });

  /** The native lookup: a symbol it knows is wider than its point size and not as tall. */
  function stubSymbols() {
    const asked: unknown[][] = [];
    const imageSize = (name: string, pointSize: number, weight?: string, scale?: string) => {
      asked.push([name, pointSize, weight, scale]);
      return name === 'no.such.symbol' ? null : [pointSize * 1.25, pointSize * 0.75];
    };
    global.expo = { modules: { NgNativeSymbol: { imageSize } } };
    return asked;
  }

  it('is the box the symbol image takes at that point size, as SwiftUI lays it out', async () => {
    const asked = stubSymbols();
    const { app, byId } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.equal(byId('heart').props['width'], 40);
    assert.equal(byId('heart').props['height'], 24);
    assert.deepEqual(
      asked.find(([name]) => name === 'heart.fill'),
      ['heart.fill', 32, 'bold', undefined],
      'the weight and scale change the image too',
    );
    assert.equal(byId('default').props['width'], 30, 'the default size is a point size too');
    assert.equal(byId('default').props['height'], 18);
    assert.deepEqual(
      asked.find(([name]) => name === 'doc.text'),
      ['doc.text', 17, undefined, 'large'],
    );
  });

  it('follows the name and the size, and is square for a name native does not know', async () => {
    stubSymbols();
    const { app, byId } = await render();
    unmount = () => app.applicationRef.destroy();
    const fixture = app.componentRef.instance as {
      symbol: { set(name: string): void };
      symbolSize: { set(size: number): void };
    };
    assert.equal(byId('sized').props['width'], 21.25);
    fixture.symbolSize.set(20);
    app.applicationRef.tick();
    assert.equal(byId('sized').props['width'], 25);
    assert.equal(byId('sized').props['height'], 15);
    fixture.symbol.set('no.such.symbol');
    app.applicationRef.tick();
    assert.equal(byId('sized').props['width'], 20);
    assert.equal(byId('sized').props['height'], 20);
  });

  it('is the square without the native lookup, as in Expo Go', async () => {
    for (const expo of [undefined, { modules: {} }, { modules: { NgNativeSymbol: {} } }]) {
      global.expo = expo;
      const { app, byId } = await render();
      try {
        assert.equal(byId('heart').props['width'], 32);
        assert.equal(byId('heart').props['height'], 32);
        assert.equal(byId('sized').props['width'], 17);
      } finally {
        app.applicationRef.destroy();
      }
    }
  });
});

describe('liquidGlassAvailable', () => {
  const global = globalThis as { expo?: unknown };
  const before = global.expo;
  afterEach(() => (global.expo = before));

  it('is what the glass module reports, and false without it', () => {
    global.expo = { modules: { ExpoGlassEffect: { isLiquidGlassAvailable: true } } };
    assert.equal(liquidGlassAvailable(), true);
    global.expo = { modules: { ExpoGlassEffect: { isLiquidGlassAvailable: false } } };
    assert.equal(liquidGlassAvailable(), false);
    global.expo = { modules: {} };
    assert.equal(liquidGlassAvailable(), false);
  });
});
