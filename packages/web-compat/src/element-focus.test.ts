/**
 * Focus on what is not a text field: a button, a link, anything with a `tabindex`. A focus trap
 * moves it between them and reads `document.activeElement` to know where it is.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { TextInput } from '@ng-native/components';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-page',
  imports: [TextInput],
  template: `
    <div id="page">
      <button id="one">One</button>
      <button id="two">Two</button>
      <button id="off" disabled>Off</button>
      <div id="plain"></div>
      <div id="held" tabindex="-1"></div>
      <a id="bare">Bare</a>
      <a id="link" href="/somewhere">Link</a>
      <text-input id="field" />
      <button id="reachable" disabled tabindex="0">Reachable</button>
      <text-input id="closed" disabled />
    </div>
  `,
})
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const page = async () => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  return { document: app.fixture.componentInstance.document as Dom, fabric: app.fabric };
};

/** The active element by its id: a node in a failed assertion is printed with the whole engine. */
const active = (document: Dom): string =>
  document.activeElement.id || document.activeElement.localName;

/** The focus events an element hears, in order. */
function hear(element: Dom): string[] {
  const heard: string[] = [];
  for (const type of ['focus', 'focusin', 'blur', 'focusout']) {
    element.addEventListener(type, () => heard.push(type));
  }
  return heard;
}

describe('focus on what is not a text field', () => {
  it('is taken by what can be focused, with its events, and is the active element', async () => {
    const { document } = await page();
    const one = document.getElementById('one');
    const heard = hear(one);
    one.focus();
    assert.equal(active(document), 'one');
    assert.equal(one.matches(':focus'), true);
    assert.deepEqual(heard, ['focus', 'focusin']);
    one.focus();
    assert.deepEqual(heard, ['focus', 'focusin'], 'once, while it has it');
    for (const id of ['held', 'link']) {
      document.getElementById(id).focus();
      assert.equal(active(document), id);
    }
    // Not by what cannot be focused, which leaves it where it was.
    for (const id of ['plain', 'off', 'bare']) {
      document.getElementById(id).focus();
      assert.equal(active(document), 'link', id);
    }
  });

  it('moves from one to the next, and is given up by blur', async () => {
    const { document } = await page();
    const one = document.getElementById('one');
    const two = document.getElementById('two');
    one.focus();
    const left = hear(one);
    const reached = hear(two);
    two.focus();
    assert.deepEqual(left, ['blur', 'focusout']);
    assert.deepEqual(reached, ['focus', 'focusin']);
    assert.equal(one.matches(':focus'), false);
    two.blur();
    assert.equal(active(document), 'body');
    assert.deepEqual(reached, ['focus', 'focusin', 'blur', 'focusout']);
    two.blur();
    assert.equal(reached.length, 4, 'nothing to give up the second time');
  });

  it('takes the focus from a text field, which native is told to blur', async () => {
    const { document, fabric } = await page();
    const field = document.getElementById('field');
    const one = document.getElementById('one');
    field.focus();
    one.focus();
    assert.equal(active(document), 'one');
    const blurs = fabric.commands.filter((command) => command.name === 'blur');
    assert.equal(blurs.length, 1);
    assert.match(blurs[0]!.viewName, /TextInput$/);
  });

  it('is given up by a button when a text field takes it', async () => {
    const { document } = await page();
    const one = document.getElementById('one');
    one.focus();
    const heard = hear(one);
    document.getElementById('field').focus();
    assert.equal(active(document), 'field');
    assert.deepEqual(heard, ['blur', 'focusout']);
  });

  it('is taken by a field as it is asked, before focus() returns, and once', async () => {
    // A library focuses a field and closes its list in the next statement: a listener that
    // hears of the focus only when native answers hears of it after, and opens the list again.
    const { document, fabric } = await page();
    const field = document.getElementById('field');
    let heard = 0;
    field.addEventListener('focusin', () => heard++);
    field.focus();
    assert.equal(heard, 1, 'before focus() returns');
    assert.equal(active(document), 'field');
    assert.equal(fabric.commands.filter((command) => command.name === 'focus').length, 1);
    // Asked again while it has it: nothing, as nothing changed.
    field.focus();
    assert.equal(heard, 1);
    field.blur();
    assert.equal(fabric.commands.filter((command) => command.name === 'blur').length, 1);
  });

  it('is not taken by a disabled control, whatever its tabindex, nor by a disabled field', async () => {
    const { document, fabric } = await page();
    for (const id of ['reachable', 'closed']) {
      const control = document.getElementById(id);
      const heard = hear(control);
      control.focus();
      assert.equal(active(document), 'body', id);
      assert.deepEqual(heard, [], id);
    }
    assert.equal(fabric.commands.filter((command) => command.name === 'focus').length, 0);
  });

  it('is given up by a field at once, so it is taken again before native says it blurred', async () => {
    const { document, fabric } = await page();
    const field = document.getElementById('field');
    field.focus();
    const native = fabric.commands.find((command) => command.name === 'focus')!.node!;
    const heard = hear(field);
    field.blur();
    assert.equal(active(document), 'body');
    assert.deepEqual(heard, ['blur', 'focusout']);
    field.focus();
    assert.equal(active(document), 'field');
    assert.equal(fabric.commands.filter((command) => command.name === 'focus').length, 2);
    // Native answers the blur, then the focus: neither is news, and the field keeps the focus.
    fabric.emit(native, 'topBlur');
    fabric.emit(native, 'topFocus');
    assert.equal(active(document), 'field');
    assert.deepEqual(heard, ['blur', 'focusout', 'focus', 'focusin']);
    // A blur native says of itself after that is one.
    fabric.emit(native, 'topBlur');
    assert.equal(active(document), 'body');
    assert.deepEqual(heard.slice(4), ['blur', 'focusout']);
  });

  it('forgets a blur native never answered once native focuses the field of itself', async () => {
    // Native gives no blur for a field it never had: the next one it says is no answer to it.
    const { document, fabric } = await page();
    const field = document.getElementById('field');
    field.focus();
    const native = fabric.commands.find((command) => command.name === 'focus')!.node!;
    field.blur();
    fabric.emit(native, 'topFocus');
    assert.equal(active(document), 'field');
    fabric.emit(native, 'topBlur');
    assert.equal(active(document), 'body');
  });

  it('is heard of on the document and the body, focusin and focusout, as a focus monitor listens', async () => {
    const { document } = await page();
    const heard: Record<string, string[]> = { document: [], body: [] };
    for (const [where, target] of [
      ['document', document],
      ['body', document.body],
    ] as const) {
      for (const type of ['focusin', 'focusout']) {
        target.addEventListener(type, (event: Dom) =>
          heard[where]!.push(`${type} ${event.target.id}`),
        );
      }
    }
    document.getElementById('one').focus();
    document.getElementById('two').focus();
    document.getElementById('field').focus();
    for (const where of ['document', 'body']) {
      assert.deepEqual(
        heard[where],
        ['focusin one', 'focusout one', 'focusin two', 'focusout two', 'focusin field'],
        where,
      );
    }
  });
});
