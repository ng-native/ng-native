/**
 * A `<style>` a component makes for itself while the app runs: a carousel's item width, by its
 * own id, written once it knows how many it shows. A stylesheet is compiled when the app is
 * built, so a small one made on the device is read here, for what a component writes this way.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, Renderer2 } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';
import { sheetOf } from './runtime-style.ts';

/** A document as a library has it: elements it makes itself, and a head to put them in. */
interface Page {
  readonly head: Made;
  createElement(name: string): Made;
  createTextNode(text: string): Made;
}
interface Made {
  innerHTML: string;
  textContent: string;
  readonly parentNode: Made;
  appendChild(child: Made): void;
  removeChild(child: Made): void;
  setAttribute(name: string, value: string): void;
}

@Component({
  selector: 'x-strip',
  template: `
    <div id="strip" class="strip">
      <div testID="one" class="item"></div>
      <div testID="two" class="item wide"></div>
    </div>
  `,
})
class Strip {
  readonly document = inject(DOCUMENT) as unknown as Page;
}

afterEach(cleanup);

describe('a stylesheet read while the app runs', () => {
  it('is its rules, by id, class, attribute and what each is in, with what each declares', () => {
    const sheet = sheetOf(
      '#strip .item { flex: 1 0 33.3333% } .a > .b[data-x="1"], div.c { display: none; min-width: 12rem }',
    );
    assert.deepEqual(
      sheet.rules.map((rule) => [rule.compounds, rule.combinators, rule.declarations]),
      [
        [
          [{ classes: [], id: 'strip' }, { classes: ['item'] }],
          ['descendant'],
          { flexGrow: 1, flexShrink: 0, flexBasis: '33.3333%' },
        ],
        [
          [
            { classes: ['a'] },
            { classes: ['b'], attributes: [{ name: 'data-x', operator: 'equal', value: '1' }] },
          ],
          ['child'],
          { display: 'none', minWidth: 192 },
        ],
        [[{ classes: ['c'], type: 'div' }], [], { display: 'none', minWidth: 192 }],
      ],
    );
    // An id over a class, and a class over a name, as a browser weighs them.
    assert.deepEqual(
      sheet.rules.map((rule) => rule.specificity),
      [1_001_000, 3000, 1001],
    );
  });

  it('keeps what a rule marks important apart, and the width a rule is for', () => {
    const [rule] = sheetOf(
      '@media screen and (max-width: 920px) { .toast[pn_id_3] { width: 50% !important; right: auto } }',
    ).rules;
    assert.deepEqual(rule!.important, { width: '50%' });
    assert.deepEqual(rule!.declarations, { right: 'auto' });
    assert.deepEqual(rule!.condition, { feature: 'width', op: 'lte', value: 920 });
  });

  it('reads what a rule is not for, and a share of the window', () => {
    // A dialog's breakpoints: no wider than most of the window on a phone, unless maximized.
    const [rule, tall] = sheetOf(
      '@media screen and (max-width: 575px) { .dialog[pn_id_7]:not(.maximized) { width: 90vw !important } } ' +
        '.sheet:not([open]):not(#fixed) { max-height: 50vh }',
      { width: 400, height: 800 },
    ).rules;
    assert.deepEqual(rule!.important, { width: 360 });
    assert.deepEqual(rule!.compounds, [
      { classes: ['dialog'], attributes: [{ name: 'pn_id_7' }], not: [{ classes: ['maximized'] }] },
    ]);
    assert.deepEqual(rule!.condition, { feature: 'width', op: 'lte', value: 575 });
    assert.deepEqual(tall!.declarations, { maxHeight: 400 });
    assert.deepEqual(tall!.compounds[0]!.not, [
      { classes: [], attributes: [{ name: 'open' }] },
      { classes: [], id: 'fixed' },
    ]);
    // What it is not for weighs as what it names does, as in a browser.
    assert.equal(rule!.specificity, 3000);
  });

  it('leaves a token to be settled where the rule applies, and reads the first and last of a list', () => {
    const sheet = sheetOf(
      '.list .item { padding: var(--pad); margin-right: var(--gap); color: var(--ink) } ' +
        '.list .item:last-child { margin-right: 0 } .list > :first-child { margin-top: 0 }',
    );
    assert.deepEqual(sheet.rules[0]!.deferred, [
      {
        props: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
        kind: 'length',
        reference: '--pad',
      },
      { props: ['marginRight'], kind: 'length', reference: '--gap' },
      { props: ['color'], kind: 'color', reference: '--ink' },
    ]);
    assert.deepEqual(sheet.rules[1]!.compounds[1], {
      classes: ['item'],
      nth: [{ a: 0, b: 1, fromEnd: true }],
    });
    assert.deepEqual(sheet.rules[2]!.compounds[1], { classes: [], nth: [{ a: 0, b: 1 }] });
    // A place in a list is watched for only where a sheet asks about one.
    assert.equal(sheet.structural, true);
    assert.equal(sheetOf('.a { width: 1px }').structural, undefined);
  });

  it('reads each attribute test, a sibling, and whether a box is seen', () => {
    const [operators, siblings, hidden] = sheetOf(
      '[a~="x"][b|="y"][c^="z"][d$="w" i][e*=v s] { width: 1px } ' +
        'p + div ~ :nth-child(2n+1):not(:only-of-type) { width: 2px } ' +
        '[lang|="zh"], *|div { visibility: hidden }',
    ).rules;
    assert.deepEqual(operators!.compounds[0]!.attributes, [
      { name: 'a', operator: 'includes', value: 'x' },
      { name: 'b', operator: 'dash-match', value: 'y' },
      { name: 'c', operator: 'prefix', value: 'z' },
      { name: 'd', operator: 'suffix', value: 'w', insensitive: true },
      { name: 'e', operator: 'substring', value: 'v' },
    ]);
    assert.deepEqual(siblings!.combinators, ['next-sibling', 'later-sibling']);
    assert.deepEqual(siblings!.compounds[2], {
      classes: [],
      nth: [{ a: 2, b: 1 }],
      not: [
        {
          classes: [],
          nth: [
            { a: 0, b: 1, ofType: true },
            { a: 0, b: 1, fromEnd: true, ofType: true },
          ],
        },
      ],
    });
    assert.deepEqual(hidden!.declarations, { visibility: 'hidden' });
    assert.deepEqual(hidden!.compounds[0]!.attributes, [
      { name: 'lang', operator: 'dash-match', value: 'zh', insensitive: true },
    ]);
    assert.deepEqual(sheetOf('[id^=a] { width: 1px }').rules[0]!.compounds[0]!.attributes, [
      { name: 'nativeID', operator: 'prefix', value: 'a' },
    ]);
    const [box] = sheetOf('.x::before { content: "a"; width: 1px }').rules;
    assert.deepEqual(box!.compounds, [{ classes: ['x'] }, { classes: [], type: '::before' }]);
    assert.deepEqual(box!.combinators, ['child']);
    assert.deepEqual(box!.declarations, { content: 'a', width: 1 });
    assert.equal(sheetOf('.x::selection { width: 1px }').rules.length, 0);
    assert.deepEqual(sheetOf('.x { background: red }').rules[0]!.declarations, {
      backgroundColor: 'red',
    });
    const tokens: Record<string, string> = {};
    sheetOf(':root { --foo: green !important; --foo: red; --bar: a; --bar: b }', undefined, tokens);
    assert.deepEqual(tokens, { '--foo': 'green', '--bar': 'b' });
    assert.equal(sheetOf('a + b { width: 1px }').structural, true);
  });

  it('passes over a rule or a declaration it has no reading of, and says so once', () => {
    const said: unknown[] = [];
    const warn = console.warn;
    console.warn = (...all: unknown[]) => said.push(all.join(' '));
    try {
      const sheet = sheetOf(
        '.a:hover { width: 1px } .b { width: 2px; filter: blur(2px); color: inherit; background-color: rainbow } .c:has(:hover) { width: 3px }',
      );
      assert.deepEqual(
        sheet.rules.map((rule) => rule.declarations),
        [{ width: 2 }],
      );
      assert.equal(said.length, 5);
    } finally {
      console.warn = warn;
    }
  });
});

describe('a <style> a component adds to the page', () => {
  const strip = async () => {
    const app = await render(Strip, { providers: [provideWebCompat()] });
    await settle();
    const document = app.fixture.componentInstance.document;
    const style = document.createElement('style');
    document.head.appendChild(style);
    return { document, style };
  };
  const wide = (id: string) => screen.getByTestId(id).props['width'];

  it('styles what its rules are for, and again when it is written again', async () => {
    const { style } = await strip();
    style.innerHTML = '#strip .item { width: 50% }';
    await settle();
    assert.deepEqual([wide('one'), wide('two')], ['50%', '50%']);
    style.innerHTML = '#strip .wide { width: 25% }';
    await settle();
    assert.deepEqual([wide('one') ?? null, wide('two')], [null, '25%']);
  });

  it('is read from text put in it, before or after it is in the page', async () => {
    const { document } = await strip();
    const style = document.createElement('style');
    style.appendChild(document.createTextNode('#strip .item { width: 20% }'));
    document.head.appendChild(style);
    await settle();
    assert.equal(wide('one'), '20%');
    style.textContent = '#strip .item { width: 10% }';
    await settle();
    assert.equal(wide('one'), '10%');
  });

  it('styles nothing once it is taken out of the page', async () => {
    const { document, style } = await strip();
    style.innerHTML = '#strip .item { width: 50% }';
    await settle();
    const sheets = (document as unknown as { styleSheets: { item(at: number): unknown } })
      .styleSheets;
    assert.equal(sheets.item(0), (style as unknown as { sheet: unknown }).sheet);
    assert.equal(sheets.item(1), null);
    style.parentNode.removeChild(style);
    await settle();
    assert.equal(wide('one') ?? null, null);
  });

  it('styles nothing while what holds it is out of the page, and again once that is put back', async () => {
    const { document } = await strip();
    const box = document.createElement('div') as Made & { remove(): void };
    const style = document.createElement('style');
    style.textContent = '#strip .item { width: 30% }';
    box.appendChild(style);
    await settle();
    assert.equal(wide('one') ?? null, null, 'in no page yet');
    const body = (document as unknown as { body: Made }).body;
    body.appendChild(box);
    await settle();
    assert.equal(wide('one'), '30%');
    box.remove();
    await settle();
    assert.equal(wide('one') ?? null, null);
    body.appendChild(box);
    await settle();
    assert.equal(wide('one'), '30%');
  });

  it('is read again as a copy of it, which a script puts in the page', async () => {
    const { document, style } = await strip();
    style.textContent = '#strip .item { width: 35% }';
    await settle();
    const copy = (style as unknown as { cloneNode(deep: boolean): Made }).cloneNode(true);
    style.parentNode.removeChild(style);
    await settle();
    assert.equal(wide('one') ?? null, null);
    (document as unknown as { body: Made }).body.appendChild(copy);
    await settle();
    assert.equal(wide('one'), '35%');
    assert.equal(screen.queryByText(/width: 35%/), null, 'and draws none of it');
  });

  it('follows the text in it as it is changed and taken out', async () => {
    const { document, style } = await strip();
    const text = document.createTextNode('#strip .item { width: 20% }') as Made & { data: string };
    style.appendChild(text);
    await settle();
    assert.equal(wide('one'), '20%');
    text.data = '#strip .item { width: 15% }';
    await settle();
    assert.equal(wide('one'), '15%');
    style.removeChild(text);
    await settle();
    assert.equal(wide('one') ?? null, null);
  });

  it('reads a mix of colours, and passes over a mix of a token and says so', async () => {
    const { style } = await strip();
    const said: unknown[] = [];
    const warn = console.warn;
    console.warn = (...all: unknown[]) => said.push(all.join(' '));
    try {
      style.textContent =
        '#strip .item { background-color: color-mix(in srgb, red, blue 50%) } ' +
        '#strip .wide { color: color-mix(in srgb, var(--brand), white 20%) }';
      await settle();
    } finally {
      console.warn = warn;
    }
    const props = (id: string) => screen.getByTestId(id).props;
    assert.notEqual(props('one')['backgroundColor'] ?? null, null);
    assert.equal(props('two')['color'] ?? null, null);
    assert.equal(said.length, 1);
    assert.match(String(said[0]), /color-mix\(in srgb, var\(--brand\), white 20%\)/);
  });

  it('is left to the build where it is a library’s whole theme', async () => {
    // Thousands of rules, compiled with the app: reading them again here is a second of work
    // for a stylesheet the app already has.
    const { style } = await strip();
    style.setAttribute('data-optimus-style-id', 'button-style');
    style.textContent = '#strip .item { width: 50% }';
    await settle();
    assert.equal(wide('one') ?? null, null);
  });
});

describe('what a library does with the page it is in', () => {
  const page = async () => {
    const app = await render(Strip, { providers: [provideWebCompat()] });
    await settle();
    const document = app.fixture.componentInstance.document as unknown as Page & {
      getElementsByTagName(name: string): Iterable<Made>;
    };
    const strip = app.componentRef.location.nativeElement.children[0] as Made & {
      prepend(...children: Made[]): void;
      readonly children: Made[];
      getElementsByTagName(name: string): { readonly length: number };
    };
    return { app, document, strip };
  };

  it('takes a stylesheet out by the renderer, whatever it is told it is in', async () => {
    // `renderer.removeChild(document, style)`: a browser's renderer takes a node out of the
    // parent it has, and is handed one only for the sake of an older one that did not.
    const { app, document } = await page();
    const renderer = app.componentRef.injector.get(Renderer2);
    const style = document.createElement('style');
    renderer.appendChild(document.head, style);
    style.innerHTML = '#strip .item { width: 50% }';
    await settle();
    assert.equal(screen.getByTestId('one').props['width'], '50%');
    renderer.removeChild(document, style);
    await settle();
    assert.equal(screen.getByTestId('one').props['width'] ?? null, null);
  });
});

describe('a <style> a library makes itself and puts in the page', () => {
  it('draws none of its rules as text, wherever in the page it is put', async () => {
    // `document.createElement('style')`, appended to the body: a gallery's own breakpoints.
    const app = await render(Strip, { providers: [provideWebCompat()] });
    await settle();
    const document = app.fixture.componentInstance.document as unknown as Page & { body: Made };
    const style = document.createElement('style');
    style.innerHTML = '#strip .item { width: 30px }';
    document.body.appendChild(style);
    await settle();
    assert.equal(screen.queryByText(/width: 30px/), null);
    assert.equal(screen.getByTestId('one').props['width'], 30);
  });
});

describe('a <style> a library puts among what it draws', () => {
  it('is an element the app knows, drawn as nothing, and read as any other is', async () => {
    const said: unknown[] = [];
    const error = console.error;
    console.error = (...all: unknown[]) => said.push(all.join(' '));
    try {
      const app = await render(Strip, { providers: [provideWebCompat()] });
      await settle();
      const renderer = app.componentRef.injector.get(Renderer2);
      const style = renderer.createElement('style');
      renderer.appendChild(style, renderer.createText('#strip .item { width: 10px }'));
      renderer.appendChild(app.componentRef.location.nativeElement.children[0], style);
      await settle();
      assert.deepEqual(said, []);
      assert.equal(screen.queryByText(/width: 10px/), null);
      assert.equal(screen.getByTestId('one').props['width'], 10);
    } finally {
      console.error = error;
    }
  });
});

describe('the tree a <style> is read in', () => {
  it('costs an engine nothing until a <style> is made, and is let go of with the app', async () => {
    const app = await render(Strip, { providers: [provideWebCompat()] });
    await settle();
    const engine = (app.componentRef.location.nativeElement as { engine: Engine }).engine;
    const methods = ['appendChild', 'insertBefore', 'removeChild', 'setText'];
    const wrapped = () => methods.filter((method) => Object.hasOwn(engine, method));
    assert.deepEqual(wrapped(), [], 'the engine is its own');
    const document = app.fixture.componentInstance.document;
    const style = document.createElement('style');
    assert.deepEqual(wrapped(), methods);
    style.textContent = '#strip .item { width: 50% }';
    document.head.appendChild(style);
    await settle();
    assert.equal(screen.getByTestId('one').props['width'], '50%');
    const removed: unknown[] = [];
    const remove = engine.removeGlobalSheet;
    engine.removeGlobalSheet = function (sheet) {
      removed.push(sheet);
      return remove.call(this, sheet);
    };
    app.unmount();
    assert.deepEqual(wrapped(), [], 'its own again');
    assert.equal(removed.length, 1, 'and the sheet it was given is taken away');
    // One its document makes once the app is gone wraps nothing.
    document.createElement('style');
    assert.deepEqual(wrapped(), []);
  });
});

describe('custom properties a rule sets', () => {
  it('are set where it matches, by how specific it is and where, and !important over both', () => {
    const engine = new Engine(createFakeFabric(), 1, {
      globalStyles: sheetOf(
        '.box .x { --Tint: FAIL } #x.x { --Tint: PASS; --gap: 4px } ' +
          '.x { --gap: 9px !important } .x { --gap: 2px } .other { --tint: no }',
      ),
    });
    const box = engine.createElement('view');
    engine.setClasses(box, 'box');
    engine.appendChild(engine.root, box);
    const x = engine.createElement('view');
    engine.setClasses(x, 'x');
    engine.setProp(x, 'nativeID', 'x');
    engine.appendChild(box, x);
    engine.commit();
    const tokens = x.styleCache!.tokens!;
    assert.equal(tokens['--Tint']?.keyword, 'PASS');
    assert.equal(tokens['--tint'], undefined);
    assert.equal(tokens['--gap']?.length, 9);
    assert.equal(box.styleCache!.tokens!['--Tint'], undefined);
  });
});

describe('a transition in a <style> made while the app runs', () => {
  it('is the spec the engine runs, and its longhands the timing laid over it', () => {
    const [whole, parts] = sheetOf(
      '.a { transition: left 1s ease-out, color .5s } ' +
        '.b { transition-property: opacity; transition-duration: 150ms; transition-delay: 20ms }',
    ).rules;
    assert.deepEqual(whole!.declarations['$transition'], {
      left: { duration: 1000, delay: 0, easing: [0, 0, 0.58, 1] },
      color: { duration: 500, delay: 0, easing: [0.25, 0.1, 0.25, 1] },
    });
    assert.deepEqual(parts!.declarations['$transition'], {
      opacity: { duration: 0, delay: 0, easing: [0.25, 0.1, 0.25, 1] },
    });
    assert.equal(parts!.declarations['$transitionDuration'], 150);
    assert.equal(parts!.declarations['$transitionDelay'], 20);
  });
});
