/**
 * A box as wide as its content, holding a child whose width is a percentage of it. A browser
 * sizes the box from its content with the percentage set aside, and then takes the percentage of
 * that: a `w-full` header in an inline-flex calendar is as wide as the calendar's days make it.
 * Yoga takes the percentage of the room on offer, so the box fills its container. The engine
 * commits the box with those percentages off, reads its width back, and commits it at that
 * width, where the percentages are of it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

type Spec = [name: string, ...children: Spec[]];

function scene(css: string, spec: Spec, conformance: 'classic' | 'strict' = 'classic') {
  const fabric = createLaidOutFabric(conformance);
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
  return { engine, fabric, nodes, build, box };
}

/** Text in a box: ten points a character, on one line. */
function say(s: ReturnType<typeof scene>, name: string, words: string): void {
  const text = s.engine.createElement('text');
  s.engine.appendChild(text, s.engine.createText(words));
  s.engine.appendChild(s.nodes.get(name)!, text);
}

const BASE =
  '.p { display: block; width: 300px } .i { display: inline-flex; flex-direction: column } .full { width: 100%; height: 10px } .w { width: 120px; height: 20px }';

describe('an inline-level row holding a percentage flex basis', () => {
  // A chip: `display: inline-flex` around a cell with `flex-basis: 100%` around its words. A share
  // of a width that is the content's own is that content's width in a browser, and the words
  // are on one line; to Yoga it is a share of nothing, and the words wrap to their longest.
  const CHIP =
    '.p { display: block; width: 300px } .chip { display: inline-flex; flex-direction: row; height: 32px } ' +
    '.cell { flex-basis: 100%; display: flex; flex-direction: row }';

  it('is as wide as its content, on one line', () => {
    const s = scene(CHIP, ['p', ['chip', ['cell', ['label']]]]);
    say(s, 'label', 'One fish');
    assert.equal(s.box('chip')[2], 80);
    assert.equal(s.box('label')[2], 80);
  });

  it('is as wide as what its cells hold, in a row that is fit-content and shared between them', () => {
    // A list of tabs: `inline-flex w-fit` around triggers that are each `flex-1`. The row is as
    // wide as what its triggers hold: to Yoga a share of nothing is nothing, and the words go.
    // ponytail: each trigger is as wide as its own words, where a browser makes them equal.
    const css =
      '.p { display: block; width: 400px }' +
      ' .list { display: inline-flex; flex-direction: row; width: fit-content; padding: 3px; height: 36px }' +
      ' .tab { flex: 1 1 0%; display: inline-flex; flex-direction: row; padding: 0 8px }';
    const s = scene(css, ['p', ['list', ['tab a'], ['tab b'], ['tab c']]]);
    say(s, 'tab a', 'Account');
    say(s, 'tab b', 'Password');
    say(s, 'tab c', 'Billing');
    assert.equal(s.box('list')[2], 274);
    assert.deepEqual(
      ['a', 'b', 'c'].map((tab) => s.box(`tab ${tab}`)[2]),
      [86, 96, 86],
    );
  });

  it('is as wide as what its list holds, in a row that is no wider than its content', () => {
    // A navigation bar: `flex max-w-max` around a list that is `flex-1`, in a block or a column
    // that it would fill. And the same written as `width: fit-content`.
    const all = ['width: fit-content', 'max-width: max-content'].flatMap((fits) =>
      ['block', 'flex; flex-direction: column'].map((parent) => [fits, parent] as const),
    );
    for (const [fits, parent] of all) {
      const css =
        `.p { display: ${parent}; width: 400px }` +
        ` .nav { display: flex; flex-direction: row; ${fits} }` +
        ' .list { flex: 1 1 0%; display: flex; flex-direction: row }' +
        ' .w { width: 60px; height: 20px } .n { width: 40px; height: 20px }';
      // Laid out as a device lays it out, which is where a box that fits is not stretched.
      const s = scene(css, ['p', ['nav', ['list', ['w'], ['n']]]], 'strict');
      const where = `${fits} in ${parent}`;
      assert.equal(s.box('nav')[2], 100, where);
      assert.equal(s.box('list')[2], 100, where);
      assert.deepEqual([s.box('w')[0], s.box('n')[0]], [0, 60], where);
    }
  });

  it('keeps the share where the row has a width to take it of', () => {
    const s = scene(`${CHIP} .chip { width: 200px } .cell { flex-basis: 50% }`, [
      'p',
      ['chip', ['cell', ['label']]],
    ]);
    say(s, 'label', 'One fish');
    assert.equal(s.box('cell')[2], 100);
  });

  it('keeps the share where the row is an item of a flex container, which stretches it', () => {
    // An inline-flex box in a flex container is a flex item, as wide as the column makes it, and
    // sits in no line: the share is of that width. Chrome: the cell is 300 wide.
    const css = `${CHIP} .p { display: flex; flex-direction: column } .cell { width: 10% }`;
    const s = scene(css, ['p', ['chip', ['cell', ['label']]]], 'strict');
    say(s, 'label', 'One fish');
    assert.equal(s.box('chip')[2], 300);
    assert.equal(s.box('cell')[2], 300);
  });

  it('follows the row coming to sit in a line and leaving it', () => {
    const css = `${CHIP} .col { display: flex; flex-direction: column; width: 300px }`;
    const s = scene(css, ['p', ['chip', ['cell', ['label']]]], 'strict');
    say(s, 'label', 'One fish');
    assert.equal(s.box('cell')[2], 80);
    s.engine.setClasses(s.nodes.get('p')!, 'col');
    assert.equal(s.box('cell')[2], 300);
    s.engine.setClasses(s.nodes.get('p')!, 'p');
    assert.equal(s.box('cell')[2], 80);
  });

  it('follows the row gaining a width and losing it', () => {
    const s = scene(`${CHIP} .wide { width: 200px }`, ['p', ['chip', ['cell', ['label']]]]);
    say(s, 'label', 'One fish');
    assert.equal(s.box('cell')[2], 80);
    s.engine.addClass(s.nodes.get('chip')!, 'wide');
    assert.equal(s.box('cell')[2], 200);
    s.engine.removeClass(s.nodes.get('chip')!, 'wide');
    assert.equal(s.box('cell')[2], 80);
  });
});

describe('a box that shares a column with no height of its own', () => {
  // An empty state: a `flex-1` element in a column as tall as what it holds. A share of a height that is
  // the content's own is that content's height in a browser; to Yoga it is a share of nothing,
  // and the box is its padding with what it holds squeezed out of it.
  const css =
    '.host { display: flex; flex-direction: column; gap: 16px } .a { height: 100px }' +
    ' .c { flex: 1 1 0%; min-height: auto; display: flex; flex-direction: column; padding: 48px; box-sizing: border-box }' +
    ' .in { height: 60px; flex-shrink: 0 } .tall { height: 400px } .tint { opacity: 0.9 }';
  const spec: Spec = ['host', ['a'], ['c', ['in']], ['a two']];

  it('is as tall as what it holds, and stays so when it is styled again', () => {
    for (const laidOut of ['classic', 'strict'] as const) {
      const s = scene(css, spec, laidOut);
      assert.equal(s.box('c')[3], 156, laidOut);
      assert.equal(s.box('host')[3], 388, laidOut);
      s.engine.addClass(s.nodes.get('c')!, 'tint');
      s.engine.addClass(s.nodes.get('host')!, 'tint');
      assert.equal(s.box('c')[3], 156, laidOut);
    }
  });

  it('is left to Yoga without the automatic minimum, as a native view is', () => {
    // A scroll view that shares a column with no height has none: the page says to size the host.
    const s = scene(css.replace('min-height: auto; ', ''), spec);
    assert.equal(s.box('c')[3], 96);
  });

  it('takes its share where the column is given a height, and gives it back', () => {
    const s = scene(css, spec);
    s.engine.addClass(s.nodes.get('host')!, 'tall');
    // What is left of 400 once the two boxes of 100 and the two gaps are taken.
    assert.equal(s.box('c')[3], 168);
    s.engine.removeClass(s.nodes.get('host')!, 'tall');
    assert.equal(s.box('c')[3], 156);
  });
});

describe('an inline-level box holding a percentage width', () => {
  it('is as wide as the rest of its content, and the percentage is of that', () => {
    const s = scene(BASE, ['p', ['i', ['full'], ['w']]]);
    assert.deepEqual(s.box('i'), [0, 0, 120, 30]);
    assert.deepEqual(s.box('full'), [0, 0, 120, 10]);
  });

  it('is the same beside a block, on a line of its own', () => {
    const s = scene(`${BASE} .b { height: 5px }`, ['p', ['b'], ['i', ['full'], ['w']]]);
    assert.deepEqual(s.box('i'), [0, 5, 120, 30]);
  });

  it('takes a percentage further down, under boxes with no width of their own', () => {
    const s = scene(`${BASE} .half { width: 50%; height: 4px }`, [
      'p',
      ['i', ['w'], ['mid', ['half']]],
    ]);
    assert.deepEqual(s.box('i'), [0, 0, 120, 24]);
    assert.deepEqual(s.box('half'), [0, 20, 60, 4]);
  });

  it('is as wide as content that cannot get narrower, though the room is less', () => {
    // A browser's box in a line is no narrower than its narrowest content, and overflows.
    const s = scene(`${BASE} .w { width: 500px }`, ['p', ['i', ['full'], ['w']]]);
    assert.equal(s.box('i')[2], 500);
    assert.equal(s.box('full')[2], 500);
  });

  it('is that wide beside text that wraps, which a least width inside it does not', () => {
    // A calendar's month, two words over seven days: the words could wrap, the days cannot.
    const css = `.p { display: block; width: 100px } .i { display: inline-flex; flex-direction: column } .w { width: 180px; height: 20px }`;
    const s = scene(css, ['p', ['i', ['w']]]);
    say(s, 'i', 'October 2026');
    assert.equal(s.box('i')[2], 180);
  });

  it('keeps cells that share a row at their own least width in a room too small for them', () => {
    // A calendar in a popover narrower than it: seven days of 32 points are 224 wide, in a
    // browser and here, and are not shared out of the room there is.
    const css = `.p { display: block; width: 100px } .i { display: inline-flex; flex-direction: column } .week { display: flex; flex-direction: row; width: 100% } .cell { flex: 1 1 0%; flex-shrink: 1; min-width: auto } .day { min-width: 32px; height: 10px }`;
    const days: Spec[] = ['a', 'b', 'c', 'd', 'e'].map((d) => [`cell ${d}`, [`day ${d}`]]);
    const s = scene(css, ['p', ['i', ['week', ...days]]]);
    assert.equal(s.box('i')[2], 160);
    assert.equal(s.box('cell c')[2], 32);
  });

  it('follows its content growing', () => {
    const s = scene(`${BASE} .wide { width: 200px; height: 20px }`, ['p', ['i', ['full'], ['w']]]);
    assert.equal(s.box('full')[2], 120);
    s.engine.setClasses(s.nodes.get('w')!, 'wide');
    assert.equal(s.box('full')[2], 200);
  });

  it('stays the width of its room as words in it are added to, and narrows as they go', () => {
    // An answer written a letter at a time: once it fills the room, a longer one is no wider.
    const css = `.p { display: block; width: 100px } .i { display: inline-flex; flex-direction: column } .full { width: 100%; height: 10px }`;
    const s = scene(css, ['p', ['i', ['full']]]);
    say(s, 'i', 'an answer that wraps');
    assert.equal(s.box('i')[2], 100);
    const words = s.nodes.get('i')!.childList.at(-1)!.childList[0]!;
    let commits = 0;
    const complete = s.fabric.completeRoot.bind(s.fabric);
    s.fabric.completeRoot = (tag, set) => (commits++, complete(tag, set));
    s.engine.setText(words, 'an answer that wraps, and goes on');
    s.engine.commit();
    assert.equal(commits, 1);
    s.engine.setText(words, 'short');
    assert.equal(s.box('i')[2], 50);
    assert.equal(s.box('full')[2], 50);
  });

  it('keeps a width of its own, which the percentage is then of', () => {
    const s = scene(`${BASE} .i { width: 250px }`, ['p', ['i', ['full'], ['w']]]);
    assert.equal(s.box('full')[2], 250);
  });

  it('is left alone in a flex container, where it is stretched and the percentage is of that', () => {
    const s = scene(`${BASE} .p { display: flex }`, ['p', ['i', ['full'], ['w']]]);
    assert.equal(s.box('full')[2], 300);
  });

  it('gives the percentage back to the room on offer when it stops sitting in a line', () => {
    const s = scene(`${BASE} .col { display: flex; flex-direction: column }`, [
      'p',
      ['i', ['full'], ['w']],
    ]);
    assert.equal(s.box('full')[2], 120);
    s.engine.setClasses(s.nodes.get('i')!, 'col');
    assert.equal(s.box('full')[2], 300);
  });

  it('gives it back as well where the sheet that asks for it came after the boxes', () => {
    // Committed as plain flex first, with nothing asked of the engine and nothing noted.
    const s = scene('.col { display: flex; flex-direction: column }', [
      'p',
      ['i', ['full'], ['w']],
    ]);
    s.box('p');
    s.engine.addGlobalSheet(compileCss(BASE, 'late.css'));
    assert.equal(s.box('full')[2], 120);
    s.engine.setClasses(s.nodes.get('i')!, 'col');
    assert.equal(s.box('full')[2], 300);
  });

  it('is as wide as a full-width row in it wants, where Yoga gives the row all the room', () => {
    // A calendar's header: `flex w-full justify-between` over a grid of days.
    const css = `${BASE} .head { display: flex; flex-direction: row; width: 100%; justify-content: space-between } .btn { width: 32px; height: 32px }`;
    const s = scene(css, ['p', ['i', ['head', ['btn'], ['btn two']], ['w']]]);
    assert.deepEqual(s.box('i'), [0, 0, 120, 52]);
    assert.deepEqual(s.box('head'), [0, 0, 120, 32]);
    assert.deepEqual(s.box('btn two'), [88, 0, 32, 32]);
  });

  it('is as wide as cells that share a row want, where Yoga takes a zero basis as no width', () => {
    // A calendar's week: seven `flex-1` cells, each holding a day of a set size.
    const css = `${BASE} .week { display: flex; flex-direction: row; width: 100% } .cell { flex: 1 1 0% } .day { width: 32px; height: 32px }`;
    const s = scene(css, [
      'p',
      ['i', ['week', ['cell', ['day']], ['cell b', ['day b']], ['cell c', ['day c']]]],
    ]);
    assert.deepEqual(s.box('i'), [0, 0, 96, 32]);
    assert.deepEqual(s.box('cell b'), [32, 0, 32, 32]);
  });

  it('is as wide as cells that keep a proportion want, under blocks that stretch', () => {
    // A calendar's days: a block table of rows, each cell square and holding a square day.
    const css = `${BASE} .table { display: block; width: 100% } .week { display: flex; flex-direction: row; width: 100% } .cell { width: 100%; flex: 1 1 0%; aspect-ratio: 1 } .day { width: 100%; min-width: 32px; aspect-ratio: 1 }`;
    const s = scene(css, [
      'p',
      ['i', ['table', ['body', ['week', ['cell', ['day']], ['cell b', ['day b']]]]]],
    ]);
    assert.deepEqual(s.box('i'), [0, 0, 64, 32]);
    assert.deepEqual(s.box('cell b'), [32, 0, 32, 32]);
  });

  it('is fitted again when the room it is in changes, though nothing about it did', () => {
    // An overlay's pane: fitted first while the box around it has no room at all, and then
    // the box is given the screen. A style bound on the box alone: nothing in it is merged
    // again. Text that wraps is what makes the room matter: fourteen characters, 140 points.
    const css = `.box { max-width: 1px } .p { display: block } .i { display: inline-flex; flex-direction: column; padding: 12px } .full { width: 100%; height: 10px }`;
    const s = scene(css, ['box', ['p', ['i', ['full']]]]);
    say(s, 'i', 'aaaa bbbb cccc');
    // No room: its longest word, and its padding.
    assert.equal(s.box('i')[2], 64);
    s.engine.setProp(s.nodes.get('box')!, 'style', { maxWidth: 300 });
    assert.equal(s.box('i')[2], 164);
    assert.equal(s.box('full')[2], 140);
    // And when the room shrinks again under what it wants: it wraps, and fits inside.
    s.engine.setProp(s.nodes.get('box')!, 'style', { maxWidth: 100 });
    assert.ok(s.box('i')[2] <= 100);
  });

  it('is fitted again when a box further up is given room, through boxes as wide as their content', () => {
    // An overlay as the CDK builds one: an outer box with no room at first, a pane out of the
    // flow that is no wider than it, and then the outer box is given the screen. Every box
    // between it and the content is as wide as what it holds, so none of them says anything.
    const css = `.box { position: absolute; display: flex; flex-direction: column; min-width: 1px } .pane { position: absolute; max-width: 100% } .content { align-self: flex-start } .p { display: block; padding: 12px } .i { display: inline-flex; flex-direction: column } .full { width: 100%; height: 10px }`;
    const s = scene(css, ['box', ['pane', ['content', ['p', ['i', ['full']]]]]]);
    say(s, 'i', 'aaaa bbbb cccc');
    // The padding is the host's: the room inside it is none, before and after.
    assert.equal(s.box('i')[2], 0);
    s.engine.setProp(s.nodes.get('box')!, 'style', { top: 0, left: 0, right: 0, bottom: 0 });
    assert.equal(s.box('i')[2], 140);
    assert.equal(s.box('full')[2], 140);
  });

  it('widens the boxes around it that are as wide as their content, when it overflows the room', () => {
    // A calendar in a popover the CDK made narrower than it: the popover's panel is as wide as
    // the calendar and its padding, as a flex item in a browser is no narrower than its content.
    const css = `.box { position: absolute; width: 100px; display: flex; flex-direction: column } .pane { position: absolute; max-width: 100% } .content { align-self: flex-start } .p { display: block; padding: 12px } .i { display: inline-flex; flex-direction: column } .week { display: flex; flex-direction: row; width: 100% } .cell { flex: 1 1 0%; flex-shrink: 1; min-width: auto } .day { min-width: 32px; height: 10px } .few { display: none }`;
    const days: Spec[] = ['a', 'b', 'c', 'd', 'e'].map((d) => [`cell ${d}`, [`day ${d}`]]);
    const s = scene(css, ['box', ['pane', ['content', ['p', ['i', ['week', ...days]]]]]]);
    assert.equal(s.box('i')[2], 160);
    assert.equal(s.box('p')[2], 184);
    assert.equal(s.box('content')[2], 184);
    // Fewer days, which fit: nothing is held wider than its content any more.
    for (const d of ['c', 'd', 'e']) s.engine.setClasses(s.nodes.get(`cell ${d}`)!, 'cell few');
    assert.equal(s.box('i')[2], 64);
    assert.equal(s.box('content')[2], 88);
  });

  it('leaves the boxes around it that are as wide as their room, which it reaches out of', () => {
    // A calendar in a page narrower than it: the page, and the screen it is on, are as wide
    // as the screen. Only a box sized by what it holds is any wider for what it holds.
    const css = `.room { width: 100px; display: flex; flex-direction: column } .plain { display: block; padding: 4px } .i { display: inline-flex; flex-direction: column } .full { width: 100%; height: 10px } .w { width: 160px; height: 20px }`;
    const s = scene(css, ['room', ['outer', ['plain', ['i', ['full'], ['w']]]]]);
    assert.equal(s.box('i')[2], 160);
    assert.equal(s.box('plain')[2], 100);
    assert.equal(s.box('outer')[2], 100);
  });

  it('settles in the commit it was changed in, with no pass left over', () => {
    const s = scene(BASE, ['p', ['i', ['full'], ['w']]]);
    assert.equal(s.engine.commit(), true);
    assert.equal(s.engine.commit(), false);
  });
});

describe('an item of a row that holds a box as wide as itself', () => {
  // A group of toggles: each a flex item with no width of its own, around a button that is
  // `width: 100%`. The item is as wide as the button's words, and the button as wide as the
  // item; to Yoga a share of an item with no width is a share of the room, and each item is
  // as wide as the whole group may be.
  const CSS =
    '.col { display: flex; flex-direction: column; width: 400px }' +
    ' .group { display: inline-flex; flex-direction: row; align-self: flex-start }' +
    ' .toggle { display: block } .button { width: 100%; height: 40px; padding: 0 12px }';

  function group(css = CSS) {
    // Laid out as an app that mounts a web library is: with none of Yoga's errata.
    const s = scene(
      css,
      ['col', ['group', ['toggle a', ['button ab']], ['toggle b', ['button bb']]]],
      'strict',
    );
    say(s, 'button ab', 'Left');
    say(s, 'button bb', 'Centre');
    return s;
  }

  it('is as wide as what the box holds, beside the next', () => {
    const s = group();
    assert.deepEqual(s.box('toggle a'), [0, 0, 64, 40]);
    assert.deepEqual(s.box('toggle b'), [64, 0, 84, 40]);
    assert.equal(s.box('button bb')[2], 84);
    assert.equal(s.box('group')[2], 148);
  });

  it('is not one where it is display: contents, and no box at all', () => {
    // A component's host that hands its children to the row: there is nothing to fit.
    const s = group(`${CSS} .toggle.a { display: contents } .roomy { padding: 0 20px }`);
    s.engine.commit();
    let commits = 0;
    const complete = s.fabric.completeRoot.bind(s.fabric);
    s.fabric.completeRoot = (tag, set) => (commits++, complete(tag, set));
    s.engine.setClasses(s.nodes.get('button ab')!, 'button ab roomy');
    s.engine.commit();
    assert.equal(commits, 1);
  });

  it('is fitted again for what moves a box in it, and not for what only paints one', () => {
    const s = group(
      `${CSS} .lit { background-color: red } .roomy { padding: 0 20px } .tall { height: 30px }`,
    );
    s.build(['other'], s.nodes.get('col')!);
    s.engine.commit();
    let commits = 0;
    const complete = s.fabric.completeRoot.bind(s.fabric);
    s.fabric.completeRoot = (tag, set) => (commits++, complete(tag, set));
    // A button pressed: a colour, and the item around it is as wide as it was.
    // And a box somewhere else resized by the same commit, which is nothing to the item.
    s.engine.setClasses(s.nodes.get('button ab')!, 'button ab lit');
    s.engine.setClasses(s.nodes.get('other')!, 'other tall');
    s.engine.commit();
    assert.equal(commits, 1);
    s.engine.setClasses(s.nodes.get('button ab')!, 'button ab roomy');
    assert.equal(s.box('toggle a')[2], 80);
    assert.ok(commits > 2);
  });

  it('keeps a width, a share of the row or a basis it is given', () => {
    const wide = group(`${CSS} .a { width: 120px } .b { flex: 1 1 0% }`);
    assert.equal(wide.box('toggle a')[2], 120);
    assert.equal(wide.box('button ab')[2], 120);
  });
});

describe('an item of a row that is a row itself, holding a box as wide as itself', () => {
  // A dialog: a wrapper that centres a pane, the pane a flex row with no width of its own
  // around a container that is `width: 100%` of it. The pane is as wide as what the container
  // holds, in the middle of the wrapper; to Yoga a share of a pane with no width is a share of
  // the room, and the dialog is as wide as the screen.
  const CSS =
    '.root { width: 400px; height: 800px }' +
    ' .wrap { display: flex; flex-direction: row; width: 100%; height: 100%; justify-content: center; align-items: center }' +
    ' .pane { display: flex; flex-direction: row; max-width: 100% }' +
    ' .box { display: block; width: 100%; height: 100% }' +
    ' .sheet { display: flex; flex-direction: column; padding: 20px }';
  const SPEC: Spec = ['root', ['wrap', ['pane', ['box', ['sheet', ['words']]]]]];

  function dialog(css = CSS) {
    const s = scene(css, SPEC, 'strict');
    say(s, 'words', 'Keep the changes');
    return s;
  }

  it('is as wide as what the box holds, in the middle of the row', () => {
    const s = dialog();
    // Sixteen characters at ten points, and twenty of padding each side.
    assert.deepEqual(s.box('pane').slice(0, 3), [100, 370, 200]);
    assert.equal(s.box('box')[2], 200);
  });

  it('keeps a width, a share of the row or a basis it is given', () => {
    assert.equal(dialog(`${CSS} .pane { width: 300px }`).box('pane')[2], 300);
    assert.equal(dialog(`${CSS} .pane { flex: 1 1 0% }`).box('pane')[2], 400);
    assert.equal(dialog(`${CSS} .pane { flex-basis: 250px }`).box('pane')[2], 250);
  });

  it('follows the box no longer being a share of it, and being one again', () => {
    const s = dialog(`${CSS} .own { width: 320px }`);
    assert.equal(s.box('pane')[2], 200);
    s.engine.setClasses(s.nodes.get('box')!, 'box own');
    assert.equal(s.box('pane')[2], 320);
    s.engine.setClasses(s.nodes.get('box')!, 'box');
    assert.equal(s.box('pane')[2], 200);
  });

  it('is left as it is for a share that is out of the flow, or a cell that shares the item', () => {
    // A chip: an action that is a row's item, with a focus ring over it that is absolute and
    // `width: 100%`, and a graphic that is `flex: 1 0 auto` and no width until it is chosen.
    const css =
      '.root { width: 400px } .wrap { display: flex; flex-direction: row }' +
      ' .pane { display: flex; flex-direction: row; position: relative; height: 32px }' +
      ' .ring { position: absolute; top: 0; left: 0; width: 100%; height: 100% }' +
      ' .graphic { flex: 1 0 auto; width: 0; height: 24px } .label { width: 80px }';
    const s = scene(css, ['root', ['wrap', ['pane', ['ring'], ['graphic'], ['label']]]], 'strict');
    assert.equal(s.box('pane')[2], 80);
    assert.equal(s.box('graphic')[2], 0);
    assert.equal(s.box('ring')[2], 80);
  });

  it('is no wider than the row where what it holds is wider', () => {
    // ponytail: as wide as the words once they have wrapped, where a browser keeps the pane
    // the whole width of the row. Fit to the room if a dialog of long text is seen narrow.
    const s = scene(CSS, SPEC, 'strict');
    say(s, 'words', 'A sentence that is a good deal longer than four hundred points');
    const [left, , width] = s.box('pane');
    assert.equal(width! <= 400 && left! >= 0, true);
  });
});

describe('many boxes fitted in one commit', () => {
  // A page of a library's buttons and chips: each is as wide as its content, and each was
  // committed twice on its own to be fitted, one after the next. A page of forty was eighty
  // commits of the whole screen before it showed. Boxes with nothing of each other in them are
  // measured in the one commit and sized in the next, however many they are.
  const CSS =
    '.b { display: block; width: 300px } .i { display: inline-flex; flex-direction: column } ' +
    '.full { width: 100%; height: 10px } .w { width: 120px; height: 20px } .n { width: 60px; height: 20px }';
  const page = (count: number) => {
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
    const view = (classes: string, parent: EngineNode, id = classes): EngineNode => {
      const node = engine.createElement('view');
      engine.setClasses(node, classes);
      engine.setProp(node, 'nativeID', id);
      engine.appendChild(parent, node);
      return node;
    };
    for (let at = 0; at < count; at++) {
      const fitted = view('i', view('b', engine.root, `b${at}`), `i${at}`);
      view('full', fitted, `full${at}`);
      view(at % 2 ? 'n' : 'w', fitted, `w${at}`);
    }
    let commits = 0;
    const complete = fabric.completeRoot.bind(fabric);
    fabric.completeRoot = (tag, set) => (commits++, complete(tag, set));
    engine.commit();
    const width = (name: string) => fabric.box(name).width;
    return { commits, width };
  };

  it('takes as many commits for twelve as for two, and fits each to its own content', () => {
    const two = page(2);
    const twelve = page(12);
    assert.equal(twelve.commits, two.commits);
    assert.equal(twelve.width('i0'), 120);
    assert.equal(twelve.width('full0'), 120);
    assert.equal(twelve.width('i11'), 60);
    assert.equal(twelve.width('full11'), 60);
  });

  it('fits a box inside another first, and the one around it to what that came to', () => {
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
    const view = (classes: string, parent: EngineNode, id = classes): EngineNode => {
      const node = engine.createElement('view');
      engine.setClasses(node, classes);
      engine.setProp(node, 'nativeID', id);
      engine.appendChild(parent, node);
      return node;
    };
    const outer = view('i', view('b', engine.root), 'outer');
    view('full', outer, 'outerFull');
    const inner = view('i', outer, 'inner');
    view('full', inner, 'innerFull');
    view('w', inner);
    engine.commit();
    assert.equal(fabric.box('inner').width, 120);
    assert.equal(fabric.box('innerFull').width, 120);
    assert.equal(fabric.box('outer').width, 120);
    assert.equal(fabric.box('outerFull').width, 120);
  });
});

describe('a box fitted to a text field that takes a share of it', () => {
  // A library's field with a button beside it: `display: inline-flex` on the box, and
  // `flex: 1 1 auto; width: 1%` on the field. A browser sizes the box from the field's own
  // width, its twenty characters, and the field then fills it.
  const CSS =
    '.p { display: block; width: 300px } .i { display: inline-flex; flex-direction: row } ' +
    '.f { flex: 1 1 auto; width: 1%; font-size: 16px; height: 30px; padding: 0 12px }';

  it('is as wide as the field is by its size, and the field as wide as the box', () => {
    const s = scene(CSS, ['p', ['i']]);
    const field = s.engine.createElement('text-input');
    s.engine.setClasses(field, 'f');
    s.engine.setProp(field, 'nativeID', 'f');
    s.engine.setProp(field, 'size', 20);
    s.engine.appendChild(s.nodes.get('i')!, field);
    // Twenty characters of a 16 point font, 175 points, and its padding.
    assert.equal(Math.round(s.box('i')[2]!), 199);
    assert.equal(Math.round(s.box('f')[2]!), 199);
  });
});

describe('items of a row that grow from what they hold', () => {
  // `flex: 1 1 auto` on each of a wrapping row's items, each a label over a field as wide as
  // the item. A browser starts each at the width of what it holds, with the percentage set
  // aside, wraps the row on those, and grows each into its line.
  const CSS =
    '.row { display: flex; flex-direction: row; flex-wrap: wrap; width: 300px } ' +
    '.it { flex: 1 1 auto } .full { width: 100%; height: 10px } .w { width: 120px; height: 20px } ' +
    '.wide { width: 200px; height: 20px }';

  it('share a line where what they hold fits it, each wider by its share of what is left', () => {
    const s = scene(CSS, ['row', ['it a', ['w'], ['full']], ['it b', ['w w2'], ['full f2']]]);
    assert.deepEqual(s.box('it a'), [0, 0, 150, 30]);
    assert.deepEqual(s.box('it b'), [150, 0, 150, 30]);
    assert.equal(s.box('full')[2], 150);
  });

  it('are as wide as a field in them is by its characters, where the field is as wide as they are', () => {
    // A field has no content to be measured by: twenty characters is what it holds.
    const s = scene(`${CSS} .f { width: 100%; font-size: 16px; height: 30px }`, [
      'row',
      ['it a'],
      ['it b'],
    ]);
    for (const [item, id] of [
      ['it a', 'f1'],
      ['it b', 'f2'],
    ] as const) {
      const field = s.engine.createElement('text-input');
      s.engine.setClasses(field, 'f');
      s.engine.setProp(field, 'nativeID', id);
      s.engine.setProp(field, 'size', 20);
      s.engine.appendChild(s.nodes.get(item)!, field);
    }
    // 175 points each, which is more than the row has for two: a line each, and each fills it.
    assert.deepEqual(s.box('it a'), [0, 0, 300, 30]);
    assert.deepEqual(s.box('it b'), [0, 30, 300, 30]);
    assert.equal(s.box('f2')[2], 300);
  });

  it('take a line each where what they hold does not fit one, and fill it', () => {
    const s = scene(CSS, ['row', ['it a', ['wide'], ['full']], ['it b', ['wide w2'], ['full f2']]]);
    assert.deepEqual(s.box('it a'), [0, 0, 300, 30]);
    assert.deepEqual(s.box('it b'), [0, 30, 300, 30]);
    assert.equal(s.box('full f2')[2], 300);
  });
});

describe('an item of a column that the column does not stretch', () => {
  // A library's field with a button beside it, in a column that centres its items: the box is
  // as wide as what it holds, as an item of a row is, and the field's share is of that.
  const CSS =
    '.col { display: flex; flex-direction: column; align-items: center; width: 300px } ' +
    '.own { align-items: stretch } .mid { align-self: center } ' +
    '.i { display: flex; flex-direction: row } .b { width: 40px; height: 30px } ' +
    '.f { flex: 1 1 auto; width: 1%; font-size: 16px; height: 30px; padding: 0 12px }';
  const fielded = (column: string, item = 'i') => {
    const s = scene(CSS, [column, [item, ['b']]]);
    const field = s.engine.createElement('text-input');
    s.engine.setClasses(field, 'f');
    s.engine.setProp(field, 'nativeID', 'f');
    s.engine.setProp(field, 'size', 20);
    s.engine.insertBefore(s.nodes.get(item)!, field, s.nodes.get('b')!);
    return s;
  };

  it('is as wide as the field is by its size and what is beside it, in the middle', () => {
    const s = fielded('col');
    // Twenty characters of a 16 point font, 175 points, its padding, and the button.
    assert.deepEqual(s.box('i').map(Math.round), [31, 0, 239, 30]);
    assert.equal(Math.round(s.box('f')[2]!), 199);
  });

  it('is so by its own alignment, and as wide as the column where the column stretches it', () => {
    assert.equal(Math.round(fielded('col own', 'i mid').box('i mid')[2]!), 239);
    const stretched = fielded('col own');
    assert.equal(stretched.box('i')[2], 300);
    assert.equal(stretched.box('f')[2], 260);
  });
});

describe('an item of a row holding a share of it some boxes down', () => {
  // A form in a row that centres it: a column, around a column, around a row, around a box as
  // wide as that row. Each box between is as wide as the form, which is as wide as what it
  // holds with that share set aside.
  const CSS =
    '.row { display: flex; flex-direction: row; justify-content: center; width: 300px } ' +
    '.form { display: flex; flex-direction: column } .group { display: flex; flex-direction: column } ' +
    '.line { display: flex; flex-direction: row } ' +
    '.full { width: 100%; height: 10px } .w { width: 120px; height: 20px } .fixed { width: 200px }';

  it('is as wide as what it holds, with the share set aside', () => {
    const s = scene(CSS, ['row', ['form', ['group', ['line', ['full']], ['w']]]]);
    assert.deepEqual(s.box('form'), [90, 0, 120, 30]);
    assert.equal(s.box('full')[2], 120);
  });

  it('is left alone under a box with a width of its own, which the share is of', () => {
    const s = scene(CSS, ['row', ['form', ['group fixed', ['line', ['full']], ['w']]]]);
    assert.equal(s.box('form')[2], 200);
    assert.equal(s.box('full')[2], 200);
    assert.equal(s.nodes.get('form')!.fit, undefined);
  });
});

describe('a box fitted to a picture that is as wide as it', () => {
  // A card in a column that centres it, around a picture with `width: 100%`. A picture has a
  // width of its own, which is what the card is fitted to with the percentage set aside: no
  // wider than the room, and as wide as the picture where that is narrower.
  const CSS =
    '.col { display: flex; flex-direction: column; align-items: center; width: 300px } ' +
    '.card { display: flex; flex-direction: column } .full { width: 100% }';
  const pictured = (width: number, height: number) => {
    const s = scene(CSS, ['col', ['card']]);
    const picture = s.engine.createElement('image');
    s.engine.setClasses(picture, 'full');
    s.engine.setProp(picture, 'nativeID', 'full');
    s.engine.setProp(picture, 'intrinsicSize', { width, height });
    s.engine.appendChild(s.nodes.get('card')!, picture);
    return s;
  };

  it('is as wide as the room where the picture is wider, and the picture fills it', () => {
    const s = pictured(600, 300);
    assert.deepEqual(s.box('card'), [0, 0, 300, 150]);
    assert.deepEqual(s.box('full'), [0, 0, 300, 150]);
  });

  it('is as wide as the picture where that is narrower than the room', () => {
    const s = pictured(100, 50);
    assert.deepEqual(s.box('card'), [100, 0, 100, 50]);
    assert.deepEqual(s.box('full'), [100, 0, 100, 50]);
  });
});

describe('a box out of the flow with no width, holding a least width that is a share of it', () => {
  // A library's panel in the body: `position: absolute` with a place and a least width, the
  // field's, around a box with `min-width: 100%`. A browser sizes the panel from what it holds
  // with the percentage set aside, and no narrower than its own least width; to Yoga the
  // percentage is of the room, and the panel is as wide as the screen.
  const CSS =
    '.body { position: absolute; top: 0; left: 0; width: 300px; height: 400px } ' +
    '.pane { position: absolute; top: 10px; left: 20px; min-width: 120px } ' +
    '.content { display: block } .panel { display: block; min-width: 100% } ' +
    '.row { display: block; height: 20px } .between { left: 20px; right: 30px }';

  it('is as wide as its own least width where what it holds is narrower', () => {
    const s = scene(CSS, ['body', ['pane', ['content', ['panel', ['row']]]]]);
    say(s, 'row', 'aaaa');
    assert.equal(s.box('pane')[2], 120);
    assert.equal(s.box('panel')[2], 120);
    assert.equal(s.box('pane')[0], 20);
  });

  it('is as wide as what it holds where that is wider, and follows it changing', () => {
    const s = scene(CSS, ['body', ['pane', ['content', ['panel', ['row']]]]]);
    say(s, 'row', 'aaaaaaaaaaaaaaaaaaaa');
    assert.equal(s.box('pane')[2], 200);
    assert.equal(s.box('panel')[2], 200);
    // A longer row comes to be in it, as a list is filtered to other options.
    s.build(['row longer'], s.nodes.get('panel')!);
    say(s, 'row longer', 'bbbbbbbbbbbbbbbbbbbbbbbbb');
    assert.equal(s.box('pane')[2], 250);
    assert.equal(s.box('panel')[2], 250);
  });

  it('is left as wide as its insets make it where it has one on each side', () => {
    const s = scene(CSS, ['body', ['pane between', ['content', ['panel', ['row']]]]]);
    say(s, 'row', 'aaaa');
    assert.equal(s.box('pane between')[2], 250);
    assert.equal(s.nodes.get('pane between')!.fit, undefined);
  });
});
