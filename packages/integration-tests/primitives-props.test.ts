/**
 * The primitives forward typed inputs to the host node: attribute strings are transformed, web
 * `aria-*` spellings land on the props native reads, and anything unset is never sent.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('view props', () => {
  it('forwards typed inputs, transforms attribute strings and maps aria aliases', async () => {
    const mod = await compileFixture('fixtures/view-props.ts');
    const { instance } = await render(mod['ViewProps'] as Type<unknown>);

    const root = screen.getByTestId('root', { includeHiddenElements: true });
    assert.deepEqual(root.props, {
      testID: 'root',
      accessibilityLabel: 'hello',
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
      accessibilityValue: { now: 3 },
      accessibilityState: { selected: true, busy: true },
      collapsable: false,
      pointerEvents: 'none',
      focusable: true,
      hitSlop: 10,
    });

    const plain = screen.getByTestId('plain', { includeHiddenElements: true });
    assert.deepEqual(plain.props, { testID: 'plain' }, 'unset inputs are never sent');

    (instance as { pointer: { set(v: string): void } }).pointer.set('auto');
    await settle();
    assert.equal(
      screen.getByTestId('root', { includeHiddenElements: true }).props['pointerEvents'],
      'auto',
    );
    cleanup();
  });

  it("processes Android's own colour props, ripple and underline alike", async () => {
    /*
     * Android reads the drawable description by runtime type: `color` is taken only when it is a
     * number or a platform-colour map, and a string falls through to null and the ripple draws in
     * the theme's own highlight. The failure is silent and looks like "the ripple is the wrong
     * colour", so the processing is asserted rather than assumed.
     */
    const mod = await compileFixture('fixtures/view-props.ts');
    await render(mod['RippleProps'] as Type<unknown>, {
      processColor: (value) => `processed:${String(value)}`,
    });

    assert.deepEqual(
      screen.getByTestId('behind', { includeHiddenElements: true }).props[
        'nativeBackgroundAndroid'
      ],
      {
        type: 'RippleAndroid',
        color: 'processed:#ff0000',
        borderless: false,
        rippleRadius: undefined,
      },
    );
    assert.equal(
      screen.getByTestId('behind', { includeHiddenElements: true }).props[
        'nativeForegroundAndroid'
      ],
      undefined,
      'behind or over, never both',
    );

    assert.deepEqual(
      screen.getByTestId('over', { includeHiddenElements: true }).props['nativeForegroundAndroid'],
      {
        type: 'RippleAndroid',
        color: 'processed:#00ff00',
        borderless: true,
        rippleRadius: 12,
      },
    );

    // The same pass has to reach `underlineColorAndroid`, which is a colour and does not end in
    // `color`: Android's converter takes a number or a platform-colour map and refuses a string.
    assert.equal(
      screen.getByTestId('field', { includeHiddenElements: true }).props['underlineColorAndroid'],
      'processed:transparent',
    );

    const none = screen.getByTestId('none', { includeHiddenElements: true });
    assert.equal(none.props['nativeBackgroundAndroid'], undefined);
    assert.equal(none.props['nativeForegroundAndroid'], undefined);
    cleanup();
  });

  it("processes a switch's track colours, whose names end in the state they paint", async () => {
    /*
     * `trackColorForTrue` and `trackColorForFalse` are colours that do not end in `color`, so the
     * pass that finds a colour by name misses them. Android's converter takes a number or a
     * platform-colour map and throws on a string, taking the whole surface down with it.
     */
    const mod = await compileFixture('fixtures/view-props.ts');
    await render(mod['TrackColorProps'] as Type<unknown>, {
      processColor: (value) => `processed:${String(value)}`,
    });

    const toggle = screen.getByTestId('toggle', { includeHiddenElements: true });
    assert.equal(toggle.props['trackColorForTrue'], 'processed:#0a7cff');
    assert.equal(toggle.props['trackColorForFalse'], 'processed:#cccccc');
    // The input is `thumbColor`; the directive sends it under the name each platform reads.
    assert.equal(toggle.props['thumbTintColor'], 'processed:#ffffff', 'still found by its suffix');
    cleanup();
  });
});
