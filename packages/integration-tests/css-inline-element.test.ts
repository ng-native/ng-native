/**
 * An element a browser lays out inline: a custom element, which has no display of its own. With
 * only text and inline-level boxes in it, it sits in a line and is as wide as what it holds;
 * holding a block, it is laid out as one, since a block cannot sit in a line. The engine is
 * told which elements these are (`setInline`), by a package that gives elements a browser's
 * defaults, and settles which of the two each is from what it holds.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS =
  '.page { display: block; width: 300px } .pill { display: inline-flex; width: 50px; height: 20px } ' +
  '.block { display: block; height: 10px }';

function scene() {
  const fabric = createLaidOutFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const element = (
    classes: string,
    parent: EngineNode,
    inline?: 'always' | 'unless-block',
    name = 'view',
  ) => {
    const node = engine.createElement(name);
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    if (inline) engine.setInline(node, inline);
    engine.appendChild(parent, node);
    return node;
  };
  const page = element('page', engine.root);
  const box = (name: string) => {
    engine.commit();
    const { left, top, width, height } = fabric.box(name);
    return [left, top, width, height];
  };
  return { engine, element, page, box };
}

describe('an element that is inline in a browser', () => {
  it('sits in a line beside the next, each as wide as the inline boxes it holds', () => {
    const s = scene();
    s.element('pill one', s.element('radio one', s.page, 'unless-block'));
    s.element('pill two', s.element('radio two', s.page, 'unless-block'));
    // Each is a line of its own inside, with its font's descent under a box with no text.
    const [one, two] = [s.box('radio one'), s.box('radio two')];
    assert.deepEqual([one[0], one[2], two[0], two[2]], [0, 50, 50, 50]);
    assert.equal(one[1], two[1]);
  });

  it('is laid out as a block where it holds one, filling the width under the last', () => {
    const s = scene();
    s.element('block', s.element('card one', s.page, 'unless-block'));
    s.element('block two', s.element('card two', s.page, 'unless-block'));
    assert.deepEqual(s.box('card one'), [0, 0, 300, 10]);
    assert.deepEqual(s.box('card two'), [0, 10, 300, 10]);
  });

  it('follows what it holds: a block that comes makes it one, and it is inline again without it', () => {
    const s = scene();
    const host = s.element('host', s.page, 'unless-block');
    s.element('pill', host);
    assert.equal(s.box('host')[2], 50);
    const block = s.element('block', host);
    assert.equal(s.box('host')[2], 300);
    s.engine.removeChild(host, block);
    assert.equal(s.box('host')[2], 50);
  });

  it('counts an element that is always inline, and one inside another, as inline content', () => {
    const s = scene();
    const outer = s.element('outer', s.page, 'unless-block');
    const inner = s.element('inner', outer, 'unless-block');
    s.element('pill', inner);
    // A span with no display of its own: inline to what holds it, whatever it is laid out as.
    s.element('span', outer, 'always');
    assert.equal(s.box('outer')[2] < 300, true);
    s.element('block', inner);
    assert.equal(s.box('outer')[2], 300);
  });

  it('lays out what an always-inline element holds in a line, once it holds a box', () => {
    // A span around its words and an arrow after them: the two are one line, not a column.
    const s = scene();
    const label = s.element('label', s.page, 'always', 'span');
    s.element('pill one', label);
    s.element('pill two', label);
    const [one, two] = [s.box('pill one'), s.box('pill two')];
    assert.deepEqual([one[0], two[0]], [0, 50]);
    assert.equal(one[1], two[1]);
    assert.equal(s.box('label')[2], 100, 'and it is as wide as the two');
  });

  it('puts an always-inline element with no display in a line with the box beside it', () => {
    // Words in a span and an arrow after them, in a block: one line of the two.
    const s = scene();
    const words = s.element('words', s.page, 'always', 'span');
    s.engine.setProp(words, 'style', { width: 40, height: 20 });
    s.element('pill', s.page);
    const [first, second] = [s.box('words'), s.box('pill')];
    assert.deepEqual([first[0], second[0]], [0, 40]);
    assert.equal(first[1], second[1]);
  });

  it('leaves an always-inline element a display of its own, and one that holds no box', () => {
    const s = scene();
    const row = s.element('pill row', s.page, 'always');
    s.element('block', row);
    assert.equal(s.box('pill row')[2], 50, 'the stylesheet said inline-flex');
    const bare = s.element('bare', s.page, 'always', 'span');
    assert.equal(bare.defaultStyle, undefined);
    // A button is inline too, and stays the flex box it is: see `settleLine`.
    const button = s.element('button', s.page, 'always');
    s.element('pill in', button);
    s.element('pill in two', button);
    assert.equal(s.box('pill in two')[0], s.box('pill in')[0], 'one under the other');
  });

  it('keeps a display a stylesheet gives it', () => {
    const s = scene();
    const flex = s.element('pill wide', s.page, 'unless-block');
    s.element('block', flex);
    assert.deepEqual(s.box('pill wide').slice(2), [50, 20]);
  });
});

// Material's icon: a custom element its sheet makes an inline-block that clips, with the
// ligature's text in it. Chrome sits it on the baseline by its bottom edge, as any inline-block
// that clips, and the line is 28: the icon's 24 and the room under the baseline.
describe('a custom element its sheet makes an inline-block that clips', () => {
  it('sits on the baseline by its bottom edge', () => {
    const fabric = createLaidOutFabric('strict');
    const css =
      '.line { display: block; width: 300px; font-size: 16px }' +
      ' .icon { display: inline-block; overflow: hidden; width: 24px; height: 24px }';
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const line = engine.createElement('view');
    engine.setClasses(line, 'line');
    engine.setProp(line, 'nativeID', 'line');
    engine.appendChild(engine.root, line);
    const icon = engine.createElement('view');
    engine.setClasses(icon, 'icon');
    engine.setInline(icon, 'unless-block');
    engine.appendChild(line, icon);
    engine.appendChild(icon, engine.createText('home'));
    engine.commit();
    assert.ok(
      Math.abs(fabric.box('line').height - 27.84) < 0.5,
      `a line of ${fabric.box('line').height}`,
    );
  });
});
