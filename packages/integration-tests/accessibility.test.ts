/**
 * The accessibility defaults React Native's JavaScript wrappers apply.
 *
 * Driving the native views directly skips those wrappers, and the loss is invisible: the app
 * looks identical and is simply unusable with a screen reader, because nothing on it is an
 * accessibility element. Each default here is the one React Native's own wrapper sets, and is
 * cited where it is not obvious.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let node: (id: string) => FakeFabricNode;

before(async () => {
  const mod = await compileFixture('fixtures/accessibility.ts');
  const { getByTestId } = await render(mod['Accessible'] as Type<unknown>);
  node = (id) => getByTestId(id);
});

after(cleanup);

describe('accessibility state that a component owns', () => {
  it("keeps up when the component's own input changes, not just at mount", async () => {
    const mod = await compileFixture('fixtures/accessibility.ts');
    const { instance, getByTestId, rerender } = await render(
      mod['Accessible'] as Type<{ off: { set(value: boolean): void } }>,
    );
    const toggling = () => getByTestId('toggling');
    assert.equal(toggling().props['accessibilityState'], undefined, 'nothing to announce yet');

    instance.off.set(true);
    await rerender();

    assert.deepEqual(
      toggling().props['accessibilityState'],
      { disabled: true },
      "`disabled` is the component's own input, so nothing on the base is what notices it",
    );
    cleanup();
  });
});

describe('a prop an input stops asking for', () => {
  type Toggles = { busy: { set(value: boolean): void } };

  it('clears a prop whose binding went back to undefined', async () => {
    const mod = await compileFixture('fixtures/accessibility.ts');
    const { instance, getByTestId, rerender } = await render(mod['Accessible'] as Type<Toggles>);
    assert.equal(getByTestId('busy').props['pointerEvents'], 'none');
    instance.busy.set(false);
    await rerender();
    assert.equal(getByTestId('busy').props['pointerEvents'] ?? null, null, 'touchable again');
    cleanup();
  });
});

describe('accessibility defaults', () => {
  it('leaves a plain view alone, because a box is not an element', async () => {
    assert.equal(node('plain').props['accessible'], undefined);
    assert.equal(node('plain').props['accessibilityRole'], undefined);
  });

  /** `Pressable.js`: `accessible: accessible !== false`, and `focusable: focusable !== false`. */
  it('makes a pressable an element, and focusable, without being asked', () => {
    assert.equal(node('button').props['accessible'], true);
    assert.equal(node('button').props['focusable'], true);
  });

  it('lets a pressable opt out', () => {
    assert.equal(node('opted-out').props['accessible'], false);
    assert.equal(node('opted-out').props['focusable'], false);
  });

  /** `Pressable.js` folds its own `disabled` into the state a screen reader announces. */
  it('announces a disabled pressable as disabled', () => {
    assert.deepEqual(node('off').props['accessibilityState'], { disabled: true });
    assert.equal(
      node('button').props['accessibilityState'],
      undefined,
      'and says nothing when not',
    );
  });

  it('keeps whatever role and label the template gave', () => {
    assert.equal(node('labelled').props['accessibilityRole'], 'link');
    assert.equal(node('labelled').props['accessibilityLabel'], 'Open the docs');
  });

  it('treats touchable-opacity the same, because TouchableOpacity.js does', () => {
    assert.equal(node('fade').props['accessible'], true);
    assert.equal(node('fade').props['focusable'], true);
  });

  /** `Switch.js`: `accessibilityRole={props.accessibilityRole ?? 'switch'}`. */
  it('gives a switch the switch role, and yields to an explicit one', () => {
    assert.equal(node('toggle').props['accessibilityRole'], 'switch');
    assert.equal(node('checkbox').props['accessibilityRole'], 'checkbox');
  });

  it('announces a disabled switch as disabled', () => {
    assert.deepEqual(node('unavailable').props['accessibilityState'], {
      disabled: true,
      checked: false,
    });
  });

  it('announces a switch as checked or not, because the position is always known', () => {
    assert.deepEqual(node('toggle').props['accessibilityState'], { checked: false });
    assert.deepEqual(node('switched-on').props['accessibilityState'], { checked: true });
  });

  it("announces a switch's own position over an aria-checked that says otherwise", () => {
    // As its own `disabled` wins over `aria-disabled`: the position is what the switch shows.
    assert.deepEqual(node('said-off').props['accessibilityState'], { checked: true });
  });

  /**
   * `Text.js` splits by platform: an element on iOS always, on Android only when pressable. The
   * suite runs as iOS, which is what the engine assumes until a host says otherwise.
   */
  it('makes text an element on iOS, pressable or not, and never focusable', () => {
    assert.equal(node('prose').props['accessible'], true);
    assert.equal(node('tappable').props['accessible'], true);
    assert.equal(node('prose').props['focusable'], undefined, 'Text.js sets no focusable');
  });

  /** `Image.ios.js`: `alt` makes the image an element and becomes its label. */
  it('makes an image with alt text an element, and leaves a decorative one out', () => {
    assert.equal(node('pic').props['accessible'], true);
    assert.equal(node('pic').props['accessibilityLabel'], 'A cat asleep on a keyboard');
    assert.equal(node('decoration').props['accessible'], undefined);
  });
});
