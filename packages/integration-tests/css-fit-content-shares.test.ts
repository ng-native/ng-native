/**
 * What a box written as wide as its content is held to, and what a share in it is of: a
 * percentage under a `max-content` cap, an out-of-flow box between two insets, and a percentage
 * basis in a box that is as wide as what it holds.
 *
 * The expected widths are Chrome's, for the same markup in a 362 pixel box under the layout reset.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** At ten points a character: 70 wide, 520 wide, and six words that wrap. */
const SHORT = 'abcdefg';
const WIDE = 'x'.repeat(52);
const WORDS = Array(6).fill('abcdefg').join(' ');
const CONFORMANCES = ['classic', 'strict'] as const;

const SCREEN_CONDITIONS = { width: 400, height: 800, colorScheme: 'light' as const };

type Conformance = (typeof CONFORMANCES)[number];

function scene(css: string, text: string, conformance: Conformance = 'classic') {
  const fabric = createLaidOutFabric(conformance);
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as never,
    conditions: SCREEN_CONDITIONS,
    ...(conformance === 'strict' ? { layoutConformance: 'strict' as const } : {}),
  });
  const element = (id: string, parent: EngineNode) => {
    const node = engine.createElement('view');
    engine.setClasses(node, id);
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const col = element('col', engine.root);
  const row = element('row', col);
  const item = element('item', row);
  const words = engine.createElement('text');
  engine.appendChild(words, engine.createText(text));
  engine.appendChild(item, words);
  /** Where a box is in `col`, and how wide it is. */
  const box = (id: string): [number, number] => {
    engine.commit();
    const at = fabric.box(id);
    // To the half point: Yoga rounds to the pixels of a screen, where Chrome has 90.5.
    const near = (value: number) => Math.round(value * 2) / 2;
    return [near(at.left - fabric.box('col').left), near(at.width)];
  };
  return { engine, fabric, col, row, item, box };
}

const css = (col: string, row: string, item: string) =>
  `.col { width: 362px; height: 300px; ${col} } .row { ${row} } .item { ${item} }`;

describe('a percentage width capped at max-content', () => {
  const ROW = 'flex-direction: row; width: 50%; max-width: max-content';
  const COLUMN = 'width: 50%; max-width: max-content';
  const ROOMS = [
    ['a column', '', 0, 0],
    ['a column that centres it', 'align-items: center', 146, 90.5],
    ['a block', 'display: block', 0, 0],
    ['a row', 'flex-direction: row', 0, 0],
  ] as const;

  for (const [where, room, shortAt, wideAt] of ROOMS) {
    it(`is the smaller of the two, in ${where}`, () => {
      const cases = [
        ['flex: 1 1 0px', SHORT, 70, 70, shortAt],
        ['flex: 1 1 0px', WIDE, 181, 181, wideAt],
        ['flex: none', SHORT, 70, 70, shortAt],
        ['flex: none', WIDE, 181, 520, wideAt],
        ['width: 50%', SHORT, 70, 35, shortAt],
        ['width: 50%', WIDE, 181, 90.5, wideAt],
        ['flex: 0 0 50%', SHORT, 70, 35, shortAt],
        ['flex: 0 0 50%', WIDE, 181, 90.5, wideAt],
      ] as const;
      for (const conformance of CONFORMANCES) {
        for (const [item, text, row, inner, at] of cases) {
          const s = scene(css(room, ROW, item), text, conformance);
          const named = `${item}, ${text.length} long (${conformance})`;
          assert.deepEqual(s.box('row'), [at, row], named);
          assert.deepEqual(s.box('item'), [at, inner], named);
        }
      }
    });
  }

  it('holds a column of its own the same way', () => {
    for (const [text, width] of [
      [SHORT, 70],
      [WIDE, 181],
    ] as const) {
      const s = scene(css('', COLUMN, 'flex: none'), text);
      assert.equal(s.box('row')[1], width);
      assert.equal(s.box('item')[1], width);
    }
  });

  it('counts for its content in a box as wide as what it holds', () => {
    const capped = 'width: 50%; max-width: max-content';
    for (const conformance of CONFORMANCES) {
      for (const row of ['width: fit-content', 'align-self: flex-start']) {
        const s = scene(css('', `flex-direction: row; ${row}`, capped), SHORT, conformance);
        assert.equal(s.box('row')[1], 70, `${row} (${conformance})`);
        assert.equal(s.box('item')[1], 35, `${row} (${conformance})`);
      }
    }
  });

  it('follows the box it is a share of', () => {
    const s = scene(css('', ROW, 'flex: 1 1 0px'), WIDE);
    assert.equal(s.box('row')[1], 181);
    s.engine.setProp(s.col, 'style', { width: 200 });
    assert.equal(s.box('row')[1], 100);
    s.engine.setProp(s.col, 'style', null);
    assert.equal(s.box('row')[1], 181);
  });

  it('follows the cap going away and coming back', () => {
    const s = scene(
      `${css('', 'flex-direction: row; width: 50%', '')} .cap { max-width: max-content }`,
      SHORT,
    );
    assert.equal(s.box('row')[1], 181);
    s.engine.setClasses(s.row, 'row cap');
    assert.equal(s.box('row')[1], 70);
    s.engine.setClasses(s.row, 'row');
    assert.equal(s.box('row')[1], 181);
  });

  it('reads the same from a value set on the element', () => {
    const s = scene(css('', 'flex-direction: row', 'flex: 1 1 0px'), WIDE);
    s.engine.setProp(s.row, 'style', { width: '50%', maxWidth: 'max-content' });
    assert.equal(s.box('row')[1], 181);
    assert.equal(s.box('item')[1], 181);
  });

  it('caps a height the same way', () => {
    const s = scene(
      `.col { width: 362px; height: 300px; flex-direction: row } .row { height: 50%; max-height: max-content }` +
        ` .tall { height: 400px } .item { }`,
      SHORT,
    );
    const height = () => {
      s.engine.commit();
      return s.fabric.box('row').height;
    };
    assert.equal(height(), 20);
    s.engine.setClasses(s.item, 'item tall');
    assert.equal(height(), 150);
  });
});

describe('a box as wide as its content between two insets', () => {
  const ROW = 'flex-direction: row; position: absolute';
  const KINDS = [
    ['width: fit-content', 'width: fit-content'],
    ['a cap', 'max-width: max-content'],
  ] as const;

  for (const [kind, fits] of KINDS) {
    it(`is as wide as what it holds, by ${kind}`, () => {
      const rows = [
        ['flex: 1 1 0px', 70],
        ['', 70],
        ['flex: 0 0 50%', 35],
        ['width: 50%', 35],
      ] as const;
      for (const conformance of CONFORMANCES) {
        for (const [item, width] of rows) {
          const s = scene(css('', `${ROW}; ${fits}; left: 0; right: 0`, item), SHORT, conformance);
          assert.deepEqual(s.box('row'), [0, 70], `${item || 'nothing'} (${conformance})`);
          assert.deepEqual(s.box('item'), [0, width], `${item || 'nothing'} (${conformance})`);
        }
      }
    });
  }

  it('keeps to the smaller of a percentage and its content there', () => {
    const fits = `${ROW}; width: 50%; max-width: max-content; left: 0; right: 0`;
    assert.deepEqual(scene(css('', fits, ''), SHORT).box('row'), [0, 70]);
    assert.deepEqual(scene(css('', fits, 'flex: 1 1 0px'), WIDE).box('row'), [0, 181]);
  });

  it('holds a column of its own the same way', () => {
    const s = scene(
      css('', 'position: absolute; width: fit-content; left: 0; right: 0', ''),
      SHORT,
    );
    assert.deepEqual(s.box('row'), [0, 70]);
  });

  it('wraps at what the insets leave it', () => {
    const inset = `${ROW}; width: fit-content; left: 10px; right: 60px`;
    assert.deepEqual(scene(css('', inset, 'flex: 1 1 0px'), SHORT).box('row'), [10, 70]);
    assert.deepEqual(scene(css('', inset, 'flex: 1 1 0px'), WORDS).box('row'), [10, 292]);
    const margin = `${ROW}; width: fit-content; left: 10px; right: 20px; margin: 0 20px`;
    assert.deepEqual(scene(css('', margin, ''), WORDS).box('row'), [30, 292]);
  });

  it('takes a percentage inset of the box it is placed in', () => {
    const pct = `${ROW}; width: fit-content; left: 10%; right: 40%`;
    const s = scene(css('', pct, ''), WORDS);
    assert.equal(s.box('row')[1], 181);
  });

  it('is at the start of the room, and centred by auto margins', () => {
    const at = (extra: string) =>
      scene(css('', `${ROW}; width: fit-content; ${extra}`, 'flex: 1'), SHORT).box('row');
    assert.deepEqual(at('left: 10px; right: 20px'), [10, 70]);
    assert.deepEqual(at('left: 0; right: 0; margin-left: auto; margin-right: auto'), [146, 70]);
    assert.deepEqual(at('left: 0; right: 0; margin-left: 5px'), [5, 70]);
  });

  it('reads the logical insets, and takes an inset of auto for none', () => {
    const logical = `${ROW}; width: fit-content; inset-inline-start: 5px; inset-inline-end: 7px`;
    assert.deepEqual(scene(css('', logical, 'flex: 1'), SHORT).box('row'), [5, 70]);
    const auto = `${ROW}; width: fit-content; left: auto; right: 0`;
    assert.deepEqual(scene(css('', auto, 'flex: 1'), SHORT).box('row'), [292, 70]);
    const set = scene(css('', ROW, 'flex: 1'), SHORT);
    set.engine.setProp(set.row, 'style', { width: 'fit-content', left: 'auto', right: 0 });
    assert.deepEqual(set.box('row'), [292, 70]);
  });

  it('counts its own padding', () => {
    const padded = `${ROW}; width: fit-content; left: 0; right: 0; padding: 0 6px`;
    assert.deepEqual(scene(css('', padded, ''), SHORT).box('row'), [0, 82]);
  });

  it('is held to the box it is placed in, past one that is not positioned', () => {
    const row = `${ROW}; width: fit-content; left: 0; right: 50px`;
    const s = scene(css('width: 500px; position: static', row, ''), WORDS);
    // The 400 of the screen less the inset, and not the 500 of the box it is written in.
    assert.equal(s.box('row')[1], 350);
    s.engine.updateConditions({ ...SCREEN_CONDITIONS, width: 300 });
    assert.equal(s.box('row')[1], 250);
  });

  it('is centred by auto margins however it is written as wide as its content', () => {
    const margins = 'left: 0; right: 0; margin-left: auto; margin-right: auto';
    for (const fits of ['max-width: max-content', 'width: 50%; max-width: max-content']) {
      const s = scene(css('', `${ROW}; ${fits}; ${margins}`, ''), SHORT);
      assert.deepEqual(s.box('row'), [146, 70], fits);
    }
    const wide = `${ROW}; width: 50%; max-width: max-content; ${margins}`;
    assert.deepEqual(scene(css('', wide, 'flex: 1 1 0px'), WIDE).box('row'), [90.5, 181]);
  });

  it('stretches once it is no longer as wide as its content, and fits again', () => {
    const s = scene(
      `${css('', `${ROW}; left: 0; right: 0`, 'flex: 1 1 0px')} .fit { width: fit-content }`,
      SHORT,
    );
    assert.equal(s.box('row')[1], 362);
    s.engine.setClasses(s.row, 'row fit');
    assert.equal(s.box('row')[1], 70);
    s.engine.setClasses(s.row, 'row');
    assert.equal(s.box('row')[1], 362);
    assert.equal(s.box('item')[1], 362);
  });

  it('fits again with an inset going away and coming back', () => {
    const s = scene(
      `${css('', `${ROW}; width: fit-content; left: 0`, '')} .both { right: 0 }`,
      SHORT,
    );
    assert.equal(s.box('row')[1], 70);
    s.engine.setClasses(s.row, 'row both');
    assert.equal(s.box('row')[1], 70);
    s.engine.setClasses(s.row, 'row');
    assert.equal(s.box('row')[1], 70);
  });

  it('follows the room changing, and what it holds', () => {
    const s = scene(css('', `${ROW}; width: fit-content; left: 0; right: 0`, ''), WORDS);
    assert.equal(s.box('row')[1], 310);
    s.engine.setProp(s.col, 'style', { width: 200 });
    assert.equal(s.box('row')[1], 150);
    s.engine.setProp(s.col, 'style', null);
    assert.equal(s.box('row')[1], 310);
    s.engine.setProp(s.item, 'style', { width: 40 });
    assert.equal(s.box('row')[1], 40);
  });

  it('reads the same from a value set on the element', () => {
    const s = scene(css('', 'flex-direction: row', 'flex: 1'), SHORT);
    s.engine.setProp(s.row, 'style', {
      position: 'absolute',
      width: 'fit-content',
      left: 0,
      right: 0,
    });
    assert.deepEqual(s.box('row'), [0, 70]);
  });

  it('takes an inset set on the element off the room', () => {
    const s = scene(css('', `${ROW}; width: fit-content; left: 0; right: 0`, ''), WORDS);
    s.engine.setProp(s.row, 'right', 100);
    assert.equal(s.box('row')[1], 262);
  });

  it('commits nothing more for a box that is not fitted', () => {
    const stretched = `${ROW}; left: 0; right: 0`;
    const moved = 'position: relative; width: fit-content; left: 10px; right: 20px';
    for (const row of [stretched, moved]) {
      const s = scene(css('', row, ''), SHORT);
      s.engine.commit();
      assert.equal(s.fabric.calls.completeRoot, 1, row);
    }
  });
});

describe('a box as wide as its content that holds more than the room', () => {
  /** `item` holds nothing and is 500 wide; `share`, after it, holds three letters. */
  function overflowing(row: string, share: string, conformance: Conformance = 'classic') {
    const s = scene(
      `${css('', row, 'width: 500px')} .share { ${share} } .free { flex: 1 }`,
      '',
      conformance,
    );
    s.engine.removeChild(s.item, s.item.childList[0]!);
    const node = s.engine.createElement('view');
    s.engine.setClasses(node, 'share');
    s.engine.setProp(node, 'nativeID', 'share');
    const words = s.engine.createElement('text');
    s.engine.appendChild(words, s.engine.createText('abc'));
    s.engine.appendChild(node, words);
    s.engine.appendChild(s.row, node);
    return { ...s, share: node };
  }
  const BETWEEN = 'position: absolute; left: 0; right: 0';

  it('reaches past the room, as wide as what it holds', () => {
    for (const conformance of CONFORMANCES) {
      for (const [row, share, width, shared] of [
        ['flex-direction: row; width: fit-content', 'flex: 1', 530, 30],
        ['flex-direction: row; width: fit-content', 'width: 50%', 530, 265],
        ['width: fit-content', 'width: 50%', 500, 250],
        ['flex-direction: row; width: fit-content; padding: 0 6px', 'flex: 1', 542, 30],
      ] as const) {
        const s = overflowing(row, share, conformance);
        const named = `${row}, ${share} (${conformance})`;
        assert.equal(s.box('row')[1], width, named);
        assert.equal(s.box('share')[1], shared, named);
      }
    }
  });

  it('is held to the room where it is capped at its content, which is no wider', () => {
    for (const row of ['max-width: max-content', `max-width: max-content; ${BETWEEN}`]) {
      const s = overflowing(`flex-direction: row; ${row}`, 'flex: 1');
      assert.equal(s.box('row')[1], 362, row);
    }
  });

  it('counts nothing in it that is out of the flow', () => {
    const s = overflowing('flex-direction: row; width: fit-content', 'flex: 1');
    s.engine.setProp(s.item, 'style', { position: 'absolute', left: 600, width: 50 });
    assert.equal(s.box('row')[1], 30);
  });

  /** A box in `parent`, styled `style`. */
  function inside(s: ReturnType<typeof overflowing>, parent: EngineNode, style: object) {
    const node = s.engine.createElement('view');
    s.engine.setProp(node, 'style', style);
    s.engine.appendChild(parent, node);
    return node;
  }

  it('counts a box in it where it is before a relative offset moves it', () => {
    // Chrome: 530 for each, as the offset moves the box and not what it contributes.
    for (const conformance of CONFORMANCES) {
      const s = overflowing('flex-direction: row; width: fit-content', 'flex: 1', conformance);
      s.engine.setProp(s.item, 'style', { left: 600 });
      assert.equal(s.box('row')[1], 530, `an item moved (${conformance})`);
      s.engine.setProp(s.item, 'style', { width: 'auto', left: 600 });
      inside(s, s.item, { width: 500, height: 10 });
      assert.equal(s.box('row')[1], 530, `a box in an item moved (${conformance})`);
      s.engine.setProp(s.item, 'style', { width: 'auto' });
      inside(s, s.item, { width: 400, height: 10, left: 300 });
      assert.equal(s.box('row')[1], 530, `a box moved in an item (${conformance})`);
    }
  });

  it('counts a box in it with a width of its own at that width, not what overflows it', () => {
    // Chrome: 530 in a row, 500 in a column, and 530 under an item as wide as its content.
    for (const conformance of CONFORMANCES) {
      const s = overflowing('flex-direction: row; width: fit-content', 'flex: 1', conformance);
      inside(s, s.item, { width: 900, height: 10 });
      assert.equal(s.box('row')[1], 530, `in a row (${conformance})`);
      s.engine.setProp(s.item, 'style', { width: 'auto' });
      const own = s.item.childList[0]!;
      s.engine.setProp(own, 'style', { width: 500, height: 10 });
      inside(s, own, { width: 900, height: 10 });
      assert.equal(s.box('row')[1], 530, `further down (${conformance})`);
      const column = overflowing('width: fit-content', 'width: 50%', conformance);
      inside(column, column.item, { width: 900, height: 10 });
      assert.equal(column.box('row')[1], 500, `in a column (${conformance})`);
    }
  });

  it('counts a box in it capped at a width no wider than that cap', () => {
    // Chrome: a box capped at 500 holding 900 counts 500, under a minimum of 600 counts that,
    // under a cap of 50% counts all of it, and holding 400 counts the 400.
    for (const conformance of CONFORMANCES) {
      const s = overflowing('flex-direction: row; width: fit-content', 'flex: 1', conformance);
      const named = (what: string) => `${what} (${conformance})`;
      s.engine.setProp(s.item, 'style', { width: 'auto', maxWidth: 500 });
      const held = inside(s, s.item, { width: 900, height: 10 });
      assert.equal(s.box('row')[1], 530, named('an item capped'));
      s.engine.setProp(s.item, 'style', { width: 'auto', maxWidth: 500, left: 100 });
      assert.equal(s.box('row')[1], 530, named('an item capped and moved'));
      s.engine.setProp(s.item, 'style', { width: 'auto', maxWidth: 500, minWidth: 600 });
      assert.equal(s.box('row')[1], 630, named('an item capped under a minimum'));
      s.engine.setProp(s.item, 'style', { width: 'auto', maxWidth: '50%' });
      assert.equal(s.box('row')[1], 930, named('an item capped at a share'));
      s.engine.setProp(s.item, 'style', { width: 'auto', maxWidth: 500 });
      s.engine.setProp(held, 'style', { width: 400, height: 10 });
      assert.equal(s.box('row')[1], 430, named('an item capped wider than it holds'));
      s.engine.setProp(s.item, 'style', { width: 'auto' });
      s.engine.setProp(held, 'style', { maxWidth: 500 });
      inside(s, held, { width: 900, height: 10 });
      assert.equal(s.box('row')[1], 530, named('a box capped further down'));
      const column = overflowing('width: fit-content', 'width: 50%', conformance);
      column.engine.setProp(column.item, 'style', { width: 'auto', maxWidth: 500 });
      inside(column, column.item, { width: 900, height: 10 });
      assert.equal(column.box('row')[1], 500, named('in a column'));
    }
  });

  it('follows a box it holds changing its box-sizing', () => {
    // Chrome: a cap of 500 on a box with 26 of padding and border is of its content for
    // content-box, so the box is 526 and the row 556, and of the whole box for border-box.
    for (const conformance of CONFORMANCES) {
      const s = overflowing('flex-direction: row; width: fit-content', 'flex: 1', conformance);
      const framed = { paddingLeft: 10, paddingRight: 10, borderLeftWidth: 3, borderRightWidth: 3 };
      const capped = { width: 'auto', maxWidth: 500, ...framed };
      s.engine.setProp(s.item, 'style', capped);
      inside(s, s.item, { width: 900, height: 10 });
      for (const [boxSizing, width] of [
        ['border-box', 530],
        ['content-box', 556],
        ['border-box', 530],
      ] as const) {
        s.engine.setProp(s.item, 'style', { ...capped, boxSizing });
        assert.equal(s.box('row')[1], width, `${boxSizing} (${conformance})`);
      }
    }
  });

  it('counts an item with a basis in points that does not grow at that basis', () => {
    // Chrome, for an item holding a 900 wide box: the basis, held to the item's minimum and
    // maximum, where the item does not grow; all it holds where it grows or the basis is a share.
    for (const conformance of CONFORMANCES) {
      for (const [style, width] of [
        [{ flexBasis: 0, flexShrink: 1, maxWidth: 500 }, 30],
        [{ flexBasis: 0, flexShrink: 1 }, 30],
        [{ flexBasis: 0 }, 30],
        [{ flexBasis: 100 }, 130],
        [{ flexBasis: 600 }, 630],
        [{ flexBasis: 0, minWidth: 200 }, 230],
        [{ flexBasis: 0, flexGrow: 1 }, 930],
        [{ flexBasis: 0, flexGrow: 1, maxWidth: 500 }, 530],
        [{ flexBasis: '50%' }, 930],
      ] as const) {
        const s = overflowing('flex-direction: row; width: fit-content', 'flex: 1', conformance);
        s.engine.setProp(s.item, 'style', { width: 'auto', ...style });
        inside(s, s.item, { width: 900, height: 10 });
        assert.equal(s.box('row')[1], width, `${JSON.stringify(style)} (${conformance})`);
      }
      // In a column the basis is a height, and all it holds counts.
      for (const flexBasis of [0, 100]) {
        const column = overflowing('width: fit-content', 'width: 50%', conformance);
        column.engine.setProp(column.item, 'style', { width: 'auto', flexBasis });
        inside(column, column.item, { width: 900, height: 10 });
        assert.equal(column.box('row')[1], 900, `a column, basis ${flexBasis} (${conformance})`);
      }
    }
  });

  it('follows what it holds growing past the room and back', () => {
    const s = overflowing('flex-direction: row; width: fit-content', 'flex: 1');
    assert.equal(s.box('row')[1], 530);
    s.engine.setProp(s.item, 'style', { width: 100 });
    assert.equal(s.box('row')[1], 130);
    s.engine.setProp(s.item, 'style', null);
    assert.equal(s.box('row')[1], 530);
  });
});

describe('a percentage basis in a box as wide as its content', () => {
  const ROOMS = [
    ['a column', ''],
    ['a block', 'display: block'],
    ['a row', 'flex-direction: row'],
  ] as const;
  const FITS = [
    ['fit-content', 'width: fit-content'],
    ['a cap at its content', 'max-width: max-content'],
  ] as const;
  const BASES = [
    ['flex: 0 0 50%', 35],
    ['flex-basis: 50%', 35],
    ['flex: 1 1 50%', 70],
    ['flex: 0 0 100%', 70],
    ['flex: 0 0 50%; min-width: 50px', 50],
  ] as const;

  for (const [where, room] of ROOMS) {
    for (const [kind, fits] of FITS) {
      it(`takes its share of the fitted row, by ${kind} in ${where}`, () => {
        for (const conformance of CONFORMANCES) {
          for (const [item, width] of BASES) {
            const s = scene(css(room, `flex-direction: row; ${fits}`, item), SHORT, conformance);
            assert.equal(s.box('row')[1], 70, `row with ${item} (${conformance})`);
            assert.equal(s.box('item')[1], width, `${item} (${conformance})`);
          }
        }
      });
    }
  }

  it('takes it of the row in a line too', () => {
    const inline = 'display: inline-flex; flex-direction: row';
    const s = scene(css('display: block', inline, 'flex: 0 0 50%'), SHORT);
    assert.equal(s.box('row')[1], 70);
    assert.equal(s.box('item')[1], 35);
  });

  it('is measured at its content, with a width of its own under the basis', () => {
    const s = scene(
      css('', 'flex-direction: row; width: fit-content', 'flex: 0 0 50%; width: 10px'),
      SHORT,
    );
    assert.equal(s.box('row')[1], 10);
    assert.equal(s.box('item')[1], 5);
  });

  it('follows the row growing, and the basis going away', () => {
    const s = scene(css('', 'flex-direction: row; width: fit-content', 'flex: 0 0 50%'), SHORT);
    assert.equal(s.box('item')[1], 35);
    s.engine.setProp(s.item, 'style', { flexBasis: '100%' });
    assert.equal(s.box('item')[1], 70);
    s.engine.setProp(s.item, 'style', { flexBasis: 'auto' });
    assert.equal(s.box('row')[1], 70);
    assert.equal(s.box('item')[1], 70);
    s.engine.setProp(s.item, 'style', null);
    assert.equal(s.box('item')[1], 35);
  });

  it('reads the same from a value set on the element', () => {
    const s = scene(css('', 'flex-direction: row; width: fit-content', ''), SHORT);
    s.engine.setProp(s.item, 'style', { flexShrink: 0, flexBasis: '50%' });
    assert.equal(s.box('row')[1], 70);
    assert.equal(s.box('item')[1], 35);
  });

  it('is the content where nothing can be read back', () => {
    const s = scene(css('', 'flex-direction: row; width: fit-content', 'flex: 0 0 50%'), SHORT);
    const unread = Object.assign(s.fabric, { getBoundingClientRect: undefined });
    s.engine.setProp(s.item, 'style', { flexBasis: '60%' });
    s.engine.commit();
    assert.equal(unread.box('item').width, 70);
  });
});
