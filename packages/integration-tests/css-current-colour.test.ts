/**
 * `currentColor` beyond a border's own: an outline, a background, a `var()` that falls back to it
 * or a token that holds it. Each is the element's text colour, own or inherited, where it is used.
 *
 * Chrome's values for the same stylesheets are in the oracle (`css-oracle-cases.ts`); this covers
 * what the oracle cannot: a colour that changes after the first commit, and a token set on an
 * element rather than in a stylesheet.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';
const GREY = 'rgb(9, 9, 9)';
const SIDES = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'];

/** A parent wearing `parent` around a child wearing `a`, with every warning collected. */
function tree(css: string, parent: string[] = []) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'current', { onUnsupported: (m: string) => warnings.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const outer = engine.createElement('view', sheet);
  for (const name of parent) engine.addClass(outer, name);
  const node = engine.createElement('view', sheet);
  engine.addClass(node, 'a');
  engine.appendChild(outer, node);
  engine.appendChild(engine.root, outer);
  engine.commit();
  const props = () => fabric.committed[0]!.children[0]!.props;
  return { engine, outer, node, props, warnings };
}

const colours = (props: Record<string, unknown>) => SIDES.map((side) => props[side]);

describe('an outline in currentColor', () => {
  it('is drawn in the colour of the text when it has no colour, with no warning', () => {
    const { props, warnings } = tree(`.a { color: ${RED}; outline: 2px solid }`);
    assert.deepEqual(warnings, []);
    assert.equal(props()['outlineColor'], RED);
    assert.equal(props()['outlineWidth'], 2);
    assert.equal(props()['outlineStyle'], 'solid');
  });

  it('takes outline-color: currentColor as the colour the element inherits', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { outline-style: solid; outline-color: currentColor }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['outlineColor'], RED);
  });

  it('takes currentColor written beside a token', () => {
    const { props, warnings } = tree(
      `.a { color: ${RED}; --w: 2px; outline: var(--w) solid currentColor }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['outlineColor'], RED);
    assert.equal(props()['outlineWidth'], 2);
  });

  it('follows the colour when it changes', () => {
    const { engine, outer, props } = tree(
      `.p { color: ${RED} } .q { color: ${BLUE} } .a { outline: 2px solid }`,
      ['p'],
    );
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(props()['outlineColor'], BLUE);
  });
});

describe('a background in currentColor', () => {
  it('is the colour of the text, with no warning', () => {
    const { props, warnings } = tree(`.a { color: ${RED}; background-color: currentColor }`);
    assert.deepEqual(warnings, []);
    assert.equal(props()['backgroundColor'], RED);
  });

  it('is the colour the element inherits, from the shorthand too', () => {
    const { props, warnings } = tree(`.p { color: ${RED} } .a { background: currentColor }`, ['p']);
    assert.deepEqual(warnings, []);
    assert.equal(props()['backgroundColor'], RED);
  });

  it('follows its own colour when that changes', () => {
    const { engine, node, props } = tree(
      `.a { color: ${RED}; background-color: currentColor } .b { color: ${BLUE} }`,
    );
    engine.addClass(node, 'b');
    engine.commit();
    assert.equal(props()['backgroundColor'], BLUE);
  });
});

describe('a var() that is currentColor', () => {
  it('falls back to the colour of the text, in a stylesheet', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { background-color: var(--c, currentColor); ` +
        'outline: 2px solid; outline-color: var(--c, currentColor); ' +
        'border: 2px solid; border-color: var(--c, currentColor) }',
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['backgroundColor'], RED);
    assert.equal(props()['outlineColor'], RED);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
  });

  it('takes the token when one is set on the element instead of falling back', () => {
    const { engine, node, props } = tree(
      `.a { color: ${RED}; background-color: var(--c, currentColor) }`,
    );
    engine.setCustomProperty(node, '--c', BLUE);
    engine.commit();
    assert.equal(props()['backgroundColor'], BLUE);
  });

  it('is the colour of the text where the token is used, not where it is set', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED}; --c: currentColor } .a { color: ${BLUE}; ` +
        `background-color: var(--c); border: 2px solid ${GREY}; border-color: var(--c) }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['backgroundColor'], BLUE);
    assert.deepEqual(colours(props()), [BLUE, BLUE, BLUE, BLUE]);
  });

  it('is the colour of the text when the token is set on the element', () => {
    const { engine, node, props } = tree(
      `.a { color: ${RED}; background-color: var(--c, ${GREY}); outline: 2px solid var(--c) }`,
    );
    engine.setCustomProperty(node, '--c', 'currentColor');
    engine.commit();
    assert.equal(props()['backgroundColor'], RED);
    assert.equal(props()['outlineColor'], RED);
  });

  it('is the inherited colour on color itself, as CSS reads currentColor there', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { color: ${BLUE} } .p .a { color: var(--c, currentColor) }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['color'], RED);
  });

  it('draws a line whose colour token is currentColor in the colour of the text', () => {
    const { props, warnings } = tree(
      `.p { --c: currentColor } .a { color: ${RED}; border: 2px solid var(--c) }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(colours(props()), [RED, RED, RED, RED]);
    assert.equal(props()['borderTopWidth'], 2);
  });
});

describe('color: currentColor', () => {
  it('is the colour the element inherits, over its own, with no warning', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { color: ${BLUE} } .p .a { color: currentColor }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['color'], RED);
  });

  it('follows the inherited colour when it changes, and passes it on', () => {
    const warnings: string[] = [];
    const sheet = compileCss(
      `.p { color: ${RED} } .q { color: ${BLUE} } .a { color: ${GREY}; color: currentColor }`,
      'current',
      { onUnsupported: (m: string) => warnings.push(m) },
    );
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const outer = engine.createElement('view', sheet);
    engine.addClass(outer, 'p');
    const node = engine.createElement('view', sheet);
    engine.addClass(node, 'a');
    const label = engine.createElement('text', sheet);
    engine.appendChild(node, label);
    engine.appendChild(outer, node);
    engine.appendChild(engine.root, outer);
    engine.commit();
    const text = () => fabric.committed[0]!.children[0]!.children[0]!.props['color'];
    assert.deepEqual(warnings, []);
    assert.equal(text(), RED);
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(text(), BLUE);
  });

  it('is the inherited colour through a token set on the element', () => {
    const { engine, node, props } = tree(
      `.p { color: ${RED} } .a { color: ${BLUE}; color: var(--c) }`,
      ['p'],
    );
    engine.setCustomProperty(node, '--c', 'currentColor');
    engine.commit();
    assert.equal(props()['color'], RED);
  });
});

describe('color: inherit', () => {
  it('is the colour the element inherits, over its own, with no warning', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { color: ${BLUE} } .p .a { color: inherit }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['color'], RED);
  });

  it('is the same as unset, since color is inherited', () => {
    const { props, warnings } = tree(`.p { color: ${RED} } .a { color: ${BLUE}; color: unset }`, [
      'p',
    ]);
    assert.deepEqual(warnings, []);
    assert.equal(props()['color'], RED);
  });

  it('follows the inherited colour when it changes', () => {
    const { engine, outer, props } = tree(
      `.p { color: ${RED} } .q { color: ${BLUE} } .a { color: ${GREY}; color: inherit }`,
      ['p'],
    );
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(props()['color'], BLUE);
  });

  it("is the parent's token, not its colour, for a token of inherit set on the element", () => {
    const { engine, node, props } = tree(
      `.p { color: ${GREY}; --c: ${RED} } .a { color: ${BLUE}; color: var(--c) }`,
      ['p'],
    );
    engine.setCustomProperty(node, '--c', 'inherit');
    engine.commit();
    assert.equal(props()['color'], RED);
  });
});

describe('text-decoration-color: currentColor', () => {
  it('is the colour of the text, over a weaker rule, with no warning', () => {
    const { props, warnings } = tree(
      `.a { text-decoration-color: ${GREY} } .p .a { color: ${RED}; ` +
        'text-decoration-line: underline; text-decoration-color: currentColor }',
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['textDecorationColor'], RED);
  });

  it('is the colour the element inherits, and follows it when it changes', () => {
    const { engine, outer, props } = tree(
      `.p { color: ${RED} } .q { color: ${BLUE} } .a { text-decoration-color: currentColor }`,
      ['p'],
    );
    assert.equal(props()['textDecorationColor'], RED);
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(props()['textDecorationColor'], BLUE);
  });

  it('is the colour color: inherit gives the element, whichever is written first', () => {
    const { props, warnings } = tree(
      `.p { color: ${RED} } .a { text-decoration-color: currentColor; color: ${BLUE}; color: inherit }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['textDecorationColor'], RED);
  });

  it('is the colour of the text through a token set on the element', () => {
    const { engine, node, props } = tree(
      `.a { color: ${RED}; text-decoration-color: var(--c, ${GREY}) }`,
    );
    engine.setCustomProperty(node, '--c', 'currentColor');
    engine.commit();
    assert.equal(props()['textDecorationColor'], RED);
  });
});

/**
 * `color: currentColor` in a frame, which is the colour the element inherits, as `color: inherit`
 * is. Chrome's values for these stylesheets, under a parent of rgb(10, 20, 30) that turns
 * rgb(200, 100, 0): rgb(10, 20, 30) at the start, rgb(60, 70, 80) half way, and rgb(155, 110, 65)
 * half way once the parent's colour has changed.
 */
describe('color: currentColor in a keyframe', () => {
  const css = (from: string) => `
    .p { color: rgb(10, 20, 30) }
    .q { color: rgb(200, 100, 0) }
    @keyframes k { from { color: ${from} } to { color: rgb(110, 120, 130) } }
    .a { color: ${GREY}; animation: k 1s linear paused }
    .half { animation-delay: -0.5s }
    .run { animation-play-state: running }
  `;

  function scene(from: string, classes: string[] = []) {
    let now = 1000;
    const warnings: string[] = [];
    const sheet = compileCss(css(from), 'frames', {
      onUnsupported: (m: string) => warnings.push(m),
    });
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { now: () => now });
    const outer = engine.createElement('view', sheet);
    engine.addClass(outer, 'p');
    const node = engine.createElement('text', sheet);
    for (const name of ['a', ...classes]) engine.addClass(node, name);
    engine.appendChild(outer, node);
    engine.appendChild(engine.root, outer);
    engine.commit();
    const recolour = () => {
      engine.removeClass(outer, 'p');
      engine.addClass(outer, 'q');
      engine.commit();
    };
    return {
      warnings,
      recolour,
      painted: () => fabric.committed[0]!.children[0]!.props['color'],
      tick(ms: number) {
        now += ms;
        engine.advanceAnimations();
        engine.commit();
      },
    };
  }

  it('starts at the colour the element inherits, with no warning', () => {
    const s = scene('currentColor');
    assert.deepEqual(s.warnings, []);
    assert.equal(s.painted(), 'rgba(10, 20, 30, 1)');
  });

  it('runs from the inherited colour to the frame it meets', () => {
    assert.equal(scene('currentColor', ['half']).painted(), 'rgba(60, 70, 80, 1)');
  });

  it('follows the inherited colour when it changes while paused', () => {
    const s = scene('currentColor', ['half']);
    s.recolour();
    assert.equal(s.painted(), 'rgba(155, 110, 65, 1)');
  });

  it('follows it while it runs as well', () => {
    const s = scene('currentColor', ['run']);
    s.tick(500);
    assert.equal(s.painted(), 'rgba(60, 70, 80, 1)');
    s.recolour();
    assert.equal(s.painted(), 'rgba(155, 110, 65, 1)');
  });

  it('reads color: inherit in a frame the same way', () => {
    const s = scene('inherit', ['half']);
    assert.deepEqual(s.warnings, []);
    assert.equal(s.painted(), 'rgba(60, 70, 80, 1)');
  });

  it('follows it in an animation a scroll plays, which holds its first frame', () => {
    const sheet = compileCss(
      `${css('currentColor')} .a { animation: k 1s linear; animation-timeline: scroll() }`,
    );
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const scroll = engine.createElement('scroll-view', sheet);
    const outer = engine.createElement('view', sheet);
    engine.addClass(outer, 'p');
    const node = engine.createElement('text', sheet);
    engine.addClass(node, 'a');
    engine.appendChild(outer, node);
    engine.appendChild(scroll, outer);
    engine.appendChild(engine.root, scroll);
    engine.commit();
    const painted = () => fabric.committed[0]!.children[0]!.children[0]!.props['color'];
    assert.equal(painted(), 'rgba(10, 20, 30, 1)');
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(painted(), 'rgba(200, 100, 0, 1)');
  });

  it('starts a scroll-played animation with no first frame at the colour inherited now', () => {
    // No frame at 0%, so the animation starts at the element's own colour, which it inherits.
    const sheet = compileCss(`
      .p { color: rgb(10, 20, 30) }
      .q { color: rgb(200, 100, 0) }
      @keyframes k { 50% { color: currentColor } to { color: rgb(110, 120, 130) } }
      .a { animation: k 1s linear; animation-timeline: scroll() }
    `);
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const scroll = engine.createElement('scroll-view', sheet);
    const outer = engine.createElement('view', sheet);
    engine.addClass(outer, 'p');
    const node = engine.createElement('text', sheet);
    engine.addClass(node, 'a');
    engine.appendChild(outer, node);
    engine.appendChild(scroll, outer);
    engine.appendChild(engine.root, scroll);
    engine.commit();
    const painted = () => fabric.committed[0]!.children[0]!.children[0]!.props['color'];
    assert.equal(painted(), 'rgba(10, 20, 30, 1)');
    engine.removeClass(outer, 'p');
    engine.addClass(outer, 'q');
    engine.commit();
    assert.equal(painted(), 'rgba(200, 100, 0, 1)');
  });

  it('still refuses currentColor on any other property in a frame, and says that is why', () => {
    // The element's own colour, which the same frames can be animating.
    for (const property of ['background-color', 'border-color', 'text-decoration-color']) {
      assert.throws(
        () => compileCss(`@keyframes k { to { ${property}: currentColor } }`),
        (error: Error) =>
          /keyframe/.test(error.message) &&
          /currentColor/.test(error.message) &&
          !/var\(\), em/.test(error.message),
        property,
      );
    }
  });
});

describe("a border whose width is a calc() of a token, as Bootstrap's .table-group-divider", () => {
  const divider = '.a { border-top: calc(var(--w) * 2) solid currentcolor }';

  it('is as wide as the token works out to, in the colour of the text, with no warning', () => {
    const { props, warnings } = tree(`.p { color: ${RED}; --w: 1px } ${divider}`, ['p']);
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderTopWidth'], 2);
    assert.equal(props()['borderTopColor'], RED);
    assert.equal(props()['borderBottomWidth'], undefined);
  });

  it('takes the token when it is set on the element', () => {
    const { engine, node, props } = tree(`.p { color: ${RED} } ${divider}`, ['p']);
    engine.setCustomProperty(node, '--w', '3px');
    engine.commit();
    assert.equal(props()['borderTopWidth'], 6);
    assert.equal(props()['borderTopColor'], RED);
  });

  it('takes a written colour too', () => {
    const { props, warnings } = tree(
      `.a { --w: 1px; border-bottom: calc(var(--w) * 3) solid ${BLUE} }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderBottomWidth'], 3);
    assert.equal(props()['borderBottomColor'], BLUE);
  });

  it('is no border below zero, as CSS clamps a line width', () => {
    const { props } = tree(`.a { --w: 1px; border-top: calc(var(--w) - 2px) solid ${BLUE} }`);
    assert.equal(props()['borderTopWidth'], 0);
    const em = tree(`.a { font-size: 10px; --w: 0.1em; border-top: calc(var(--w) - 2px) solid }`);
    assert.equal(em.props()['borderTopWidth'], 0);
  });

  it('unsets the whole line when its token is unset, as a line of tokens does', () => {
    // CSS makes the shorthand invalid then: its style and colour go with its width.
    for (const later of ['', ' border-width: 5px']) {
      const calc = tree(`.a { border-top: calc(var(--missing) * 2) solid ${BLUE};${later} }`);
      const token = tree(`.a { border-top: var(--missing) solid ${BLUE};${later} }`);
      assert.deepEqual(calc.props(), token.props(), later);
    }
  });

  it('is a length only when the calc() makes one, as CSS types it', () => {
    // A number token needs the calc() to give it a unit, and a length token must not get a second.
    const width = (token: string, calc: string) =>
      tree(`.a { --n: ${token}; border-top: ${calc} solid ${BLUE} }`).props()['borderTopWidth'];
    assert.equal(width('3', 'calc(var(--n) * 1px)'), 3);
    assert.equal(width('2px', 'calc(var(--n) * 2)'), 4);
    assert.equal(width('2', 'calc(var(--n) * 2)'), undefined);
    assert.equal(width('2px', 'calc(var(--n) * 1px)'), undefined);
  });

  it('types the longhand the same way', () => {
    const width = (token: string, calc: string) =>
      tree(`.a { --n: ${token}; border-top-width: ${calc} }`).props()['borderTopWidth'];
    assert.equal(width('3', 'calc(var(--n) * 1px)'), 3);
    assert.equal(width('2px', 'calc(var(--n) * 2)'), 4);
    assert.equal(width('2', 'calc(var(--n) * 2)'), undefined);
    assert.equal(width('2px', 'calc(var(--n) * 1px)'), undefined);
    // The unit can come from a nested calc().
    assert.equal(width('3', 'calc(var(--n) * calc(2 * 1px))'), 6);
    assert.equal(width('3', 'calc(var(--n) * calc(1px + 1px))'), 6);
  });

  it('types a shadow length the same way', () => {
    const spread = (token: string) =>
      (
        tree(`.a { --n: ${token}; box-shadow: 0 0 0 calc(var(--n) * 1px) ${BLUE} }`).props()[
          'boxShadow'
        ] as { spreadDistance?: number }[] | undefined
      )?.[0]?.spreadDistance;
    assert.equal(spread('3'), 3);
    assert.equal(spread('3px'), undefined);
  });

  it('takes a calc() beside another token, which gives the colour', () => {
    const { props, warnings } = tree(
      `.a { --w: 1px; --c: ${BLUE}; border-top: calc(var(--w) * 2) solid var(--c) }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderTopWidth'], 2);
    assert.equal(props()['borderTopColor'], BLUE);
  });
});

describe('a line whose colour is a colour function of a token', () => {
  const MIXED = 'rgba(0, 0, 255, 0.35)';
  const mix = 'color-mix(in srgb, var(--tint) 35%, transparent)';

  it('draws a border in the colour the device works out, as border-color does', () => {
    const { props, warnings } = tree(`.a { --tint: ${BLUE}; border: 1px solid ${mix} }`);
    assert.deepEqual(warnings, []);
    assert.deepEqual(colours(props()), [MIXED, MIXED, MIXED, MIXED]);
    assert.equal(props()['borderTopWidth'], 1);
    assert.equal(props()['borderStyle'], 'solid');
  });

  it('draws one side and an outline the same way', () => {
    const { props, warnings } = tree(
      `.a { --tint: ${BLUE}; border-top: 2px solid ${mix}; outline: 3px dashed ${mix} }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderTopColor'], MIXED);
    assert.equal(props()['borderTopWidth'], 2);
    assert.equal(props()['outlineColor'], MIXED);
    assert.equal(props()['outlineWidth'], 3);
  });

  it('takes its width from a token beside it', () => {
    const { props, warnings } = tree(
      `.a { --w: 4px; --tint: ${BLUE}; border: var(--w) solid ${mix} }`,
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderTopWidth'], 4);
    assert.equal(props()['borderTopColor'], MIXED);
  });

  it('follows the token when it changes, and draws no line at all when it goes', () => {
    const { engine, node, props } = tree(`.a { border: 1px solid ${mix} }`);
    assert.equal(props()['borderTopWidth'], undefined, 'an unset token makes the border invalid');
    assert.equal(props()['borderTopColor'], undefined);
    engine.setCustomProperty(node, '--tint', RED);
    engine.commit();
    assert.equal(props()['borderTopWidth'], 1);
    assert.equal(props()['borderTopColor'], MIXED.replace('0, 0, 255', '255, 0, 0'));
    engine.setCustomProperty(node, '--tint', null);
    engine.commit();
    assert.equal(props()['borderTopWidth'] ?? 0, 0, 'and none again once it is unset');
    assert.equal(props()['borderTopColor'] ?? null, null);
  });

  it('mixes the colour of the text where a side of the mix is currentColor', () => {
    const half = `color-mix(in srgb, currentColor 50%, var(--tint) 50%)`;
    const { props, warnings } = tree(
      `.p { color: ${RED}; --tint: ${BLUE} } .a { border: 1px solid ${half}; outline-color: ${half} }`,
      ['p'],
    );
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderTopColor'], 'rgb(128, 0, 128)');
    assert.equal(props()['borderTopWidth'], 1);
    assert.equal(props()['outlineColor'], 'rgb(128, 0, 128)');
  });

  it('mixes the colour of the text where a token in the mix holds currentColor', () => {
    const { props } = tree(
      `.p { color: ${RED}; --c: currentColor; --tint: ${BLUE} } ` +
        `.a { border-color: color-mix(in srgb, var(--c) 50%, var(--tint) 50%) }`,
      ['p'],
    );
    assert.equal(props()['borderTopColor'], 'rgb(128, 0, 128)');
  });

  it('is one colour only: a second colour beside it is not a border', () => {
    const { props, warnings } = tree(`.a { --tint: ${BLUE}; border: 1px solid ${mix} ${RED} }`);
    assert.match(warnings.join('\n'), /more than one colour/);
    assert.equal(props()['borderTopWidth'], undefined);
  });

  it('says a length function it cannot settle is arithmetic, not a colour', () => {
    const { warnings } = tree(`.a { --w: 1px; border: min(var(--w), 2px) solid ${RED} }`);
    assert.match(warnings.join('\n'), /'min\(\)' is not arithmetic on one var\(\)/);
  });

  it('still reads a calc() of a token as the width', () => {
    const { props, warnings } = tree(`.a { --w: 1px; border: calc(var(--w) * 2) solid ${RED} }`);
    assert.deepEqual(warnings, []);
    assert.equal(props()['borderTopWidth'], 2);
  });
});
