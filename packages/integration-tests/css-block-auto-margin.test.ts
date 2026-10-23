/**
 * An `auto` margin, and `justify-self`, on a box in a block container (CSS 2.2, 10.3.3). A block
 * with an `auto` width fills its container, and its `auto` margins come to nothing: they only
 * centre or push a box whose width is set, or held under a `max-width`. Yoga gives an `auto`
 * margin the room left over, which stops the box stretching, so the engine settles which of the
 * two it is before layout. An inline-block's `auto` margins are none at all (10.3.9).
 *
 * The numbers are Chrome's, with `@ng-native/web`'s reset.
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
  const build = ([name, ...children]: Spec, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) build(child, node);
    return node;
  };
  build(spec, engine.root);
  const box = (name: string) => {
    engine.commit();
    const { left, top, width, height } = fabric.box(name);
    return [left, top, width, height];
  };
  const restyle = (name: string, classes: string) =>
    engine.setClasses(nodes.get(name)!, `${name} ${classes}`);
  return { engine, nodes, box, restyle };
}

const BLOCK = '.p { display: block } .c { height: 10px }';
const inBlock = (css: string) => scene(`${BLOCK} ${css}`, ['p', ['c']]);

describe('an auto margin on a block in a block, with no width', () => {
  it('is none on the left: the block fills its container', () => {
    assert.deepEqual(inBlock('.c { margin-left: auto }').box('c'), [0, 0, 400, 10]);
  });

  it('is none on the right', () => {
    assert.deepEqual(inBlock('.c { margin-right: auto }').box('c'), [0, 0, 400, 10]);
  });

  it('is none on every side', () => {
    const s = scene(`${BLOCK} .p { height: 100px } .c { margin: auto }`, ['p', ['c']]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
  });

  it('is none in an inline-block, which lays its children out as blocks too', () => {
    const s = scene('.p { display: inline-block } .c { height: 10px; margin-left: auto }', [
      'p',
      ['c'],
    ]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
  });

  it('takes the room left over again in a flex container, as it does in a browser', () => {
    const s = inBlock('.c { margin-left: auto } .flex { display: flex }');
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
    s.restyle('p', 'flex');
    assert.deepEqual(s.box('c'), [400, 0, 0, 10]);
    s.restyle('p', '');
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
  });
});

describe('an auto margin on a block in a block, with a width', () => {
  it('centres a block of a set width', () => {
    assert.deepEqual(inBlock('.c { width: 100px; margin: 0 auto }').box('c'), [150, 0, 100, 10]);
  });

  it('pushes a block of a percentage width to the end', () => {
    assert.deepEqual(inBlock('.c { width: 50%; margin-left: auto }').box('c'), [200, 0, 200, 10]);
  });

  it('centres a block held under a max-width', () => {
    assert.deepEqual(
      inBlock('.c { max-width: 100px; margin: 0 auto }').box('c'),
      [150, 0, 100, 10],
    );
  });

  it('pushes a block held under a max-width to the end', () => {
    const s = inBlock('.c { max-width: 100px; margin-left: auto }');
    assert.deepEqual(s.box('c'), [300, 0, 100, 10]);
  });

  it('takes its other margin off the room it is pushed across', () => {
    const s = inBlock('.c { max-width: 50px; margin: 10px; margin-left: auto }');
    assert.deepEqual(s.box('c'), [340, 10, 50, 10]);
  });

  it('pushes a content box under a max-width, with no padding to add to it', () => {
    const s = inBlock('.c { box-sizing: content-box; max-width: 100px; margin-left: auto }');
    assert.deepEqual(s.box('c'), [300, 0, 100, 10]);
  });

  it('fills a container narrower than the max-width', () => {
    const s = inBlock('.p { width: 200px } .c { max-width: 300px; margin: 0 auto }');
    assert.deepEqual(s.box('c'), [0, 0, 200, 10]);
  });

  it('follows the width being set, changed and taken away', () => {
    const s = inBlock('.c { margin: 0 auto } .w1 { width: 100px } .w2 { width: 200px }');
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
    s.restyle('c', 'w1');
    assert.deepEqual(s.box('c'), [150, 0, 100, 10]);
    s.restyle('c', 'w2');
    assert.deepEqual(s.box('c'), [100, 0, 200, 10]);
    s.restyle('c', '');
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
  });

  it('follows the max-width being set and taken away', () => {
    const s = inBlock('.c { margin: 0 auto } .m { max-width: 100px }');
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
    s.restyle('c', 'm');
    assert.deepEqual(s.box('c'), [150, 0, 100, 10]);
    s.restyle('c', '');
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
  });
});

describe('an auto margin on an inline-block in a block', () => {
  it('is none: the box stays at the start of its line', () => {
    const s = inBlock('.c { display: inline-block; width: 50px; margin-left: auto }');
    const [left, , width] = s.box('c');
    assert.deepEqual([left, width], [0, 50]);
  });
});

describe('justify-self on a block in a block', () => {
  it('centres a block of a set width', () => {
    const s = inBlock('.c { width: 100px; justify-self: center }');
    assert.deepEqual(s.box('c'), [150, 0, 100, 10]);
  });

  it('keeps a block with no width at the width of its content, where it puts it', () => {
    assert.deepEqual(inBlock('.c { justify-self: center }').box('c'), [200, 0, 0, 10]);
    assert.deepEqual(inBlock('.c { justify-self: start }').box('c'), [0, 0, 0, 10]);
    assert.deepEqual(inBlock('.c { justify-self: end }').box('c'), [400, 0, 0, 10]);
  });

  it('leaves the block to its auto margins, which come first', () => {
    const s = inBlock('.c { width: 100px; justify-self: start; margin-left: auto }');
    assert.deepEqual(s.box('c'), [300, 0, 100, 10]);
  });

  it('stretches the block again once it is taken away', () => {
    const s = inBlock('.mid { justify-self: center }');
    s.restyle('c', 'mid');
    assert.deepEqual(s.box('c'), [200, 0, 0, 10]);
    s.restyle('c', '');
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
  });
});
