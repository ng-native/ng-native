/**
 * The elements a browser lays out inline: HTML's own, a span, a label, a button, which sit in
 * the line of the block they are in and set what they hold on it; and a library's custom
 * elements, inline until they hold a block. A custom element that is a flex item is a block, as
 * a browser makes it, and lays out what it holds in lines.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CUSTOM_ELEMENTS_SCHEMA, Component } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

/** A form field's label, and a chip in a row: the elements a library writes. */
@Component({
  selector: 'x-page',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styles: `
    .row {
      display: flex;
      flex-direction: row;
    }
    .float {
      position: absolute;
    }
  `,
  template: `
    <div testID="field">
      <label testID="label"
        ><x-label testID="title">Title</x-label><span testID="marker"><b>*</b></span></label
      >
      <label testID="floating" class="float"
        ><x-label>Title</x-label><span><b>*</b></span></label
      >
    </div>
    <div class="row">
      <x-chip testID="chip"><span>One</span><x-icon></x-icon></x-chip>
    </div>
    <button testID="button">Go</button>
  `,
})
class Page {}

/** The custom elements a library the app named to the build has selectors for. */
const LIBRARY_ELEMENTS = ['x-label', 'x-chip', 'x-icon'];
const globals = globalThis as { ɵngNativeBrowserElements?: Set<string>; document?: Dom };

beforeEach(() => void (globals.ɵngNativeBrowserElements = new Set(LIBRARY_ELEMENTS)));
afterEach(() => {
  cleanup();
  delete globals.ɵngNativeBrowserElements;
});

const node = (selector: string) => globals.document!.querySelector(selector);
/** Whether a box lays what it holds out in lines: a row that wraps. */
const inLines = (id: string) => {
  const { flexDirection, flexWrap } = screen.getByTestId(id).props;
  return flexDirection === 'row' && flexWrap === 'wrap';
};

describe('an inline element in an app that asked for web-compat', () => {
  it("marks HTML's inline elements inline, and not a block", async () => {
    await render(Page, { providers: [provideWebCompat()] });
    await settle();
    for (const name of ['label', 'span', 'button']) assert.equal(node(name).inlineLevel, 'always');
    assert.equal(node('div').inlineLevel, undefined);
  });

  it("sets what a label holds on its line, a library's element and a span side by side", async () => {
    // A required field's label: its words in the library's element, and the marker in a span.
    await render(Page, { providers: [provideWebCompat()] });
    await settle();
    assert.equal(node('x-label').inlineLevel, 'unless-block');
    assert.equal(inLines('label'), true);
  });

  it('does so for a label out of the flow too, as a floating label is', async () => {
    await render(Page, { providers: [provideWebCompat()] });
    await settle();
    assert.equal(screen.getByTestId('floating').props['position'], 'absolute');
    assert.equal(inLines('floating'), true);
  });

  it("lays out what a library's element holds in lines where it is a flex item", async () => {
    // A browser makes a flex item a block, whose content is laid out in lines as any block's.
    await render(Page, { providers: [provideWebCompat()] });
    await settle();
    assert.equal(inLines('chip'), true);
    assert.equal(node('x-icon').inlineLevel, 'unless-block');
  });
});

describe('an inline element in an app that did not ask', () => {
  it('is marked nothing', async () => {
    const error = console.error;
    console.error = () => {};
    try {
      await render(Page);
    } finally {
      console.error = error;
    }
    assert.equal(inLines('label'), false);
  });
});
