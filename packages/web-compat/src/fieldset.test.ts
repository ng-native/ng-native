/**
 * A `<fieldset>`'s legend: set on the fieldset's top border by its measured height, in an app
 * that asked for the package, and left where it is written in any other.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-details',
  template: `
    <fieldset testID="set" style="padding: 18px; border-width: 1px">
      <legend testID="legend">Details</legend>
      <div>Name</div>
    </fieldset>
  `,
})
class Details {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const measured = async (height: number) => {
  await fireEvent(screen.getByTestId('legend'), 'layout', { layout: { height } });
  await settle();
};
const legendMargin = () => screen.getByTestId('legend').props['marginTop'] ?? 0;
const fieldsetMargin = () => screen.getByTestId('set').props['marginTop'] ?? 0;

describe("a fieldset's legend", () => {
  it('is set on the top border by its height, and the fieldset is as tall as it was', async () => {
    // A browser draws the border through the middle of the legend, and what the fieldset
    // holds under the legend with the padding between them.
    await render(Details, { providers: [provideWebCompat()] });
    await settle();
    assert.equal(legendMargin(), 0);
    await measured(40);
    // Up over the padding and the border, and half its own height above them.
    assert.equal(legendMargin(), -39);
    assert.equal(screen.getByTestId('legend').props['marginBottom'], 18);
    assert.equal(fieldsetMargin(), 20);
    // A legend of another height is set again by it.
    await measured(24);
    assert.equal(legendMargin(), -31);
    assert.equal(fieldsetMargin(), 12);
  });

  it('is left where it is written in a fieldset with no border to set it on, and set once there is', async () => {
    // A stylesheet's reset takes the border away, and the legend is the first thing in the box.
    const app = await render(Details, { providers: [provideWebCompat()] });
    await settle();
    const set = app.instance.document.querySelector('fieldset');
    set.style.borderWidth = '0';
    await settle();
    await measured(40);
    assert.equal(legendMargin(), 0);
    assert.equal(fieldsetMargin(), 0);
    set.style.borderWidth = '1px';
    await settle();
    await measured(40);
    assert.equal(legendMargin(), -39);
  });

  it('is not moved in an app without provideWebCompat()', async () => {
    await render(Details);
    await settle();
    await measured(40);
    assert.equal(legendMargin(), 0);
    assert.equal(fieldsetMargin(), 0);
  });
});
