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

function commitInput(setUp: (engine: Engine, input: ReturnType<Engine['createElement']>) => void) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
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
    for (const height of [30, 80, '50%']) {
      const { props } = commitInput((engine, input) => {
        engine.addClass(input, 'field');
        engine.setProp(input, 'style', { height });
      });
      assert.equal(props()['height'], height);
      assert.equal(props()['minHeight'], undefined, `no minHeight beside height ${height}`);
      assert.equal(props()['lineHeight'], undefined);
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
