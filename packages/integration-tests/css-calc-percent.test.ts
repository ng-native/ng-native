/**
 * `calc()` of a percentage and a length: `width: calc(100% - 2rem)`. Yoga takes a number or a
 * percentage and has nothing for their sum, so the engine finishes it: it commits the box with
 * the declaration set aside, reads the box the percentage is of, and commits it at what the sum
 * comes to. Only the last commit is drawn.
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
  /** The props a view was last committed with. */
  const committed = (name: string): Record<string, unknown> => {
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === name ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(fabric.committed)!.props;
  };
  return { engine, fabric, nodes, box, committed };
}

const BASE = '.p { width: 300px; padding: 10px } .c { height: 10px }';

describe('a calc() of a percentage and a length', () => {
  it('sizes a box from the content box of the one it is in', () => {
    const s = scene(`${BASE} .c { width: calc(100% - 40px) }`, ['p', ['c']]);
    assert.deepEqual(s.box('c'), [10, 10, 240, 10]);
  });

  it('refuses a token with a percentage where the percentage is of no box', () => {
    const dropped: string[] = [];
    compileCss('.c { letter-spacing: calc(50% + var(--x)) }', 'app.css', {
      onUnsupported: (message: string) => dropped.push(message),
    });
    assert.equal(dropped.length, 1);
  });

  it('limits a box, as a maximum and as a minimum', () => {
    const css = `${BASE} .c { width: 400px; max-width: calc(100% - 32px) } .d { height: 5px; width: 20px; min-width: calc(50% + 10px) }`;
    const s = scene(css, ['p', ['c'], ['d']]);
    assert.equal(s.box('c')[2], 248);
    assert.equal(s.box('d')[2], 150);
  });

  it('is of the width for a margin and a padding, on every side', () => {
    const css = `${BASE} .c { width: 50px; margin-left: calc(50% - 20px); margin-top: calc(10% - 8px); padding-left: calc(10% + 2px) }`;
    const s = scene(css, ['p', ['c']]);
    // Half of 280 less 20, and a tenth of 280 less 8: the top margin is of the width too.
    assert.deepEqual(s.box('c'), [130, 30, 50, 10]);
  });

  it('places an out-of-flow box against the padding box it is placed in', () => {
    const css = `.p { position: relative; width: 300px; height: 200px; padding: 10px } .a { position: absolute; left: calc(100% - 50px); top: calc(50% - 5px); width: 10px; height: 10px }`;
    const s = scene(css, ['p', ['a']]);
    assert.deepEqual(s.box('a'), [250, 95, 10, 10]);
  });

  it('is of a height the box it is in was given, and is set aside where it was given none', () => {
    const css = `.p { width: 300px } .tall { height: 200px } .c { height: calc(100% - 50px) } .in { height: 30px } .b { display: block }`;
    const given = scene(css, ['p tall', ['c']]);
    assert.equal(given.box('c')[3], 150);
    // In a block in a block, nothing gives the box it is in a height: as tall as its content.
    const auto = scene(css, ['b', ['p b', ['c', ['in']]]]);
    assert.equal(auto.box('c')[3], 30);
  });

  // Measured in Chrome: a box in the screen's column is as tall as its content with the sum set
  // aside, and that height is then definite (CSS Flexbox 9.8), which the percentage is of.
  it('is of the height a column gave the box it is in, as tall as its content without it', () => {
    const css = `.c { height: calc(30% + 35px) } .s { height: 100px } .low { height: calc(100% - 50px) } .in { height: 30px }`;
    const s = scene(css, ['p', ['c'], ['s']]);
    assert.deepEqual([s.box('p')[3], s.box('c')[3], s.box('s')[1]], [100, 65, 65]);
    // Of a box only as tall as what is in it: 30 less 50 is no height.
    assert.equal(scene(css, ['p', ['low', ['in']]]).box('low')[3], 0);
  });

  it('makes a box held at the height of its content taller, which a share of its height is of', () => {
    // Chrome: the margin is 36 and 30% of the 400 wide screen, and the box it is in is held at
    // the 156 that comes to, half of which is the box's height.
    const css = `.c { height: 50%; margin-top: calc(36px + 30%) }`;
    const s = scene(css, ['p', ['c']]);
    assert.deepEqual([s.box('p')[3], s.box('c')[1], s.box('c')[3]], [156, 156, 78]);
  });

  it('is a least height and a basis of the height a column gave the box it is in', () => {
    const css = `.least { min-height: calc(50% + 10px) } .basis { flex-basis: calc(30px + 50%) } .s { height: 100px }`;
    // The least is its length alone while the box it is of is sized, and a basis is its content.
    const least = scene(css, ['p', ['least'], ['s']]);
    assert.deepEqual([least.box('p')[3], least.box('least')[3]], [110, 65]);
    const basis = scene(css, ['p', ['basis'], ['s']]);
    assert.deepEqual([basis.box('p')[3], basis.box('basis')[3]], [100, 80]);
  });

  it('follows the box it is of changing size, itself or from further up', () => {
    const css = `${BASE} .narrow { width: 200px } .c { width: calc(100% - 40px) } .g { width: 500px; padding: 0 } .small { width: 100px }`;
    const s = scene(css, ['p', ['c']]);
    assert.equal(s.box('c')[2], 240);
    s.engine.setClasses(s.nodes.get('p')!, 'p narrow');
    assert.equal(s.box('c')[2], 140);
    // A box that only its container's container resized, by a style bound on that alone:
    // nothing about the box or its parent was changed, and neither is merged again.
    const outer = scene(css, ['g', ['mid', ['c']]]);
    assert.equal(outer.box('c')[2], 460);
    outer.engine.setProp(outer.nodes.get('g')!, 'style', { width: 100 });
    assert.equal(outer.box('c')[2], 60);
  });

  it('gives the box its own size back when the declaration goes', () => {
    const css = `${BASE} .w { width: calc(100% - 40px) }`;
    const s = scene(css, ['p', ['c w']]);
    assert.equal(s.box('c w')[2], 240);
    s.engine.setClasses(s.nodes.get('c w')!, 'c');
    assert.equal(s.box('c w')[2], 280);
  });

  it('is of a box as wide as its content with the declaration set aside, and stays there', () => {
    // A dialog: a pane as wide as its content, whose content is held 32 points inside it.
    const css = `.pane { align-self: flex-start } .c { max-width: calc(100% - 32px) } .w { width: 200px; height: 10px }`;
    const s = scene(css, ['top', ['pane', ['c', ['w']]]]);
    assert.equal(s.box('c')[2], 168);
    assert.equal(s.engine.commit(), false);
    assert.equal(s.box('c')[2], 168);
    // Its content grows: the pane is measured again as its content makes it, and not from the
    // width the limit had left it at.
    s.engine.setProp(s.nodes.get('w')!, 'style', { width: 250 });
    assert.equal(s.box('c')[2], 218);
  });

  it('limits a grid that is as wide as its content, and keeps it there as it changes', () => {
    // A dialog's content: a grid in a pane as wide as that content, held 32 points inside it.
    const css = `.pane { align-self: flex-start } .g { display: grid; padding: 24px; max-width: calc(100% - 32px) } .in { width: 200px; height: 10px } .b { height: 20px }`;
    const s = scene(css, ['top', ['pane', ['g', ['w', ['in']], ['b']]]]);
    assert.equal(s.box('g')[2], 216);
    assert.equal(s.box('w')[2], 168);
    // Something in it changes, twice: it is measured again from its content each time, and
    // not from the width the limit left it at.
    s.engine.setProp(s.nodes.get('b')!, 'style', { height: 30 });
    assert.equal(s.box('g')[2], 216);
    s.engine.setProp(s.nodes.get('b')!, 'style', { height: 40 });
    assert.equal(s.box('g')[2], 216);
    assert.equal(s.box('w')[2], 168);
  });

  it('fits a pane to a grid that fills it, and limits the grid by the pane it then is', () => {
    // A dialog in the middle of the screen: a pane as wide as its content, a container that
    // fills the pane, and the dialog a grid that fills the container, sized by its border, with
    // its limit 32 points inside. A share of a width that is the content's own says nothing
    // about how wide the content is: the grid's column is as wide as its longest line.
    const css =
      '.top { position: absolute; top: 0; left: 0; width: 400px; height: 800px; display: flex; flex-direction: row; justify-content: center; align-items: center }' +
      ' .pane { display: flex; flex-direction: row; max-width: 100%; max-height: 100% }' +
      ' .box { display: block; width: 100%; max-height: 100% }' +
      ' .g { display: grid; box-sizing: border-box; width: 100%; max-width: calc(100% - 32px); gap: 24px; padding: 24px; margin-left: auto; margin-right: auto }' +
      ' .head { display: flex; flex-direction: column; gap: 8px }';
    const s = scene(css, ['top', ['pane', ['box', ['g', ['head', ['a'], ['b']], ['foot']]]]]);
    for (const [name, words] of [
      ['a', 'Delete file?'],
      ['b', 'This cannot be undone.'],
      ['foot', 'Delete'],
    ] as const) {
      const text = s.engine.createElement('text');
      s.engine.appendChild(text, s.engine.createText(words));
      s.engine.appendChild(s.nodes.get(name)!, text);
    }
    // Twenty-two characters at ten points, and the padding either side.
    assert.equal(s.box('pane')[2], 268);
    assert.equal(s.box('g')[2], 236);
    assert.equal(s.box('head')[2], 188);
  });

  it('fits a pane to a grid whose heading is a grid of its own', () => {
    // An alert dialog: the heading and what is said under it are in a grid inside the dialog's.
    // Each is as wide as its longest line, and so is the pane, up to the dialog's own limit.
    const css =
      '.top { position: absolute; top: 0; left: 0; width: 400px; height: 800px; display: flex; flex-direction: row; justify-content: center; align-items: center }' +
      ' .pane { display: flex; flex-direction: row; max-width: 100%; max-height: 100% }' +
      ' .box { display: block; width: 100%; max-height: 100% }' +
      ' .g { display: grid; box-sizing: border-box; width: 100%; max-width: 320px; gap: 24px; padding: 24px }' +
      ' .head { display: grid; gap: 6px }';
    const s = scene(css, ['top', ['pane', ['box', ['g', ['head', ['a'], ['b']], ['foot']]]]]);
    for (const [name, words] of [
      ['a', 'Are you absolutely sure?'],
      ['b', 'This cannot be undone.'],
      ['foot', 'Continue'],
    ] as const) {
      const text = s.engine.createElement('text');
      s.engine.appendChild(text, s.engine.createText(words));
      s.engine.appendChild(s.nodes.get(name)!, text);
    }
    // Twenty-four characters at ten points, and the padding either side.
    assert.equal(s.box('pane')[2], 288);
    assert.equal(s.box('head')[2], 240);
    assert.equal(s.box('a')[3], 20, 'on one line');
  });

  it('limits a box in a line that is fitted to its content, and keeps it there', () => {
    const css = `.pane { display: block; align-self: flex-start } .i { display: inline-flex; flex-direction: column; max-width: calc(100% - 32px) } .full { width: 100%; height: 5px } .w { width: 200px; height: 10px } .b { height: 20px }`;
    const s = scene(css, ['top', ['pane', ['i', ['full'], ['w']], ['b']]]);
    assert.equal(s.box('i')[2], 168);
    s.engine.setProp(s.nodes.get('full')!, 'style', { height: 6 });
    assert.equal(s.box('i')[2], 168);
    s.engine.setProp(s.nodes.get('full')!, 'style', { height: 7 });
    assert.equal(s.box('i')[2], 168);
    assert.equal(s.box('full')[2], 168);
    // The same with nothing in it that is sized from the room on offer.
    const plain = scene(css, ['top', ['pane', ['i', ['w']], ['b']]]);
    assert.equal(plain.box('i')[2], 168);
    plain.engine.setProp(plain.nodes.get('w')!, 'style', { height: 12 });
    assert.equal(plain.box('i')[2], 168);
  });

  it('reads the same sum set on the element as it does from a stylesheet', () => {
    const s = scene(BASE, ['p', ['c']]);
    s.engine.setProp(s.nodes.get('c')!, 'style', { width: 'calc(100% - 40px)' });
    assert.equal(s.box('c')[2], 240);
    s.engine.setProp(s.nodes.get('c')!, 'style', { width: 'calc(20px + 50%)' });
    assert.equal(s.box('c')[2], 160);
  });

  it('moves a box by a share of its own size and a length: a switch thumb sliding over', () => {
    // Tailwind's `translate-x-[calc(100%-2px)]`, which is a token read by `translate`.
    const css = `.thumb { width: 16px; height: 16px } .on { --tw-translate-x: calc(100% - 2px); translate: var(--tw-translate-x) 0 } .plain { translate: calc(50% + 1px) calc(100% - 4px) }`;
    const s = scene(css, ['track', ['thumb']]);
    const transform = () => {
      s.engine.commit();
      return s.committed('thumb')['transform'];
    };
    assert.equal(transform(), undefined);
    s.engine.setClasses(s.nodes.get('thumb')!, 'thumb on');
    assert.deepEqual(transform(), [{ translateX: 14 }, { translateY: 0 }]);
    s.engine.setClasses(s.nodes.get('thumb')!, 'thumb plain');
    assert.deepEqual(transform(), [{ translateX: 9 }, { translateY: 12 }]);
    // Its own size changes: the share is of the new one.
    s.engine.setProp(s.nodes.get('thumb')!, 'style', { width: 20 });
    assert.deepEqual(transform(), [{ translateX: 11 }, { translateY: 12 }]);
    s.engine.setClasses(s.nodes.get('thumb')!, 'thumb');
    assert.equal(transform() ?? null, null);
  });

  it('commits no such sum to a property that has no box for the percentage', () => {
    const css = `.c { --w: calc(100% - 2px); border-top-width: var(--w); width: var(--w); height: 10px }`;
    const s = scene(`.p { width: 300px } ${css}`, ['p', ['c']]);
    assert.equal(s.box('c')[2], 298);
    assert.notEqual(typeof s.committed('c')['borderTopWidth'], 'string');
  });

  it('settles in the commit it was changed in, with no pass left over', () => {
    const s = scene(`${BASE} .c { width: calc(100% - 40px) }`, ['p', ['c']]);
    assert.equal(s.engine.commit(), true);
    assert.equal(s.engine.commit(), false);
  });
});

describe('several boxes with a calc() of a percentage and a length', () => {
  // A page has one in every field and every track. Finished one at a time, each is two commits
  // of the whole tree.
  const CSS =
    '.p { width: 300px } .q { width: 200px } .c { height: 10px; width: calc(100% - 40px) } ' +
    '.d { height: 10px; width: calc(50% + 10px) }';
  const SPEC: Spec = ['root', ['p', ['c'], ['d']], ['q', ['c2'], ['d2', ['c3']]]];

  function built() {
    const s = scene(CSS, SPEC);
    s.engine.setClasses(s.nodes.get('c2')!, 'c c2');
    s.engine.setClasses(s.nodes.get('d2')!, 'd d2');
    s.engine.setClasses(s.nodes.get('c3')!, 'c c3');
    return s;
  }

  it('are finished together, and one inside another after it', () => {
    const s = built();
    s.engine.commit();
    // The commit itself, then two for the four that are in nothing waiting, and two for the one
    // that is.
    assert.equal(s.fabric.calls.completeRoot, 5);
  });

  it('are each the size they are finished at alone', () => {
    const s = built();
    assert.deepEqual(s.box('c'), [0, 0, 260, 10]);
    assert.deepEqual(s.box('d'), [0, 10, 160, 10]);
    assert.deepEqual(s.box('c2'), [0, 20, 160, 10]);
    assert.deepEqual(s.box('d2'), [0, 30, 110, 10]);
    assert.deepEqual(s.box('c3'), [0, 30, 70, 10]);
  });
});

describe('a basis that is a calc() of a percentage and a length', () => {
  // A splitter's panels: `flex-basis: calc(25% - 4px)` and `calc(75% - 4px)`, with a gutter of
  // eight points between them, each a share of the row less its half of the gutter.
  const CSS =
    '.p { display: flex; flex-direction: row; width: 300px; height: 100px } ' +
    '.a { flex-grow: 1; flex-basis: calc(25% - 4px); height: 10px } .g { width: 8px; height: 10px } ' +
    '.b { flex-grow: 1; flex-basis: calc(75% - 4px); height: 10px } ' +
    '.col { flex-direction: column } .col .a, .col .b { height: auto } .col .g { height: 8px }';

  it('is a share of the row it is in, along the row', () => {
    const s = scene(CSS, ['p', ['a'], ['g'], ['b']]);
    assert.deepEqual(s.box('a'), [0, 0, 71, 10]);
    assert.deepEqual(s.box('b'), [79, 0, 221, 10]);
    // As a width: a basis that changes after a view's first layout is one React Native keeps
    // the old answer for, and this one is only known after it.
    assert.deepEqual([s.committed('a')['width'], s.committed('a')['flexBasis']], [71, undefined]);
  });

  it('is a share of a column’s height, down the column', () => {
    const s = scene(CSS, ['p col', ['a'], ['g'], ['b']]);
    assert.equal(s.box('a')[3], 21);
    assert.equal(s.box('b')[3], 71);
  });
});
