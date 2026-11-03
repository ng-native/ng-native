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

function scene(css: string) {
  const fabric = createLaidOutFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(`.col { width: 362px; height: 600px } ${css} ${SIZINGS}`, 'app.css'),
    conditions: { width: 400, height: 800, colorScheme: 'light' },
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
  return { engine, box, size, sized };
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
    ] as const) {
      const s = scene(`.box { box-sizing: content-box; ${css} }`);
      assert.deepEqual(s.size(), size, css);
    }
  });
});
