/**
 * `display: block`, which Yoga has no layout for. A block container's children already sit where
 * a flex column puts them, so the engine commits it as one and settles what a column does
 * differently before layout: adjoining vertical margins collapse, the container and its children
 * have no use for flex properties, and a container of inline-blocks lays them out in lines.
 *
 * Each of those depends on a box's siblings, so each has to follow a sibling changing and a
 * sibling going away.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, registerHoist, registerViewName, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A tree of views, each named by its classes: `['p', ['a'], ['b']]` is `.p` holding two. */
type Spec = [classes: string, ...children: Spec[]];

function scene(css: string, spec: Spec) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const nodes = new Map<string, EngineNode>();
  const build = ([classes, ...children]: Spec, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    nodes.set(classes, node);
    for (const child of children) build(child, node);
    return node;
  };
  build(spec, engine.root);
  /** The committed props of the view with these classes when it was made. */
  const props = (name: string): Record<string, unknown> => {
    engine.commit();
    const find = (all: FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        if (each.props['nativeID'] === name) return each;
        const below = find(each.children);
        if (below) return below;
      }
      return undefined;
    };
    const found = find(fabric.committed);
    assert.ok(found, `no committed view ${name}`);
    return found.props;
  };
  const margins = (name: string) => {
    const { marginTop, marginBottom } = props(name);
    return [marginTop ?? 0, marginBottom ?? 0];
  };
  return { reports, engine, fabric, nodes, build, props, margins };
}

const STACK = '.a { margin-bottom: 20px } .b { margin-top: 10px; margin-bottom: 5px }';

describe('display: block', () => {
  it('is committed as flex, which is the only layout native has', () => {
    const s = scene('.p { display: block }', ['p']);
    assert.equal(s.props('p')['display'], 'flex');
    assert.deepEqual(s.reports, []);
  });

  it('collapses the margins between two of its children into the larger', () => {
    const s = scene(`.p { display: block } ${STACK}`, ['p', ['a'], ['b']]);
    assert.deepEqual(s.margins('a'), [0, 0]);
    assert.deepEqual(s.margins('b'), [20, 5]);
  });

  it('leaves margins as written in a flex container, where they add', () => {
    const s = scene(STACK, ['p', ['a'], ['b']]);
    assert.deepEqual(s.margins('a'), [0, 20]);
    assert.deepEqual(s.margins('b'), [10, 5]);
  });

  it('adds a negative margin to the largest positive one', () => {
    const s = scene('.p { display: block } .a { margin-bottom: 20px } .b { margin-top: -5px }', [
      'p',
      ['a'],
      ['b'],
    ]);
    assert.deepEqual(s.margins('b'), [15, 0]);
  });

  it('follows a child whose margin changes', () => {
    const s = scene(`.p { display: block } ${STACK} .big { margin-top: 40px }`, [
      'p',
      ['a'],
      ['b'],
    ]);
    assert.deepEqual(s.margins('b'), [20, 5]);
    s.engine.setClasses(s.nodes.get('b')!, 'big');
    assert.deepEqual(s.margins('b'), [40, 0]);
  });

  it('follows the sibling before it changing, though nothing about the box itself did', () => {
    const s = scene(`.p { display: block } ${STACK} .huge { margin-bottom: 50px }`, [
      'p',
      ['a'],
      ['b'],
    ]);
    assert.deepEqual(s.margins('b'), [20, 5]);
    s.engine.setClasses(s.nodes.get('a')!, 'huge');
    assert.deepEqual(s.margins('b'), [50, 5]);
  });

  it('gives a box its own margin back when the sibling before it goes away', () => {
    const s = scene(`.p { display: block } ${STACK}`, ['p', ['a'], ['b']]);
    assert.deepEqual(s.margins('b'), [20, 5]);
    s.engine.removeChild(s.nodes.get('p')!, s.nodes.get('a')!);
    assert.deepEqual(s.margins('b'), [10, 5]);
  });

  it('collapses with a sibling added after the first commit', () => {
    const s = scene(`.p { display: block } ${STACK} .c { margin-top: 30px }`, ['p', ['a'], ['b']]);
    assert.deepEqual(s.margins('b'), [20, 5]);
    s.build(['c'], s.nodes.get('p')!);
    assert.deepEqual(s.margins('b'), [20, 0]);
    assert.deepEqual(s.margins('c'), [30, 0]);
  });

  it('gives every margin back when the container stops being a block', () => {
    const s = scene(`.p { display: block } .q { display: flex } ${STACK}`, ['p', ['a'], ['b']]);
    assert.deepEqual(s.margins('b'), [20, 5]);
    s.engine.setClasses(s.nodes.get('p')!, 'q');
    assert.deepEqual(s.margins('a'), [0, 20]);
    assert.deepEqual(s.margins('b'), [10, 5]);
  });

  it('collapses when the container becomes a block after the first commit', () => {
    const s = scene(`.q { display: block } ${STACK}`, ['p', ['a'], ['b']]);
    assert.deepEqual(s.margins('b'), [10, 5]);
    s.engine.setClasses(s.nodes.get('p')!, 'q');
    assert.deepEqual(s.margins('a'), [0, 0]);
    assert.deepEqual(s.margins('b'), [20, 5]);
  });

  it('follows a display token, as it follows the keyword written out', () => {
    const s = scene(`.p { --d: block; display: var(--d) } ${STACK}`, ['p', ['a'], ['b']]);
    assert.equal(s.props('p')['display'], 'flex');
    assert.deepEqual(s.margins('b'), [20, 5]);
  });

  it('keeps every margin as written beside a percentage one, which is not known yet', () => {
    const s = scene('.p { display: block } .a { margin-bottom: 10% } .b { margin-top: 10px }', [
      'p',
      ['a'],
      ['b'],
    ]);
    assert.equal(s.props('a')['marginBottom'], '10%');
    assert.deepEqual(s.margins('b'), [10, 0]);
  });

  it('skips a child out of the flow, and one that is not displayed', () => {
    const css = `.p { display: block } ${STACK} .x { position: absolute; margin-top: 99px } .y { display: none; margin-top: 99px }`;
    const s = scene(css, ['p', ['a'], ['x'], ['y'], ['b']]);
    assert.deepEqual(s.margins('b'), [20, 5]);
    assert.equal(s.props('x')['marginTop'], 99);
  });
});

describe('a block set and moved in other ways', () => {
  it('collapses under a display bound on the element, as under one in a stylesheet', () => {
    const s = scene(STACK, ['p', ['a'], ['b']]);
    assert.deepEqual(s.margins('b'), [10, 5]);
    s.engine.setProp(s.nodes.get('p')!, 'style', { display: 'block' });
    assert.equal(s.props('p')['display'], 'flex');
    assert.deepEqual(s.margins('b'), [20, 5]);
    s.engine.setProp(s.nodes.get('p')!, 'style', { display: 'flex' });
    assert.deepEqual(s.margins('b'), [10, 5]);
  });

  it('gives a box its margins and flex back when it moves to a flex container as its block goes', () => {
    const css = `.p { display: block } ${STACK} .b { flex-grow: 1 }`;
    const s = scene(css, ['top', ['p', ['a'], ['b']], ['q']]);
    assert.deepEqual(s.margins('b'), [20, 5]);
    assert.equal('flexGrow' in s.props('b'), false);
    // The block leaves the tree in the same pass, so it is never planned again.
    s.engine.removeChild(s.nodes.get('p')!, s.nodes.get('b')!);
    s.engine.removeChild(s.nodes.get('top')!, s.nodes.get('p')!);
    s.engine.appendChild(s.nodes.get('q')!, s.nodes.get('b')!);
    assert.deepEqual(s.margins('b'), [10, 5]);
    assert.equal(s.props('b')['flexGrow'], 1);
  });

  it('skips a child that is committed somewhere else, which is laid out there', () => {
    registerViewName('flow-test-target', 'View');
    registerViewName('flow-test-hoisted', 'View');
    registerHoist('flow-test-hoisted', 'flow-test-target');
    const s = scene(`.p { display: block } ${STACK} .h { margin-top: 99px; margin-bottom: 99px }`, [
      'top',
    ]);
    const add = (name: string, classes: string, parent: EngineNode) => {
      const node = s.engine.createElement(name);
      s.engine.setClasses(node, classes);
      s.engine.setProp(node, 'nativeID', classes);
      s.engine.appendChild(parent, node);
      return node;
    };
    const target = add('flow-test-target', 'target', s.nodes.get('top')!);
    const block = add('view', 'p', target);
    add('view', 'a', block);
    add('flow-test-hoisted', 'h', block);
    add('view', 'b', block);
    assert.deepEqual(s.margins('b'), [20, 5]);
  });

  it('plans nothing for a text element, which lays out text and not boxes', () => {
    const s = scene('.t { display: block } .a { margin-bottom: 20px; flex-grow: 1 }', ['top']);
    const text = s.engine.createElement('text');
    s.engine.setClasses(text, 't');
    s.engine.setProp(text, 'nativeID', 't');
    s.engine.appendChild(s.nodes.get('top')!, text);
    const run = s.engine.createElement('text');
    s.engine.setClasses(run, 'a');
    s.engine.setProp(run, 'nativeID', 'a');
    s.engine.appendChild(text, run);
    assert.equal(s.props('t')['display'], 'flex');
    assert.equal(s.props('a')['marginBottom'], 20);
    assert.equal(s.props('a')['flexGrow'], 1);
  });
});

describe('a block inside a block', () => {
  const NESTED =
    '.p { display: block } .mid { display: block; margin-top: 10px } .in { margin-top: 30px } .a { margin-bottom: 5px }';

  it("collapses its first child's margin with its own, and carries the result itself", () => {
    const s = scene(NESTED, ['p', ['a'], ['mid', ['in']]]);
    assert.deepEqual(s.margins('mid'), [30, 0]);
    assert.deepEqual(s.margins('in'), [0, 0]);
  });

  it('collapses through an empty block, whose own margins meet', () => {
    const css =
      '.p { display: block } .a { margin-bottom: 20px } .e { display: block; margin-top: 5px; margin-bottom: 30px } .b { margin-top: 10px }';
    const s = scene(css, ['p', ['a'], ['e'], ['b']]);
    // 20, 5, 30 and 10 all adjoin, and come to 30: 20 above the empty block and 10 under it.
    assert.deepEqual(s.margins('e'), [20, 0]);
    assert.deepEqual(s.margins('b'), [10, 0]);
  });

  it('keeps the two apart once padding separates them', () => {
    const s = scene(`${NESTED} .pad { padding-top: 1px }`, ['p', ['a'], ['mid', ['in']]]);
    assert.deepEqual(s.margins('mid'), [30, 0]);
    s.engine.setClasses(s.nodes.get('mid')!, 'mid pad');
    assert.deepEqual(s.margins('mid'), [10, 0]);
    assert.deepEqual(s.margins('in'), [30, 0]);
  });

  it("follows the inner child's margin changing", () => {
    const s = scene(`${NESTED} .small { margin-top: 2px }`, ['p', ['a'], ['mid', ['in']]]);
    assert.deepEqual(s.margins('mid'), [30, 0]);
    s.engine.setClasses(s.nodes.get('in')!, 'small');
    assert.deepEqual(s.margins('mid'), [10, 0]);
  });

  it("keeps its children's margins inside it in a flex container", () => {
    const s = scene('.mid { display: block; margin-top: 10px } .in { margin-top: 30px }', [
      'p',
      ['mid', ['in']],
    ]);
    assert.deepEqual(s.margins('mid'), [10, 0]);
    assert.deepEqual(s.margins('in'), [30, 0]);
  });
});

describe('flex properties on a block', () => {
  it('drops the container properties a block has no use for', () => {
    const css =
      '.p { display: block; flex-direction: row; justify-content: center; align-items: center; gap: 8px }';
    const props = scene(css, ['p', ['a']]).props('p');
    for (const key of [
      'flexDirection',
      'justifyContent',
      'alignItems',
      'gap',
      'rowGap',
      'columnGap',
    ]) {
      assert.equal(key in props, false, key);
    }
  });

  it('keeps them once the container is a flex container again', () => {
    const s = scene(
      '.p { display: block; flex-direction: row } .q { display: flex; flex-direction: row }',
      ['p', ['a']],
    );
    assert.equal('flexDirection' in s.props('p'), false);
    s.engine.setClasses(s.nodes.get('p')!, 'q');
    assert.equal(s.props('p')['flexDirection'], 'row');
  });

  it('drops the item properties of a child in the flow, and keeps them on one out of it', () => {
    const css =
      '.p { display: block } .a { flex-grow: 1; align-self: center } .x { position: absolute; align-self: center }';
    const s = scene(css, ['p', ['a'], ['x']]);
    assert.equal('flexGrow' in s.props('a'), false);
    assert.equal('alignSelf' in s.props('a'), false);
    assert.equal(s.props('x')['alignSelf'], 'center');
  });
});

describe('an inline-level box in a block', () => {
  it('is as wide as its content, in a line box of its own, where a block fills the width', () => {
    const css = '.p { display: block } .i { display: inline-flex } .b { height: 10px }';
    // On a line of its own, between blocks: the line box is a row, which does not stretch the
    // box across the width, and holds the line at least as tall as its strut.
    const s = scene(css, ['p', ['b'], ['i'], ['b two']]);
    s.engine.commit();
    const lines = s.fabric.committed[0]!.children.filter((each) => !each.props['nativeID']);
    assert.deepEqual(
      lines.map((line) => [line.props['flexDirection'], line.children[0]!.props['nativeID']]),
      [['row', 'i']],
    );
    assert.equal('alignSelf' in s.props('i'), false);
    assert.equal('alignSelf' in s.props('b'), false);
    assert.equal(s.props('i')['display'], 'flex');
  });

  it('keeps its own margins, under the margin of the blocks before its line', () => {
    const css =
      '.p { display: block } .a { margin-bottom: 20px } .i { display: inline-flex; margin-top: 10px; margin-bottom: 4px } .b { margin-top: 6px }';
    const s = scene(css, ['p', ['a'], ['i'], ['b']]);
    // An empty flex box sits on the baseline by its border box: its own margin, deeper than
    // the room under the baseline, is that room. Over it, its margin is the room over the
    // baseline, 13.3 of the default font: see `riseLines`.
    assert.deepEqual(s.margins('i'), [13.3, 4]);
    s.engine.commit();
    const line = s.fabric.committed[0]!.children[1]!;
    assert.equal(line.props['marginTop'], 20);
    assert.deepEqual(s.margins('b'), [6, 0]);
  });

  it('stretches as any flex item does in a flex container', () => {
    const s = scene('.i { display: inline-flex }', ['p', ['i']]);
    assert.equal('alignSelf' in s.props('i'), false);
    assert.equal(s.props('i')['display'], 'flex');
  });

  it('sits in a line with others when a block holds nothing else', () => {
    const css = '.p { display: block } .i { display: inline-flex } .k { display: inline-block }';
    const s = scene(css, ['p', ['i'], ['k']]);
    assert.equal(s.props('p')['flexDirection'], 'row');
    assert.equal(s.props('p')['flexWrap'], 'wrap');
  });
});

describe('order', () => {
  const tree = (s: ReturnType<typeof scene>) => {
    s.engine.commit();
    return s.fabric.committed[0]!.children.map((node) => node.props['nativeID']);
  };

  it('commits the children of a flex container in the order it gives, and not as written', () => {
    const s = scene('.b { order: -1 } .c { order: 2 }', ['p', ['a'], ['c'], ['b'], ['d']]);
    assert.deepEqual(tree(s), ['b', 'a', 'd', 'c']);
    assert.equal('order' in s.props('b'), false);
  });

  it('follows a child whose order changes, and one that loses it', () => {
    const s = scene('.b { order: -1 } .last { order: 5 }', ['p', ['a'], ['b'], ['c']]);
    assert.deepEqual(tree(s), ['b', 'a', 'c']);
    s.engine.setClasses(s.nodes.get('b')!, 'last');
    assert.deepEqual(tree(s), ['a', 'c', 'b']);
    s.engine.setClasses(s.nodes.get('b')!, '');
    assert.deepEqual(tree(s), ['a', 'b', 'c']);
  });

  it('is nothing in a block, which lays its children out as written', () => {
    const s = scene('.p { display: block } .b { order: -1 }', ['p', ['a'], ['b']]);
    assert.deepEqual(tree(s), ['a', 'b']);
  });
});

describe('a block of inline-blocks', () => {
  const LINE = '.p { display: block } .i { display: inline-block; width: 50px; height: 20px }';

  it('lays them out in lines: a row that wraps', () => {
    const s = scene(LINE, ['p', ['i'], ['i two']]);
    const props = s.props('p');
    assert.equal(props['flexDirection'], 'row');
    assert.equal(props['flexWrap'], 'wrap');
    assert.equal(s.props('i')['display'], 'flex');
  });

  it('is a column again once a block joins them', () => {
    const s = scene(`${LINE} .b { height: 10px }`, ['p', ['i'], ['i two']]);
    assert.equal(s.props('p')['flexDirection'], 'row');
    s.build(['b'], s.nodes.get('p')!);
    // Taken back: a prop that goes away is sent to native as null.
    assert.equal(s.props('p')['flexDirection'], null);
    assert.equal(s.props('p')['flexWrap'], null);
  });
});

describe('a block of a set height that clips what it holds', () => {
  // Yoga measures a column's child to fit the column's own height, and text measured to fit a
  // height of nothing is nothing tall: a closed panel's words, which the library opening it
  // measures. A column that scrolls is the one Yoga measures the children of as tall as they
  // are, and a view that scrolls clips as one that hides does.
  const PANEL = `
    .p { display: block; height: 0; overflow: hidden }
    .p.open { height: auto }
    .p.shown { overflow: visible }
    .row { display: flex; flex-direction: row; height: 0; overflow: hidden }
  `;

  it('has what it holds measured as tall as it is', () => {
    const s = scene(PANEL, ['p', ['a']]);
    assert.equal(s.props('p')['overflow'], 'scroll');
  });

  it('follows its height going away, and its clipping', () => {
    const s = scene(PANEL, ['p', ['a']]);
    const p = s.nodes.get('p')!;
    s.engine.setClasses(p, 'p open');
    assert.equal(s.props('p')['overflow'], 'hidden', 'as tall as what it holds already');
    s.engine.setClasses(p, 'p');
    assert.equal(s.props('p')['overflow'], 'scroll');
    s.engine.setClasses(p, 'p shown');
    assert.equal(s.props('p')['overflow'] ?? 'visible', 'visible');
  });

  it('leaves a row alone, whose words a row that scrolls would never wrap', () => {
    const s = scene(PANEL, ['row', ['a']]);
    assert.equal(s.props('row')['overflow'], 'hidden');
  });
});

describe('align-content on a block', () => {
  // A block places what it holds along its height by `align-content`, which is how a browser
  // has a button's label in the middle of a button taller than it.
  const BOX = `
    .p { display: block; height: 40px; align-content: center }
    .p.end { align-content: end }
    .p.none { align-content: normal }
    .i { display: inline-block; width: 10px; height: 10px }
  `;

  it('is where the column a block is puts its children', () => {
    const s = scene(BOX, ['p', ['a']]);
    assert.equal(s.props('p')['justifyContent'], 'center');
    assert.equal(s.props('p')['alignContent'], undefined);
  });

  it('follows it changing, and going away', () => {
    const s = scene(BOX, ['p', ['a']]);
    const p = s.nodes.get('p')!;
    s.engine.setClasses(p, 'p end');
    assert.equal(s.props('p')['justifyContent'], 'flex-end');
    s.engine.setClasses(p, 'p none');
    assert.equal(s.props('p')['justifyContent'] ?? null, null);
  });

  it('is where the lines of a block of them sit, in the rows they are', () => {
    const s = scene(BOX, ['p', ['i'], ['i two']]);
    assert.equal(s.props('p')['alignContent'], 'center');
    assert.equal(s.props('p')['justifyContent'] ?? null, null);
  });
});

describe('a block that ends in an empty block after a line of boxes', () => {
  // What markup with a line break at its end is: `<b>one</b> <i>two</i><br>`.
  const CSS =
    '.p { display: block } .i { display: inline-block; width: 50px; height: 20px } ' +
    '.e { display: block; margin-bottom: 8px }';

  it('is laid out, with the line where it was', () => {
    const s = scene(CSS, ['p', ['i one'], ['i two'], ['e']]);
    assert.doesNotThrow(() => s.props('p'));
    assert.equal(s.props('i one')['width'], 50);
  });
});
