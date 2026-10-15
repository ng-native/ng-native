/**
 * A selector of more than a compound inside `:is()`, `:where()`, `:not()` and `:has()`, in an
 * app's own stylesheet as the build compiles it: the engine's nested selectors, as a stylesheet
 * read while the app runs gets them. Each answer is Chrome's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { build } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};

/** An engine styled by `css` as the build compiles it, with a helper to make elements. */
function scene(css: string) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
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
  return { sheet, reports, engine, el, opacity };
}

const specificity = (selector: string): number =>
  compileCss(`${selector} { opacity: 1 }`, 'app.css').rules[0].specificity;

describe(':is() and :where() of a selector of more than a compound', () => {
  it('matches the element the argument ends at, and follows what is above it changing', () => {
    const s = scene(':is(.box .middle > .item) { opacity: 0.5 }');
    const outer = s.el('outer');
    const item = s.el('item', 'item', s.el('middle', 'middle', outer));
    assert.equal(s.opacity('item'), null);
    s.engine.addClass(outer, 'box');
    assert.equal(s.opacity('item'), 0.5);
    s.engine.removeClass(outer, 'box');
    assert.equal(s.opacity('item'), null);
    s.engine.removeClass(item, 'item');
    s.engine.addClass(outer, 'box');
    assert.equal(s.opacity('item'), null);
    assert.deepEqual(s.reports, []);
  });

  it('takes a longer walk above the element than one ancestor or one parent', () => {
    const s = scene(
      '.x:is(.a .b .p > *) { opacity: 0.5 } .y:is(.a > .p > *) { opacity: 0.25 } ' +
        '.z:is(.a ~ .p > *) { opacity: 0.75 }',
    );
    const a = s.el('a', 'a');
    const p = s.el('p', 'p', s.el('b', 'b', a));
    s.el('x', 'x', p);
    s.el('y', 'y', p);
    const after = s.el('after', 'p');
    s.el('z', 'z', after);
    assert.equal(s.opacity('x'), 0.5);
    // `.p` is under `.b`, not a child of `.a`.
    assert.equal(s.opacity('y'), null);
    assert.equal(s.opacity('z'), 0.75);
    s.engine.setClasses(a, 'b');
    assert.equal(s.opacity('x'), null, '.b is above .a now, which is the wrong way round');
    assert.equal(s.opacity('z'), null);
    assert.deepEqual(s.reports, []);
  });

  it('takes a sibling test after a sibling combinator, the two in either order', () => {
    const s = scene('.a ~ .x:is(.peer ~ *) { opacity: 0.5 }');
    const peer = s.el('peer');
    s.el('a', 'a');
    s.el('x', 'x');
    assert.equal(s.opacity('x'), null);
    s.engine.addClass(peer, 'peer');
    assert.equal(s.opacity('x'), 0.5);
    s.engine.removeClass(peer, 'peer');
    assert.equal(s.opacity('x'), null);
    assert.deepEqual(s.reports, []);
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
    assert.equal(s.sheet.structural, true);
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
    assert.equal(s.sheet.structural, true);
  });

  it('reads an ancestor test beside a longer selector in one list, as either', () => {
    // In a `:has()` argument, which is not split into a rule for each alternative.
    const s = scene('.card:has(> .x:is(.p *, .a ~ *)) { opacity: 0.5 }');
    const card = s.el('card', 'card');
    const first = s.el('first', '', card);
    s.el('x', 'x', card);
    assert.equal(s.opacity('card'), null);
    // An earlier `.a`, and no `.p` above: the second alternative alone.
    s.engine.addClass(first, 'a');
    assert.equal(s.opacity('card'), 0.5);
    s.engine.removeClass(first, 'a');
    assert.equal(s.opacity('card'), null);
    assert.deepEqual(s.reports, []);
  });

  it('follows what is in a box a longer argument asks :has() of', () => {
    const s = scene('.title:is(.card:has(.action) > .body > *) { opacity: 0.5 }');
    const card = s.el('card', 'card');
    const button = s.el('button', '', card);
    s.el('title', 'title', s.el('body', 'body', card));
    assert.equal(s.opacity('title'), null);
    s.engine.addClass(button, 'action');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeClass(button, 'action');
    assert.equal(s.opacity('title'), null);
    assert.equal(s.sheet.has, true);
  });

  it('keeps each alternative of a forgiving list, the longer ones with the rest', () => {
    const s = scene('.x:is(.a > .b, .c) { opacity: 0.5 }');
    const a = s.el('a');
    const x = s.el('x', 'x b', a);
    assert.equal(s.opacity('x'), null);
    s.engine.addClass(a, 'a');
    assert.equal(s.opacity('x'), 0.5);
    s.engine.removeClass(a, 'a');
    s.engine.addClass(x, 'c');
    assert.equal(s.opacity('x'), 0.5);
    assert.deepEqual(s.reports, []);
  });

  it('weighs :is() as its most specific argument and :where() as nothing', () => {
    const is = scene('.x:is(.a .b, #y) { opacity: 0.5 } .x.c.d { opacity: 1 }');
    is.el('x', 'x b c d', is.el('a', 'a'));
    // `#y` is the weight, though `.a .b` is what matched: an id beats three classes.
    assert.equal(is.opacity('x'), 0.5);
    const where = scene('.b { opacity: 0.25 } :where(.a .b) { opacity: 0.5 }');
    where.el('b', 'b', where.el('a', 'a'));
    assert.equal(where.opacity('b'), 0.25);
    assert.equal(specificity(':where(.a .b, #c)'), 0);
    assert.equal(specificity('.x:is(.a .b, #c > view)'), specificity('.x#c view'));
  });

  it("reads Tailwind's peer-* of a variant that is a list, as peer-midnight: writes", () => {
    const css =
      "@custom-variant midnight (&:where([data-theme='midnight'], [data-theme='midnight'] *));";
    const s = scene(flattenTailwind(build('native', 'peer-midnight:opacity-50', css)));
    const peer = s.el('peer', 'peer');
    s.el('x', 'peer-midnight:opacity-50');
    assert.equal(s.opacity('x'), null);
    s.engine.setProp(peer, 'data-theme', 'midnight');
    assert.equal(s.opacity('x'), 0.5);
    s.engine.setProp(peer, 'data-theme', 'day');
    assert.equal(s.opacity('x'), null);
    assert.deepEqual(s.reports, []);
  });
});

describe(':not() of a selector of more than a compound', () => {
  it('matches what the argument does not, and follows what is above changing', () => {
    const s = scene('.item:not(.box .item) { opacity: 0.5 }');
    const outer = s.el('outer');
    s.el('item', 'item', s.el('middle', '', outer));
    assert.equal(s.opacity('item'), 0.5);
    s.engine.addClass(outer, 'box');
    assert.equal(s.opacity('item'), null);
    s.engine.removeClass(outer, 'box');
    assert.equal(s.opacity('item'), 0.5);
    assert.deepEqual(s.reports, []);
  });

  it('takes a parent test, which is the parent and not any box above', () => {
    const s = scene('.x:not(.p > *) { opacity: 0.5 }');
    const parent = s.el('parent', 'p');
    s.el('child', 'x', parent);
    s.el('grandchild', 'x', s.el('middle', '', parent));
    assert.equal(s.opacity('child'), null);
    assert.equal(s.opacity('grandchild'), 0.5);
    s.engine.removeClass(parent, 'p');
    assert.equal(s.opacity('child'), 0.5);
    assert.deepEqual(s.reports, []);
  });

  it('weighs as its most specific argument', () => {
    assert.equal(specificity(':not(.a + .b, #c)'), specificity('#c'));
    assert.equal(specificity(':not(view + view)'), specificity('view view'));
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
    assert.deepEqual(s.reports, []);
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
    assert.deepEqual(s.reports, []);
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

  it('takes a list of a child and a descendant', () => {
    const s = scene('.card:has(> .a, .b) { opacity: 0.5 }');
    const card = s.el('card', 'card');
    const deep = s.el('deep', '', s.el('middle', '', card));
    s.engine.addClass(deep, 'a');
    // A `.a` that is no child of the card.
    assert.equal(s.opacity('card'), null);
    s.engine.addClass(deep, 'b');
    assert.equal(s.opacity('card'), 0.5);
    assert.deepEqual(s.reports, []);
  });

  it('weighs as its most specific argument', () => {
    assert.equal(specificity(':has(.a, #b)'), specificity('#b'));
    assert.equal(specificity(':has(view + view)'), specificity('view view'));
    assert.equal(specificity(':has(> .a .b)'), specificity('.a .b'));
    const s = scene('.x:has(.a + .b) { opacity: 0.5 } .x.y { opacity: 1 }');
    const x = s.el('x', 'x y');
    s.el('a', 'a', x);
    s.el('b', 'b', x);
    assert.equal(s.opacity('x'), 0.5);
  });

  it('marks the sheet as asking :has()', () => {
    assert.equal(scene('.x:has(+ .next) { opacity: 0.5 }').sheet.has, true);
  });
});

describe(':has() on a box beside the styled element, or one it is in', () => {
  it('is asked of the element before the styled one', () => {
    const s = scene('.card:has(.action) + .title { opacity: 0.5 }');
    const inner = s.el('inner', '', s.el('card', 'card'));
    s.el('title', 'title');
    assert.equal(s.opacity('title'), null);
    s.engine.addClass(inner, 'action');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeClass(inner, 'action');
    assert.equal(s.opacity('title'), null);
    assert.deepEqual(s.reports, []);
  });

  it('is asked of a box before one the styled element is in', () => {
    const s = scene('.card:has(.action) ~ .panel .title { opacity: 0.5 }');
    const inner = s.el('inner', '', s.el('card', 'card'));
    s.el('between');
    s.el('title', 'title', s.el('panel', 'panel'));
    assert.equal(s.opacity('title'), null);
    s.engine.addClass(inner, 'action');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeChild(s.engine.root.childList[0]!, inner);
    assert.equal(s.opacity('title'), null);
    assert.deepEqual(s.reports, []);
  });

  it('is asked of a box the styled element is asked to be inside', () => {
    const s = scene('.title:is(.card:has(.action) *) { opacity: 0.5 }');
    const card = s.el('card', 'card');
    const button = s.el('button', '', card);
    s.el('title', 'title', s.el('body', '', card));
    assert.equal(s.opacity('title'), null);
    s.engine.addClass(button, 'action');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeClass(button, 'action');
    assert.equal(s.opacity('title'), null);
    assert.deepEqual(s.reports, []);
  });
});

describe("Tailwind's group-has-* and peer-has-*", () => {
  it('styles an element by what is in the group above it, or the peer before it', () => {
    const classes = 'group-has-[.action]:opacity-50 peer-has-[.action]:opacity-25';
    const s = scene(flattenTailwind(build('native', classes)));
    const group = s.el('group', 'group');
    s.el('inside', 'group-has-[.action]:opacity-50', s.el('body', '', group));
    const peer = s.el('peer', 'peer');
    s.el('after', 'peer-has-[.action]:opacity-25');
    assert.equal(s.opacity('inside'), null);
    assert.equal(s.opacity('after'), null);
    const inGroup = s.el('a', 'action', group);
    assert.equal(s.opacity('inside'), 0.5);
    assert.equal(s.opacity('after'), null);
    const inPeer = s.el('b', 'action', peer);
    assert.equal(s.opacity('after'), 0.25);
    s.engine.removeChild(group, inGroup);
    s.engine.removeChild(peer, inPeer);
    assert.equal(s.opacity('inside'), null);
    assert.equal(s.opacity('after'), null);
    assert.deepEqual(s.reports, []);
  });
});
