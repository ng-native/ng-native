/**
 * `MutationObserver`, as the DOM has it: what a library watching an element for its attributes,
 * its text and its children is told, whichever way they changed.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, inject, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees of a node: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({
  selector: 'x-bound',
  imports: [Text, View],
  template: `<view class="panel" [attr.aria-expanded]="open()" [class.open]="open()"
    ><text>{{ label() }}</text></view
  >`,
})
class Bound {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
  readonly open = signal(false);
  readonly label = signal('Closed');
}

const mount = async () => {
  const app = await render(Bound, { providers: [provideWebCompat()] });
  const { host, document } = app.instance;
  return { app, host, document, panel: host.firstElementChild as Dom };
};

const Observer = () => (globalThis as Dom).MutationObserver;

/** An observer that keeps what it was told, each record in a word or two. */
function watching(target: Dom, options: object) {
  const heard: Dom[][] = [];
  const observer = new (Observer())((records: Dom[]) => heard.push(records));
  observer.observe(target, options);
  return { heard, observer, all: () => heard.flat() };
}

/** A record as a line: its type, and the attribute or the counts of nodes it is of. */
const line = (record: Dom): string =>
  record.type === 'attributes'
    ? `attributes ${record.attributeName} ${String(record.oldValue)}`
    : record.type === 'characterData'
      ? `characterData ${String(record.oldValue)}`
      : `childList +${record.addedNodes.length} -${record.removedNodes.length}`;

describe('MutationObserver', () => {
  it('checks its options as the DOM does', async () => {
    const { panel } = await mount();
    const observer = new (Observer())(() => {});
    assert.throws(() => observer.observe(panel, {}), TypeError);
    assert.throws(
      () => observer.observe(panel, { attributeOldValue: true, attributes: false }),
      TypeError,
    );
    assert.throws(
      () => observer.observe(panel, { attributeFilter: ['a'], attributes: false }),
      TypeError,
    );
    assert.throws(
      () => observer.observe(panel, { characterDataOldValue: true, characterData: false }),
      TypeError,
    );
    assert.throws(() => observer.observe({}, { childList: true }), TypeError);
    assert.throws(() => new (Observer())(), TypeError);
    // Each of these says which kind it is of without being told.
    observer.observe(panel, { attributeOldValue: true });
    observer.observe(panel, { attributeFilter: ['id'] });
    observer.observe(panel, { characterDataOldValue: true });
    observer.disconnect();
  });

  it('tells of each attribute a script sets, by every way there is to set one', async () => {
    const { panel } = await mount();
    const { all } = watching(panel, { attributes: true, attributeOldValue: true });
    panel.setAttribute('data-state', 'a');
    panel.setAttribute('data-state', 'a');
    panel.removeAttribute('data-state');
    panel.removeAttribute('data-state');
    panel.toggleAttribute('hidden');
    panel.id = 'p';
    panel.className = 'x';
    panel.classList.add('y', 'z');
    panel.classList.remove('y');
    panel.setAttribute('title', 't');
    await settle();
    assert.deepEqual(all().map(line), [
      'attributes data-state null',
      'attributes data-state a',
      'attributes data-state a',
      'attributes hidden null',
      'attributes id null',
      'attributes class panel',
      'attributes class x',
      'attributes class x y z',
      'attributes title null',
    ]);
  });

  it('keeps to its filter', async () => {
    const { panel } = await mount();
    const { all } = watching(panel, { attributeFilter: ['aria-expanded', 'href'] });
    panel.setAttribute('data-other', '1');
    panel.setAttribute('aria-expanded', 'true');
    await settle();
    assert.deepEqual(all().map(line), ['attributes aria-expanded null']);
    assert.equal(all()[0].attributeNamespace, null);
  });

  it('tells of the words of a text, and with subtree of a text inside', async () => {
    const { panel, document } = await mount();
    const text = document.createTextNode('one');
    panel.appendChild(text);
    const { all } = watching(panel, {
      characterData: true,
      characterDataOldValue: true,
      subtree: true,
    });
    text.data = 'two';
    text.appendData('!');
    text.nodeValue = 'three';
    text.textContent = 'four';
    text.deleteData(0, 1);
    const comment = document.createComment('c');
    panel.appendChild(comment);
    comment.data = 'd';
    await settle();
    assert.deepEqual(all().map(line), [
      'characterData one',
      'characterData two',
      'characterData two!',
      'characterData three',
      'characterData four',
      'characterData c',
    ]);
    assert.equal(all()[0].target, text);
  });

  it('tells of children once for each change, with what is beside them', async () => {
    const { panel, document } = await mount();
    const [first] = panel.childNodes;
    const { all } = watching(panel, { childList: true });
    const fragment = document.createDocumentFragment();
    const a = document.createElement('div');
    const b = document.createElement('div');
    fragment.append(a, b);
    panel.appendChild(fragment);
    // Moved within the same parent: taken out, and put in again.
    panel.appendChild(a);
    panel.replaceChildren(a, b);
    panel.replaceChildren(document.createElement('span'), document.createElement('span'));
    panel.textContent = 'words';
    panel.textContent = 'words';
    await settle();
    assert.deepEqual(all().map(line), [
      'childList +2 -0',
      'childList +0 -1',
      'childList +1 -0',
      // Each node handed over is taken out of where it is first, as a browser does.
      'childList +0 -1',
      'childList +0 -1',
      'childList +2 -1',
      'childList +2 -2',
      'childList +1 -2',
      'childList +1 -1',
    ]);
    const [added, out, back] = all();
    assert.equal(added.previousSibling, first);
    assert.equal(added.nextSibling, null);
    assert.equal(out.removedNodes[0], a);
    assert.equal(out.previousSibling, first);
    assert.equal(out.nextSibling, b);
    assert.equal(back.previousSibling, b);
    assert.equal(added.addedNodes.length, 2);
    assert.equal(added.addedNodes.item(1), b);
  });

  it('tells the fragment its children left it', async () => {
    const { panel, document } = await mount();
    const fragment = document.createDocumentFragment();
    fragment.append(document.createElement('div'), document.createElement('div'));
    const { all } = watching(fragment, { childList: true });
    panel.append(fragment);
    await settle();
    assert.deepEqual(all().map(line), ['childList +0 -2']);
  });

  it('is told once a task is over, every observer in the order it was made', async () => {
    const { panel, document } = await mount();
    const other = document.createElement('div');
    const order: string[] = [];
    const first = new (Observer())(() => order.push('first'));
    const second = new (Observer())(function (this: unknown, records: Dom[], self: unknown) {
      assert.equal(this, self);
      assert.equal(records.length, 2, 'in the order they happened');
      assert.equal(records[0].attributeName, 'a');
      order.push('second');
    });
    first.observe(other, { attributes: true });
    second.observe(panel, { attributes: true });
    panel.setAttribute('a', '1');
    panel.setAttribute('b', '1');
    other.setAttribute('a', '1');
    assert.deepEqual(order, [], 'not at once');
    await Promise.resolve();
    assert.deepEqual(order, ['first', 'second']);
    // What was taken is not told again, and a disconnected observer is told nothing.
    panel.setAttribute('c', '1');
    assert.equal(second.takeRecords().length, 1);
    other.setAttribute('b', '1');
    first.disconnect();
    await settle();
    assert.deepEqual(order, ['first', 'second']);
    assert.deepEqual(first.takeRecords(), []);
  });

  it('observes a target again with the options it is given now', async () => {
    const { panel } = await mount();
    const { all, observer } = watching(panel, { attributes: true });
    observer.observe(panel, { childList: true });
    panel.setAttribute('a', '1');
    panel.append('more');
    await settle();
    assert.deepEqual(all().map(line), ['childList +1 -0']);
  });

  it('still hears a subtree taken out, until it is told', async () => {
    const { panel, document } = await mount();
    const child = document.createElement('div');
    panel.appendChild(child);
    const { all } = watching(panel, { attributes: true, childList: true, subtree: true });
    child.remove();
    child.setAttribute('a', '1');
    child.appendChild(document.createElement('div'));
    await settle();
    child.setAttribute('b', '1');
    await settle();
    assert.deepEqual(all().map(line), ['childList +0 -1', 'attributes a null', 'childList +1 -0']);
  });

  it('tells of what a template binds: an attribute, a class and a text', async () => {
    const { app, panel } = await mount();
    const { all } = watching(panel, {
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
      subtree: true,
    });
    app.instance.open.set(true);
    app.instance.label.set('Open');
    await settle();
    const lines = all().map(line);
    assert.ok(lines.includes('attributes aria-expanded false'), lines.join('\n'));
    assert.ok(lines.includes('attributes class panel'), lines.join('\n'));
    assert.ok(lines.includes('characterData Closed'), lines.join('\n'));
    // And nothing of what the engine makes and changes for itself.
    assert.ok(
      lines.every((each) => !each.includes('collapsable')),
      lines.join('\n'),
    );
  });

  it('costs an engine nothing until something observes it', async () => {
    const { app, panel } = await mount();
    const engine = (panel as { engine: Engine }).engine;
    for (const method of ['setProp', 'setText', 'appendChild', 'setClasses'] as const) {
      assert.equal(Object.hasOwn(engine, method), false, `${method} is the engine's own`);
    }
    // A text binding before and after: told only once something is listening.
    app.instance.label.set('Again');
    await settle();
    const { all, observer } = watching(panel, { characterData: true, subtree: true });
    assert.equal(Object.hasOwn(engine, 'setText'), true);
    app.instance.label.set('Once more');
    await settle();
    assert.equal(all().length, 1);
    // And its own again once nothing does.
    observer.disconnect();
    assert.equal(Object.hasOwn(engine, 'setText'), false);
  });
});
