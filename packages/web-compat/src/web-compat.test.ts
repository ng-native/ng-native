/**
 * `@ng-native/web-compat`: engine nodes answering to the DOM members a component library written
 * for the browser calls, each one going through the engine's own mutation API.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, ElementRef, inject } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({
  selector: 'x-card',
  imports: [Text, View],
  template: `
    <view class="card" testID="card" data-kind="a">
      <view class="row first"><text>One</text></view>
      <view class="row" id="second"><text>Two</text></view>
    </view>
  `,
})
class Card {
  readonly host: Dom = inject(ElementRef).nativeElement;
}

const mount = async () => {
  const app = await render(Card, { providers: [provideWebCompat()] });
  const host = app.instance.host;
  return { app, host, card: host.querySelector('.card') as Dom };
};

describe('@ng-native/web-compat nodes', () => {
  it('reads and writes attributes as props, and class as classes', async () => {
    const { card } = await mount();
    assert.equal(card.getAttribute('data-kind'), 'a');
    assert.equal(card.getAttribute('title'), null);
    assert.equal(card.hasAttribute('data-kind'), true);
    assert.equal(card.getAttribute('class'), 'card');

    card.setAttribute('testID', 'renamed');
    card.setAttribute('aria-hidden', 'false');
    card.removeAttribute('data-kind');
    assert.ok(await screen.findByTestId('renamed'), 'committed through the engine');
    assert.equal(card.props['aria-hidden'], false, 'a typed prop is not left a string');
    assert.equal(card.hasAttribute('data-kind'), false);

    card.classList.add('on');
    assert.equal(card.classList.contains('on'), true);
    assert.equal(card.className, 'card on');
    assert.equal(card.classList.toggle('on'), false);
    card.className = 'a b';
    assert.deepEqual([...card.classList], ['a', 'b']);
  });

  it('walks the tree and matches selectors', async () => {
    const { host, card } = await mount();
    const [first, second] = card.querySelectorAll('.row');
    assert.equal(host.querySelector('#second'), second);
    assert.equal(host.querySelector('view.row.first'), first);
    assert.equal(host.querySelector('[data-kind="a"] .row'), first);
    assert.equal(host.querySelector('[data-kind="b"] .row'), null);
    assert.equal(second.closest('.card'), card);
    assert.equal(second.matches('.row, .other'), true);
    assert.equal(second.id, 'second');
    assert.equal(second.getAttribute('id'), 'second');
    assert.equal(host.querySelector('[id=second]'), second);
    assert.equal(card.contains(second), true);
    assert.equal(second.contains(card), false);
    assert.equal(first.parentElement, card);
    assert.equal(card.firstElementChild, first);
    assert.equal(first.nextSibling, second);
    assert.equal(second.previousSibling, first);
    assert.equal(card.textContent, 'OneTwo');
    assert.equal(first.isConnected, true);
    assert.equal(first.nodeType, 1);
    assert.equal(first.localName, 'view');
  });

  it('moves and removes nodes through the engine', async () => {
    const { card } = await mount();
    const [first, second] = card.querySelectorAll('.row');
    card.appendChild(first);
    assert.deepEqual(card.querySelectorAll('.row'), [second, first]);
    card.insertBefore(first, second);
    assert.equal(card.firstElementChild, first);
    second.remove();
    assert.equal(second.isConnected, false);
    await settle();
    assert.equal(screen.queryByText('Two'), null, 'and the commit follows');
  });

  it('sets inline styles and custom properties', async () => {
    const { card } = await mount();
    card.style.opacity = '0.5';
    card.style.setProperty('margin-top', '4px');
    assert.equal(card.style.opacity, 0.5);
    assert.equal(card.style.getPropertyValue('margin-top'), '4');
    await settle();
    const view = screen.getByTestId('card');
    assert.equal(view.props['opacity'], 0.5);
    assert.equal(view.props['marginTop'], 4);
    card.style.removeProperty('margin-top');
    assert.equal(card.style.marginTop, '');
  });

  it('adds and removes a listener', async () => {
    const { card } = await mount();
    let heard = 0;
    const listener = () => heard++;
    card.addEventListener('layout', listener);
    await fireEvent.layout(screen.getByTestId('card'), { width: 1, height: 1 });
    assert.equal(heard, 1);
    card.removeEventListener('layout', listener);
    await fireEvent.layout(screen.getByTestId('card'), { width: 2, height: 2 });
    assert.equal(heard, 1);
  });

  it('leaves a click to core, which listens for the touch a defer trigger does', async () => {
    const { card } = await mount();
    const listener = () => {};
    card.addEventListener('click', listener);
    assert.deepEqual([...card.listeners.keys()], ['topTouchEnd']);
    card.removeEventListener('click', listener);
    assert.equal(card.listeners.get('topTouchEnd').size, 0);
  });

  it('is gone with the app that asked for it, and absent from one that did not', async () => {
    const { host } = await mount();
    assert.equal(typeof host.getAttribute, 'function');
    cleanup();
    assert.equal(host.getAttribute, undefined);

    const plain = await render(Card);
    assert.equal(plain.instance.host.getAttribute, undefined);
  });

  it('stays while any app that asked for it is up', async () => {
    const one = await render(Card, { providers: [provideWebCompat()] });
    const two = await render(Card, { providers: [provideWebCompat()] });
    one.unmount();
    assert.equal(typeof two.instance.host.getAttribute, 'function');
  });
});
