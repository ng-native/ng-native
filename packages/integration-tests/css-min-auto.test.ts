/**
 * `min-width: auto` and `min-height: auto`: a flex item that shrinks stops at its content. A
 * browser gives every flex item this, which is why an icon in a crowded row keeps its size and
 * the text beside it gives way. Yoga's minimum is nothing, so an item that may shrink is
 * squashed under its content. The engine keeps an item from shrinking where its content cannot
 * get smaller: down a column, and along a row when no text inside it has anywhere to wrap.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

type Spec = [name: string, ...children: Spec[]];

function scene(css: string, spec: Spec) {
  const fabric = createLaidOutFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const nodes = new Map<string, EngineNode>();
  const build = ([name, ...children]: Spec, parent: EngineNode): void => {
    const node = engine.createElement('view');
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) build(child, node);
  };
  build(spec, engine.root);
  const box = (name: string) => {
    engine.commit();
    const { left, top, width, height } = fabric.box(name);
    return [left, top, width, height];
  };
  /** Text in a box: ten points a character, twenty a line. */
  const say = (name: string, words: string) => {
    const text = engine.createElement('text');
    engine.appendChild(text, engine.createText(words));
    engine.appendChild(nodes.get(name)!, text);
    return text;
  };
  return { engine, nodes, box, say };
}

const ROW =
  '.row { display: flex; flex-direction: row; width: 100px } .item { flex-shrink: 1 } .auto { min-width: auto; min-height: auto } .icon { width: 80px; height: 40px }';
const TWO: Spec = ['row', ['item auto', ['icon']], ['item auto b', ['icon b']]];

describe('a flex item with an automatic minimum size', () => {
  it('is squashed under its content without one, as Yoga squashes it', () => {
    const s = scene(ROW, ['row', ['item', ['icon']], ['item b', ['icon b']]]);
    assert.deepEqual(s.box('item b'), [50, 0, 50, 40]);
  });

  it('keeps to its content along a row when nothing in it can wrap', () => {
    const s = scene(ROW, TWO);
    assert.deepEqual(s.box('item auto'), [0, 0, 80, 40]);
    assert.deepEqual(s.box('item auto b'), [80, 0, 80, 40]);
  });

  it('keeps to its content down a column', () => {
    const css = `${ROW} .col { display: flex; flex-direction: column; height: 50px; width: 100px }`;
    const s = scene(css, ['col', ['item auto', ['icon']], ['item auto b', ['icon b']]]);
    assert.deepEqual(s.box('item auto b'), [0, 40, 100, 40]);
  });

  it('shrinks when it clips its content, whose size is then not its minimum', () => {
    const s = scene(`${ROW} .item { overflow: hidden }`, TWO);
    assert.deepEqual(s.box('item auto b'), [50, 0, 50, 40]);
  });

  it('shrinks when its minimum is written as nothing', () => {
    const s = scene(`${ROW} .b { min-width: 0 }`, TWO);
    assert.deepEqual(s.box('item auto b'), [80, 0, 20, 40]);
  });

  it('shrinks while text in it has somewhere to wrap, and not once it has none', () => {
    const css = ROW.replace('width: 100px', 'width: 150px');
    const s = scene(css, ['row', ['item auto'], ['item auto b']]);
    s.say('item auto', 'ninechars');
    const words = s.say('item auto b', 'four five');
    // Nine characters with nowhere to wrap are kept, and the words beside them give way.
    assert.deepEqual(s.box('item auto'), [0, 0, 90, 40]);
    assert.deepEqual(s.box('item auto b'), [90, 0, 60, 40]);
    s.engine.removeChild(s.nodes.get('item auto b')!, words);
    s.say('item auto b', 'fourfives');
    assert.deepEqual(s.box('item auto b'), [90, 0, 90, 20]);
  });

  it('follows its container turning from a row into a column', () => {
    const s = scene(ROW, ['row', ['item auto'], ['item auto b']]);
    s.say('item auto', 'four five six');
    s.say('item auto b', 'four five six');
    assert.equal(s.box('item auto b')[2], 50);
    // A bound style, which is the container's alone: no class its items could be matched by.
    s.engine.setProp(s.nodes.get('row')!, 'style', { flexDirection: 'column', height: 50 });
    // Two lines of text each: forty points of the column's fifty, and neither is squashed.
    assert.deepEqual(s.box('item auto b'), [0, 40, 100, 40]);
    s.engine.setProp(s.nodes.get('row')!, 'style', null);
    assert.equal(s.box('item auto b')[2], 50);
  });
});

describe('an item of a row whose content is a line of boxes', () => {
  // Two buttons side by side in each of two groups: a browser breaks the line between the
  // buttons where the row has no room for both groups, and so the groups give way.
  const CSS =
    '.row { display: flex; flex-direction: row; width: 100px }' +
    ' .item { display: block; flex-shrink: 1; min-width: auto }' +
    ' .i { display: inline-block; width: 40px; height: 20px }';

  const wide = (s: ReturnType<typeof scene>, name: string) => s.box(name)[2];

  it('gives way to where its line breaks between two of them', () => {
    const s = scene(CSS, ['row', ['item', ['i'], ['i two']], ['item b', ['i three'], ['i four']]]);
    assert.deepEqual([wide(s, 'item'), wide(s, 'item b')], [50, 50]);
    // The second box of each is under the first, on a line of its own.
    const [left, top] = s.box('i two');
    assert.equal(left, 0);
    assert.ok(top! >= 20, String(top));
  });

  it('keeps its width where its line is one box, which has nowhere to break', () => {
    const one: Spec = ['row', ['item', ['i wide']], ['item b', ['i wide b']]];
    const s = scene(CSS + ' .wide { width: 80px }', one);
    assert.deepEqual([wide(s, 'item'), wide(s, 'item b')], [80, 80]);
  });
});
