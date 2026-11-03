/**
 * A box's `box-sizing` changing, and nothing else about it. React Native's Yoga leaves
 * `boxSizing` out of the style it compares, so a view whose box-sizing alone changes keeps the
 * size it was laid out at; the laid-out fabric here does the same. The expected sizes are
 * Chrome's, for the same markup in a 362 pixel box under the layout reset.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const SIZINGS = '.content-box { box-sizing: content-box } .border-box { box-sizing: border-box }';

function scene(css: string, direction?: 'rtl') {
  const fabric = createLaidOutFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(`.col { width: 362px; height: 600px } ${css} ${SIZINGS}`, 'app.css'),
    conditions: { width: 400, height: 800, colorScheme: 'light', ...(direction && { direction }) },
  });
  const element = (id: string, parent: EngineNode) => {
    const node = engine.createElement('view');
    engine.setClasses(node, id);
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const col = element('col', engine.root);
  const box = element('box', col);
  /** The box's width and height, laid out, to the point: Yoga rounds to the screen's pixels. */
  const size = () => {
    engine.commit();
    const { width, height } = fabric.box('box');
    return [Math.round(width), Math.round(height)];
  };
  /** Set the box's `box-sizing` on the element, or by a class. */
  const sized = (boxSizing: 'content-box' | 'border-box', by: 'element' | 'class') => {
    if (by === 'class') engine.setClasses(box, `box ${boxSizing}`);
    else engine.setProp(box, 'style', { boxSizing });
  };
  return { engine, col, box, size, sized, fabric };
}

const BY = ['element', 'class'] as const;
const FROM_BORDER = ['border-box', 'content-box', 'border-box'] as const;
const FROM_CONTENT = ['content-box', 'border-box', 'content-box'] as const;

describe('a box whose box-sizing changes', () => {
  /** Each shape, and its size as a content box and as a border box. */
  const SHAPES = [
    ['a width and height', 'width: 100px; height: 40px; padding: 10px', [120, 60], [100, 40]],
    [
      'a most and a least',
      'max-width: 100px; min-height: 40px; padding: 10px',
      [120, 60],
      [100, 40],
    ],
    ['a border', 'width: 100px; height: 40px; border: 3px solid', [106, 46], [100, 40]],
    // The ratio is of the content box, or of the border box.
    [
      'a ratio and a width',
      'width: 100px; padding: 10px 20px 0; aspect-ratio: 2',
      [140, 60],
      [100, 50],
    ],
    [
      'a ratio, a width and a border',
      'width: 100px; padding: 0 20px 10px; border: 3px solid; aspect-ratio: 2',
      [146, 66],
      [100, 50],
    ],
    [
      'a ratio and a height',
      'height: 50px; padding: 10px 20px 0; aspect-ratio: 2; align-self: flex-start',
      [140, 60],
      [100, 50],
    ],
    [
      'logical sides',
      'width: 100px; height: 40px; padding-inline: 5px 10px; padding-block: 2px 4px',
      [115, 46],
      [100, 40],
    ],
  ] as const;

  for (const [shape, css, content, border] of SHAPES) {
    it(`is sized by it, with ${shape}`, () => {
      const sizes = { 'content-box': content, 'border-box': border };
      for (const by of BY) {
        for (const order of [FROM_BORDER, FROM_CONTENT]) {
          const s = scene(`.box { ${css} }`);
          for (const boxSizing of order) {
            s.sized(boxSizing, by);
            assert.deepEqual(s.size(), sizes[boxSizing], `${boxSizing} from ${order[0]} by ${by}`);
          }
        }
      }
    });
  }
});

describe('a content box with a share of its size or of its padding', () => {
  it('is laid out as one', () => {
    for (const [css, size] of [
      ['width: 50%; height: 40px; padding: 10px', [201, 60]],
      // Chrome: 136.2 by 76.2.
      ['width: 100px; height: 40px; padding: 5%', [136, 76]],
      // A ratio with no size, which is left to Yoga as a content box.
      ['aspect-ratio: 2', [362, 181]],
      // A ratio from a size of 0, which leaves only the padding and border.
      ['width: 0; padding: 0 20px; aspect-ratio: 2', [40, 0]],
      ['width: 0; border: 3px solid; aspect-ratio: 2', [6, 6]],
      ['height: 0; padding: 10px 0 0; aspect-ratio: 2; align-self: flex-start', [0, 10]],
      ['height: 0; padding: 10px 20px 0; aspect-ratio: 2; align-self: flex-start', [40, 10]],
    ] as const) {
      const s = scene(`.box { box-sizing: content-box; ${css} }`);
      assert.deepEqual(s.size(), size, css);
    }
  });
});

describe('a content box with logical sides in a box read right to left', () => {
  // Chrome: the start is the right, so 100 + 5 + 20 is 125. Read left to right, the start wins
  // over the left: 120.
  const box =
    '.box { box-sizing: content-box; width: 100px; height: 10px; padding-left: 5px; padding-inline-start: 20px }';

  it('takes the direction its parent has in a stylesheet or set on it', () => {
    const sheet = scene(`.col { direction: rtl } ${box}`);
    assert.deepEqual(sheet.size(), [125, 10]);
    const set = scene(box);
    assert.deepEqual(set.size(), [120, 10]);
    set.engine.setProp(set.col, 'style', { direction: 'rtl' });
    assert.deepEqual(set.size(), [125, 10]);
    set.engine.setProp(set.col, 'style', {});
    assert.deepEqual(set.size(), [120, 10]);
  });

  it('stays a content box where the side its direction reads first is a share', () => {
    // Chrome: 100 + 10% of 362 + 20.
    const s = scene(
      '.col { direction: rtl } .box { box-sizing: content-box; width: 100px; height: 10px; padding-left: 10%; padding-inline-start: 20px }',
    );
    assert.deepEqual(s.size(), [156, 10]);
  });

  it("takes the app's direction, where nothing above it sets one", () => {
    const s = scene(box, 'rtl');
    s.engine.commit();
    // Laid out here left to right, as the app is not: the width committed is the border box's.
    const committed = s.fabric.committed[0]!.children[0]!.props;
    assert.equal(committed['width'], 125);
    // The left is read first in the app's direction, and a share: left a content box.
    const share = scene(box.replace('padding-left: 5px', 'padding-left: 10%'), 'rtl');
    share.engine.commit();
    const left = share.fabric.committed[0]!.children[0]!.props;
    assert.deepEqual([left['width'], left['boxSizing']], [100, 'content-box']);
  });
});

describe('a content box with a ratio and a size of 0', () => {
  it('keeps the ratio as written where a size of 0 has no padding or border', () => {
    const s = scene('.box { box-sizing: content-box; width: 0; aspect-ratio: 2 }');
    assert.deepEqual(s.size(), [0, 0]);
    const committed = s.fabric.committed[0]!.children[0]!.props;
    assert.deepEqual([committed['aspectRatio'], committed['boxSizing']], [2, 'border-box']);
  });
});
