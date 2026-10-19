/**
 * The properties of HTML elements a component library reads and writes: what reflects an
 * attribute, by its type and by element, `dataset`, and what a template bound, read back
 * through them.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, signal } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-page',
  template: `
    <div id="bound" [hidden]="hide()" [attr.data-state]="state()"></div>
    <input id="locked" readonly placeholder="Name" />
  `,
})
class Page {
  readonly document: Dom = inject(DOCUMENT);
  readonly hide = signal(true);
  readonly state = signal('open');
}

afterEach(cleanup);

async function page() {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const component = app.fixture.componentInstance;
  const document: Dom = component.document;
  const make = (name: string, attributes: Record<string, string> = {}) => {
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  const byId = (id: string): Dom => document.getElementById(id);
  return { component, document, make, byId, detect: () => app.fixture.detectChanges() };
}

describe('reflection by type', () => {
  it('reads and writes a string, a boolean and a keyword of every HTML element', async () => {
    const { make } = await page();
    const div = make('div');
    assert.equal(div.title, '');
    div.title = 'Close';
    assert.equal(div.getAttribute('title'), 'Close');
    div.setAttribute('lang', 'fr');
    assert.equal(div.lang, 'fr');
    div.accessKey = 'k';
    assert.equal(div.getAttribute('accesskey'), 'k');
    assert.equal(div.inert, false);
    div.inert = true;
    assert.equal(div.getAttribute('inert'), '');
    div.inert = false;
    assert.equal(div.hasAttribute('inert'), false);
    assert.equal(div.autofocus, false);
    div.setAttribute('autofocus', '');
    assert.equal(div.autofocus, true);
    // A keyword in any case reads as written by HTML; one that is none of them reads as nothing.
    div.setAttribute('dir', 'RTL');
    assert.equal(div.dir, 'rtl');
    div.setAttribute('dir', 'sideways');
    assert.equal(div.dir, '');
  });

  it('reads a number by HTML rules, and refuses one out of its range', async () => {
    const { make } = await page();
    const input = make('input');
    assert.equal(input.maxLength, -1);
    input.setAttribute('maxlength', '  12px');
    assert.equal(input.maxLength, 12);
    assert.throws(() => (input.maxLength = -2), { name: 'IndexSizeError' });
    const area = make('textarea');
    assert.equal(area.rows, 2);
    area.rows = 0;
    assert.equal(area.getAttribute('rows'), '2', 'zero is the default for a positive number');
    area.setAttribute('rows', '5');
    assert.equal(area.rows, 5);
    const div = make('div');
    assert.equal(div.tabIndex, -1);
    assert.equal(make('button').tabIndex, 0);
    div.tabIndex = 3;
    assert.equal(div.getAttribute('tabindex'), '3');
  });

  it('is what the package had before on an element with nothing of its own', async () => {
    const { document, make } = await page();
    const text = document.createTextNode('words');
    assert.equal(text.title, undefined);
    text.title = 'kept';
    assert.equal(text.title, 'kept', 'a property a script keeps on a node is its own');
    assert.equal(make('div').type, undefined);
    assert.equal(make('my-chip').disabled, false);
  });
});

describe('reflection by element', () => {
  it('has the properties of a field, a button, a link, an image and a label', async () => {
    const { make } = await page();
    const input = make('input');
    assert.equal(input.type, 'text');
    input.type = 'NUMBER';
    assert.equal(input.type, 'number');
    for (const name of ['min', 'max', 'step', 'placeholder', 'pattern']) {
      input[name] = '4';
      assert.equal(input.getAttribute(name), '4', name);
    }
    input.required = true;
    assert.equal(input.hasAttribute('required'), true);
    assert.equal(make('button').type, 'submit');
    assert.equal(make('button', { type: 'reset' }).type, 'reset');
    assert.equal(make('a').download, '');
    assert.equal(make('img', { alt: 'Logo' }).alt, 'Logo');
    const label = make('label');
    label.htmlFor = 'email';
    assert.equal(label.getAttribute('for'), 'email');
    const select = make('select');
    select.multiple = true;
    assert.equal(select.getAttribute('multiple'), '');
  });

  it('reads back what a template wrote, as an attribute or a property', async () => {
    const { byId, component, detect } = await page();
    const bound = byId('bound');
    assert.equal(bound.hidden, true);
    assert.equal(bound.getAttribute('hidden'), 'true');
    assert.equal(bound.dataset.state, 'open');
    component.hide.set(false);
    component.state.set('closed');
    detect();
    assert.equal(bound.hidden, false);
    assert.equal(bound.hasAttribute('hidden'), false);
    assert.equal(bound.dataset.state, 'closed');
    const locked = byId('locked');
    assert.equal(locked.readOnly, true, 'a static attribute a field took');
    assert.equal(locked.placeholder, 'Name');
  });
});

describe('the older attributes, and those of media and tables', () => {
  it('reflect by their types', async () => {
    const { make } = await page();
    const img = make('img', { hspace: '12' });
    assert.equal(img.hspace, 12);
    img.vspace = -1;
    assert.equal(img.getAttribute('vspace'), '0');
    const object = make('object');
    assert.equal(object.declare, false);
    object.declare = true;
    assert.equal(object.getAttribute('declare'), '');
    const body = make('body');
    body.bgColor = null;
    assert.equal(body.getAttribute('bgcolor'), '');
    const area = make('area');
    assert.equal(area.noHref, false);
    area.noHref = true;
    assert.equal(area.getAttribute('nohref'), '');
    const progress = make('progress');
    assert.equal(progress.max, 1);
    progress.setAttribute('max', ' 1.5e1x');
    assert.equal(progress.max, 15);
    progress.max = -2;
    assert.equal(progress.getAttribute('max'), ' 1.5e1x');
    const cell = make('td', { colspan: '4294967296' });
    assert.equal(cell.colSpan, 1000);
    const link = make('link', { as: 'FONT' });
    assert.equal(link.as, 'font');
    link.crossOrigin = undefined;
    assert.equal(link.getAttribute('crossorigin'), null);
    const iframe = make('iframe');
    iframe.width = 7;
    assert.equal(iframe.width, '7');
    assert.equal(make('li', { type: 'A' }).type, 'A');
    assert.equal(make('pre', { width: '-3' }).width, -3);
    assert.equal(make('video', { loading: 'lazy' }).loading, 'lazy');
    assert.equal(make('ol', { compact: '' }).compact, true);
  });

  it('keeps a nonce set by the property apart from the attribute', async () => {
    const { make } = await page();
    const style = make('style', { nonce: 'a' });
    assert.equal(style.nonce, 'a');
    style.nonce = 'b';
    assert.equal(style.nonce, 'b');
    assert.equal(style.getAttribute('nonce'), 'a');
    style.setAttribute('nonce', 'c');
    assert.equal(style.nonce, 'c');
  });
});

describe('an attribute a property is made of', () => {
  it('reads back as it was written, until the property changes', async () => {
    const { make } = await page();
    const input = make('input', { disabled: ' foo ', maxlength: '-', size: '0', value: '' });
    assert.equal(input.getAttribute('disabled'), ' foo ');
    assert.equal(input.disabled, true);
    assert.equal(input.getAttribute('maxlength'), '-');
    // By any case of its name, though the native prop it is made of is `maxLength`.
    assert.equal(input.getAttribute('maxLength'), '-');
    assert.equal(input.maxLength, -1);
    assert.equal(input.getAttribute('size'), '0');
    assert.equal(input.size, 20);
    assert.equal(input.getAttribute('value'), '');
    input.disabled = false;
    assert.equal(input.getAttribute('disabled'), null);
    input.maxLength = 4;
    assert.equal(input.getAttribute('maxlength'), '4');
  });
});

describe('hidden', () => {
  it('is there or not, and keeps until-found', async () => {
    const { make } = await page();
    const div = make('div');
    div.hidden = true;
    assert.equal(div.getAttribute('hidden'), '');
    assert.equal(div.hidden, true);
    div.hidden = false;
    assert.equal(div.hasAttribute('hidden'), false);
    div.hidden = 'until-found';
    assert.equal(div.hidden, 'until-found');
    assert.equal(div.getAttribute('hidden'), 'until-found');
    div.removeAttribute('hidden');
    assert.equal(div.hidden, false);
  });

  it('is kept by a copy', async () => {
    const { make } = await page();
    const div = make('div');
    div.hidden = true;
    assert.equal(div.cloneNode().hidden, true);
  });
});

describe('sheet', () => {
  it('answers sheet of a style in the page with its rules, and none of a link', async () => {
    const { document, make } = await page();
    const style = make('style');
    assert.equal(style.sheet, null, 'none out of the page');
    style.textContent = '.a { color: red }';
    document.body.appendChild(style);
    assert.equal(style.sheet.cssRules.length, 1);
    assert.equal(style.sheet.rules, style.sheet.cssRules);
    assert.equal(style.sheet.ownerNode, style);
    style.remove();
    assert.equal(style.sheet, null, 'and none once it has left');
    assert.equal(make('link', { rel: 'stylesheet' }).sheet, null);
    assert.equal(make('div').sheet, undefined, 'and no other element has one');
  });
});

describe('dataset', () => {
  it('reads, sets, deletes and lists the data attributes', async () => {
    const { make } = await page();
    const div = make('div', { 'data-side-offset': '4' });
    const { dataset } = div;
    assert.equal(dataset, div.dataset, 'the one map');
    assert.equal(dataset.sideOffset, '4');
    dataset.state = 'open';
    assert.equal(div.getAttribute('data-state'), 'open');
    assert.equal('state' in dataset, true);
    assert.deepEqual(Object.keys(dataset).join(), 'sideOffset,state');
    delete dataset.sideOffset;
    assert.equal(div.hasAttribute('data-side-offset'), false);
    assert.equal(dataset.sideOffset, undefined);
    assert.throws(() => (dataset['side-offset'] = 'x'), { name: 'SyntaxError' });
    assert.equal(dataset instanceof (globalThis as Dom).DOMStringMap, true);
  });
});

describe('assignedSlot', () => {
  it('is null on every node, as there is no shadow DOM', async () => {
    const { document, make } = await page();
    assert.equal(make('div').assignedSlot, null);
    assert.equal(document.createTextNode('a').assignedSlot, null);
    assert.equal(make('div').attachShadow, undefined, 'and none is claimed');
  });
});

@Component({
  selector: 'x-named',
  template: `<input id="email" testID="email" />`,
  styles: `
    input {
      width: 120px;
    }
  `,
})
class Named {
  readonly document: Dom = inject(DOCUMENT);
}

/** The elements HTML gives a `name` that reflects the attribute. */
const NAMED = [
  'a',
  'button',
  'fieldset',
  'form',
  'iframe',
  'img',
  'input',
  'map',
  'meta',
  'object',
  'output',
  'param',
  'select',
  'slot',
  'textarea',
];

describe('name', () => {
  it('reflects the attribute and leaves the element what it was', async () => {
    const app = await render(Named, { providers: [provideWebCompat()] });
    await settle();
    const input: Dom = app.fixture.componentInstance.document.getElementById('email');
    assert.equal(input.name, '');
    input.name = 'email';
    await settle();
    assert.equal(input.getAttribute('name'), 'email');
    assert.equal(input.name, 'email');
    assert.equal(input.localName, 'input');
    assert.equal(input.tag, 'input');
    assert.equal(input.matches('input'), true);
    const view = screen.getByTestId('email');
    assert.equal(view.props['width'], 120);
    input.setAttribute('name', 'other');
    assert.equal(input.name, 'other');
  });

  it('is on the elements that have one, and not on any other', async () => {
    const { make } = await page();
    for (const tag of NAMED) {
      const element = make(tag);
      assert.equal(element.name, '', tag);
      element.name = 'x';
      assert.equal(element.getAttribute('name'), 'x', tag);
      assert.equal(element.localName, tag);
    }
    assert.equal(make('div').name, undefined);
  });

  it('reflects role and the ARIA attributes, as nullable strings or keywords', async () => {
    const { make } = await page();
    const div = make('div');
    assert.equal(div.role, null);
    assert.equal(div.ariaLabel, null);
    assert.equal(div.ariaChecked, null);
    div.role = 'button';
    div.ariaLabel = 'Close';
    div.ariaColIndexText = 'x';
    assert.equal(div.getAttribute('role'), 'button');
    assert.equal(div.getAttribute('aria-label'), 'Close');
    assert.equal(div.getAttribute('aria-colindextext'), 'x');
    div.setAttribute('aria-readonly', 'TRUE');
    div.setAttribute('aria-busy', 'nope');
    div.setAttribute('aria-checked', 'nope');
    assert.equal(div.ariaReadOnly, 'true');
    assert.equal(div.ariaBusy, 'false');
    assert.equal(div.ariaChecked, null);
    div.ariaLabel = undefined;
    div.ariaReadOnly = null;
    assert.equal(div.hasAttribute('aria-label'), false);
    assert.equal(div.hasAttribute('aria-readonly'), false);
    assert.equal(div.ariaLabel, null);
  });
});

describe('a track and the text of an element', () => {
  it("reflects a track's kind as a keyword", async () => {
    const { make } = await page();
    const track = make('track');
    assert.equal(track.kind, 'subtitles');
    track.setAttribute('kind', 'CAPTIONS');
    assert.equal(track.kind, 'captions');
    track.setAttribute('kind', 'nonsense');
    assert.equal(track.kind, 'metadata');
    track.kind = 'chapters';
    assert.equal(track.getAttribute('kind'), 'chapters');
  });

  it('reads the text of a link, a script, a title and an option, and writes it', async () => {
    const { document, make } = await page();
    const link = make('a');
    link.append('Read ', make('b'), 'more');
    link.querySelector('b').append('on');
    assert.equal(link.text, 'Read onmore');
    link.text = 'Back';
    assert.equal(link.textContent, 'Back');
    const script = make('script');
    script.append('one();', make('span'), 'two();');
    script.querySelector('span').append('not this');
    assert.equal(script.text, 'one();two();', 'the texts directly in it');
    const title = make('title');
    title.text = 'Inbox';
    assert.equal(title.textContent, 'Inbox');
    assert.equal(title.text, 'Inbox');
    const option = make('option');
    option.append('  Large\n ', make('script'), ' size ');
    option.querySelector('script').append('ignored');
    assert.equal(option.text, 'Large size', 'collapsed, less a script');
    option.text = 'Small';
    assert.equal(option.textContent, 'Small');
    const body = document.createElement('body');
    assert.equal(body.text, '');
    body.text = '#333';
    assert.equal(body.getAttribute('text'), '#333');
  });
});
