/**
 * Inheritance across component boundaries.
 *
 * Every node is cascaded against *its own* sheet, and inheritable values are handed down from a
 * parent's already-resolved style. Before this, resolution walked up from each node matching every
 * ancestor against the *node's* sheet, which broke encapsulation in both directions at once: a
 * component's rules reached nodes it did not own, and a parent's real values never arrived.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import {
  cleanup,
  createFakeFabric,
  render,
  type FakeFabric,
  type FakeFabricNode,
  compileCss,
} from '@ng-native/testing';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

after(cleanup);

describe('inheritance across a component boundary', () => {
  let Parent: Type<unknown>;
  let fabric: FakeFabric;

  before(async () => {
    const mod = await compileFixture('fixtures/cross-component.ts');
    Parent = mod['CrossParent'] as Type<unknown>;
  });

  beforeEach(async () => {
    fabric = (await render(Parent)).fabric;
  });

  const textNamed = (label: string) =>
    flatten(fabric.committed).find(
      (n) =>
        n.viewName === 'Paragraph' && flatten(n.children).some((c) => c.props['text'] === label),
    )!;

  it("hands a parent's inherited value down into a child component", () => {
    // The parent's `.wrap` is red, and the child declares no colour on `.label`, so the child's
    // text must be red. It used to be blue: the child's own `.wrap` rule was matched against the
    // parent's `.wrap` node.
    assert.equal(textNamed('child').props['color'], 'rgb(255, 0, 0)');
    assert.equal(textNamed('child').props['fontSize'], 21);
  });

  it("never matches a component's rules against another component's node", () => {
    const wrap = flatten(fabric.committed).find(
      (n) => n.props['fontSize'] === 21 && n.viewName === 'View',
    );
    assert.ok(wrap, 'the parent wrap resolved from the parent sheet');
    assert.equal(wrap!.props['color'], 'rgb(255, 0, 0)', 'and not the child sheet blue');
  });

  it("lets the child's own rule beat what it inherits", () => {
    assert.equal(textNamed('own').props['color'], 'rgb(0, 255, 0)');
  });
});

describe('re-resolving inherited style when only an ancestor changes', () => {
  it('updates a child that is not itself dirty', async () => {
    const mod = await compileFixture('fixtures/inherit-update.ts');
    const { fabric, instance, rerender } = await render(
      mod['InheritUpdate'] as Type<{ dark: { set(v: boolean): void } }>,
    );

    const text = () => flatten(fabric.committed).find((n) => n.viewName === 'Paragraph')!;
    assert.equal(text().props['color'], 'rgb(255, 0, 0)');

    // Only the wrapper's class list changes. The text node's own props are untouched, so nothing
    // marks it dirty, yet what it inherits has changed.
    instance.dark.set(true);
    await rerender();

    assert.equal(text().props['color'], 'rgb(0, 0, 255)');
  });

  it('re-matches a descendant selector when an ancestor class changes', async () => {
    // The harder half of the same problem. `.wrap.dark .deep` changes what a descendant matches
    // while nothing inheritable moves at all, so watching the inherited map is not enough: the
    // invalidation token has to stand for the whole ancestor chain's matchable state.
    const mod = await compileFixture('fixtures/inherit-update.ts');
    const { fabric, instance, rerender } = await render(
      mod['InheritUpdate'] as Type<{ dark: { set(v: boolean): void } }>,
    );

    const deep = () =>
      flatten(fabric.committed).find(
        (n) =>
          n.viewName === 'Paragraph' &&
          flatten(n.children).some((c) => String(c.props['text'] ?? '').startsWith('matched')),
      )!;
    assert.equal(deep().props['letterSpacing'], undefined);

    instance.dark.set(true);
    await rerender();

    assert.equal(deep().props['letterSpacing'], 7);
  });
});

describe('opting out of an inherited line height', () => {
  /**
   * `line-height: normal`, which is the CSS for "the font's own" and has no React Native spelling
   * but the absence of the prop.
   *
   * `leading-none` on a label reaches its children, because line-height is inherited - and a text
   * field that deliberately sets none of its own then wears the label's. On a phone that is text
   * sitting at the top of its box in one place and centred in the identical box next to it, which
   * is a maddening thing to look at and gives no clue where to look.
   */
  function scene(css: string) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as StyleSheet });
    const parent = engine.createElement('view');
    const child = engine.createElement('text');
    engine.appendChild(engine.root, parent);
    engine.appendChild(parent, child);
    return {
      engine,
      parent,
      child,
      classes(node: unknown, value: string) {
        engine.setClasses(node as never, value);
      },
      painted() {
        engine.commit();
        const [outer] = flatten(fabric.committed);
        return { parent: outer!.props, child: outer!.children[0]!.props };
      },
    };
  }

  it('clears the property rather than compiling to nothing', () => {
    const s = scene('.label { line-height: 1; } .field { line-height: normal; }');
    s.classes(s.parent, 'label');
    s.classes(s.child, 'field');
    const { parent, child } = s.painted();
    assert.equal(parent['lineHeight'], 16, 'the label keeps its own');
    // `null`, not absent: clearing a prop is a value native is sent, and it is what beats the
    // value the parent handed down.
    assert.equal(child['lineHeight'], null, 'and the field has none of its own');
  });

  it('is a reset rather than a default, so a silent child still inherits', () => {
    const s = scene('.label { line-height: 1; }');
    s.classes(s.parent, 'label');
    assert.equal(s.painted().child['lineHeight'], 16);
  });
});

describe('a unitless line height a view hands down', () => {
  /**
   * CSS inherits a unitless line-height as the number, and each element multiplies its own font
   * size by it; a percentage or an em is a length where it is written, and that length is what is
   * inherited. The expected values were read from Chrome's `getComputedStyle`.
   */
  function scene(css: string) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as StyleSheet });
    const card = engine.createElement('view');
    const title = engine.createElement('text');
    engine.setClasses(card, 'card');
    engine.setClasses(title, 'title');
    engine.appendChild(engine.root, card);
    engine.appendChild(card, title);
    return {
      engine,
      card,
      title,
      painted() {
        engine.commit();
        const [outer] = flatten(fabric.committed);
        return { card: outer!.props, title: outer!.children[0]!.props };
      },
    };
  }

  const lineHeights = (css: string) => {
    const { card, title } = scene(css).painted();
    return [card['lineHeight'], title['lineHeight']];
  };

  it("multiplies the text's own font size by the number", () => {
    assert.deepEqual(
      lineHeights('.card { font-size: 10px; line-height: 2 } .title { font-size: 20px }'),
      [20, 40],
    );
  });

  it('does the same for the number a font shorthand writes', () => {
    assert.deepEqual(
      lineHeights('.card { font: 10px/2 serif } .title { font-size: 20px }'),
      [20, 40],
    );
  });

  it('does the same for a number held in a custom property', () => {
    assert.deepEqual(
      lineHeights(
        ':root { --leading: 2 } .card { font-size: 10px; line-height: var(--leading) } ' +
          '.title { font-size: 20px }',
      ),
      [20, 40],
    );
  });

  it('takes the number again for line-height: inherit', () => {
    assert.deepEqual(
      lineHeights(
        '.card { font-size: 10px; line-height: 2 } .title { font-size: 20px; line-height: inherit }',
      ),
      [20, 40],
    );
  });

  it('hands down a percentage or an em as the length it came to', () => {
    assert.deepEqual(
      lineHeights('.card { font-size: 10px; line-height: 200% } .title { font-size: 20px }'),
      [20, 20],
    );
    assert.deepEqual(
      lineHeights('.card { font-size: 10px; line-height: 2em } .title { font-size: 20px }'),
      [20, 20],
    );
    assert.deepEqual(
      lineHeights('.card { font: 10px/200% serif } .title { font-size: 20px }'),
      [20, 20],
    );
  });

  it('measures a text with no font size of its own against the one it inherits', () => {
    assert.deepEqual(lineHeights('.card { font-size: 10px; line-height: 2 }'), [20, 20]);
  });

  it('works out the number for loose text, which no rule matches', () => {
    const fabric = createFakeFabric();
    const css = '.card { font-size: 10px; line-height: 2 }';
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as StyleSheet });
    const card = engine.createElement('view');
    engine.setClasses(card, 'card');
    engine.appendChild(engine.root, card);
    engine.appendChild(card, engine.createText('loose'));
    engine.commit();
    const paragraph = flatten(fabric.committed).find((n) => n.viewName === 'Paragraph')!;
    assert.equal(paragraph.props['lineHeight'], 20);
  });

  it('measures against a font size set by inline style', () => {
    const s = scene('.card { font-size: 10px; line-height: 2 }');
    s.engine.setProp(s.title, 'style', { fontSize: 20 });
    assert.equal(s.painted().title['lineHeight'], 40);
  });

  it("follows the text's own font size as it changes and goes away", () => {
    const s = scene(
      '.card { font-size: 10px; line-height: 2 } .title { font-size: 20px } ' +
        '.big { font-size: 30px }',
    );
    assert.equal(s.painted().title['lineHeight'], 40);
    s.engine.setClasses(s.title, 'big');
    assert.equal(s.painted().title['lineHeight'], 60);
    s.engine.setClasses(s.title, '');
    assert.equal(s.painted().title['lineHeight'], 20);
  });

  it("follows the card's line height as it changes and goes away", () => {
    const s = scene(
      '.card { font-size: 10px; line-height: 2 } .title { font-size: 20px } ' +
        '.loose { line-height: 3 } .tall { line-height: 50px }',
    );
    assert.equal(s.painted().title['lineHeight'], 40);
    s.engine.setClasses(s.card, 'card loose');
    assert.equal(s.painted().title['lineHeight'], 60);
    s.engine.setClasses(s.card, 'card tall');
    assert.equal(s.painted().title['lineHeight'], 50);
    s.engine.setClasses(s.card, 'card');
    assert.equal(s.painted().title['lineHeight'], 40);
    s.engine.setClasses(s.card, '');
    assert.equal(s.painted().title['lineHeight'], null, 'cleared');
  });

  it("follows the card's font size where the text has none of its own", () => {
    const s = scene('.card { font-size: 10px; line-height: 2 } .large { font-size: 15px }');
    assert.equal(s.painted().title['lineHeight'], 20);
    s.engine.setClasses(s.card, 'card large');
    assert.equal(s.painted().title['lineHeight'], 30);
  });
});

describe('the text properties a view hands down', () => {
  // CSS inherits these, so `text-shadow-md` or `select-none` on a card reaches every text in it.
  // Native reads them on the text only, and a view that wore them did nothing for its contents.
  function childOf(css: string, classes: string): Record<string, unknown> {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as StyleSheet });
    const parent = engine.createElement('view');
    const child = engine.createElement('text');
    engine.setClasses(parent, classes);
    engine.appendChild(engine.root, parent);
    engine.appendChild(parent, child);
    engine.commit();
    return flatten(fabric.committed)[0]!.children[0]!.props;
  }

  it('hands a text shadow down to the text inside', () => {
    const child = childOf('.glow { text-shadow: 0 1px 2px rgb(0, 0, 0) }', 'glow');
    assert.deepEqual(child['textShadowOffset'], { width: 0, height: 1 });
    assert.equal(child['textShadowRadius'], 2);
    assert.equal(child['textShadowColor'], 'rgb(0, 0, 0)');
  });

  it("hands selectability down, as user-select: auto takes the parent's", () => {
    assert.equal(childOf('.plain { user-select: none }', 'plain')['selectable'], false);
  });
});
