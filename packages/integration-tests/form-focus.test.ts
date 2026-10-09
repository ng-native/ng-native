/**
 * Taking the user to a field: Signal Forms' `focusBoundControl()`, which is how a submit that
 * fails puts the cursor in the first field that needs fixing. Angular focuses a field by calling
 * `focus()` on its element and, given several, picks the first by DOM order; neither exists on a
 * native element, so the controls say how to focus themselves and the engine says which comes
 * first.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Keyboard, type KeyboardMetrics } from '@ng-native/device';
import { cleanup, fireEvent, render, screen, type FakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/form-focus.ts');
});

interface Focusable {
  focusBoundControl(): void;
}
interface Form {
  f: (() => Focusable & { invalid(): boolean }) & {
    email: () => Focusable;
    city: () => Focusable;
  };
}

const focused = (fabric: FakeFabric) =>
  fabric.commands
    .filter((command) => command.name === 'focus')
    .map((command) => command.node?.props['nativeID']);

describe('focusing a form field that takes no keyboard', () => {
  it('scrolls the field into view, since there is no cursor to put in it', async () => {
    const { fabric, instance } = await render(
      mod['FormFocusToggle'] as Type<{ f: { terms: () => Focusable } }>,
    );
    // Where native says things are: the page at the top of the window, the toggle far below it.
    fabric.frames.set('page', { x: 0, y: 100, width: 400, height: 700 });
    // The page's content view, not scrolled yet: its top is the page's.
    fabric.frames.set('View', { x: 0, y: 100, width: 400, height: 2400 });
    fabric.frames.set('terms', { x: 16, y: 2150, width: 51, height: 31 });
    instance.f.terms().focusBoundControl();
    const scroll = fabric.commands.find((command) => command.name === 'scrollTo');
    assert.ok(scroll, 'the page scrolls');
    assert.equal(scroll.node?.props['nativeID'], 'page');
    // Just far enough for the toggle to clear the bottom of the page, with a margin.
    assert.deepEqual(scroll.args, [0, 2150 + 31 + 16 - 800, true]);
  });
});

describe('moving between fields with the keyboard up', () => {
  it('scrolls the field just clear of the keyboard, which UIKit does only as it rises', async () => {
    const listeners = new Set<(metrics: KeyboardMetrics) => void>();
    const { fabric } = await render(mod['FieldsOnPage'] as Type<unknown>, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (listener: (metrics: KeyboardMetrics) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            dismiss: () => {},
          },
        },
      ],
    });
    for (const listener of listeners) listener({ height: 336, screenY: 538 });
    // The page fills the window, scrolled 300 down; the postcode sits behind the keyboard's top.
    fabric.frames.set('page', { x: 0, y: 0, width: 400, height: 874 });
    fabric.frames.set('View', { x: 0, y: -300, width: 400, height: 2000 });
    fabric.frames.set('postcode', { x: 16, y: 520, width: 368, height: 44 });
    await fireEvent(screen.getByTestId('postcode'), 'focus', {});
    const scroll = fabric.commands.find((command) => command.name === 'scrollTo');
    assert.deepEqual(scroll?.args, [0, 300 + (520 + 44 + 16 - 538), true]);
  });

  it('scrolls the page for a field inside a sideways carousel on it', async () => {
    const listeners = new Set<(metrics: KeyboardMetrics) => void>();
    const { fabric } = await render(mod['FieldInCarousel'] as Type<unknown>, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (listener: (metrics: KeyboardMetrics) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            dismiss: () => {},
          },
        },
      ],
    });
    for (const listener of listeners) listener({ height: 336, screenY: 538 });
    fabric.frames.set('page', { x: 0, y: 0, width: 400, height: 874 });
    // The page's content, which is its first View; the carousel's content is measured by id.
    fabric.frames.set('View', { x: 0, y: 0, width: 400, height: 2000 });
    fabric.frames.set('note', { x: 16, y: 700, width: 368, height: 44 });
    await fireEvent(screen.getByTestId('note'), 'focus', {});
    const scroll = fabric.commands.find((command) => command.name === 'scrollTo');
    assert.equal(scroll?.node?.props['nativeID'], 'page');
    assert.deepEqual(scroll?.args, [0, 700 + 44 + 16 - 538, true]);
  });

  it('leaves the page alone for a field already clear of the keyboard', async () => {
    const listeners = new Set<(metrics: KeyboardMetrics) => void>();
    const { fabric } = await render(mod['FieldsOnPage'] as Type<unknown>, {
      providers: [
        {
          provide: Keyboard.SOURCE,
          useValue: {
            subscribe: (listener: (metrics: KeyboardMetrics) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            dismiss: () => {},
          },
        },
      ],
    });
    for (const listener of listeners) listener({ height: 336, screenY: 538 });
    fabric.frames.set('page', { x: 0, y: 0, width: 400, height: 874 });
    fabric.frames.set('View', { x: 0, y: -300, width: 400, height: 2000 });
    fabric.frames.set('city', { x: 16, y: 300, width: 368, height: 44 });
    await fireEvent(screen.getByTestId('city'), 'focus', {});
    assert.equal(fabric.commands.filter((command) => command.name === 'scrollTo').length, 0);
  });
});

describe('focusing a form field', () => {
  it('focuses the native field bound to it', async () => {
    const { fabric, instance } = await render(mod['FormFocus'] as Type<Form>);
    instance.f.email().focusBoundControl();
    assert.deepEqual(focused(fabric), ['email']);
  });

  it('focuses the first invalid field of a form, in the order the screen shows them', async () => {
    const { fabric, instance } = await render(mod['FormFocus'] as Type<Form>);
    // The form as a whole: its first field in screen order, whatever order the schema lists them.
    instance.f().focusBoundControl();
    assert.deepEqual(focused(fabric), ['name']);
  });
});
