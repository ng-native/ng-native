/**
 * A component that detaches its own change detection before Angular first checks it.
 *
 * The usual start of a manually driven component. Its template's elements are created, but no
 * update pass runs in it until it calls `detectChanges()`, so anything a host primitive writes
 * from its lifecycle hooks would wait for a pass that may never come. On the web the listener and
 * the attributes are there from creation, and so they must be here.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, userEvent } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Detached {
  presses: number;
}

describe('a view detached before its first check', () => {
  let Component: Type<Detached>;

  before(async () => {
    const mod = await compileFixture('fixtures/detached.ts');
    Component = mod['Detached'] as Type<Detached>;
  });

  afterEach(cleanup);

  it('carries its static props: testID, role and the defaults a pressable has', async () => {
    const { getByTestId } = await render(Component);
    const button = getByTestId('go');
    assert.equal(button.props['accessibilityRole'], 'button');
    assert.equal(button.props['accessibilityLabel'], 'Go');
    assert.equal(button.props['accessible'], true);
    assert.equal(getByTestId('line').props['numberOfLines'], 1);
    assert.ok(getByTestId('field'));
    assert.ok(getByTestId('toggle'));
  });

  it('takes a press, whose handler can then run change detection itself', async () => {
    const { getByText, instance } = await render(Component);
    await userEvent.press(getByText('tap'));
    assert.equal(instance.presses, 1);
    assert.ok(getByText('1'), 'detectChanges() from the handler renders the count');
  });
});
