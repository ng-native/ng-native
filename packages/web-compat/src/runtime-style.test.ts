/**
 * A `<style>` a component makes for itself while the app runs: a carousel's item width, by its
 * own id, written once it knows how many it shows. A stylesheet is compiled when the app is
 * built, so a small one made on the device is read here, for what a component writes this way.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, Renderer2 } from '@angular/core';
import { Engine, type StyleRule } from '@ng-native/fabric';
import { cleanup, compileCss, createFakeFabric, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';
import { readsDeclaration, sheetOf } from './runtime-style.ts';

/** A document as a library has it: elements it makes itself, and a head to put them in. */
interface Page {
  readonly head: Made;
  createElement(name: string): Made;
  createTextNode(text: string): Made;
}
interface Lookup {
  getElementById(id: string): Made;
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
      <div id="one" testID="one" class="item"></div>
      <div testID="two" class="item wide"></div>
    </div>
  `,
})
class Strip {
  readonly document = inject(DOCUMENT) as unknown as Page;
}

afterEach(cleanup);

/** A prop of the first item, styled by `css` and, where one is given, an inline style. */
async function styledBy(css: string, prop: string, inline = ''): Promise<unknown> {
  const app = await render(Strip, { providers: [provideWebCompat()] });
  await settle();
  const { document } = app.fixture.componentInstance;
  const style = document.createElement('style');
  document.head.appendChild(style);
  style.textContent = `#strip { --c: blue; color: green } ${css}`;
  if (inline) (document as unknown as Lookup).getElementById('one').setAttribute('style', inline);
  await settle();
  return screen.getByTestId('one').props[prop];
}

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

  it('reads a whole query, and passes over one it cannot and says so', () => {
    const condition = (media: string) => {
      const closing = media.includes('{') ? ' }' : '';
      return sheetOf(`@media ${media} { .a { width: 4px } }${closing}`).rules.map(
        (rule) => rule.condition,
      );
    };
    const width = (op: string, value: number) => ({ feature: 'width', op, value });
    assert.deepEqual(condition('(min-width: 600px) and (max-width: 959px)'), [
      { all: [width('gte', 600), width('lte', 959)] },
    ]);
    // Print is a medium the app is never in.
    assert.deepEqual(condition('print and (max-width: 600px)'), [
      { all: [{ any: [] }, width('lte', 600)] },
    ]);
    assert.deepEqual(condition('(max-width: 600px), print'), [width('lte', 600)]);
    const said: unknown[] = [];
    const warn = console.warn;
    console.warn = (...all: unknown[]) => said.push(all.join(' '));
    try {
      assert.deepEqual(condition('not all and (max-width: 600px)'), []);
      // One query inside another is both, which is not read.
      assert.deepEqual(condition('(min-width: 600px) { @media (max-width: 959px)'), []);
    } finally {
      console.warn = warn;
    }
    assert.equal(said.length, 2);
  });

  it('reads the bound of a width query in any case', () => {
    for (const [media, op] of [
      ['(MAX-width: 600px)', 'lte'],
      ['(MIN-WIDTH: 600px)', 'gte'],
    ] as const) {
      const [rule] = sheetOf(`@media ${media} { .a { width: 4px } }`).rules;
      assert.deepEqual(rule!.condition, { feature: 'width', op, value: 600 }, media);
    }
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

  it('reads a query by the window and what the user asked for, and passes over one it cannot read', () => {
    const conditions = (css: string) => sheetOf(css).rules.map((rule) => rule.condition);
    const warn = console.warn;
    const said: string[] = [];
    console.warn = (message: string) => void said.push(message);
    try {
      assert.deepEqual(
        conditions(
          '@media (min-width: 600px) and (prefers-color-scheme: dark) { .a { width: 1px } } ' +
            '@media (orientation: landscape), print { .b { width: 1px } } ' +
            '@media only screen and (400px <= height < 50em) { .c { width: 1px } } ' +
            '@media (prefers-reduced-motion) { .d { width: 1px } } ' +
            '@media screen { .e { width: 1px } }',
        ),
        [
          {
            all: [
              { feature: 'width', op: 'gte', value: 600 },
              { feature: 'prefers-color-scheme', value: 'dark' },
            ],
          },
          { feature: 'orientation', value: 'landscape' },
          {
            all: [
              { feature: 'height', op: 'gte', value: 400 },
              { feature: 'height', op: 'lt', value: 800 },
            ],
          },
          { feature: 'prefers-reduced-motion', value: 'reduce' },
          undefined,
        ],
      );
      // What it cannot read is no rule, and is said: a negation, a feature the engine has no
      // answer for, and a query of something other than the window.
      const passed = sheetOf(
        '@media not print { .a { width: 1px } } @media (hover: hover) { .b { width: 1px } } ' +
          '@container (max-width: 400px) { .c { width: 1px } }',
      );
      assert.equal(passed.rules.length, 0);
      assert.equal(said.length, 3);
    } finally {
      console.warn = warn;
    }
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

  it('styles by the colour scheme and the way up the window, as they change', async () => {
    const app = await render(Strip, {
      providers: [provideWebCompat()],
      conditions: { width: 400, height: 800, colorScheme: 'light' },
    });
    const engine = app.componentRef.injector.get(Engine);
    const document = app.fixture.componentInstance.document;
    const style = document.createElement('style');
    document.head.appendChild(style);
    style.innerHTML =
      '@media (prefers-color-scheme: dark) and (min-width: 300px) { #strip .item { width: 30% } } ' +
      '@media (orientation: landscape) { #strip .wide { width: 70% } }';
    await settle();
    assert.deepEqual([wide('one') ?? null, wide('two') ?? null], [null, null]);
    engine.updateConditions({ width: 400, height: 800, colorScheme: 'dark' });
    await settle();
    assert.deepEqual([wide('one'), wide('two')], ['30%', '30%']);
    engine.updateConditions({ width: 800, height: 400, colorScheme: 'dark' });
    await settle();
    assert.deepEqual([wide('one'), wide('two')], ['30%', '70%']);
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

  it('reads a mix of colours, and a mix of a token worked out from the token', async () => {
    const { style } = await strip();
    const said: unknown[] = [];
    const warn = console.warn;
    console.warn = (...all: unknown[]) => said.push(all.join(' '));
    try {
      style.textContent =
        '#strip { --brand: rgb(0, 0, 255) } ' +
        '#strip .item { background-color: color-mix(in srgb, red, blue 50%) } ' +
        '#strip .wide { color: color-mix(in srgb, var(--brand), white 20%) }';
      await settle();
    } finally {
      console.warn = warn;
    }
    const props = (id: string) => screen.getByTestId(id).props;
    assert.notEqual(props('one')['backgroundColor'] ?? null, null);
    assert.notEqual(props('two')['color'] ?? null, null);
    assert.deepEqual(said, []);
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

/** What a rule sets, each prop to its value, a colour left to the node as `currentcolor`. */
function propsOf(rule: StyleRule | undefined): Record<string, unknown> {
  const props: Record<string, unknown> = { ...rule?.declarations };
  for (const each of rule?.deferred ?? []) {
    for (const prop of each.props) props[prop] = each.within ? 'currentcolor' : each;
  }
  return Object.fromEntries(Object.entries(props).sort(([a], [b]) => a.localeCompare(b)));
}

describe('a border in a <style> made while the app runs', () => {
  it('is each side’s width, style and colour', () => {
    const [rule] = sheetOf('.box { border: 1px solid black }').rules;
    assert.deepEqual(propsOf(rule), {
      ...Object.fromEntries(
        ['Top', 'Right', 'Bottom', 'Left'].flatMap((side) => [
          [`border${side}Color`, 'black'],
          [`border${side}Style`, 'solid'],
          [`border${side}Width`, 1],
        ]),
      ),
      borderStyle: 'solid',
    });
  });

  it('is what the build compiles the same declaration to, and nothing where it drops one', () => {
    const said: unknown[] = [];
    const warn = console.warn;
    console.warn = (...all: unknown[]) => said.push(all.join(' '));
    try {
      for (const declaration of [
        'border: 1px solid rgb(0, 0, 0)',
        'border: 2px dashed rgb(255, 0, 0)',
        'border: 1rem dotted rgb(255, 0, 0)',
        'border: solid',
        'border: none',
        'border-top: 1px hidden',
        'border: 0',
        'border-top: 3px solid',
        'border-bottom: 1px solid rgb(204, 204, 204)',
        'border-left: none',
        'border-width: 4px',
        'border-width: thick 0',
        'border-width: 1px 2px 3px',
        'border-color: rgb(255, 0, 0)',
        'border-color: rgb(255, 0, 0) rgb(0, 0, 255)',
        'border-color: currentcolor',
        'border-style: dashed',
        'border-style: none',
        'border-top-width: thin',
        'border-right-style: dashed',
        'border-left-color: rgb(255, 0, 0)',
        'outline: 2px solid rgb(255, 0, 0)',
        'outline: 2px dotted',
        'outline: none',
        'outline-width: 2px',
        'outline-style: dashed',
        'outline-color: rgb(255, 0, 0)',
        'outline-offset: 2px',
        'outline-offset: -1px',
        'border-radius: 4px',
        'border-radius: 4px 8px',
        'border-radius: 1px 2px 3px 4px',
        'border-radius: 50%',
        'border-top-left-radius: 4px',
      ]) {
        const css = `.box { ${declaration} }`;
        assert.deepEqual(
          propsOf(sheetOf(css).rules[0]),
          propsOf(compileCss(css).rules[0]),
          declaration,
        );
      }
      assert.deepEqual(said, []);
      // What the build drops, a line native cannot draw and a corner of two radii, is passed over.
      for (const declaration of [
        'border: 1px double red',
        'border-style: solid dashed',
        'border-radius: 4px / 8px',
        'border-top-left-radius: 4px 8px',
        'border: 1px solid nonsense',
      ]) {
        assert.deepEqual(sheetOf(`.box { ${declaration} }`).rules, [], declaration);
      }
    } finally {
      console.warn = warn;
    }
    assert.equal(said.length, 5);
  });

  it('leaves a token to each side, and transitions each side, as the build does', () => {
    for (const declaration of [
      'border-width: var(--w)',
      'border-top-width: var(--w)',
      'border-color: var(--c)',
      'border-radius: var(--r)',
      'outline-color: var(--c)',
      'transition: border-color 1s',
      'transition: border 1s',
    ]) {
      const css = `.box { ${declaration} }`;
      const [built] = compileCss(css).rules;
      const [read] = sheetOf(css).rules;
      assert.deepEqual(read?.deferred, built!.deferred, declaration);
      assert.deepEqual(
        Object.keys(read?.declarations['$transition'] ?? {}).sort(),
        Object.keys(built!.declarations['$transition'] ?? {}).sort(),
        declaration,
      );
    }
  });

  it('leaves a line with a token in it to the node, as the build does', () => {
    for (const declaration of [
      'border: 1px solid var(--c)',
      'border: var(--w) solid rgb(255, 0, 0)',
      'border: var(--w) var(--c)',
      'border: 1px solid var(--c,)',
      'border: currentcolor 1px var(--s)',
      'border: none var(--c)',
      'border-top: 1px var(--c)',
      'border-left: var(--w) solid',
      'outline: var(--w) solid',
      'outline: 2px dotted var(--c)',
      'border: 1em solid rgb(255, 0, 0)',
      'border-top-width: 0.5em',
      'border-radius: 1em',
      'outline: 1em solid rgb(255, 0, 0)',
      'border: 1px solid var(--c, rgb(1, 2, 3))',
      'border-top: 2px solid var(--c, rgba(0, 0, 255, 0.5))',
    ]) {
      const css = `.box { ${declaration} }`;
      const [built] = compileCss(css).rules;
      const [read] = sheetOf(css).rules;
      assert.deepEqual(
        [read?.declarations, read?.deferred],
        [built!.declarations, built!.deferred],
        declaration,
      );
      assert.equal(readsDeclaration(declaration.split(':')[0]!, declaration.split(': ')[1]!), true);
    }
  });

  it('draws a line with a token in it by what the token is', async () => {
    const app = await render(Strip, { providers: [provideWebCompat()] });
    await settle();
    const { document } = app.fixture.componentInstance;
    const style = document.createElement('style');
    document.head.appendChild(style);
    style.textContent =
      '#strip { --c: blue; --w: 5px; font-size: 10px } ' +
      '#strip .item { border: 1px solid var(--c) } #strip .wide { border: var(--w) solid red; ' +
      'outline: 1em solid var(--missing, green) }';
    await settle();
    const props = (id: string) => screen.getByTestId(id).props;
    assert.deepEqual(
      [
        props('one')['borderTopColor'],
        props('one')['borderLeftWidth'],
        props('one')['borderStyle'],
      ],
      ['blue', 1, 'solid'],
    );
    assert.deepEqual(
      [
        props('two')['borderTopColor'],
        props('two')['borderLeftWidth'],
        props('two')['outlineColor'],
      ],
      ['red', 5, 'green'],
    );
    assert.equal(props('two')['outlineWidth'], 10);
  });

  it('draws a line in the fallback of its token, where the fallback is a colour function', async () => {
    const css = '.item { border: 1px solid var(--missing, rgb(1, 2, 3)) }';
    assert.equal(await styledBy(css, 'borderTopColor'), 'rgb(1, 2, 3)');
  });

  it('offsets an outline by a length in em, in the font size of the element', async () => {
    const css = '.item { font-size: 10px; outline: 1px solid; outline-offset: 1.5em }';
    assert.equal(await styledBy(css, 'outlineOffset'), 15);
    assert.equal(sheetOf('.box { outline-offset: 10% }').rules.length, 0, 'it takes no share');
    assert.equal(sheetOf('.box { outline-offset: 1..2em }').rules.length, 0, 'nor a broken number');
  });

  it('draws a dotted or dashed side solid, and says so, as the build does', () => {
    const said: string[] = [];
    const warn = console.warn;
    console.warn = (...all: unknown[]) => said.push(all.join(' '));
    const told: string[] = [];
    const sides = [
      'border-left: 1px dotted rgb(255, 0, 0)',
      'border-top: 2px dashed var(--c)',
      'border-top: dashed',
    ];
    const whole = [
      'border: 1px dashed rgb(255, 0, 0)',
      'border-style: dotted',
      'border-top-style: dashed',
    ];
    try {
      for (const declaration of [...sides, ...whole, 'outline: 1px dashed rgb(255, 0, 0)']) {
        const css = `.box { ${declaration} }`;
        const [built] = compileCss(css, 'test', {
          onUnsupported: (m: string) => void told.push(m),
        }).rules;
        const [read] = sheetOf(css).rules;
        assert.deepEqual(
          [read?.declarations, read?.deferred],
          [built!.declarations, built!.deferred],
          declaration,
        );
      }
    } finally {
      console.warn = warn;
    }
    assert.equal(told.length, sides.length, 'the build says it of each side');
    assert.deepEqual(
      said,
      sides.map(
        (declaration) =>
          `[angular-native] a <style> made while the app runs: '${declaration}': native has one ` +
          `border style for the whole box, so a '${/dotted|dashed/.exec(declaration)![0]}' side ` +
          `is drawn solid, native's default.`,
      ),
    );
  });

  it('passes over an outline of auto, and says so, as the build drops it', () => {
    const said: unknown[] = [];
    const warn = console.warn;
    console.warn = (...all: unknown[]) => said.push(all.join(' '));
    const declarations = [
      ...['outline: auto', 'outline: thin auto', 'outline: 1px solid auto', 'outline: red auto'],
      ...['outline-style: auto', 'outline-color: auto'],
    ];
    try {
      for (const declaration of declarations) {
        const css = `.box { ${declaration} }`;
        assert.deepEqual(compileCss(css, 'test', { onUnsupported: () => {} }).rules, []);
        assert.deepEqual(sheetOf(css).rules, [], declaration);
      }
    } finally {
      console.warn = warn;
    }
    assert.equal(said.length, declarations.length);
  });

  it('mixes a colour for each side', () => {
    const mixed = (name: string) =>
      sheetOf(`.box { ${name}: color-mix(in srgb, var(--c), white 20%) }`).rules[0]?.deferred?.[0]
        ?.props;
    assert.deepEqual(mixed('border-color'), [
      ...['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'],
    ]);
    assert.deepEqual(mixed('border-top-color'), ['borderTopColor']);
    assert.deepEqual(mixed('color'), ['color']);
  });

  it('is drawn on the element a rule is for', async () => {
    const app = await render(Strip, { providers: [provideWebCompat()] });
    await settle();
    const { document } = app.fixture.componentInstance;
    const style = document.createElement('style');
    document.head.appendChild(style);
    style.textContent =
      '#strip .item { border: 2px dashed red } #strip .wide { border-top: 3px solid }';
    await settle();
    const props = (id: string) => screen.getByTestId(id).props;
    assert.deepEqual(
      [
        props('one')['borderLeftWidth'],
        props('one')['borderStyle'],
        props('one')['borderLeftColor'],
      ],
      [2, 'dashed', 'red'],
    );
    assert.equal(props('two')['borderTopWidth'], 3);
    assert.equal(props('two')['borderBottomWidth'], 2);
    // A side written with no colour is the text's.
    assert.equal(props('two')['borderTopColor'], 'black');
  });
});

describe('the order of declarations in one block of a <style> made while the app runs', () => {
  it('lets the later of a token and a plain declaration win, as the build does', async () => {
    const app = await render(Strip, { providers: [provideWebCompat()] });
    await settle();
    const { document } = app.fixture.componentInstance;
    const style = document.createElement('style');
    document.head.appendChild(style);
    const cases: [block: string, prop: string, expected: unknown][] = [
      ['border: 1px solid; border-color: var(--c)', 'borderTopColor', 'blue'],
      ['border-color: var(--c); border-top-color: red', 'borderTopColor', 'red'],
      ['border-color: var(--c); border-top-color: red', 'borderLeftColor', 'blue'],
      ['border-top-color: var(--c); border-top: 1px solid red', 'borderTopColor', 'red'],
      ['border-width: var(--w); border: 1px solid red', 'borderTopWidth', 1],
      ['border-radius: var(--r); border-top-left-radius: 2px', 'borderTopLeftRadius', 2],
      ['border-radius: var(--r); border-top-left-radius: 2px', 'borderTopRightRadius', 9],
      ['padding: var(--p); padding-top: 2px', 'paddingTop', 2],
      ['padding: var(--p); padding-top: 2px', 'paddingLeft', 5],
      ['padding-top: 2px; padding: var(--p)', 'paddingTop', 5],
      ['border: 1px solid; border-color: red', 'borderTopColor', 'red'],
      ['border-top: 1px solid red; border-top-color: var(--c)', 'borderTopColor', 'blue'],
    ];
    for (const [block, prop, expected] of cases) {
      style.textContent = `#strip { --c: blue; --w: 5px; --p: 5px; --r: 9px } .item { ${block} }`;
      await settle();
      assert.equal(screen.getByTestId('one').props[prop], expected, `${block}: ${prop}`);
    }
  });

  it('drops a value set earlier in the block where a later declaration leaves the prop to the node, as the build does', () => {
    for (const block of [
      'border-top-color: rgb(255, 0, 0); border-top-color: currentcolor',
      'border-width: 2px; border-width: 1em',
    ]) {
      const css = `.box { ${block} }`;
      const [built] = compileCss(css).rules;
      const [read] = sheetOf(css).rules;
      assert.deepEqual(
        [read?.declarations, read?.deferred],
        [built!.declarations, built!.deferred],
        block,
      );
    }
  });

  it('keeps an important declaration over a later plain one, and a later rule over an earlier one', async () => {
    const app = await render(Strip, { providers: [provideWebCompat()] });
    await settle();
    const { document } = app.fixture.componentInstance;
    const style = document.createElement('style');
    document.head.appendChild(style);
    const cases: [css: string, expected: unknown][] = [
      ['.item { border: 2px solid; border-color: var(--c) !important; border-color: red }', 'blue'],
      ['.item { border: 2px solid red !important; border-top-color: var(--c) }', 'red'],
      ['.item { border: 2px solid red } .item { border-top-color: var(--c) }', 'blue'],
      ['.item { border-top-color: var(--c) } .item { border: 2px solid red }', 'red'],
    ];
    for (const [css, expected] of cases) {
      style.textContent = `#strip { --c: blue } ${css}`;
      await settle();
      assert.equal(screen.getByTestId('one').props['borderTopColor'], expected, css);
    }
  });

  const importantLine = '.item { border: 1px solid var(--c) !important }';

  it("keeps an important line's template over a more specific rule", async () => {
    const css = `${importantLine} #strip .item { border-top-color: red }`;
    assert.equal(await styledBy(css, 'borderTopColor'), 'blue');
  });

  it("keeps an important line's template over an inline style", async () => {
    assert.equal(await styledBy(importantLine, 'borderTopColor', 'border-top-color: red'), 'blue');
  });

  it('keeps an important length in em over a later plain one', async () => {
    const css =
      '.item { font-size: 10px; border: 1px solid; border-width: 1em !important; border-width: 2px }';
    assert.equal(await styledBy(css, 'borderTopWidth'), 10);
  });

  it('keeps an important line of the colour in scope over a more specific rule', async () => {
    const css = '.item { border: 1px solid !important } #strip .item { border-top-color: red }';
    assert.equal(await styledBy(css, 'borderTopColor'), 'green');
  });
});
