/**
 * `<switch>` and `<text-input>` as React Native's controlled components: once a native change has
 * been handled, the native control shows whatever the app's state says, including when the app
 * refused the change or rewrote it.
 *
 * The case that needs work is the refusal. The user flips the switch, the app keeps `false`, and
 * the binding it writes back is the one it last wrote, so Angular sends the control nothing. The
 * native view is still showing the flip, and only a command reaches it: `setValue` on iOS,
 * `setNativeValue` on Android and `setTextAndSelection` for a text field, as RN's own wrappers
 * send. Native already agrees in every other case, so those send no command at all.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen, type FakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/controlled-inputs.ts');
});

async function boot<T>(name: string): Promise<{ fabric: FakeFabric; instance: T }> {
  const { fabric, instance } = await render(mod[name] as Type<T>);
  return { fabric, instance };
}

/** What `registerPlatformComponents('android')` renames, as iOS names them. */
const IOS_VIEW_NAMES = {
  switch: 'Switch',
  'text-input': 'TextInput',
  'activity-indicator': 'ActivityIndicatorView',
  'refresh-control': 'PullToRefreshView',
  'safe-area-view': 'SafeAreaView',
  'input-accessory-view': 'InputAccessoryView',
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const flip = (value: boolean) => fireEvent(screen.getByTestId('sw'), 'change', { value });
const commands = (fabric: FakeFabric) => fabric.commands.map((c) => [c.name, ...c.args]);

describe('a controlled switch', () => {
  it('flips back when the app refuses the change', async () => {
    const { fabric, instance } = await boot<{
      on(): boolean;
      control(): { checked(): boolean };
    }>('RefusedSwitch');

    await flip(true);

    assert.equal(instance.on(), false, 'the app kept false');
    assert.equal(instance.control().checked(), false, 'and so does the model');
    assert.equal(screen.getByTestId('sw').props['value'], false);
    assert.deepEqual(commands(fabric), [['setValue', false]], 'native is told to flip back');
  });

  it('flips back on every refusal, not just the first', async () => {
    const { fabric } = await boot('RefusedSwitch');
    await flip(true);
    await flip(true);
    assert.deepEqual(commands(fabric), [
      ['setValue', false],
      ['setValue', false],
    ]);
  });

  it('sends Android its own command', async () => {
    registerPlatformComponents('android');
    try {
      const { fabric } = await boot('RefusedSwitch');
      await flip(true);
      assert.deepEqual(commands(fabric), [['setNativeValue', false]]);
    } finally {
      cleanup();
      registerPlatformComponents('ios');
      for (const [element, viewName] of Object.entries(IOS_VIEW_NAMES)) {
        registerViewName(element, viewName);
      }
    }
  });

  it('refuses through a one-way binding, and accepts through it', async () => {
    const { fabric, instance } = await boot<{
      on(): boolean;
      allow: { set(v: boolean): void };
      control(): { checked(): boolean };
    }>('OneWaySwitch');

    instance.allow.set(false);
    await flip(true);
    assert.equal(instance.control().checked(), false);
    assert.deepEqual(commands(fabric), [['setValue', false]]);

    instance.allow.set(true);
    await flip(true);
    assert.equal(instance.on(), true);
    assert.equal(instance.control().checked(), true);
    assert.equal(screen.getByTestId('sw').props['value'], true);
    assert.equal(fabric.commands.length, 1, 'accepted, so nothing more to send');
  });

  it('sends nothing when the app takes the change', async () => {
    const { fabric, instance } = await boot<{ on(): boolean }>('AcceptedSwitch');
    fabric.reset();

    await flip(true);

    assert.equal(instance.on(), true);
    assert.equal(screen.getByTestId('sw').props['value'], true);
    assert.deepEqual(fabric.commands, [], 'native already shows it');
    assert.equal(fabric.calls.completeRoot, 1, 'one commit, and no second pass after it');

    await flip(false);
    assert.equal(instance.on(), false);
    assert.deepEqual(fabric.commands, []);
  });

  it('still pushes a value set from code down as a prop', async () => {
    const { fabric, instance } = await boot<{ on: { set(v: boolean): void } }>('AcceptedSwitch');
    await flip(true);
    instance.on.set(false);
    await settle();
    assert.equal(screen.getByTestId('sw').props['value'], false);
    assert.deepEqual(fabric.commands, [], 'the prop carries it');
  });

  it('keeps its own state when nothing is bound to it', async () => {
    const { fabric, instance } = await boot<{
      log: boolean[];
      control(): { checked(): boolean };
    }>('FreeSwitch');

    await flip(true);

    assert.deepEqual(instance.log, [true]);
    assert.equal(instance.control().checked(), true);
    assert.equal(screen.getByTestId('sw').props['value'], true);
    assert.deepEqual(fabric.commands, []);
  });
});

describe('a controlled text input', () => {
  const type = (text: string, eventCount: number) =>
    fireEvent(screen.getByTestId('field'), 'change', { text, eventCount });

  /*
   * Fabric measures a text input from its state, and the state takes a text set from JavaScript
   * only in the layout that follows the measurement. So the commit that carries the new text lays
   * the field out at the old text's size: a composer cleared after sending stays three lines tall.
   * The field is committed once more, cloned with its children, which is what makes Fabric
   * measure it again, now from the new state.
   */
  it('is measured again after a value set from code, so it resizes to it', async () => {
    const { fabric, instance } = await boot<{ text: { set(value: string): void } }>(
      'AcceptedInput',
    );
    await type('a long message that wrapped onto three lines', 1);
    fabric.reset();

    instance.text.set('');
    await settle();

    const field = screen.getByTestId('field');
    assert.equal(field.props['text'], '');
    assert.equal(fabric.calls.completeRoot, 2, 'the text, then the measurement');
    assert.ok(
      fabric.calls.cloneWithChildren + fabric.calls.cloneWithChildrenAndProps >= 1,
      'the field is cloned with its children, which dirties its measurement',
    );
  });

  it('is not measured again for what the user typed, which native has measured already', async () => {
    const { fabric } = await boot('AcceptedInput');
    fabric.reset();
    await type('typed', 1);
    assert.equal(fabric.calls.completeRoot, 1);
  });

  it('puts the old text back when the app refuses a keystroke', async () => {
    const { fabric, instance } = await boot<{
      digits(): string;
      control(): { value(): string };
    }>('RefusedInput');

    await type('12a', 1);

    assert.equal(instance.digits(), '12');
    assert.equal(instance.control().value(), '12', 'the model says what the app says');
    assert.deepEqual(commands(fabric), [['setTextAndSelection', 1, '12', -1, -1]]);

    await type('123', 2);
    assert.equal(instance.digits(), '123');
    assert.equal(fabric.commands.length, 1, 'an accepted keystroke needs no command');
  });

  it('shows the text the app turned it into', async () => {
    const { fabric, instance } = await boot<{
      text(): string;
      control(): { value(): string };
    }>('ShoutingInput');

    await type('a', 1);
    await type('Ab', 2);

    assert.equal(instance.text(), 'AB');
    assert.equal(instance.control().value(), 'AB');
    assert.equal(screen.getByTestId('field').props['text'], 'AB');
    assert.deepEqual(commands(fabric), [
      ['setTextAndSelection', 1, 'A', -1, -1],
      ['setTextAndSelection', 2, 'AB', -1, -1],
    ]);
  });

  it('sends nothing when the app takes the text as typed', async () => {
    const { fabric, instance } = await boot<{ text(): string }>('AcceptedInput');
    fabric.reset();

    await type('h', 1);
    await type('hi', 2);

    assert.equal(instance.text(), 'hi');
    assert.equal(screen.getByTestId('field').props['text'], 'hi');
    assert.deepEqual(fabric.commands, []);
    assert.equal(fabric.calls.completeRoot, 2, 'one commit per keystroke');
  });

  it('keeps what is typed when nothing is bound to it', async () => {
    const { fabric, instance } = await boot<{ control(): { value(): string } }>('FreeInput');
    await type('free', 1);
    assert.equal(instance.control().value(), 'free');
    assert.deepEqual(fabric.commands, []);
  });
});

describe('controlled inputs under Signal Forms', () => {
  interface Form {
    data: {
      (): { name: string; subscribed: boolean };
      set(v: { name: string; subscribed: boolean }): void;
    };
    field(): { value(): string };
    toggle(): { checked(): boolean };
  }

  it('carries native changes up with no command sent back', async () => {
    const { fabric, instance } = await boot<Form>('ControlledForm');

    await fireEvent(screen.getByTestId('field'), 'change', { text: 'Ada', eventCount: 1 });
    await flip(true);

    assert.deepEqual(instance.data(), { name: 'Ada', subscribed: true });
    assert.equal(instance.field().value(), 'Ada');
    assert.equal(instance.toggle().checked(), true);
    assert.equal(screen.getByTestId('sw').props['value'], true);
    assert.deepEqual(fabric.commands, []);
  });

  it('carries a model change down', async () => {
    const { fabric, instance } = await boot<Form>('ControlledForm');
    await flip(true);

    instance.data.set({ name: 'Grace', subscribed: false });
    await settle();

    assert.equal(screen.getByTestId('field').props['text'], 'Grace');
    assert.equal(screen.getByTestId('sw').props['value'], false);
    assert.equal(instance.toggle().checked(), false);
    assert.deepEqual(fabric.commands, [], 'nothing typed yet, so the text prop is enough');
  });
});
