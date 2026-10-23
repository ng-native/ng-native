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
import type { FakeFabricNode } from '@ng-native/testing';
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

describe('margin: auto on an absolute box with no size of its own', () => {
  // Between two insets an auto size is what the insets leave, clamped by its min and max, and
  // the auto margins share what the clamp leaves over (CSS 2.2, 10.3.7 and 10.6.4).
  const ROOM = '.p { height: 300px }';

  it('fills what the insets leave, with nothing to share', () => {
    const s = scene(`${ROOM} .a { position: absolute; inset: 0; margin: auto }`, ['p', ['a']]);
    assert.deepEqual(s.box('a'), [0, 0, 400, 300]);
  });

  it('is centred at its max-width, on the axis that has one', () => {
    const css = `${ROOM} .a { position: absolute; left: 0; right: 0; margin: 0 auto; max-width: 200px; height: 20px }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [100, 0, 200, 20]);
  });

  it('is centred at its max-width and max-height on both axes', () => {
    const css = `${ROOM} .a { position: absolute; inset: 0; margin: auto; max-width: 100px; max-height: 50px }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [150, 125, 100, 50]);
  });

  it('follows its container growing past its max-width and back under it', () => {
    const css = `${ROOM} .a { position: absolute; left: 0; right: 0; margin: 0 auto; max-width: 200px; height: 20px } .narrow { width: 150px }`;
    const s = scene(css, ['p', ['a']]);
    s.engine.setClasses(s.nodes.get('p')!, 'p narrow');
    assert.deepEqual(s.box('a'), [0, 0, 150, 20]);
    s.engine.setClasses(s.nodes.get('p')!, 'p');
    assert.deepEqual(s.box('a'), [100, 0, 200, 20]);
    s.engine.setClasses(s.nodes.get('p')!, 'p narrow');
    assert.deepEqual(s.box('a'), [0, 0, 150, 20]);
  });

  it('adds its padding to a max-width that is of its content box', () => {
    const css = `${ROOM} .a { position: absolute; left: 0; right: 0; margin: 0 auto; max-width: 100px; height: 20px; box-sizing: content-box; padding: 0 10px }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [140, 0, 120, 20]);
  });

  it('keeps a size given as a prop rather than a style, centred at it', () => {
    const s = scene(`${ROOM} .a { position: absolute; inset: 0; margin: auto }`, ['p', ['a']]);
    s.engine.setProp(s.nodes.get('a')!, 'width', 40);
    s.engine.setProp(s.nodes.get('a')!, 'height', 20);
    assert.deepEqual(s.box('a'), [180, 140, 40, 20]);
  });

  it('is no narrower than its padding, under a max-width that is less', () => {
    const css = `${ROOM} .a { position: absolute; left: 0; right: 0; margin: 0 auto; max-width: 100px; height: 20px; padding: 0 60px }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [140, 0, 120, 20]);
  });

  it('takes what its min-width overflows by from one auto margin, which goes below nothing', () => {
    const css = `${ROOM} .p { width: 150px } .a { position: absolute; left: 0; right: 0; margin-left: auto; min-width: 200px; height: 20px }`;
    assert.deepEqual(scene(css, ['p', ['a']]).box('a'), [-50, 0, 200, 20]);
  });

  it('keeps its max-width with text in it narrower than that, as a toast does', () => {
    const css = `${ROOM} .a { position: absolute; left: 0; right: 0; bottom: 16px; margin-left: auto; margin-right: auto; max-width: 200px; padding: 8px }`;
    const s = scene(css, ['p', ['a']]);
    const text = s.engine.createElement('text');
    s.engine.appendChild(s.nodes.get('a')!, text);
    s.engine.appendChild(text, s.engine.createText('Saved'));
    assert.deepEqual(s.box('a'), [100, 248, 200, 36]);
  });

  it('takes the height the insets leave beside an auto margin down it', () => {
    // Chrome: 240 less the top inset, 10% of 240 at the bottom and the 7px margin under it.
    const css =
      '.w { display: block; width: 59px; height: 240px; padding-left: 13px; margin: 1px } ' +
      '.a { width: 52px; margin: 7px; margin-top: auto; position: absolute; top: 30px; right: 11px; bottom: 10% }';
    assert.deepEqual(scene(css, ['w', ['a']]).box('a'), [-10, 31, 52, 179]);
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

describe('an absolute box in a static box that CSS makes what it is placed against', () => {
  // Chrome: a filter, a will-change and the rest make a static box an absolute box's containing
  // block, so it is centred in that box and not in the positioned one above it.
  const CSS =
    '.g { position: relative; width: 300px; height: 200px } ' +
    '.h { position: static; width: 100px; height: 100px; margin-left: 50px } ' +
    `.f { filter: brightness(1.2) } .a { ${BOX} inset: 0; margin: auto }`;

  it('is centred in a static box with a filter, and in the one above once it has none', () => {
    const s = scene(CSS, ['g', ['h f', ['a']]]);
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
    s.engine.setClasses(s.nodes.get('h f')!, 'h');
    assert.deepEqual(s.box('a'), [130, 90, 40, 20]);
  });

  it('is centred in a static box with a will-change, and in the one above once it has none', () => {
    const s = scene(CSS, ['g', ['h', ['a']]]);
    const h = s.nodes.get('h')!;
    s.engine.setProp(h, 'style', { willChange: 'transform' });
    assert.deepEqual(s.box('a'), [80, 40, 40, 20]);
    s.engine.setProp(h, 'style', { willChange: 'opacity' });
    assert.deepEqual(s.box('a'), [130, 90, 40, 20]);
  });
});

describe("an absolute box in a static box a library's sheet makes what it is placed against", () => {
  // Chrome: each of these makes a static box an absolute box's containing block from a sheet, as
  // from a value set on the element, and a later rule's value takes over from an earlier one's.
  const placed = (rule: string, classes = 'h c', generated = true) => {
    const css =
      '.g { position: relative; width: 300px; height: 200px } ' +
      '.h { position: static; width: 100px; height: 100px; margin-left: 50px } ' +
      `.h.c { ${rule} } .a { ${BOX} inset: 0; margin: auto }`;
    const sheet = compileCss(css, 'lib.css', { onUnsupported: () => {}, generated });
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const add = (name: string, parent: EngineNode) => {
      const node = engine.createElement('view');
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name);
      engine.appendChild(parent, node);
      return node;
    };
    add('a', add(classes, add('g', engine.root)));
    engine.commit();
    const { left, top, width, height } = fabric.box('a');
    const find = (node: FakeFabricNode): FakeFabricNode | undefined =>
      node.props['nativeID'] === classes ? node : node.children.map(find).find(Boolean);
    const style = fabric.committed.map(find).find(Boolean)!.props;
    return { box: [left, top, width, height], style };
  };
  const INSIDE = [80, 40, 40, 20];
  const ABOVE = [130, 90, 40, 20];

  for (const rule of [
    'will-change: transform',
    'will-change: opacity, filter',
    'will-change: position',
    'contain: paint',
    'contain: layout style',
    'contain: content',
    'contain: strict',
    'perspective: 100px',
    'backdrop-filter: blur(2px)',
  ]) {
    it(`is centred in a static box with ${rule}, which native is not sent`, () => {
      const { box, style } = placed(rule);
      assert.deepEqual(box, INSIDE);
      const key = rule
        .split(':')[0]!
        .replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
      assert.equal(key in style, false, `${key} is read by the engine alone`);
      assert.equal(style['position'], 'relative');
    });
  }

  for (const rule of [
    'will-change: auto',
    'will-change: opacity',
    'contain: none',
    'contain: size',
    'perspective: none',
    'backdrop-filter: none',
  ]) {
    it(`is centred in the box above a static box with ${rule}`, () => {
      assert.deepEqual(placed(rule).box, ABOVE);
    });
  }

  it('sends native none of them where nothing else asks for a layout of CSS', () => {
    const rule =
      'will-change: transform; contain: paint; perspective: 1px; backdrop-filter: blur(1px)';
    const sheet = compileCss(`.c { ${rule} }`, 'lib.css', {
      onUnsupported: () => {},
      generated: true,
    });
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const node = engine.createElement('view');
    engine.setClasses(node, 'c');
    engine.appendChild(engine.root, node);
    engine.commit();
    const [committed] = fabric.committed;
    for (const key of ['willChange', 'contain', 'perspective', 'backdropFilter']) {
      assert.equal(key in committed!.props, false, key);
    }
  });

  it('says what native does not draw of them, and fails a strict compile for it', () => {
    const said = (rule: string) => {
      const warnings: string[] = [];
      const options = { onUnsupported: (m: string) => warnings.push(m), generated: true };
      compileCss(`.c { ${rule} }`, 'lib.css', options);
      return warnings;
    };
    assert.match(said('backdrop-filter: blur(1px)')[0]!, /part of 'backdrop-filter'.*no backdrop/);
    assert.match(said('perspective: 1px')[0]!, /part of 'perspective'.*no perspective/);
    for (const rule of ['paint', 'content', 'size', 'inline-size layout', 'strict']) {
      assert.match(said(`contain: ${rule}`)[0]!, /part of 'contain'.*size nor the paint/, rule);
    }
    assert.match(said('will-change: var(--w)')[0]!, /'will-change' made of tokens/);
    for (const rule of [
      'will-change: transform',
      'contain: layout style',
      'contain: none',
      'perspective: none',
      'backdrop-filter: none',
    ]) {
      assert.deepEqual(said(rule), [], rule);
      assert.doesNotThrow(() => compileCss(`.c { ${rule} }`, 'lib.css', { generated: true }), rule);
    }
    const strict = () =>
      compileCss('.c { backdrop-filter: blur(1px) }', 'lib.css', { generated: true });
    assert.throws(strict, /no backdrop/);
  });

  it("is centred in the box above where the app's own sheet says it, which is refused it", () => {
    const warnings: string[] = [];
    const options = { onUnsupported: (m: string) => warnings.push(m) };
    compileCss('.c { will-change: transform; contain: layout }', 'app.css', options);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /dropped 'will-change'/);
    assert.match(warnings[1]!, /dropped 'contain'/);
    assert.deepEqual(placed('will-change: transform', 'h c', false).box, ABOVE);
  });

  it('is centred in the box above once a later rule says none or auto', () => {
    for (const [one, none] of [
      ['will-change: transform', 'will-change: auto'],
      ['contain: paint', 'contain: none'],
      ['perspective: 10px', 'perspective: none'],
      ['backdrop-filter: blur(1px)', 'backdrop-filter: none'],
    ]) {
      assert.deepEqual(placed(`${one} } .h.c.n { ${none}`, 'h c n').box, ABOVE, none);
    }
  });
});
