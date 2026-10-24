/**
 * `getComputedStyle` as a browser answers it: values written as computed ones are, what is not
 * set inherited or initial, shorthands, the declaration's own members, and read only.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  selector: 'x-styled',
  styles: `
    .box {
      color: red;
      padding: 4px 8px;
      font-size: 10px;
      pointer-events: none;
      z-index: 3 !important;
      --gap: 3px;
      --tone: blue;
      --accent: platform-color(link, '?attr/colorAccent');
    }
  `,
  template: `<div id="box" class="box"><span id="in">x</span></div>`,
})
class Styled {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const styled = async () => {
  const app = await render(Styled, { providers: [provideWebCompat()] });
  await settle();
  const document = app.fixture.componentInstance.document;
  return { box: document.getElementById('box'), inner: document.getElementById('in') };
};
const computed = (node: unknown, pseudo?: string): Dom =>
  (
    globalThis as unknown as { getComputedStyle(node: unknown, pseudo?: string): Dom }
  ).getComputedStyle(node, pseudo);

describe('getComputedStyle', () => {
  it('writes colours as rgb() and rgba(), and lengths in pixels', async () => {
    const { box } = await styled();
    box.style.backgroundColor = '#0000ff80';
    box.style.width = '50px';
    box.style.marginLeft = '2em';
    const style = computed(box);
    assert.equal(
      [style.color, style.backgroundColor, style.width, style.marginLeft].join(' | '),
      'rgb(255, 0, 0) | rgba(0, 0, 255, 0.5) | 50px | 20px',
    );
    box.style.backgroundColor = '';
    assert.equal(computed(box).backgroundColor, 'rgba(0, 0, 0, 0)');
  });

  it('follows an inherited property up to where it is set, and gives the rest their initial values', async () => {
    const { box, inner } = await styled();
    box.style.visibility = 'hidden';
    box.style.opacity = '0.5';
    const style = computed(inner);
    assert.equal(
      [style.color, style.pointerEvents, style.visibility, style.opacity, style.position].join(' '),
      'rgb(255, 0, 0) none hidden 1 static',
    );
  });

  it('works a font size in em out from the one it is in, not its own', async () => {
    // Highcharts writes an HTML label 0.7em and reads its size back.
    const { box, inner } = await styled();
    box.style.fontSize = '20px';
    inner.style.fontSize = '0.7em';
    assert.equal(computed(inner).fontSize, '14px');
  });

  it('reads a property by its dashed name, and a shorthand as few values as say it', async () => {
    const { box } = await styled();
    const style = computed(box);
    assert.equal(
      [
        style.getPropertyValue('padding-left'),
        style.getPropertyValue('padding'),
        style.padding,
        style.getPropertyValue('margin'),
        style.getPropertyValue('PADDING-TOP'),
        style.getPropertyValue('no-such-property'),
      ].join(' | '),
      '8px | 4px 8px | 4px 8px | 0px | 4px | ',
    );
  });

  it('is live: a rule a script changed after it was asked for is read', async () => {
    const { box } = await styled();
    const style = computed(box);
    assert.equal(style.opacity, '1');
    const sheet = box.ownerDocument.createElement('style');
    sheet.textContent = '.other { opacity: 0.5 }';
    box.ownerDocument.head.appendChild(sheet);
    assert.equal(style.opacity, '1');
    sheet.sheet.cssRules[0].selectorText = '#box';
    assert.equal(style.opacity, '0.5');
  });

  it('answers a rule declared important over the inline style', async () => {
    const { box } = await styled();
    box.setAttribute('style', 'z-index: 7; padding-top: 1px');
    const style = computed(box);
    assert.equal([style.zIndex, style.paddingTop].join(' | '), '3 | 1px');
  });

  it('resolves currentcolor and a line height of no unit to what is used', async () => {
    const { box } = await styled();
    box.style.lineHeight = '2';
    box.style.border = '1px solid currentcolor';
    const style = computed(box);
    assert.equal(
      [style.borderTopColor, style.lineHeight, style.getPropertyValue('border-top')].join(' | '),
      'rgb(255, 0, 0) | 20px | 1px solid rgb(255, 0, 0)',
    );
  });

  it('has a property for each name it answers, dashed or not, shorthands too', async () => {
    const { box } = await styled();
    const style = computed(box);
    assert.equal(
      ['border-top', 'font', 'margin-top', 'marginTop', 'width'].every((name) => name in style),
      true,
    );
    assert.equal('no-such-property' in style, false);
    assert.equal(style['padding-left'], '8px');
    assert.equal(Array.from(style as ArrayLike<string>).includes('border-top'), false);
  });

  it('reads a custom property a rule set, on the element and on what it holds', async () => {
    const { box, inner } = await styled();
    assert.equal(computed(box).getPropertyValue('--gap'), '3px');
    assert.equal(computed(inner).getPropertyValue('--tone'), 'blue');
    assert.equal(computed(box).getPropertyValue('--none'), '');
    // A colour the platform resolves, as the call that names it.
    assert.equal(
      computed(box).getPropertyValue('--accent'),
      'platform-color(link, "?attr/colorAccent")',
    );
  });

  it('lists its properties by index, and has no text and no priorities', async () => {
    const { box } = await styled();
    const style = computed(box);
    assert.ok(style.length > 50);
    assert.equal(style[0], style.item(0));
    assert.match(style.item(0), /^[a-z-]+$/);
    assert.equal(style.item(style.length), '');
    assert.equal(style.cssText + '|' + style.getPropertyPriority('color'), '|');
  });

  it('cannot be changed', async () => {
    const { box } = await styled();
    const style = computed(box);
    for (const change of [
      () => style.setProperty('color', 'blue'),
      () => style.removeProperty('color'),
      () => (style.color = 'blue'),
      () => (style.cssText = 'color: blue'),
    ]) {
      assert.throws(change, { name: 'NoModificationAllowedError' });
    }
    assert.equal(computed(box).color, 'rgb(255, 0, 0)');
  });

  it('answers no declarations for an element in no tree', async () => {
    const { box } = await styled();
    const detached = box.ownerDocument.createElement('div');
    detached.style.color = 'red';
    assert.equal(computed(detached).length + '|' + computed(detached).color, '0|');
  });

  it('answers no declarations for a pseudo-element that is none, and what one would inherit for one not there', async () => {
    const { box } = await styled();
    assert.equal(computed(box, '::nonsense').length, 0);
    const before = computed(box, '::before');
    assert.equal(before.color + ' ' + before.paddingLeft, 'rgb(255, 0, 0) 0px');
  });

  it('reads a pseudo-element by its name as CSS reads one, with nothing after it', async () => {
    const { box } = await styled();
    assert.equal(computed(box, ':bef\\oRE').length > 0, true);
    for (const asked of ['::before ', '::before,', '::before0', '::"before"']) {
      assert.equal(computed(box, asked).length, 0, asked);
    }
  });

  it('gives a box a <style> made while the app runs draws, its content as a string', async () => {
    const { box } = await styled();
    const style = box.ownerDocument.createElement('style');
    style.textContent =
      '#box::after { content: "Foo"; display: inline-block } #box { display: flex }';
    box.ownerDocument.head.appendChild(style);
    await settle();
    const after = computed(box, '::after');
    assert.equal(after.content, '"Foo"');
    // An item of a flex container is a block.
    assert.equal(after.display, 'block');
    assert.equal(computed(box, '::before').display, 'block');
  });

  it('answers a minimum of auto as none outside a flex box, and auto in one', async () => {
    const { box, inner } = await styled();
    assert.equal(computed(inner).minWidth, '0px');
    assert.equal(computed(inner).minHeight, '0px');
    box.style.display = 'flex';
    assert.equal(computed(inner).minWidth, 'auto');
    // One of its own is what it is.
    inner.style.minWidth = '4px';
    assert.equal(computed(inner).minWidth, '4px');
  });

  it('reads a logical property as its physical one, and a system colour as the one drawn', async () => {
    const { box } = await styled();
    box.style.marginLeft = '3px';
    box.style.width = '20px';
    box.style.borderTopColor = 'rgb(1, 2, 3)';
    const style = computed(box);
    assert.equal(style.marginInlineStart, '3px');
    assert.equal(style.getPropertyValue('inline-size'), '20px');
    assert.equal(style.borderBlockStartColor, 'rgb(1, 2, 3)');
    box.style.direction = 'rtl';
    assert.equal(computed(box).marginInlineEnd, '3px');
    box.style.color = 'Menu';
    assert.equal(computed(box).color, 'rgb(255, 255, 255)');
    assert.equal([...computed(box)].length, computed(box).length);
    box.style.color = 'inherit';
    box.style.visibility = 'unset';
    assert.equal(computed(box).color, computed(box.parentNode).color);
    assert.equal(computed(box).visibility, 'visible');
  });
});
