/**
 * What a library's HTML element starts as before any stylesheet, as a browser's own stylesheet
 * has it: sized `content-box`, a block where HTML has one, and a button or a select sized whole.
 * Only in an app that asked for the package, only for HTML's elements, and under every style an
 * app or a library writes. And as a browser lays it out: `static`, so an absolute element is
 * placed against the nearest one that says `relative`; a flex item that gives up room down to
 * its content; and a button's label in the middle of it.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import {
  cleanup,
  compileCss,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
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
    <button testID="holding"><span>Go</span></button>
    <textarea testID="textarea"></textarea>
    <select testID="chooser">
      <optgroup testID="group" label="Fruit">
        <option testID="first">Apple</option>
      </optgroup>
      <option testID="second">Pear</option>
    </select>
    <table testID="table"></table>
    <input testID="input" />
    <ul>
      <li testID="li">one</li>
      <li testID="block-li">two</li>
    </ul>
    <details><summary testID="summary">More</summary></details>
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

  it('calls an li and a summary list items, as a browser does, laid out as blocks', async () => {
    const { element } = await asked();
    assert.equal(computed(element('li')).display, 'list-item');
    assert.equal(computed(element('summary')).display, 'list-item');
    // Laid out as the engine lays out a block.
    assert.equal(element('li').defaultStyle?.display, 'block');
    // One a library gives a display of its own is that.
    element('block-li').style.display = 'flex';
    assert.equal(computed(element('block-li')).display, 'flex');
  });

  it('leaves a span inline: no display of its own', async () => {
    const { element } = await asked();
    assert.equal(element('span').defaultStyle?.display, undefined);
    assert.equal(element('span').defaultStyle?.boxSizing, 'content-box');
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

  it("gives a copy of a select, a field and a button that holds a box its name's default", async () => {
    const { element } = await asked();
    for (const id of ['select', 'holding']) {
      assert.equal(element(id).cloneNode(true).defaultStyle?.boxSizing, 'border-box', id);
    }
    for (const id of ['input', 'textarea']) {
      assert.equal(element(id).cloneNode(true).defaultStyle?.boxSizing, 'content-box', id);
    }
  });

  it("keeps a select's options and groups content-box, before and after an option comes in", async () => {
    const { element } = await asked();
    const sized = () =>
      ['group', 'first', 'second'].map((id) => element(id).defaultStyle?.boxSizing).join(' ');
    assert.equal(sized(), 'content-box content-box content-box');
    const document: Dom = (globalThis as Dom).document;
    const added = document.createElement('option');
    added.textContent = 'Plum';
    element('chooser').appendChild(added);
    await settle();
    assert.equal(sized(), 'content-box content-box content-box');
    assert.equal(added.defaultStyle?.boxSizing, 'content-box');
    assert.equal(element('second').defaultStyle?.display, 'none', 'an option not chosen');
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

@Component({ selector: 'x-chip', template: '<ng-content />' })
class Chip {}

@Component({
  selector: 'x-laid',
  imports: [Chip],
  template: `
    <div testID="div"><span testID="span">Words</span></div>
    <x-chip testID="custom">Chip</x-chip>
    <div style="display: flex; height: 50px">
      <div testID="column-item">Item</div>
      <div testID="column-unlimited" style="min-height: 0">Item</div>
    </div>
    <div testID="row" style="display: flex; flex-direction: row">
      <div testID="item" style="width: 400px">Item</div>
      <x-chip testID="custom-item" style="width: 400px">Chip</x-chip>
      <view testID="view-item" style="width: 400px"></view>
    </div>
    <div testID="placed" style="position: relative"></div>
    <view testID="view"></view>
    <button testID="button">Save</button>
    <button testID="laid-out">Laid out</button>
  `,
})
class Laid {}

const props = (id: string) => screen.getByTestId(id).props as Record<string, unknown>;
const page = async (providers = [provideWebCompat()]) => {
  await render(Laid, {
    providers,
    globalStyles: compileCss(
      '[testID="laid-out"] { display: flex } .filtered { filter: brightness(1.2) } .unfiltered { filter: none }',
      'global',
    ),
  });
  await settle();
};

describe("an HTML element's start under web-compat, as a browser lays it out", () => {
  // A library's custom element, named to the build.
  const globals = globalThis as { ɵngNativeBrowserElements?: Set<string> };
  beforeEach(() => void (globals.ɵngNativeBrowserElements = new Set(['x-chip'])));
  afterEach(() => void delete globals.ɵngNativeBrowserElements);

  it('is static, an HTML element and a custom element alike, as a browser has it', async () => {
    await page();
    for (const id of ['div', 'span', 'custom', 'button']) {
      assert.equal(props(id)['position'], 'static', id);
    }
  });

  it('is the box an absolute element in it is placed against where it is transformed', async () => {
    // A transform makes a box the containing block of what is absolute in it, static or not: a
    // panel that scales in holds its own absolute arrow. Native knows only positions.
    await page();
    const document = (globalThis as { document?: any }).document;
    const panel = document.querySelector('[testID="div"]');
    panel.style.transform = 'translateX(0)';
    await settle();
    assert.equal(props('div')['position'], 'relative');
    // And not moved by an inset, which a browser takes for nothing on a static box.
    panel.style.top = '10px';
    await settle();
    assert.equal(props('div')['top'] ?? undefined, undefined, 'not moved by its top');
    panel.style.transform = 'none';
    await settle();
    assert.equal(props('div')['position'], 'static', 'and static again with none');
  });

  it('is the box an absolute element in it is placed against for what else CSS makes one', async () => {
    // A filter, a backdrop filter, a perspective, a containment of layout or paint, and a
    // will-change that names one of those, a transform or a position, as Chrome has it.
    await page();
    const document = (globalThis as { document?: any }).document;
    const panel = document.querySelector('[testID="div"]');
    // A filter comes from a sheet: element.style takes no filter function (see the follow-up).
    panel.classList.add('filtered');
    panel.style.top = '10px';
    await settle();
    assert.equal(props('div')['position'], 'relative', 'filter: brightness(1.2)');
    assert.equal(props('div')['top'] ?? undefined, undefined, 'filtered, not moved by its top');
    panel.classList.replace('filtered', 'unfiltered');
    await settle();
    assert.equal(props('div')['position'], 'static', 'static again with filter: none');
    panel.classList.remove('unfiltered');
    panel.style.top = '';
    const cases: [string, string, string][] = [
      ['backdropFilter', 'blur(2px)', 'none'],
      ['perspective', '100px', 'none'],
      ['contain', 'paint', 'none'],
      ['contain', 'layout style', 'size'],
      ['contain', 'strict', 'none'],
      ['contain', 'content', 'inline-size'],
      ['willChange', 'transform', 'auto'],
      ['willChange', 'opacity, filter', 'opacity'],
      ['willChange', 'perspective', 'scroll-position'],
      ['willChange', 'backdrop-filter', 'auto'],
      ['willChange', 'contain', 'auto'],
      ['willChange', 'translate', 'auto'],
      ['willChange', 'position', 'auto'],
    ];
    for (const [key, value, none] of cases) {
      const name = `${key}: ${value}`;
      panel.style[key] = value;
      panel.style.top = '10px';
      await settle();
      assert.equal(props('div')['position'], 'relative', name);
      assert.equal(props('div')['top'] ?? undefined, undefined, `${name}, not moved by its top`);
      panel.style[key] = none;
      await settle();
      assert.equal(props('div')['position'], 'static', `static again with ${key}: ${none}`);
      panel.style[key] = '';
      panel.style.top = '';
      await settle();
    }
  });

  it("leaves a position the element is given, and the engine's own views", async () => {
    await page();
    assert.equal(props('placed')['position'], 'relative');
    assert.equal(props('view')['position'] ?? 'relative', 'relative');
  });

  it('gives up room as a flex item wider than its row, as a browser has it', async () => {
    // Its content is narrower than its width, so its automatic minimum leaves it free to shrink.
    await page();
    for (const id of ['item', 'custom-item']) {
      assert.equal(props(id)['flexShrink'], 1, id);
    }
    assert.equal(props('view-item')['flexShrink'] ?? 0, 0, 'and a native view keeps its size');
  });

  it('gives up no room in the body, which is a block as a browser has it', async () => {
    // What a library puts in the body is in its flow, and a block's flow shrinks nothing: two
    // boxes there were squeezed to no height in a window that had room for them.
    await page();
    const document = (globalThis as { document?: any }).document;
    const box = document.createElement('div');
    box.style.height = '100px';
    document.body.appendChild(box);
    await settle();
    // As committed: held unseen for a frame, it is in no query yet.
    assert.equal(box.committed?.props['flexShrink'] ?? 0, 0);
  });

  it('stops at its content as it gives up room, which min-height: 0 lets it past', async () => {
    // Down a column too short for both, a browser shrinks neither below its words, whose minimum
    // is `min-height: auto`; one given a minimum of nothing gives up its room.
    await page();
    assert.equal(props('column-item')['flexShrink'], 0, 'kept at its content');
    assert.equal(props('column-unlimited')['flexShrink'], 1, 'free to shrink');
  });

  it("has a button's label in the middle of it, until a stylesheet lays the button out", async () => {
    // A browser's button is an inline block with `align-content: center`: taller than its
    // label, the label is in the middle. One a stylesheet makes a flex box is laid out as it says.
    await page();
    assert.equal(props('button')['justifyContent'], 'center');
    assert.equal(props('laid-out')['justifyContent'] ?? null, null);
  });

  it('is none of it in an app that did not ask for the package', async () => {
    const { error } = console;
    console.error = () => {};
    try {
      await page([]);
    } finally {
      console.error = error;
    }
    assert.equal(props('div')['position'] ?? undefined, undefined);
    assert.equal(props('item')['flexShrink'] ?? 0, 0);
  });
});
