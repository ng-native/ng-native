/**
 * Keyboard avoidance: a view whose padding tracks the keyboard, driven through a fake keyboard
 * source so no device is needed.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import {
  Keyboard,
  LayoutAnimation,
  type KeyboardMetrics,
  type NativeLayoutAnimation,
} from '@ng-native/device';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('keyboard-avoiding-view', () => {
  let Component: Type<unknown>;
  let emitKeyboard: (metrics: KeyboardMetrics) => void = () => {};

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/sections.ts', import.meta.url)),
    );
    Component = mod['Sections'] as Type<unknown>;
  });

  it('insets by the keyboard height, less the caller offset', async () => {
    const fabric = createFakeFabric();
    const app = mount(1, Component, fabric, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: (m: KeyboardMetrics) => void) => {
              emitKeyboard = fn;
              return () => {};
            },
            dismiss: () => {},
          },
        },
      ],
    });
    await settle();

    const avoider = fabric.committed[0]!.children[0]!;
    assert.equal(avoider.props['paddingBottom'], undefined, 'no inset while hidden');

    emitKeyboard({ height: 300 });
    await settle();

    const raised = fabric.committed[0]!.children[0]!;
    // 300 tall, minus the fixture's keyboardVerticalOffset of 20.
    assert.equal(raised.props['paddingBottom'], 280);

    emitKeyboard({ height: 0 });
    await settle();
    assert.equal(
      fabric.committed[0]!.children[0]!.props['paddingBottom'],
      null,
      'inset removed, not stale',
    );

    app.applicationRef.destroy();
  });

  it('configures a layout animation with the keyboard event before the inset commits', async () => {
    // RN's own KeyboardAvoidingView calls LayoutAnimation.configureNext with the keyboard
    // event's duration and easing, right before the state change that moves the view, so the
    // adjustment eases in alongside the keyboard rather than landing in one step.
    let paddingWhenConfigured: unknown;
    const state = { configured: null as object | null };
    const native: NativeLayoutAnimation = {
      configureNext(config) {
        state.configured = config;
        paddingWhenConfigured = fabric.committed[0]?.children[0]?.props['paddingBottom'];
      },
    };

    const fabric = createFakeFabric();
    const app = mount(1, Component, fabric, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: (m: KeyboardMetrics) => void) => {
              emitKeyboard = fn;
              return () => {};
            },
            dismiss: () => {},
          },
        },
        { provide: LayoutAnimation.SOURCE, useValue: native },
      ],
    });
    await settle();

    emitKeyboard({ height: 300, duration: 250, easing: 'easeOut' });
    await settle();

    assert.ok(state.configured, 'the layout animation was configured');
    const configured = state.configured as { duration: number; update: { type: string } };
    assert.equal(configured.duration, 250);
    assert.equal(configured.update.type, 'easeOut');
    assert.equal(paddingWhenConfigured, undefined, 'configured before the new inset committed');
    assert.equal(
      fabric.committed[0]!.children[0]!.props['paddingBottom'],
      280,
      'and the inset still lands',
    );

    app.applicationRef.destroy();
  });

  it("moves on the keyboard's own curve, which is what iOS reports", async () => {
    // UIKit animates its keyboard on a private curve, and RN names it 'keyboard'. RN's own
    // KeyboardAvoidingView hands it to LayoutAnimation as it is; left out, the view eases on a
    // different curve from the keyboard it is meant to be moving with.
    const configured: { update: { type: string } }[] = [];
    const native: NativeLayoutAnimation = {
      configureNext: (config) => configured.push(config as { update: { type: string } }),
    };

    const fabric = createFakeFabric();
    const app = mount(1, Component, fabric, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: (m: KeyboardMetrics) => void) => ((emitKeyboard = fn), () => {}),
            dismiss: () => {},
          },
        },
        { provide: LayoutAnimation.SOURCE, useValue: native },
      ],
    });
    await settle();

    emitKeyboard({ height: 300, duration: 250, easing: 'keyboard' });
    await settle();
    // And back down with it: iOS reports the hide's timing too.
    emitKeyboard({ height: 0, duration: 250, easing: 'keyboard' });
    await settle();

    assert.deepEqual(
      configured.map((config) => config.update.type),
      ['keyboard', 'keyboard'],
    );

    app.applicationRef.destroy();
  });

  it('does not configure a layout animation when the keyboard reports no duration', async () => {
    // Android's own keyboard event always has duration 0 - the platform animates the keyboard
    // itself, and nothing here should ask native to animate an update it never asked to run.
    const order: string[] = [];
    const native: NativeLayoutAnimation = { configureNext: () => order.push('configure') };

    const fabric = createFakeFabric();
    const app = mount(1, Component, fabric, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: (m: KeyboardMetrics) => void) => {
              emitKeyboard = fn;
              return () => {};
            },
            dismiss: () => {},
          },
        },
        { provide: LayoutAnimation.SOURCE, useValue: native },
      ],
    });
    await settle();

    emitKeyboard({ height: 300, duration: 0, easing: 'keyboard' });
    await settle();

    assert.deepEqual(order, []);
    assert.equal(fabric.committed[0]!.children[0]!.props['paddingBottom'], 280);

    app.applicationRef.destroy();
  });
});

/**
 * A keyboard-avoiding view on a screen under a navigation bar, which is where an editor lives.
 * `(layout)` puts its top at zero, in the screen's coordinates; the window has it a bar's height
 * down, and the keyboard's `screenY` is in the window's.
 */
describe('keyboard-avoiding-view under a navigation bar', () => {
  let Editor: Type<unknown>;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/keyboard-editor.ts', import.meta.url)),
    );
    Editor = mod['KeyboardEditor'] as Type<unknown>;
  });

  /** iPhone 17 Pro: an 874 point window, a 116 point bar, and a keyboard 335 tall. */
  async function open(behavior: 'padding' | 'height', frame = { y: 116, height: 758 }) {
    let emit: (metrics: KeyboardMetrics) => void = () => {};
    const fabric = createFakeFabric();
    const app = mount(1, Editor, fabric, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: (m: KeyboardMetrics) => void) => ((emit = fn), () => {}),
            dismiss: () => {},
          },
        },
      ],
    });
    app.componentRef.setInput('behavior', behavior);
    await settle();

    fabric.frames.set('avoider', { x: 0, width: 402, ...frame });
    const avoider = () => fabric.committed[0]!.children[0]!;
    fabric.emit(avoider(), 'topLayout', {
      layout: { x: 0, y: 0, width: 402, height: frame.height },
    });
    await settle();
    return { fabric, app, avoider, emit };
  }

  it('pads by the whole overlap, measured in the window, not by less a bar height', async () => {
    const { app, avoider, emit } = await open('padding');

    emit({ height: 335, screenY: 539 });
    await settle();

    // The view's bottom is at 116 + 758 = 874, the keyboard's top at 539.
    assert.equal(avoider().props['paddingBottom'], 335);
    const [body, bar] = avoider().children;
    assert.equal(body!.viewName, 'ScrollView', 'the body is still there to shrink');
    assert.equal(bar!.props['height'], 44, 'and the bar is still there to sit on the keyboard');

    app.applicationRef.destroy();
  });

  it('shrinks by the whole overlap in height mode', async () => {
    const { app, avoider, emit } = await open('height');

    emit({ height: 335, screenY: 539 });
    await settle();

    assert.equal(avoider().props['height'], 758 - 335);
    assert.equal(avoider().props['flex'], 0);

    app.applicationRef.destroy();
  });

  it('never pads a view by more than its own height', async () => {
    // A short view low on the screen: the keyboard covers all of it and then some.
    const { app, avoider, emit } = await open('padding', { y: 780, height: 94 });

    emit({ height: 335, screenY: 539 });
    await settle();

    assert.equal(avoider().props['paddingBottom'], 94);

    app.applicationRef.destroy();
  });

  it("falls back to the layout's own frame where the window cannot be measured", async () => {
    const { fabric, app, avoider, emit } = await open('padding');
    fabric.frames.clear();
    fabric.emit(avoider(), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: 758 } });
    await settle();

    emit({ height: 335, screenY: 539 });
    await settle();

    // What RN computes: the frame's top taken as the window's.
    assert.equal(avoider().props['paddingBottom'], 758 - 539);

    app.applicationRef.destroy();
  });
});

/**
 * RN composes the adjustment over the caller's style, so it wins: a view told `flex: 1` still
 * gets its `flex: 0` in height mode, and a bound padding still gives way to the keyboard's. The
 * caller's other properties stay where they were.
 */
describe('keyboard-avoiding-view over a style of its own', () => {
  let Styled: Type<unknown>;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/keyboard-styled.ts', import.meta.url)),
    );
    Styled = mod['KeyboardStyled'] as Type<unknown>;
  });

  async function open(behavior: 'padding' | 'height' | 'position') {
    let emit: (metrics: KeyboardMetrics) => void = () => {};
    const fabric = createFakeFabric();
    const app = mount(1, Styled, fabric, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (fn: (m: KeyboardMetrics) => void) => ((emit = fn), () => {}),
            dismiss: () => {},
          },
        },
      ],
    });
    app.componentRef.setInput('behavior', behavior);
    await settle();

    fabric.frames.set('avoider', { x: 0, y: 0, width: 402, height: 874 });
    const avoider = () => fabric.committed[0]!.children[0]!;
    fabric.emit(avoider(), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: 874 } });
    await settle();
    return { app, avoider, emit };
  }

  it('pads by the overlap over a bound and a class padding', async () => {
    const { app, avoider, emit } = await open('padding');
    assert.equal(avoider().props['paddingBottom'], 12, "the caller's own padding at rest");

    emit({ height: 335, screenY: 539 });
    await settle();

    assert.equal(avoider().props['paddingBottom'], 335);
    assert.equal(avoider().props['flex'], 1, "the caller's flex is left alone");
    assert.equal(avoider().props['borderTopWidth'], 2, "and so is the class's border");

    emit({ height: 0 });
    await settle();
    assert.equal(avoider().props['paddingBottom'], 12, "the caller's padding back once hidden");

    app.applicationRef.destroy();
  });

  it('shrinks with flex 0 in height mode over a bound flex 1', async () => {
    const { app, avoider, emit } = await open('height');

    emit({ height: 335, screenY: 539 });
    await settle();

    assert.equal(avoider().props['height'], 874 - 335);
    assert.equal(avoider().props['flex'], 0);
    assert.equal(avoider().props['paddingBottom'], 12, 'height mode leaves padding to the caller');
    assert.ok(avoider().props['backgroundColor'], "the caller's colour still applies");

    emit({ height: 0 });
    await settle();
    assert.equal(avoider().props['flex'], 1, "the caller's flex back once hidden");
    assert.equal(avoider().props['height'], 900);

    app.applicationRef.destroy();
  });

  it('moves the content by the overlap over its own bottom in position mode', async () => {
    const { app, avoider, emit } = await open('position');

    emit({ height: 335, screenY: 539 });
    await settle();

    const content = avoider().children[0]!;
    assert.equal(content.props['bottom'], 335);
    assert.equal(content.props['flex'], 1, "the content container's other styles still apply");
    assert.equal(avoider().props['paddingBottom'], 12, 'the outer view is left as it was');
    assert.equal(avoider().props['flex'], 1);

    app.applicationRef.destroy();
  });
});
