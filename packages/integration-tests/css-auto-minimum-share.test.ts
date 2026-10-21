/**
 * `min-width: auto` on an item of a row that takes a share of it, `flex: 1`. A browser starts
 * the item at nothing and stops it at the narrowest its content goes: its longest word, or a
 * box in it with a width of its own. So a row of cards wraps where the cards cannot get any
 * narrower. Yoga has no such minimum, and squeezes them all onto one line. The engine commits
 * each such item as narrow as its content, a word to a line, reads that, and gives it to Yoga
 * as the item's minimum.
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
  /** Text in a box: ten points a character. */
  const say = (name: string, words: string): EngineNode => {
    const text = engine.createElement('text');
    const run = engine.createText(words);
    engine.appendChild(text, run);
    engine.appendChild(nodes.get(name)!, text);
    return run;
  };
  return { engine, fabric, nodes, box, say };
}

const ROW =
  '.row { display: flex; flex-direction: row; flex-wrap: wrap; width: 300px } ' +
  '.it { flex: 1 1 0%; min-width: auto; height: 20px } .w { width: 120px; height: 10px } ' +
  '.w.small { width: 60px } .nowrap { flex-wrap: nowrap }';
const THREE: Spec = ['row', ['it a', ['w']], ['it b', ['w w2']], ['it c', ['w w3']]];

describe('an item that takes a share of a wrapping row', () => {
  it('is no narrower than a box in it, so the row wraps where its items cannot fit', () => {
    const s = scene(ROW, THREE);
    // Two to the first line, each half of it, and the third on a line of its own.
    assert.deepEqual(s.box('it a'), [0, 0, 150, 20]);
    assert.deepEqual(s.box('it b'), [150, 0, 150, 20]);
    assert.deepEqual(s.box('it c'), [0, 20, 300, 20]);
  });

  it('is no narrower than its longest word, and wraps the rest of its text', () => {
    const s = scene(`${ROW} .it { height: auto }`, ['row', ['it a'], ['it b'], ['it c']]);
    for (const name of ['it a', 'it b', 'it c']) s.say(name, 'aa bbbbbbbbbbbb');
    // Twelve characters is 120 points: three of those are more than the row has.
    assert.equal(s.box('it a')[2], 150);
    assert.equal(s.box('it c')[0], 0);
    assert.equal(s.box('it c')[2], 300);
  });

  it('shares one line where what the items hold lets them', () => {
    const s = scene(ROW, ['row', ['it a', ['w small']], ['it b', ['w small w2']], ['it c']]);
    assert.deepEqual(s.box('it a'), [0, 0, 100, 20]);
    assert.deepEqual(s.box('it c'), [200, 0, 100, 20]);
  });

  it('follows what it holds getting narrower, and going', () => {
    const s = scene(ROW, THREE);
    assert.equal(s.box('it c')[1], 20);
    for (const name of ['w', 'w w2', 'w w3'])
      s.engine.setClasses(s.nodes.get(name)!, `${name} small`);
    assert.deepEqual(s.box('it c'), [200, 0, 100, 20]);
    for (const name of ['w', 'w w2', 'w w3']) s.engine.setClasses(s.nodes.get(name)!, name);
    assert.equal(s.box('it c')[1], 20);
    s.engine.removeChild(s.nodes.get('it c')!, s.nodes.get('w w3')!);
    assert.deepEqual(s.box('it c'), [240, 0, 60, 20]);
  });
});

describe('an item that holds a box no wider than it is', () => {
  it('is not held to that box\u2019s own width: `max-width: 100%` lets it get as narrow as the item', () => {
    // A picture in a card, as a browser's reset has every picture: 200 points wide where there
    // is room, and as wide as the card where there is not.
    const css = `${ROW} .pic { width: 200px; max-width: 100%; height: 10px }`;
    const s = scene(css, ['row nowrap', ['it a', ['pic']], ['it b', ['pic p2']]]);
    assert.deepEqual(s.box('it a'), [0, 0, 150, 20]);
    assert.deepEqual(s.box('it b'), [150, 0, 150, 20]);
    assert.equal(s.box('pic')[2], 150);
  });
});

describe('items that share a row with one that takes no share', () => {
  it('share what the row has left of it evenly, as a timeline\u2019s two sides do', () => {
    // A date, a marker of its own width, and what happened: the date and the event are each
    // half of what the marker leaves, whichever has more to say.
    const css = `${ROW} .sep { width: 20px; height: 20px; flex: 0 0 auto } .n { width: 40px; height: 10px }`;
    const s = scene(css, ['row nowrap', ['it a', ['n']], ['sep'], ['it b', ['w']]]);
    assert.deepEqual(s.box('it a'), [0, 0, 140, 20]);
    assert.deepEqual(s.box('sep'), [140, 0, 20, 20]);
    assert.deepEqual(s.box('it b'), [160, 0, 140, 20]);
  });

  it('count one that starts from nothing and does not grow at the least it can be', () => {
    // `flex: 0`, as that marker is written: as wide as what it holds, and no wider.
    const css = `${ROW} .mark { flex: 0 0 0%; min-width: auto; height: 20px } .n { width: 20px; height: 10px }`;
    const s = scene(css, ['row nowrap', ['it a'], ['mark', ['n']], ['it b', ['w']]]);
    assert.deepEqual(s.box('it a'), [0, 0, 140, 20]);
    assert.deepEqual(s.box('mark'), [140, 0, 20, 20]);
    assert.deepEqual(s.box('it b'), [160, 0, 140, 20]);
  });
});

describe('an item that takes a share of a row that does not wrap', () => {
  it('keeps the width of what it holds, and the row overflows', () => {
    const s = scene(ROW, ['row nowrap', ['it a', ['w']], ['it b', ['w w2']], ['it c', ['w w3']]]);
    assert.deepEqual(s.box('it a'), [0, 0, 120, 20]);
    assert.deepEqual(s.box('it c'), [240, 0, 120, 20]);
  });

  it('is left to Yoga where it clips, or has a least width of its own', () => {
    const css = `${ROW} .clip { overflow: hidden } .least { min-width: 10px }`;
    const s = scene(css, ['row nowrap', ['it clip a', ['w']], ['it least b', ['w w2']], ['it c']]);
    // Each under the 120 points it holds: nothing holds either to that.
    assert.ok(s.box('it clip a')[2]! < 120);
    assert.ok(s.box('it least b')[2]! < 120);
  });
});
