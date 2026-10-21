/**
 * `aspect-ratio` on a box with both a width and a height. CSS takes the ratio only for a size
 * that is `auto`, so a box given both is the size it was given. Yoga takes the ratio over one of
 * them: a box 24 by 10 with a ratio of one to two is 5 by 10 in a column and 24 by 48 in a row.
 * So the ratio is committed only where it has a size to work out.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';

function scene(css: string, classes: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const box = engine.createElement('view');
  engine.setClasses(box, classes);
  engine.appendChild(engine.root, box);
  const ratio = (): unknown => {
    engine.commit();
    return fabric.committed[0]!.props['aspectRatio'] ?? null;
  };
  return { engine, box, ratio };
}

const CSS =
  '.ratio { aspect-ratio: 1 / 2 } .w { width: 24px } .h { height: 10px } ' +
  '.pw { width: 50% } .auto { height: auto }';

describe('aspect-ratio on a box with both sizes given', () => {
  it('is left out, so the box is the size it was given', () => {
    assert.equal(scene(CSS, 'ratio w h').ratio(), null);
    assert.equal(scene(CSS, 'ratio pw h').ratio(), null, 'a percentage is a size given too');
  });

  it('is kept where a size is left for it to work out', () => {
    assert.equal(scene(CSS, 'ratio').ratio(), 0.5);
    assert.equal(scene(CSS, 'ratio w').ratio(), 0.5);
    assert.equal(scene(CSS, 'ratio h').ratio(), null, 'stretched across the screen it is in');
    assert.equal(scene(CSS, 'ratio w h auto').ratio(), 0.5, 'auto is no size given');
  });

  it('follows a size coming and going, and one bound on the element', () => {
    const s = scene(CSS, 'ratio w');
    assert.equal(s.ratio(), 0.5);
    s.engine.addClass(s.box, 'h');
    assert.equal(s.ratio(), null);
    s.engine.removeClass(s.box, 'h');
    assert.equal(s.ratio(), 0.5);
    s.engine.setProp(s.box, 'style', { height: 10 });
    assert.equal(s.ratio(), null);
    s.engine.setProp(s.box, 'style', null);
    assert.equal(s.ratio(), 0.5);
  });
});

type Spec = [name: string, ...children: Spec[]];

/** Each box `[name, ...children]` with the class of its name, laid out as the canary does. */
function laidOut(css: string, spec: Spec) {
  const fabric = createLaidOutFabric('strict');
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const nodes = new Map<string, ReturnType<typeof engine.createElement>>();
  const build = ([name, ...children]: Spec, parent: ReturnType<typeof engine.createElement>) => {
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
  /** The width and height of the box with this name. */
  const size = (name: string) => box(name).slice(2);
  return { engine, nodes, box, size };
}

// Chrome's numbers. A flex item that stretches across its line, with its size across the line
// `auto`, is as wide or as tall as the line: the ratio only works out the other size, and not
// one that was given. Yoga takes the ratio over the stretch.
describe('aspect-ratio on a flex item that stretches across its line', () => {
  const RATIO =
    '.r { aspect-ratio: 2 } .h { height: 100px } .w { width: 100px } .start { align-self: flex-start }' +
    ' .row { flex-direction: row } .tall { height: 100px } .s { width: 10px; height: 80px } .b { display: block }' +
    ' .ba { flex-basis: auto } .mn { min-height: 60px } .mx { max-height: 40px }' +
    ' .mx70 { max-height: 70px }';

  it('is as wide as a column, with the height it was given', () => {
    assert.deepEqual(laidOut(RATIO, ['p', ['r h']]).box('r h'), [0, 0, 400, 100]);
    // Not stretched, and in a block, the ratio gives its width.
    assert.deepEqual(laidOut(RATIO, ['p', ['r h start']]).box('r h start'), [0, 0, 200, 100]);
    assert.deepEqual(laidOut(RATIO, ['p b', ['r h']]).box('r h'), [0, 0, 200, 100]);
  });

  it('is as tall as a row, and at least the height the ratio gives its width', () => {
    assert.deepEqual(laidOut(RATIO, ['p row tall', ['r w']]).box('r w'), [0, 0, 100, 100]);
    assert.deepEqual(laidOut(RATIO, ['p row', ['r w'], ['s']]).box('r w'), [0, 0, 100, 80]);
    assert.deepEqual(laidOut(RATIO, ['p row', ['r w']]).box('r w'), [0, 0, 100, 50]);
  });

  it('is as tall as a row with a basis of auto, which is its width', () => {
    assert.deepEqual(laidOut(RATIO, ['p row', ['r w ba'], ['s']]).size('r w ba'), [100, 80]);
  });

  it('keeps the least and most height it was given, in a row', () => {
    assert.deepEqual(laidOut(RATIO, ['p row', ['r w mn']]).size('r w mn'), [100, 60]);
    assert.deepEqual(laidOut(RATIO, ['p row', ['r w mn'], ['s']]).size('r w mn'), [100, 80]);
    assert.deepEqual(laidOut(RATIO, ['p row', ['r w mx'], ['s']]).size('r w mx'), [100, 40]);
    assert.deepEqual(laidOut(RATIO, ['p row', ['r w mx70'], ['s']]).size('r w mx70'), [100, 70]);
  });

  it('is not stretched by a column it has auto margins across, however they are written', () => {
    const s = laidOut(RATIO, ['p', ['r h']]);
    s.engine.setProp(s.nodes.get('r h')!, 'style', { marginHorizontal: 'auto' });
    assert.deepEqual(s.size('r h'), [200, 100]);
    // Right to left, the start side is the right: a start margin leaves the left one auto.
    s.engine.setProp(s.nodes.get('r h')!, 'style', {
      direction: 'rtl',
      marginStart: 5,
      marginLeft: 'auto',
    });
    assert.deepEqual(s.size('r h'), [200, 100]);
  });

  it('follows the box it is in turning from a column to a row', () => {
    const s = laidOut(RATIO, ['p', ['r w'], ['s']]);
    assert.deepEqual(s.box('r w'), [0, 0, 100, 50]);
    s.engine.setClasses(s.nodes.get('p')!, 'p row');
    assert.deepEqual(s.box('r w'), [0, 0, 100, 80]);
    s.engine.setClasses(s.nodes.get('p')!, 'p');
    assert.deepEqual(s.box('r w'), [0, 0, 100, 50]);
  });

  it('keeps an image to its picture, stretched or not', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(RATIO, 'app.css') as never });
    const image = engine.createElement('image');
    engine.setProp(image, 'intrinsicSize', { width: 300, height: 100 });
    engine.setClasses(image, 'h');
    engine.appendChild(engine.root, image);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['aspectRatio'], 3);
  });
});
