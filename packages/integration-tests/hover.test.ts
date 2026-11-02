/**
 * Hover, on an app that turned on native pointer events. A finger then enters what it lands on and
 * leaves when it lifts, as pointer events do in a browser, and that is not hover: a phone would
 * flash `hovered` on every tap. What a mouse, a trackpad or a pencil sends is.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/hover.ts');
});

const state = () => screen.getByTestId('state').children[0]?.props['text'];

async function pointer(type: 'pointerEnter' | 'pointerLeave', pointerType: string) {
  await fireEvent(screen.getByTestId('press'), type, { pointerType });
  await settle();
}

it('follows a mouse in and out', async () => {
  await render(mod['Hover'] as Type<unknown>);
  await pointer('pointerEnter', 'mouse');
  assert.equal(state(), 'true');
  await pointer('pointerLeave', 'mouse');
  assert.equal(state(), 'false');
});

it('follows a pencil, which hovers on an iPad', async () => {
  await render(mod['Hover'] as Type<unknown>);
  await pointer('pointerEnter', 'pen');
  assert.equal(state(), 'true');
});

it('stays false for a finger', async () => {
  await render(mod['Hover'] as Type<unknown>);
  await pointer('pointerEnter', 'touch');
  assert.equal(state(), 'false');
});

it('stays true when a finger lifts while a mouse is over it', async () => {
  await render(mod['Hover'] as Type<unknown>);
  await pointer('pointerEnter', 'mouse');
  await pointer('pointerLeave', 'touch');
  assert.equal(state(), 'true');
});
