/**
 * Pseudo-state: `:disabled`, `:focus` and `:active`.
 *
 * The sources already exist. `:disabled` is a prop, so it reduces to an attribute test. Focus and
 * the active gesture are engine state, so those two need the engine to invalidate the nodes it
 * changes, which it can do precisely rather than by generation, since it knows exactly which
 * nodes moved.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render, settle, type BoundQueries } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

describe('pseudo-state', () => {
  let Component: Type<unknown>;
  let queries: BoundQueries;

  before(async () => {
    const mod = await compileFixture('fixtures/stateful.ts');
    Component = mod['Stateful'] as Type<unknown>;
  });

  beforeEach(async () => {
    queries = await render(Component);
  });

  const byId = (id: string) => queries.getByTestId(id);

  it('counts :disabled as a class for specificity, like the attribute test it is', () => {
    assert.equal(
      compileCss('view:disabled { color: red }').rules[0].specificity,
      compileCss('view.x { color: red }').rules[0].specificity,
    );
  });

  it('matches :disabled from the prop', () => {
    assert.equal(byId('a').props['opacity'], 0.4);
    assert.equal(byId('b').props['opacity'], undefined);
  });

  it('applies :focus on a focus event and drops it again on blur', async () => {
    assert.equal(byId('b').props['borderTopWidth'], undefined);

    await fireEvent.focus(byId('b'));
    assert.equal(byId('b').props['borderTopWidth'], 2);

    await fireEvent.blur(byId('b'));
    // Null, not absent: clearing a prop on a persistent tree means sending an explicit null, or
    // Fabric keeps the value the previous revision had.
    assert.equal(byId('b').props['borderTopWidth'], null);
  });

  it('moves focus rather than accumulating it', async () => {
    await fireEvent.focus(byId('a'));
    await fireEvent.focus(byId('b'));

    assert.equal(byId('a').props['borderTopWidth'], null, 'the first field gave it up');
    assert.equal(byId('b').props['borderTopWidth'], 2);
  });
});

describe(':active through the responder system', () => {
  it('applies while a press is held and clears when it ends', async () => {
    const mod = await compileFixture('fixtures/active.ts');
    const { fabric, getByTestId } = await render(mod['Active'] as Type<unknown>);
    const id = (name: string) => getByTestId(name);

    assert.equal(id('btn').props['backgroundColor'], 'rgb(1, 1, 1)');

    // A touch on the text inside: the responder election runs up the tree from the target.
    fabric.emit(id('inner'), 'topTouchStart', { touches: [{}], changedTouches: [{}] });
    await settle();
    assert.equal(id('btn').props['backgroundColor'], 'rgb(2, 2, 2)', 'held');
    assert.equal(id('outer').props['borderTopWidth'], 3, ':active runs up the chain');

    fabric.emit(id('inner'), 'topTouchEnd', { touches: [], changedTouches: [{}] });
    await settle();
    assert.equal(id('btn').props['backgroundColor'], 'rgb(1, 1, 1)', 'released');
  });
});
