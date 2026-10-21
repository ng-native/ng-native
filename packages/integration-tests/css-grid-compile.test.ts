/**
 * Grid declarations, as the engine reads them. Yoga has no grid, so the engine lays one out
 * itself (`grid.ts` in fabric) from the track lists and placements the compiler hands it as
 * text: lengths in points, a percentage, `fr`, the sizing keywords and functions. What it cannot
 * lay out, a subgrid or a span counted in named lines, is refused where it is written.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const declarationsOf = (css: string): Record<string, unknown> =>
  compileCss(`view { ${css} }`).rules[0].declarations;

/** The warnings a declaration compiles with, and what it leaves. */
function refused(css: string): { warnings: string[]; declarations: Record<string, unknown> } {
  const warnings: string[] = [];
  const sheet = compileCss(`view { ${css} }`, 'grid', {
    onUnsupported: (message: string) => warnings.push(message),
  });
  return { warnings, declarations: sheet.rules[0]?.declarations ?? {} };
}

describe('display: grid', () => {
  it('is kept, for the engine to lay out', () => {
    assert.deepEqual(declarationsOf('display: grid'), { display: 'grid' });
  });

  it('keeps inline-grid, which is a grid that sits in a line', () => {
    assert.deepEqual(declarationsOf('display: inline-grid'), { display: 'inline-grid' });
  });
});

describe('grid track lists', () => {
  it('writes each track as the engine parses it: points, percentages, fr and keywords', () => {
    assert.deepEqual(
      declarationsOf('grid-template-columns: 100px 20% 1fr auto min-content max-content'),
      {
        gridTemplateColumns: '100px 20% 1fr auto min-content max-content',
      },
    );
  });

  it('turns rem into points, as every other length is', () => {
    assert.deepEqual(declarationsOf('grid-template-rows: 2rem 1.5rem'), {
      gridTemplateRows: '32px 24px',
    });
  });

  it('keeps repeat, minmax and fit-content, which Tailwind writes its columns with', () => {
    assert.deepEqual(declarationsOf('grid-template-columns: repeat(3, minmax(0, 1fr))'), {
      gridTemplateColumns: 'repeat(3, minmax(0px, 1fr))',
    });
    assert.deepEqual(
      declarationsOf('grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)) 40%'),
      { gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr)) 40%' },
    );
    assert.deepEqual(declarationsOf('grid-template-columns: 1fr fit-content(40%)'), {
      gridTemplateColumns: '1fr fit-content(40%)',
    });
  });

  it('reads none as no explicit tracks', () => {
    assert.deepEqual(declarationsOf('grid-template-columns: none'), { gridTemplateColumns: null });
  });

  it('writes the implicit tracks and the flow', () => {
    assert.deepEqual(
      declarationsOf('grid-auto-rows: min-content 20px; grid-auto-flow: column dense'),
      {
        gridAutoRows: 'min-content 20px',
        gridAutoFlow: 'column dense',
      },
    );
  });

  it('reads the initial auto, and a dense row flow as a browser computes it', () => {
    assert.deepEqual(declarationsOf('grid-auto-columns: auto; grid-auto-flow: row dense'), {
      gridAutoColumns: 'auto',
      gridAutoFlow: 'dense',
    });
  });

  it('refuses an auto-fill or auto-fit repeat of a track with no fixed size, as a browser does', () => {
    // Each track repeated needs a length on one side at least: Chrome's CSS.supports for each.
    for (const tracks of [
      'auto',
      'minmax(auto, 1fr)',
      'fit-content(100px)',
      '1fr',
      'min-content',
    ]) {
      const css = `grid-template-columns: repeat(auto-fill, ${tracks})`;
      const { warnings, declarations } = refused(css);
      assert.deepEqual(declarations, {}, css);
      assert.match(warnings[0]!, /auto-fill/, css);
    }
    for (const tracks of [
      'minmax(0, 1fr)',
      'minmax(auto, 100px)',
      'minmax(100px, auto)',
      '100px 20%',
    ]) {
      const css = `grid-template-columns: repeat(auto-fit, ${tracks})`;
      assert.equal(refused(css).warnings.length, 0, css);
    }
  });

  it('refuses a track beside an auto-fill repeat with no fixed size, as a browser does', () => {
    // Beside an automatic repeat every track needs a length on one side, and there is one such
    // repeat at the most: Chrome's CSS.supports for each.
    for (const tracks of [
      'repeat(auto-fill, 100px) 1fr',
      '1fr repeat(auto-fill, 100px)',
      'repeat(auto-fill, 100px) auto',
      'fit-content(10px) repeat(auto-fill, 50px)',
      'repeat(2, 1fr) repeat(auto-fill, 50px)',
      'repeat(auto-fill, 50px) repeat(auto-fit, 50px)',
    ]) {
      const css = `grid-template-columns: ${tracks}`;
      const { warnings, declarations } = refused(css);
      assert.deepEqual(declarations, {}, css);
      assert.equal(warnings.length, 1, css);
    }
    for (const tracks of [
      '100px repeat(auto-fill, 100px) 20%',
      'minmax(0, 1fr) repeat(auto-fit, 50px)',
      'repeat(2, 50px) repeat(auto-fill, 50px)',
      '[a] 50px [b] repeat(auto-fill, [c] 50px) [d]',
      'repeat(2, 1fr) 1fr',
    ]) {
      const css = `grid-template-columns: ${tracks}`;
      assert.equal(refused(css).warnings.length, 0, css);
    }
  });

  it('refuses a track in a unit that needs the element, which a track is read without', () => {
    for (const css of ['grid-template-columns: 2em 1fr', 'grid-auto-rows: 10vw']) {
      const { warnings, declarations } = refused(css);
      assert.deepEqual(declarations, {}, css);
      assert.match(warnings[0]!, /needs the element it is on/, css);
    }
  });

  it('refuses a track with no unit, which a browser drops', () => {
    const { warnings, declarations } = refused('grid-template-columns: 3');
    assert.equal(warnings.length, 1);
    assert.deepEqual(declarations, {});
    assert.deepEqual(declarationsOf('grid-template-columns: 0 1fr'), {
      gridTemplateColumns: '0px 1fr',
    });
  });

  it('keeps the names of lines, where they are written among the tracks', () => {
    assert.deepEqual(
      declarationsOf('grid-template-columns: [full-start] 1fr [a b] 20px [full-end]'),
      {
        gridTemplateColumns: '[full-start] 1fr [a b] 20px [full-end]',
      },
    );
    assert.deepEqual(declarationsOf('grid-template-rows: repeat(2, [row] 10px [gap]) [end]'), {
      gridTemplateRows: 'repeat(2, [row] 10px [gap]) [end]',
    });
  });

  it('keeps template areas as their rows, an empty cell as a dot', () => {
    assert.deepEqual(declarationsOf('grid-template-areas: "head head" "side ."'), {
      gridTemplateAreas: '"head head" "side ."',
    });
    assert.deepEqual(declarationsOf('grid-template-areas: none'), { gridTemplateAreas: null });
  });

  it('refuses a track list from a token, which is read only on the device, and says so', () => {
    const { warnings, declarations } = refused('grid-template-columns: var(--cols)');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /grid-template-columns/);
    assert.deepEqual(declarations, {});
  });

  it('refuses subgrid, and says so', () => {
    assert.match(refused('grid-template-columns: subgrid').warnings[0]!, /grid-template-columns/);
  });
});

describe('grid placement', () => {
  it('writes a line, a span and auto, as the start and the end', () => {
    assert.deepEqual(declarationsOf('grid-column: 1 / span 2'), {
      gridColumnStart: '1',
      gridColumnEnd: 'span 2',
    });
    assert.deepEqual(declarationsOf('grid-row: span 3 / -1'), {
      gridRowStart: 'span 3',
      gridRowEnd: '-1',
    });
    assert.deepEqual(declarationsOf('grid-column: 2'), {
      gridColumnStart: '2',
      gridColumnEnd: 'auto',
    });
  });

  it('lets a later longhand replace one side of the shorthand', () => {
    assert.deepEqual(declarationsOf('grid-column: 1 / 3; grid-column-end: span 2'), {
      gridColumnStart: '1',
      gridColumnEnd: 'span 2',
    });
  });

  it('spreads grid-area over its row and its column', () => {
    assert.deepEqual(declarationsOf('grid-area: 1 / 2 / 3 / 4'), {
      gridRowStart: '1',
      gridColumnStart: '2',
      gridRowEnd: '3',
      gridColumnEnd: '4',
    });
  });

  it('writes a line placed by name, the one counted to after its name', () => {
    assert.deepEqual(declarationsOf('grid-column: sidebar'), {
      gridColumnStart: 'sidebar',
      gridColumnEnd: 'sidebar',
    });
    assert.deepEqual(declarationsOf('grid-column: col 2 / 3 col'), {
      gridColumnStart: 'col 2',
      gridColumnEnd: 'col 3',
    });
    assert.deepEqual(declarationsOf('grid-area: head'), {
      gridRowStart: 'head',
      gridColumnStart: 'head',
      gridRowEnd: 'head',
      gridColumnEnd: 'head',
    });
  });

  it('refuses a span counted in named lines', () => {
    const { warnings, declarations } = refused('grid-column: 1 / span col 2');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /span/);
    assert.deepEqual(declarations, {});
  });
});

describe('alignment inside a grid', () => {
  it('writes justify-items and justify-self, which only a grid reads', () => {
    assert.deepEqual(declarationsOf('justify-items: center; justify-self: end'), {
      justifyItems: 'center',
      justifySelf: 'end',
    });
  });

  it('keeps safe, which holds an overflowing item at the start', () => {
    assert.deepEqual(declarationsOf('justify-self: safe center'), { justifySelf: 'safe center' });
    assert.deepEqual(declarationsOf('justify-items: baseline'), { justifyItems: 'baseline' });
  });

  it('spreads place-items and place-self over both axes', () => {
    assert.deepEqual(declarationsOf('place-items: center start'), {
      alignItems: 'center',
      justifyItems: 'start',
    });
    assert.deepEqual(declarationsOf('place-self: end'), {
      alignSelf: 'flex-end',
      justifySelf: 'end',
    });
  });
});
