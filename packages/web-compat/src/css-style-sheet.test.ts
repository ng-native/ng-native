/**
 * The rules of a `<style>` a script reads and writes: `style.sheet`, as a CSS-in-JS library
 * writes what it makes with `insertRule`, and what the engine applies of it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees: loosely typed, as its own code would be. */
type Dom = any;

interface Declaration {
  readonly length: number;
  cssText: string;
  item(index: number): string;
  getPropertyValue(name: string): string;
  getPropertyPriority(name: string): string;
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): string;
  [name: string]: unknown;
}
interface Rule {
  readonly type: number;
  readonly cssText: string;
  selectorText: string;
  readonly style: Declaration;
  readonly conditionText: string;
  readonly cssRules: RuleList;
  readonly parentRule: Rule | null;
  readonly parentStyleSheet: Sheet | null;
  insertRule(text: string, index?: number): number;
  deleteRule(index: number): void;
}
interface RuleList extends ArrayLike<Rule> {
  item(index: number): Rule | null;
}
interface Sheet {
  readonly cssRules: RuleList;
  readonly ownerNode: unknown;
  disabled: boolean;
  insertRule(text: string, index?: number): number;
  deleteRule(index: number): void;
  replaceSync(text: string): void;
  replace(text: string): Promise<Sheet>;
}
interface Made {
  readonly children: ArrayLike<Made>;
  readonly firstChild: { data: string } | null;
  textContent: string;
  readonly sheet: Sheet | null;
  readonly parentNode: Made;
  appendChild(child: Made): void;
  removeChild(child: Made): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
}
interface Page {
  readonly head: Made;
  readonly styleSheets: ArrayLike<Sheet>;
  adoptedStyleSheets: Sheet[];
  createElement(name: string): Made;
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

const page = async () => {
  const app = await render(Strip, { providers: [provideWebCompat()] });
  await settle();
  return app.fixture.componentInstance.document;
};
const styleIn = (document: Page, text = ''): Made => {
  const style = document.createElement('style');
  style.textContent = text;
  document.head.appendChild(style);
  return style;
};
const width = (id: string) => screen.getByTestId(id).props['width'] ?? null;
const quietly = async <T>(run: () => Promise<T>): Promise<{ result: T; said: string[] }> => {
  const said: string[] = [];
  const warn = console.warn;
  console.warn = (...all: unknown[]) => said.push(all.join(' '));
  try {
    return { result: await run(), said };
  } finally {
    console.warn = warn;
  }
};

describe('the sheet of a <style> in the page', () => {
  it('is none until the element is in the page, and its rules as written once it is', async () => {
    const document = await page();
    const style = document.createElement('style');
    style.textContent = '#strip .item { width: 50%; color: red !important } .b { height: 2px }';
    assert.equal(style.sheet, null);
    document.head.appendChild(style);
    const sheet = style.sheet!;
    assert.equal(sheet.ownerNode, style);
    assert.equal(style.sheet, sheet);
    assert.equal(sheet.cssRules.length, 2);
    const rule = sheet.cssRules.item(0)!;
    assert.equal(rule.type, 1);
    assert.equal(rule.selectorText, '#strip .item');
    assert.equal(rule.style.getPropertyValue('width'), '50%');
    assert.equal(rule.style.getPropertyPriority('color'), 'important');
    assert.equal(rule.style['color'], 'red');
    assert.equal(rule.style.length, 2);
    assert.equal(rule.style.item(0), 'width');
    assert.equal(rule.cssText, '#strip .item { width: 50%; color: red !important; }');
    assert.equal(rule.parentStyleSheet, sheet);
    assert.equal(sheet.cssRules[1]!.cssText, '.b { height: 2px; }');
  });

  it('is there for a <style> put in the page by append or prepend, and styles as one appended', async () => {
    const document = await page();
    const head = document.head as Made & { append(child: Made): void; prepend(child: Made): void };
    const style = document.createElement('style');
    style.textContent = '#strip .item { width: 40% }';
    head.append(style);
    const other = document.createElement('style');
    head.prepend(other);
    other.sheet!.insertRule('#strip .wide { width: 10% }', 0);
    await settle();
    assert.equal(style.sheet!.cssRules.length, 1);
    assert.deepEqual([width('one'), width('two')], ['40%', '10%']);
  });

  it('is listed by the document while it is in the page, and is none once it has left', async () => {
    const document = await page();
    const style = styleIn(document, '.a { width: 1px }');
    const other = styleIn(document);
    assert.deepEqual([...Array.from(document.styleSheets)], [style.sheet, other.sheet]);
    style.remove();
    assert.equal(style.sheet, null);
    assert.deepEqual(Array.from(document.styleSheets), [other.sheet]);
    other.parentNode.removeChild(other);
    assert.deepEqual(Array.from(document.styleSheets), []);
  });

  it('lists sheets as one live list: the same object, behind no change to the page', async () => {
    const document = await page();
    const list = document.styleSheets as ArrayLike<Sheet> &
      Iterable<Sheet> & { item(at: number): Sheet | null };
    assert.equal(document.styleSheets, list);
    assert.equal(list.length, 0);
    const style = styleIn(document, '.a { width: 1px }');
    assert.equal(list.length, 1);
    assert.equal(list[0], style.sheet);
    assert.equal(list.item(0), style.sheet);
    assert.equal(list.item(1), null);
    assert.equal(1 in list, false);
    const other = styleIn(document);
    assert.deepEqual([...list], [style.sheet, other.sheet]);
    style.remove();
    assert.deepEqual([...list], [other.sheet]);
    assert.equal(list[1], undefined);
    // Moved out of the page into an element that is not in it, and put back.
    const box = document.createElement('div');
    box.appendChild(other);
    assert.equal(list.length, 0);
    assert.equal(document.styleSheets, list);
    document.head.appendChild(other);
    assert.equal(list.length, 1);
  });

  it('styles what a rule inserted is for, without writing the text of the element', async () => {
    const document = await page();
    const style = styleIn(document);
    const sheet = style.sheet!;
    assert.equal(sheet.insertRule('#strip .item { width: 40% }', 0), 0);
    assert.equal(sheet.insertRule('#strip .wide { width: 10% }', 1), 1);
    await settle();
    assert.deepEqual([width('one'), width('two')], ['40%', '10%']);
    assert.equal(style.textContent, '');
    assert.equal(sheet.cssRules.length, 2);
    // Before the first, where no index is given.
    sheet.insertRule('.c { height: 1px }');
    assert.equal(sheet.cssRules[0]!.selectorText, '.c');
  });

  it('is applied before a script reads the style it gives, in the same turn', async () => {
    const document = await page();
    const sheet = styleIn(document).sheet!;
    const one = (document as unknown as { querySelector(selector: string): Made }).querySelector(
      '#strip .item',
    );
    const computed = (globalThis as unknown as { getComputedStyle(node: Made): { width: string } })
      .getComputedStyle;
    // A library makes a class and reads what it does at once: many, one after another.
    for (let at = 1; at <= 50; at++) sheet.insertRule(`#strip .item { width: ${at}% }`, at - 1);
    assert.equal(computed(one).width, '50%');
  });

  it('keeps what a script inserted where no text replaces no text, and reads it afresh otherwise', async () => {
    const document = await page();
    const style = styleIn(document);
    style.sheet!.insertRule('#strip .item { width: 40% }');
    await settle();
    style.textContent = '';
    await settle();
    assert.equal(width('one'), '40%');
    style.textContent = ' ';
    await settle();
    assert.equal(width('one'), null);
  });

  it('tells a <style> its sheet has loaded, in a task after it is put in', async () => {
    const document = await page();
    const style = document.createElement('style') as Made & { onload: (() => void) | null };
    let loads = 0;
    style.onload = () => loads++;
    style.textContent = '#strip .item { width: 1px }';
    document.head.appendChild(style);
    assert.equal(loads, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(loads, 1);
  });

  it('takes away what a rule deleted styled', async () => {
    const document = await page();
    const style = styleIn(document, '#strip .item { width: 40% }');
    const sheet = style.sheet!;
    sheet.insertRule('#strip .wide { width: 10% }', 1);
    await settle();
    assert.equal(width('two'), '10%');
    sheet.deleteRule(1);
    await settle();
    assert.deepEqual([width('one'), width('two')], ['40%', '40%']);
    // A rule of the text goes as one inserted does.
    sheet.deleteRule(0);
    await settle();
    assert.deepEqual([width('one'), width('two')], [null, null]);
    assert.equal(sheet.cssRules.length, 0);
  });

  it('refuses a rule past the end, one that is no rule, and a delete of none', async () => {
    const document = await page();
    const sheet = styleIn(document, '.a { width: 1px }').sheet!;
    assert.throws(() => sheet.insertRule('.b { width: 1px }', 2), { name: 'IndexSizeError' });
    assert.throws(() => sheet.insertRule('not a rule', 0), { name: 'SyntaxError' });
    assert.throws(() => sheet.insertRule('.a {} .b {}', 0), { name: 'SyntaxError' });
    assert.throws(() => sheet.deleteRule(1), { name: 'IndexSizeError' });
    assert.equal(sheet.cssRules.length, 1);
  });

  it('is read again once the words of the text in it change', async () => {
    const document = await page();
    const style = styleIn(document, '.a { width: 1px }');
    assert.equal(style.sheet!.cssRules[0]!.selectorText, '.a');
    style.firstChild!.data = '.b { width: 1px }';
    assert.equal(style.sheet!.cssRules[0]!.selectorText, '.b');
  });

  it('is read from its text again once the text is replaced, without the rules inserted', async () => {
    const document = await page();
    const style = styleIn(document, '#strip .item { width: 40% }');
    const sheet = style.sheet!;
    sheet.insertRule('#strip .wide { width: 10% }', 1);
    await settle();
    style.textContent = '#strip .item { width: 30% }';
    await settle();
    assert.deepEqual([width('one'), width('two')], ['30%', '30%']);
    assert.notEqual(style.sheet, sheet);
    assert.equal(style.sheet!.cssRules.length, 1);
    // The sheet it had is its no longer: a rule inserted in it styles nothing.
    sheet.insertRule('#strip .wide { width: 5% }', 0);
    await settle();
    assert.equal(width('two'), '30%');
  });

  it('styles nothing once its element leaves the page, rules inserted and all', async () => {
    const document = await page();
    const style = styleIn(document);
    const sheet = style.sheet!;
    sheet.insertRule('#strip .item { width: 40% }', 0);
    await settle();
    assert.equal(width('one'), '40%');
    style.remove();
    await settle();
    assert.equal(width('one'), null);
    // What a script still holds of it is a sheet of no page.
    sheet.insertRule('#strip .wide { width: 5% }', 0);
    sheet.disabled = true;
    sheet.disabled = false;
    await settle();
    assert.equal(width('two'), null);
    // Put back, it is its text again, which has no rule.
    document.head.appendChild(style);
    await settle();
    assert.equal(width('one'), null);
    assert.equal(style.sheet!.cssRules.length, 0);
  });

  it('styles again as a rule’s declarations are changed through it', async () => {
    const document = await page();
    const sheet = styleIn(document, '#strip .item { width: 40% }').sheet!;
    const rule = sheet.cssRules[0]!;
    rule.style.setProperty('width', '20%');
    await settle();
    assert.equal(width('one'), '20%');
    rule.style['minHeight'] = '3px';
    assert.equal(rule.style.getPropertyValue('min-height'), '3px');
    await settle();
    assert.equal(screen.getByTestId('one').props['minHeight'], 3);
    rule.style.removeProperty('width');
    await settle();
    assert.equal(width('one'), null);
    rule.selectorText = '#strip .wide';
    rule.style.cssText = 'width: 5%';
    await settle();
    assert.deepEqual([width('one'), width('two')], [null, '5%']);
  });

  it('holds the rules of a @media rule, which are applied for the width they are for', async () => {
    const document = await page();
    const sheet = styleIn(
      document,
      '@media (min-width: 0px) { #strip .item { width: 40% } } @media (min-width: 99999px) { #strip .wide { width: 1% } }',
    ).sheet!;
    const media = sheet.cssRules[0]!;
    assert.equal(media.type, 4);
    assert.equal(media.conditionText, '(min-width: 0px)');
    assert.equal(media.cssRules.length, 1);
    assert.equal(media.cssRules[0]!.parentRule, media);
    assert.equal(media.cssText, '@media (min-width: 0px) {\n  #strip .item { width: 40%; }\n}');
    media.insertRule('#strip .wide { width: 20% }', 1);
    await settle();
    assert.deepEqual([width('one'), width('two')], ['40%', '20%']);
    media.deleteRule(0);
    await settle();
    assert.deepEqual([width('one'), width('two')], [null, '20%']);
  });

  it('lists a rule the engine has no reading of as it was written, and says so', async () => {
    const { result: sheet, said } = await quietly(async () => {
      const document = await page();
      const sheet = styleIn(document).sheet!;
      sheet.insertRule('@keyframes spin { from { opacity: 0 } to { opacity: 1 } }', 0);
      sheet.insertRule('.x:hover { width: 1px }', 1);
      return sheet;
    });
    assert.equal(sheet.cssRules.length, 2);
    assert.equal(sheet.cssRules[0]!.type, 7);
    assert.match(sheet.cssRules[0]!.cssText, /^@keyframes spin/);
    assert.equal(sheet.cssRules[1]!.selectorText, '.x:hover');
    assert.ok(said.some((line) => line.includes(':hover')));
  });

  it('gives the engine nothing to match for a rule that declares nothing, and says nothing of it', async () => {
    // The CDK's breakpoint observer: an empty rule under each query it watches, for Safari.
    const { result: sheets, said } = await quietly(async () => {
      const document = await page();
      const style = styleIn(document);
      const engine = (
        style as unknown as { engine: { addGlobalSheet(...all: unknown[]): unknown } }
      ).engine;
      const sheets: unknown[] = [];
      const add = engine.addGlobalSheet;
      engine.addGlobalSheet = (...all) => (sheets.push(all[0]), add.apply(engine, all));
      try {
        style.sheet!.insertRule('@media (orientation: landscape) {body{ }}', 0);
        style.sheet!.insertRule('@media (max-width: 599.98px) {body{ }}', 0);
        await settle();
      } finally {
        engine.addGlobalSheet = add;
      }
      return sheets;
    });
    assert.deepEqual(sheets, []);
    assert.deepEqual(said, []);
  });

  it('gives the root the tokens a rule inserted gives it, until the rule is deleted', async () => {
    const document = await page();
    const sheet = styleIn(document, '#strip .item { min-height: var(--tall) }').sheet!;
    sheet.insertRule(':root { --tall: 7px }', 1);
    await settle();
    assert.equal(screen.getByTestId('one').props['minHeight'], 7);
    sheet.deleteRule(1);
    await settle();
    // A token no longer given leaves the declaration that reads it unset: the element's start,
    // a browser's automatic minimum.
    assert.equal(screen.getByTestId('one').props['minHeight'], 'auto');
  });

  it('styles nothing while it is disabled', async () => {
    const document = await page();
    const sheet = styleIn(document).sheet!;
    sheet.insertRule('#strip .item { width: 40% }', 0);
    sheet.disabled = true;
    await settle();
    assert.equal(width('one'), null);
    sheet.disabled = false;
    await settle();
    assert.equal(width('one'), '40%');
  });

  it('leaves the build’s own sheet to the build, as its text is', async () => {
    const document = await page();
    const style = document.createElement('style');
    style.setAttribute('data-x-style-id', 'button');
    document.head.appendChild(style);
    const sheet = style.sheet!;
    sheet.insertRule('#strip .item { width: 40% }', 0);
    await settle();
    assert.equal(width('one'), null);
    assert.equal(sheet.cssRules.length, 1);
  });
});

describe('a style rule’s selector', () => {
  it('is refused where it is no selector, by insertRule and in the text of a <style>', async () => {
    const document = await page();
    const sheet = styleIn(document, ':nth-child(n- 1 2) { width: 1px } .a { width: 2px }').sheet!;
    assert.equal(sheet.cssRules.length, 1);
    assert.equal(sheet.cssRules[0]!.selectorText, '.a');
    for (const selector of [':not()', ':unknownpseudo', "[foo='bar' i i]", 'a::before b']) {
      assert.throws(() => sheet.insertRule(`${selector} {}`, 0), { name: 'SyntaxError' }, selector);
    }
    sheet.cssRules[0]!.selectorText = ':not(';
    assert.equal(sheet.cssRules[0]!.selectorText, '.a');
  });

  it('reads a prefix by the @namespace rules before it, and writes it back by them', async () => {
    const document = await page();
    const sheet = styleIn(document, "@namespace x url(a); x|p, [x|lang='A' i], *|q {}").sheet!;
    assert.equal(sheet.cssRules.length, 2);
    assert.equal(sheet.cssRules[1]!.selectorText, 'x|p, [x|lang="A" i], q');
    const other = styleIn(document, '@namespace url("d"); @namespace n url(d); p, *|*, |*.a {}');
    assert.equal(other.sheet!.cssRules[2]!.selectorText, 'p, *|*, |*.a');
    assert.throws(() => sheet.insertRule('y|p {}', 2), { name: 'SyntaxError' });
  });

  it('is written back as the CSSOM serialises it', async () => {
    const document = await page();
    const sheet = styleIn(document).sheet!;
    const cases: [string, string][] = [
      [':nth-child(1n+0)', ':nth-child(n)'],
      [':nth-last-of-type( -n\n- 1)', ':nth-last-of-type(-n-1)'],
      [':nth-child( 23n + 123 of .a,.b )', ':nth-child(23n+123 of .a, .b)'],
      [':nth-child(-0n+3)', ':nth-child(3)'],
      ['div ol>li p', 'div ol > li p'],
      ["span[class='example' i]", 'span[class="example" i]'],
      ['[|att],[*|att]', '[att], [*|att]'],
      ['*|*:not(*|*)', ':not(*)'],
      [':is(div ,,  .a)', ':is(div, , .a)'],
      ['A#b.c:HOVER::BEFORE', 'A#b.c:hover::before'],
      [':lang("en",fr)::part(foo  bar)', ':lang("en", fr)::part(foo bar)'],
      ['.\\31 a', '.\\31 a'],
      [':has(> a, + b)', ':has(> a, + b)'],
    ];
    for (const [written, read] of cases) {
      sheet.insertRule(`${written} {}`, 0);
      assert.equal(sheet.cssRules[0]!.selectorText, read, written);
      assert.equal(sheet.cssRules[0]!.cssText, `${read} { }`, written);
      sheet.deleteRule(0);
    }
  });
});

describe('a media list', () => {
  it('is the queries of a @media rule, each in its written form', async () => {
    const document = await page();
    const sheet = styleIn(document, '@media SCREEN { .a { width: 1px } }').sheet!;
    const media = (sheet.cssRules[0] as unknown as { media: Dom }).media;
    assert.equal(media.mediaText, 'screen');
    media.mediaText = '  screen  ,  bad$, (MIN-WIDTH:100PX) ';
    assert.equal(media.mediaText, 'screen, not all, (min-width: 100px)');
    assert.equal(media.length, 3);
    assert.equal(media.item(1), 'not all');
    media.appendMedium('Print');
    media.appendMedium('print');
    assert.equal(media.length, 4);
    media.deleteMedium('PRINT');
    assert.equal(media.length, 3);
    assert.throws(() => media.deleteMedium('print'), { name: 'NotFoundError' });
    assert.equal(sheet.cssRules[0]!.cssText.startsWith('@media screen, not all,'), true);
  });

  it('is the media and the title of a <style> on its sheet', async () => {
    const document = await page();
    const style = styleIn(document, '.a {}');
    style.setAttribute('media', 'Screen');
    style.setAttribute('title', 'Mine');
    const sheet = style.sheet as unknown as Dom;
    assert.equal(sheet.media.mediaText, 'screen');
    assert.equal(sheet.title, 'Mine');
  });
});

describe('a sheet a script makes', () => {
  const made = () => {
    const Made = (globalThis as unknown as { CSSStyleSheet: new () => Sheet }).CSSStyleSheet;
    return new Made();
  };

  it('holds the rules it is given, and styles what they are for once the document adopts it', async () => {
    const document = await page();
    const sheet = made();
    sheet.replaceSync('#strip .item { width: 40% }');
    assert.equal(sheet.cssRules.length, 1);
    assert.equal(sheet.ownerNode, null);
    await settle();
    assert.equal(width('one'), null);
    document.adoptedStyleSheets = [sheet];
    await settle();
    assert.equal(width('one'), '40%');
    sheet.insertRule('#strip .wide { width: 10% }', 1);
    await settle();
    assert.equal(width('two'), '10%');
    assert.equal(await sheet.replace('#strip .wide { width: 5% }'), sheet);
    await settle();
    assert.deepEqual([width('one'), width('two')], [null, '5%']);
    document.adoptedStyleSheets = [];
    await settle();
    assert.equal(width('two'), null);
    // No longer adopted, a change to it styles nothing.
    sheet.insertRule('#strip .item { width: 1% }', 0);
    await settle();
    assert.equal(width('one'), null);
  });

  it('styles in the order the document adopts its sheets, the last of one there twice', async () => {
    const document = await page();
    const [narrow, wide] = [made(), made()];
    narrow.replaceSync('#strip .item { width: 10% }');
    wide.replaceSync('#strip .item { width: 90% }');
    document.adoptedStyleSheets = [narrow, wide];
    await settle();
    assert.equal(width('one'), '90%');
    document.adoptedStyleSheets = [wide, narrow];
    await settle();
    assert.equal(width('one'), '10%');
    document.adoptedStyleSheets = [wide, narrow, wide];
    await settle();
    assert.equal(width('one'), '90%');
    assert.equal(document.adoptedStyleSheets.length, 3);
    // Changed in place, as an array is.
    const adopted = document.adoptedStyleSheets;
    assert.equal(document.adoptedStyleSheets, adopted);
    adopted.pop();
    await settle();
    assert.equal(width('one'), '10%');
    adopted.splice(0, 2);
    adopted.push(wide);
    await settle();
    assert.equal(width('one'), '90%');
    assert.throws(() => adopted.push('wide' as unknown as Sheet), TypeError);
    assert.throws(() => adopted.push(styleIn(document).sheet!), { name: 'NotAllowedError' });
  });

  it('is not one a <style> owns, whose rules come from its text', async () => {
    const document = await page();
    const sheet = styleIn(document).sheet!;
    assert.throws(() => sheet.replaceSync('.a { width: 1px }'), { name: 'NotAllowedError' });
  });
});

describe('a CSS-in-JS library', () => {
  it('styles an element by the class it makes, writing its rule with insertRule', async () => {
    const document = await page();
    // Loaded once the page is up: Emotion asks whether there is a document as it loads.
    const { default: createEmotion } = await import('@emotion/css/create-instance');
    const emotion = createEmotion({ key: 'x', speedy: true, container: document.head as never });
    const narrow = emotion.css({ width: '40%', minHeight: 3 });
    const one = (
      document as unknown as { querySelector(selector: string): Made | null }
    ).querySelector('#strip')!.children[0] as unknown as { classList: { add(name: string): void } };
    one.classList.add(narrow);
    await settle();
    assert.equal(width('one'), '40%');
    assert.equal(screen.getByTestId('one').props['minHeight'], 3);
    const tag = Array.from(document.styleSheets).find(
      (sheet) => (sheet.ownerNode as Made).textContent === '',
    );
    assert.match(tag!.cssRules[0]!.cssText, new RegExp(`^\\.${narrow} \\{ width: 40%;`));
    emotion.flush();
    await settle();
    assert.equal(width('one'), null);
  });
});
