/**
 * The DOM's mouse events, which a desktop host sends as React Native's pointer events, and
 * `(dblclick)`, `(contextmenu)` and `(wheel)`, which it sends as element events of their own
 * (issue 1430: a `(mouseenter)` binding was never delivered on any host).
 *
 * The contract for a host: each binding commits an opt-in prop, and the host sends the event to a
 * view whose props have it.
 *
 * | Binding         | Opt-in prop      | Event the host sends | Payload                                  |
 * | --------------- | ---------------- | -------------------- | ---------------------------------------- |
 * | `(mouseenter)`  | `onPointerEnter` | `topPointerEnter`    | React Native's pointer event             |
 * | `(mouseleave)`  | `onPointerLeave` | `topPointerLeave`    | the same                                 |
 * | `(mousemove)`   | `onPointerMove`  | `topPointerMove`     | the same                                 |
 * | `(mouseover)`   | `onPointerOver`  | `topPointerOver`     | the same                                 |
 * | `(mouseout)`    | `onPointerOut`   | `topPointerOut`      | the same                                 |
 * | `(dblclick)`    | `onDoubleClick`  | `topDoubleClick`     | `{ pageX, pageY, locationX, locationY }` |
 * | `(contextmenu)` | `onContextMenu`  | `topContextMenu`     | the same                                 |
 * | `(wheel)`       | `onWheel`        | `topWheel`           | `{ deltaX, deltaY, deltaZ, deltaMode }`  |
 *
 * A mouse event never fires for a finger, whose pointer events a phone with them on also sends.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let Component: Type<{ heard(): string[] }>;
before(async () => {
  const mod = await compileFixture('fixtures/mouse-events.ts');
  Component = mod['MouseEvents'] as typeof Component;
});

const PAIRS = [
  ['mouseenter', 'pointerEnter', 'onPointerEnter'],
  ['mouseleave', 'pointerLeave', 'onPointerLeave'],
  ['mousemove', 'pointerMove', 'onPointerMove'],
  ['mouseover', 'pointerOver', 'onPointerOver'],
  ['mouseout', 'pointerOut', 'onPointerOut'],
  ['dblclick', 'doubleClick', 'onDoubleClick'],
  ['contextmenu', 'contextMenu', 'onContextMenu'],
  ['wheel', 'wheel', 'onWheel'],
] as const;

it('opts the view into each event its bindings listen for', async () => {
  await render(Component);
  const props = screen.getByTestId('box').props;
  for (const [, , prop] of PAIRS) assert.equal(props[prop], true, prop);
});

it('runs each binding once for the event the host sends', async () => {
  const { componentRef } = await render(Component);
  for (const [binding, event] of PAIRS) {
    await fireEvent(screen.getByTestId('box'), event, { pointerType: 'mouse' });
    await settle();
    assert.equal(componentRef.instance.heard().at(-1), binding, binding);
  }
  assert.equal(componentRef.instance.heard().length, PAIRS.length);
});

it('runs no mouse binding for a finger', async () => {
  const { componentRef } = await render(Component);
  for (const [, event] of PAIRS.slice(0, 5)) {
    await fireEvent(screen.getByTestId('box'), event, { pointerType: 'touch' });
  }
  await settle();
  assert.deepEqual(componentRef.instance.heard(), []);
});
