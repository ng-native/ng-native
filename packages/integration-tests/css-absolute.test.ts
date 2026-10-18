/**
 * What Yoga gets wrong about a `position: absolute` box, put right from its laid-out size.
 *
 * `margin: auto` between two insets takes the room left over, which is how a box is centred in
 * its container (CSS 2.2, 10.3.7 and 10.6.4): Yoga leaves it at the start. And a box with no
 * inset sits where it would have been in the flow, which in a block is under the sibling before
 * it: Yoga puts it at the container's top. Both need the box's size and its container's, so the
 * engine reads them back from the commit and commits again with lengths in their place.
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
  return { engine, fabric, nodes, box };
}

const FRAME = '.p { width: 200px; height: 100px } .big { width: 300px; height: 100px }';
const BOX = 'position: absolute; width: 40px; height: 20px;';

describe('margin: auto on an absolute box', () => {
  it('centres it between insets on both axes', () => {
    const s = scene(`${FRAME} .a { ${BOX} inset: 0; margin: auto }`, ['p', ['a']]);
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
  });

  it('centres it on one axis and leaves the other where its inset puts it', () => {
    const css = `${FRAME} .a { ${BOX} left: 0; right: 0; top: 10px; margin-left: auto; margin-right: auto }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [80, 10, 40, 20]);
  });

  it('pushes it to the end with one auto margin, less the other margin and the insets', () => {
    const css = `${FRAME} .a { ${BOX} left: 10px; right: 20px; top: 0; margin-left: auto; margin-right: 5px }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [135, 0, 40, 20]);
  });

  it('measures the room inside the border of its container', () => {
    const css = `${FRAME} .p { border-width: 10px } .a { ${BOX} inset: 0; margin: auto }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [80, 40, 40, 20]);
  });

  it('is nothing without both insets, as it is in a browser', () => {
    const css = `${FRAME} .a { ${BOX} left: 10px; top: 0; margin-left: auto }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [10, 0, 40, 20]);
  });

  it('keeps the margin written on the side of its one inset, beside an auto margin', () => {
    // Chrome: 200 less the inset, the margin and the width.
    const css = `${FRAME} .a { ${BOX} right: 10px; top: 0; margin-left: auto; margin-right: 20px }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [130, 0, 40, 20]);
  });

  it('takes a percentage margin down it of the width of its container, beside an auto one', () => {
    // Chrome, in a container 300 wide and 200 tall: 10% is 30, of the width.
    const box =
      'position: absolute; left: 0; width: 40px; height: 40px; margin-top: auto; margin-bottom: 10%;';
    const css = `.w { width: 300px; height: 200px } .a { ${box} top: 0; bottom: 0 } .b { ${box} bottom: 10px }`;
    assert.deepEqual(scene(css, ['w', ['a']]).box('a'), [0, 130, 40, 40]);
    assert.deepEqual(scene(css, ['w', ['b']]).box('b'), [0, 120, 40, 40]);
  });

  it('follows its container changing size', () => {
    const s = scene(`${FRAME} .a { ${BOX} inset: 0; margin: auto }`, ['p', ['a']]);
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
    s.engine.setClasses(s.nodes.get('p')!, 'big');
    assert.deepEqual(s.box('a'), [130, 40, 40, 20]);
  });

  it('follows its own size changing', () => {
    const s = scene(`${FRAME} .a { ${BOX} inset: 0; margin: auto } .wide { width: 100px }`, [
      'p',
      ['a'],
    ]);
    s.box('a');
    s.engine.setClasses(s.nodes.get('a')!, 'a wide');
    assert.deepEqual(s.box('a'), [50, 40, 100, 20]);
  });

  it('gives the margins back when they stop being auto', () => {
    const css = `${FRAME} .a { ${BOX} inset: 0; margin: auto } .b { ${BOX} top: 5px; left: 5px }`;
    const s = scene(css, ['p', ['a']]);
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
    s.engine.setClasses(s.nodes.get('a')!, 'b');
    assert.deepEqual(s.box('a'), [5, 5, 40, 20]);
  });

  it('is placed again after a commit that placed it failed', () => {
    const s = scene(`${FRAME} .a { ${BOX} inset: 0; margin: auto }`, ['p', ['a']]);
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
    // The commit that places it again throws, as a native prop that stops the app would.
    const complete = s.fabric.completeRoot.bind(s.fabric);
    let calls = 0;
    s.fabric.completeRoot = (...args) => {
      if (++calls === 2) throw new Error('native refused the commit');
      return complete(...args);
    };
    s.engine.setClasses(s.nodes.get('p')!, 'big');
    assert.throws(() => s.engine.commit(), /native refused/);
    s.fabric.completeRoot = complete;
    // A box that comes after it is placed: nothing is left thinking a placement is under way.
    const late = s.engine.createElement('view');
    s.engine.setClasses(late, 'a');
    s.engine.setProp(late, 'nativeID', 'late');
    s.engine.appendChild(s.nodes.get('p')!, late);
    assert.deepEqual(s.box('late'), [130, 40, 40, 20]);
  });

  it('is placed again where it comes back after a commit out of the tree', () => {
    const s = scene(`${FRAME} .a { ${BOX} inset: 0; margin: auto }`, ['top', ['p', ['a']]]);
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
    const [top, p] = [s.nodes.get('top')!, s.nodes.get('p')!];
    s.engine.removeChild(top, p);
    s.engine.commit();
    s.engine.setClasses(p, 'big');
    s.engine.appendChild(top, p);
    assert.deepEqual(s.box('a'), [130, 40, 40, 20]);
  });

  it('is let go when it leaves the tree, where it would be kept for the life of the app', () => {
    const s = scene(`${FRAME} .a { ${BOX} inset: 0; margin: auto }`, ['top', ['p', ['a']]]);
    s.box('a');
    const placing = (s.engine as unknown as { unplaced: Set<unknown> }).unplaced;
    assert.equal(placing.has(s.nodes.get('a')), true);
    s.engine.removeChild(s.nodes.get('top')!, s.nodes.get('p')!);
    s.engine.commit();
    assert.equal(placing.has(s.nodes.get('a')), false);
  });

  it('settles in the commit it was changed in, with no pass left over', () => {
    const s = scene(`${FRAME} .a { ${BOX} inset: 0; margin: auto }`, ['p', ['a']]);
    assert.equal(s.engine.commit(), true);
    assert.equal(s.engine.commit(), false);
  });
});

describe('a percentage size on an absolute box', () => {
  // A field's outline: `position: absolute; width: 100%` under a wrapper with padding, through a
  // box that is not positioned. Chrome makes it the 200 of the wrapper inside its border, where
  // Yoga takes the percentage of what is inside its parent's padding.
  const CSS =
    '.w { position: relative; width: 200px; height: 50px; padding: 5px 16px } ' +
    '.s { position: static; height: 20px } ' +
    '.a { position: absolute; left: 0; top: 0; width: 100%; max-width: 100%; height: 50% }';

  it('is of the padding box of the box it is placed against, not of its parent', () => {
    const s = scene(CSS, ['w', ['s', ['a']]]);
    assert.deepEqual(s.box('a'), [0, 0, 200, 25]);
  });

  it('is the same where the box it is placed against is its parent, a block with padding', () => {
    const block = 'display: block; position: relative; padding: 0 10px; width: 100px';
    const s = scene(`${CSS} .s { ${block} }`, ['w', ['s', ['a']]]);
    assert.deepEqual(s.box('a').slice(2), [100, 10]);
  });

  it('follows the box it is placed against changing size, and a size that stops being a share', () => {
    const s = scene(`${CSS} .wide { width: 300px } .fixed { width: 30px }`, ['w', ['s', ['a']]]);
    assert.deepEqual(s.box('a').slice(2), [200, 25]);
    s.engine.addClass(s.nodes.get('w')!, 'wide');
    assert.deepEqual(s.box('a').slice(2), [300, 25]);
    s.engine.addClass(s.nodes.get('a')!, 'fixed');
    assert.deepEqual(s.box('a').slice(2), [30, 25]);
  });

  it('settles in the commit it was changed in, with no pass left over', () => {
    const s = scene(CSS, ['w', ['s', ['a']]]);
    s.box('a');
    const commits = s.fabric.calls.completeRoot;
    s.engine.commit();
    assert.equal(s.fabric.calls.completeRoot, commits);
  });
});

describe('a percentage inset on an absolute box', () => {
  // A touch target centred on a checkbox: `top: 50%; left: 50%` in a box with padding, which is
  // half of the box inside its border in a browser and half of what is inside its padding to Yoga.
  const CSS =
    '.c { display: inline-block; position: relative; box-sizing: content-box; width: 18px; height: 18px; padding: 11px } ' +
    '.t { position: absolute; top: 50%; left: 50%; width: 48px; height: 48px } ' +
    '.e { position: absolute; right: 25%; bottom: 25%; width: 4px; height: 4px }';

  it('is a share of the padding box of the box it is placed in, on each side', () => {
    const s = scene(CSS, ['c', ['t'], ['e']]);
    const c = s.box('c');
    const [t, e] = [s.box('t'), s.box('e')];
    assert.deepEqual([t[0]! - c[0]!, t[1]! - c[1]!], [20, 20]);
    assert.deepEqual([e[0]! - c[0]!, e[1]! - c[1]!], [26, 26]);
  });

  it('leaves a size set on the element over a share its default style has', () => {
    // An icon drawn 24 wide by its own attribute, in a 10 by 5 box it is centred over: with
    // nothing said it is as wide as the box, and the attribute says something.
    const s = scene('.b { display: block; position: relative; width: 10px; height: 5px }', [
      'b',
      ['i'],
    ]);
    const icon = s.nodes.get('i')!;
    s.engine.setDefaultStyle(icon, { position: 'absolute', width: '100%', height: '100%' });
    assert.deepEqual(s.box('i').slice(2), [10, 5]);
    s.engine.setProp(icon, 'width', 24);
    s.engine.setProp(icon, 'height', 24);
    assert.deepEqual(s.box('i').slice(2), [24, 24]);
    s.engine.setProp(icon, 'width', null);
    assert.deepEqual(s.box('i').slice(2), [10, 24]);
  });
});

describe('an absolute box with no inset, in a block', () => {
  const BLOCK = '.p { display: block; width: 200px; height: 100px } .row { height: 30px }';

  it('sits under the sibling before it, where it would have been in the flow', () => {
    const s = scene(`${BLOCK} .a { ${BOX} }`, ['p', ['row'], ['a'], ['row two']]);
    assert.deepEqual(s.box('a'), [0, 30, 40, 20]);
    // It takes no room: what follows it is where it would be without it.
    assert.deepEqual(s.box('row two'), [0, 30, 200, 30]);
  });

  it('is at the top when nothing is before it', () => {
    assert.deepEqual(
      scene(`${BLOCK} .a { ${BOX} }`, ['p', ['a'], ['row']]).box('a'),
      [0, 0, 40, 20],
    );
  });

  it('follows the sibling before it growing', () => {
    const s = scene(`${BLOCK} .a { ${BOX} } .tall { height: 70px }`, ['p', ['row'], ['a']]);
    assert.deepEqual(s.box('a'), [0, 30, 40, 20]);
    s.engine.setClasses(s.nodes.get('row')!, 'tall');
    assert.deepEqual(s.box('a'), [0, 70, 40, 20]);
  });

  it('is left to its inset when it has one', () => {
    const s = scene(`${BLOCK} .a { ${BOX} top: 5px }`, ['p', ['row'], ['a']]);
    assert.deepEqual(s.box('a'), [0, 5, 40, 20]);
  });

  it("sits under the sibling's bottom margin, and its own margin under that, as Chrome has it", () => {
    const css = `${BLOCK} .a { ${BOX} } .mb { margin-bottom: 8px } .am { margin-top: 6px } .ap { margin-top: 50% } .m { margin: 10px; height: 0 }`;
    assert.deepEqual(scene(css, ['p', ['row mb'], ['a']]).box('a'), [0, 38, 40, 20]);
    assert.deepEqual(scene(css, ['p', ['row mb'], ['a am']]).box('a am'), [0, 44, 40, 20]);
    // A share of a margin is of the width, on either axis, and goes when the margin is a length.
    const share = scene(css, ['p', ['row'], ['a ap']]);
    assert.deepEqual(share.box('a ap'), [0, 130, 40, 20]);
    share.engine.setClasses(share.nodes.get('a ap')!, 'a am');
    assert.deepEqual(share.box('a ap'), [0, 36, 40, 20]);
    // An empty block's margins collapse through it, and the box is under them still.
    assert.deepEqual(scene(css, ['p', ['row m'], ['a']]).box('a'), [0, 20, 40, 20]);
  });

  it('sits under the line box of an inline-level box before it, and not the box', () => {
    // Chrome's numbers: the line is 20 tall, a 10px font on a 20px line, the box on its baseline.
    const css = `${BLOCK} .p { font-size: 10px; line-height: 20px } .row { height: 10px } .i { display: inline-block; width: 10px; height: 5px } .a { ${BOX} }`;
    const s = scene(css, ['p', ['row'], ['i'], ['a']]);
    assert.deepEqual(s.box('a'), [0, 30, 40, 20]);
  });

  it('follows the margin of the sibling before it changing and going', () => {
    const css = `${BLOCK} .a { ${BOX} } .mb { margin-bottom: 8px } .more { margin-bottom: 15px }`;
    const s = scene(css, ['p', ['row'], ['a']]);
    const row = s.nodes.get('row')!;
    s.engine.setClasses(row, 'row mb');
    assert.deepEqual(s.box('a'), [0, 38, 40, 20]);
    s.engine.setClasses(row, 'row mb more');
    assert.deepEqual(s.box('a'), [0, 45, 40, 20]);
    s.engine.setClasses(row, 'row');
    assert.deepEqual(s.box('a'), [0, 30, 40, 20]);
  });
});

describe('an absolute box that is placed from here, on a commit that does not concern it', () => {
  // A screen of buttons has an absolute box in each, a ripple or a focus ring, and each is
  // placed from its size and its container's, read back from native. Read again on every commit,
  // that is a few hundred reads for a colour that changed somewhere else.
  const CSS =
    '.p { position: relative; width: 200px; height: 100px } ' +
    '.a { position: absolute; inset: 0; margin: auto; width: 40px; height: 20px } ' +
    '.o { height: 10px } .o.red { background-color: red } .o.tall { height: 30px } ' +
    '.p.wide { width: 300px } .a.big { width: 60px }';

  function counted() {
    const s = scene(CSS, ['root', ['p', ['a']], ['o']]);
    s.box('a');
    let reads = 0;
    const read = s.fabric.getBoundingClientRect!.bind(s.fabric);
    s.fabric.getBoundingClientRect = (handle, transformed) => (reads++, read(handle, transformed));
    const after = (change: () => void): number => {
      reads = 0;
      change();
      s.engine.commit();
      return reads;
    };
    return { ...s, after };
  }

  it('is not read again for paint, or for a box resized outside what it is placed against', () => {
    const s = counted();
    assert.equal(
      s.after(() => s.engine.setClasses(s.nodes.get('o')!, 'o red')),
      0,
    );
    assert.equal(
      s.after(() => s.engine.setClasses(s.nodes.get('o')!, 'o tall')),
      0,
    );
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
  });

  it('is placed again where its container is resized, or it is', () => {
    const s = counted();
    assert.ok(s.after(() => s.engine.setClasses(s.nodes.get('p')!, 'p wide')) > 0);
    assert.deepEqual(s.box('a'), [130, 40, 40, 20]);
    assert.ok(s.after(() => s.engine.setClasses(s.nodes.get('a')!, 'a big')) > 0);
    assert.deepEqual(s.box('a'), [120, 40, 60, 20]);
  });

  it('is placed again where something above its container is resized', () => {
    const s = counted();
    assert.ok(s.after(() => s.engine.setProp(s.nodes.get('root')!, 'style', { width: 500 })) > 0);
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
  });
});
