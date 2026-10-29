/**
 * `background: var(--bg)`: the token is read on device as the background colour, the one part of
 * the shorthand native has. A token that is no colour unsets it, as Chrome unsets every longhand
 * of a shorthand whose token cannot be substituted.
 *
 * Chrome's values for the stylesheet path are in the oracle (`css-oracle-cases.ts`); this covers a
 * token set on an element, and one that changes after the first commit.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

/** A parent wearing `parent` around a child wearing `a`, with every warning collected. */
function tree(css: string, parent: string[] = []) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'background', { onUnsupported: (m: string) => warnings.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const outer = engine.createElement('view', sheet);
  for (const name of parent) engine.addClass(outer, name);
  const node = engine.createElement('view', sheet);
  engine.addClass(node, 'a');
  engine.appendChild(outer, node);
  engine.appendChild(engine.root, outer);
  engine.commit();
  const background = () => fabric.committed[0]!.children[0]!.props['backgroundColor'];
  const image = () => fabric.committed[0]!.children[0]!.props['experimental_backgroundImage'];
  return { engine, outer, node, background, image, warnings };
}

describe('background: var()', () => {
  it('compiles with no warning, and reads a token from the stylesheet as the colour', () => {
    const { background, warnings } = tree('.p { --bg: #f00 } .a { background: var(--bg) }', ['p']);
    assert.deepEqual(warnings, []);
    assert.equal(background(), 'rgb(255, 0, 0)');
  });

  it('reads a token set on the element, and follows it when it changes', () => {
    const { engine, node, background } = tree('.a { background: var(--bg, #000) }');
    assert.equal(background(), 'rgb(0, 0, 0)', 'the fallback, until the token is set');
    engine.setCustomProperty(node, '--bg', 'rgb(0, 128, 0)');
    engine.commit();
    assert.equal(background(), 'rgb(0, 128, 0)');
    engine.setCustomProperty(node, '--bg', 'rgb(0, 0, 255)');
    engine.commit();
    assert.equal(background(), 'rgb(0, 0, 255)');
  });

  it('follows a token on the parent when it changes', () => {
    const { engine, outer, background } = tree(
      '.p { --bg: #f00 } .q { --bg: #0f0 } .a { background: var(--bg) }',
      ['p'],
    );
    assert.equal(background(), 'rgb(255, 0, 0)');
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(background(), 'rgb(0, 255, 0)');
  });

  it('unsets the colour for a token that is no colour, over a weaker rule', () => {
    const { engine, node, background } = tree(
      '.a { background-color: #f00 } .a { --bg: 2px; background: var(--bg) }',
    );
    assert.equal(background(), undefined, 'the declaration wins the cascade and is unset');
    engine.setCustomProperty(node, '--bg', 'rgb(0, 0, 255)');
    engine.commit();
    assert.equal(background(), 'rgb(0, 0, 255)');
  });

  it('draws a gradient a token set on the element holds, with the colour under it', () => {
    // A colour slider's track: the library works the gradient out and sets it as a token.
    const { engine, node, background, image } = tree('.a { background: var(--bg) }');
    engine.setCustomProperty(node, '--bg', 'linear-gradient(to right, rgba(255, 0, 0, 1), #00f)');
    engine.commit();
    assert.deepEqual(image(), [
      {
        type: 'linear-gradient',
        direction: { type: 'angle', value: 90 },
        colorStops: [
          { color: 'rgba(255, 0, 0, 1)', position: null },
          { color: 'rgba(0, 0, 255, 1)', position: null },
        ],
      },
    ]);
    assert.equal(background() ?? null, null);
    // A colour area: two gradients over a colour, the first written on top.
    const area =
      'linear-gradient(to top, #000, transparent), linear-gradient(45deg, #fff 10%, transparent 90%), rgb(255, 0, 0)';
    engine.setCustomProperty(node, '--bg', area);
    engine.commit();
    const layers = image() as { direction: unknown; colorStops: { position: unknown }[] }[];
    assert.deepEqual(
      layers.map((layer) => layer.direction),
      [
        { type: 'angle', value: 0 },
        { type: 'angle', value: 45 },
      ],
    );
    assert.deepEqual(
      layers[1]!.colorStops.map((stop) => stop.position),
      ['10%', '90%'],
    );
    assert.equal(background(), 'rgb(255, 0, 0)');
    // A colour again, and then nothing: the gradient goes with the token that held it.
    engine.setCustomProperty(node, '--bg', 'rgb(0, 128, 0)');
    engine.commit();
    assert.equal(image() ?? null, null);
    assert.equal(background(), 'rgb(0, 128, 0)');
  });

  const RED_TO_BLUE = 'linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))';
  const BLUE_TO_GREEN = [
    {
      type: 'linear-gradient',
      direction: { type: 'angle', value: 180 },
      colorStops: [
        { color: 'rgb(0, 0, 255)', position: null },
        { color: 'rgb(0, 128, 0)', position: null },
      ],
    },
  ];
  /** The direction of each gradient committed: 90 for the token's, 180 for a rule's own. */
  const directions = (image: unknown) =>
    ((image ?? []) as { direction: { value: number } }[]).map((layer) => layer.direction.value);

  it('ranks the gradient with the image and its colour with the colour, each on its own', () => {
    // An important colour is no reason to drop the image the shorthand's token holds.
    const colour = tree('.a { background: var(--bg) } .a { background-color: #0f0 !important }');
    colour.engine.setCustomProperty(colour.node, '--bg', `${RED_TO_BLUE}, rgb(255, 0, 0)`);
    colour.engine.commit();
    assert.deepEqual(directions(colour.image()), [90], "the token's gradient is drawn");
    assert.equal(colour.background(), 'rgb(0, 255, 0)', 'under the important colour');

    // An important image stands over the token's.
    const image = tree(
      '.a { background: var(--bg) } .a { background-image: linear-gradient(blue, green) !important }',
    );
    image.engine.setCustomProperty(image.node, '--bg', `${RED_TO_BLUE}, rgb(255, 0, 0)`);
    image.engine.commit();
    assert.deepEqual(image.image(), BLUE_TO_GREEN);
    assert.equal(image.background(), 'rgb(255, 0, 0)', "and the token's colour is still read");
  });

  it('gives way to an image a later rule declares, and stands over an earlier one', () => {
    const later = tree(
      '.a { background: var(--bg) } .a { background-image: linear-gradient(blue, green) }',
    );
    later.engine.setCustomProperty(later.node, '--bg', RED_TO_BLUE);
    later.engine.commit();
    assert.deepEqual(later.image(), BLUE_TO_GREEN, 'the later declaration wins the cascade');

    const earlier = tree(
      '.a { background-image: linear-gradient(blue, green) } .a { background: var(--bg) }',
    );
    earlier.engine.setCustomProperty(earlier.node, '--bg', RED_TO_BLUE);
    earlier.engine.commit();
    assert.deepEqual(directions(earlier.image()), [90]);

    // Important, the shorthand stands over a later image that is not.
    const important = tree(
      '.a { background: var(--bg) !important } .a { background-image: linear-gradient(blue, green) }',
    );
    important.engine.setCustomProperty(important.node, '--bg', RED_TO_BLUE);
    important.engine.commit();
    assert.deepEqual(directions(important.image()), [90]);
  });

  it('draws no image for background-color, whose token holding a gradient is no colour', () => {
    const { engine, node, background, image } = tree('.a { background-color: var(--bg) }');
    engine.setCustomProperty(node, '--bg', RED_TO_BLUE);
    engine.commit();
    assert.equal(image() ?? null, null, 'a colour declaration sets no image');
    assert.equal(background() ?? null, null);
  });

  it('reads the gradient from the token the declaration settles on, the first that is set', () => {
    const { engine, node, image } = tree('.a { background: var(--missing, var(--backup)) }');
    engine.setCustomProperty(node, '--backup', RED_TO_BLUE);
    engine.commit();
    assert.deepEqual(directions(image()), [90]);
  });

  it('reads a gradient written in capitals, as CSS does', () => {
    const { engine, node, image } = tree('.a { background: var(--bg) }');
    engine.setCustomProperty(
      node,
      '--bg',
      'LINEAR-GRADIENT(TO RIGHT, RGB(255, 0, 0), RGB(0, 0, 255))',
    );
    engine.commit();
    assert.deepEqual(directions(image()), [90]);
  });

  it('draws nothing for a gradient native has none of, and none for one it cannot read', () => {
    const { engine, node, background, image } = tree('.a { background: var(--bg) }');
    for (const unread of [
      'conic-gradient(red, blue)',
      'linear-gradient(to right, red)',
      'url(a.png)',
    ]) {
      engine.setCustomProperty(node, '--bg', unread);
      engine.commit();
      assert.equal(image() ?? null, null, unread);
      assert.equal(background() ?? null, null, unread);
    }
  });

  it('leaves the colour unset for a token holding a gradient, which is refused where it is set', () => {
    const { background, warnings } = tree(
      '.a { background-color: #f00 } .a { --bg: linear-gradient(red, blue); background: var(--bg) }',
    );
    assert.equal(background(), undefined, 'no colour to read, so the declaration is unset');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /'--bg' has a value native cannot express/);
  });

  it('reads a color-mix() of a token, worked out on device', () => {
    // Chrome serialises a mixed colour as `color(srgb ...)`, which the oracle compares as text, so
    // the mix is checked here: 50% of rgb(0, 0, 200) and black is rgb(0, 0, 100).
    const { background, warnings } = tree(
      '.a { --bg: rgb(0, 0, 200); background: color-mix(in srgb, var(--bg), rgb(0, 0, 0)) }',
    );
    assert.deepEqual(warnings, []);
    assert.equal(background(), 'rgb(0, 0, 100)');
  });

  it('still refuses the shorthand with anything beside the token', () => {
    const { background, warnings } = tree('.a { background: var(--bg) none }');
    assert.equal(background(), undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /'background' mixes var\(\) with other values/);
  });

  it('reads a relative colour from a token, worked out on device', () => {
    // Chrome 154 gives `color(srgb 0 0 0.784314 / 0.5)`, the same colour, written in a form the
    // oracle cannot compare as text.
    const { background, warnings } = tree(
      '.a { --bg: rgb(0, 0, 200); background: rgb(from var(--bg) r g b / 0.5) }',
    );
    assert.deepEqual(warnings, []);
    assert.equal(background(), 'rgba(0, 0, 200, 0.5)');
  });

  it('lands a platform colour in the background colour, the prop native has', () => {
    const { background, warnings } = tree('.a { background: platform-color(systemBlue) }');
    assert.deepEqual(warnings, []);
    assert.deepEqual(
      background(),
      { semantic: ['systemBlue'] },
      "iOS's form, which the engine makes",
    );
  });

  it('unsets the colour for a token holding a colour and an image, which a browser paints', () => {
    // Chrome 154 paints rgb(1, 2, 3) for `--bg: rgb(1, 2, 3) none`: the token is the whole
    // shorthand there. Here a token is one value, so it is no colour; supported-css says so.
    const { engine, node, background } = tree(
      '.a { background-color: rgb(9, 9, 9) } .a { background: var(--bg) }',
    );
    engine.setCustomProperty(node, '--bg', 'rgb(1, 2, 3) none');
    engine.commit();
    assert.equal(background(), undefined);
  });
});

/** The props a sheet commits to its one `.a` view. */
function committedProps(css: string) {
  const sheet = compileCss(css, 'background', { onUnsupported: () => {} });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const node = engine.createElement('view', sheet);
  engine.addClass(node, 'a');
  engine.appendChild(engine.root, node);
  engine.commit();
  return fabric.committed[0]!.props;
}

describe('background: gradients over a var() colour', () => {
  const SHEEN = 'linear-gradient(180deg, #ffffff33 0%, #ffffff00 67.7%)';

  it('splits into the gradients as the image and the token as the colour', () => {
    const { background, image, warnings } = tree(
      `.p { --primary: #615fff } .a { background: ${SHEEN}, var(--primary) }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(background(), 'rgb(97, 95, 255)');
    assert.deepEqual(
      image(),
      committedProps(`.a { background: ${SHEEN}, #615fff }`)['experimental_backgroundImage'],
    );
    assert.equal((image() as unknown[]).length, 1);
  });

  it('commits what the shorthand with the colour written out commits', () => {
    const layered = `${SHEEN} no-repeat center / 50% 2px, radial-gradient(red, rgb(0 0 0 / .5))`;
    assert.deepEqual(
      committedProps(`.a { --c: #00f; background: ${layered}, var(--c) }`),
      committedProps(`.a { background: ${layered}, #00f }`),
    );
    // A layer of no image is placed as one, as the token's own layer is.
    assert.deepEqual(
      committedProps('.a { --c: #00f; background: none 10px 10px, var(--c) }'),
      committedProps('.a { background: none 10px 10px, #00f }'),
    );
    // Over what a weaker rule set: the shorthand says all of a background.
    const weaker =
      '.a { background-color: #f00; background-image: linear-gradient(blue, green); ' +
      'background-size: 10px 10px; background-repeat: repeat-x } ';
    assert.deepEqual(
      committedProps(`${weaker} .a { --c: #00f; background: ${SHEEN}, var(--c) }`),
      committedProps(`${weaker} .a { background: ${SHEEN}, #00f }`),
    );
  });

  it('follows a token set on the element, and takes the fallback until it is set', () => {
    const { engine, node, background, image } = tree(
      `.a { background: ${SHEEN}, radial-gradient(red, blue), var(--primary, #000) }`,
    );
    assert.equal(background(), 'rgb(0, 0, 0)');
    assert.equal((image() as unknown[]).length, 2, 'both layers');
    engine.setCustomProperty(node, '--primary', 'rgb(0, 128, 0)');
    engine.commit();
    assert.equal(background(), 'rgb(0, 128, 0)');
    engine.setCustomProperty(node, '--primary', null);
    engine.commit();
    assert.equal(background(), 'rgb(0, 0, 0)', 'the fallback again once the token goes');
  });

  it('follows a token on the parent, and unsets the colour when it goes away', () => {
    const { engine, outer, background } = tree(
      `.p { --c: #f00 } .q { --c: #0f0 } .a { background-color: #00f } ` +
        `.a { background: ${SHEEN}, var(--c) }`,
      ['p'],
    );
    assert.equal(background(), 'rgb(255, 0, 0)');
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(background(), 'rgb(0, 255, 0)');
    engine.removeClass(outer, 'q');
    engine.commit();
    assert.equal(background() ?? null, null, 'the declaration wins the cascade and is unset');
  });

  it('gives way to a later background-color in the rule, and stands over an earlier one', () => {
    const later = tree(`.a { --c: #00f; background: ${SHEEN}, var(--c); background-color: #0f0 }`);
    assert.equal(later.background(), 'rgb(0, 255, 0)');
    const earlier = tree(
      `.a { background-color: #0f0; --c: #00f; background: ${SHEEN}, var(--c) }`,
    );
    assert.equal(earlier.background(), 'rgb(0, 0, 255)');
    const important = tree(
      `.a { --c: #00f; background: ${SHEEN}, var(--c) !important } .a { background-color: #0f0 }`,
    );
    assert.equal(important.background(), 'rgb(0, 0, 255)', 'important, over a later rule');
  });

  it('still drops a token anywhere but the whole of the last layer', () => {
    for (const value of [
      'linear-gradient(var(--c), red), #fff',
      'linear-gradient(var(--c), red), var(--c)',
      `var(--c), ${SHEEN}`,
      `${SHEEN}, var(--c) no-repeat`,
      `${SHEEN} no-repeat var(--c), var(--c)`,
      'url(a.png), var(--c)',
    ]) {
      const { background, image, warnings } = tree(`.a { --c: #00f; background: ${value} }`);
      assert.equal(warnings.length, 1, value);
      assert.match(warnings[0]!, /dropped 'background': 'background' mixes var\(\)/, value);
      assert.equal(background(), undefined, value);
      assert.equal(image(), undefined, value);
    }
    // A layer native cannot paint drops the whole declaration, the colour with it.
    const conic = tree('.a { --c: #00f; background: conic-gradient(red, blue), var(--c) }');
    assert.deepEqual(conic.warnings.length, 1);
    assert.match(conic.warnings[0]!, /a conic-gradient has no native equivalent/);
    assert.equal(conic.background(), undefined);
    assert.equal(conic.image(), undefined);
    // The longhand is no shorthand of layers and a colour, and is left as it was.
    const longhand = tree(`.a { --c: #00f; background-image: ${SHEEN}, var(--c) }`);
    assert.equal(longhand.warnings.length, 1);
    assert.match(longhand.warnings[0]!, /dropped 'background-image'/);
  });

  it('leaves a gradient with a token as the last layer to the gradients, as before', () => {
    const { engine, node, image, warnings } = tree(
      `.a { background: ${SHEEN}, linear-gradient(var(--c), red) }`,
    );
    assert.deepEqual(warnings, []);
    engine.setCustomProperty(node, '--c', 'rgb(0, 0, 255)');
    engine.commit();
    assert.equal((image() as unknown[]).length, 2);
  });
});
