/**
 * A percentage height where the parent has no height of its own to take a percentage of.
 *
 * CSS resolves `height: 100%` against the parent's height when that is definite: written, or
 * given by the layout around it (a box that grows in a column, or stretches across a row). A
 * parent as tall as its content has none, and the percentage is `auto`. Yoga resolves it against
 * the space on offer instead, which is the height of the screen, or of everything a scroll view
 * holds. So the engine sends no height where CSS has none to give.
 *
 * Measured in Chrome with the web host's reset, a 20px child in each case: 100% under a
 * content-sized parent is 20, where Yoga makes it the 800 of the screen.
 *
 * Where the parent is a flex item, a browser then takes the percentage of the height the column
 * gave it (CSS Flexbox 9.8): a percentage below 100 is that share of the content's height. The
 * engine holds such a parent at that height once it has been laid out, which the laid-out tests
 * below read back.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';

/** `.g` holding `.p` holding `.c`, under `css`, with the child's committed props. */
function scene(css: string, classes: { g?: string; p?: string; c?: string } = {}) {
  const sheet = compileCss(css, 'app.css');
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const make = (name: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, name);
    engine.appendChild(parent, node);
    return node;
  };
  const grand = make(classes.g ?? 'g', engine.root);
  const parent = make(classes.p ?? 'p', grand);
  const child = make(classes.c ?? 'c', parent);
  const committed = () => {
    engine.commit();
    return fabric.committed[0]!.children[0]!;
  };
  return {
    engine,
    grand,
    parent,
    child,
    parentProps: (): Record<string, unknown> => committed().props,
    props: (): Record<string, unknown> => committed().children[0]!.props,
  };
}

const FULL = '.c { height: 100% }';

describe('a percentage height', () => {
  it('is no height under a parent as tall as its content', () => {
    assert.equal('height' in scene(FULL).props(), false);
  });

  it('is kept under a parent with a height', () => {
    assert.equal(scene(`.p { height: 200px } ${FULL}`).props()['height'], '100%');
  });

  it('is kept under a parent that grows in a column with a height', () => {
    const css = `.g { height: 400px } .p { flex: 1 } ${FULL}`;
    assert.equal(scene(css).props()['height'], '100%');
  });

  it('is no height under a parent that would grow in a column with none', () => {
    assert.equal('height' in scene(`.p { flex: 1 } ${FULL}`).props(), false);
  });

  it('is kept under a parent stretched across a row that has a height', () => {
    const css = `.g { flex-direction: row; height: 200px } ${FULL}`;
    assert.equal(scene(css).props()['height'], '100%');
  });

  it('is no height under a parent stretched across a row as tall as its content', () => {
    // A tab group's body: Yoga makes it the 800 of the screen, where Chrome makes it the 20 of
    // the content that sized the row.
    assert.equal('height' in scene(`.g { flex-direction: row } ${FULL}`).props(), false);
  });

  it('is no height under a parent a row does not stretch', () => {
    const row = '.g { flex-direction: row; align-items: center }';
    assert.equal('height' in scene(`${row} ${FULL}`).props(), false);
    const self = '.g { flex-direction: row } .p { align-self: flex-start }';
    assert.equal('height' in scene(`${self} ${FULL}`).props(), false);
  });

  it('is kept under a parent placed by its top and bottom', () => {
    const css = `.p { position: absolute; top: 0; bottom: 0 } ${FULL}`;
    assert.equal(scene(css).props()['height'], '100%');
  });

  it('is kept on a box placed out of the flow, which takes it of the box that holds it', () => {
    // Laid out before the box is, so its height is there to take a share of: Chrome makes a
    // `height: 100%` handle track 32 under a switch as tall as its 32 track, with none written.
    const absolute = scene(`.c { position: absolute; height: 100% }`);
    assert.equal(absolute.props()['height'], '100%');
  });

  it('is kept at the top of the app, where the parent is the screen', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(FULL, 'a.css') as never });
    const top = engine.createElement('view');
    engine.setClasses(top, 'c');
    engine.appendChild(engine.root, top);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['height'], '100%');
  });

  it('through percentages: a percentage of a percentage of a height is kept', () => {
    const css = `.g { height: 400px } .p { height: 50% } ${FULL}`;
    assert.equal(scene(css).props()['height'], '100%');
    assert.equal(scene(css).parentProps()['height'], '50%');
    assert.equal('height' in scene(`.p { height: 50% } ${FULL}`).props(), false);
  });

  it('leaves any other height, and a percentage width, as written', () => {
    assert.equal(scene('.c { height: 40px }').props()['height'], 40);
    assert.equal(scene('.c { width: 100% }').props()['width'], '100%');
  });

  it('takes a percentage least height off under a parent as tall as its content, and not else', () => {
    assert.equal('minHeight' in scene('.c { min-height: 100% }').props(), false);
    const css = '.p { height: 200px } .c { min-height: 100% }';
    assert.equal(scene(css).props()['minHeight'], '100%');
  });

  it('follows the parent when it gains a height and loses it', () => {
    const s = scene(`.tall { height: 200px } ${FULL}`);
    assert.equal('height' in s.props(), false);
    s.engine.addClass(s.parent, 'tall');
    assert.equal(s.props()['height'], '100%');
    s.engine.removeClass(s.parent, 'tall');
    assert.equal(s.props()['height'] ?? null, null);
  });

  it('follows a height further up, through a parent that grows', () => {
    const s = scene(`.tall { height: 400px } .p { flex: 1 } ${FULL}`);
    assert.equal('height' in s.props(), false);
    s.engine.addClass(s.grand, 'tall');
    assert.equal(s.props()['height'], '100%');
    s.engine.removeClass(s.grand, 'tall');
    assert.equal(s.props()['height'] ?? null, null);
  });

  it('follows a height set inline on the parent', () => {
    const s = scene(FULL);
    assert.equal('height' in s.props(), false);
    s.engine.setProp(s.parent, 'style', { height: 120 });
    assert.equal(s.props()['height'], '100%');
    s.engine.setProp(s.parent, 'style', {});
    assert.equal(s.props()['height'] ?? null, null);
  });
});

type Spec = [name: string, ...children: (Spec | string)[]];

/**
 * A tree laid out by Yoga as the canary is: each box `[name, ...children]` with the class of its
 * name, a string child being text in it. Each box is read as `[left, top, width, height]`.
 */
function laidOut(css: string, spec: Spec) {
  const fabric = createLaidOutFabric('strict');
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const nodes = new Map<string, EngineNode>();
  const texts = new Map<string, EngineNode>();
  const build = ([name, ...children]: Spec, parent: EngineNode): void => {
    const node = engine.createElement('view');
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) {
      if (typeof child !== 'string') build(child, node);
      else {
        const text = engine.createElement('text');
        const words = engine.createText(child);
        engine.appendChild(text, words);
        engine.appendChild(node, text);
        texts.set(name, words);
      }
    }
  };
  build(spec, engine.root);
  const box = (name: string) => {
    engine.commit();
    const { left, top, width, height } = fabric.box(name);
    return [left, top, width, height];
  };
  return { engine, nodes, texts, box };
}

// Every box is a flex column, as the web host's reset makes every `div`: a box as tall as its
// content is a flex item, and once the column it is in has sized it, a percentage is of that
// height (CSS Flexbox 9.8). Each set of numbers is Chrome's, with the web host's reset.
describe('a percentage height, laid out', () => {
  it('is of the height the content gives the parent, which a share does not add to', () => {
    const s = laidOut('.c { height: 50% } .d { height: 40px }', ['p', ['c'], ['d']]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 40]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    assert.deepEqual(s.box('d'), [0, 20, 400, 40]);
  });

  it('is of the content box, and leaves the parent as tall as its content was', () => {
    const s = laidOut('.c { height: 100%; margin: 10px }', ['p', ['c']]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 20]);
    assert.deepEqual(s.box('c'), [10, 10, 380, 20]);
    const padded = laidOut('.p { padding: 10px } .c { height: 50% } .d { height: 40px }', [
      'p',
      ['c'],
      ['d'],
    ]);
    assert.deepEqual(padded.box('c'), [10, 10, 380, 20]);
    assert.deepEqual(padded.box('d'), [10, 30, 380, 40]);
  });

  it('is of the height of its own text, which it is then less than', () => {
    const s = laidOut('.c { height: 50% }', ['p', ['c', 'x']]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 20]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
  });

  it('is of a parent held to its least height, or a share of the screen', () => {
    const least = laidOut('.p { min-height: 50px } .c { height: 50% }', ['p', ['c']]);
    assert.deepEqual(least.box('c'), [0, 0, 400, 25]);
    const screen = laidOut('.p { min-height: 100% } .c { height: 50% }', ['p', ['c']]);
    assert.deepEqual(screen.box('c'), [0, 0, 400, 400]);
  });

  it('is so for a basis in a column', () => {
    const s = laidOut('.c { flex-basis: 50% }', ['p', ['c', 'x']]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
  });

  it('is of a percentage of a percentage, down the boxes', () => {
    const css = '.c, .c2 { height: 50% } .d { height: 40px }';
    const s = laidOut(css, ['p', ['c', ['c2']], ['d']]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    assert.deepEqual(s.box('c2'), [0, 0, 400, 10]);
  });

  it('is of a box stretched across a row, and not of one the row leaves at its content', () => {
    const css = '.r { flex-direction: row } .c { height: 50% } .d { height: 60px }';
    const s = laidOut(css, ['r', ['p', ['c']], ['d']]);
    assert.deepEqual(s.box('c'), [0, 0, 0, 30]);
    const start = laidOut(`${css} .r { align-items: flex-start }`, ['r', ['p', ['c']], ['d']]);
    assert.deepEqual(start.box('c'), [0, 0, 0, 0]);
  });

  it('is of a block that is a flex item, as a box in its flow', () => {
    const css = '.p { display: block } .c { height: 50% } .d { height: 40px }';
    const s = laidOut(css, ['p', ['c'], ['d']]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
  });

  it('is of the content height under a host given the screen, once a style asks for it', () => {
    // As `mount` gives the root component's host the screen's height, which asks for nothing.
    const s = laidOut('.d { height: 40px }', ['host', ['p', ['c'], ['d']]]);
    s.engine.setDefaultStyle(s.nodes.get('host')!, { height: '100%' });
    assert.deepEqual(s.box('host'), [0, 0, 400, 800]);
    s.engine.setProp(s.nodes.get('c')!, 'style', { height: '50%' });
    assert.deepEqual(s.box('p'), [0, 0, 400, 40]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
  });

  it('follows the content of the parent changing, and the share going', () => {
    const css = '.c { height: 50% } .d { height: 40px } .tall { height: 100px }';
    const s = laidOut(css, ['p', ['c'], ['d']]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    s.engine.setClasses(s.nodes.get('d')!, 'tall');
    assert.deepEqual(s.box('p'), [0, 0, 400, 100]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 50]);
    s.engine.setClasses(s.nodes.get('c')!, '');
    assert.deepEqual(s.box('c'), [0, 0, 400, 0]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 100]);
    s.engine.setClasses(s.nodes.get('c')!, 'c');
    s.engine.setClasses(s.nodes.get('d')!, 'd');
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 40]);
  });

  it('follows text in the parent changing, and the parent gaining a height and losing it', () => {
    const s = laidOut('.c { height: 50% } .fixed { height: 200px }', ['p', ['c'], ['d', 'x']]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
    s.engine.setText(s.texts.get('d')!, 'x\nx');
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    s.engine.setClasses(s.nodes.get('p')!, 'fixed');
    assert.deepEqual(s.box('c'), [0, 0, 400, 100]);
    s.engine.setClasses(s.nodes.get('p')!, '');
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 40]);
  });

  it('follows the parent getting narrower from further up, which wraps its text', () => {
    const css = '.c { height: 50% } .narrow { width: 30px }';
    const s = laidOut(css, ['o', ['g', ['p', ['c'], ['d', 'xx xx']]]]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 10]);
    s.engine.setClasses(s.nodes.get('o')!, 'narrow');
    assert.deepEqual(s.box('c'), [0, 0, 30, 20]);
  });

  it('is of the content box of a parent sized as one', () => {
    const css =
      '.p { box-sizing: content-box; padding: 10px } .c { height: 50% } .d { height: 40px }';
    const s = laidOut(css, ['p', ['c'], ['d']]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 60]);
    assert.deepEqual(s.box('c'), [10, 10, 380, 20]);
  });

  it('follows the parent moving under another box', () => {
    const css = '.c { height: 50% } .d { height: 40px } .r { flex-direction: row; height: 300px }';
    const s = laidOut(css, ['p', ['c'], ['d']]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    const row = s.engine.createElement('view');
    s.engine.setClasses(row, 'r');
    s.engine.appendChild(s.engine.root, row);
    s.engine.removeChild(s.engine.root, s.nodes.get('p')!);
    s.engine.appendChild(row, s.nodes.get('p')!);
    // Stretched across a row with a height, the parent is that height.
    assert.deepEqual(s.box('c'), [0, 0, 0, 150]);
  });
});

// The parent's height is read back rounded to the screen's pixels, which can be a fraction of a
// pixel less than its content: a column that wraps then broke a line where a browser has none.
describe('a percentage height in a column that wraps, laid out', () => {
  const WRAPS =
    '.p { flex-wrap: wrap; align-items: flex-end } .nowrap { flex-wrap: nowrap; align-items: flex-end }' +
    ' .c { height: 10%; min-height: 10.1px; width: 50px } .d { height: 20px; width: 50px }';
  const across = (s: ReturnType<typeof laidOut>) => [s.box('c')[0], s.box('d')[0]];

  it('keeps on one line content that just fits the height it gives the parent', () => {
    // Chrome: the parent is 30.09 tall, and both boxes are at 350 on the one line.
    const s = laidOut(WRAPS, ['p', ['c'], ['d']]);
    assert.deepEqual(across(s), [350, 350]);
    // Wrapped the other way, the line starts at the far edge.
    const reversed = laidOut(`${WRAPS} .p { flex-wrap: wrap-reverse; align-items: flex-start }`, [
      'p',
      ['c'],
      ['d'],
    ]);
    assert.deepEqual(across(reversed), [350, 350]);
  });

  it('is so for a basis, and a margin that is a share of the width', () => {
    // A case the layout fuzzer found (seed 14700), and Chrome's numbers for it.
    const css =
      '.p { flex-direction: column-reverse; flex-wrap: wrap; align-items: flex-end; padding-bottom: 5px; margin: 6px }' +
      ' .c { width: 136px; height: 50%; max-width: 2px; min-height: 47px; margin: 4px; margin-bottom: 10%;' +
      ' flex-grow: 1; flex-shrink: 0; flex-basis: 30%; box-sizing: content-box; border-width: 7px }' +
      ' .d { width: 100%; min-width: 145px; box-sizing: content-box; margin-top: -14px; flex-shrink: 1 }';
    const s = laidOut(css, ['p', ['c'], ['d']]);
    // To the point: the box grows into the fraction the parent is held taller by.
    assert.deepEqual(s.box('c').map(Math.round), [374, -4, 16, 61]);
    assert.equal(s.box('d')[0], 6);
  });

  it('gives the parent back its height as read once it stops wrapping', () => {
    const s = laidOut(WRAPS, ['p', ['c'], ['d']]);
    assert.ok(s.box('p')[3] > 30);
    s.engine.setClasses(s.nodes.get('p')!, 'nowrap');
    assert.deepEqual(s.box('p'), [0, 0, 400, 30]);
    assert.deepEqual(across(s), [350, 350]);
  });
});

describe('a percentage least height', () => {
  // Yoga takes a least height in a column as a share of the box above the parent, whatever the
  // parent's height: here the screen's, which made both boxes 400 high.
  it('is nothing under a parent as tall as its content, which it does not make taller', () => {
    const s = laidOut('.c { min-height: 50% }', ['p', ['c']]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 0]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 0]);
  });

  it('is a share of the height the content gives the parent', () => {
    const s = laidOut('.c { min-height: 50% } .d { height: 40px }', ['p', ['c'], ['d']]);
    assert.deepEqual(s.box('p'), [0, 0, 400, 40]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    assert.deepEqual(s.box('d'), [0, 20, 400, 40]);
    const margin = laidOut('.c { min-height: 100%; margin: 10px }', ['p', ['c']]);
    assert.deepEqual(margin.box('c'), [10, 10, 380, 20]);
  });

  it('follows the content of the parent changing', () => {
    const css = '.c { min-height: 50% } .d { height: 40px } .tall { height: 100px }';
    const s = laidOut(css, ['p', ['c'], ['d']]);
    assert.deepEqual(s.box('c'), [0, 0, 400, 20]);
    s.engine.setClasses(s.nodes.get('d')!, 'tall');
    assert.deepEqual(s.box('c'), [0, 0, 400, 50]);
  });
});

// Chrome: a gap down a flex container is a share of its height, which one as tall as its
// content has none of before it is laid out, and it is no gap. Yoga takes it of the room on
// offer. (Chrome then takes it of the height the content came to, which overflows by it: two
// lines of a wrapping row 20 tall are 2 apart. The engine leaves that gap out.)
describe('a percentage gap down a flex container', () => {
  const CSS = '.p { row-gap: 10% } .tall { height: 100px }';

  it('is no gap where the container is as tall as its content', () => {
    const s = laidOut(CSS, ['p', ['a'], ['b']]);
    assert.deepEqual([s.box('p')[3], s.box('b')[1]], [0, 0]);
  });

  it('is a share of a height the container has, and follows it going', () => {
    const s = laidOut(CSS, ['p tall', ['a'], ['b']]);
    assert.equal(s.box('b')[1], 10);
    s.engine.setClasses(s.nodes.get('p tall')!, 'p');
    assert.equal(s.box('b')[1], 0);
  });
});
