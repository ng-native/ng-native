/**
 * `element.style` as a declaration block: what a `style` attribute or a script declared, read
 * back in the form the CSSOM writes it, and the attribute kept as that block's text.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';
import { engineOf } from './window.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page"></div>` })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const element = async (): Promise<Dom> => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  return app.fixture.componentInstance.document.createElement('div');
};

describe('element.style', () => {
  it('reads what a style attribute declared, by either spelling of a name', async () => {
    const div = await element();
    div.setAttribute('style', 'background-position: 5% 5%; COLOR: red');
    assert.equal(div.style.backgroundPosition, '5% 5%');
    assert.equal(div.style.getPropertyValue('color'), 'red');
    assert.equal(div.getAttribute('style'), 'background-position: 5% 5%; COLOR: red');
    // A shorthand is declared as its longhands.
    assert.equal(div.style.length, 3);
    assert.equal(div.style[0], 'background-position-x');
    assert.equal(div.style.item(2), 'color');
  });

  it('applies what a style attribute declared to the view', async () => {
    const div = await element();
    div.setAttribute('style', 'width: 10px; opacity: 0.5');
    assert.equal(div.props.style.width, 10);
    assert.equal(div.props.style.opacity, 0.5);
    div.setAttribute('style', 'opacity: 1');
    assert.equal(div.props.style.width, undefined, 'what the attribute no longer says is gone');
    div.removeAttribute('style');
    assert.equal(div.props.style.opacity, undefined);
    assert.equal(div.style.opacity, '');
    assert.equal(div.getAttribute('style'), null);
  });

  it('sets a shadow a script wrote as the list a view reads, which Android throws on as text', async () => {
    const div = await element();
    div.style.boxShadow = '0 0 15px rgba(0,0,0,0.3)';
    assert.deepEqual(div.props.style.boxShadow, [
      { offsetX: 0, offsetY: 0, blurRadius: 15, color: 'rgba(0,0,0,0.3)' },
    ]);
    div.style.boxShadow = 'inset 1px 2px 3px 4px red, 0 1px 2px blue';
    assert.deepEqual(div.props.style.boxShadow, [
      { offsetX: 1, offsetY: 2, blurRadius: 3, spreadDistance: 4, color: 'red', inset: true },
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: 'blue' },
    ]);
    div.style.boxShadow = 'none';
    assert.equal(div.props.style.boxShadow ?? null, null);
    div.style.boxShadow = '1px 1px red';
    div.style.removeProperty('box-shadow');
    assert.equal(div.props.style.boxShadow, undefined, 'what the style no longer says is gone');
  });

  it('writes a value as the CSSOM serialises it', async () => {
    const div = await element();
    const cases: [string, string, string][] = [
      ['width', '.1em', '0.1em'],
      ['left', '-.5%', '-0.5%'],
      ['left', '-0px', '0px'],
      ['line-height', '-0', '0'],
      ['background-image', 'url(http://localhost/)', 'url("http://localhost/")'],
      ['content', "'string'", '"string"'],
      ['content', 'counter(par-num, decimal)', 'counter(par-num)'],
      ['content', 'attr( |foo ,  "" )', 'attr( |foo ,  "" )'],
      ['font-family', "'Lucida Grande'", 'Lucida Grande'],
      ['color', 'rgba(5,7,10,  0.5)', 'rgba(5, 7, 10, 0.5)'],
      ['clip', 'rect(1em, auto, 0.5px, 2000em)', 'rect(1em, auto, 0.5px, 2000em)'],
    ];
    for (const [name, written, read] of cases) {
      div.setAttribute('style', `${name}: ${written}`);
      assert.equal(
        div.style.getPropertyValue(name),
        read,
        `${name}: ${written} from the attribute`,
      );
      div.setAttribute('style', '');
      div.style.setProperty(name, written);
      assert.equal(div.style.getPropertyValue(name), read, `${name}: ${written} set`);
    }
  });

  it('passes over a value a property with keywords alone cannot take', async () => {
    const div = await element();
    div.style.scrollBehavior = 'smooth';
    div.style.scrollBehavior = 'auto smooth';
    assert.equal(div.style.scrollBehavior, 'smooth');
    div.style.scrollBehavior = 'INHERIT';
    assert.equal(div.style.scrollBehavior, 'inherit');
  });

  it('keeps the attribute as the text of what a script declared', async () => {
    const div = await element();
    assert.equal(div.hasAttribute('style'), false);
    div.style.color = 'red';
    div.style.setProperty('margin-top', '2px', 'important');
    assert.equal(div.getAttribute('style'), 'color: red; margin-top: 2px !important;');
    assert.equal(div.style.cssText, 'color: red; margin-top: 2px !important;');
    assert.equal(div.style.getPropertyPriority('margin-top'), 'important');
    assert.equal(div.style.removeProperty('color'), 'red');
    assert.equal(div.style.cssText, 'margin-top: 2px !important;');
    assert.ok(div.getAttributeNames().includes('style'));
    div.style.cssText = 'opacity: .25';
    assert.equal(div.style.opacity, '0.25');
    assert.equal(div.style.marginTop, '');
    assert.equal(div.props.style.marginTop, undefined);
  });

  it('reads the view again where something else changed what a script declared', async () => {
    const div = await element();
    div.style.width = '10px';
    // As a template's binding sets it, past `element.style`.
    engineOf(div).setProp(div, 'style', { ...div.props.style, width: 20 });
    assert.equal(String(div.style.width), '20');
  });

  it('is its cssText written whole, and has no declaration by a name that is no property', async () => {
    const div = await element();
    div.style = 'color: red; }width: 1px; {}height: 2px';
    assert.equal(div.style.cssText, 'color: red;');
    assert.equal(div.style, div.style);
    div.style.COLOR = 'blue';
    assert.equal(div.style.COLOR, 'blue');
    assert.equal(div.style.cssText, 'color: red;');
    assert.equal(div.style[1], undefined);
    div.style.setProperty('--x', undefined);
    assert.equal(div.style.getPropertyValue('--x'), 'undefined');
    assert.throws(() => (div.style.opacity = Symbol('1')), TypeError);
  });

  it('is copied with the element', async () => {
    const div = await element();
    div.setAttribute('style', 'color: red');
    const copy = div.cloneNode();
    copy.style.color = 'blue';
    assert.equal(div.style.color, 'red');
    assert.equal(copy.style.color, 'blue');
    assert.equal(copy.getAttribute('style'), 'color: blue;');
  });

  it('is told an observer each time its text is written, and not for what it does not take', async () => {
    const div = await element();
    const Observer = (globalThis as Dom).MutationObserver;
    const observer = new Observer(() => {});
    observer.observe(div, { attributes: true });
    div.style.cssText = 'z-index: 1';
    div.style.cssText = 'z-index: 1';
    div.style.setProperty('z-index', 'bogus');
    div.style.setProperty('z-index', '1');
    assert.equal(observer.takeRecords().length, 2);
    observer.disconnect();
  });
});

describe('a transition a script writes', () => {
  const EASE = [0.25, 0.1, 0.25, 1];

  it('is the spec the engine runs, keyed by the props each property sets', async () => {
    const div = await element();
    div.style.transition = 'left 1s ease-in 50ms, opacity 2s';
    assert.deepEqual(div.props.style.$transition, {
      left: { duration: 1000, delay: 50, easing: [0.42, 0, 1, 1] },
      opacity: { duration: 2000, delay: 0, easing: EASE },
    });
    assert.equal(div.props.style.transition, undefined);
    div.style.transition = 'margin 200ms linear';
    assert.deepEqual(Object.keys(div.props.style.$transition).sort(), [
      'marginBottom',
      'marginLeft',
      'marginRight',
      'marginTop',
    ]);
    div.style.transition = 'all 1s cubic-bezier(0.4, 0, 0.2, 1)';
    assert.deepEqual(div.props.style.$transition, {
      all: { duration: 1000, delay: 0, easing: [0.4, 0, 0.2, 1] },
    });
    div.style.transition = 'background-color .3s';
    assert.deepEqual(Object.keys(div.props.style.$transition), ['backgroundColor']);
    div.style.transition = 'none';
    assert.deepEqual(div.props.style.$transition, {});
  });

  it('leaves the margin a calc() inset is carried by to be taken away later', async () => {
    const div = await element();
    div.style.left = 'calc(50% + 10px)';
    assert.equal(div.props.style.marginLeft, 10);
    div.style.transition = 'left 1s';
    div.style.left = '5px';
    assert.equal(div.props.style.marginLeft ?? null, null);
  });

  it('is its longhands, the timing laid over the properties as the engine lays it', async () => {
    const div = await element();
    div.setAttribute(
      'style',
      'transition-property: transform, opacity; transition-duration: 200ms; transition-timing-function: linear',
    );
    assert.deepEqual(div.props.style.$transition, {
      transform: { duration: 0, delay: 0, easing: EASE },
      opacity: { duration: 0, delay: 0, easing: EASE },
    });
    assert.equal(div.props.style.$transitionDuration, 200);
    assert.deepEqual(div.props.style.$transitionEasing, [0, 0, 1, 1]);
  });

  it('runs, from where it was to what it is set to', async () => {
    let now = 1000;
    const app = await render(Page, { providers: [provideWebCompat()], now: () => now });
    await settle();
    const engine = app.componentRef.injector.get(Engine);
    const tick = (ms: number) => {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    };
    const document: Dom = app.fixture.componentInstance.document;
    const item = document.getElementById('page').appendChild(document.createElement('div'));
    item.style.cssText = 'position: absolute; left: 0px; transition: left 1000ms linear';
    await settle();
    // A view no frame has shown yet starts nothing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      item.style.left = '400px';
      engine.commit();
      tick(500);
      assert.equal(Math.round(item.committed.props.left), 200);
    } finally {
      // Run out, so no frame waits on a clock that no longer moves.
      tick(10_000);
    }
  });
});
