/**
 * Signal forms bound to native controls, and the value-echo protocols that make writing
 * back into a live native control safe.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import {
  cleanup,
  fireEvent,
  render,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { createRequire } from 'node:module';
import { compileFixture } from './compile.ts';

const { compileCss } = createRequire(import.meta.url)('@ng-native/metro/css/compile.cjs');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// No nativeID/testID in this fixture, and the fields aren't matched by role - `getByTestId`/
// `getByRole` have nothing to key on, so this stays a local viewName lookup over the fake Fabric.
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);
const find = (f: FakeFabric, name: string) =>
  flatten(f.committed).find((n) => n.viewName === name)!;

interface Host {
  data: {
    set(value: { name: string; subscribed: boolean }): void;
    (): { name: string; subscribed: boolean };
  };
  f: {
    name: () => { errors: () => readonly unknown[] };
    subscribed: () => { touched: () => boolean };
  };
}

describe('signal forms over native controls', () => {
  let Component: Type<unknown>;
  let fabric: FakeFabric;
  let host: Host;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/signal-form.ts', import.meta.url)),
    );
    Component = mod['SignalForm'] as Type<unknown>;
  });

  beforeEach(async () => {
    const rendered = await render(Component);
    fabric = rendered.fabric;
    host = rendered.instance as unknown as Host;
  });

  afterEach(() => cleanup());

  it('binds a field to a native control with no adapter class', () => {
    // The whole contract is a model() named `value`. There is no ControlValueAccessor here.
    assert.ok(find(fabric, 'TextInput'), 'the text input committed');
    assert.ok(find(fabric, 'Switch'), 'the switch committed');
  });

  it('pushes a model change down to the native control', async () => {
    host.data.set({ name: 'Ada', subscribed: false });
    await settle();
    assert.equal(find(fabric, 'TextInput').props['text'], 'Ada');
  });

  it('pulls a native edit up into the model, and validates it', async () => {
    await fireEvent.changeText(find(fabric, 'TextInput'), 'Ada');

    assert.equal(host.data().name, 'Ada');
    assert.deepEqual(host.f.name().errors(), [], 'long enough to satisfy minLength');
  });

  it('surfaces validation errors from a native edit', async () => {
    await fireEvent.changeText(find(fabric, 'TextInput'), 'A');

    const errors = host.f.name().errors();
    assert.ok(errors.length > 0, 'minLength(3) rejected a single character');
  });

  it('echoes mostRecentEventCount so native can reject stale writes', async () => {
    // Without this a controlled input fights the cursor: native cannot tell a fresh JS value
    // from one computed before the last few keystrokes. `fireEvent.changeText` only ever sends the
    // next expected count, not an arbitrary jump like this test needs, so it stays a raw emit.
    assert.equal(find(fabric, 'TextInput').props['mostRecentEventCount'], 0);

    fabric.emit(find(fabric, 'TextInput'), 'topChange', { text: 'Ada', eventCount: 7 });
    await settle();

    assert.equal(find(fabric, 'TextInput').props['mostRecentEventCount'], 7);
  });

  it('puts the switch back when the model is set back after a flip', async () => {
    // The user flips it on and the form takes it; later the app sets it off from code. The prop
    // changes, so the diff carries it - refusals, where it does not, are `controlled-inputs.test.ts`.
    // A switch's `topChange` carries a `value`, not `text`/`eventCount`, so this is the generic
    // form of `fireEvent` rather than the named `changeText` helper.
    await fireEvent(find(fabric, 'Switch'), 'change', { value: true });
    assert.equal(host.data().subscribed, true, 'the flip reached the model');

    host.data.set({ name: host.data().name, subscribed: false });
    await settle();

    assert.equal(find(fabric, 'Switch').props['value'], false, 'native was pushed back');
  });
});

describe('a switch as a Signal Forms control', () => {
  it('marks its field touched when the user flips it, and publishes it for a stylesheet', async () => {
    // A switch has no blur, so the flip is the moment the user has dealt with it: what a form that
    // shows its errors once a field is touched waits for.
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/signal-form.ts', import.meta.url)),
    );
    const { fabric, instance } = await render(mod['SignalForm'] as Type<unknown>, {
      globalStyles: compileCss('[data-touched] { opacity: 0.5 }', 'global'),
    });
    const host = instance as unknown as Host;
    assert.equal(host.f.subscribed().touched(), false, 'untouched until the user acts');
    assert.equal(find(fabric, 'Switch').props['opacity'], undefined);

    await fireEvent(find(fabric, 'Switch'), 'change', { value: true });

    assert.equal(host.f.subscribed().touched(), true);
    assert.equal(find(fabric, 'Switch').props['opacity'], 0.5);
    cleanup();
  });
});

describe('focusing a text input from code', () => {
  it('sends the focus and blur commands to the committed native node', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/signal-form.ts', import.meta.url)),
    );
    const { fabric, instance } = await render(mod['SignalForm'] as Type<unknown>);

    const field = (instance as { input(): { focus(): void; blur(): void } }).input();
    field.focus();
    field.blur();
    assert.deepEqual(
      fabric.commands.map((c) => `${c.viewName}:${c.name}`),
      ['TextInput:focus', 'TextInput:blur'],
    );
    cleanup();
  });
});
