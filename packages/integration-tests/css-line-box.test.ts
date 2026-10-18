/**
 * Inline-level boxes among blocks. A browser puts a run of them in a line box: side by side,
 * wrapping when the line is full, with the blocks before and after on lines of their own. A
 * flex column has no such thing, so the engine commits a view of its own around each run, a
 * row that wraps, which no node of the app stands for.
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

function scene(
  css: string,
  spec: Spec,
  fontScale?: number,
  conformance: 'classic' | 'strict' = 'classic',
) {
  const fabric = createLaidOutFabric(conformance);
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    ...(fontScale && { conditions: { width: 400, height: 800, colorScheme: 'light', fontScale } }),
  });
  const nodes = new Map<string, EngineNode>();
  const build = ([name, ...children]: Spec, parent: EngineNode, before?: EngineNode): void => {
    const node = engine.createElement('view');
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
    if (before) engine.insertBefore(parent, node, before);
    else engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) build(child, node);
  };
  build(spec, engine.root);
  const box = (name: string) => {
    engine.commit();
    const { left, top, width, height } = fabric.box(name);
    return [left, top, width, height];
  };
  /** How many views a box is committed with directly under it. */
  const count = (name: string): number => {
    engine.commit();
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === name ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(fabric.committed)!.children.length;
  };
  return { engine, fabric, nodes, build, box, count };
}

/** A box where Chrome has it, to half a point a line: Chrome rounds a font's ascent and descent. */
const nearly = (actual: (number | undefined)[], expected: number[], lines = 1) =>
  assert.ok(
    expected.every((value, i) => Math.abs(actual[i]! - value) < 0.5 * lines),
    `[${actual.join(', ')}], not [${expected.join(', ')}]`,
  );

// The default font, 14 points on a line of its own height: Chrome's line of a 20 point box on it
// is 23 tall, the room under the baseline added.
const BASE =
  '.p { display: block; width: 200px } .b { height: 10px } .i { display: inline-block; width: 50px; height: 20px } .wide { width: 80px }';

describe('text beside an inline-level box, with no block among them', () => {
  // A form field's hint: an empty inline-block as tall as a line, and the hint's words after it.
  // A browser puts them on one line. Stacked, the box is a line of its own over the words.
  const CSS = '.h { display: block; width: 200px } .i { display: inline-block; height: 16px }';
  const held = (s: ReturnType<typeof scene>) => {
    s.engine.commit();
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === 'h' ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    const h = find(s.fabric.committed)!;
    return {
      direction: h.props['flexDirection'] ?? undefined,
      wrap: h.props['flexWrap'] ?? undefined,
      views: h.children.map((child) => child.viewName),
    };
  };

  it('shares their line: the container is a row that wraps, holding the box and the words', () => {
    const s = scene(CSS, ['h', ['i']]);
    s.engine.appendChild(s.nodes.get('h')!, s.engine.createText('As it is on your passport'));
    // Each word a paragraph of its own: see "the words beside a box in a line".
    assert.deepEqual(held(s), {
      direction: 'row',
      wrap: 'wrap',
      views: ['View', ...Array<string>(6).fill('Paragraph')],
    });
  });

  it('is a block of its own again when the box beside it goes', () => {
    const s = scene(CSS, ['h', ['i']]);
    s.engine.appendChild(s.nodes.get('h')!, s.engine.createText('words'));
    held(s);
    s.engine.removeChild(s.nodes.get('h')!, s.nodes.get('i')!);
    assert.deepEqual(held(s), { direction: undefined, wrap: undefined, views: ['Paragraph'] });
  });

  it('stays a block where a block is among them, as text alone among blocks is', () => {
    const s = scene(`${CSS} .b { height: 10px }`, ['h', ['i'], ['b']]);
    s.engine.appendChild(s.nodes.get('h')!, s.engine.createText('words'));
    assert.equal(held(s).direction, undefined);
  });
});

describe('the words beside a box in a line', () => {
  // A sentence with a link in it, a reply with a dot after its last word: a browser breaks the
  // line between any two words and the box is wherever the words before it end. A paragraph is
  // one box, as wide as its longest line, so each word is a paragraph of its own on the line.
  // Text is ten points a character here, and a no-break space is the space after a word.
  const CSS =
    '.h { display: block; width: 100px } .i { display: inline-block; width: 6px; height: 6px }';
  const NBSP = '\u00a0';
  const drawn = (s: ReturnType<typeof scene>) => {
    s.engine.commit();
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === 'h' ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    const words = (node: FakeFabricNode): string =>
      String(node.props['text'] ?? '') + node.children.map(words).join('');
    return find(s.fabric.committed)!.children.map((child) =>
      child.viewName === 'Paragraph' ? words(child) : child.viewName,
    );
  };

  it('are each on the line, with the box after the last of them and not under them all', () => {
    const s = scene(CSS, ['h']);
    const h = s.nodes.get('h')!;
    s.engine.appendChild(h, s.engine.createText('aaaa bbbb cccc '));
    s.build(['i'], h);
    assert.deepEqual(drawn(s), [`aaaa${NBSP}`, `bbbb${NBSP}`, `cccc${NBSP}`, 'View']);
    // Two words to a line of a hundred points: the box is after the third, on the second line.
    const [left, top] = s.box('i');
    assert.equal(left, 50);
    assert.ok(top! >= 20, `on the second line, at ${top}`);
  });

  it('keep the space either side of a box between them', () => {
    const s = scene(CSS, ['h']);
    const h = s.nodes.get('h')!;
    s.engine.appendChild(h, s.engine.createText(' Built with '));
    s.build(['i'], h);
    s.engine.appendChild(h, s.engine.createText(' and Angular. '));
    assert.deepEqual(drawn(s), [
      `Built${NBSP}`,
      `with${NBSP}`,
      'View',
      `${NBSP}and${NBSP}`,
      'Angular.',
    ]);
  });

  it('follow the text changing, to more words and to fewer', () => {
    const s = scene(CSS, ['h', ['i']]);
    const text = s.engine.createText('one');
    s.engine.appendChild(s.nodes.get('h')!, text);
    assert.deepEqual(drawn(s), ['View', 'one']);
    s.engine.setText(text, 'one two three');
    assert.deepEqual(drawn(s), ['View', `one${NBSP}`, `two${NBSP}`, 'three']);
    s.engine.setText(text, 'four');
    assert.deepEqual(drawn(s), ['View', 'four']);
  });

  it('are one paragraph again when the box beside them goes, and words when it is back', () => {
    const s = scene(CSS, ['h', ['i']]);
    const h = s.nodes.get('h')!;
    s.engine.appendChild(h, s.engine.createText('one two'));
    assert.deepEqual(drawn(s), ['View', `one${NBSP}`, 'two']);
    const i = s.nodes.get('i')!;
    s.engine.removeChild(h, i);
    assert.deepEqual(drawn(s), ['one two']);
    s.engine.insertBefore(h, i, h.childList[0]!);
    assert.deepEqual(drawn(s), ['View', `one${NBSP}`, 'two']);
  });
});

describe('the room a line keeps under its baseline', () => {
  // A browser lays every line out around a strut of the container's font: an empty inline-block
  // sits on the baseline, and the line still has the font's descent under it. A form field keeps
  // a row for its hint with one such box, 16 tall, and the row is 20: a 12px font on a 16px line.
  const ROW =
    '.h { display: block; width: 200px; font-size: 12px; line-height: 16px } .i { display: inline-block; width: 4px; height: 16px }';
  const committed = (s: ReturnType<typeof scene>) => {
    s.engine.commit();
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === 'h' ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(s.fabric.committed)!.props;
  };

  it('is the descent of its font under a box with no text, and half the leading', () => {
    const s = scene(ROW, ['h', ['i']]);
    const [, , , height] = s.box('h');
    assert.ok(Math.abs(height! - 19.73) < 0.5, `a row of ${height}`);
  });

  it('is added to a padding of its own', () => {
    const s = scene(`${ROW} .h { padding-bottom: 5px }`, ['h', ['i']]);
    const [, , , height] = s.box('h');
    assert.ok(Math.abs(height! - 24.73) < 0.5, `a row of ${height}`);
  });

  it('is the same where there is text on the line, which sits on the same baseline', () => {
    // Chrome: the box on the baseline, the word's line around it, the row 20 tall.
    const s = scene(ROW, ['h', ['i']]);
    s.engine.appendChild(s.nodes.get('h')!, s.engine.createText('hint'));
    assert.ok(Math.abs(s.box('h')[3]! - 19.73) < 0.5, `a row of ${s.box('h')[3]}`);
    assert.ok(Math.abs(s.box('i')[1]!) < 0.5, `the box at ${s.box('i')[1]}`);
  });

  it('leaves a box with a height of its own, or held between two insets, as tall as that', () => {
    const tall = scene(`${ROW} .h { height: 30px }`, ['h', ['i']]);
    assert.equal(tall.box('h')[3], 30);
    const held = scene(
      `.w { width: 100px; height: 40px } ${ROW} .h { position: absolute; top: 0; bottom: 0 }`,
      ['w', ['h', ['i']]],
    );
    assert.equal(held.box('h')[3], 40);
  });

  it("is the field's own under a text field, which has a baseline with nothing typed", () => {
    const s = scene(ROW, ['h', ['i']]);
    const field = s.engine.createElement('text-input');
    s.engine.setProp(field, 'nativeID', 'f');
    s.engine.appendChild(s.nodes.get('h')!, field);
    // On a line of its own, under the box's line and the room under that: none is added under
    // the field, which has its own.
    const [, top, , height] = s.box('f');
    assert.equal(s.box('h')[3], top! + height!);
    assert.ok(Math.abs(top! - 19.73) < 0.5, `the field at ${top}`);
  });

  it('is kept once where a line of boxes is itself on a line: they share the one baseline', () => {
    // A custom element around a switch, in a block: the element's line and the block's are one
    // line to a browser, with the font's descent under it once.
    const NESTED = `${ROW} .n { display: inline-block } .n.alone { display: block }`;
    const s = scene(NESTED, ['h', ['n', ['i']]]);
    s.engine.commit();
    const [, , , height] = s.box('h');
    assert.ok(Math.abs(height! - 19.73) < 0.5, `a row of ${height}`);
    // And its own again when it is no longer on a line: a block of its own.
    s.engine.setClasses(s.nodes.get('n')!, 'n alone');
    const [, , , block] = s.box('n');
    assert.ok(Math.abs(block! - 19.73) < 0.5, `a block of ${block}`);
  });

  it('goes with the line, when the box that made it one does', () => {
    const s = scene(ROW, ['h', ['i']]);
    assert.ok(Math.abs(s.box('h')[3]! - 19.73) < 0.5, `a row of ${s.box('h')[3]}`);
    s.engine.removeChild(s.nodes.get('h')!, s.nodes.get('i')!);
    assert.equal(s.box('h')[3], 0);
    assert.equal(committed(s)['minHeight'] ?? null, null);
  });
});

describe('the room a line keeps over its baseline', () => {
  // A browser's line is at least as tall as its line height, even with nothing on it but an
  // empty inline-block, which sits on the baseline: a 20px line of a 10px font has its baseline
  // 14 down in Chrome, from a font with the system's ascent and descent, and the engine's shares
  // of the font put it at 13.55.
  const LINE =
    '.h { display: block; width: 200px; font-size: 10px; line-height: 20px }' +
    ' .i { display: inline-block } .f { display: inline-flex }' +
    ' .s { display: inline-block; width: 4px; height: 5px }' +
    ' .roomy { line-height: 30px } .padded { padding: 3px 0 5px }' +
    ' .least { min-height: 30px } .most { max-height: 12px }';
  const near = (actual: number | undefined, expected: number, what: string) =>
    assert.ok(Math.abs(actual! - expected) < 0.5, `${what} at ${actual}, not ${expected}`);

  it('is the line height over an empty inline-block, which sits on the baseline', () => {
    const s = scene(LINE, ['h', ['i']]);
    assert.deepEqual(s.box('h'), [0, 0, 200, 20]);
    near(s.box('i')[1], 14, 'the box');
  });

  it('is the same over an inline-flex box, and over a box shorter than the line', () => {
    const flex = scene(LINE, ['h', ['f']]);
    assert.deepEqual(flex.box('h'), [0, 0, 200, 20]);
    near(flex.box('f')[1], 14, 'the box');
    const short = scene(LINE, ['h', ['s']]);
    assert.deepEqual(short.box('h'), [0, 0, 200, 20]);
    near(short.box('s')[1], 9, 'the box');
  });

  it('is inside the padding, and under a min-height or a max-height', () => {
    const padded = scene(LINE, ['h padded', ['i']]);
    assert.deepEqual(padded.box('h padded'), [0, 0, 200, 28]);
    near(padded.box('i')[1], 17, 'the box');
    assert.deepEqual(scene(LINE, ['h least', ['i']]).box('h least'), [0, 0, 200, 30]);
    assert.deepEqual(scene(LINE, ['h most', ['i']]).box('h most'), [0, 0, 200, 12]);
  });

  it('follows the line height changing, and goes with the box that made the line', () => {
    const s = scene(LINE, ['h', ['i']]);
    assert.equal(s.box('h')[3], 20);
    s.engine.setClasses(s.nodes.get('h')!, 'h roomy');
    assert.equal(s.box('h')[3], 30);
    s.engine.removeChild(s.nodes.get('h')!, s.nodes.get('i')!);
    assert.equal(s.box('h')[3], 0);
  });

  it('is the line as the system text size draws it', () => {
    const s = scene(LINE, ['h', ['i']], 2);
    assert.deepEqual(s.box('h'), [0, 0, 200, 40]);
  });

  it('is the same in a content box, whose least height is inside the room under the baseline', () => {
    const s = scene(`${LINE} .c { box-sizing: content-box }`, ['h c', ['i']]);
    near(s.box('h c')[3], 20, 'the line');
    near(s.box('i')[1], 14, 'the box');
  });

  // Chrome's numbers, where the engine had the room under the baseline as padding: a share of
  // the line's height was of a box that much shorter, and a box beside text sat on the bottom.
  it('is the height a share of a height on the line is of, the box on the baseline', () => {
    const s = scene(`${LINE} .half { display: inline-block; height: 50% }`, ['h', ['half']]);
    assert.deepEqual(s.box('h'), [0, 0, 200, 20]);
    near(s.box('half')[1], 4, 'the box');
    near(s.box('half')[3], 10, 'its height');
  });

  it('has a box beside text on the baseline of the text, over its padding', () => {
    const css = `${LINE} .x { display: inline-block } .pad { padding-bottom: 10px }`;
    const text = scene(css, ['h', ['x'], ['i']]);
    text.engine.appendChild(text.nodes.get('x')!, text.engine.createText('x'));
    near(text.box('i')[1], 14, 'the empty box');
    const padded = scene(css, ['h', ['x pad'], ['s']]);
    padded.engine.appendChild(padded.nodes.get('x pad')!, padded.engine.createText('x'));
    near(padded.box('s')[1], 9, 'the small box');
    near(padded.box('h')[3], 30, 'the line');
  });

  it('follows a box on the line changing the room under its baseline, and its text going', () => {
    const css = `${LINE} .x { display: inline-block } .pad { padding-bottom: 10px }`;
    const s = scene(css, ['h', ['x'], ['s']]);
    const x = s.nodes.get('x')!;
    const text = s.engine.createText('x');
    s.engine.appendChild(x, text);
    near(s.box('s')[1], 9, 'the small box');
    s.engine.setClasses(x, 'x pad');
    near(s.box('s')[1], 9, 'the small box over the padding');
    near(s.box('h')[3], 30, 'the line');
    // Empty, the box's baseline is its bottom edge, over the room under the line's.
    s.engine.removeChild(x, text);
    near(s.box('x')[1], 3.55, 'the empty box');
    near(s.box('h')[3], 20, 'the line');
  });

  it('is over a box in a block with a height of its own, which no strut makes taller', () => {
    // Chrome: the empty box on the baseline 14 down, the small one 5 over it.
    const css = `${LINE} .fixed { height: 100px }`;
    const s = scene(css, ['h fixed', ['i'], ['s']]);
    near(s.box('i')[1], 14, 'the empty box');
    near(s.box('s')[1], 9, 'the small box');
  });

  it('lets a box taller than the room over the baseline reach down, from the top of the line', () => {
    // Chrome: a share of the line's height, at the top of the line it overflows.
    const css = `${LINE} .q { display: inline-block; height: 75% } .full { height: 100% }`;
    const s = scene(css, ['h', ['q']]);
    near(s.box('q')[1], 0, 'three quarters');
    near(s.box('q')[3], 15, 'its height');
    const full = scene(css, ['h', ['q full']]);
    near(full.box('q full')[1], 0, 'the whole');
    near(full.box('q full')[3], 20, 'its height');
    near(full.box('h')[3], 20, 'the line');
  });

  it('has a box beside text in a box with a height of its own on the baseline of that text', () => {
    // Chrome: the word's line is at the top of the tall box, and so is the baseline.
    const css = `${LINE} .x { display: inline-block; height: 100px }`;
    const s = scene(css, ['h', ['x'], ['i']]);
    s.engine.appendChild(s.nodes.get('x')!, s.engine.createText('x'));
    near(s.box('i')[1], 14, 'the empty box');
  });

  it('reaches as high as the strut with a share of the height of a block with its own', () => {
    // Chrome: a quarter of 50 on the baseline, 1.5 down, from a baseline it rounds to 14.
    const css = `${LINE} .fixed { height: 50px } .quarter { display: inline-block; height: 25% }`;
    near(scene(css, ['h fixed', ['quarter']]).box('quarter')[1], 1.05, 'the box');
  });

  it('has an empty inline-flex box on the baseline by its border, its margin under it', () => {
    // Chrome: a flex box with nothing in it has its baseline at the bottom of its border box.
    const css = `${LINE} .fm { display: inline-flex; margin: 2px }`;
    near(scene(css, ['h', ['fm']]).box('fm')[1], 14, 'the box');
  });

  it('is the room under the text of a clipped flex box on the line, which is not an inline-block', () => {
    // Material's list item title and select value: text that clips for its ellipsis, on a line
    // of a 16px font. Chrome has the line as tall as the title's own 24, where an inline-block
    // that clips sits on the baseline by its bottom edge and the line is 28.
    const css =
      '.p { display: block; width: 200px; font-size: 16px } .t { overflow: hidden; line-height: 24px }' +
      ' .flex { display: inline-flex } .block { display: inline-block } .e { display: inline-block }';
    const flex = scene(css, ['p', ['t flex'], ['e']]);
    flex.engine.appendChild(flex.nodes.get('t flex')!, flex.engine.createText('Paprika'));
    assert.equal(flex.box('p')[3], 24);
    near(flex.box('e')[1], 17.68, 'the empty box on the baseline of the text');
    const block = scene(css, ['p', ['t block'], ['e']]);
    block.engine.appendChild(block.nodes.get('t block')!, block.engine.createText('Paprika'));
    near(block.box('p')[3], 27.84, 'a line of a clipped inline-block');
  });

  it('is no room under a line of no line height written as a number', () => {
    // Material's icon suffix in a form field, line-height 0: Chrome has the icon's line 24,
    // the icon's own height, and a number is inherited as the number, not the points.
    const css =
      '.p { display: block; width: 200px; font-size: 16px; line-height: 0 }' +
      ' .icon { display: inline-block; overflow: hidden; width: 24px; height: 24px; padding: 0 12px; box-sizing: content-box }';
    assert.equal(scene(css, ['p', ['icon']]).box('p')[3], 24);
  });

  it('has nothing under a box aligned to the bottom of its line', () => {
    // A checkbox at the end of a list item, vertical-align bottom: Chrome has the line as
    // tall as the box, which is on its bottom and not on the baseline.
    const css = `${LINE} .low { display: inline-block; width: 4px; height: 40px; vertical-align: bottom }`;
    const s = scene(css, ['h', ['low']]);
    assert.deepEqual([s.box('h')[3], s.box('low')[1]], [40, 0]);
  });

  it('keeps a margin under a box that is a share of the width', () => {
    // Chrome has the line 106 tall, the margin's 100 and the room under the baseline. Yoga has
    // no sum of the two, and the margin is kept without the room.
    const s = scene(`${LINE} .m { display: inline-block; margin-bottom: 50% }`, ['h', ['m']]);
    assert.equal(s.box('m')[1], 0);
    assert.ok(s.box('h')[3]! >= 100, `a line of ${s.box('h')[3]}`);
  });

  it('places a box out of the flow after it under the line, and not over the room under it', () => {
    // Strict, as the canary lays out: Yoga's errata place it against the padding box.
    const s = scene(`${LINE} .abs { position: absolute }`, ['h', ['i'], ['abs']], 1, 'strict');
    near(s.box('abs')[1], 20, 'the out-of-flow box');
  });

  it('is a line of its own in a box of lines on a line, both on the one baseline', () => {
    const css = `${LINE} .n { display: inline-block } .t { display: inline-block; width: 5px; height: 30px }`;
    const s = scene(css, ['h', ['n', ['s']], ['t']]);
    near(s.box('h')[3], 36, 'the line');
    near(s.box('n')[1], 16, 'the box of lines');
    near(s.box('n')[3], 20, 'its height');
    near(s.box('s')[1], 25, 'the box in it');
  });

  it('stays at the top of a box a row stretches taller than it', () => {
    // Chrome has the box 14 down, on the line's baseline, and not on the bottom of the box.
    const row = scene(`${LINE} .r { flex-direction: row; height: 50px }`, ['r', ['h', ['i']]]);
    assert.deepEqual(row.box('h'), [0, 0, 200, 50]);
    assert.ok(row.box('i')[1]! <= 14, `the box at ${row.box('i')[1]}`);
  });
});

describe('the strut of a line among blocks', () => {
  // The same strut, for a line between blocks: Chrome's numbers, from a font with the system's
  // ascent and descent, a 10px font on a 20px line. One box alone is a line as much as a run is.
  const AMONG =
    '.h { display: block; width: 200px; font-size: 10px; line-height: 20px } .b { height: 10px }' +
    ' .i { display: inline-block } .f { display: inline-flex }' +
    ' .s { display: inline-block; width: 4px; height: 5px }' +
    ' .t { display: inline-block; width: 30px; height: 30px } .roomy { line-height: 30px }';
  const near = (actual: number | undefined, expected: number, what: string) =>
    assert.ok(Math.abs(actual! - expected) < 0.5, `${what} at ${actual}, not ${expected}`);

  it('holds one empty box alone on its line, after an empty block, a line tall', () => {
    const s = scene(`${AMONG} .e { display: block }`, ['h', ['e'], ['i'], ['e two']]);
    assert.deepEqual(s.box('h'), [0, 0, 200, 20]);
    near(s.box('i')[1], 14, 'the box');
    near(s.box('e two')[1], 20, 'the block after');
  });

  it('holds a run of boxes a line tall, an inline-flex box among them, on the baseline', () => {
    const s = scene(AMONG, ['h', ['b'], ['s'], ['f'], ['b two']]);
    near(s.box('s')[1], 19, 'the short box');
    near(s.box('f')[1], 24, 'the inline-flex box');
    near(s.box('b two')[1], 30, 'the block after');
  });

  it('keeps the room under the baseline under a box taller than the line', () => {
    const s = scene(AMONG, ['h', ['b'], ['t'], ['b two']]);
    assert.equal(s.box('t')[1], 10);
    near(s.box('b two')[1], 46, 'the block after');
  });

  it("is the text's own where a box on the line has text", () => {
    const s = scene(AMONG, ['h', ['b'], ['i'], ['b two']]);
    s.engine.appendChild(s.nodes.get('i')!, s.engine.createText('x'));
    assert.deepEqual(s.box('i'), [0, 10, 10, 20]);
    assert.deepEqual(s.box('b two'), [0, 30, 200, 10]);
  });

  it('has a share of a height be of the block, held at its content, and not of the line', () => {
    // Chrome: the block is 120 tall with the box's height set aside, the box half of that, and
    // the line it is on as tall as the box and the room under it, which the block after is under.
    const css = `${AMONG} .half { display: inline-block; height: 50% } .full { display: inline-block; height: 100% } .c { height: 100px } .e { display: block }`;
    const s = scene(css, ['h', ['half'], ['c']]);
    assert.deepEqual([s.box('half')[1], s.box('half')[3]], [0, 60]);
    near(s.box('c')[1], 66, 'the block after');
    const full = scene(css, ['h', ['full'], ['e']]);
    assert.deepEqual([full.box('full')[1], full.box('full')[3]], [0, 20]);
    near(full.box('e')[1], 26, 'the block after');
  });

  it('has a box beside text on the baseline of the text', () => {
    const s = scene(AMONG, ['h', ['b'], ['i'], ['s'], ['b two']]);
    s.engine.appendChild(s.nodes.get('i')!, s.engine.createText('x'));
    near(s.box('s')[1], 19, 'the small box');
    assert.deepEqual(s.box('b two'), [0, 30, 200, 10]);
  });

  it('follows the line height changing, and goes with the box that made the line', () => {
    const s = scene(AMONG, ['h', ['b'], ['s'], ['b two']]);
    near(s.box('b two')[1], 30, 'the block after');
    s.engine.setClasses(s.nodes.get('h')!, 'h roomy');
    near(s.box('s')[1], 24, 'the box');
    near(s.box('b two')[1], 40, 'the block after');
    s.engine.removeChild(s.nodes.get('h')!, s.nodes.get('s')!);
    assert.deepEqual(s.box('b two'), [0, 10, 200, 10]);
  });

  it('is the line as the system text size draws it', () => {
    const s = scene(AMONG, ['h', ['b'], ['i'], ['b two']], 2);
    near(s.box('b two')[1], 50, 'the block after');
  });
});

describe('a relatively positioned box in a line', () => {
  // Yoga drops the offset across the lines of a row that wraps: `top` and `bottom` in the rows
  // the engine lays lines out as. A floating label is `position: relative; top: 28px` in one.
  const LINE =
    '.p { display: block; width: 200px; height: 56px } .i { display: inline-block; width: 40px; height: 18px; position: relative }';
  const props = (s: ReturnType<typeof scene>, name: string) => {
    s.engine.commit();
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === name ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    const { top, bottom, left, transform } = find(s.fabric.committed)!.props;
    return {
      top: top ?? null,
      bottom: bottom ?? null,
      left: left ?? null,
      transform: transform ?? null,
    };
  };

  it('is moved down by its top, as a move of the box where Yoga laid it out', () => {
    const s = scene(`${LINE} .i { top: 28px; left: 4px }`, ['p', ['i']]);
    assert.deepEqual(props(s, 'i'), {
      top: null,
      bottom: null,
      left: 4,
      transform: [{ translateY: 28 }],
    });
  });

  it('is moved up by its bottom, before a transform of its own', () => {
    const s = scene(`${LINE} .i { bottom: 6px; transform: scale(2) }`, ['p', ['i']]);
    assert.deepEqual(props(s, 'i').transform, [{ translateY: -6 }, { scaleX: 2 }, { scaleY: 2 }]);
  });

  it('keeps its offset as written in a column, which Yoga places itself', () => {
    const s = scene('.p { width: 200px } .i { position: relative; top: 28px; height: 18px }', [
      'p',
      ['i'],
    ]);
    assert.deepEqual(props(s, 'i'), { top: 28, bottom: null, left: null, transform: null });
  });

  it('follows the offset changing and going', () => {
    const s = scene(`${LINE} .down { top: 28px } .down.low { top: 30px }`, ['p', ['i']]);
    const item = s.nodes.get('i')!;
    s.engine.addClass(item, 'down');
    assert.deepEqual(props(s, 'i').transform, [{ translateY: 28 }]);
    s.engine.addClass(item, 'low');
    assert.deepEqual(props(s, 'i').transform, [{ translateY: 30 }]);
    s.engine.removeClass(item, 'down');
    assert.deepEqual(props(s, 'i'), { top: null, bottom: null, left: null, transform: null });
  });

  // A transition that arrives with no change eases nothing: what was committed, with the move
  // in it, is not where the box was before. Material turns a label's transitions on once drawn.
});

describe('a run of inline-level boxes among blocks', () => {
  it('shares a line, between the blocks before and after it', () => {
    const s = scene(BASE, ['p', ['b'], ['i'], ['i two'], ['b two']]);
    assert.deepEqual(s.box('i'), [0, 10, 50, 20]);
    assert.deepEqual(s.box('i two'), [50, 10, 50, 20]);
    nearly(s.box('b two'), [0, 33, 200, 10]);
  });

  it('wraps to a second line when the first is full, under the room the first keeps', () => {
    const s = scene(BASE, ['p', ['b'], ['i wide'], ['i wide two'], ['i wide three'], ['b two']]);
    assert.deepEqual(s.box('i wide two'), [80, 10, 80, 20]);
    nearly(s.box('i wide three'), [0, 33, 80, 20]);
    nearly(s.box('b two'), [0, 56, 200, 10], 2);
  });

  it('sits its boxes on the bottom of the line, as empty boxes sit on a baseline', () => {
    const s = scene(`${BASE} .tall { height: 40px }`, ['p', ['b'], ['i'], ['i tall']]);
    assert.deepEqual(s.box('i'), [0, 30, 50, 20]);
    assert.deepEqual(s.box('i tall'), [50, 10, 50, 40]);
  });

  it('sits a box on the middle or the top of its line where vertical-align says so', () => {
    // An arrow after a label's words, `vertical-align: middle`: on the bottom of the line it
    // hangs under them.
    const css = `${BASE} .tall { height: 40px } .mid { vertical-align: middle } .top { vertical-align: top }`;
    const alone = scene(css, ['p', ['i tall'], ['i mid'], ['i top'], ['i']]);
    // The middle of the line, the room under its baseline included. Chrome has the middle of
    // the box half an x-height over the baseline, 24 down.
    assert.deepEqual(
      ['i mid', 'i top', 'i'].map((name) => Math.round(alone.box(name)[1]!)),
      [12, 0, 20],
    );
    // And in a line among blocks.
    const among = scene(css, ['p', ['b'], ['i tall'], ['i mid']]);
    assert.equal(Math.round(among.box('i mid')[1]!), 22);
  });

  it('keeps each box its own margins, under the margin the blocks before the line collapse to', () => {
    const css = `${BASE} .b { margin-bottom: 20px } .i { margin-top: 5px; margin-left: 4px }`;
    const s = scene(css, ['p', ['b'], ['i'], ['i two']]);
    assert.deepEqual(s.box('i'), [4, 35, 50, 20]);
    assert.deepEqual(s.box('i two'), [58, 35, 50, 20]);
  });

  it('is a line of one in a line box of its own, which keeps the line as tall as a run does', () => {
    const s = scene(BASE, ['p', ['b'], ['i'], ['b two']]);
    assert.deepEqual(s.box('i'), [0, 10, 50, 20]);
    nearly(s.box('b two'), [0, 33, 200, 10]);
    assert.equal(s.count('p'), 3);
    const line = s.fabric.committed[0]!.children[1]!;
    assert.equal(line.props['nativeID'], undefined);
    assert.equal(line.children[0]!.props['nativeID'], 'i');
  });

  it('takes a box added beside one that was alone, and lets it go again', () => {
    const s = scene(BASE, ['p', ['b'], ['i'], ['b two']]);
    nearly(s.box('b two'), [0, 33, 200, 10]);
    s.build(['i two'], s.nodes.get('p')!, s.nodes.get('b two'));
    assert.deepEqual(s.box('i two'), [50, 10, 50, 20]);
    nearly(s.box('b two'), [0, 33, 200, 10]);
    assert.equal(s.count('p'), 3);
    s.engine.removeChild(s.nodes.get('p')!, s.nodes.get('i')!);
    assert.deepEqual(s.box('i two'), [0, 10, 50, 20]);
    assert.equal(s.count('p'), 3);
  });

  it('is two lines once a block comes between its boxes', () => {
    const s = scene(BASE, ['p', ['i'], ['i two'], ['b']]);
    assert.deepEqual(s.box('i two'), [50, 0, 50, 20]);
    s.build(['b mid'], s.nodes.get('p')!, s.nodes.get('i two'));
    nearly(s.box('b mid'), [0, 23, 200, 10]);
    nearly(s.box('i two'), [0, 33, 50, 20]);
  });

  it('follows a box that stops being inline-level, which ends the line before it', () => {
    const s = scene(`${BASE} .block { display: block }`, ['p', ['b'], ['i'], ['i two']]);
    assert.deepEqual(s.box('i two'), [50, 10, 50, 20]);
    s.engine.setClasses(s.nodes.get('i two')!, 'i two block');
    nearly(s.box('i two'), [0, 33, 50, 20]);
  });

  it('is made again with its container, when the container moves to another parent', () => {
    // Native never moves a view to another parent, and aborts the app on it: the line box of a
    // container that is made again is made again too, and not the old one handed its new boxes.
    const s = scene(`${BASE} .q { display: block; width: 200px }`, [
      'top',
      ['p', ['b'], ['i'], ['i two']],
      ['q'],
    ]);
    assert.deepEqual(s.box('i two'), [50, 10, 50, 20]);
    const p = s.nodes.get('p')!;
    s.engine.removeChild(s.nodes.get('top')!, p);
    s.engine.appendChild(s.nodes.get('q')!, p);
    assert.deepEqual(s.box('i two'), [50, 10, 50, 20]);
    // And back, with a commit between: the same again.
    s.engine.removeChild(s.nodes.get('q')!, p);
    s.engine.appendChild(s.nodes.get('top')!, p);
    assert.deepEqual(s.box('i'), [0, 10, 50, 20]);
  });

  it('keeps its other boxes where one of them is made again as another kind of view', () => {
    // A box that comes to hold text is another native view. Made again, it goes back into the
    // line box the others are still in: a new line box would be handed views that have a parent.
    const s = scene(BASE, ['p', ['b'], ['i'], ['i two'], ['i three']]);
    assert.deepEqual(s.box('i three'), [100, 10, 50, 20]);
    for (const name of ['i', 'i two']) {
      const node = s.nodes.get(name)!;
      const text = s.engine.createText('x');
      s.engine.appendChild(node, text);
      assert.deepEqual(s.box('i three'), [100, 10, 50, 20]);
      s.engine.removeChild(node, text);
      assert.deepEqual(s.box('i three'), [100, 10, 50, 20]);
    }
  });

  it('keeps a box in the line as wide as its content, a percentage inside it of that', () => {
    const css = `${BASE} .f { display: inline-flex; flex-direction: column } .full { width: 100%; height: 5px } .w { width: 70px; height: 20px }`;
    const s = scene(css, ['p', ['b'], ['f', ['full'], ['w']], ['i']]);
    assert.deepEqual(s.box('f'), [0, 10, 70, 25]);
    assert.deepEqual(s.box('i'), [70, 15, 50, 20]);
  });
});

describe('a box in a line set under the baseline, by a length for vertical-align', () => {
  // A list's two-line item: one empty box as tall as the room over the baseline, one hung under
  // it for the room beneath. A browser's line is both, and the next line starts after them.
  const CSS =
    '.t { display: block; width: 200px } .i { display: inline-block; width: 10px }' +
    ' .up { height: 28px; vertical-align: 0 } .down { height: 20px; vertical-align: -20px }' +
    ' .half { height: 20px; vertical-align: -5px }';

  it('is as tall as the room over the baseline and the room under it', () => {
    const s = scene(CSS, ['t', ['i up'], ['i down']]);
    assert.deepEqual(s.box('t'), [0, 0, 200, 48]);
    assert.deepEqual(s.box('i up'), [0, 0, 10, 28]);
    assert.deepEqual(s.box('i down'), [10, 28, 10, 20]);
  });

  it('keeps a box that reaches over the baseline as far over it as it reaches', () => {
    const s = scene(CSS, ['t', ['i up'], ['i half']]);
    assert.deepEqual(s.box('t'), [0, 0, 200, 33]);
    assert.deepEqual(s.box('i half'), [10, 13, 10, 20]);
  });

  it('is the height of its boxes again once nothing hangs under the baseline', () => {
    const s = scene(CSS, ['t', ['i up'], ['i down']]);
    s.box('t');
    s.engine.setClasses(s.nodes.get('i down')!, 'i up');
    // The strut's own room under the baseline is back: the descent of a 14px font.
    assert.ok(Math.abs(s.box('t')[3]! - 31.36) < 0.5, `a line of ${s.box('t')[3]}`);
    assert.deepEqual(s.box('i up'), [0, 0, 10, 28]);
  });
});

describe('text-align over a line of inline-level boxes', () => {
  // A calendar's heading, a toolbar's buttons: boxes in a line sit where the line's words would.
  const CSS =
    BASE +
    ' .c { display: block; width: 200px; text-align: center }' +
    ' .r { display: block; width: 200px; text-align: right }' +
    ' .q { display: block } .i2 { display: inline-block; width: 50px; height: 20px }';
  const left = (s: ReturnType<typeof scene>, name: string) => s.fabric.box(name).left;

  it('centres a line that is all its container holds', () => {
    const s = scene(CSS, ['c', ['i'], ['i2']]);
    s.engine.commit();
    assert.deepEqual([left(s, 'i'), left(s, 'i2')], [50, 100]);
  });

  it('sets a line among blocks at the end, where that is what the container says', () => {
    const s = scene(CSS, ['r', ['b'], ['i'], ['i2']]);
    s.engine.commit();
    assert.deepEqual([left(s, 'i'), left(s, 'i2')], [100, 150]);
  });

  it('takes it from a box above the one the line is in, and follows it as it changes', () => {
    const s = scene(CSS, ['c', ['q', ['i']]]);
    s.engine.commit();
    assert.equal(left(s, 'i'), 75);
    s.engine.setClasses(s.nodes.get('c')!, 'r');
    s.engine.commit();
    assert.equal(left(s, 'i'), 150);
    s.engine.setClasses(s.nodes.get('c')!, 'p');
    s.engine.commit();
    assert.equal(left(s, 'i'), 0);
  });

  it('follows it for a line among blocks too', () => {
    const s = scene(CSS, ['c', ['b'], ['i']]);
    s.engine.commit();
    assert.equal(left(s, 'i'), 75);
    s.engine.setClasses(s.nodes.get('c')!, 'p');
    s.engine.commit();
    assert.equal(left(s, 'i'), 0);
  });
});
