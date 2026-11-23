/**
 * Gradients, worked out at build time.
 *
 * Fabric takes gradients as a *processed* structure - direction as an angle or a keyword, stops as
 * a processed colour and a position - and only parses a CSS string when `enableNativeCSSParsing`
 * is on, which it is not by default. React Native's own JS parses the string with a stack of
 * regexes on every render. Neither is needed here: the sheet is compiled by a real CSS parser at
 * build time, so what reaches the device is already the structure C++ wants.
 *
 * The target is Fabric's C++, not RN's JS style API. The two disagree, and the C++ is the one
 * this renderer talks to.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { Engine, StyleResolver, type EngineNode, type StyleTarget } from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { cleanup, createFakeFabric, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

interface Stop {
  color: string;
  position?: string | number;
}
interface Linear {
  type: 'linear-gradient';
  direction: { type: 'angle' | 'keyword'; value: number | string };
  colorStops: Stop[];
}

const gradientsOf = (css: string): (Linear | Record<string, unknown>)[] =>
  compileCss(`view { ${css} }`).rules[0].declarations['experimental_backgroundImage'];

const linear = (css: string) => gradientsOf(css)[0] as Linear;

describe('a linear gradient', () => {
  it('defaults to running down the box, as CSS does', () => {
    // 180 degrees rather than the keyword. Native does *not* take both: its parser knows the
    // four corner keywords and nothing else, so a straight edge has to arrive as an angle. This
    // comment used to say the opposite, which is how the bug lasted.
    assert.deepEqual(linear('background-image: linear-gradient(red, blue)'), {
      type: 'linear-gradient',
      direction: { type: 'angle', value: 180 },
      colorStops: [
        { color: 'rgb(255, 0, 0)', position: null },
        { color: 'rgb(0, 0, 255)', position: null },
      ],
    });
  });

  it('writes a position even when there is none, because Fabric looks for the key', () => {
    // `parseProcessedBackgroundImage` finds `position` before it reads it, and skips a stop that
    // has not got one. A two-stop gradient written without positions would paint nothing.
    for (const stop of linear('background-image: linear-gradient(red, blue)').colorStops) {
      assert.ok('position' in stop, 'every stop carries the key, null or not');
    }
  });

  /**
   * The table is React Native's, in `processBackgroundImage`'s `getDirectionForKeyword`, and it
   * is not the obvious one: a straight edge becomes an **angle**, and only the four corners stay
   * keywords. Native's parser knows those four and nothing else, so `{keyword, 'to right'}` is
   * not a different spelling of the same thing - it is refused, and the whole gradient with it.
   *
   * This test used to assert the keyword, agreeing with the code. Both were wrong, and nothing
   * caught it until a gradient was looked at on a screen.
   */
  it('turns a straight edge into the angle native reads, and keeps corners as keywords', () => {
    const of = (dir: string) =>
      linear(`background-image: linear-gradient(${dir}, red, blue)`).direction;

    assert.deepEqual(of('to top'), { type: 'angle', value: 0 });
    assert.deepEqual(of('to right'), { type: 'angle', value: 90 });
    assert.deepEqual(of('to bottom'), { type: 'angle', value: 180 });
    assert.deepEqual(of('to left'), { type: 'angle', value: 270 });

    assert.deepEqual(of('to bottom right'), { type: 'keyword', value: 'to bottom right' });
    assert.deepEqual(of('to top left'), { type: 'keyword', value: 'to top left' });

    // Corners are named vertical first however they were written, because that is how native's
    // four keywords are spelt.
    assert.deepEqual(of('to right top'), { type: 'keyword', value: 'to top right' });

    // An angle written as one is passed through, and is the default when none is given.
    assert.deepEqual(of('45deg'), { type: 'angle', value: 45 });
    assert.deepEqual(linear('background-image: linear-gradient(red, blue)').direction, {
      type: 'angle',
      value: 180,
    });
  });

  it('takes an angle, in the degrees native measures in', () => {
    assert.deepEqual(linear('background-image: linear-gradient(45deg, red, blue)').direction, {
      type: 'angle',
      value: 45,
    });
    // Every CSS angle unit means the same thing once it is a number.
    assert.equal(
      linear('background-image: linear-gradient(0.25turn, red, blue)').direction.value,
      90,
    );
  });

  it('keeps a stop where the author put it', () => {
    assert.deepEqual(linear('background-image: linear-gradient(red, blue 40%)').colorStops, [
      { color: 'rgb(255, 0, 0)', position: null },
      { color: 'rgb(0, 0, 255)', position: '40%' },
    ]);
    assert.deepEqual(linear('background-image: linear-gradient(red, blue 20px)').colorStops[1], {
      color: 'rgb(0, 0, 255)',
      position: 20,
    });
  });

  it('spells a two-position stop as the two stops it means', () => {
    // `red 0 50%` is a hard band: the same colour at both ends of the range. Native has no room
    // for a second position on one stop, and CSS defines it as exactly this expansion.
    assert.deepEqual(linear('background-image: linear-gradient(red 0 50%, blue)').colorStops, [
      { color: 'rgb(255, 0, 0)', position: 0 },
      { color: 'rgb(255, 0, 0)', position: '50%' },
      { color: 'rgb(0, 0, 255)', position: null },
    ]);
  });

  it('stacks the layers a comma-separated list asks for', () => {
    const layers = gradientsOf(
      'background-image: linear-gradient(red, blue), linear-gradient(green, teal)',
    );
    assert.equal(layers.length, 2);
  });
});

describe('a radial gradient', () => {
  it('carries the shape, the size and the centre native reads', () => {
    assert.deepEqual(gradientsOf('background-image: radial-gradient(red, blue)')[0], {
      type: 'radial-gradient',
      shape: 'ellipse',
      size: 'farthest-corner',
      position: { top: '50%', left: '50%' },
      colorStops: [
        { color: 'rgb(255, 0, 0)', position: null },
        { color: 'rgb(0, 0, 255)', position: null },
      ],
    });
  });

  it('takes a circle, an extent and a centre of its own', () => {
    const gradient = gradientsOf(
      'background-image: radial-gradient(circle closest-side at 30% 40%, red, blue)',
    )[0] as Record<string, unknown>;
    assert.equal(gradient['shape'], 'circle');
    assert.equal(gradient['size'], 'closest-side');
    assert.deepEqual(gradient['position'], { left: '30%', top: '40%' });
  });

  it('measures from the far edge when the author does', () => {
    const gradient = gradientsOf(
      'background-image: radial-gradient(at right bottom, red, blue)',
    )[0] as Record<string, unknown>;
    assert.deepEqual(gradient['position'], { right: 0, bottom: 0 });
  });
});

describe('what a gradient cannot be', () => {
  it('refuses a conic gradient, which native has no shape for', () => {
    assert.throws(() => gradientsOf('background-image: conic-gradient(red, blue)'), /conic/);
  });

  it('refuses a url, because there is no image loader behind this prop', () => {
    assert.throws(() => gradientsOf('background-image: url(cat.png)'), /url/);
  });

  it('still refuses a background shorthand carrying a url', () => {
    assert.throws(() => compileCss('view { background: url(cat.png) }'), /url/);
  });
});

describe('a gradient in the background shorthand', () => {
  // The shorthand says all of a background at once: what it does not write is back at its
  // initial value, the colour among it. Each case is the longhands that say the same.
  const styleOf = (declarations: string): Record<string, unknown> => {
    const style = compileCss(`.a { ${declarations} }`).rules[0].declarations;
    assert.ok(style['backgroundColor'] !== undefined, declarations);
    return style;
  };
  const INITIAL =
    'background-position: 0% 0%; background-size: auto; background-repeat: repeat; ' +
    'background-color: transparent';

  it('is the image, with the rest as it starts', () => {
    const one = 'linear-gradient(to right, red, blue)';
    assert.deepEqual(
      styleOf(`background: ${one}`),
      styleOf(`background-image: ${one}; ${INITIAL}`),
    );
  });

  it('is each layer of several, in order', () => {
    const two =
      'linear-gradient(to top, #000 0%, rgba(0,0,0,0) 100%), ' +
      'linear-gradient(to right, #fff 0%, rgba(255,255,255,0) 100%)';
    const long =
      `background-image: ${two}; background-position: 0% 0%, 0% 0%; ` +
      'background-size: auto, auto; background-repeat: repeat, repeat; ' +
      'background-color: transparent';
    assert.deepEqual(styleOf(`background: ${two}`), styleOf(long));
    assert.equal(
      (styleOf(`background: ${two}`)['experimental_backgroundImage'] as unknown[]).length,
      2,
    );
  });

  it('takes the position, size, repeat and colour written beside it', () => {
    const short = 'background: linear-gradient(red, blue) center / cover no-repeat #fff';
    const long =
      'background-image: linear-gradient(red, blue); background-position: center; ' +
      'background-size: cover; background-repeat: no-repeat; background-color: #fff';
    assert.deepEqual(styleOf(short), styleOf(long));
  });

  it('takes an image away where it writes none, and the rest back to where it starts', () => {
    const none =
      'background-image: none; background-position: 0% 0%; background-size: auto; ' +
      'background-repeat: repeat';
    assert.deepEqual(styleOf('background: red'), styleOf(`${none}; background-color: red`));
    assert.deepEqual(
      styleOf('background: none'),
      styleOf(`${none}; background-color: transparent`),
    );
    // Over the rules before it: a flat button of a kind that has a gradient has none, and a
    // gradient a later rule gives it is placed as a gradient starts, not as the first rule said.
    const sheet = compileCss(
      '.a { background-image: linear-gradient(red, blue); background-position: right bottom; ' +
        'background-size: cover; background-repeat: no-repeat } .flat { background: red } ' +
        '.lit { background-image: linear-gradient(red, blue) }',
    );
    const [first, flat, lit] = sheet.rules.map(
      (rule: { declarations: Record<string, unknown> }) => rule.declarations,
    );
    const merged = { ...first, ...flat, ...lit };
    assert.deepEqual({ ...first, ...flat }['experimental_backgroundImage'], []);
    const initial = styleOf(`background-image: linear-gradient(red, blue); ${INITIAL}`);
    for (const key of ['Position', 'Size', 'Repeat'].map(
      (part) => `experimental_background${part}`,
    )) {
      assert.deepEqual(merged[key], initial[key], key);
    }
  });

  it('passes over a layer that writes none beside one that paints', () => {
    // A layer of no image draws nothing, and where it would be placed places nothing.
    const one = styleOf('background: linear-gradient(red, blue) center / cover no-repeat');
    assert.deepEqual(
      styleOf('background: none, linear-gradient(red, blue) center / cover no-repeat'),
      one,
    );
    assert.deepEqual(
      styleOf('background: linear-gradient(red, blue) center / cover no-repeat, none'),
      one,
    );
  });
});

describe('a repeating linear gradient', () => {
  // Native has no repeating gradient, but it tiles a background image. A repeating gradient
  // whose stops are lengths is one plain gradient drawn in tiles, and each case here is the tile
  // written out by hand, the way a browser draws it the same (checked against Chrome's pixels).
  const styleOf = (declarations: string): Record<string, unknown> =>
    compileCss(`.a { ${declarations} }`).rules[0].declarations;
  const tiled = (image: string, size: string, position: string) =>
    styleOf(
      `background-image: ${image}; background-size: ${size}; ` +
        `background-position: ${position}; background-repeat: repeat`,
    );
  // 6px across stripes at 45 degrees to the box's sides: 6 / sin 45deg.
  const DIAGONAL = '8.48528px 8.48528px';

  it('is diagonal stripes as a tile two stripes long, from the corner it starts at', () => {
    // The issue's stripes. A tile 6/sin wide and 6/cos high holds exactly two periods along
    // the gradient line, and its own gradient line starts at the corner the box's does.
    assert.deepEqual(
      styleOf(
        'background-image: repeating-linear-gradient(135deg, rgba(29,29,31,.28) 0 3px, transparent 3px 6px)',
      ),
      tiled(
        'linear-gradient(135deg, rgba(29,29,31,.28) 0 3px, transparent 3px 6px, ' +
          'rgba(29,29,31,.28) 6px 9px, transparent 9px 12px)',
        DIAGONAL,
        '0% 0%',
      ),
    );
  });

  it('anchors the tile at the corner each quadrant starts from', () => {
    const stripes = (angle: string) =>
      styleOf(`background-image: repeating-linear-gradient(${angle}, red 0 3px, blue 3px 6px)`);
    const tile = (angle: string, position: string) =>
      tiled(
        `linear-gradient(${angle}, red 0 3px, blue 3px 6px, red 6px 9px, blue 9px 12px)`,
        DIAGONAL,
        position,
      );
    assert.deepEqual(stripes('45deg'), tile('45deg', '0% 100%'));
    assert.deepEqual(stripes('225deg'), tile('225deg', '100% 0%'));
    assert.deepEqual(stripes('-45deg'), tile('-45deg', '100% 100%'));
  });

  it('is a band across the box, one period long, for a straight edge', () => {
    const stripes = (direction: string) =>
      styleOf(`background-image: repeating-linear-gradient(${direction}red 0 4px, blue 4px 10px)`);
    const band = (angle: string, size: string, position: string) =>
      tiled(`linear-gradient(${angle}, red 0 4px, blue 4px 10px)`, size, position);
    assert.deepEqual(stripes(''), band('180deg', '100% 10px', '0% 0%'));
    assert.deepEqual(stripes('to top, '), band('0deg', '100% 10px', '0% 100%'));
    assert.deepEqual(stripes('to right, '), band('90deg', '10px 100%', '0% 0%'));
    assert.deepEqual(stripes('to left, '), band('270deg', '10px 100%', '100% 0%'));
  });

  it('places its stops as CSS does: the first at 0, a run spread out, none going back', () => {
    assert.deepEqual(
      styleOf('background-image: repeating-linear-gradient(red, lime, blue 8px, white 2px)'),
      tiled('linear-gradient(red 0, lime 4px, blue 8px, white 8px)', '100% 8px', '0% 0%'),
    );
    assert.deepEqual(
      styleOf('background-image: repeating-linear-gradient(red 0, blue 0.5rem)'),
      tiled('linear-gradient(red 0, blue 8px)', '100% 8px', '0% 0%'),
    );
  });

  it('is a band a percentage of the box long, for percentage stops along a side', () => {
    // Along a side the gradient line is the box's height (or width), so a period of 20% is a band
    // 20% of the box, and each stop is its share of the period along the band's own line.
    assert.deepEqual(
      styleOf('background-image: repeating-linear-gradient(red 0 10%, blue 10% 20%)'),
      tiled('linear-gradient(180deg, red 0% 50%, blue 50% 100%)', '100% 20%', '0% 0%'),
    );
    assert.deepEqual(
      styleOf(
        'background-image: repeating-linear-gradient(90deg, red 0 5%, lime 5% 15%, blue 15% 25%)',
      ),
      tiled('linear-gradient(90deg, red 0% 20%, lime 20% 60%, blue 60% 100%)', '25% 100%', '0% 0%'),
    );
    assert.deepEqual(
      styleOf('background-image: repeating-linear-gradient(to left, red 0 10%, blue 10% 40%)'),
      tiled('linear-gradient(270deg, red 0% 25%, blue 25% 100%)', '40% 100%', '100% 0%'),
    );
    // Settled as CSS settles them, a run with none spread out, before they are shared out.
    assert.deepEqual(
      styleOf('background-image: repeating-linear-gradient(to top, red, lime, blue 50%)'),
      tiled('linear-gradient(0deg, red 0%, lime 50%, blue 100%)', '100% 50%', '0% 100%'),
    );
    // A period longer than the box is one band, which is what a browser draws.
    assert.deepEqual(
      styleOf('background-image: repeating-linear-gradient(red 0 60%, blue 60% 120%)'),
      tiled('linear-gradient(180deg, red 0% 50%, blue 50% 100%)', '100% 120%', '0% 0%'),
    );
  });

  it('places the other layers as they start, beside a tiled one', () => {
    assert.deepEqual(
      styleOf(
        'background-image: linear-gradient(red, blue), repeating-linear-gradient(red 0 2px, blue 2px 4px)',
      ),
      styleOf(
        'background-image: linear-gradient(red, blue), linear-gradient(red 0 2px, blue 2px 4px); ' +
          'background-size: auto, 100% 4px; background-position: 0% 0%, 0% 0%; ' +
          'background-repeat: repeat, repeat',
      ),
    );
  });

  it('is the same tile in the background shorthand, over its colour', () => {
    assert.deepEqual(
      styleOf('background: repeating-linear-gradient(90deg, red 0 2px, blue 2px 4px) white'),
      styleOf(
        'background-image: linear-gradient(90deg, red 0 2px, blue 2px 4px); ' +
          'background-size: 4px 100%; background-position: 0% 0%; background-repeat: repeat; ' +
          'background-color: white',
      ),
    );
    // A position or a repeat moves nothing of an image the box's own size, so the tile's win.
    assert.deepEqual(
      styleOf(
        'background: repeating-linear-gradient(90deg, red 0 2px, blue 2px 4px) center no-repeat white',
      ),
      styleOf('background: repeating-linear-gradient(90deg, red 0 2px, blue 2px 4px) white'),
    );
    // A layer beside it keeps where the shorthand places it.
    assert.deepEqual(
      styleOf(
        'background: linear-gradient(red, blue) center / 10px 20px no-repeat, ' +
          'repeating-linear-gradient(90deg, red 0 2px, blue 2px 4px)',
      ),
      styleOf(
        'background-image: linear-gradient(red, blue), linear-gradient(90deg, red 0 2px, blue 2px 4px); ' +
          'background-position: center, 0% 0%; background-size: 10px 20px, 4px 100%; ' +
          'background-repeat: no-repeat, repeat; background-color: transparent',
      ),
    );
  });

  it('refuses what a tile cannot draw, and names the tile to write instead', () => {
    for (const [image, why] of [
      // At an angle, a percentage is of a gradient line whose length hangs on the box's shape.
      ['repeating-linear-gradient(45deg, red 0 10%, blue 10% 20%)', /percentage.*at an angle/],
      // A period of a length and a percentage together is a length only the laid-out box has.
      ['repeating-linear-gradient(red 0 10px, blue 10px 20%)', /mixes/],
      ['repeating-linear-gradient(red 0 1em, blue 1em 2em)', /not in px, rem or %/],
      // A last stop with no position is at 100%.
      ['repeating-linear-gradient(red 0 3px, blue)', /ends on a stop with no position/],
      // A corner's angle depends on the box's shape.
      ['repeating-linear-gradient(to top right, red 0 3px, blue 3px 6px)', /runs to a corner/],
      ['repeating-linear-gradient(red 2px, blue 8px)', /other than 0/],
      ['repeating-linear-gradient(red 0, blue 0)', /repeats every 0px/],
    ] as const) {
      assert.throws(
        () => styleOf(`background-image: ${image}`),
        (error: Error) =>
          why.test(error.message) &&
          /repeating-linear-gradient.*background-size.*background-repeat/s.test(error.message),
        image,
      );
    }
    assert.throws(
      () => styleOf('background: repeating-linear-gradient(red 0 3px, blue 3px 6px) 0 0 / 20px'),
      /repeating-linear-gradient.*background-size/s,
    );
    assert.throws(
      () => styleOf('background-image: repeating-radial-gradient(red 0 3px, blue 3px 6px)'),
      /repeating-radial-gradient has no native equivalent/,
    );
  });

  it('refuses a period under a pixel, which Chrome samples rather than averages', () => {
    // Chrome paints whichever stripe each device pixel's centre lands on: solid red at one
    // density, solid blue at the next, uneven stripes at a third. There is no one colour to draw
    // instead, and a device would draw a tile for every stripe.
    for (const image of [
      'repeating-linear-gradient(red 0 0.25px, blue 0.25px 0.5px)',
      'repeating-linear-gradient(45deg, red 0 0.45px, blue 0.45px 0.9px)',
      'repeating-linear-gradient(red 0 0.03rem, blue 0.03rem 0.06rem)',
    ]) {
      assert.throws(
        () => styleOf(`background-image: ${image}`),
        /repeating-linear-gradient repeats every [\d.]+px, under 1px.*background-color/s,
        image,
      );
    }
    // A period of one pixel is still drawn.
    assert.deepEqual(
      styleOf('background-image: repeating-linear-gradient(red 0 0.5px, blue 0.5px 1px)'),
      tiled('linear-gradient(red 0 0.5px, blue 0.5px 1px)', '100% 1px', '0% 0%'),
    );
  });

  it('refuses a length position in the shorthand, which moves or clips the box-sized image', () => {
    // A browser shifts the whole image by 1px and, with no-repeat, leaves a column uncovered. The
    // tile is drawn from 0, so a position that is a length (or an offset from a side) is refused
    // rather than dropped, while a percentage, which a box-sized image ignores, is not.
    for (const position of ['1px 0 no-repeat', 'right 2px top 3px', '0 1px', 'left 4px center']) {
      assert.throws(
        () =>
          styleOf(
            `background: repeating-linear-gradient(90deg, red 0 2px, blue 2px 4px) ${position}`,
          ),
        /repeating-linear-gradient.*background-position/s,
        position,
      );
    }
    for (const position of ['0 0', 'right', 'bottom right', '50% 10%', 'center top']) {
      assert.deepEqual(
        styleOf(
          `background: repeating-linear-gradient(90deg, red 0 2px, blue 2px 4px) ${position}`,
        ),
        styleOf('background: repeating-linear-gradient(90deg, red 0 2px, blue 2px 4px)'),
        position,
      );
    }
  });

  it('writes no placement for an ordinary image, so a later rule cannot clear what an author set', () => {
    // An ordinary image that wins over a tile takes the tile's placing away in the cascade, which
    // knows which rule wrote what. Resetting placement for every ordinary image instead would
    // drop an author's own `background-size` too; this pins that the plain image writes none.
    assert.deepEqual(
      Object.keys(styleOf('background-image: linear-gradient(red, blue)')).filter((key) =>
        /^experimental_background(Size|Position|Repeat)$/.test(key),
      ),
      [],
    );
  });
});

describe("a tile's placing in the cascade", () => {
  // What an ordinary image that wins over a tile is placed as is checked against Chrome in the
  // oracle (`TILE_PLACING_CASES`). These are the cases where the tile wins, and keeps its own.
  const styleOf = (css: string, classes: string[]): Record<string, unknown> => {
    const resolver = new StyleResolver(compileCss(css), {
      width: 400,
      height: 800,
      colorScheme: 'light',
    });
    const node: StyleTarget = {
      tag: 'view',
      parent: null,
      classes: new Set(classes),
      props: {},
      templateSheet: null,
      hostSheet: null,
      styleCache: null,
      styleDirty: true,
    };
    return resolver.resolve(node, 1).style;
  };
  const STRIPES = 'repeating-linear-gradient(90deg, red 0 2px, blue 2px 4px)';
  const tile = styleOf(`.a { background-image: ${STRIPES} }`, ['a']);

  it('keeps it for a tile that wins over an ordinary image', () => {
    assert.deepEqual(
      styleOf(
        `.a { background: linear-gradient(red, blue) center / 10px 20px no-repeat } ` +
          `.a.b { background-image: ${STRIPES} }`,
        ['a', 'b'],
      ),
      { ...tile, backgroundColor: 'rgba(0, 0, 0, 0)' },
    );
  });

  it('keeps it for an important tile under a later plain image', () => {
    assert.deepEqual(
      styleOf(
        `.a { background-image: ${STRIPES} !important } .a.b { background-image: linear-gradient(red, blue) }`,
        ['a', 'b'],
      ),
      tile,
    );
  });

  it("gives an element's own image the placing under the tile, until it goes again", () => {
    const fabric = createFakeFabric();
    const sheet = compileCss(
      `.a { background-size: 10px 20px } .a.b { background-image: ${STRIPES} }`,
    );
    const engine = new Engine(fabric, 1, { globalStyles: sheet });
    const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
    const node = renderer.createElement('view') as EngineNode;
    renderer.setAttribute(node, 'nativeID', 'probe');
    renderer.setAttribute(node, 'class', 'a b');
    renderer.appendChild(engine.root, node);
    const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
      nodes.flatMap((one) => [one, ...flatten(one.children)]);
    const placing = () => {
      engine.commit();
      const { props } = flatten(fabric.committed).find((one) => one.props['nativeID'] === 'probe')!;
      return ['Size', 'Position', 'Repeat'].map(
        (part) => props[`experimental_background${part}`] ?? null,
      );
    };
    const tiled = placing();
    assert.deepEqual(tiled, [
      tile['experimental_backgroundSize'],
      tile['experimental_backgroundPosition'],
      tile['experimental_backgroundRepeat'],
    ]);
    renderer.setStyle(node, 'background-image', 'linear-gradient(red, blue)');
    assert.deepEqual(placing(), [[{ x: 10, y: 20 }], null, null]);
    renderer.removeStyle(node, 'background-image');
    assert.deepEqual(placing(), tiled);
  });

  it("takes an important tile's away for a stronger important image", () => {
    const plain = 'background-image: linear-gradient(red, blue) !important';
    assert.deepEqual(
      styleOf(`.a { background-image: ${STRIPES} !important } .a.b { ${plain} }`, ['a', 'b']),
      styleOf(`.a { ${plain} }`, ['a']),
    );
  });

  it("keeps the first tile's underlay beneath a second tile", () => {
    // Two tiles, then a plain image: what the first covered comes back, not the first tile's.
    assert.deepEqual(
      styleOf(
        `.a { background-size: 10px 20px } .b { background-image: ${STRIPES} } ` +
          `.b.c { background-image: repeating-linear-gradient(red 0 3px, blue 3px 6px) } ` +
          `.b.c.d { background-image: linear-gradient(red, blue) }`,
        ['a', 'b', 'c', 'd'],
      ),
      styleOf(
        '.a { background-size: 10px 20px } .b { background-image: linear-gradient(red, blue) }',
        ['a', 'b'],
      ),
    );
  });
});

describe('a gradient on a device', () => {
  it('runs its colours through the host converter, as any other colour is', async () => {
    const mod = await compileFixture('fixtures/gradient.ts');
    const { getByTestId } = await render(mod['GradientHost'] as Type<unknown>, {
      processColor: (value) => `processed(${String(value)})`,
    });

    const node = getByTestId('hero');
    const [gradient] = node.props['experimental_backgroundImage'] as Linear[];
    assert.deepEqual(gradient!.colorStops, [
      { color: 'processed(rgb(255, 0, 0))', position: null },
      { color: 'processed(rgb(0, 0, 255))', position: '60%' },
    ]);
  });
});

describe('a gradient whose colours come from custom properties', () => {
  /** The deferred template a gradient with `var()` stops compiles to. */
  const deferredOf = (css: string) =>
    compileCss(`view { ${css} }`, 'test', { onUnsupported: () => {} }).rules[0].deferred?.[0];

  it('is held as a template, because the stops are not known until a node matches', () => {
    assert.deepEqual(
      deferredOf('background-image: linear-gradient(to right, var(--start), var(--end))'),
      {
        props: ['experimental_backgroundImage'],
        gradient: {
          type: 'linear-gradient',
          direction: { type: 'angle', value: 90 },
          colorStops: [{ reference: '--start' }, { reference: '--end' }],
        },
      },
    );
  });

  it('keeps a position, whether it is written out or deferred too', () => {
    const template = deferredOf(
      'background-image: linear-gradient(var(--start) 10%, var(--end) var(--end-at, 90%))',
    ) as { gradient: { colorStops: unknown[] } };
    assert.deepEqual(template.gradient.colorStops, [
      { reference: '--start', position: '10%' },
      { reference: '--end', positionReference: '--end-at', position: '90%' },
    ]);
  });
});

describe('resolving a gradient template', () => {
  let Host: Type<unknown>;

  const paint = async (globalCss: string) => {
    const mod = await compileFixture('fixtures/gradient.ts');
    Host ??= mod['ThemedGradient'] as Type<unknown>;
    const { getByTestId } = await render(mod['ThemedGradient'] as Type<unknown>, {
      globalStyles: compileCss(globalCss, 'global', { onUnsupported: () => {} }),
    });
    return getByTestId('themed');
  };

  it('fills the stops in from the cascade', async () => {
    const node = await paint(':root { --start: red; --middle: green; --end: blue }');
    assert.deepEqual(node.props['experimental_backgroundImage'], [
      {
        type: 'linear-gradient',
        direction: { type: 'angle', value: 90 },
        colorStops: [
          { color: 'rgb(255, 0, 0)', position: null },
          { color: 'rgb(0, 128, 0)', position: '50%' },
          { color: 'rgb(0, 0, 255)', position: null },
        ],
      },
    ]);
  });

  it('drops a stop nothing defined, which is how an optional middle colour disappears', async () => {
    // Tailwind's `via-*` is exactly this: one gradient rule, used with and without a middle
    // colour, and the class that supplies one is a different class from the one that paints. A
    // stop with no colour is not a transparent stop; it is not a stop.
    const node = await paint(':root { --start: red; --end: blue }');
    const [gradient] = node.props['experimental_backgroundImage'] as { colorStops: unknown[] }[];
    assert.deepEqual(gradient!.colorStops, [
      { color: 'rgb(255, 0, 0)', position: null },
      { color: 'rgb(0, 0, 255)', position: null },
    ]);
  });

  it('paints nothing when there are not two colours to run between', async () => {
    const node = await paint(':root { --start: red }');
    assert.equal(node.props['experimental_backgroundImage'], undefined);
  });
});

describe('a gradient stop token that is set but of the wrong kind', () => {
  /** The gradient a view under `:root { tokens }` paints with `background-image`. */
  const painted = (tokens: string, image: string) => {
    const sheet = compileCss(`:root { ${tokens} } .g { background-image: ${image} }`, 'g');
    const resolver = new StyleResolver(sheet, { width: 400, height: 800, colorScheme: 'light' });
    const node: StyleTarget = {
      tag: 'view',
      parent: null,
      classes: new Set(['g']),
      props: {},
      templateSheet: null,
      hostSheet: null,
      styleCache: null,
      styleDirty: true,
    };
    const background = resolver.resolve(node, 1).style['experimental_backgroundImage'];
    return (background as { colorStops: { position: unknown }[] }[] | undefined)?.[0]?.colorStops;
  };

  // Each checked in Chrome: a set token is substituted, so its fallback is not used, and a
  // position or a colour that is no such thing makes the whole gradient invalid.
  it('paints no gradient for a position token holding a colour', () => {
    const image = 'linear-gradient(to right, var(--f) var(--fp, 10%), var(--t))';
    const stops = (tokens: string) => painted(`--f: red; --t: blue; ${tokens}`, image);
    assert.deepEqual(
      stops('')?.map((stop) => stop.position),
      ['10%', null],
    );
    assert.deepEqual(
      stops('--fp: 30%')?.map((stop) => stop.position),
      ['30%', null],
    );
    assert.equal(stops('--fp: red'), undefined);
  });

  it('paints no gradient for a colour token holding a word that is no colour', () => {
    // An unset one is left out, which is how Tailwind's optional middle colour disappears.
    const image = 'linear-gradient(to right, var(--f), var(--v), var(--t))';
    assert.equal(painted('--f: red; --t: blue', image)?.length, 2);
    assert.equal(painted('--f: red; --v: foo; --t: blue', image), undefined);
  });
});

describe('gradient stops', () => {
  const deferredOf = (css: string) => compileCss(`view { ${css} }`, 'test').rules[0].deferred?.[0];

  it('gives a stop with two positions a stop at each', () => {
    assert.deepEqual(
      linear('background-image: linear-gradient(red 10% 20%, blue)').colorStops.map(
        (stop) => stop.position,
      ),
      ['10%', '20%', null],
    );
  });

  it('takes a bare 0 as the position of a var() stop', () => {
    const template = deferredOf('background-image: linear-gradient(var(--a) 0, var(--b))') as {
      gradient: { colorStops: unknown[] };
    };
    assert.deepEqual(template.gradient.colorStops, [
      { reference: '--a', position: 0 },
      { reference: '--b' },
    ]);
  });

  it('refuses a var() gradient with one stop, or a radial one with an explicit radius', () => {
    assert.throws(
      () => deferredOf('background-image: linear-gradient(var(--a))'),
      /at least two colour stops/,
    );
    assert.throws(
      () => deferredOf('background-image: radial-gradient(40px, var(--a), var(--b))'),
      /explicit radius/,
    );
  });

  it('keeps a var() radial gradient s shape, size and centre', () => {
    const declaration = deferredOf(
      'background-image: radial-gradient(circle closest-side at right 20%, var(--a), var(--b))',
    ) as { gradient: Record<string, unknown> };
    assert.equal(declaration!.gradient['shape'], 'circle');
    assert.equal(declaration!.gradient['size'], 'closest-side');
    assert.deepEqual(declaration!.gradient['position'], { right: 0, top: '20%' });
  });
});

/**
 * CSS interpolates a gradient's stops in premultiplied alpha, so a stop at no opacity adds none of
 * its own colour: `transparent` to white is white all the way down. iOS interpolates the four
 * channels as they stand, where halfway from `rgb(0 0 0 / 0)` to white is grey at half opacity.
 *
 * Each row is what Chrome 154 painted for the same gradient down a 100px box on a transparent
 * page, read from a screenshot at the y given. The stops committed here are run through iOS's
 * arithmetic and have to come to the same pixels.
 */
describe('a gradient through a stop at no opacity', () => {
  type Pixel = [y: number, r: number, g: number, b: number, a: number];
  const CHROME: Record<string, Pixel[]> = {
    first: [
      [10, 255, 255, 255, 27],
      [40, 255, 255, 255, 103],
      [90, 255, 255, 255, 231],
    ],
    last: [
      [10, 255, 255, 255, 228],
      [60, 255, 255, 255, 101],
      [90, 255, 255, 255, 24],
    ],
    red: [
      [10, 255, 0, 0, 27],
      [40, 255, 0, 0, 103],
      [90, 255, 0, 0, 231],
    ],
    middle: [
      [10, 255, 0, 0, 201],
      [40, 255, 0, 0, 48],
      [60, 0, 0, 255, 54],
      [90, 0, 0, 255, 207],
    ],
    black: [
      [10, 255, 0, 0, 201],
      [40, 255, 0, 0, 48],
      [60, 0, 0, 0, 54],
      [90, 0, 0, 0, 207],
    ],
    run: [
      [10, 255, 0, 0, 121],
      [40, 0, 0, 0, 0],
      [90, 0, 0, 255, 134],
    ],
    placed: [
      [10, 255, 0, 0, 166],
      [25, 255, 0, 0, 38],
      [40, 0, 0, 255, 89],
      [75, 0, 99, 156, 255],
    ],
    zero: [
      [10, 0, 0, 255, 27],
      [40, 0, 0, 255, 103],
      [90, 0, 0, 255, 231],
    ],
    token: [
      [10, 255, 255, 255, 27],
      [40, 255, 255, 255, 103],
      [90, 255, 255, 255, 231],
    ],
    mix: [
      [10, 255, 255, 255, 27],
      [40, 255, 255, 255, 103],
      [90, 255, 255, 255, 231],
    ],
    bound: [
      [10, 255, 255, 255, 27],
      [40, 255, 255, 255, 103],
      [90, 255, 255, 255, 231],
    ],
    hsl: [
      [10, 255, 0, 0, 27],
      [40, 255, 0, 0, 103],
      [90, 255, 0, 0, 231],
    ],
    // A stop at part opacity adds its colour in proportion, so the colour between two stops
    // bends towards the more opaque one.
    veil: [
      [3, 67, 67, 67, 34],
      [10, 138, 138, 138, 50],
      [25, 197, 197, 197, 84],
      [50, 233, 233, 233, 141],
      [90, 253, 253, 253, 233],
    ],
    through: [
      [10, 243, 0, 13, 212],
      [40, 139, 0, 119, 90],
      [60, 0, 146, 111, 94],
      [90, 0, 244, 12, 216],
    ],
    points: [
      [10, 0, 0, 0, 26],
      [25, 125, 125, 125, 47],
      [50, 233, 233, 233, 142],
      [90, 255, 255, 255, 255],
    ],
    veilToken: [
      [3, 67, 67, 67, 34],
      [25, 197, 197, 197, 84],
      [90, 253, 253, 253, 233],
    ],
    even: [
      [10, 229, 0, 28, 128],
      [50, 128, 0, 129, 128],
      [90, 26, 0, 231, 128],
    ],
    faint: [
      [10, 255, 255, 255, 229],
      [75, 240, 240, 240, 66],
      [90, 220, 220, 220, 29],
      [96, 164, 164, 164, 14],
    ],
    plateau: [
      [25, 211, 0, 44, 151],
      [40, 139, 0, 119, 90],
      [60, 0, 0, 255, 51],
      [90, 0, 0, 255, 51],
    ],
    fromStart: [
      [3, 78, 78, 78, 36],
      [25, 209, 209, 209, 99],
      [60, 247, 247, 247, 199],
      [90, 255, 255, 255, 255],
    ],
  };

  /** A committed colour's channels, each out of 255: one the compiler wrote, or a bound name. */
  const rgba = (colour: string): number[] => {
    const bound = {
      transparent: [0, 0, 0, 0],
      white: [255, 255, 255, 255],
      'hsl(0 100% 50%)': [255, 0, 0, 255],
    }[colour];
    if (bound) return bound;
    const parts = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(colour);
    assert.ok(parts, `a colour, not ${colour}`);
    return [Number(parts[1]), Number(parts[2]), Number(parts[3]), Number(parts[4] ?? 1) * 255];
  };

  /**
   * What iOS paints at `at` percent along the stops it is given: React Native's `getColors` in
   * `RCTGradientUtils.mm`, which gives a transparent black stop the colour of the stop before it,
   * then `CAGradientLayer`'s interpolation of each channel on its own.
   */
  function painted(stops: Stop[], at: number): number[] {
    const places = stops.map((stop) =>
      stop.position == null ? null : parseFloat(`${stop.position}`),
    );
    places[0] ??= 0;
    places[places.length - 1] ??= 100;
    for (let i = 1; i < places.length; i++) {
      if (places[i] != null) continue;
      const next = places.findIndex((place, j) => j > i && place != null);
      for (let j = i; j < next; j++) {
        places[j] =
          places[i - 1]! + ((places[next]! - places[i - 1]!) * (j - i + 1)) / (next - i + 1);
      }
    }

    let before: number[] | undefined;
    const colours = stops.map((stop) => {
      const colour = rgba(stop.color);
      if (colour.some((channel) => channel !== 0)) return (before = colour);
      return before ? [before[0]!, before[1]!, before[2]!, 0] : colour;
    });

    let i = 0;
    while (i < places.length - 2 && places[i + 1]! <= at) i++;
    const span = places[i + 1]! - places[i]!;
    const t = span ? Math.min(1, Math.max(0, (at - places[i]!) / span)) : 1;
    return colours[i]!.map((channel, c) => channel + (colours[i + 1]![c]! - channel) * t);
  }

  /** A pixel's colour weighted by its alpha, which is what reaches the screen. */
  const premultiplied = ([r, g, b, a]: number[]) =>
    [r! * a!, g! * a!, b! * a!, a! * 255].map((v) => v / 255);

  for (const [id, pixels] of Object.entries(CHROME)) {
    it(`paints #${id} as Chrome does`, async () => {
      const mod = await compileFixture('fixtures/gradient.ts');
      const { getByTestId } = await render(mod['FadingGradients'] as Type<unknown>, {
        globalStyles: compileCss(':root { --surface: white; --veil: rgb(0 0 0 / 0.1) }', 'global'),
      });
      const [gradient] = getByTestId(id).props['experimental_backgroundImage'] as Linear[];

      for (const [y, ...chrome] of pixels) {
        const ours = premultiplied(painted(gradient!.colorStops, y + 0.5));
        premultiplied(chrome).forEach((channel, c) =>
          assert.ok(
            Math.abs(ours[c]! - channel) <= 3,
            `${y}px down: ${JSON.stringify(gradient!.colorStops)} paints ` +
              `${ours.map(Math.round)}, and Chrome ${premultiplied(chrome).map(Math.round)}`,
          ),
        );
      }
    });
  }

  const stopsOf = async (id: string) => {
    const mod = await compileFixture('fixtures/gradient.ts');
    const { getByTestId } = await render(mod['FadingGradients'] as Type<unknown>);
    return (getByTestId(id).props['experimental_backgroundImage'] as Linear[])[0]!.colorStops;
  };

  it('keeps a stop it cannot place as one stop, in the colour before it', async () => {
    // Halfway between 20 points and 80% depends on the box's size, which only native has.
    assert.deepEqual(await stopsOf('mixed'), [
      { color: 'rgb(255, 0, 0)', position: 20 },
      { color: 'rgba(255, 0, 0, 0)', position: null },
      { color: 'rgb(0, 0, 255)', position: '80%' },
    ]);
    assert.deepEqual(await stopsOf('mixedVeil'), [
      { color: 'rgba(0, 0, 0, 0.1)', position: 20 },
      { color: 'rgb(255, 255, 255)', position: '80%' },
    ]);
  });

  it('adds no stops to a hard edge, which has no run between its two stops', async () => {
    assert.deepEqual(await stopsOf('hard'), [
      { color: 'rgb(255, 0, 0)', position: '50%' },
      { color: 'rgba(0, 0, 255, 0.5)', position: '50%' },
    ]);
  });

  it('adds no stops between two at the same opacity, which native already paints as CSS does', async () => {
    const mod = await compileFixture('fixtures/gradient.ts');
    const { getByTestId } = await render(mod['FadingGradients'] as Type<unknown>);
    const [gradient] = getByTestId('even').props['experimental_backgroundImage'] as Linear[];
    assert.deepEqual(gradient!.colorStops, [
      { color: 'rgba(255, 0, 0, 0.5)', position: null },
      { color: 'rgba(0, 0, 255, 0.5)', position: null },
    ]);
  });
});
