/**
 * A `<fieldset>`'s legend: set on the fieldset's top border by its measured height, in an app
 * that asked for the package, and left where it is written in any other.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, signal } from '@angular/core';
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

@Component({
  selector: 'x-bound',
  template: `
    <fieldset testID="set" [style]="look()">
      <legend testID="legend">Details</legend>
    </fieldset>
    <div testID="plain"></div>
  `,
})
class Bound {
  readonly document: Dom = inject(DOCUMENT);
  readonly look = signal('padding: 18px; border-width: 1px');
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

  describe('taken out of its fieldset', () => {
    const placed = async () => {
      const app = await render(Bound, { providers: [provideWebCompat()] });
      await settle();
      await measured(40);
      assert.equal(legendMargin(), -39, 'set on the border first');
      assert.equal(fieldsetMargin(), 20);
      return app.instance;
    };
    /** The legend is held as the engine's node, which it keeps off the screen once out. */
    const gone = (legend: Dom) => {
      assert.equal(fieldsetMargin(), 0, 'the fieldset has no margin added');
      assert.equal(legend.props['styleOverride'] ?? null, null, 'nor the legend an override');
    };

    it('gives the margins back when it is removed', async () => {
      const { document } = await placed();
      const legend = document.querySelector('legend');
      legend.remove();
      await settle();
      gone(legend);
    });

    it('gives them back when it is moved to another element, and sets it again when it returns', async () => {
      const { document } = await placed();
      const legend = document.querySelector('legend');
      document.querySelector('div').appendChild(legend);
      await settle();
      gone(legend);
      document.querySelector('fieldset').appendChild(legend);
      await settle();
      assert.equal(legendMargin(), -39, 'at the height it was laid out at');
      assert.equal(fieldsetMargin(), 20);
    });

    it('gives them back when it is removed after the border has gone', async () => {
      const { document } = await placed();
      document.querySelector('fieldset').style.borderWidth = '0';
      await settle();
      const legend = document.querySelector('legend');
      legend.remove();
      await settle();
      gone(legend);
    });
  });

  it('keeps the fieldset margin beside a style bound on the fieldset, and out of what is read of it', async () => {
    const { look, document } = await (async () => {
      const app = await render(Bound, { providers: [provideWebCompat()] });
      await settle();
      await measured(40);
      return app.instance;
    })();
    const set = document.querySelector('fieldset');
    assert.equal(fieldsetMargin(), 20);
    look.set('padding: 18px; border-width: 1px; margin-bottom: 7px');
    await settle();
    assert.equal(fieldsetMargin(), 20, 'not lost to the style bound after');
    assert.equal(screen.getByTestId('set').props['marginBottom'], 7);
    assert.doesNotMatch(set.style.cssText, /margin-top/);
    assert.doesNotMatch(set.getAttribute('style') ?? '', /margin-top/);
    assert.equal(set.style.marginTop, '');
  });
});
