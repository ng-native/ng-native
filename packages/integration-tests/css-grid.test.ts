/**
 * `display: grid`, which Yoga has no layout for. The engine lays a grid out itself: it commits
 * the container, reads its width and its items' sizes back from Fabric in the same task, and
 * commits each item where the grid puts it. Only the last of those commits reaches the screen.
 *
 * The fabric here lays out with Yoga and answers `getBoundingClientRect`, as a device does.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { createLaidOutFabric, SCREEN } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

type Spec = [classes: string, ...children: (Spec | string)[]];

function scene(css: string, spec: Spec, fabric = createLaidOutFabric()) {
  const sheet = compileCss(css, 'app.css');
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const nodes = new Map<string, EngineNode>();
  const build = ([classes, ...children]: Spec, parent: EngineNode): EngineNode => {
    const text = children.find((child): child is string => typeof child === 'string');
    const node = engine.createElement(text === undefined ? 'view' : 'text');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    nodes.set(classes, node);
    if (text !== undefined) engine.appendChild(node, engine.createText(text));
    for (const child of children) if (typeof child !== 'string') build(child, node);
    return node;
  };
  build(spec, engine.root);
  const box = (name: string) => {
    engine.commit();
    const { left, top, width, height } = fabric.box(name);
    return [left, top, width, height];
  };
  return { engine, fabric, nodes, build, box };
}

const CELLS = '.a { height: 30px } .b { height: 50px } .c { height: 20px } .d { height: 10px }';
const FOUR: Spec = ['g', ['a'], ['b'], ['c'], ['d']];

describe('display: grid', () => {
  it('places items in fixed columns, in rows as tall as their tallest item', () => {
    const s = scene(`.g { display: grid; grid-template-columns: 100px 150px } ${CELLS}`, FOUR);
    assert.deepEqual(s.box('a'), [0, 0, 100, 30]);
    assert.deepEqual(s.box('b'), [100, 0, 150, 50]);
    assert.deepEqual(s.box('c'), [0, 50, 100, 20]);
    assert.deepEqual(s.box('d'), [100, 50, 150, 10]);
  });

  it('is as tall as its rows, so what follows it sits under it', () => {
    const css = `.g { display: grid; grid-template-columns: 100px 150px } ${CELLS} .after { height: 5px }`;
    const s = scene(css, ['top', FOUR, ['after']]);
    assert.deepEqual(s.box('g'), [0, 0, 400, 70]);
    assert.deepEqual(s.box('after'), [0, 70, 400, 5]);
  });

  it('is as tall as its rows where its height is written as its content: fit-content', () => {
    // A toast: `height: fit-content` on a grid placed out of the flow, which is no height.
    const css = `.g { display: grid; grid-template-columns: 100px 150px; height: fit-content; position: absolute; padding: 5px } ${CELLS}`;
    const s = scene(css, ['top', FOUR]);
    assert.deepEqual(s.box('g').slice(2), [260, 80]);
  });

  it('shares its width between fr columns, less the gaps', () => {
    const css = `.g { display: grid; grid-template-columns: 1fr 3fr; gap: 20px } ${CELLS}`;
    const s = scene(css, FOUR);
    assert.deepEqual(s.box('a'), [0, 0, 95, 30]);
    assert.deepEqual(s.box('b'), [115, 0, 285, 50]);
    assert.deepEqual(s.box('c'), [0, 70, 95, 20]);
  });

  it('lays out inside its padding', () => {
    const css = `.g { display: grid; grid-template-columns: 1fr 1fr; padding: 10px } ${CELLS}`;
    const s = scene(css, FOUR);
    assert.deepEqual(s.box('a'), [10, 10, 190, 30]);
    assert.deepEqual(s.box('d'), [200, 60, 190, 10]);
    assert.deepEqual(s.box('g'), [0, 0, 400, 90]);
  });

  it('spans an item over the columns it names', () => {
    const css = `.g { display: grid; grid-template-columns: repeat(3, 100px) } .a { grid-column: span 2 } ${CELLS}`;
    const s = scene(css, FOUR);
    assert.deepEqual(s.box('a'), [0, 0, 200, 30]);
    assert.deepEqual(s.box('b'), [200, 0, 100, 50]);
    assert.deepEqual(s.box('c'), [0, 50, 100, 20]);
  });

  it('makes a row as tall as the text in it, wrapped at its column', () => {
    const css = '.g { display: grid; grid-template-columns: 100px 1fr }';
    const s = scene(css, ['g', ['t', 'aaaa bbbb cccc dddd'], ['u', 'short']]);
    // Nineteen characters at ten points wrap to two lines of nine in a hundred points.
    assert.deepEqual(s.box('t'), [0, 0, 100, 40]);
    assert.deepEqual(s.box('u'), [100, 0, 300, 40]);
  });

  it('sizes an auto column to the content in it', () => {
    const css = '.g { display: grid; grid-template-columns: auto 1fr }';
    const s = scene(css, ['g', ['t', 'label'], ['u', 'x']]);
    assert.deepEqual(s.box('t'), [0, 0, 50, 20]);
    assert.deepEqual(s.box('u'), [50, 0, 350, 20]);
  });

  it('places items in the areas a template names, wherever they are written', () => {
    const css = `.g { display: grid; grid-template-areas: "head head" "side main"; grid-template-columns: 100px 200px; grid-template-rows: 20px 40px } .a { grid-area: main } .b { grid-area: head } .c { grid-area: side }`;
    const s = scene(css, ['g', ['a'], ['b'], ['c']]);
    assert.deepEqual(s.box('a'), [100, 20, 200, 40]);
    assert.deepEqual(s.box('b'), [0, 0, 300, 20]);
    assert.deepEqual(s.box('c'), [0, 20, 100, 40]);
  });

  it('places them again when the template names other areas, and when it names none', () => {
    const css = `.g { display: grid; grid-template-areas: "x y"; grid-template-columns: 100px 200px; grid-auto-rows: 20px } .swap { grid-template-areas: "y x" } .none { grid-template-areas: none } .a { grid-area: x } .b { grid-area: y }`;
    const s = scene(css, ['g', ['a'], ['b']]);
    assert.deepEqual(s.box('a'), [0, 0, 100, 20]);
    s.engine.setClasses(s.nodes.get('g')!, 'g swap');
    assert.deepEqual(s.box('a'), [100, 0, 200, 20]);
    assert.deepEqual(s.box('b'), [0, 0, 100, 20]);
    // No area of either name: a name no line has is the first line past the template's, on
    // both axes, so each is in a track of its own beyond one left empty.
    s.engine.setClasses(s.nodes.get('g')!, 'g none');
    assert.deepEqual(s.box('a'), [350, 20, 50, 20]);
    assert.deepEqual(s.box('b'), [350, 20, 50, 20]);
  });

  it('places an item by the names of lines, and by the one counted to', () => {
    const css = `.g { display: grid; grid-template-columns: [full-start] 20px [content-start] 60px [content-end] repeat(2, [col] 10px) [full-end]; grid-auto-rows: 10px } .a { grid-column: content } .b { grid-column: full-start / full-end } .c { grid-column: col 2 / full-end }`;
    const s = scene(css, ['g', ['a'], ['b'], ['c']]);
    assert.deepEqual(s.box('a'), [20, 0, 60, 10]);
    assert.deepEqual(s.box('b'), [0, 10, 100, 10]);
    assert.deepEqual(s.box('c'), [90, 20, 10, 10]);
  });

  it('keeps an item to its aspect ratio, where a stretched item would fill its row', () => {
    const css = `.g { display: grid; width: 100px; height: 100px } .a { aspect-ratio: 2 }`;
    assert.deepEqual(scene(css, ['g', ['a']]).box('a'), [0, 0, 100, 50]);
    // From a width of its own, and from a height of its own.
    const sized = `${css} .a { width: 50px } .b { height: 30px; aspect-ratio: 2 }`;
    const s = scene(sized, ['g', ['a'], ['b']]);
    assert.deepEqual(s.box('a'), [0, 0, 50, 25]);
    assert.equal(s.box('b')[2], 60);
    // A height the ratio makes too tall is held to its maximum, and the width follows it.
    const capped = `${css} .a { max-height: 20px }`;
    assert.deepEqual(scene(capped, ['g', ['a']]).box('a'), [0, 0, 40, 20]);
  });

  it('lines up the baselines of the items in a row, each row as tall as that needs', () => {
    const css = `.g { display: grid; grid-template-columns: 50px 50px; align-items: baseline; width: 100px } .tall { height: 50px } .short { height: 20px } .in { height: 10px } .own { align-self: start }`;
    const s = scene(css, ['g', ['tall'], ['short', ['in']], ['short b', ['in b']], ['tall b']]);
    // An empty box's baseline is its bottom edge, and a box's is that of the first box in it.
    assert.deepEqual(s.box('tall'), [0, 0, 50, 50]);
    assert.deepEqual(s.box('short'), [50, 40, 50, 20]);
    // The first row is as tall as the lowered box reaches, and the second starts under it.
    assert.deepEqual(s.box('short b'), [0, 100, 50, 20]);
    assert.deepEqual(s.box('tall b'), [50, 60, 50, 50]);
    // An item that asks for the start is left there.
    s.engine.setClasses(s.nodes.get('short')!, 'short own');
    assert.deepEqual(s.box('short'), [50, 0, 50, 20]);
    assert.deepEqual(s.box('short b'), [0, 90, 50, 20]);
  });

  it('aligns an item in its area', () => {
    const css = `.g { display: grid; grid-template-columns: 200px; grid-template-rows: 100px } .a { width: 40px; justify-self: center; align-self: end; height: 30px }`;
    assert.deepEqual(scene(css, ['g', ['a']]).box('a'), [80, 70, 40, 30]);
  });

  it('places its items in itself when it is not positioned, as a browser does', () => {
    // A static box is not what an out-of-flow box is placed against, and the items are placed
    // out of the flow: left alone they would land in whatever further up is positioned.
    const css = `.off { margin-top: 100px; margin-left: 50px; width: 300px } .lead { height: 40px } .g { display: grid; position: static; grid-template-columns: 100px 150px } ${CELLS}`;
    const s = scene(css, ['off', ['lead'], FOUR]);
    assert.deepEqual(s.box('a'), [50, 140, 100, 30]);
    assert.deepEqual(s.box('d'), [150, 190, 150, 10]);
  });

  it('settles in the commit it was changed in, with no pass left over', () => {
    const s = scene(`.g { display: grid; grid-template-columns: 1fr 1fr } ${CELLS}`, FOUR);
    assert.equal(s.engine.commit(), true);
    assert.equal(s.engine.commit(), false);
  });
});

describe('a grid track as narrow as its content', () => {
  it('sizes a min-content column to the longest word in it, and wraps the rest', () => {
    const css = '.g { display: grid; grid-template-columns: min-content 1fr }';
    const s = scene(css, ['g', ['t', 'aaaa bbbbbb cc'], ['u', 'x']]);
    assert.deepEqual(s.box('t'), [0, 0, 60, 60]);
    assert.deepEqual(s.box('u'), [60, 0, 340, 60]);
  });

  it('takes the widest of the words of every item in the column', () => {
    const css = '.g { display: grid; grid-template-columns: min-content 1fr }';
    const s = scene(css, ['g', ['t', 'aa bb'], ['u', 'x'], ['v', 'cccccccc d'], ['w', 'y']]);
    assert.equal(s.box('t')[2], 80);
    assert.equal(s.box('v')[2], 80);
  });

  it('lets fit-content shrink a column to its content, down to its longest word', () => {
    const css =
      '.w { width: 150px } .g { display: grid; grid-template-columns: fit-content(300px) 100px }';
    const s = scene(css, ['w', ['g', ['t', 'aaaa bbbb cccc'], ['u', 'x']]]);
    // 150 wide, 100 of it taken: the first column has 50, which fits its longest word.
    assert.deepEqual(s.box('t'), [0, 0, 50, 60]);
  });

  it('shows the text as it was written once it has been measured', () => {
    const css = '.g { display: grid; grid-template-columns: min-content 1fr }';
    const s = scene(css, ['g', ['t', 'aaaa bbbbbb cc'], ['u', 'x']]);
    s.box('t');
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined =>
      all
        .flatMap((node) => (node.props['nativeID'] === 't' ? [node] : [find(node.children)]))
        .find(Boolean);
    assert.equal(find(s.fabric.committed)!.children[0]!.props['text'], 'aaaa bbbbbb cc');
  });

  it('follows the text changing', () => {
    const css = '.g { display: grid; grid-template-columns: min-content 1fr }';
    const s = scene(css, ['g', ['t', 'aaaa bb'], ['u', 'x']]);
    assert.equal(s.box('t')[2], 40);
    s.engine.setText(s.nodes.get('t')!.childList[0]!, 'aaaaaaaaa bb');
    assert.equal(s.box('t')[2], 90);
  });
});

describe('a grid nothing gives a width', () => {
  const START = '.start { align-items: flex-start }';

  it('is as wide as its columns come to, where it would not be stretched', () => {
    const css = `${START} .g { display: grid; grid-template-columns: 100px 150px; gap: 10px } ${CELLS}`;
    const s = scene(css, ['start', FOUR]);
    assert.deepEqual(s.box('g'), [0, 0, 260, 80]);
    assert.deepEqual(s.box('b'), [110, 0, 150, 50]);
  });

  it('is as wide as its content wants in one column, as a centred dialog is', () => {
    const css = '.mid { align-items: center } .g { display: grid; gap: 10px; padding: 20px }';
    const s = scene(css, ['mid', ['g', ['t', 'a title'], ['u', 'a longer line of text']]]);
    // Twenty-one characters at ten points, and the padding on each side.
    assert.deepEqual(s.box('g'), [75, 0, 250, 90]);
    assert.deepEqual(s.box('t'), [95, 20, 210, 20]);
    assert.deepEqual(s.box('u'), [95, 50, 210, 20]);
  });

  it('is no wider than what holds it, and wraps its content there', () => {
    const css = `${START} .box { width: 150px; padding: 5px } .g { display: grid }`;
    const s = scene(css, ['box start', ['g', ['t', 'aaaa bbbb cccc dddd eeee']]]);
    assert.deepEqual(s.box('g'), [5, 5, 140, 40]);
    // Two columns that each want more than half: together they are as wide as the box allows.
    const two = scene(
      `${START} .box { width: 150px; padding: 5px } .g { display: grid; grid-template-columns: auto auto }`,
      ['box start', ['g', ['t', 'aaaa bbbb cccc'], ['u', 'dddd eeee ffff']]],
    );
    assert.equal(two.box('g')[2], 140);
  });

  it('keeps the width it is given when it is wider than its content', () => {
    const css = `.g { display: grid; grid-template-columns: 100px 100px } ${CELLS}`;
    assert.deepEqual(scene(css, FOUR).box('g'), [0, 0, 400, 70]);
  });

  it('follows its content growing', () => {
    const css = `${START} .g { display: grid } .wide { width: 300px; height: 30px }`;
    const s = scene(css, ['start', ['g', ['a']]]);
    s.box('g');
    s.engine.setClasses(s.nodes.get('a')!, 'wide');
    assert.deepEqual(s.box('g'), [0, 0, 300, 30]);
  });
});

describe('a grid that changes', () => {
  const GRID = `.g { display: grid; grid-template-columns: 100px 100px } ${CELLS}`;

  it('places an item added after the first commit', () => {
    const s = scene(GRID, ['g', ['a'], ['b']]);
    assert.deepEqual(s.box('b'), [100, 0, 100, 50]);
    s.build(['c'], s.nodes.get('g')!);
    assert.deepEqual(s.box('c'), [0, 50, 100, 20]);
    assert.deepEqual(s.box('g'), [0, 0, 400, 70]);
  });

  it('closes the gap an item leaves', () => {
    const s = scene(GRID, FOUR);
    assert.deepEqual(s.box('c'), [0, 50, 100, 20]);
    s.engine.removeChild(s.nodes.get('g')!, s.nodes.get('a')!);
    assert.deepEqual(s.box('b'), [0, 0, 100, 50]);
    assert.deepEqual(s.box('c'), [100, 0, 100, 20]);
    assert.deepEqual(s.box('d'), [0, 50, 100, 10]);
    assert.deepEqual(s.box('g'), [0, 0, 400, 60]);
  });

  it('follows an item growing', () => {
    const s = scene(`${GRID} .tall { height: 90px }`, FOUR);
    assert.deepEqual(s.box('c'), [0, 50, 100, 20]);
    s.engine.setClasses(s.nodes.get('a')!, 'tall');
    assert.deepEqual(s.box('c'), [0, 90, 100, 20]);
  });

  it('follows its columns changing', () => {
    const s = scene(`${GRID} .wide { grid-template-columns: 300px }`, FOUR);
    s.box('a');
    s.engine.setClasses(s.nodes.get('g')!, 'g wide');
    assert.deepEqual(s.box('a'), [0, 0, 300, 30]);
    assert.deepEqual(s.box('b'), [0, 30, 300, 50]);
  });

  it('gives its items back to the flow when it stops being a grid', () => {
    const s = scene(`${GRID} .col { display: flex }`, FOUR);
    assert.deepEqual(s.box('b'), [100, 0, 100, 50]);
    s.engine.setClasses(s.nodes.get('g')!, 'col');
    assert.deepEqual(s.box('a'), [0, 0, 400, 30]);
    assert.deepEqual(s.box('b'), [0, 30, 400, 50]);
  });

  it('lays out again when its own width changes', () => {
    const css = `.w { width: 200px } .wide { width: 300px } .g { display: grid; grid-template-columns: 1fr 1fr } ${CELLS}`;
    const s = scene(css, ['w', FOUR]);
    assert.deepEqual(s.box('b'), [100, 0, 100, 50]);
    s.engine.setClasses(s.nodes.get('w')!, 'wide');
    assert.deepEqual(s.box('b'), [150, 0, 150, 50]);
  });
});

describe('a grid set and resized in other ways', () => {
  it('is laid out under a display bound on the element, and under a token', () => {
    const s = scene(
      `.g { grid-template-columns: 100px 150px } .t { --d: grid; display: var(--d) } ${CELLS}`,
      FOUR,
    );
    assert.deepEqual(s.box('b'), [0, 30, 400, 50]);
    s.engine.setProp(s.nodes.get('g')!, 'style', { display: 'grid' });
    assert.deepEqual(s.box('b'), [100, 0, 150, 50]);
    s.engine.setProp(s.nodes.get('g')!, 'style', undefined);
    assert.deepEqual(s.box('b'), [0, 30, 400, 50]);
    s.engine.setClasses(s.nodes.get('g')!, 'g t');
    assert.deepEqual(s.box('b'), [100, 0, 150, 50]);
  });

  it('lays out again when native gives it a new width with nothing changed here', () => {
    const s = scene(`.g { display: grid; grid-template-columns: 1fr 1fr } ${CELLS}`, FOUR);
    assert.deepEqual(s.box('b'), [200, 0, 200, 50]);
    const width = SCREEN.width;
    try {
      // A rotation: the screen is wider, and all the engine hears of it is the layout event.
      SCREEN.width = 600;
      assert.equal(s.engine.commit(), false);
      const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined =>
        all
          .flatMap((node) => (node.props['nativeID'] === 'g' ? [node] : [find(node.children)]))
          .find(Boolean);
      s.fabric.emit(find(s.fabric.committed)!, 'topLayout', { layout: { width: 600, height: 70 } });
      assert.deepEqual(s.box('b'), [300, 0, 300, 50]);
    } finally {
      SCREEN.width = width;
    }
  });
});

describe('a grid whose width native reads back a hair off', () => {
  it('is laid out once, and not again for each commit after', () => {
    // An icon in a box its own size: the grid is as wide as its one track comes to.
    const css = `.g { display: grid; width: 20px; height: 20px } .a { width: 20px; height: 20px } .a.red { background-color: red }`;
    const s = scene(css, ['g', ['a']]);
    const read = s.fabric.getBoundingClientRect!.bind(s.fabric);
    // A float's worth, as a device answers for a box at a third of a point across.
    s.fabric.getBoundingClientRect = (handle, transformed) => {
      const box = read(handle, transformed);
      return box && [box[0], box[1], box[2] + 0.000015, box[3]];
    };
    s.engine.commit();
    let commits = 0;
    const complete = s.fabric.completeRoot.bind(s.fabric);
    s.fabric.completeRoot = (tag, set) => (commits++, complete(tag, set));
    s.engine.setClasses(s.nodes.get('a')!, 'a red');
    s.engine.commit();
    assert.equal(commits, 1);
  });
});

describe('a grid inside a grid', () => {
  it('lays the inner one out in the area the outer one gives it', () => {
    const css =
      '.g { display: grid; grid-template-columns: 100px 200px } .in { display: grid; grid-template-columns: 1fr 1fr } .a { height: 30px } .x { height: 10px } .y { height: 40px }';
    const s = scene(css, ['g', ['a'], ['in', ['x'], ['y']]]);
    assert.deepEqual(s.box('in'), [100, 0, 200, 40]);
    assert.deepEqual(s.box('y'), [200, 0, 100, 40]);
    // The row is as tall as the inner grid, and what follows the outer one is under that.
    assert.deepEqual(s.box('g'), [0, 0, 400, 40]);
  });
});

describe('a grid on a host that cannot be read back from', () => {
  it('is a column, as it was before, and commits nothing native has no prop for', () => {
    const fabric = createFakeFabric();
    const sheet = compileCss(
      `.g { display: grid; grid-template-columns: 1fr 1fr } .a { grid-column: span 2 }`,
      'app.css',
    );
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const grid = engine.createElement('view');
    engine.setClasses(grid, 'g');
    engine.appendChild(engine.root, grid);
    const item = engine.createElement('view');
    engine.setClasses(item, 'a');
    engine.appendChild(grid, item);
    engine.commit();
    assert.deepEqual(fabric.committed[0]!.props, { display: 'flex' });
    assert.deepEqual(fabric.committed[0]!.children[0]!.props, {});
    assert.equal(engine.stats.commits, 1);
  });
});

describe('a change beneath a grid', () => {
  // A grid is laid out by committing its items unsized, reading them, and committing them
  // placed: three commits. A progress bar in one ticks twenty times a second, and a pressed
  // button in a calendar changes colour: neither changes what the grid is sized from, and
  // each is the one commit any other change is.
  const CSS = `
    .g { display: grid; grid-template-columns: auto 150px; justify-content: start }
    .b { height: 50px } .c { height: 20px } .d { height: 10px }
    .in { height: 10px } .in.red { background-color: red } .in.tall { height: 60px }
    .a.padded { padding: 30px }
    .a.lit { background-color: red; color: blue; transform: translateY(-1px); opacity: 0.5 }
  `;
  const counted = (spec: Spec) => {
    const s = scene(CSS, spec);
    s.engine.commit();
    let commits = 0;
    const complete = s.fabric.completeRoot.bind(s.fabric);
    s.fabric.completeRoot = (tag, set) => (commits++, complete(tag, set));
    const after = (change: () => void): number => {
      commits = 0;
      change();
      s.engine.commit();
      return commits;
    };
    return { ...s, after };
  };
  const NESTED: Spec = ['g', ['a', ['in']], ['b'], ['c'], ['d']];

  it('is one commit where it is paint, or a prop of the grid that is no style', () => {
    const s = counted(NESTED);
    const before = s.box('g');
    assert.equal(
      s.after(() => s.engine.setClasses(s.nodes.get('in')!, 'in red')),
      1,
    );
    assert.equal(
      s.after(() => s.engine.setProp(s.nodes.get('g')!, 'accessibilityLabel', 'x')),
      1,
    );
    assert.deepEqual(s.box('g'), before);
  });

  it('is one commit where it is the paint of an item itself, as a pressed one has', () => {
    const s = counted(NESTED);
    const before = s.box('c');
    assert.equal(
      s.after(() => s.engine.setClasses(s.nodes.get('a')!, 'a lit')),
      1,
    );
    assert.equal(
      s.after(() => s.engine.setClasses(s.nodes.get('a')!, 'a')),
      1,
    );
    assert.deepEqual(s.box('c'), before);
  });

  it('lays the grid out again where what an item holds is taller for it', () => {
    const s = counted(NESTED);
    assert.equal(s.box('c')[1], 50);
    assert.ok(s.after(() => s.engine.setClasses(s.nodes.get('in')!, 'in tall')) > 1);
    // The row is as tall as the item is now, and the row after it is under that.
    assert.equal(s.box('c')[1], 60);
    assert.ok(s.after(() => s.engine.setClasses(s.nodes.get('in')!, 'in')) > 1);
    assert.equal(s.box('c')[1], 50);
  });

  it('lays the grid out again for a style of an item, or of the grid', () => {
    const s = counted(NESTED);
    assert.ok(s.after(() => s.engine.setClasses(s.nodes.get('a')!, 'a padded')) > 1);
    assert.equal(s.box('c')[1], 70);
  });

  it('follows text: one commit for words as long, laid out again for longer and shorter', () => {
    const s = counted(['g', ['t', '76%'], ['b']]);
    const words = s.nodes.get('t')!.childList[0]!;
    assert.equal(s.box('t')[2], 30);
    assert.equal(
      s.after(() => s.engine.setText(words, '77%')),
      1,
    );
    assert.ok(s.after(() => s.engine.setText(words, '100%')) > 1);
    assert.equal(s.box('t')[2], 40);
    assert.equal(s.box('b')[0], 40);
    assert.ok(s.after(() => s.engine.setText(words, '9%')) > 1);
    assert.equal(s.box('t')[2], 20);
  });

  it('lays the grid out again for a box added in an item, and one taken out', () => {
    const s = counted(NESTED);
    assert.ok(s.after(() => s.build(['in two'], s.nodes.get('a')!)) > 1);
    assert.ok(s.after(() => s.engine.removeChild(s.nodes.get('a')!, s.nodes.get('in two')!)) > 1);
    assert.equal(s.box('c')[1], 50);
  });
});

describe('several grids that changed in one commit', () => {
  const CSS =
    '.g { display: grid; grid-template-columns: 100px 100px } .a { height: 20px } ' +
    '.a.tall { height: 50px }';
  const SPEC: Spec = ['root', ['g1', ['a1'], ['b1']], ['g2', ['a2'], ['b2']], ['g3', ['a3']]];

  it('are placed in one commit between them, where none is in another', () => {
    const s = scene(CSS, SPEC);
    for (const name of ['g1', 'g2', 'g3']) s.engine.setClasses(s.nodes.get(name)!, `g ${name}`);
    for (const name of ['a1', 'a2', 'a3']) s.engine.setClasses(s.nodes.get(name)!, `a ${name}`);
    s.engine.commit();
    let commits = 0;
    const complete = s.fabric.completeRoot.bind(s.fabric);
    s.fabric.completeRoot = (tag, set) => (commits++, complete(tag, set));
    for (const name of ['a1', 'a2', 'a3'])
      s.engine.setClasses(s.nodes.get(name)!, `a ${name} tall`);
    s.engine.commit();
    // The commit, one for each of the two whose rows are read at their columns' widths, and one
    // that places the three.
    assert.equal(commits, 4);
    assert.deepEqual(s.box('g2'), [0, 50, 400, 50]);
    assert.deepEqual(s.box('b2'), [100, 50, 100, 50]);
    assert.deepEqual(s.box('g3'), [0, 100, 400, 50]);
  });
});

describe('a grid as tall as a share of a box with no height', () => {
  // A message that opens and closes by its one row: `display: grid; grid-template-rows: 1fr`,
  // given `height: 100%` in a row that is as tall as what it holds. A browser reads a share of
  // no height as `auto`, and the grid is as tall as its row's content.
  const CSS =
    '.row { display: flex; flex-direction: row; align-items: center; width: 300px } ' +
    '.g { display: grid; grid-template-rows: 1fr; height: 100% } .a { height: 40px } ' +
    '.tall { height: 120px }';

  it('is as tall as what its rows hold', () => {
    const s = scene(CSS, ['row', ['g', ['a']]]);
    assert.equal(s.box('g')[3], 40);
    assert.equal(s.box('a')[3], 40);
  });

  it('is that share where the box it is in has a height, given or taken away', () => {
    const s = scene(CSS, ['row tall', ['g', ['a']]]);
    assert.equal(s.box('g')[3], 120);
    s.engine.setClasses(s.nodes.get('row tall')!, 'row');
    assert.equal(s.box('g')[3], 40);
  });
});

describe('a grid laid out where Chrome lays it out', () => {
  // Each case is one the layout fuzzer found, with Chrome's numbers. The canary mounts strict.
  const strict = (css: string, spec: Spec) => scene(css, spec, createLaidOutFabric('strict'));

  for (const conformance of ['classic', 'strict'] as const) {
    it(`places its items inside its border once, not twice: ${conformance}`, () => {
      const at = (css: string) =>
        scene(css, ['g', ['a']], createLaidOutFabric(conformance)).box('a');
      assert.deepEqual(at('.g { display: grid; border-width: 10px }'), [10, 10, 380, 0]);
      assert.deepEqual(at('.g { display: grid; border-top-width: 3px }'), [0, 3, 400, 0]);
      assert.deepEqual(at('.g { display: grid; border-left-width: 10px }'), [10, 0, 390, 0]);
    });
  }

  it('places its items in the order their order gives, and follows it changing', () => {
    // Chrome: auto-placement takes the items in order-modified document order.
    const css = `.g { display: grid } ${CELLS} .last { order: 2 } .first { order: -1 }`;
    const s = strict(css, ['g', ['a last'], ['b'], ['c']]);
    assert.deepEqual([s.box('b')[1], s.box('c')[1], s.box('a last')[1]], [0, 50, 70]);
    s.engine.setClasses(s.nodes.get('a last')!, 'a first');
    assert.deepEqual([s.box('a last')[1], s.box('b')[1], s.box('c')[1]], [0, 30, 80]);
    s.engine.setClasses(s.nodes.get('a last')!, 'a');
    assert.deepEqual([s.box('a last')[1], s.box('b')[1], s.box('c')[1]], [0, 30, 80]);
    s.engine.setClasses(s.nodes.get('c')!, 'c first');
    assert.deepEqual([s.box('c')[1], s.box('a last')[1], s.box('b')[1]], [0, 20, 50]);
  });

  it('takes a sum of a share and a length of its area, for an item size and a margin', () => {
    // Chrome: a share of the 400 wide area, the length added.
    const css =
      '.g { display: grid } .w { width: calc(33px + 30%) } .m { margin-left: calc(75% - 8px) }';
    assert.deepEqual(strict(css, ['g', ['w']]).box('w'), [0, 0, 153, 0]);
    assert.deepEqual(strict(css, ['g', ['m']]).box('m'), [292, 0, 108, 0]);
  });

  it('is laid out again in a box a sum of a share and a length sizes', () => {
    // Chrome: a quarter of the 400 wide screen, less 5.
    const css = '.o { width: calc(25% - 5px) } .g { display: grid }';
    assert.deepEqual(strict(css, ['p', ['o', ['g', ['a']]]]).box('a'), [0, 0, 95, 0]);
  });

  it('is laid out, and does not throw, with a ratio and a sum for its width', () => {
    // Merged again as its tracks lay it out, the grid is left with no sum to finish.
    const css =
      '.o { width: 50% } .g { margin-left: auto; width: calc(10% - 29px); aspect-ratio: 0.5; display: grid }';
    assert.deepEqual(strict(css, ['p', ['o', ['g']]]).box('g'), [200, 0, 0, 0]);
  });

  it('keeps its aspect ratio, as tall as its rows at least', () => {
    // Chrome: half the 400 it is stretched across, or its rows where those are taller.
    const css = '.g { display: grid; aspect-ratio: 2 } .tall { height: 300px }';
    assert.deepEqual(strict(css, ['p', ['g']]).box('g'), [0, 0, 400, 200]);
    assert.deepEqual(strict(css, ['p', ['g', ['tall']]]).box('g'), [0, 0, 400, 300]);
  });

  it('follows its border changing, and going away', () => {
    const css = '.g { display: grid } .b { border-width: 10px } .c { border-width: 4px }';
    const s = strict(css, ['g b', ['a']]);
    assert.deepEqual(s.box('a'), [10, 10, 380, 0]);
    s.engine.setClasses(s.nodes.get('g b')!, 'g c');
    assert.deepEqual(s.box('a'), [4, 4, 392, 0]);
    s.engine.setClasses(s.nodes.get('g b')!, 'g');
    assert.deepEqual(s.box('a'), [0, 0, 400, 0]);
  });

  it('lays out inside a padding written as a share of the width', () => {
    const at = (css: string) => strict(css, ['top', ['g', ['a']]]).box('a');
    assert.deepEqual(at('.g { display: grid; padding-right: 50% }'), [0, 0, 200, 0]);
    assert.deepEqual(at('.g { display: grid; padding-left: 50% }'), [200, 0, 200, 0]);
  });

  it('is as tall as its rows and its padding once, where its box is its content', () => {
    const css = '.g { display: grid; padding: 1px; box-sizing: content-box }';
    assert.deepEqual(strict(css, ['g']).box('g'), [0, 0, 400, 2]);
  });

  it('places an item whose box is its content with its padding outside its area, not added', () => {
    const css = '.g { display: grid } .a { padding: 10px; box-sizing: content-box }';
    assert.deepEqual(strict(css, ['g', ['a']]).box('a'), [0, 0, 400, 20]);
    // A share written of its content box has its padding and border added to it.
    const share = '.g { display: grid } .a { width: 100%; padding: 50px; box-sizing: content-box }';
    assert.deepEqual(strict(share, ['g', ['a']]).box('a'), [0, 0, 500, 100]);
    const most =
      '.g { display: grid } .a { max-width: 50%; border-width: 10px; box-sizing: content-box }';
    assert.deepEqual(strict(most, ['g', ['a']]).box('a'), [0, 0, 220, 20]);
  });

  it('moves an item by its own offsets, as a relative box', () => {
    const at = (css: string) => strict(`.g { display: grid } ${css}`, ['g', ['a']]).box('a');
    assert.deepEqual(at('.a { left: 50px }'), [50, 0, 400, 0]);
    assert.deepEqual(at('.a { top: 50px }'), [0, 50, 400, 0]);
    assert.deepEqual(at('.a { bottom: 10px }'), [0, -10, 400, 0]);
  });

  it('ignores a flex basis on an item', () => {
    const css = '.g { display: grid } .a { flex-basis: 100px }';
    assert.deepEqual(strict(css, ['g', ['a']]).box('g'), [0, 0, 400, 0]);
  });

  it('keeps a width of its own, wider or narrower than its items', () => {
    const narrow = '.g { display: grid; width: 155px } .a { min-width: 160px }';
    assert.deepEqual(strict(narrow, ['g', ['a']]).box('g'), [0, 0, 155, 0]);
    // Where nothing stretches it too.
    const aside = `${narrow} .g { margin-right: auto }`;
    assert.deepEqual(strict(aside, ['g', ['a']]).box('g'), [0, 0, 155, 0]);
    const padded = '.g { display: grid; grid-template-columns: 100px; width: 10px; padding: 10px }';
    assert.deepEqual(strict(padded, ['g', ['a']]).box('g'), [0, 0, 20, 20]);
  });

  it('is as wide as its tracks with no items, where nothing stretches it', () => {
    const out = '.o { display: grid; grid-template-columns: 50px; position: absolute }';
    assert.deepEqual(strict(out, ['top', ['o']]).box('o'), [0, 0, 50, 0]);
    const auto = '.g { display: grid; grid-template-columns: 100px; margin-right: auto }';
    assert.deepEqual(strict(auto, ['g']).box('g'), [0, 0, 100, 0]);
  });

  it('lays its tracks out in the width its maximum holds it to', () => {
    const css =
      '.g { display: grid; grid-template-columns: 50%; max-width: 50px } .a { width: 100px }';
    assert.deepEqual(strict(css, ['g', ['a'], ['b']]).box('b'), [0, 0, 25, 0]);
    // Where nothing stretches it, its tracks are no wider than that either.
    const aside =
      '.g { display: grid; grid-template-columns: minmax(10px, 1fr) minmax(10px, 1fr); max-width: 50px; margin-right: auto } .a { width: 30px }';
    assert.deepEqual(strict(aside, ['g', ['a'], ['a b']]).box('a b'), [25, 0, 30, 0]);
  });

  it('stretches its rows to its minimum height', () => {
    const css = '.g { display: grid; min-height: 100px }';
    assert.deepEqual(strict(css, ['g', ['a']]).box('a'), [0, 0, 400, 100]);
  });

  it('gives a grid that is an item and is not stretched the width of its tracks', () => {
    const at = (css: string) => strict(css, ['g', ['h']]).box('h');
    const inner = '.h { display: grid; grid-template-columns: 100px }';
    assert.deepEqual(at(`.g { display: grid; justify-items: start } ${inner}`), [0, 0, 100, 0]);
    const centred = `.g { display: grid } ${inner} .h { justify-self: center }`;
    assert.deepEqual(at(centred), [150, 0, 100, 0]);
  });

  it('is as wide as its tracks need where it is not stretched, past the box it is in', () => {
    const own =
      '.p { width: 70px } .h { display: grid; grid-template-columns: 100px; align-self: end }';
    assert.deepEqual(strict(own, ['p', ['h']]).box('h'), [-30, 0, 100, 0]);
    // And no wider than that box where its tracks can be narrower, past its items' content.
    const flexible =
      '.p { align-items: flex-end; width: 100px } .h { display: grid; grid-template-columns: minmax(35px, 1fr) } .c { width: 140px }';
    assert.deepEqual(strict(flexible, ['p', ['h', ['c']]]).box('h'), [0, 0, 100, 0]);
  });

  it('is as tall as a flex container makes it, and no shorter than its rows', () => {
    const row = '.p { flex-direction: row; height: 100px } .h { display: grid }';
    assert.deepEqual(strict(row, ['p', ['h']]).box('h'), [0, 0, 0, 100]);
    const basis = '.p { height: 50px } .h { display: grid; flex-basis: 100% }';
    assert.deepEqual(strict(basis, ['p', ['h']]).box('h'), [0, 0, 400, 50]);
  });

  it('shrinks down a column as a box does, under its rows', () => {
    const css = '.p { height: 100px } .h { display: grid; flex-shrink: 2 } .c { height: 160px }';
    assert.deepEqual(strict(css, ['p', ['h', ['c']]]).box('h'), [0, 0, 400, 100]);
  });

  it('is as wide as a column stretches it, narrower than its items', () => {
    const css = '.p { width: 30px } .h { display: grid } .c { width: 50px }';
    assert.deepEqual(strict(css, ['p', ['h', ['c']]]).box('h'), [0, 0, 30, 0]);
  });

  it('stretches the rows of a grid that is an item to the row it is stretched across', () => {
    const at = (css: string) => strict(`${css} .h { display: grid }`, ['g', ['h', ['c']]]).box('c');
    assert.deepEqual(at('.g { display: grid; height: 50px }'), [0, 0, 400, 50]);
    assert.deepEqual(at('.g { display: grid; grid-template-rows: 50px }'), [0, 0, 400, 50]);
    // One that is not stretched is as tall as its own rows.
    assert.deepEqual(at('.g { display: grid; height: 50px; align-items: start }'), [0, 0, 400, 0]);
  });

  it('sizes its tracks by an item whose sizes are shares as by its content', () => {
    const least =
      '.g { display: grid; grid-template-columns: 100px } .a { min-width: 50%; margin: auto }';
    assert.deepEqual(strict(least, ['g', ['a']]).box('a'), [25, 0, 50, 0]);
    const tall = '.g { display: grid; height: 50% } .a { height: 50% }';
    const s = strict(tall, ['g', ['a'], ['b']]);
    assert.deepEqual(s.box('a'), [0, 0, 400, 100]);
    assert.deepEqual(s.box('b'), [0, 200, 400, 200]);
  });

  it('keeps a width that is a share of a box with a width, narrower than its items', () => {
    const share = '.g { display: grid; width: 30% } .a { width: 150px }';
    assert.deepEqual(strict(share, ['top', ['g', ['a']]]).box('g'), [0, 0, 120, 0]);
    const aside = `${share} .g { margin-right: auto }`;
    assert.deepEqual(strict(aside, ['top', ['g', ['a']]]).box('g'), [0, 0, 120, 0]);
  });

  it('keeps the width its maximum holds it to where it is stretched, wider than its tracks', () => {
    const css =
      '.g { display: grid; grid-template-columns: 50px; max-width: 100px } .a { width: 100px }';
    assert.deepEqual(strict(css, ['top', ['g', ['a']]]).box('g'), [0, 0, 100, 0]);
  });

  it('keeps an item no smaller than its padding when it centres it', () => {
    const css = '.g { display: grid } .a { max-width: 1px; padding: 10px; margin: auto }';
    assert.deepEqual(strict(css, ['g', ['a']]).box('a'), [190, 0, 20, 20]);
  });

  it("makes a row as tall as an item's share of a margin, which is of the area's width", () => {
    const css = '.g { display: grid; width: 200px } .m { margin-top: 50%; height: 10px }';
    const s = strict(css, ['g', ['m']]);
    assert.deepEqual(s.box('g'), [0, 0, 200, 110]);
    assert.deepEqual(s.box('m'), [0, 100, 200, 10]);
  });

  it('gives a share of a height of an item it stretches, and none of one it does not', () => {
    const css =
      '.g { display: grid; width: 200px; height: 80px } .h { height: 50% } .st { align-self: start }';
    const s = strict(css, ['g', ['item', ['h']]]);
    assert.deepEqual(s.box('h'), [0, 0, 200, 40]);
    // Set at the start of its area, it is as tall as its content, and the share is of nothing.
    s.engine.setClasses(s.nodes.get('item')!, 'item st');
    assert.deepEqual(s.box('h'), [0, 0, 200, 0]);
  });
});

describe('a grid read in other ways', () => {
  // Chrome's numbers, for the same markup in a 400 point wide page.
  it('lays its columns out from the right, right to left', () => {
    const css = `.g { display: grid; direction: rtl; width: 300px; grid-template-columns: 100px 50px } ${CELLS}`;
    const s = scene(css, ['g', ['a'], ['b'], ['c']]);
    assert.deepEqual(s.box('a'), [200, 0, 100, 30]);
    assert.deepEqual(s.box('b'), [150, 0, 50, 50]);
    assert.deepEqual(s.box('c'), [200, 50, 100, 20]);
  });

  it('repeats an auto-fill track as many times as fit, with and without a gap', () => {
    const fill = `.g { display: grid; width: 300px; grid-template-columns: repeat(auto-fill, 100px) } ${CELLS}`;
    const s = scene(fill, FOUR);
    assert.deepEqual(s.box('c'), [200, 0, 100, 20]);
    assert.deepEqual(s.box('d'), [0, 50, 100, 10]);
    const gap =
      '.g { display: grid; width: 330px; column-gap: 20px; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)) } ' +
      CELLS;
    const t = scene(gap, FOUR);
    assert.deepEqual(t.box('b'), [175, 0, 155, 50]);
    assert.deepEqual(t.box('c'), [0, 50, 155, 20]);
  });

  it('repeats a track with no fixed size of its own a point wide at the least', () => {
    // CSS Grid 7.2.3.2: Chrome makes 300 tracks of 1px here, where there would be no end of them.
    const css = `.g { display: grid; width: 300px; grid-template-columns: repeat(auto-fill, minmax(0, 1fr)) } ${CELLS}`;
    const s = scene(css, ['g', ['a'], ['b']]);
    assert.deepEqual(s.box('a'), [0, 0, 1, 30]);
    assert.deepEqual(s.box('b'), [1, 0, 1, 50]);
  });

  it('takes a percentage track of the width its other tracks give a grid with none of its own', () => {
    const css =
      '.r { flex-direction: row; align-items: flex-start } .g { display: grid; grid-template-columns: 100px 25% } ' +
      CELLS;
    const s = scene(css, ['r', ['g', ['a'], ['b']]]);
    assert.deepEqual(s.box('g'), [0, 0, 100, 50]);
    assert.deepEqual(s.box('b'), [100, 0, 25, 50]);
  });
});

describe('a grid taken out of the tree and put back', () => {
  it('is laid out again, and follows its items after', () => {
    const css = `.g { display: grid; grid-template-columns: 100px 150px } ${CELLS} .tall { height: 80px }`;
    const s = scene(css, ['top', FOUR]);
    assert.deepEqual(s.box('d'), [100, 50, 150, 10]);
    const [top, grid] = [s.nodes.get('top')!, s.nodes.get('g')!];
    // Out for a commit, as a view container detaches a view and inserts it again.
    s.engine.removeChild(top, grid);
    s.engine.commit();
    s.engine.appendChild(top, grid);
    assert.deepEqual(s.box('d'), [100, 50, 150, 10]);
    // And still a grid: an item grown makes its row taller, and moves the row under it.
    s.engine.setClasses(s.nodes.get('a')!, 'a tall');
    assert.deepEqual(s.box('c'), [0, 80, 100, 20]);
    assert.deepEqual(s.box('d'), [100, 80, 150, 10]);
  });

  it('is laid out again where it comes back with other items', () => {
    const css = `.g { display: grid; grid-template-columns: 100px 150px } ${CELLS} .e { height: 5px }`;
    const s = scene(css, ['top', FOUR]);
    s.box('d');
    const [top, grid] = [s.nodes.get('top')!, s.nodes.get('g')!];
    s.engine.removeChild(top, grid);
    s.engine.commit();
    s.build(['e'], grid);
    s.engine.appendChild(top, grid);
    assert.deepEqual(s.box('e'), [0, 70, 100, 5]);
  });
});
