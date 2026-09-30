/**
 * Picking the declared face a text's weight and style ask for.
 *
 * Native finds a family by name and nothing else, so `font-family: Inter; font-weight: 600` draws
 * the regular file made bold. `loadFonts()` registers each declared face under its own name
 * (`Inter-600`, `Inter-italic`, `Inter-600-italic`), and the engine, once a node's style is
 * resolved, points its family at the face CSS's matching rules would pick. It happens after the
 * cascade because family and weight often come from different rules, or from an ancestor.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, onFontsRegistered, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';
import { FontRegistry, registrationsFor } from '@ng-native/expo/fonts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(css: string, context: string): StyleSheet;
};

/** `@font-face` rules for Inter, one per `[weight, style]`, each a file of its own. */
const faces = (...declared: [weight?: number, style?: string][]) =>
  declared
    .map(
      ([weight, style], i) =>
        `@font-face { font-family: Inter; src: url('./Inter-${i}.ttf');` +
        (weight ? ` font-weight: ${weight};` : '') +
        (style ? ` font-style: ${style};` : '') +
        ' }',
    )
    .join('\n');

/** The props a text of the given classes commits with, under a sheet of `css`. */
function text(css: string, classes: string, inline?: Record<string, unknown>) {
  const fabric = createFakeFabric();
  const sheet = compileCss(css, 'fonts');
  const engine = new Engine(fabric, 1);
  const node = engine.createElement('text', sheet);
  engine.setClasses(node, classes);
  if (inline) engine.setProp(node, 'style', inline);
  engine.appendChild(node, engine.createText('Aa'));
  engine.appendChild(engine.root, node);
  engine.commit();
  return fabric.committed[0]!.props;
}

const familyOf = (css: string, classes: string) => text(css, classes)['fontFamily'];

describe('matching a weight to a declared face', () => {
  it("draws a rule's weight with the face declared for it", () => {
    const css = `${faces([], [600])} .title { font: 600 20px/1.5 Inter }`;
    assert.equal(familyOf(css, 'title'), 'Inter-600');
  });

  it('matches a family and a weight set by different rules', () => {
    // `class="font-sans font-semibold"`: nothing at build time sees the two together.
    const css = `${faces([], [600])} .sans { font-family: Inter } .semibold { font-weight: 600 }`;
    assert.equal(familyOf(css, 'sans semibold'), 'Inter-600');
  });

  it('matches a weight inherited from an ancestor', () => {
    const fabric = createFakeFabric();
    const sheet = compileCss(
      `${faces([], [700])} .card { font-family: Inter; font-weight: bold }`,
      'fonts',
    );
    const engine = new Engine(fabric, 1);
    const card = engine.createElement('view', sheet);
    engine.setClasses(card, 'card');
    const label = engine.createElement('text', sheet);
    engine.appendChild(label, engine.createText('Aa'));
    engine.appendChild(card, label);
    engine.appendChild(engine.root, card);
    engine.commit();
    const paragraph = fabric.committed[0]!.children[0]!;
    assert.equal(paragraph.props['fontFamily'], 'Inter-700');
  });

  it('matches a weight a custom property sets at runtime', () => {
    const fabric = createFakeFabric();
    const sheet = compileCss(
      `${faces([], [600])} .a { font-family: Inter; font-weight: var(--w, 400) }`,
      'fonts',
    );
    const engine = new Engine(fabric, 1);
    const node = engine.createElement('text', sheet);
    engine.setClasses(node, 'a');
    engine.setCustomProperty(node, '--w', 600);
    engine.appendChild(node, engine.createText('Aa'));
    engine.appendChild(engine.root, node);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['fontFamily'], 'Inter-600');
  });

  it('matches an inline style too', () => {
    const props = text(faces([], [700]), '', { fontFamily: 'Inter', fontWeight: '700' });
    assert.equal(props['fontFamily'], 'Inter-700');
  });

  it('finds a face another sheet declared', () => {
    // Faces in the global sheet, the rule in a component's: `@font-face` is global, as on the web.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(faces([], [600]), 'global'),
    });
    const node = engine.createElement(
      'text',
      compileCss('.a { font-family: Inter; font-weight: 600 }', 'component'),
    );
    engine.setClasses(node, 'a');
    engine.appendChild(node, engine.createText('Aa'));
    engine.appendChild(engine.root, node);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['fontFamily'], 'Inter-600');
  });

  it('commits the face without the weight and style it was picked for', () => {
    // Kept beside a face's own name, Android gives up on the custom face and draws Roboto bold or
    // italic instead; iOS draws the face either way. Checked on both, screenshots in the PR.
    const props = text(
      `${faces([], [700, 'italic'])} .a { font-family: Inter; font-weight: 700; font-style: italic }`,
      'a',
    );
    assert.equal(props['fontFamily'], 'Inter-700-italic');
    assert.equal(props['fontWeight'], undefined);
    assert.equal(props['fontStyle'], undefined);
  });

  it('leaves the regular face under the family it was declared as', () => {
    const css = `${faces([], [600])} .a { font-family: Inter }`;
    assert.equal(familyOf(css, 'a'), 'Inter');
  });

  it('leaves a family with one face, and a family nothing declared, as written', () => {
    assert.equal(
      familyOf(`${faces([])} .a { font-family: Inter; font-weight: 700 }`, 'a'),
      'Inter',
    );
    const props = text(faces([], [700]), '', { fontFamily: 'Menlo', fontWeight: '700' });
    assert.equal(props['fontFamily'], 'Menlo');
    assert.equal(props['fontWeight'], '700', 'the platform makes it bold, as before');
  });

  it('matches a family whatever its case, as CSS does', () => {
    const css = `${faces([], [700])} .a { font-family: inter; font-weight: 700 } .b { font-family: INTER }`;
    assert.equal(familyOf(css, 'a'), 'Inter-700');
    assert.equal(familyOf(css, 'b'), 'Inter', 'the name the regular face is registered under');
    const props = text(faces([], [700]), '', { fontFamily: 'inter', fontWeight: '700' });
    assert.equal(props['fontFamily'], 'Inter-700');
  });

  it("leaves a face's own name alone", () => {
    // `Inter-700` is a registered name, not a declared family, so nothing matches against it.
    const props = text(faces([], [700]), '', { fontFamily: 'Inter-700' });
    assert.equal(props['fontFamily'], 'Inter-700');
  });
});

describe("CSS's nearest-weight rules", () => {
  const nearest = (declared: number[], wanted: number) =>
    familyOf(
      `${faces(...declared.map((w): [number] => [w]))} .a { font-family: Inter; font-weight: ${wanted} }`,
      'a',
    );

  it('looks up to 500 first for a weight of 400 to 500, then down, then up', () => {
    assert.equal(nearest([300, 500, 700], 400), 'Inter-500');
    assert.equal(nearest([300, 600], 400), 'Inter-300');
    assert.equal(nearest([600, 700], 500), 'Inter-600');
    assert.equal(nearest([400, 500], 500), 'Inter-500');
  });

  it('looks down first for a weight under 400, then up', () => {
    assert.equal(nearest([100, 400], 300), 'Inter-100');
    assert.equal(nearest([200, 300, 400], 300), 'Inter-300');
    assert.equal(nearest([400, 700], 300), 'Inter-400');
  });

  it('takes the weight itself first under 400, over a fractionally heavier face', () => {
    assert.equal(nearest([300, 300.5], 300), 'Inter-300');
  });

  it('looks up first for a weight over 500, then down', () => {
    assert.equal(nearest([400, 800], 600), 'Inter-800');
    assert.equal(nearest([400, 500], 700), 'Inter-500');
    assert.equal(nearest([300, 600, 900], 700), 'Inter-900');
  });

  it('reads a face with no weight as 400, and normal and bold as 400 and 700', () => {
    const css = `${faces([], [700])} .a { font-family: Inter; font-weight: normal }`;
    assert.equal(familyOf(css, 'a'), 'Inter');
    assert.equal(
      familyOf(`${faces([], [700])} .a { font-family: Inter; font-weight: bold }`, 'a'),
      'Inter-700',
    );
  });
});

describe('matching a style', () => {
  const all = faces([], [700], [undefined, 'italic'], [700, 'italic']);

  it('picks the italic face, and the bold italic one', () => {
    assert.equal(
      familyOf(`${all} .a { font-family: Inter; font-style: italic }`, 'a'),
      'Inter-italic',
    );
    assert.equal(
      familyOf(`${all} .a { font-family: Inter; font-style: italic; font-weight: 700 }`, 'a'),
      'Inter-700-italic',
    );
    assert.equal(familyOf(`${all} .a { font-family: Inter; font-weight: 700 }`, 'a'), 'Inter-700');
  });

  it('settles the style before the weight, as CSS does', () => {
    // No bold italic: an italic text keeps its italic face rather than going upright to be bold.
    const css = `${faces([], [700], [undefined, 'italic'])} .a { font-family: Inter; font-style: italic; font-weight: 700 }`;
    assert.equal(familyOf(css, 'a'), 'Inter-italic');
  });

  it('falls back to the upright faces when nothing italic is declared', () => {
    const css = `${faces([], [700])} .a { font-family: Inter; font-style: italic; font-weight: 700 }`;
    assert.equal(familyOf(css, 'a'), 'Inter-700');
  });
});

describe('the names a face is registered under', () => {
  it('names a face with a weight and a style by both, leaving each name that already worked', () => {
    assert.deepEqual(
      registrationsFor([
        { family: 'Inter', source: 1 },
        { family: 'Inter', source: 2, weight: 600 },
        { family: 'Inter', source: 3, style: 'italic' },
        { family: 'Inter', source: 4, weight: 600, style: 'italic' },
      ]),
      { Inter: 1, 'Inter-600': 2, 'Inter-italic': 3, 'Inter-600-italic': 4 },
    );
  });

  it('keeps the single-part names for a bold italic face declared on its own', () => {
    assert.deepEqual(
      registrationsFor([{ family: 'Inter', source: 4, weight: 600, style: 'italic' }]),
      { Inter: 4, 'Inter-600': 4, 'Inter-italic': 4, 'Inter-600-italic': 4 },
    );
  });
});

describe('a matched face registering after its text was laid out', () => {
  it('lays out again the text a face was matched for, by the name the face registers under', async () => {
    // The text asked for Inter at 700 and was committed as Inter-700; loading the sheet
    // registers Inter-700, and that is the name the late relayout has to find it by.
    const fabric = createFakeFabric();
    const sheet = compileCss(
      `${faces([], [700])} .bold { font-family: Inter; font-weight: 700 }`,
      'fonts',
    );
    const engine = new Engine(fabric, 1);
    const stop = onFontsRegistered((families) => engine.fontsRegistered(families));
    try {
      const node = engine.createElement('text', sheet);
      engine.setClasses(node, 'bold');
      engine.appendChild(node, engine.createText('Aa'));
      engine.appendChild(engine.root, node);
      engine.commit();
      assert.equal(fabric.committed[0]!.props['fontFamily'], 'Inter-700');
      assert.equal(fabric.committed[0]!.props['maxFontSizeMultiplier'], undefined);

      const registered = new Set<string>();
      await new FontRegistry({
        loadAsync: async (map) => {
          for (const family of Object.keys(map)) registered.add(family);
        },
        isLoaded: (family) => registered.has(family),
        getLoadedFonts: () => [...registered],
      }).loadSheet(sheet);

      const paragraph = fabric.committed[0]!;
      assert.equal(paragraph.props['fontFamily'], 'Inter-700');
      assert.ok((paragraph.props['maxFontSizeMultiplier'] as number) >= 1000, 'laid out again');
    } finally {
      stop();
    }
  });
});
