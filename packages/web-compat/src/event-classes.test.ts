/**
 * The kinds of event beside `Event`, and what a click does once it is heard: see
 * `event-classes.ts` and `activation.ts`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, inject } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { cleanup, render, screen, settle, userEvent } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees of the DOM: loosely typed, as its own code would be. */
type Dom = any;
const globals = globalThis as Dom;

@Component({
  selector: 'x-controls',
  imports: [Text, View],
  template: `
    <view class="page" (click)="said('page click')">
      <input
        testID="check"
        id="agree"
        class="check"
        type="checkbox"
        (click)="said('click')"
        (input)="said('input')"
        (change)="said('change')"
      />
      <label testID="label" class="label" for="agree">Agree</label>
      <label class="wrapping" (click)="said('label click')">
        <text>Wrapped</text>
        <input class="wrapped" type="checkbox" (change)="said('wrapped change')" />
      </label>
      <form class="form" (submit)="sent($event)" (reset)="said('reset')">
        <button testID="send" class="send">Send</button>
        <button class="plain" type="button">Plain</button>
        <input class="submit-input" type="submit" value="Go" />
        <button class="clear" type="reset">Clear</button>
      </form>
      <a class="link" href="/elsewhere" (click)="said('link')">Elsewhere</a>
      <view testID="box" class="box"><text>Box</text></view>
    </view>
  `,
})
class Controls {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
  readonly heard: string[] = [];
  said(what: string): void {
    this.heard.push(what);
  }
  sent(event: Dom): void {
    this.heard.push(`submit ${event.cancelable}`);
  }
}

const controls = async () => {
  const app = await render(Controls, { providers: [provideWebCompat()] });
  await settle();
  const { host, heard, document } = app.instance;
  return { app, host, heard, document, find: (selector: string) => host.querySelector(selector) };
};

describe('@ng-native/web-compat event kinds', () => {
  it('has each kind, with the members its init dictionary gives and defaults for the rest', async () => {
    await controls();
    const click = new globals.PointerEvent('click', {
      bubbles: true,
      clientX: 12,
      button: 2,
      buttons: 3,
      ctrlKey: true,
      pointerType: 'pen',
      relatedTarget: null,
      view: globalThis,
      detail: 2,
    });
    for (const kind of ['PointerEvent', 'MouseEvent', 'UIEvent', 'Event']) {
      assert.equal(click instanceof globals[kind], true, kind);
    }
    assert.deepEqual(
      [click.type, click.bubbles, click.clientX, click.pageX, click.x, click.button],
      ['click', true, 12, 12, 12, 2],
    );
    assert.deepEqual(
      [click.buttons, click.ctrlKey, click.shiftKey, click.pointerType],
      [3, true, false, 'pen'],
    );
    assert.deepEqual(
      [click.view === globalThis, click.detail, click.width, click.isTrusted],
      [true, 2, 1, false],
    );
    assert.equal(click.getModifierState('Control'), true);
    assert.equal(click.getModifierState('Shift'), false);
    // Read-only, as a browser's are.
    assert.throws(() => {
      'use strict';
      click.clientX = 5;
    }, TypeError);
    const key = new globals.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13 });
    assert.deepEqual(
      [key.key, key.code, key.keyCode, key.repeat, key.location],
      ['Enter', 'Enter', 13, false, 0],
    );
    assert.equal(key instanceof globals.MouseEvent, false);
    assert.equal(
      new globals.KeyboardEvent('keydown', { modifierCapsLock: true }).getModifierState('CapsLock'),
      true,
    );
    const focus = new globals.FocusEvent('focus', { relatedTarget: globalThis });
    assert.equal(focus.relatedTarget, globalThis);
    const input = new globals.InputEvent('input', { data: 'a', inputType: 'insertText' });
    assert.deepEqual(
      [input.data, input.inputType, new globals.InputEvent('input').data],
      ['a', 'insertText', null],
    );
    assert.equal(new globals.WheelEvent('wheel', { deltaY: 3.5 }).deltaY, 3.5);
    const touch = new globals.Touch({ identifier: 1, target: globalThis, clientX: 4 });
    const touched = new globals.TouchEvent('touchstart', { touches: [touch] });
    assert.deepEqual(
      [touched.touches.length, touched.touches.item(0).clientX, touched.changedTouches.length],
      [1, 4, 0],
    );
    assert.throws(() => new globals.MouseEvent(), TypeError);
    assert.throws(() => new globals.UIEvent('x', { view: 7 }), TypeError);
  });

  it('makes each kind with `document.createEvent`, to be given its members by its own `init*Event`', async () => {
    const { document, find } = await controls();
    const box = find('.box');
    let seen: Dom;
    box.addEventListener('mousedown', (event: Dom) => (seen = event));
    const mouse = document.createEvent('MouseEvents');
    assert.equal(mouse instanceof globals.MouseEvent, true);
    assert.throws(() => box.dispatchEvent(mouse), { name: 'InvalidStateError' });
    mouse.initMouseEvent(
      'mousedown',
      true,
      true,
      globalThis,
      1,
      0,
      0,
      15,
      25,
      false,
      false,
      true,
      false,
      0,
      null,
    );
    box.dispatchEvent(mouse);
    assert.deepEqual(
      [seen.type, seen.clientX, seen.clientY, seen.shiftKey, seen.detail],
      ['mousedown', 15, 25, true, 1],
    );
    const key = document.createEvent('KeyboardEvent');
    assert.equal(key instanceof globals.KeyboardEvent, true);
    key.initKeyboardEvent('keydown', true, true, globalThis, 'a', 0, true);
    assert.deepEqual([key.type, key.key, key.ctrlKey], ['keydown', 'a', true]);
    assert.equal(document.createEvent('UIEvents') instanceof globals.UIEvent, true);
    assert.equal(document.createEvent('TouchEvent') instanceof globals.TouchEvent, true);
    assert.throws(
      () => globals.UIEvent.prototype.initUIEvent.call(new globals.UIEvent('x')),
      TypeError,
    );
    // A UI event's `detail` is its own, not a custom event's.
    const ui = document.createEvent('UIEvents');
    ui.initUIEvent('picked', true, false, globalThis, 4);
    assert.equal(ui.detail, 4);
    assert.equal('initCustomEvent' in ui, false);
  });

  it('has the phases on every event, as Node has them on `Event` alone', async () => {
    await controls();
    const event = new Event('x') as Dom;
    assert.deepEqual(
      [event.NONE, event.CAPTURING_PHASE, event.AT_TARGET, event.BUBBLING_PHASE],
      [0, 1, 2, 3],
    );
    cleanup();
    assert.equal('NONE' in Event.prototype, false, 'and takes them away with the app');
  });

  it('sends a press as a pointer event, with the values a listener read before', async () => {
    const { find } = await controls();
    const box = find('.box');
    const seen: Dom[] = [];
    let current: unknown;
    box.addEventListener('click', (event: Dom) => {
      seen.push(event);
      current = event.currentTarget;
    });
    await userEvent.press(screen.getByTestId('box'));
    const [click] = seen;
    assert.equal(click instanceof globals.PointerEvent, true);
    assert.equal(click instanceof globals.MouseEvent, true);
    assert.deepEqual(
      [click.type, current === box, click.button, click.buttons, click.pointerType],
      ['click', true, 0, 0, 'touch'],
    );
    assert.equal(box.contains(click.target), true, 'the target where the finger landed');
    assert.deepEqual(
      [click.ctrlKey, click.isPrimary, click.detail, click.bubbles, click.cancelable],
      [false, true, 1, true, true],
    );
    // Still written to as it goes on up, as the plain object was.
    click.currentTarget = null;
    assert.equal(click.currentTarget, null);
  });
});

describe('@ng-native/web-compat activation', () => {
  it('checks a checkbox the same for a press and for `click()`', async () => {
    const pressed = await controls();
    await userEvent.press(screen.getByTestId('check'));
    await settle();
    const byPress = [pressed.find('.check').checked, [...pressed.heard]];
    cleanup();
    const clicked = await controls();
    clicked.find('.check').click();
    await settle();
    const byClick = [clicked.find('.check').checked, [...clicked.heard]];
    assert.deepEqual(byPress, [true, ['click', 'page click', 'input', 'change']]);
    assert.deepEqual(byClick, byPress);
  });

  it('checks a checkbox from a mouse click a script sends, but not from a plain event', async () => {
    const { find, heard } = await controls();
    const check = find('.check');
    check.dispatchEvent(new Event('click', { bubbles: true }));
    assert.equal(!!check.checked, false);
    check.dispatchEvent(new globals.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(check.checked, true);
    assert.deepEqual(heard, ['click', 'page click', 'click', 'page click', 'input', 'change']);
  });

  it('checks a checkbox that is not in the page, and says nothing of it', async () => {
    const { document } = await controls();
    const check = document.createElement('input');
    check.type = 'checkbox';
    const heard: string[] = [];
    for (const type of ['input', 'change'])
      check.addEventListener(type, () => void heard.push(type));
    check.click();
    assert.equal(check.checked, true);
    assert.deepEqual(heard, []);
  });

  it('checks a disabled checkbox from a mouse click a script sends, not from click()', async () => {
    const { document } = await controls();
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.disabled = true;
    check.click();
    assert.equal(!!check.checked, false);
    check.dispatchEvent(new globals.MouseEvent('click'));
    assert.equal(check.checked, true);
  });

  it('submits no form that is in no page, nor from a button disabled while heard', async () => {
    const { document } = await controls();
    const submitted: string[] = [];
    const form = (connected: boolean) => {
      const made = document.createElement('form');
      made.addEventListener('submit', (event: Dom) => {
        event.preventDefault();
        submitted.push(connected ? 'connected' : 'apart');
      });
      if (connected) document.body.appendChild(made);
      const button = made.appendChild(document.createElement('input'));
      button.type = 'submit';
      return button;
    };
    form(false).click();
    const disabling = form(true);
    disabling.addEventListener('click', () => (disabling.disabled = true));
    disabling.click();
    assert.deepEqual(submitted, []);
    form(true).click();
    assert.deepEqual(submitted, ['connected']);
  });

  it('leaves a checkbox as it was where a click listener prevents the default', async () => {
    const { find, heard } = await controls();
    const check = find('.check');
    let checkedInListener: unknown;
    check.addEventListener('click', (event: Dom) => {
      checkedInListener = check.checked;
      event.preventDefault();
    });
    check.click();
    assert.equal(checkedInListener, true, 'checked while the listeners hear it');
    assert.equal(check.checked, false);
    assert.deepEqual(heard, ['click', 'page click']);
    // And the same for a press.
    await userEvent.press(screen.getByTestId('check'));
    await settle();
    assert.equal(check.checked, false);
    assert.deepEqual(heard, ['click', 'page click', 'click', 'page click']);
  });

  it('submits a form from `click()` on its submit buttons, and resets it from its reset button', async () => {
    const { find, heard } = await controls();
    for (const selector of ['.send', '.plain', '.submit-input', '.clear']) find(selector).click();
    await settle();
    assert.deepEqual(heard, [
      'page click',
      'submit true',
      'page click',
      'page click',
      'submit true',
      'page click',
      'reset',
    ]);
    heard.length = 0;
    find('.send').addEventListener('click', (event: Dom) => event.preventDefault());
    find('.send').click();
    assert.deepEqual(heard, ['page click'], 'a prevented click submits nothing');
  });

  it('clicks the control of a label, by its `for` or inside it, and once', async () => {
    const { find, heard } = await controls();
    find('.label').click();
    assert.equal(find('.check').checked, true);
    assert.deepEqual(heard, ['page click', 'click', 'page click', 'input', 'change']);
    heard.length = 0;
    find('.wrapping').click();
    assert.equal(find('.wrapped').checked, true);
    assert.deepEqual(heard, [
      'label click',
      'page click',
      'label click',
      'page click',
      'wrapped change',
    ]);
    // A click on the control inside the label is the control's alone.
    heard.length = 0;
    find('.wrapped').click();
    assert.equal(find('.wrapped').checked, false);
    assert.deepEqual(heard, ['label click', 'page click', 'wrapped change']);
  });

  it('runs a link’s listeners on `click()`, and goes nowhere', async () => {
    const { find, heard } = await controls();
    find('.link').click();
    assert.deepEqual(heard, ['link', 'page click']);
  });
});
