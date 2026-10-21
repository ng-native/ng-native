/**
 * The status bar, which React Native only offers as a component.
 *
 * `<StatusBar />` is a React element whose *rendering* is what applies the style, through a stack
 * of entries so a screen pushed on top can change it and the one underneath can get it back. None
 * of that survives without React, but the statics underneath do - and a stack is exactly what a
 * navigation-driven app needs, so it is kept: a screen claims the bar, and dropping the claim
 * restores whatever was underneath.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector } from '@angular/core';
import { createWatch } from '@angular/core/primitives/signals';
import {
  ColorScheme,
  StatusBar,
  type ColorSchemeSource,
  type Scheme,
  type StatusBarSource,
} from '@ng-native/device';

/** What the platform was told, in order. */
function recorder() {
  const calls: [string, unknown][] = [];
  const source: StatusBarSource = {
    setStyle: (style, animated) => calls.push(['style', [style, animated]]),
    setHidden: (hidden, animation) => calls.push(['hidden', [hidden, animation]]),
    setBackgroundColor: (color, animated) => calls.push(['background', [color, animated]]),
    setTranslucent: (translucent) => calls.push(['translucent', translucent]),
    height: 47,
  };
  return { calls, source };
}

/** A colour scheme the test switches, as the system or `ColorScheme.set()` would. */
function scheme(initial: Scheme = 'light') {
  let current = initial;
  const listeners = new Set<(scheme: Scheme) => void>();
  const source: ColorSchemeSource = {
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const change = (next: Scheme) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  return { source, change, listeners };
}

function build(source: StatusBarSource, colors = scheme().source) {
  const injector = Injector.create({
    providers: [
      { provide: StatusBar.SOURCE, useValue: source },
      { provide: ColorScheme.SOURCE, useValue: colors },
      { provide: ColorScheme, useClass: ColorScheme },
      { provide: StatusBar, useClass: StatusBar },
    ],
  });
  return injector.get(StatusBar);
}

describe('the status bar', () => {
  it('applies what a caller sets, and only what changed', () => {
    const { calls, source } = recorder();
    const bar = build(source);

    bar.set({ style: 'light', hidden: false });
    assert.deepEqual(calls, [
      ['style', ['light', undefined]],
      ['hidden', [false, undefined]],
    ]);
  });

  it('restores the entry underneath when a claim is dropped', () => {
    // The reason this is a stack rather than a setter. A modal makes the bar light; dismissing it
    // has to put back whatever the screen behind it asked for, which nothing else remembers.
    const { calls, source } = recorder();
    const bar = build(source);

    bar.set({ style: 'dark' });
    const claim = bar.push({ style: 'light' });
    calls.length = 0;

    claim();
    assert.deepEqual(calls, [['style', ['dark', undefined]]]);
  });

  it('shows the bar again when the claim that hid it is dropped', () => {
    // Nothing underneath names `hidden`, so there is no value to put back but the platform's own.
    const { calls, source } = recorder();
    const bar = build(source);

    const claim = bar.push({ hidden: true });
    calls.length = 0;

    claim();
    assert.deepEqual(calls, [['hidden', [false, undefined]]]);
  });

  it("puts back the platform's style and translucency when the only claim naming them drops", () => {
    const { calls, source } = recorder();
    const bar = build(source);

    const claim = bar.push({ style: 'light', translucent: true });
    calls.length = 0;

    claim();
    assert.deepEqual(calls, [
      ['style', ['default', undefined]],
      ['translucent', false],
    ]);
  });

  it('puts a dropped property back once, not on every later change', () => {
    const { calls, source } = recorder();
    const bar = build(source);

    bar.push({ hidden: true })();
    calls.length = 0;

    bar.set({ style: 'dark' });
    assert.deepEqual(calls, [['style', ['dark', undefined]]]);
  });

  it('keeps a property the claim above says nothing about', () => {
    // A modal that only wants light text should not un-hide a bar the screen below hid.
    const { source } = recorder();
    const bar = build(source);

    bar.set({ style: 'dark', hidden: true });
    bar.push({ style: 'light' });

    assert.deepEqual(bar.state(), { style: 'light', hidden: true });
  });

  it('keeps a claim pushed before the base was set, and restores the base when it drops', () => {
    // A screen can mount and push before the app gets round to its startup `set`.
    const { calls, source } = recorder();
    const bar = build(source);

    const claim = bar.push({ style: 'light' });
    bar.set({ style: 'dark' });
    assert.deepEqual(bar.state(), { style: 'light' });

    calls.length = 0;
    claim();
    assert.deepEqual(calls, [['style', ['dark', undefined]]]);
  });

  it("leaves an effect that sets the bar unsubscribed from the bar's own state", () => {
    // An app shell sets the base style in an effect, from the color scheme. If setting the bar
    // read its state inside that effect, every later set or push would run the effect again and
    // write the base back over what was just set.
    const { calls, source } = recorder();
    const bar = build(source);
    let reruns = 0;
    // What `effect()` is built on, run by hand: the second callback is its reschedule.
    const shell = createWatch(
      () => bar.set({ style: 'dark' }),
      () => reruns++,
      true,
    );
    shell.run();

    bar.set({ style: 'light' });
    bar.push({ hidden: true });
    assert.equal(reruns, 0);
    assert.deepEqual(bar.state(), { style: 'light', hidden: true });
    assert.deepEqual(calls.at(-2), ['style', ['light', undefined]]);
    shell.destroy();
  });

  it('reports its height, which a layout under a translucent bar needs', () => {
    const { source } = recorder();
    assert.equal(build(source).height(), 47);
  });

  it('does nothing off a device rather than throwing', () => {
    const bar = build({
      setStyle: () => {},
      setHidden: () => {},
      setBackgroundColor: () => {},
      setTranslucent: () => {},
      height: undefined,
    });
    bar.set({ style: 'light' });
    assert.equal(bar.height(), 0);
  });
});

describe("an 'auto' status bar", () => {
  it('asks for dark content on a light scheme and light content on a dark one', () => {
    // Android's unclaimed bar is light content, white icons on a light app.
    const light = recorder();
    build(light.source, scheme('light').source).set({ style: 'auto' });
    assert.deepEqual(light.calls, [['style', ['dark', undefined]]]);

    const dark = recorder();
    build(dark.source, scheme('dark').source).set({ style: 'auto' });
    assert.deepEqual(dark.calls, [['style', ['light', undefined]]]);
  });

  it('follows the scheme when it changes, as a ColorScheme.set() theme switch does', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    build(source, colors.source).set({ style: 'auto', animated: true });
    calls.length = 0;

    colors.change('dark');
    colors.change('light');
    assert.deepEqual(calls, [
      ['style', ['light', true]],
      ['style', ['dark', true]],
    ]);
  });

  it('reports auto as the state, not the style it resolved to', () => {
    const { source } = recorder();
    const bar = build(source, scheme('dark').source);
    bar.set({ style: 'auto' });
    assert.deepEqual(bar.state(), { style: 'auto' });
  });

  it('leaves a fixed style alone when the scheme changes', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    build(source, colors.source).set({ style: 'light' });
    calls.length = 0;

    colors.change('dark');
    assert.deepEqual(calls, []);
  });

  it('keeps a fixed claim above an auto base, and resolves the base again once it drops', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    const bar = build(source, colors.source);
    bar.set({ style: 'auto' });
    const claim = bar.push({ style: 'light' });
    calls.length = 0;

    colors.change('dark');
    assert.deepEqual(calls, []);
    colors.change('light');
    claim();
    assert.deepEqual(calls, [['style', ['dark', undefined]]]);
  });

  it('asks for nothing when no claim sets a style, whatever the scheme does', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    build(source, colors.source).set({ hidden: false });
    calls.length = 0;
    colors.change('dark');
    assert.deepEqual(calls, []);
  });

  it('stops following the scheme when its injector is destroyed', () => {
    const { source } = recorder();
    const colors = scheme('light');
    const injector = Injector.create({
      providers: [
        { provide: StatusBar.SOURCE, useValue: source },
        { provide: ColorScheme.SOURCE, useValue: colors.source },
        { provide: ColorScheme, useClass: ColorScheme },
        { provide: StatusBar, useClass: StatusBar },
      ],
    }) as Injector & { destroy(): void };
    injector.get(StatusBar);
    assert.notEqual(colors.listeners.size, 0);
    injector.destroy();
    assert.equal(colors.listeners.size, 0);
  });
});

describe('an animated status bar change', () => {
  it('fades the bar in and out, as React Native animates it', () => {
    const { calls, source } = recorder();
    build(source).set({ hidden: true, animated: true });
    assert.deepEqual(calls, [['hidden', [true, 'fade']]]);
  });
});

describe('a status bar claim with a property set to undefined', () => {
  // `{ style: maybeStyle }` compiles without `exactOptionalPropertyTypes`, and an undefined
  // property is as absent as a missing one: it leaves whatever the claim underneath said.
  it('keeps the style underneath while the claim lasts', () => {
    const { calls, source } = recorder();
    const bar = build(source);
    bar.set({ style: 'dark' });
    calls.length = 0;

    bar.push({ style: undefined, hidden: true });
    assert.deepEqual(calls, [
      ['style', ['dark', undefined]],
      ['hidden', [true, undefined]],
    ]);
    assert.equal(bar.state().style, 'dark');
  });

  it('keeps what is underneath until the claim drops, then puts it back', () => {
    const { calls, source } = recorder();
    const bar = build(source);
    bar.set({ style: 'dark', hidden: true, animated: true });
    calls.length = 0;

    const claim = bar.push({ style: 'light', hidden: undefined, animated: undefined });
    assert.deepEqual(calls, [
      ['style', ['light', true]],
      ['hidden', [true, 'fade']],
    ]);
    calls.length = 0;

    claim();
    assert.deepEqual(calls, [
      ['style', ['dark', true]],
      ['hidden', [true, 'fade']],
    ]);
    assert.deepEqual(bar.state(), { style: 'dark', hidden: true, animated: true });
  });

  it('leaves an undefined property of the base claim out of the state', () => {
    const { calls, source } = recorder();
    const bar = build(source);
    bar.set({ style: 'dark', hidden: undefined });
    assert.deepEqual(calls, [['style', ['dark', undefined]]]);
    assert.deepEqual(bar.state(), { style: 'dark' });
  });

  it('keeps the background color underneath', () => {
    const { calls, source } = recorder();
    const bar = build(source);
    bar.set({ backgroundColor: '#123456' });
    calls.length = 0;

    bar.push({ backgroundColor: undefined, hidden: true });
    assert.deepEqual(calls, [
      ['hidden', [true, undefined]],
      ['background', ['#123456', undefined]],
    ]);
  });

  it('keeps following the scheme for an auto style underneath', () => {
    const { calls, source } = recorder();
    const colors = scheme('light');
    const bar = build(source, colors.source);
    bar.set({ style: 'auto' });
    bar.push({ style: undefined, hidden: true });
    calls.length = 0;

    colors.change('dark');
    assert.deepEqual(calls, [['style', ['light', undefined]]]);
  });

  it('hands the screens the style and visibility underneath', () => {
    const { source } = recorder();
    const bar = build({ ...source, screensSetBar: true });
    bar.set({ style: 'dark', hidden: true });
    bar.push({ style: undefined, hidden: undefined, translucent: true });
    assert.deepEqual(bar.forScreens(), { style: 'dark', hidden: true });
  });
});

describe('a status bar two apps claim', () => {
  // Android recreates an activity after a font size change: the new app mounts and claims the bar,
  // and only then is the old one destroyed. The bar is the window's, so the old app going leaves
  // what the new one claimed.
  function app(source: StatusBarSource, colors = scheme().source) {
    const injector = Injector.create({
      providers: [
        { provide: StatusBar.SOURCE, useValue: source },
        { provide: ColorScheme.SOURCE, useValue: colors },
        { provide: ColorScheme, useClass: ColorScheme },
        { provide: StatusBar, useClass: StatusBar },
      ],
    });
    return { bar: injector.get(StatusBar), destroy: () => injector.destroy() };
  }

  /** What the bar shows after `calls`: the last of each kind. */
  function shown(calls: [string, unknown][]) {
    return Object.fromEntries(calls.map(([kind, args]) => [kind, (args as unknown[])[0]]));
  }

  it('keeps the bar a later app claimed when the earlier app goes', () => {
    const { calls, source } = recorder();
    const old = app(source);
    const dropOld = old.bar.push({ style: 'light', hidden: true });
    const current = app(source);
    current.bar.set({ style: 'dark' });
    current.bar.push({ hidden: true });
    calls.length = 0;

    dropOld();
    old.destroy();
    assert.deepEqual(shown(calls), { style: 'dark', hidden: true });
    assert.deepEqual(current.bar.state(), { style: 'dark', hidden: true });
  });

  it('takes an app that goes without dropping its claims out of the bar', () => {
    const { calls, source } = recorder();
    const old = app(source);
    old.bar.set({ style: 'light', hidden: true });
    const current = app(source);
    current.bar.set({ style: 'dark' });
    calls.length = 0;

    old.destroy();
    assert.deepEqual(shown(calls), { style: 'dark', hidden: false });
    assert.deepEqual(current.bar.state(), { style: 'dark' });
  });

  it('lets the later app win while both are there', () => {
    const { source } = recorder();
    const old = app(source);
    old.bar.push({ style: 'light', hidden: true });
    const current = app(source);
    current.bar.set({ style: 'dark' });
    assert.deepEqual(current.bar.state(), { style: 'dark', hidden: true });
    assert.deepEqual(old.bar.state(), current.bar.state());
  });

  it('follows the scheme of the app whose auto style is in force', () => {
    const { calls, source } = recorder();
    const oldColors = scheme('light');
    const currentColors = scheme('light');
    const old = app(source, oldColors.source);
    old.bar.set({ style: 'light' });
    const current = app(source, currentColors.source);
    current.bar.push({ style: 'auto' });
    calls.length = 0;

    oldColors.change('dark');
    assert.deepEqual(calls, [], 'not the scheme of an app whose style is under another');
    currentColors.change('dark');
    assert.deepEqual(calls, [['style', ['light', undefined]]]);
  });
});

describe('a status bar window that comes to the front', () => {
  function fronting() {
    const { calls, source } = recorder();
    const fronts = new Set<() => void>();
    const onWindowFront = (listener: () => void) => {
      fronts.add(listener);
      return () => fronts.delete(listener);
    };
    const front = () => {
      for (const listener of fronts) listener();
    };
    return { calls, source: { ...source, onWindowFront }, front };
  }

  it('is given what is claimed again, without animating', () => {
    const { calls, source, front } = fronting();
    const bar = build(source);
    bar.set({ style: 'dark', hidden: true, animated: true, backgroundColor: '#123456' });
    calls.length = 0;

    front();
    assert.deepEqual(calls, [
      ['style', ['dark', undefined]],
      ['hidden', [true, undefined]],
      ['background', ['#123456', undefined]],
    ]);
  });

  it('is not put back to the platform for a property no claim names', () => {
    const { calls, source, front } = fronting();
    const bar = build(source);
    const drop = bar.push({ hidden: true });
    drop();
    calls.length = 0;

    front();
    assert.deepEqual(calls, []);
  });

  it('is given an auto style by the scheme now', () => {
    const { calls, source, front } = fronting();
    const colors = scheme('dark');
    const bar = build(source, colors.source);
    bar.set({ style: 'auto' });
    calls.length = 0;

    front();
    assert.deepEqual(calls, [['style', ['light', undefined]]]);
  });
});
