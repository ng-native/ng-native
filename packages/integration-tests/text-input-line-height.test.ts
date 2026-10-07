/**
 * A single-line text input with a line height, on iOS.
 *
 * React Native's iOS text field sets `lineHeight` as the paragraph's minimum and maximum line
 * height and, unlike a paragraph, never offsets the baseline to centre the glyphs in it, so they
 * sit at the bottom of a line box taller than the font: 3 to 5pt low in a 44pt field. The engine
 * leaves `lineHeight` out of what such a field commits and keeps the height it gave the field as a
 * `minHeight`, which is how Chrome sizes an input by its line height.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  Engine,
  registerPlatformComponents,
  registerViewName,
  type StyleSheet,
} from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const sheet: StyleSheet = {
  rules: [
    {
      compounds: [{ classes: ['field'] }],
      combinators: [],
      specificity: 10,
      order: 0,
      declarations: {
        fontSize: 16,
        lineHeight: 24,
        paddingTop: 8,
        paddingBottom: 6,
        borderTopWidth: 1,
        borderBottomWidth: 2,
      },
    },
    {
      compounds: [{ classes: ['text-base'] }],
      combinators: [],
      specificity: 10,
      order: 1,
      declarations: { fontSize: 16, lineHeight: 24 },
    },
  ],
};

function commitInput(
  setUp: (engine: Engine, input: ReturnType<Engine['createElement']>) => void,
  fontScale?: number,
) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    conditions: { width: 390, height: 844, colorScheme: 'light', fontScale },
  });
  const input = engine.createElement('text-input', sheet);
  setUp(engine, input);
  engine.appendChild(engine.root, input);
  engine.commit();
  const committed = (nodes: FakeFabricNode[]): FakeFabricNode | undefined =>
    nodes.find((n) => /TextInput$/.test(n.viewName)) ?? committed(nodes.flatMap((n) => n.children));
  return { engine, input, fabric, props: () => committed(fabric.committed)!.props };
}

describe('a single-line text input with a line height', () => {
  afterEach(() => {
    registerPlatformComponents('ios');
    registerViewName('text-input', 'TextInput');
  });

  it('commits no lineHeight on iOS, and keeps its height as a minHeight', () => {
    const { props } = commitInput((engine, input) => engine.addClass(input, 'field'));
    assert.equal(props()['lineHeight'], undefined);
    assert.equal(props()['fontSize'], 16);
    // 24 of line, 8 + 6 of padding, 1 + 2 of border.
    assert.equal(props()['minHeight'], 41);
  });

  it('does the same for a line height set inline, with RN shorthands', () => {
    const { props } = commitInput((engine, input) =>
      engine.setProp(input, 'style', { lineHeight: 20, paddingVertical: 5, borderWidth: 1 }),
    );
    assert.equal(props()['lineHeight'], undefined);
    assert.equal(props()['minHeight'], 32);
  });

  it('does the same for a line height it inherits', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const form = engine.createElement('view', sheet);
    engine.addClass(form, 'text-base');
    const input = engine.createElement('text-input', sheet);
    engine.appendChild(form, input);
    engine.appendChild(engine.root, form);
    engine.commit();
    const field = fabric.find('TextInput')!;
    assert.equal(field.props['lineHeight'], undefined);
    assert.equal(field.props['minHeight'], 24);
  });

  it('keeps an author minHeight that is larger', () => {
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'style', { minHeight: 60 });
    });
    assert.equal(props()['minHeight'], 60);
    assert.equal(props()['lineHeight'], undefined);
  });

  it('reads a minHeight of auto as none of its own, which it is for a field', () => {
    // What a web element starts with, and what `min-height: auto` says: the field is still
    // sized by its line, and its text still centred in it.
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'style', { minHeight: 'auto' });
    });
    assert.equal(props()['lineHeight'], undefined);
    assert.equal(props()['minHeight'], 41);
  });

  it('takes the height a line height larger than the font gives, as Chrome and Android do', () => {
    // `line-height: 40px` on a 16px font, or Tailwind's `leading-10`: 40 + 8 + 8 + 1 + 1.
    const { props } = commitInput((engine, input) =>
      engine.setProp(input, 'style', {
        fontSize: 16,
        lineHeight: 40,
        paddingTop: 8,
        paddingBottom: 8,
        borderTopWidth: 1,
        borderBottomWidth: 1,
      }),
    );
    assert.equal(props()['lineHeight'], undefined);
    assert.equal(props()['minHeight'], 58);
  });

  it('leaves the size to an explicit height, larger or smaller', () => {
    for (const height of [30, 80]) {
      const { props } = commitInput((engine, input) => {
        engine.addClass(input, 'field');
        engine.setProp(input, 'style', { height });
      });
      assert.equal(props()['height'], height);
      assert.equal(props()['minHeight'], undefined, `no minHeight beside height ${height}`);
      assert.equal(props()['lineHeight'], undefined);
    }
  });

  it('leaves a field whose height is a percentage as it was, on both platforms', () => {
    // A percentage of a parent with no definite height is auto, in Yoga as in CSS, and then the
    // line height is what sizes the field. Whether it resolves is known only at layout.
    for (const platform of ['ios', 'android']) {
      registerPlatformComponents(platform);
      const { props } = commitInput((engine, input) => {
        engine.addClass(input, 'field');
        engine.setProp(input, 'style', { height: '50%' });
      });
      assert.equal(props()['lineHeight'], 24, platform);
      assert.equal(props()['minHeight'], undefined, platform);
    }
  });

  it('reads a null height as no height, as React Native does', () => {
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'style', { height: null });
    });
    assert.equal(props()['lineHeight'], undefined);
    assert.equal(props()['minHeight'], 41);
  });

  it('keeps the line alone as the minHeight of a content-box field', () => {
    // Yoga adds a content-box field's padding and border to its minHeight itself.
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'style', { boxSizing: 'content-box' });
    });
    assert.equal(props()['lineHeight'], undefined);
    assert.equal(props()['minHeight'], 24);
  });

  it('keeps the line box within a maxHeight', () => {
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'style', { maxHeight: 30 });
    });
    assert.equal(props()['minHeight'], 30);
  });

  it('leaves a field whose padding is a percentage as it was', () => {
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'style', { paddingTop: '10%' });
    });
    assert.equal(props()['lineHeight'], 24);
    assert.equal(props()['minHeight'], undefined);
  });

  it('keeps lineHeight in a multiline field, where it spaces the lines', () => {
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'multiline', true);
    });
    assert.equal(props()['lineHeight'], 24);
    assert.equal(props()['minHeight'], undefined);
  });

  it('commits lineHeight again when a field turns multiline, and not when it turns back', () => {
    const { engine, input, props } = commitInput((engine, input) =>
      engine.addClass(input, 'field'),
    );
    engine.setProp(input, 'multiline', true);
    engine.commit();
    assert.equal(props()['lineHeight'], 24);
    assert.equal(props()['minHeight'], null, 'reset on native');

    engine.setProp(input, 'multiline', false);
    engine.commit();
    assert.equal(props()['lineHeight'], null, 'reset on native');
    assert.equal(props()['minHeight'], 41);
  });

  it('keeps lineHeight on Android, which sizes and centres the field by it', () => {
    registerPlatformComponents('android');
    const { props } = commitInput((engine, input) => engine.addClass(input, 'field'));
    assert.equal(props()['lineHeight'], 24);
    assert.equal(props()['minHeight'], undefined);
  });

  it('leaves lineHeight out on Android where a height sizes the field', () => {
    // EditText centres its line box, and a line box taller than the font's own sits 1.7pt high
    // in a 44pt field; the height already says how tall the field is.
    registerPlatformComponents('android');
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'style', { height: 44 });
    });
    assert.equal(props()['lineHeight'], undefined);
    assert.equal(props()['minHeight'], undefined);
    assert.equal(props()['height'], 44);
  });

  it('keeps lineHeight in a multiline Android field with a height', () => {
    registerPlatformComponents('android');
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'style', { height: 120 });
      engine.setProp(input, 'multiline', true);
    });
    assert.equal(props()['lineHeight'], 24);
  });
});

/**
 * The system text size. React Native scales an iOS field's `lineHeight` by it natively
 * (`RCTEffectiveFontSizeMultiplierFromTextAttributes`), so the line box kept as a `minHeight` is
 * scaled the same way: capped by `maxFontSizeMultiplier`, and not at all without font scaling.
 */
describe('a single-line iOS text input with a line height, at a larger text size', () => {
  // 24 of line, scaled, and 17 of padding and border, which are not.
  it('scales the line box by the text size', () => {
    const { props } = commitInput((engine, input) => engine.addClass(input, 'field'), 1.5);
    assert.equal(props()['minHeight'], 24 * 1.5 + 17);
  });

  it('caps the scale at maxFontSizeMultiplier', () => {
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'maxFontSizeMultiplier', 1.25);
    }, 2);
    assert.equal(props()['minHeight'], 24 * 1.25 + 17);
  });

  it('does not scale when font scaling is off', () => {
    const { props } = commitInput((engine, input) => {
      engine.addClass(input, 'field');
      engine.setProp(input, 'allowFontScaling', false);
    }, 2);
    assert.equal(props()['minHeight'], 41);
  });

  it('does not scale when no text size is known', () => {
    const { props } = commitInput((engine, input) => engine.addClass(input, 'field'));
    assert.equal(props()['minHeight'], 41);
  });

  it('follows a text size change', () => {
    const { engine, props } = commitInput((engine, input) => engine.addClass(input, 'field'), 1);
    assert.equal(props()['minHeight'], 41);
    engine.updateConditions({ width: 390, height: 844, colorScheme: 'light', fontScale: 2 });
    engine.remeasureText();
    assert.equal(props()['minHeight'], 24 * 2 + 17);
  });
});

describe('a single-line iOS text input in a row aligned by baseline', () => {
  // A form field: a prefix, the field in a box of its own, and a suffix, in a row aligned by
  // baseline. With its line height left out the field says its baseline is the font's own,
  // higher than that of a paragraph in a line as tall, and the row lifts the paragraphs beside it
  // to match. Half the room the line has over the font is kept as padding over and under the
  // text, which puts the baseline where a paragraph's is and leaves the field as tall.
  function inRow(rowStyle: Record<string, unknown>, fieldStyle: Record<string, unknown> = {}) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      conditions: { width: 390, height: 844, colorScheme: 'light' },
    });
    const row = engine.createElement('view');
    engine.setProp(row, 'style', { flexDirection: 'row', ...rowStyle });
    const infix = engine.createElement('view');
    const input = engine.createElement('text-input', sheet);
    engine.addClass(input, 'field');
    engine.setProp(input, 'style', fieldStyle);
    engine.appendChild(infix, input);
    engine.appendChild(row, infix);
    engine.appendChild(engine.root, row);
    engine.commit();
    const props = () => fabric.committed[0]!.children[0]!.children[0]!.props;
    return { engine, row, props, fabric };
  }
  // A line of 24 over a font of 16, which is 19.04 tall: 2.48 over and under.
  const HALF = (24 - 16 * 1.19) / 2;
  const near = (value: unknown, expected: number) =>
    assert.ok(
      Math.abs((value as number) - expected) < 0.001,
      `${String(value)} is not ${expected}`,
    );

  it('keeps half the room over the font as padding over and under its text', () => {
    const { props } = inRow({ alignItems: 'baseline' });
    assert.equal(props()['lineHeight'], undefined);
    near(props()['paddingTop'], 8 + HALF);
    near(props()['paddingBottom'], 6 + HALF);
    assert.equal(props()['minHeight'], 41, 'and is as tall as it was');
  });

  it('is as tall as its line where its height is its content', () => {
    const { props } = inRow({ alignItems: 'baseline' }, { boxSizing: 'content-box' });
    near(props()['minHeight'], 24 - 2 * HALF);
    near(props()['paddingTop'], 8 + HALF);
  });

  it('is left as it is in a row aligned any other way', () => {
    const { props } = inRow({ alignItems: 'center' });
    assert.equal(props()['paddingTop'], 8);
    assert.equal(props()['minHeight'], 41);
  });

  it('does the same in a field a height sizes, which stays that height', () => {
    // Forty-four tall with 8 and 6 of padding and 1 and 2 of border: 27 for the text, of
    // which the font takes 19.04, so 3.98 over and under.
    const half = (44 - 8 - 6 - 1 - 2 - 16 * 1.19) / 2;
    const { props } = inRow({ alignItems: 'baseline' }, { height: 44 });
    near(props()['paddingTop'], 8 + half);
    near(props()['paddingBottom'], 6 + half);
    assert.equal(props()['height'], 44);
    // Its content alone is the height of a content-box field, less what is now padding.
    const content = inRow({ alignItems: 'baseline' }, { height: 44, boxSizing: 'content-box' });
    const inner = (44 - 16 * 1.19) / 2;
    near(content.props()['paddingTop'], 8 + inner);
    near(content.props()['height'], 44 - 2 * inner);
    assert.equal(inRow({ alignItems: 'center' }, { height: 44 }).props()['paddingTop'], 8);
  });

  it('is left as it was once its box is moved to a row aligned another way', () => {
    const { engine, row, fabric } = inRow({ alignItems: 'baseline' });
    const other = engine.createElement('view');
    engine.setProp(other, 'style', { flexDirection: 'row', alignItems: 'center' });
    engine.appendChild(engine.root, other);
    const infix = row.children[0]!;
    engine.removeChild(row, infix);
    engine.appendChild(other, infix);
    engine.commit();
    const moved = fabric.committed[1]!.children[0]!.children[0]!.props;
    assert.equal(moved['paddingTop'], 8);
  });

  it('is left as it was once its box is moved out and the row it was in is taken away', () => {
    // The row is not there to be committed again and say so: the field is asked.
    const { engine, row, fabric } = inRow({ alignItems: 'baseline' });
    const other = engine.createElement('view');
    engine.setProp(other, 'style', { flexDirection: 'row', alignItems: 'center' });
    engine.appendChild(engine.root, other);
    const infix = row.children[0]!;
    engine.removeChild(row, infix);
    engine.appendChild(other, infix);
    engine.removeChild(engine.root, row);
    engine.commit();
    const moved = fabric.committed[0]!.children[0]!.children[0]!.props;
    assert.equal(moved['paddingTop'], 8);
  });

  it('is left as it is where it is placed out of the row, which takes no baseline from it', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      conditions: { width: 390, height: 844, colorScheme: 'light' },
    });
    const row = engine.createElement('view');
    engine.setProp(row, 'style', { flexDirection: 'row', alignItems: 'baseline' });
    const input = engine.createElement('text-input', sheet);
    engine.addClass(input, 'field');
    engine.setProp(input, 'style', { position: 'absolute' });
    engine.appendChild(row, input);
    engine.appendChild(engine.root, row);
    engine.commit();
    assert.equal(fabric.committed[0]!.children[0]!.props['paddingTop'], 8);
  });

  it('follows the row coming to be aligned by baseline, and no longer', () => {
    const { engine, row, props } = inRow({ alignItems: 'center' });
    engine.setProp(row, 'style', { flexDirection: 'row', alignItems: 'baseline' });
    engine.commit();
    near(props()['paddingTop'], 8 + HALF);
    engine.setProp(row, 'style', { flexDirection: 'row', alignItems: 'center' });
    engine.commit();
    assert.equal(props()['paddingTop'], 8);
  });
});
