/**
 * `:is()`, `:where()`, `:not()` and `:has()` in a `<style>` read while the app runs: what each
 * matches, how specific it is, what is matched again as the page changes, and what `CSS.supports`
 * says of each.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { sheetOf } from './runtime-style.ts';
import { cssNamespace } from './css-namespace.ts';

/** An engine styled by `css` as the runtime reader reads it, with a helper to make elements. */
function scene(css: string) {
  const fabric = createFakeFabric();
  const sheet = sheetOf(css);
  const engine = new Engine(fabric, 1, { globalStyles: sheet });
  /** An element with `classes` and the `testID` `id`, under `parent` or the root. */
  const el = (id: string, classes = '', parent: EngineNode = engine.root): EngineNode => {
    const node = engine.createElement('view');
    if (classes) engine.setClasses(node, classes);
    engine.setProp(node, 'testID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** The committed opacity of the element with `testID`, or null for none. */
  const opacity = (id: string): unknown => {
    engine.commit();
    return (
      all(fabric.committed).find((node) => node.props['testID'] === id)?.props['opacity'] ?? null
    );
  };
  return { sheet, engine, el, opacity };
}

describe('what the build compiles too', () => {
  it('is read as the build compiles it: `:is()`, `:not()` and `:has()` of compounds', () => {
    const read = (selector: string) => {
      const [rule] = sheetOf(`${selector} { opacity: 0.5 }`).rules;
      return [rule!.compounds, rule!.combinators, rule!.specificity];
    };
    assert.deepEqual(read('.a:is(.b, #c)'), [
      [{ classes: ['a'], is: [[{ classes: ['b'] }, { classes: [], id: 'c' }]] }],
      [],
      1_001_000,
    ]);
    assert.deepEqual(read(':where(.a) .b'), [
      [{ classes: [], is: [[{ classes: ['a'] }]] }, { classes: ['b'] }],
      ['descendant'],
      1000,
    ]);
    assert.deepEqual(read('.a:not(.b, .c)'), [
      [{ classes: ['a'], not: [{ classes: ['b'] }, { classes: ['c'] }] }],
      [],
      2000,
    ]);
    assert.deepEqual(read('.card:has(> .x)'), [
      [{ classes: ['card'], has: [{ child: true, any: [{ classes: ['x'] }] }] }],
      [],
      2000,
    ]);
    assert.deepEqual(read('.x:is(.a *)'), [
      [{ classes: ['x'], ancestors: [{ classes: ['a'] }] }],
      [],
      2000,
    ]);
    assert.deepEqual(read('.x:where(.a > *)'), [
      [{ classes: ['x'], parents: [{ classes: ['a'] }] }],
      [],
      1000,
    ]);
  });
});

describe(':is() and :where() with a selector of more than a compound', () => {
  it('matches the element the argument ends at, and follows what is above it changing', () => {
    const s = scene(':is(.box .item) { opacity: 0.5 }');
    const outer = s.el('outer');
    const item = s.el('item', 'item', s.el('middle', '', outer));
    assert.equal(s.opacity('item'), null);
    s.engine.addClass(outer, 'box');
    assert.equal(s.opacity('item'), 0.5);
    s.engine.removeClass(outer, 'box');
    assert.equal(s.opacity('item'), null);
    s.engine.removeClass(item, 'item');
    s.engine.addClass(outer, 'box');
    assert.equal(s.opacity('item'), null);
  });

  it('follows a sibling before the element changing', () => {
    const s = scene('.b:where(.a + *) { opacity: 0.5 }');
    const first = s.el('first');
    s.el('second', 'b');
    assert.equal(s.opacity('second'), null);
    s.engine.addClass(first, 'a');
    assert.equal(s.opacity('second'), 0.5);
    s.engine.removeClass(first, 'a');
    assert.equal(s.opacity('second'), null);
  });

  it('follows a sibling before a box the element is in changing', () => {
    const s = scene(':is(.a ~ .b) .c { opacity: 0.5 }');
    const first = s.el('first');
    s.el('c', 'c', s.el('b', 'b'));
    assert.equal(s.opacity('c'), null);
    s.engine.addClass(first, 'a');
    assert.equal(s.opacity('c'), 0.5);
    s.engine.removeClass(first, 'a');
    assert.equal(s.opacity('c'), null);
  });

  it('follows the place of a box the element is in changing', () => {
    const s = scene(':is(:first-child > .label) { opacity: 0.5 }');
    s.el('label', 'label', s.el('row'));
    assert.equal(s.opacity('label'), 0.5);
    const before = s.engine.createElement('view');
    s.engine.insertBefore(s.engine.root, before, s.engine.root.childList[0]!);
    assert.equal(s.opacity('label'), null);
    s.engine.removeChild(s.engine.root, before);
    assert.equal(s.opacity('label'), 0.5);
  });

  it('weighs :is() as its most specific argument and :where() as nothing', () => {
    const is = scene(':is(.a .b, #x) { opacity: 0.5 } .b.c { opacity: 1 }');
    is.el('b', 'b c', is.el('x', 'a'));
    // `#x` is the weight, though `.a .b` is what matched: an id beats two classes.
    assert.equal(is.opacity('b'), 0.5);
    const where = scene('.b { opacity: 0.25 } :where(.a .b) { opacity: 0.5 }');
    where.el('b', 'b', where.el('a', 'a'));
    assert.equal(where.opacity('b'), 0.25);
    assert.equal(sheetOf(':where(.a .b, #c) {opacity: 1}').rules[0]!.specificity, 0);
    // `.x` and `#c > d`, the heavier argument.
    assert.equal(sheetOf('.x:is(.a .b, #c > d) {opacity: 1}').rules[0]!.specificity, 1_001_001);
  });

  it('matches nothing where no argument can be read, as a forgiving list does', () => {
    const s = scene(
      ':is(:unknown-thing) { opacity: 0.5 } .a:is(:unknown-thing, .a) { opacity: 0.25 }',
    );
    s.el('a', 'a');
    assert.equal(s.opacity('a'), 0.25);
  });
});

describe(':not() of a selector of more than a compound', () => {
  it('matches what the argument does not, and follows what is above changing', () => {
    const s = scene('.item:not(.box .item) { opacity: 0.5 }');
    const outer = s.el('outer');
    s.el('item', 'item', outer);
    assert.equal(s.opacity('item'), 0.5);
    s.engine.addClass(outer, 'box');
    assert.equal(s.opacity('item'), null);
    s.engine.removeClass(outer, 'box');
    assert.equal(s.opacity('item'), 0.5);
  });

  it('weighs as its most specific argument', () => {
    assert.equal(sheetOf(':not(.a + .b, #c) {opacity: 1}').rules[0]!.specificity, 1_000_000);
    assert.equal(sheetOf(':not(span + span) {opacity: 1}').rules[0]!.specificity, 2);
  });
});

describe(':has() of a relative selector', () => {
  it('finds a descendant by a selector of more than a compound', () => {
    const s = scene('.card:has(.a > .b) { opacity: 0.5 }');
    const card = s.el('card', 'card');
    const a = s.el('a', '', card);
    const b = s.el('b', 'b', a);
    assert.equal(s.opacity('card'), null);
    s.engine.addClass(a, 'a');
    assert.equal(s.opacity('card'), 0.5);
    s.engine.removeChild(a, b);
    assert.equal(s.opacity('card'), null);
  });

  it('finds the next sibling after +, and any later one after ~', () => {
    const s = scene('.y:has(~ .later) { opacity: 0.25 } .x:has(+ .next) { opacity: 0.5 }');
    s.el('x', 'x y');
    const between = s.el('between');
    const last = s.el('last');
    assert.equal(s.opacity('x'), null);
    s.engine.addClass(last, 'later');
    assert.equal(s.opacity('x'), 0.25);
    s.engine.addClass(last, 'next');
    // The one with `.next` is not the next element: `between` is.
    assert.equal(s.opacity('x'), 0.25);
    s.engine.removeChild(s.engine.root, between);
    assert.equal(s.opacity('x'), 0.5);
    s.engine.removeClass(last, 'next');
    assert.equal(s.opacity('x'), 0.25);
    s.engine.removeClass(last, 'later');
    assert.equal(s.opacity('x'), null);
  });

  it('finds what is under a later sibling', () => {
    const s = scene('.x:has(~ .panel .mark) { opacity: 0.5 }');
    s.el('x', 'x');
    const panel = s.el('panel', 'panel');
    const inner = s.el('inner', '', s.el('box', '', panel));
    assert.equal(s.opacity('x'), null);
    s.engine.addClass(inner, 'mark');
    assert.equal(s.opacity('x'), 0.5);
    s.engine.removeClass(panel, 'panel');
    assert.equal(s.opacity('x'), null);
  });

  it('steps on from a later sibling to the one after it, and from the next to a later one', () => {
    const s = scene('.x:has(~ .a + .b) { opacity: 0.5 } .y:has(+ .a ~ .b) { opacity: 0.25 }');
    s.el('x', 'x');
    s.el('y', 'y');
    const a = s.el('a', 'a');
    s.el('gap');
    const b = s.el('b', 'b');
    // `.b` is after `.a`, and not next to it.
    assert.equal(s.opacity('x'), null);
    assert.equal(s.opacity('y'), 0.25);
    s.engine.removeClass(a, 'a');
    assert.equal(s.opacity('y'), null);
    s.engine.addClass(s.el('a2', 'a'), 'x');
    s.engine.removeClass(b, 'b');
    s.el('b2', 'b');
    // The new `.a` is right before the new `.b`, and after both.
    assert.equal(s.opacity('x'), 0.5);
    assert.equal(s.opacity('y'), null);
  });

  it('follows a sibling coming in after the element, and going', () => {
    const s = scene('.x:has(+ .next) { opacity: 0.5 }');
    s.el('x', 'x');
    const next = s.engine.createElement('view');
    s.engine.setClasses(next, 'next');
    s.engine.appendChild(s.engine.root, next);
    assert.equal(s.opacity('x'), 0.5);
    s.engine.removeChild(s.engine.root, next);
    assert.equal(s.opacity('x'), null);
  });

  it('is asked of a box the styled element is in, or one before it', () => {
    const s = scene(
      '.card:has(.mark) .title { opacity: 0.5 } .card:has(~ .mark) ~ .title { opacity: 0.25 }',
    );
    const card = s.el('card', 'card');
    s.el('title', 'title', card);
    s.el('after', 'title');
    const last = s.el('last');
    assert.equal(s.opacity('title'), null);
    assert.equal(s.opacity('after'), null);
    s.engine.addClass(last, 'mark');
    assert.equal(s.opacity('after'), 0.25);
    assert.equal(s.opacity('title'), null);
    s.engine.removeClass(last, 'mark');
    assert.equal(s.opacity('after'), null);
    const mark = s.el('mark', 'mark', card);
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeChild(card, mark);
    assert.equal(s.opacity('title'), null);
  });

  it('is asked of a box before the styled element named by no class, the root among them', () => {
    const s = scene(':has(.mark) ~ .title { opacity: 0.5 }');
    const box = s.el('box');
    s.el('title', 'title');
    assert.equal(s.opacity('title'), null);
    const mark = s.el('mark', 'mark', box);
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeChild(box, mark);
    assert.equal(s.opacity('title'), null);
  });

  it('is asked of a box before the styled element, for what is in that box', () => {
    const s = scene('.card:has(.mark) ~ .title { opacity: 0.5 }');
    const inner = s.el('inner', '', s.el('card', 'card'));
    s.el('title', 'title');
    assert.equal(s.opacity('title'), null);
    s.engine.addClass(inner, 'mark');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeClass(inner, 'mark');
    assert.equal(s.opacity('title'), null);
  });

  it('weighs as its most specific argument', () => {
    assert.equal(sheetOf(':has(.a, #b) {opacity: 1}').rules[0]!.specificity, 1_000_000);
    assert.equal(sheetOf(':has(span + span) {opacity: 1}').rules[0]!.specificity, 2);
    assert.equal(sheetOf(':has(> .a .b) {opacity: 1}').rules[0]!.specificity, 2000);
  });
});

describe('a runtime sheet that asks :has()', () => {
  it('has a change beneath matched again only while it is applied', () => {
    const s = scene('.other { opacity: 1 }');
    const card = s.el('card', 'card');
    s.engine.commit();
    const added: StyleSheet = sheetOf('.card:has(+ .next, .mark) { opacity: 0.5 }');
    assert.equal(added.has, true);
    s.engine.addGlobalSheet(added);
    s.el('mark', 'mark', card);
    assert.equal(card.hasDirty, true, 'what the card holds is asked once the sheet is in');
    assert.equal(s.opacity('card'), 0.5);
    s.el('next', 'next');
    assert.equal(card.hasDirty, true, 'what comes after the card is asked too');
    s.engine.commit();

    s.engine.removeGlobalSheet(added);
    assert.equal(s.opacity('card'), null);
    s.el('more', 'mark', card);
    s.el('after');
    assert.equal(card.hasDirty, false, 'nothing is asked once the sheet has gone');
    s.engine.commit();
  });
});

describe('rules nested in a rule', () => {
  it('are for what & is, or what is in it where there is no &, as Chrome has them', () => {
    const s = scene(
      '.card { & .title { opacity: 0.2 } > .direct { opacity: 0.3 } &.on { opacity: 0.4 } ' +
        '.wrap & { opacity: 0.5 } + .next { opacity: 0.6 } .deep { .deeper { opacity: 0.7 } } ' +
        'opacity: 0.1 }',
    );
    const wrap = s.el('wrap', 'wrap');
    const card = s.el('card', 'card', wrap);
    s.el('title', 'title', card);
    s.el('direct', 'direct', card);
    s.el('deeper', 'deeper', s.el('deep', 'deep', card));
    s.el('not direct', 'direct', s.el('box', '', card));
    s.el('next', 'next', wrap);
    s.el('on', 'card on', wrap);
    s.el('plain', 'card');
    const opacities = Object.fromEntries(
      ['card', 'title', 'direct', 'not direct', 'deeper', 'next', 'on', 'plain'].map((id) => [
        id,
        s.opacity(id),
      ]),
    );
    assert.deepEqual(opacities, {
      card: 0.5,
      title: 0.2,
      direct: 0.3,
      'not direct': null,
      deeper: 0.7,
      next: 0.6,
      on: 0.5,
      plain: 0.1,
    });
  });

  it('weighs & as the most specific of what it stands for, and reads an at-rule in a rule', () => {
    const s = scene(
      '.p.q.r, .b { & .c { opacity: 0.5 } } .x.y .c { opacity: 0.25 } ' +
        '.s { @supports (display: flex) { opacity: 0.9 } }',
    );
    s.el('c', 'c', s.el('b', 'b x y'));
    s.el('s', 's');
    assert.equal(s.opacity('c'), 0.5);
    assert.equal(s.opacity('s'), 0.9);
  });
});

describe('CSS.supports and the selectors the reader applies', () => {
  it('says yes to what is read and no to what is not', () => {
    const supports = (selector: string) => cssNamespace.supports(`selector(${selector})`);
    for (const yes of [
      ':is(a)',
      ':where(.a .b)',
      ':is(div + bar, div ~ .baz)',
      ':not(.a .b ~ c)',
      ':has(a)',
      ':has(> .a .b)',
      ':has(+ .a)',
      ':has(~ .b > .a)',
      '.a:has(.b) ~ .c',
      ':not(:has(.a))',
    ]) {
      assert.equal(supports(yes), true, yes);
    }
    for (const no of [':is(:hover)', ':has(:hover)', ':not(.a:hover .b)', ':where(::before)']) {
      assert.equal(supports(no), false, no);
    }
  });
});
