/**
 * Selectors asked from script: `querySelector`, `querySelectorAll`, `matches`, `closest`. A
 * library's focus trap, overlay and menu ask with real selectors, and one that cannot be read
 * throws as a browser throws.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { View } from '@ng-native/components';
import { cleanup, compileCss, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: '' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

/**
 * A list, put in the page:
 * main#main > [ h2#title.title, ul[data-kind="menu"] > [ li#one.item, li#two.item.on, li#three.item ],
 * p#empty, input#box[type=checkbox], button#off[disabled], span#tail[lang=en-GB] > "x" ]
 */
async function page() {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document: Dom = app.fixture.componentInstance.document;
  const make = (name: string, attributes: Record<string, string> = {}) => {
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  const main = make('main', { id: 'main' });
  const list = make('ul', { 'data-kind': 'menu' });
  list.append(
    make('li', { id: 'one', class: 'item' }),
    make('li', { id: 'two', class: 'item on' }),
    make('li', { id: 'three', class: 'item' }),
  );
  const tail = make('span', { id: 'tail', lang: 'en-GB' });
  tail.append(document.createTextNode('x'));
  main.append(
    make('h2', { id: 'title', class: 'title' }),
    list,
    make('p', { id: 'empty' }),
    make('input', { id: 'box', type: 'checkbox' }),
    make('button', { id: 'off', disabled: '' }),
    tail,
  );
  document.body.append(main);
  return { document, main, list };
}

/** The ids of what a query found, in order. */
const ids = (found: Dom): string => Array.from(found as Dom[], (node) => node.id).join(' ');

describe('selectors from script', () => {
  it('reads a child combinator as a child, and the sibling combinators', async () => {
    const { main } = await page();
    assert.equal(ids(main.querySelectorAll('main > li')), '');
    assert.equal(ids(main.querySelectorAll('ul > li')), 'one two three');
    assert.equal(ids(main.querySelectorAll('#one + li')), 'two');
    assert.equal(ids(main.querySelectorAll('#one ~ li')), 'two three');
    assert.equal(ids(main.querySelectorAll('h2 ~ *:not(ul)')), 'empty box off tail');
    // The nearest that fits a part may not be the one the rest fits from: each is tried.
    main.insertAdjacentHTML(
      'beforeend',
      '<div class="a"><div class="b"><div class="b"><i id="deep" class="c"></i></div></div></div>',
    );
    assert.equal(ids(main.querySelectorAll('.a > .b .c')), 'deep');
    assert.equal(ids(main.querySelectorAll('.a > .b > .c')), '');
  });

  it('matches the structural pseudo-classes', async () => {
    const { document, main } = await page();
    assert.equal(ids(main.querySelectorAll('li:first-child, li:last-child')), 'one three');
    assert.equal(ids(main.querySelectorAll('li:nth-child(2n+1)')), 'one three');
    assert.equal(ids(main.querySelectorAll('li:nth-child(1 of .on)')), 'two');
    assert.equal(ids(main.querySelectorAll('li:nth-last-child(-n + 2)')), 'two three');
    assert.equal(ids(main.querySelectorAll('main > :empty')), 'title empty box off');
    assert.equal(ids(main.querySelectorAll(':only-of-type:is(p, h2, span)')), 'title empty tail');
    // A text or a comment is no sibling that counts, and a comment leaves an element empty.
    const holder = document.createElement('div');
    holder.append('words', document.createComment('c'), document.createElement('i'));
    assert.equal(holder.querySelector('i:first-child:only-child'), holder.lastChild);
    assert.equal(holder.matches(':empty'), false);
    holder.firstChild.remove();
    assert.equal(holder.matches(':empty'), false);
    holder.lastChild.remove();
    assert.equal(holder.matches(':empty'), true);
    holder.append(document.createElement('i'), 'words', document.createElement('b'));
    assert.equal(holder.querySelector('i + b'), holder.lastChild);
    // The page's element is the only one at the top of its tree.
    assert.equal(document.documentElement.matches(':first-child:only-of-type'), true);
    // Of its type is of its name and its namespace: a drawing's `a` is none of HTML's.
    holder.prepend(document.createElementNS('http://www.w3.org/2000/svg', 'a'));
    holder.append(document.createElement('a'));
    assert.equal(holder.querySelectorAll('a:first-of-type').length, 2);
  });

  it('matches :is(), :where(), :not() with a list, and :has()', async () => {
    const { main, list } = await page();
    assert.equal(ids(main.querySelectorAll(':is(#one, #three)')), 'one three');
    assert.equal(ids(main.querySelectorAll('li:where(.on)')), 'two');
    assert.equal(ids(main.querySelectorAll('li:not(#one, .on)')), 'three');
    assert.equal(main.matches(':has(> ul > li.on)'), true);
    assert.equal(list.matches(':has(+ p)'), true);
    assert.equal(list.matches(':has(~ #missing)'), false);
    assert.equal(main.matches(':has(> li)'), false);
    assert.equal(main.matches(':has(li)'), true);
    // A list that is forgiving drops what it cannot read, and the rest still matches.
    assert.equal(ids(main.querySelectorAll(':is(#one, :unknown, ::before)')), 'one');
  });

  it('matches every attribute operator, with the case flags', async () => {
    const { main } = await page();
    const found = (selector: string) => ids(main.querySelectorAll(selector));
    assert.equal(found('[id^=t]'), 'title two three tail');
    assert.equal(found('[id$=e]'), 'title one three');
    assert.equal(found('[id*=w]'), 'two');
    assert.equal(found('[class~=on]'), 'two');
    assert.equal(found('[lang|=en]'), 'tail');
    assert.equal(found('[id=ONE i]'), 'one');
    assert.equal(found('[id=ONE]'), '');
    // HTML compares `type` in any case, unless the selector says `s`.
    assert.equal(found('[type=CHECKBOX]'), 'box');
    assert.equal(found('[type=CHECKBOX s]'), '');
    assert.equal(found('[id=ONE I]'), 'one');
    assert.equal(found('[id*=""], [id^=""], [id$=""]'), '');
    assert.throws(() => main.querySelector('[id=one x]'), { name: 'SyntaxError' });
  });

  it('matches what the attributes of form controls say, and :scope and :root', async () => {
    const { document, main } = await page();
    assert.equal(ids(main.querySelectorAll(':disabled')), 'off');
    assert.equal(ids(main.querySelectorAll(':enabled')), 'box');
    // A fieldset that is disabled disables what is in it, but for its first legend.
    const set = document.createElement('fieldset');
    set.setAttribute('disabled', '');
    set.innerHTML = '<legend><input id="kept"></legend><input id="lost" required>';
    main.append(set);
    assert.equal(ids(set.querySelectorAll(':disabled')), 'lost');
    assert.equal(ids(main.querySelectorAll(':required')), 'lost');
    assert.equal(ids(main.querySelectorAll('input:optional')), 'box kept');
    assert.equal(ids(main.querySelectorAll('input:read-write')), 'kept');
    assert.equal(ids(main.querySelectorAll('input:read-only')), 'box lost');
    assert.equal(ids(main.querySelectorAll(':scope > ul > li:first-child')), 'one');
    assert.equal(document.querySelector(':root'), document.documentElement);
    // The scope of a document's query is its element, and of an element's, the element.
    assert.equal(document.querySelector(':scope'), document.documentElement);
    assert.equal(document.querySelector(':scope > body'), document.body);
    assert.equal(main.matches(':scope'), true);
    assert.equal(main.matches(':scope > *'), false);
    assert.equal(main.matches(':root'), false);
    assert.equal(ids(main.querySelectorAll(':lang(en)')), 'tail');
  });

  it('matches what more of the attributes of controls and editing say', async () => {
    const { main } = await page();
    main.insertAdjacentHTML(
      'beforeend',
      '<select id="pick"><optgroup id="group" disabled><option id="in-group"></option>' +
        '</optgroup><option id="free"></option></select>' +
        '<input id="fixed" readonly><div id="asked" required></div>' +
        '<div id="edited" contenteditable><span id="edited-in"></span>' +
        '<span id="not-edited" contenteditable="false"></span></div>',
    );
    const found = (selector: string) => ids(main.querySelectorAll(selector));
    assert.equal(found(':disabled'), 'off group in-group');
    assert.equal(found('option:enabled'), 'free');
    assert.equal(found(':required'), '');
    assert.equal(found(':read-write'), 'edited edited-in');
    assert.equal(found('input:read-only'), 'box fixed');
  });

  it('reads escapes, and names in any case', async () => {
    const { document, main } = await page();
    const odd = document.createElement('div');
    odd.id = '0 odd';
    main.append(odd);
    assert.equal(document.querySelector('#\\30 \\ odd'), odd);
    assert.equal(document.querySelector('MAIN LI#one').id, 'one');
  });

  it('throws a SyntaxError for a selector it cannot read, before it looks at any element', async () => {
    const { document, main } = await page();
    const fragment = document.createDocumentFragment();
    for (const selector of [
      '',
      'li:unknown',
      '#-1',
      'a >',
      '[id=]',
      '::before div',
      'a || b',
      ':not(::before)',
      ':blank',
    ]) {
      for (const ask of [
        () => main.querySelector(selector),
        () => main.matches(selector),
        () => main.closest(selector),
        () => fragment.querySelectorAll(selector),
        () => document.querySelectorAll(selector),
      ]) {
        assert.throws(ask, (error: Error) => error.name === 'SyntaxError', selector);
      }
    }
  });

  it('reads the direction :dir() asks for from dir, and from the text where it is auto', async () => {
    const { document, main } = await page();
    const field = document.createElement('input');
    main.setAttribute('dir', 'rtl');
    main.append(field);
    assert.equal(field.matches(':dir(rtl)'), true);
    assert.equal(field.matches(':dir(ltr)'), false);
    field.setAttribute('dir', 'auto');
    assert.equal(field.matches(':dir(ltr)'), true);
    field.value = '\u05EA';
    assert.equal(field.matches(':dir(rtl)'), true);
    // A telephone number is left to right in a right-to-left page.
    field.removeAttribute('dir');
    field.setAttribute('type', 'tel');
    assert.equal(field.matches(':dir(ltr)'), true);
    // An element that says auto has the direction of its first strong letter, past a `<bdi>`.
    const said = document.createElement('p');
    said.setAttribute('dir', 'auto');
    said.innerHTML = '<bdi>abc</bdi> \u05EA';
    main.append(said);
    assert.equal(said.matches(':dir(rtl)'), true);
    said.firstChild.remove();
    said.prepend('abc');
    assert.equal(said.matches(':dir(ltr)'), true);
    assert.equal(said.matches(':dir(up)'), false);
  });

  it('closest walks up from the element itself', async () => {
    const { document } = await page();
    const two = document.getElementById('two');
    assert.equal(two.closest('li').id, 'two');
    assert.equal(two.closest('main > ul').getAttribute('data-kind'), 'menu');
    assert.equal(two.closest('section'), null);
    assert.equal(two.closest('body > ul'), null);
  });
});

describe('selectors on each kind of node', () => {
  it('answers by the prefixed name too, and needs a selector', async () => {
    const { document } = await page();
    const two = document.getElementById('two');
    assert.equal(two.webkitMatchesSelector('.on'), true);
    assert.equal(two.webkitMatchesSelector('.off'), false);
    for (const name of ['matches', 'webkitMatchesSelector', 'closest', 'querySelector']) {
      assert.throws(() => two[name](), TypeError, name);
    }
    assert.throws(() => two.querySelectorAll(), TypeError);
    assert.throws(() => document.querySelector(), TypeError);
    assert.throws(() => document.querySelectorAll(), TypeError);
    // A selector is read from what it is given as a string, as a browser reads one: `7` is none.
    assert.throws(() => two.matches(7), { name: 'SyntaxError' });
    assert.equal(two.matches(null), false);
    assert.equal(document.createTextNode('x').matches('*'), false, 'a text is no element');
  });

  it('throws a SyntaxError for names that only Object.prototype has', async () => {
    const { document, main } = await page();
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      for (const selector of [`:${name}(a)`, `:nth-child(${name})`, `:${name}`]) {
        assert.throws(() => main.querySelector(selector), { name: 'SyntaxError' }, selector);
        assert.throws(() => document.querySelectorAll(selector), { name: 'SyntaxError' }, selector);
      }
    }
  });

  it('looks at the head of a document, as well as what is in it', async () => {
    const { document } = await page();
    const meta = document.createElement('meta');
    document.head.appendChild(meta);
    assert.ok(Array.from(document.querySelectorAll('*')).includes(document.head));
    assert.equal(document.querySelectorAll('*:has(> meta)')[0], document.head);
    // Called `head`, as a library that finds it to put its styles in asks for it.
    assert.equal(document.querySelector('head'), document.head);
    assert.deepEqual([document.head.tagName, document.head.localName], ['HEAD', 'head']);
  });

  it('finds the elements of a fragment, and not the fragment, which is no parent element', async () => {
    const { document } = await page();
    const fragment = document.createDocumentFragment();
    fragment.append(document.createElement('p'), document.createElement('b'));
    fragment.firstChild.append(document.createElement('b'));
    assert.equal(fragment.querySelectorAll('b').length, 2);
    assert.equal(fragment.querySelector('b'), fragment.firstChild.firstChild);
    assert.equal(fragment.querySelectorAll(':root, * > p').length, 0);
    assert.equal(fragment.querySelectorAll('b:first-child').length, 1);
  });

  it('finds the elements of a document a script made, its own element the root', async () => {
    const { document } = await page();
    const made = document.implementation.createHTMLDocument('Made');
    made.body.innerHTML = '<p class="x"><b>b</b></p>';
    assert.equal(made.querySelector('.x b').textContent, 'b');
    assert.equal(made.querySelector(':root'), made.documentElement);
    assert.deepEqual(
      Array.from(made.querySelectorAll('head > title, body > *'), (node: Dom) => node.localName),
      ['title', 'p'],
    );
    assert.throws(() => made.querySelector('a >'), { name: 'SyntaxError' });
    assert.throws(() => made.querySelector(), TypeError);
    assert.throws(() => made.querySelectorAll(), TypeError);
    assert.equal(document.querySelector('.x'), null, 'and none of them is the page');
  });

  it('finds the same element again by a selector, and another once it no longer fits', async () => {
    const { document, list } = await page();
    const [one, two, three] = list.children;
    assert.equal(document.querySelector('li.item'), one);
    assert.equal(document.querySelector('li.item'), one);
    one.className = 'gone';
    assert.equal(document.querySelector('li.item'), two, 'one that no longer matches');
    two.remove();
    assert.equal(document.querySelector('li.item'), three, 'one out of the page');
    three.remove();
    assert.equal(document.querySelector('li.item'), null);
    assert.equal(document.querySelectorAll('li').length, 1);
  });

  it('finds one put before what it found the last time', async () => {
    const { document, list } = await page();
    const [one] = list.children;
    assert.equal(document.querySelector('li.item'), one);
    const before = list.insertBefore(document.createElement('li'), one);
    before.className = 'item';
    assert.equal(document.querySelector('li.item'), before);
    one.setAttribute('data-x', '');
    assert.equal(document.querySelector('[data-x]'), one);
    before.setAttribute('data-x', '');
    assert.equal(document.querySelector('[data-x]'), before, 'and one changed to fit');
  });

  it('finds the head of the document, before the page', async () => {
    const { document } = await page();
    const style = document.createElement('style');
    style.id = 'sheet';
    document.head.append(style);
    assert.equal(document.querySelector('#sheet'), style);
    assert.equal(ids(document.querySelectorAll('#sheet, #main')), 'sheet main');
  });
});

describe('selectors that ask more of the page', () => {
  it('matches a namespace written as any or as none, and refuses a prefix never declared', async () => {
    const { main } = await page();
    assert.equal(ids(main.querySelectorAll('*|li')), 'one two three');
    assert.equal(ids(main.querySelectorAll('[*|id=one]')), 'one');
    assert.equal(ids(main.querySelectorAll('|li')), '');
    assert.throws(() => main.querySelector('svg|a'), { name: 'SyntaxError' });
    const linked = main.querySelector('#one');
    linked.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#x');
    assert.equal(ids(main.querySelectorAll('[*|href]')), 'one');
    assert.equal(ids(main.querySelectorAll('[|href], [href]')), '');
    assert.throws(() => main.querySelector('[svg|href]'), { name: 'SyntaxError' });
  });

  it('reads an+b in each of its forms', async () => {
    const { main } = await page();
    const found = (selector: string) => ids(main.querySelectorAll(selector));
    assert.equal(found('li:nth-child(odd)'), 'one three');
    assert.equal(found('li:nth-child(EVEN)'), 'two');
    assert.equal(found('li:nth-child(-n+2)'), 'one two');
    assert.equal(found('li:nth-child(n-1)'), 'one two three');
    assert.equal(found('li:nth-child( 3 )'), 'three');
    assert.equal(found('li:nth-last-of-type(1)'), 'three');
    assert.equal(found('li:nth-child(+2n - 1)'), 'one three');
    assert.equal(found('li:nth-child(3n - 1)'), 'two');
    assert.equal(found('li:nth-child(3n- 1)'), 'two');
    assert.equal(found('li:nth-child(-n- 1)'), '');
    assert.equal(found('li:NTH-Child(1)'), 'one');
    // Too large to keep, it is no error.
    assert.equal(found('li:nth-child(100000000000000000000)'), '');
    for (const selector of ['li:nth-child(2.5)', 'li:nth-child(n 1)', 'li:nth-child(1 of)']) {
      assert.throws(() => main.querySelector(selector), { name: 'SyntaxError' }, selector);
    }
  });

  it('has after a pseudo-element only what may follow it, and matches no element with one', async () => {
    const { main } = await page();
    for (const selector of [
      '::part(foo):lang(en)',
      '::part(foo)::before',
      'span::-webkit-x:hover',
      ':host(:is(.a, .b+.c, .d))',
      '::slotted(:has(:first-child:last-child))',
      'li::before',
    ]) {
      assert.equal(main.querySelector(selector), null, selector);
    }
    for (const selector of [
      'span::-webkit-x::before',
      '::slotted(foo):hover',
      '::slotted(foo):first-child',
      '::part(foo):has(li)',
      '::before:first-child',
      '::part(foo):first-child',
      ':host(:not(.a .b))',
      '::slotted()',
      '::slotted(0)',
      ':has(:has(li))',
    ]) {
      assert.throws(() => main.querySelector(selector), { name: 'SyntaxError' }, selector);
    }
  });

  it('reads strings, comments and escapes as CSS Syntax does', async () => {
    const { document, main } = await page();
    const odd = document.createElement('div');
    odd.setAttribute('data-say', 'a "b"\\c');
    main.append(odd);
    assert.equal(main.querySelector('[data-say="a \\"b\\"\\\\c"]'), odd);
    assert.equal(main.querySelector('[data-say=\'a "b"\\\\c\']'), odd);
    assert.equal(main.querySelector('/* a */ div /* b */'), odd);
    assert.equal(main.querySelector('\\64 iv'), odd);
    assert.equal(main.querySelector('#\\74 wo').id, 'two');
    // A string with a line in it is a bad one; one the end leaves open is closed by it.
    assert.throws(() => main.querySelector('[data-say="a\nb"]'), { name: 'SyntaxError' });
    assert.equal(main.querySelector('[data-say="a \\"b\\"\\\\c'), odd);
  });

  it('matches a language, a heading, a link, a dialog that is open and an element defined', async () => {
    const { document, main } = await page();
    main.insertAdjacentHTML(
      'beforeend',
      '<h3 id="three-up"></h3><a id="away" href="#x"></a><a id="nowhere"></a>' +
        '<details id="shut"></details><details id="shown" open></details>' +
        '<x-thing id="custom"></x-thing><p id="de" lang="de-Latn-DE"></p>',
    );
    const found = (selector: string) => ids(main.querySelectorAll(selector));
    assert.equal(found(':lang("de-DE")'), 'de');
    assert.equal(found(':lang("de-*-DE")'), 'de');
    assert.equal(found(':lang(fr, en)'), 'tail');
    assert.equal(found(':lang("*-DE")'), 'de');
    main.insertAdjacentHTML('beforeend', '<p id="fr" lang="fr"><b id="fr-in"></b></p>');
    assert.equal(found(':lang(fr)'), 'fr fr-in');
    assert.equal(found(':heading'), 'title three-up');
    assert.equal(found(':heading(3)'), 'three-up');
    assert.equal(found(':any-link'), 'away');
    assert.equal(found(':link'), 'away');
    assert.equal(found(':open'), 'shown');
    assert.equal(found('x-thing:not(:defined)'), 'custom');
    assert.equal(document.getElementById('box').matches(':defined'), true);
    const globals = globalThis as { customElements?: unknown };
    const had = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    globals.customElements = { get: (name: string) => (name === 'x-thing' ? class {} : undefined) };
    try {
      assert.equal(found('x-thing:defined'), 'custom');
    } finally {
      if (had) Object.defineProperty(globalThis, 'customElements', had);
      else delete globals.customElements;
    }
  });

  it('matches no state the app has no reading of', async () => {
    const { main } = await page();
    for (const selector of [':hover', ':visited', ':target', ':playing']) {
      assert.equal(main.querySelector(selector), null, selector);
    }
  });
});

@Component({
  selector: 'x-field',
  template: '<view testID="around" class="around"><input testID="field" id="field" /></view>',
})
class Field {
  readonly document: Dom = inject(DOCUMENT);
}

describe('selectors of focus', () => {
  it('match the focused field, and what it is in', async () => {
    const app = await render(Field, { providers: [provideWebCompat()] });
    await settle();
    const document: Dom = app.fixture.componentInstance.document;
    const field = document.getElementById('field');
    assert.equal(field.matches(':focus'), false);
    assert.equal(document.querySelector(':focus-within'), null);
    fireEvent(screen.getByTestId('field'), 'topFocus', {});
    assert.equal(field.matches(':focus'), true);
    assert.equal(field.matches(':focus-visible'), true);
    assert.equal(field.closest('.around:focus-within').localName, 'view');
    assert.equal(document.querySelector('.around:focus'), null);
  });
});

@Component({
  selector: 'x-pad',
  imports: [View],
  template: '<view class="pad" testID="pad" (click)="pressed = true"></view>',
})
class Pad {
  pressed = false;
}

describe('selectors of a press', () => {
  it('match what a finger is down on, and what it is in', async () => {
    const app = await render(Pad, { providers: [provideWebCompat()] });
    await settle();
    const pad = app.componentRef.location.nativeElement.firstElementChild;
    assert.equal(pad.matches(':active'), false);
    const node = screen.getByTestId('pad');
    const point = { identifier: 0, target: node.reactTag, pageX: 3, pageY: 2 };
    fireEvent(node, 'topTouchStart', { ...point, touches: [point], changedTouches: [point] });
    assert.equal(pad.matches(':active'), true);
    assert.equal(pad.parentNode.matches(':active'), true);
  });
});

@Component({ template: '<div class="box" testID="box"><span testID="in">One</span></div>' })
class Boxed {}

describe('selectors, for a box a rule generates', () => {
  it('keeps it out of what a library reads of the document', async () => {
    // `::before` and `::after` are boxes the engine makes, and no part of a browser's document:
    // a query for the class finds the element once, and its children are what was written.
    await render(Boxed, {
      providers: [provideWebCompat()],
      globalStyles: compileCss(
        '.box::before { content: "a" } .box::after { content: "z" }',
        'global',
        // As a library's sheet is compiled: an option the build passes, and no part of the type.
        { generated: true } as never,
      ) as never,
    });
    await settle();
    const document = (globalThis as unknown as { document: Dom }).document;
    const box = document.querySelector('.box');
    assert.equal(box.childList.length, 3, 'the two boxes are made');
    assert.equal(document.querySelectorAll('.box').length, 1);
    assert.equal(box.querySelectorAll('.box').length, 0);
    assert.equal(box.querySelectorAll('*').length, 1);
    assert.equal(document.querySelector('[testID="in"]').matches('.box > :only-child'), true);
  });
});
