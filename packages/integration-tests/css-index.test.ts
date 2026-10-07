/**
 * Which rules a node is even considered against.
 *
 * The resolver used to walk every rule for every node, which is fine for a component's dozen and
 * hopeless for a utility sheet's hundreds: a Tailwind app would spend a million match attempts
 * mounting one screen. So rules are bucketed by the most selective simple selector in their
 * rightmost compound - what a browser calls the key selector - and a node only sees the buckets
 * its own classes, name and id can reach, plus the ones nothing can be keyed on.
 *
 * These tests are about the *bucketing*, since the matching itself is covered elsewhere and must
 * not change: a rule that would have matched before still has to be offered.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  candidateRules,
  indexRules,
  ruleKey,
  ruleKeys,
  styleStats,
  StyleResolver,
  type StyleSheet,
  type StyleTarget,
} from '../fabric/src/css.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(
    source: string,
    context?: string,
    options?: { onUnsupported?: (message: string) => void },
  ): StyleSheet;
};

const sheetOf = (css: string) => compileCss(css, 'test');
const keys = (css: string) => sheetOf(css).rules.map((rule) => ruleKey(rule));

describe('the key selector a rule is bucketed by', () => {
  it('is the class of a single-class selector', () => {
    assert.deepEqual(keys('.card { flex: 1 }'), ['class:card']);
  });

  it('is the element name when there is no class', () => {
    assert.deepEqual(keys('view { flex: 1 }'), ['type:view']);
  });

  it('is the id when there is one', () => {
    assert.deepEqual(keys('#header { flex: 1 }'), ['id:header']);
  });

  it('is the rightmost compound, because matching counts leftwards', () => {
    assert.deepEqual(keys('.card .title { flex: 1 }'), ['class:title']);
    assert.deepEqual(keys('.card > view { flex: 1 }'), ['type:view']);
  });

  it('prefers a class over the element name in the same compound', () => {
    assert.deepEqual(keys('view.card { flex: 1 }'), ['class:card']);
  });

  it('falls back to the universal bucket for anything not keyed on a name', () => {
    // `:host` and `*` can match a node whose classes say nothing, so they have to be offered to
    // every node or they would silently stop applying. So is a test of the `class` attribute,
    // which is no prop of the node's to look it up by.
    assert.deepEqual(keys('[class~="a"] { flex: 1 }'), ['*']);
    assert.deepEqual(keys(':host { flex: 1 }'), ['*']);
    assert.deepEqual(keys('* { flex: 1 }'), ['*']);
  });

  it('files a rule that names its element by an attribute alone under the attribute', () => {
    // A headless library styles by attribute and never by class: `[ngpButton]`. In the universal
    // bucket every one of its rules is tried against every element of the screen.
    assert.deepEqual(keys('[data-open] { flex: 1 }'), ['attr:data-open']);
    assert.deepEqual(keys('[ngpButton][data-press] { flex: 1 }'), ['attr:ngpButton']);
    assert.deepEqual(keys('.a[data-open] { flex: 1 }'), ['class:a']);
  });

  it('files a rule for anything inside an element with a class under that class', () => {
    // `.item:focus *`, and Tailwind's `group-focus:` on an element with no class of its own:
    // tried against every element of the screen, each one walks to the root to find no `.item`.
    assert.deepEqual(keys('.row * { flex: 1 }'), ['under:row']);
    assert.deepEqual(keys(':is(.group:focus *) { flex: 1 }'), ['under:group']);
    const either = sheetOf(':is(:is(.s, .t) *) { flex: 1 }').rules.map((rule) => ruleKeys(rule));
    assert.deepEqual(either, [['under:s', 'under:t']]);
    assert.deepEqual(keys('view * { flex: 1 }'), ['*']);
  });

  it('gives every selector in a list its own bucket', () => {
    // A selector list compiles to one rule each, and the compiler emits them in specificity
    // order - `view` before `.a` - which is the order the cascade wants anyway.
    assert.deepEqual(keys('.a, view, [x] { flex: 1 }'), ['type:view', 'class:a', 'attr:x']);
  });
});

describe('a rule that names no key of its own', () => {
  const keysOf = (css: string) => sheetOf(css).rules.map((rule) => ruleKeys(rule));

  it('is filed under the class of the parent it has to be a child of', () => {
    // `.row > *` says nothing of the node and everything of its parent: offered to the children
    // of an element with the class, where the universal bucket offers it to every node there is.
    assert.deepEqual(keysOf('.row > * { flex: 1 }'), [['in:row']]);
    assert.deepEqual(keysOf('.row > [data-open] { flex: 1 }'), [['in:row']]);
    // A name of its own is still the better key, and a descendant is not a child.
    assert.deepEqual(keysOf('.row > view { flex: 1 }'), [['type:view']]);
    assert.deepEqual(keysOf('view * { flex: 1 }'), [['*']]);
    assert.deepEqual(keysOf('view > * { flex: 1 }'), [['*']]);
  });

  it('is filed under each compound a bare :is() takes, where every one has a key', () => {
    assert.deepEqual(keysOf(':is(.a, #b, text) { flex: 1 }'), [['class:a', 'id:b', 'type:text']]);
    // One of them could be any node, so the rule could be any node's.
    assert.deepEqual(keysOf(':is(.a, [data-open]) { flex: 1 }'), [['*']]);
  });
});

describe('the candidates a node is offered', () => {
  const entriesOf = (css: string) => {
    const sheet = sheetOf(css);
    return sheet.rules.map((rule, order) => ({ rule, sheet, weight: order }));
  };
  const target = (name: string, classes: string[], props: Record<string, unknown> = {}) =>
    ({
      name,
      parent: null,
      classes: new Set(classes),
      props,
      sheet: null,
      hostSheet: null,
      styleCache: null,
      styleDirty: false,
    }) as unknown as StyleTarget;

  it('offers the rules keyed on what the node is, and nothing else', () => {
    const entries = entriesOf('.a { flex: 1 } .b { flex: 2 } view { flex: 3 } text { flex: 4 }');
    const index = indexRules(entries);
    const offered = candidateRules(target('view', ['a']), index);
    assert.deepEqual(
      offered.map((entry) => ruleKey(entry.rule)),
      ['type:view', 'class:a'],
      'both buckets, still in the order the sheet had them',
    );
  });

  it('always offers the universal bucket', () => {
    const entries = entriesOf('* { flex: 1 } .other { flex: 2 }');
    const offered = candidateRules(target('view', []), indexRules(entries));
    assert.equal(offered.length, 1);
    assert.equal(ruleKey(offered[0]!.rule), '*');
  });

  it('offers a rule filed under an attribute to the elements that have it, and no other', () => {
    const index = indexRules(entriesOf('[data-open] { flex: 1 } .other { flex: 2 }'));
    const open = { ...target('view', []), props: { 'data-open': '' } } as StyleTarget;
    const shut = { ...target('view', []), props: { 'data-open': false } } as StyleTarget;
    assert.equal(candidateRules(open, index).length, 1);
    assert.equal(candidateRules(shut, index).length, 0);
    assert.equal(candidateRules(target('view', []), index).length, 0);
  });

  it('offers a rule filed under an ancestor\u2019s class to what is inside one, however deep', () => {
    const index = indexRules(entriesOf('.row * { flex: 1 } .other { flex: 2 }'));
    const row = target('view', ['row']);
    const child = { ...target('view', []), parent: row } as StyleTarget;
    const deep = { ...target('view', []), parent: child } as StyleTarget;
    assert.equal(candidateRules(deep, index).length, 1);
    assert.equal(candidateRules(child, index).length, 1);
    assert.equal(candidateRules(row, index).length, 0, 'not the element itself');
    assert.equal(candidateRules(target('view', []), index).length, 0);
  });

  it('keeps the order the rules were merged in, across buckets', () => {
    // The cascade depends on it: the list is sorted by weight before it is indexed, and later
    // simply wins. Collecting from several buckets must not shuffle that.
    const entries = entriesOf('.a { flex: 1 } view { flex: 2 } .b { flex: 3 }');
    const offered = candidateRules(target('view', ['a', 'b']), indexRules(entries));
    assert.deepEqual(
      offered.map((entry) => entry.weight),
      [0, 1, 2],
      'the weights are the positions in the merged list, and they come back ascending',
    );
  });

  it('offers a rule filed under the class of its parent to that element\u2019s children alone', () => {
    const index = indexRules(entriesOf('.row > * { flex: 1 } .other { flex: 2 }'));
    const row = target('view', ['row']);
    const child = { ...target('view', []), parent: row } as StyleTarget;
    assert.equal(candidateRules(child, index).length, 1);
    assert.equal(candidateRules(row, index).length, 0, 'not the element itself');
    assert.equal(
      candidateRules(target('view', []), index).length,
      0,
      'nor anybody else\u2019s child',
    );
  });

  it('offers a rule filed under two keys once to a node that has both', () => {
    const index = indexRules(entriesOf(':is(.a, .b) { flex: 1 }'));
    assert.equal(candidateRules(target('view', ['a', 'b']), index).length, 1);
    assert.equal(candidateRules(target('view', ['b']), index).length, 1);
  });

  it('puts the rules of several indexes in the order it is given for them', () => {
    const first = indexRules(entriesOf('.a { width: 1px } .a { width: 2px }'));
    const second = indexRules(entriesOf('.a { width: 3px }'), undefined, 100);
    const heaviest = candidateRules(target('view', ['a']), [second, first]);
    // By place with no order given: each index was filed from where it was told to start.
    assert.deepEqual(
      heaviest.map((entry) => entry.rule.declarations['width']),
      [1, 2, 3],
    );
  });

  it('offers a rule once, however many of its selectors could reach the node', () => {
    const entries = entriesOf('.a, .b { flex: 1 }');
    const offered = candidateRules(target('view', ['a', 'b']), indexRules(entries));
    assert.equal(offered.length, 2, 'a selector list is two rules, and each is offered once');
  });
});

describe('a rule that translated to nothing', () => {
  it('is not kept, so it is never a candidate', () => {
    // Tailwind's theme rules are custom properties, substituted at build time, and its resets are
    // browser-only properties this engine drops. Either way what is left is an empty `:root` or
    // `*` rule - no key class, so the bucket every single node is offered.
    const sheet = compileCss(
      '* { -webkit-font-smoothing: antialiased }\n.p { padding-top: 4px }',
      'test',
      {
        onUnsupported: () => {},
      },
    );
    assert.deepEqual(
      sheet.rules.map((rule) => rule.compounds.at(-1)?.classes),
      [['p']],
    );
  });

  it('still keeps a rule that only defines custom properties', () => {
    // Empty of declarations, but not empty: the tokens are the point of the rule.
    const sheet = compileCss(':root { --brand: red }', 'test', { onUnsupported: () => {} });
    assert.equal(sheet.rules.length, 1);
  });
});

describe('a sheet added after others are filed', () => {
  const node = (_resolver: StyleResolver, classes: string[]): StyleTarget =>
    ({
      name: 'view',
      kind: 'element',
      parent: null,
      children: [],
      classes: new Set(classes),
      props: {},
      sheet: null,
      hostSheet: null,
      styleCache: null,
      styleDirty: true,
    }) as unknown as StyleTarget;

  it('is filed on its own: nothing filed before it is filed again', () => {
    // A library adds a sheet for each of its components as the component first renders, dozens
    // on one screen. Filing every sheet again for each was most of what a first render cost.
    const global = sheetOf(
      Array.from({ length: 50 }, (_, i) => `.g${i} { width: ${i}px }`).join(' '),
    );
    const resolver = new StyleResolver(global, { width: 400, height: 800, colorScheme: 'light' });
    resolver.resolve(node(resolver, ['g1']), 1);
    const before = styleStats.rulesFiled;
    resolver.addGlobalSheet(sheetOf('.late { width: 7px } .later { width: 8px }'));
    const late = resolver.resolve(node(resolver, ['late', 'g1']), 2);
    assert.equal(styleStats.rulesFiled - before, 2);
    assert.equal(late.style['width'], 7, 'and it wins a tie, as the sheet that came last');
  });

  it('files them all again when it takes the place of one that was there', () => {
    const resolver = new StyleResolver(sheetOf('.g { width: 1px }'), {
      width: 400,
      height: 800,
      colorScheme: 'light',
    });
    const first = sheetOf('.a { width: 2px }');
    resolver.addGlobalSheet(first);
    assert.equal(resolver.resolve(node(resolver, ['a']), 1).style['width'], 2);
    const second = sheetOf('.a { width: 3px }');
    resolver.addGlobalSheet(second, first);
    assert.equal(resolver.resolve(node(resolver, ['a']), 2).style['width'], 3);
    resolver.removeGlobalSheet(second);
    assert.equal(resolver.resolve(node(resolver, ['a']), 3).style['width'], undefined);
  });
});
