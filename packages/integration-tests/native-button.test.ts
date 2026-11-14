/**
 * `<native-button>`: a platform button. NSButton on macOS and UIButton on iOS, which the host
 * implements under the view name `NgNativeButton`, and a drawn pressable on Android.
 *
 * The contract for a host that draws it: the props are `title` (the projected text), `kind`
 * (`default`, `cancel`, `destructive` or `plain`; `default` takes Return and `cancel` takes
 * Escape in its window), `controlSize` (`mini`, `small`, `regular` or `large`), `sfSymbol` and
 * `enabled`. A click, a tap, or a key that activates it sends `topButtonPress` to the view. The engine's
 * responder does not press it there, so one activation is one `(press)`.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = { off: { set(value: boolean): void }; presses(): number };
let Fixture: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/native-button.ts');
  Fixture = mod['NativeButtonFixture'] as Type<Fixture>;
});

afterEach(cleanup);

const touch = async (node: Parameters<typeof fireEvent>[0]) => {
  await fireEvent(node, 'touchStart', { touches: [{}], changedTouches: [{}] });
  await fireEvent(node, 'touchEnd', { touches: [], changedTouches: [{}] });
  await settle();
};

for (const os of ['ios', 'macos'] as const) {
  describe(`on ${os}`, () => {
    before(() => registerPlatformComponents(os));
    after(() => registerPlatformComponents('ios'));

    it('commits the native button, with its label and inputs as props', async () => {
      const { getByTestId } = await render(Fixture);
      const button = getByTestId('delete');
      assert.equal(button.viewName, 'NgNativeButton');
      assert.equal(button.props['title'], 'Delete');
      assert.equal(button.props['kind'], 'destructive');
      assert.equal(button.props['controlSize'], 'small');
      assert.equal(button.props['sfSymbol'], 'trash');
      assert.equal(button.props['accessibilityRole'], 'button');
      assert.equal(button.children.length, 0, 'the label is a prop, not a child');
      assert.equal(getByTestId('plain').props['kind'], 'default');
      assert.equal(getByTestId('symbol').props['sfSymbol'], 'star');
      assert.equal(getByTestId('drawn').props['drawable'], 'ic_star');
    });

    it('presses once for the native press, and not for the touch around it', async () => {
      const { instance, getByTestId, fabric } = await render(Fixture);
      await touch(getByTestId('delete'));
      assert.equal(instance.presses(), 0);
      fabric.emit(getByTestId('delete'), 'topButtonPress', {});
      await settle();
      assert.equal(instance.presses(), 1);
    });

    it('is not pressed while disabled', async () => {
      const { instance, getByTestId, rerender, fabric } = await render(Fixture);
      instance.off.set(true);
      await rerender();
      assert.equal(getByTestId('delete').props['enabled'], false);
      fabric.emit(getByTestId('delete'), 'topButtonPress', {});
      await settle();
      assert.equal(instance.presses(), 0);
    });
  });
}

describe('on Android', () => {
  before(() => registerPlatformComponents('android'));
  after(() => registerPlatformComponents('ios'));

  it('is a drawn view, with its label as text, pressed by a touch', async () => {
    const { instance, getByTestId, getByText } = await render(Fixture);
    const button = getByTestId('delete');
    assert.equal(button.viewName, 'View');
    assert.ok(getByText('Delete'));
    assert.equal(button.props['accessibilityRole'], 'button');
    await touch(button);
    assert.equal(instance.presses(), 1);
  });

  it('leaves the text inside every other view as it was', async () => {
    const { getByText } = await render(Fixture);
    assert.ok(getByText('OK'));
  });

  it('is not pressed while disabled', async () => {
    const { instance, getByTestId, rerender } = await render(Fixture);
    instance.off.set(true);
    await rerender();
    await touch(getByTestId('delete'));
    assert.equal(instance.presses(), 0);
  });
});
