/**
 * `flex-basis` that is a length or a percentage, committed as the size it is along its
 * container's main axis: a width in a row, a height in a column.
 *
 * Yoga works a `flexBasis` out once for a view and keeps the answer (`computedFlexBasis`), and
 * the one place that forgets it, `markDirtyAndPropagate`, is not what React Native calls when a
 * view's props change. So a basis that changes after a view is first laid out is never read
 * again: a bar bound to 60% that started at 100% stays at 100%, and a percentage does not follow
 * the box it is a share of. A size is worked out on every pass, and where there is no basis Yoga
 * takes the size as the basis, which is the same sum.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

/** A parent with classes `parent` holding a child with classes `child`, under `css`. */
function scene(css: string, parent = 'p', child = 'c', now?: () => number) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    ...(now ? { now } : {}),
  });
  const outer = engine.createElement('view');
  engine.setClasses(outer, parent);
  engine.appendChild(engine.root, outer);
  const inner = engine.createElement('view');
  engine.setClasses(inner, child);
  engine.appendChild(outer, inner);
  const props = (): Record<string, unknown> => {
    engine.commit();
    return fabric.committed[0]!.children[0]!.props;
  };
  /** The three props a basis is committed as, or not. */
  const sized = () => {
    const { flexBasis = null, width = null, height = null } = props();
    return { flexBasis, width, height };
  };
  return { engine, fabric, outer, inner, props, sized };
}

const ROW = '.p { flex-direction: row; width: 300px; height: 200px }';
const COLUMN = '.p { width: 300px; height: 200px }';

describe('a flex-basis that is a length or a percentage', () => {
  it('is the width of a box in a row', () => {
    const percent = scene(`${ROW} .c { flex: 0 1 60% }`);
    assert.deepEqual(percent.sized(), { flexBasis: null, width: '60%', height: null });
    assert.equal(percent.props()['flexGrow'], 0);
    assert.equal(percent.props()['flexShrink'], 1);
    const length = scene(`${ROW} .c { flex-basis: 120px }`);
    assert.deepEqual(length.sized(), { flexBasis: null, width: 120, height: null });
  });

  it('is the height of a box in a column', () => {
    const s = scene(`${COLUMN} .c { flex-basis: 25% }`);
    assert.deepEqual(s.sized(), { flexBasis: null, width: null, height: '25%' });
  });

  it('is over a size written for the same axis, and leaves the other axis its own', () => {
    const s = scene(`${ROW} .c { width: 40px; height: 30px; flex-basis: 120px }`);
    assert.deepEqual(s.sized(), { flexBasis: null, width: 120, height: 30 });
  });

  it('is no height in a column with none to take a share of, as a percentage height is', () => {
    const s = scene('.c { flex-basis: 50% }');
    assert.deepEqual(s.sized(), { flexBasis: null, width: null, height: null });
  });

  it('follows the basis changing, and going', () => {
    const s = scene(
      `${ROW} .c { width: 40px } .full { flex-basis: 100% } .part { flex-basis: 60% }`,
    );
    s.engine.setClasses(s.inner, 'c full');
    assert.equal(s.sized().width, '100%');
    s.engine.setClasses(s.inner, 'c part');
    assert.equal(s.sized().width, '60%');
    s.engine.setProp(s.inner, 'style', { flexBasis: '30%' });
    assert.equal(s.sized().width, '30%');
    s.engine.setProp(s.inner, 'style', null);
    s.engine.setClasses(s.inner, 'c');
    assert.deepEqual(s.sized(), { flexBasis: null, width: 40, height: null });
  });

  it('follows its container turning from a row to a column and back', () => {
    const s = scene(`${COLUMN} .row { flex-direction: row } .c { flex-basis: 80px }`);
    assert.deepEqual(s.sized(), { flexBasis: null, width: null, height: 80 });
    s.engine.setClasses(s.outer, 'p row');
    assert.deepEqual(s.sized(), { flexBasis: null, width: 80, height: null });
    s.engine.setClasses(s.outer, 'p');
    assert.deepEqual(s.sized(), { flexBasis: null, width: null, height: 80 });
  });

  it('is of the container above a display: contents box it is written in', () => {
    const fabric = createFakeFabric();
    const css = `${ROW} .through { display: contents } .c { flex-basis: 80px }`;
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const [outer, through, inner] = ['p', 'through', 'c'].map((classes) => {
      const node = engine.createElement('view');
      engine.setClasses(node, classes);
      return node;
    });
    engine.appendChild(engine.root, outer!);
    engine.appendChild(outer!, through!);
    engine.appendChild(through!, inner!);
    engine.commit();
    const committed = fabric.committed[0]!.children[0]!.children[0]!;
    assert.equal(committed.props['width'], 80);
    assert.equal('flexBasis' in committed.props, false);
  });

  it('is eased as a flex-basis is, where a transition names it', () => {
    let now = 1000;
    const s = scene(
      `${ROW} .c { flex-basis: 100px; transition: flex-basis 100ms linear } .wide { flex-basis: 200px }`,
      'p',
      'c',
      () => now,
    );
    assert.equal(s.sized().width, 100);
    s.engine.addClass(s.inner, 'wide');
    s.engine.commit();
    now += 50;
    s.engine.advanceAnimations();
    assert.equal(s.sized().width, 150);
    now += 50;
    s.engine.advanceAnimations();
    assert.deepEqual(s.sized(), { flexBasis: null, width: 200, height: null });
  });
});

describe('a flex-basis that is left as one', () => {
  it('is zero, which `flex: 1` is: a box that grows from nothing', () => {
    const s = scene(`${ROW} .c { flex: 1 }`);
    assert.deepEqual(s.sized(), { flexBasis: '0%', width: null, height: null });
    const percent = scene(`${ROW} .c { flex: 1 1 0% }`);
    assert.equal(percent.sized().width, null);
  });

  it('is auto, which is the size the box has anyway', () => {
    const s = scene(`${ROW} .c { flex-basis: auto; width: 40px }`);
    assert.equal(s.sized().width, 40);
  });

  it('is on a box out of the flow, which is no flex item', () => {
    const s = scene(`${ROW} .c { position: absolute; width: 40px; flex-basis: 120px }`);
    assert.equal(s.sized().width, 40);
  });
});
