/**
 * What a library's HTML element starts as before any stylesheet, as a browser's own stylesheet
 * has it: sized `content-box`, a block where HTML has one, and a button or a select sized whole.
 * Only in an app that asked for the package, only for HTML's elements, and under every style an
 * app or a library writes.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

afterEach(cleanup);

@Component({
  selector: 'x-page',
  styles: `
    .flex {
      display: flex;
      flex-direction: row;
    }
  `,
  template: `
    <div testID="div" style="padding-top: 100px; height: 100px">
      <span testID="span">words</span>
    </div>
    <div testID="flex" class="flex"></div>
    <div testID="sized" style="box-sizing: border-box; padding-top: 4px"></div>
    <section testID="section"></section>
    <p testID="p">a paragraph</p>
    <view testID="view" style="padding-top: 4px"></view>
    <button testID="button">Go</button>
    <select testID="select"></select>
    <table testID="table"></table>
    <input testID="input" />
    <svg testID="svg">
      <a testID="svg-a"><rect width="4" height="4" /></a>
    </svg>
  `,
})
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

const IDS = [
  'div',
  'span',
  'flex',
  'sized',
  'section',
  'p',
  'view',
  'button',
  'select',
  'table',
  'input',
];

const computed = (node: unknown): Dom =>
  (globalThis as unknown as { getComputedStyle(node: unknown): Dom }).getComputedStyle(node);

/** The page, in an app that asked for the package, and each element by its `testID`. */
async function asked() {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = app.fixture.componentInstance.document;
  const element = (id: string): Dom => document.querySelector(`[testID="${id}"]`);
  const committed = (id: string) => (screen.getByTestId(id) as FakeFabricNode).props;
  return { element, committed };
}

describe('a library element in an app that asked for web-compat', () => {
  it('is sized content-box, as getComputedStyle says', async () => {
    const { element, committed } = await asked();
    assert.equal(committed('div')['boxSizing'], 'content-box');
    assert.equal(computed(element('div')).boxSizing, 'content-box');
  });

  it('is a block where HTML has one, as getComputedStyle says', async () => {
    const { element } = await asked();
    for (const id of ['div', 'section', 'p']) {
      assert.equal(element(id).defaultStyle?.display, 'block', id);
      assert.equal(computed(element(id)).display, 'block', id);
    }
  });

  it('keeps a paragraph the text it is', async () => {
    await asked();
    assert.equal(screen.getByTestId('p').viewName, 'Paragraph');
  });

  it("gives way to a stylesheet's display and an inline box-sizing", async () => {
    const { element, committed } = await asked();
    assert.equal(computed(element('flex')).display, 'flex');
    assert.equal(committed('flex')['flexDirection'], 'row');
    assert.equal(committed('sized')['boxSizing'], 'border-box');
    assert.equal(computed(element('sized')).boxSizing, 'border-box');
  });

  it('leaves a span inline: no display of its own', async () => {
    const { element } = await asked();
    assert.equal(element('span').defaultStyle?.display, undefined);
    assert.equal(screen.getByTestId('span').viewName, 'Paragraph');
  });

  it('sizes a button, a select and a table whole, and a text field by its content', async () => {
    const { element, committed } = await asked();
    for (const id of ['button', 'select', 'table']) {
      assert.equal(committed(id)['boxSizing'], 'border-box', id);
      assert.equal(computed(element(id)).boxSizing, 'border-box', id);
    }
    assert.equal(committed('input')['boxSizing'], 'content-box');
    assert.equal(committed('input')['underlineColorAndroid'], 'transparent', "a field's own");
  });

  it("gives a script's HTML element the same, and one in no namespace nothing", async () => {
    await asked();
    const document: Dom = (globalThis as Dom).document;
    assert.equal(document.createElement('div').defaultStyle?.display, 'block');
    const xhtml = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    assert.equal(xhtml.defaultStyle?.display, 'block');
    assert.equal(document.createElementNS(null, 'div').defaultStyle, undefined);
  });

  it('gives a copy cloneNode makes the default the element has', async () => {
    const { element } = await asked();
    assert.equal(element('section').cloneNode().defaultStyle?.display, 'block');
    assert.equal(element('button').cloneNode(true).defaultStyle?.boxSizing, 'border-box');
    assert.equal(element('view').cloneNode().defaultStyle, undefined);
  });

  it('leaves a <view> and a drawing as they are', async () => {
    const { element, committed } = await asked();
    assert.equal(element('view').defaultStyle, undefined);
    assert.equal(committed('view')['boxSizing'], undefined);
    assert.equal(element('svg-a').defaultStyle?.boxSizing, undefined, "a drawing's <a>");
  });
});

describe('the same template in an app that did not ask', () => {
  it('commits what it did before the package gave elements defaults', async () => {
    await render(Page);
    const props = Object.fromEntries(
      IDS.map((id) => [id, (screen.getByTestId(id) as FakeFabricNode).props]),
    );
    // What main committed for these before the defaults: none of them is a default's.
    assert.deepEqual(props, {
      div: { testID: 'div', paddingTop: 100, height: 100 },
      span: { ellipsizeMode: 'clip', testID: 'span', numberOfLines: 1 },
      flex: { testID: 'flex', display: 'flex', flexDirection: 'row' },
      sized: { testID: 'sized', boxSizing: 'border-box', paddingTop: 4 },
      section: { testID: 'section' },
      p: { ellipsizeMode: 'tail', testID: 'p' },
      view: { testID: 'view', paddingTop: 4 },
      button: { testID: 'button' },
      select: { testID: 'select' },
      table: { testID: 'table' },
      input: { testID: 'input' },
    });
  });
});
