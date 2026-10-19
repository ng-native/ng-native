/**
 * A declaration block as a script reads and writes it: shorthands set as their longhands and
 * written back as few declarations as say them, values the property takes and no others, and
 * every property an attribute on the prototype. Read through a rule of a sheet a script made.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './index.ts';
import * as cssom from './css-style-sheet.ts';
import { matchesGrammar, partsOf } from './css-grammar.ts';
import { LONGHANDS, PAGE_DESCRIPTORS } from './css-properties.ts';

/** What a library sees: loosely typed, as its own code would be. */
type Dom = any;

/** The style of a rule that declares some text. */
function styleOf(text: string, rule = 'p'): Dom {
  const sheet = new cssom.CSSStyleSheet();
  sheet.insertRule(`${rule} { ${text} }`);
  return (sheet.cssRules[0] as Dom).style;
}

/** A block's text after it is read. */
const written = (text: string): string => styleOf(text).cssText;

describe('a shorthand', () => {
  it('is set as its longhands, and written back as few declarations as say them', () => {
    const cases: [string, string][] = [
      [
        'margin-top: 1px; margin-right: 2px; margin-bottom: 3px; margin-left: 4px',
        'margin: 1px 2px 3px 4px;',
      ],
      ['margin: 20px 20px 20px 20px', 'margin: 20px;'],
      ['padding: 1px 2px', 'padding: 1px 2px;'],
      ['overflow-x: scroll; overflow-y: hidden', 'overflow: scroll hidden;'],
      ['overflow-x: initial; overflow-y: initial', 'overflow: initial;'],
      [
        'outline-width: 2px; outline-style: dotted; outline-color: blue',
        'outline: blue dotted 2px;',
      ],
      [
        'list-style-type: circle; list-style-position: inside; list-style-image: none',
        'list-style: inside circle;',
      ],
      ['border: 1px; border-top: 1px', 'border: 1px;'],
      ['border: solid; border-style: dotted', 'border: dotted;'],
      [
        'border: 1px; border-top: 2px',
        'border-width: 2px 1px 1px; border-style: none; border-color: currentcolor; border-image: none;',
      ],
      [
        'border: 1px; border-top: 1px !important',
        'border-right: 1px; border-bottom: 1px; border-left: 1px; border-image: none; border-top: 1px !important;',
      ],
      ['border-radius: 1px 2px / 3px', 'border-radius: 1px 2px / 3px;'],
      ['flex: 0', 'flex: 0 1 0px;'],
      ['flex: initial; flex-shrink: 0', 'flex-grow: initial; flex-basis: initial; flex-shrink: 0;'],
      ['flex: none', 'flex: none;'],
      ['font: bold 4px sans-serif', 'font: bold 4px sans-serif;'],
      ['font: 10px/1 Ahem', 'font: 10px / 1 Ahem;'],
      [
        'background: url(a.png) 10px 20px / 30px 40px no-repeat red',
        'background: url("a.png") 10px 20px / 30px 40px no-repeat red;',
      ],
      ['border-image: url(a.png) 30 / 2 round', 'border-image: url("a.png") 30 / 2 round;'],
      ['page-break-after: always', 'break-after: page;'],
    ];
    for (const [text, read] of cases) assert.equal(written(text), read, text);
  });

  it('is read from its longhands, and none where they say nothing it can say', () => {
    const style = styleOf('background-position: top; margin: 1px; margin-left: 2px !important');
    assert.equal(style.backgroundPositionX, 'center');
    assert.equal(style.backgroundPosition, 'center top');
    assert.equal(style.margin, '');
    assert.equal(style.marginRight, '1px');
    assert.equal(style.getPropertyValue('page-break-after'), '');
    style.breakAfter = 'page';
    assert.equal(style.getPropertyValue('page-break-after'), 'always');
  });

  it('waits on a var() as a whole, which no longhand of it says', () => {
    const style = styleOf('border: 1px solid var(--colour); background: var(--a)');
    assert.equal(style.border, '1px solid var(--colour)');
    assert.equal(style.borderTopWidth, '');
    assert.equal(style.backgroundPosition, '');
    assert.equal(style.cssText, 'border: 1px solid var(--colour); background: var(--a);');
  });

  it('of every property is a keyword they all take', () => {
    const style = styleOf('width: 50px; all: revert');
    assert.equal(style.width, 'revert');
    assert.equal(style.all, 'revert');
    assert.equal(style.cssText, 'all: revert;');
    style.width = '1px';
    assert.equal(style.all, '');
    style.removeProperty('all');
    assert.equal(style.length, 0);
    style.cssText = 'direction: ltr; all: inherit; unicode-bidi: plaintext';
    assert.equal(style.cssText, 'direction: ltr; all: inherit; unicode-bidi: plaintext;');
  });

  it('is not written where another of its logical group is between its longhands', () => {
    assert.equal(
      written(
        'margin: 10px; margin-inline: 10px; margin-block: 10px; margin-inline-end: 10px; margin-bottom: 10px',
      ),
      'margin-top: 10px; margin-right: 10px; margin-left: 10px; margin-inline-start: 10px; margin-block: 10px; margin-inline-end: 10px; margin-bottom: 10px;',
    );
    const style = styleOf('padding-top: 1px; padding-block-start: 2px');
    style.setProperty('padding-top', '1px');
    assert.deepEqual([...style], ['padding-block-start', 'padding-top']);
  });
});

describe('a declaration', () => {
  it('is only of a property that there is, with a value it takes', () => {
    assert.equal(
      written('color: red; unknown: x; color: unknown color; width: -1px'),
      'color: red;',
    );
    const set = styleOf('');
    set.cssText = '@foo{}z-index: 1; }color: red; --a\\;b: value';
    assert.equal(set.cssText, 'z-index: 1; --a\\;b: value;');
    assert.equal(styleOf('--a\\;b: value')[0], '--a;b');
    const style = styleOf('');
    style.setProperty('width', '0');
    assert.equal(style.width, '0px');
    style.setProperty('width', 'bogus');
    assert.equal(style.width, '0px');
    style.setProperty('color', 'red', 'IMPORTANT');
    assert.equal(style.getPropertyPriority('color'), 'important');
    style.setProperty('color', 'blue', null);
    assert.equal(style.color, 'blue');
    style.setProperty('-webkit-transform', 'none');
    assert.equal(style.transform, 'none');
    assert.equal(style.webkitTransform, 'none');
  });

  it('writes a colour as a browser writes one back', () => {
    const style = styleOf('');
    const cases: [string, string][] = [
      ['RED', 'red'],
      ['CanvasText', 'canvastext'],
      ['#008000', 'rgb(0, 128, 0)'],
      ['rgb(0 128 0 / 1)', 'rgb(0, 128, 0)'],
      ['rgb(0%, 100%, 100%)', 'rgb(0, 255, 255)'],
      ['hsl(0, 100%, 50%)', 'rgb(255, 0, 0)'],
      ['#ff000080', 'rgba(255, 0, 0, 0.5)'],
      ['oklch(0.5 0.1 120)', 'oklch(0.5 0.1 120)'],
      ['oklch(76% 0.23 150)', 'oklch(0.76 0.23 150)'],
    ];
    for (const [given, read] of cases) {
      style.color = given;
      assert.equal(style.color, read, given);
    }
    style.color = 'rgb(0, 100%, 100%)';
    assert.equal(style.color, 'oklch(0.76 0.23 150)');
    style.color = 'mar\u212A';
    assert.equal(style.color, 'oklch(0.76 0.23 150)');
    style.backgroundRepeat = 'repeat repeat, repeat no-repeat';
    assert.equal(style.backgroundRepeat, 'repeat, repeat-x');
  });

  it('is each an attribute on the prototype, and each a place in the list', () => {
    const style = styleOf('padding: 1px');
    assert.equal(style instanceof cssom.CSSStyleDeclaration, true);
    assert.equal(Object.hasOwn(style, 'color'), false);
    assert.equal('color' in style && 'background-color' in style && 'cssFloat' in style, true);
    assert.equal(style[0], 'padding-top');
    assert.equal(0 in style, true);
    assert.equal(Object.keys(style).length, 4);
    assert.deepEqual([...style].length, 4);
    style.cssText = 'color: red';
    assert.equal(1 in style, false);
  });

  it('of @page is one of its descriptors, and of a keyframe no animation of its own', () => {
    const sheet = new cssom.CSSStyleSheet();
    sheet.replaceSync(
      '@page { margin: 1em 24px; size: a3; transform: scale(1) } @keyframes k { from { margin-top: 1px; animation-name: x } }',
    );
    const page = (sheet.cssRules[0] as Dom).style;
    assert.equal(Object.hasOwn(Object.getPrototypeOf(page), 'marginLeft'), true);
    assert.equal(page.length, 5);
    assert.equal(page.marginLeft, '24px');
    page.size = 'notarealsize';
    assert.equal(page.size, 'a3');
    page.setProperty('float', 'left');
    assert.equal(page.cssFloat, undefined);
    const frame = (sheet.cssRules[1] as Dom).cssRules[0].style;
    assert.equal(frame.length, 1);
    frame.setProperty('margin-top', '2px', 'important');
    assert.equal(frame.marginTop, '1px');
  });
});

describe('the grammars', () => {
  it('each read, and each take a CSS-wide keyword no more than the text says', () => {
    for (const [name, grammar] of [...LONGHANDS, ...PAGE_DESCRIPTORS]) {
      if (grammar) assert.equal(matchesGrammar(grammar, partsOf('inherit')), false, name);
    }
  });
});
