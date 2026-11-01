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
