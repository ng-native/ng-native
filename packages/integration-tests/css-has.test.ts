/**
 * `:has()`: a node styled by what is beneath it. The argument is one compound, a descendant by
 * default and a child after `>`, and the node asked is the one the rule styles.
 *
 * A change beneath a node cannot mark it for restyling as a change to the node does, since that
 * restyles everything under it. The ancestors of a changed node are matched again instead, and
 * restyled only where the rules they match came out different.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { resetStyleStats, styleStats } from '../fabric/src/css.ts';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { build } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};

/** A scene styled by `css`, or by a sheet built by hand for what the build refuses. */
function scene(css: string | StyleSheet) {
  const reports: string[] = [];
  const sheet =
    typeof css === 'string'
      ? compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) })
      : css;
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  /** An element with `classes`, under `parent` or the root. */
  const el = (classes: string, parent: EngineNode = engine.root, name = 'view'): EngineNode => {
    const node = engine.createElement(name);
    if (classes) engine.setClasses(node, classes);
    engine.appendChild(parent, node);
    return node;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** The committed opacity of the view with `testID`. */
  const opacity = (testID: string): unknown => {
    engine.commit();
    return all(fabric.committed).find((node) => node.props['testID'] === testID)?.props['opacity'];
  };
  const card = el('card');
  engine.setProp(card, 'testID', 'card');
  return { sheet, reports, engine, el, opacity, card };
}

const RULE = '.card:has(.action) { opacity: 0.5 }';

describe(':has()', () => {
  it('matches a node with a matching descendant, at any depth', () => {
    const s = scene(RULE);
    assert.equal(s.opacity('card'), undefined);
    s.el('action', s.el('header', s.card));
    assert.equal(s.opacity('card'), 0.5);
    assert.deepEqual(s.reports, []);
  });

  it('matches only a child after >', () => {
    const s = scene('.card:has(> .action) { opacity: 0.5 }');
    const header = s.el('header', s.card);
    const deep = s.el('action', header);
    assert.equal(s.opacity('card'), undefined);
    assert.deepEqual(s.reports, []);
    s.engine.removeChild(header, deep);
    s.el('action', s.card);
    assert.equal(s.opacity('card'), 0.5);
  });

  it('takes an element name, an attribute, a state and a list', () => {
    const attribute = scene('.card:has([data-slot="action"]) { opacity: 0.5 }');
    attribute.engine.setProp(attribute.el('', attribute.card), 'data-slot', 'action');
    assert.equal(attribute.opacity('card'), 0.5);

    const type = scene('.card:has(image) { opacity: 0.5 }');
    type.el('', type.card, 'image');
    assert.equal(type.opacity('card'), 0.5);

    const list = scene('.card:has(.a, .b) { opacity: 0.5 }');
    list.el('b', list.card);
    assert.equal(list.opacity('card'), 0.5);

    const disabled = scene('.card:has(:disabled) { opacity: 0.5 }');
    const field = disabled.el('', disabled.card);
    assert.equal(disabled.opacity('card'), undefined);
    disabled.engine.setProp(field, 'disabled', true);
    assert.equal(disabled.opacity('card'), 0.5);
  });

  it('is negated by :not()', () => {
    const s = scene('.card:not(:has(.action)) { opacity: 0.5 }');
    assert.equal(s.opacity('card'), 0.5);
    s.el('action', s.card);
    assert.equal(s.opacity('card') ?? null, null);
  });

  it('matches any alternative of a list with an ancestor test in it, as Chrome does', () => {
    // Chrome: a descendant of the card that is .x and either under .p or .y itself.
    const rule = '.card:has(.x:is(.p *, .y)) { opacity: 0.5 }';
    const own = scene(rule);
    const x = own.el('x', own.card);
    assert.equal(own.opacity('card'), undefined);
    own.engine.addClass(x, 'y');
    assert.equal(own.opacity('card'), 0.5);
    assert.deepEqual(own.reports, []);
    own.engine.removeClass(x, 'y');
    assert.equal(own.opacity('card') ?? null, null);

    // The ancestor may be anywhere above the descendant, the card's own ancestors included.
    const above = scene(rule);
    const outer = above.el('');
    const card = above.el('card', outer);
    above.engine.setProp(card, 'testID', 'outer card');
    above.el('x', card);
    assert.equal(above.opacity('outer card'), undefined);
    above.engine.addClass(outer, 'p');
    assert.equal(above.opacity('outer card'), 0.5);
    above.engine.removeClass(outer, 'p');
    assert.equal(above.opacity('outer card') ?? null, null);

    const child = scene('.card:has(> .x:is(.p > *, .y)) { opacity: 0.5 }');
    const p = child.el('p', child.card);
    child.el('x', p);
    assert.equal(child.opacity('card'), undefined, 'the .x under .p is no child of the card');
    child.el('x y', child.card);
    assert.equal(child.opacity('card'), 0.5);

    // The other alternative: a direct .x child of a card that is itself .p.
    const parent = scene('.card:has(> .x:is(.p > *, .y)) { opacity: 0.5 }');
    parent.el('x', parent.card);
    assert.equal(parent.opacity('card'), undefined);
    parent.engine.addClass(parent.card, 'p');
    assert.equal(parent.opacity('card'), 0.5);
    parent.engine.removeClass(parent.card, 'p');
    assert.equal(parent.opacity('card') ?? null, null);
  });

  it('matches any alternative of :where() with an ancestor test in it, as of :is()', () => {
    const s = scene('.card:has(.x:where(.p *, .y)) { opacity: 0.5 }');
    const x = s.el('x', s.card);
    assert.equal(s.opacity('card'), undefined);
    s.engine.addClass(x, 'y');
    assert.equal(s.opacity('card'), 0.5);
    s.engine.removeClass(x, 'y');
    assert.equal(s.opacity('card') ?? null, null);
    s.engine.addClass(s.card, 'p');
    assert.equal(s.opacity('card'), 0.5);
    assert.deepEqual(s.reports, []);
  });

  it('is as specific as its argument', () => {
    // Two classes beat the one that comes later in the sheet.
    const s = scene('.card:has(.action) { opacity: 0.5 } .card { opacity: 1 }');
    s.el('action', s.card);
    assert.equal(s.opacity('card'), 0.5);
  });
});

describe(':has() as what is beneath a node changes', () => {
  it('follows a descendant arriving and leaving', () => {
    const s = scene(RULE);
    const header = s.el('header', s.card);
    assert.equal(s.opacity('card'), undefined);
    const action = s.el('action', header);
    assert.equal(s.opacity('card'), 0.5);
    s.engine.removeChild(header, action);
    assert.equal(s.opacity('card') ?? null, null);
  });

  it('follows a descendant gaining and losing what the argument asks for', () => {
    const s = scene(`${RULE} .card:has([data-on]) { opacity: 0.25 }`);
    const inner = s.el('', s.el('header', s.card));
    assert.equal(s.opacity('card'), undefined);
    s.engine.addClass(inner, 'action');
    assert.equal(s.opacity('card'), 0.5);
    s.engine.setProp(inner, 'data-on', true);
    assert.equal(s.opacity('card'), 0.25);
    s.engine.setProp(inner, 'data-on', null);
    assert.equal(s.opacity('card'), 0.5);
    s.engine.removeClass(inner, 'action');
    assert.equal(s.opacity('card') ?? null, null);
  });

  it('restyles what inherits from the node, and nothing when the answer is the same', () => {
    const s = scene('.card:has(.action) { color: red } .other { opacity: 1 }');
    const title = s.el('', s.card, 'text');
    s.engine.setProp(title, 'testID', 'title');
    const colour = () => {
      s.engine.commit();
      return title.styleCache?.style['color'];
    };
    assert.equal(colour(), undefined);
    const action = s.el('action', s.card);
    assert.equal(colour(), 'rgb(255, 0, 0)');

    // A change beneath that leaves the answer as it was resolves the card again and no more.
    const before = title.styleCache;
    s.engine.addClass(action, 'other');
    s.engine.commit();
    assert.equal(title.styleCache, before, 'the title was not resolved again');
  });

  it('walks what is under a changed box once, however many rules ask :has() of any box', () => {
    // A library's `:has(.x) .y`, and Tailwind's, ask it of every box: each one a change is
    // beneath, from the change up to the root.
    const READERS = 40;
    const css = Array.from(
      { length: READERS },
      (_, i) => `:has(.on${i}) .title${i} { opacity: 0.5 }`,
    ).join(' ');
    const s = scene(css);
    let box = s.card;
    const DEPTH = 30;
    for (let i = 0; i < DEPTH; i++) {
      box = s.el('', box);
      s.el('', box);
    }
    const title = s.el('title7', box);
    s.engine.setProp(title, 'testID', 'title');
    assert.equal(s.opacity('title'), undefined);
    const nodes = DEPTH * 2 + 2;

    resetStyleStats();
    s.el('on7', box);
    assert.equal(s.opacity('title'), 0.5);
    assert.ok(
      styleStats.subjectTests < nodes * 3,
      `${styleStats.subjectTests} nodes asked for ${nodes} nodes and ${READERS} rules`,
    );
  });

  it('walks a rule a box asks under it, where a box above asks only others', () => {
    const s = scene(':has(.on) .other { opacity: 1 } .card:has(.action) .title { opacity: 0.5 }');
    const title = s.el('title', s.el('body', s.card));
    s.engine.setProp(title, 'testID', 'title');
    assert.equal(s.opacity('title'), undefined);
    const action = s.el('action', s.card);
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeChild(s.card, action);
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('asks a rule only of a box with the class its :is() or :where() names', () => {
    // Tailwind's `group-has-*` compiles to `:is(:where(.group):has(.on) *)`: a box with no
    // `.group` cannot be the one it asks, so a change under one is no reason to match again.
    const s = scene(':where(.group):has(.on) .title { opacity: 0.5 }');
    const TITLES = 40;
    for (let i = 0; i < TITLES; i++) s.el('title', s.el('row', s.card));
    const group = s.el('group', s.card);
    const title = s.el('title', group);
    s.engine.setProp(title, 'testID', 'title');
    assert.equal(s.opacity('title'), undefined);

    resetStyleStats();
    s.el('', s.el('row', s.card));
    s.engine.commit();
    assert.ok(styleStats.nodesResolved < 5, `${styleStats.nodesResolved} nodes styled again`);

    const on = s.el('on', group);
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeChild(group, on);
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('asks a rule only of a box of the element it names', () => {
    // A table's `tr:has(+ .selected) > td`: a box that is no `tr` cannot be the one it asks.
    const s = scene('section:has(.on) .title { opacity: 0.5 }');
    const TITLES = 40;
    for (let i = 0; i < TITLES; i++) s.el('title', s.el('row', s.card));
    const section = s.el('', s.card, 'section');
    const title = s.el('title', section);
    s.engine.setProp(title, 'testID', 'title');
    assert.equal(s.opacity('title'), undefined);

    resetStyleStats();
    s.el('', s.el('row', s.card));
    s.engine.commit();
    assert.ok(styleStats.nodesResolved < 5, `${styleStats.nodesResolved} nodes styled again`);

    const on = s.el('on', section);
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeChild(section, on);
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('asks a rule of a box with any of the classes an :is() list names', () => {
    const s = scene(':is(.group, .panel):has(.on) .title { opacity: 0.5 }');
    const panel = s.el('panel', s.card);
    const title = s.el('title', panel);
    s.engine.setProp(title, 'testID', 'title');
    const on = s.el('on', panel);
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeChild(panel, on);
    assert.equal(s.opacity('title') ?? null, null);
  });
});

describe(':has() and the cost of asking it', () => {
  it('follows a change under a box that is not drawn', () => {
    const s = scene(`${RULE} .none { display: none }`);
    const hidden = s.el('none', s.card);
    const inner = s.el('', hidden);
    assert.equal(s.opacity('card'), undefined);
    s.engine.addClass(inner, 'action');
    assert.equal(s.opacity('card'), 0.5);
    s.engine.removeClass(inner, 'action');
    assert.equal(s.opacity('card') ?? null, null);
  });

  it('asks a box once a commit, however many of what it holds ask it', () => {
    // Each row asks whether the card has an action, which is a walk of every row in the card.
    const s = scene('.card:has(.action) .row { opacity: 0.5 }');
    const rows = 2000;
    for (let i = 0; i < rows; i++) s.el('row', s.card);
    resetStyleStats();
    s.engine.commit();
    assert.ok(
      styleStats.compoundTests < rows * 20,
      `${styleStats.compoundTests} compound tests for ${rows} rows`,
    );
  });
});

describe(':has() of what comes after a node, on a long list', () => {
  // `.item:has(~ .later)` and `.item:has(+ .next)`, as a stylesheet read while the app runs has
  // them: the build refuses both.
  const after = (combinator: 'later-sibling' | 'next-sibling', name: string): StyleSheet => ({
    rules: [
      {
        compounds: [
          {
            classes: ['item'],
            has: [
              {
                any: [],
                relative: [{ compounds: [{ classes: [name] }], combinators: [combinator] }],
              },
            ],
          },
        ],
        combinators: [],
        specificity: 2000,
        order: 0,
        declarations: { opacity: 0.5 },
      },
    ],
    has: true,
  });
  const ITEMS = 2000;
  const list = (sheet: StyleSheet) => {
    const s = scene(sheet);
    const items = Array.from({ length: ITEMS }, () => s.el('item', s.card));
    s.engine.setProp(items[0]!, 'testID', 'first');
    s.engine.setProp(items.at(-2)!, 'testID', 'second last');
    s.engine.setProp(items.at(-1)!, 'testID', 'last');
    /** Work a commit did, in compound tests and children indexed for their place. */
    const work = (): number => {
      resetStyleStats();
      s.engine.commit();
      return styleStats.compoundTests + styleStats.placesIndexed;
    };
    return { ...s, items, work };
  };

  it('asks each item what comes after it in work that grows with the list, not its square', () => {
    const s = list(after('later-sibling', 'later'));
    const cost = s.work();
    assert.ok(cost < ITEMS * 20, `${cost} for ${ITEMS} items`);
    assert.equal(s.opacity('first') ?? null, null);

    s.engine.addClass(s.items.at(-1)!, 'later');
    const marked = s.work();
    assert.ok(marked < ITEMS * 20, `${marked} for ${ITEMS} items, one later`);
    assert.equal(s.opacity('first'), 0.5);
    assert.equal(s.opacity('second last'), 0.5);
    assert.equal(s.opacity('last') ?? null, null);
  });

  it('follows an item coming in at the end, going, and restyled, across the whole list', () => {
    const s = list(after('later-sibling', 'later'));
    s.work();
    const extra = s.el('later', s.card);
    assert.equal(s.opacity('first'), 0.5);
    assert.equal(s.opacity('last'), 0.5);
    s.engine.removeChild(s.card, extra);
    assert.equal(s.opacity('first') ?? null, null);
    s.engine.addClass(s.items[1]!, 'later');
    assert.equal(s.opacity('first'), 0.5);
    assert.equal(s.opacity('second last') ?? null, null);
    s.engine.removeClass(s.items[1]!, 'later');
    assert.equal(s.opacity('first') ?? null, null);
  });

  it('asks each item what comes next in work that grows with the list, not its square', () => {
    const s = list(after('next-sibling', 'next'));
    const cost = s.work();
    assert.ok(cost < ITEMS * 20, `${cost} for ${ITEMS} items`);
    s.engine.addClass(s.items.at(-1)!, 'next');
    s.engine.addClass(s.items[1]!, 'next');
    const marked = s.work();
    assert.ok(marked < ITEMS * 20, `${marked} for ${ITEMS} items, two next`);
    assert.equal(s.opacity('first'), 0.5);
    assert.equal(s.opacity('second last'), 0.5);
    assert.equal(s.opacity('last') ?? null, null);
    s.engine.removeChild(s.card, s.items[1]!);
    assert.equal(s.opacity('first') ?? null, null);
  });

  it('marks each item before a change once, however many come in after it before a commit', () => {
    const s = scene(after('later-sibling', 'later'));
    s.engine.commit();
    let marks = 0;
    const items = Array.from({ length: ITEMS }, () => {
      const item = s.engine.createElement('view');
      s.engine.setClasses(item, 'item');
      let dirty = false;
      Object.defineProperty(item, 'hasDirty', {
        get: () => dirty,
        set: (value: boolean) => {
          if (value) marks++;
          dirty = value;
        },
      });
      return item;
    });
    for (const item of items) s.engine.appendChild(s.card, item);
    assert.ok(marks < ITEMS * 5, `${marks} marks for ${ITEMS} items`);
    s.engine.setProp(items[0]!, 'testID', 'first');
    s.engine.addClass(items.at(-1)!, 'later');
    assert.equal(s.opacity('first'), 0.5);
  });

  it('matches again what comes after many boxes asked :has() in one pass of the list', () => {
    // `.item:has(.mark) ~ .item`, the other way round: each item before a change is asked again,
    // and what comes after each one with it.
    const sheet = after('later-sibling', 'later');
    const s = list({
      ...sheet,
      rules: [
        ...sheet.rules,
        {
          compounds: [
            { classes: ['item'], has: [{ any: [{ classes: ['mark'] }] }] },
            { classes: ['item'] },
          ],
          combinators: ['later-sibling'],
          specificity: 3000,
          order: 1,
          declarations: { opacity: 0.25 },
        },
      ],
    });
    s.work();
    let marks = 0;
    for (const item of s.items) {
      let dirty = item.ownDirty;
      Object.defineProperty(item, 'ownDirty', {
        get: () => dirty,
        set: (value: boolean) => {
          if (value) marks++;
          dirty = value;
        },
      });
    }
    s.engine.addClass(s.items.at(-1)!, 'later');
    s.work();
    assert.ok(marks < ITEMS * 5, `${marks} marks for ${ITEMS} items`);
    assert.equal(s.opacity('second last'), 0.5);
    s.el('mark', s.items[0]!);
    assert.equal(s.opacity('second last'), 0.25);
    assert.equal(s.opacity('first'), 0.5);
  });

  it('marks again what moved into the place of items taken out before a commit', () => {
    const s = list(after('later-sibling', 'later'));
    s.engine.setProp(s.items[8]!, 'testID', 'moved');
    s.work();
    // A change to the eighth has the seven before it matched again. Two go from the front, and
    // the ninth, which nothing marked, is where the seventh was. What comes after it changes.
    s.engine.addClass(s.items[7]!, 'later');
    s.engine.removeChild(s.card, s.items[0]!);
    s.engine.removeChild(s.card, s.items[1]!);
    s.engine.addClass(s.items.at(-1)!, 'later');
    assert.equal(s.opacity('moved'), 0.5);
  });
});

describe(':has() on a box the styled node is in', () => {
  // A component library's own: `.field:has(.input:focus) .label`, a label moved by what is in
  // the field beside it, and `.group:has(.button) .input`, a field squared off for its button.
  const ABOVE = '.card:has(.action) .title { opacity: 0.5 }';
  const titled = (css = ABOVE) => {
    const s = scene(css);
    const body = s.el('body', s.card);
    const title = s.el('title', body);
    s.engine.setProp(title, 'testID', 'title');
    return { ...s, body, title };
  };

  it('styles the node where the box has what is asked, and not where it has not', () => {
    const s = titled();
    assert.equal(s.opacity('title'), undefined);
    const action = s.el('action', s.card);
    assert.equal(s.opacity('title'), 0.5);
    assert.deepEqual(s.reports, []);
    s.engine.removeChild(s.card, action);
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('follows a class coming to what is in the box, and going', () => {
    const s = titled();
    const button = s.el('button', s.card);
    assert.equal(s.opacity('title'), undefined);
    s.engine.addClass(button, 'action');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeClass(button, 'action');
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('is asked of a parent after >, and of any box above with a space', () => {
    const s = titled(
      '.card:has(.action) > .title { opacity: 0.5 } .card:has(> .mark) .title { opacity: 0.25 }',
    );
    s.el('action', s.card);
    // The title is in the body, which is in the card: no child of the card.
    assert.equal(s.opacity('title'), undefined);
    s.el('mark', s.body);
    assert.equal(s.opacity('title'), undefined);
    s.el('mark', s.card);
    assert.equal(s.opacity('title'), 0.25);
  });

  it('follows what is in a box that a box above the node is asked to be inside', () => {
    // `.body:is(.card:has(.action) *) .title`: the box asked is one the body is in.
    const s = titled('.body:is(.card:has(.action) *) .title { opacity: 0.5 }');
    assert.deepEqual(s.reports, []);
    assert.equal(s.opacity('title'), undefined);
    const button = s.el('button', s.card);
    assert.equal(s.opacity('title'), undefined);
    s.engine.addClass(button, 'action');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeClass(button, 'action');
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('asks nothing more once the sheet that asked is taken away', () => {
    const s = titled('.unused { opacity: 1 }');
    const sheet = compileCss(ABOVE, 'more.css', { onUnsupported: () => {} });
    s.engine.addGlobalSheet(sheet);
    s.el('action', s.card);
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeGlobalSheet(sheet);
    assert.equal(s.opacity('title') ?? null, null);
    const before = s.title.styleCache;
    s.el('action', s.card);
    s.engine.commit();
    assert.equal(s.title.styleCache, before, 'nothing under the box was matched again');
  });

  it('keeps no record of the rules a node matched once the last sheet that asked is gone', () => {
    // The record is what a node matched again is compared with, which nothing needs after.
    const s = titled('.unused { opacity: 1 }');
    const restyled = () => {
      s.engine.setClasses(s.title, s.title.classes!.has('x') ? 'title' : 'title x');
      s.engine.commit();
      return s.title.styleCache!.matched;
    };
    const first = compileCss(ABOVE, 'first.css', { onUnsupported: () => {} });
    const second = compileCss(ABOVE, 'second.css', { onUnsupported: () => {} });
    s.engine.addGlobalSheet(first);
    s.engine.addGlobalSheet(second);
    assert.ok(restyled(), 'kept while a sheet asks');
    s.engine.removeGlobalSheet(first);
    assert.ok(restyled(), 'kept while another still asks');
    s.engine.removeGlobalSheet(second);
    assert.equal(restyled(), undefined, 'not kept once none asks');
    s.engine.addGlobalSheet(first);
    assert.ok(restyled(), 'kept again for a sheet that asks again');
    s.el('action', s.card);
    assert.equal(s.opacity('title'), 0.5);
  });

  it('styles again only what such a rule is for, of all that is in the box', () => {
    const s = titled();
    const other = s.el('other', s.body);
    s.engine.commit();
    const before = other.styleCache;
    s.el('action', s.card);
    assert.equal(s.opacity('title'), 0.5);
    assert.equal(other.styleCache, before, 'what no such rule is for was not resolved again');
  });
});

describe(':has() and the sheet it is in', () => {
  it('takes one beside the styled node, a combinator inside, and a sibling', () => {
    // What each matches is in css-nested-selector.
    for (const css of [
      '.card:has(.action) + .title { opacity: 0.5 }',
      '.card:has(.action) ~ .panel .title { opacity: 0.5 }',
      '.card:has(.a .b) { opacity: 0.5 }',
      '.card:has(+ .next) { opacity: 0.5 }',
      '.card:has(~ .later) { opacity: 0.5 }',
    ]) {
      const s = scene(css);
      assert.deepEqual(s.reports, [], css);
      assert.equal((s.sheet as { rules: unknown[] }).rules.length, 1, css);
    }
  });

  it('applies nothing for a :has() inside another, whatever the box holds', () => {
    for (const css of [
      '.card:has(.a:has(.b)) { opacity: 0.5 }',
      '.card:has(.a:not(:has(.b))) { opacity: 0.5 }',
      '.card:has(:is(.a:has(.b))) { opacity: 0.5 }',
      '.card:has(> .a:has(.b)) { opacity: 0.5 }',
    ]) {
      const s = scene(css);
      s.el('b', s.el('a', s.card));
      s.el('a', s.card);
      assert.equal(s.sheet.rules.length, 0, css);
      assert.equal(s.opacity('card'), undefined, css);
    }
  });

  it('marks a sheet that asks, and no other', () => {
    assert.equal((scene(RULE).sheet as { has?: true }).has, true);
    assert.equal((scene('.card { opacity: 1 }').sheet as { has?: true }).has, undefined);
  });
});

describe('Tailwind', () => {
  it('reads has-[...], has-[>...] and has-data-[...]', () => {
    const classes = 'has-[.action]:opacity-50 has-data-[slot=media]:p-4 has-[>image]:m-2';
    const s = scene(flattenTailwind(build('native', classes)));
    s.engine.setClasses(s.card, classes);
    const props = () => {
      s.engine.commit();
      return s.card.styleCache!.style;
    };
    assert.equal(s.opacity('card'), undefined);
    const child = s.el('action', s.card);
    assert.equal(s.opacity('card'), 0.5);
    s.engine.setProp(child, 'data-slot', 'media');
    assert.equal(props()['paddingTop'], 16);
    assert.equal(props()['marginTop'], undefined);
    s.el('', s.card, 'image');
    assert.equal(props()['marginTop'], 8);
    assert.deepEqual(s.reports, []);
  });
});
