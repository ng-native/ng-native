/**
 * Selectors that ask about a node's place among its siblings.
 *
 * These are the ones a list is written with: a separator on every row but the last, a rounded
 * corner on the first, alternating rows. Nothing about native prevents them - the engine has the
 * whole tree - they had simply never been built.
 *
 * The cost is not in matching them but in knowing when a match has *stopped* being true: adding a
 * row changes what its new neighbours match, and nothing about those neighbours changed. So a
 * sheet that uses one of these says so, and the engine invalidates a parent's children when its
 * child list moves - only then.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import {
  cleanup,
  createFakeFabric,
  render,
  settle,
  type BoundQueries,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

describe('compiling a structural selector', () => {
  const compoundOf = (selector: string) =>
    compileCss(`${selector} { color: red }`, 'test').rules[0].compounds.at(-1);

  it('reads the four position pseudo-classes as the counts they stand for', () => {
    assert.deepEqual(compoundOf('view:first-child').nth, [{ a: 0, b: 1 }]);
    assert.deepEqual(compoundOf('view:last-child').nth, [{ a: 0, b: 1, fromEnd: true }]);
    assert.deepEqual(compoundOf('view:nth-child(2n + 1)').nth, [{ a: 2, b: 1 }]);
    assert.deepEqual(compoundOf('view:nth-last-child(3)').nth, [{ a: 0, b: 3, fromEnd: true }]);
  });

  it('reads only-child as the two tests it is', () => {
    assert.deepEqual(compoundOf('view:only-child').nth, [
      { a: 0, b: 1 },
      { a: 0, b: 1, fromEnd: true },
    ]);
  });

  it('reads empty, which asks about a node rather than its siblings', () => {
    assert.equal(compoundOf('view:empty').empty, true);
  });

  it('marks the sheet, so the engine only pays for invalidation where it is used', () => {
    assert.equal(compileCss('view:first-child { color: red }', 'test').structural, true);
    assert.equal(compileCss('view + view { color: red }', 'test').structural, true);
    assert.equal(compileCss('view .a { color: red }', 'test').structural, undefined);
  });

  it('takes the two sibling combinators', () => {
    const { combinators } = compileCss('view + text { color: red }', 'test').rules[0];
    assert.deepEqual(combinators, ['next-sibling']);
    assert.deepEqual(compileCss('view ~ text { color: red }', 'test').rules[0].combinators, [
      'later-sibling',
    ]);
  });
});

describe('a sibling test inside :is(), the shape Tailwind writes peer-* as', () => {
  // `peer-focus:x` is `.x:is(:where(.peer):focus ~ *)`: an element with an earlier sibling that
  // matches. The compiler refused any combinator inside `:is()` but the ancestor form, so every
  // peer-* class was dropped with "':is()' cannot contain a combinator".
  it('reads it as the later-sibling selector it means', () => {
    const rule = compileCss('.x:is(:where(.peer):focus ~ *) { color: red }', 'test').rules[0];
    assert.deepEqual(rule.combinators, ['later-sibling']);
    assert.deepEqual(rule.compounds[0], {
      classes: [],
      is: [[{ classes: ['peer'] }]],
      pseudo: ['focus'],
    });
    assert.deepEqual(rule.compounds[1].classes, ['x']);
    assert.equal(rule.compounds[1].is, undefined, 'nothing is left of the :is()');
  });

  it('takes a list of compounds before the combinator, as peer-focus: writes', () => {
    const rule = compileCss(
      '.x:is(:is(:where(.peer):focus, :where(.peer)[data-focus]) ~ *) { color: red }',
      'test',
    ).rules[0];
    assert.deepEqual(rule.combinators, ['later-sibling']);
    assert.equal(rule.compounds[0].is.length, 1);
    assert.equal(rule.compounds[0].is[0].length, 2, 'either compound');
  });

  it('keeps what came before it, whose relation to the sibling is the same', () => {
    // `.list > .x:is(.peer ~ *)`: the peer is a child of `.list` exactly when `.x` is.
    const rule = compileCss('.list > .x:is(.peer ~ *) { color: red }', 'test').rules[0];
    assert.deepEqual(rule.combinators, ['child', 'later-sibling']);
    assert.deepEqual(
      rule.compounds.map((c: { classes: string[] }) => c.classes),
      [['list'], ['peer'], ['x']],
    );
  });

  it('has the specificity :is() gives it: the sibling compound, plus the element', () => {
    assert.equal(
      compileCss('.x:is(.peer:focus ~ *) { color: red }', 'test').rules[0].specificity,
      compileCss('.peer:focus ~ .x { color: red }', 'test').rules[0].specificity,
    );
    assert.equal(
      compileCss('.x:where(.peer ~ *) { color: red }', 'test').rules[0].specificity,
      compileCss('.x { color: red }', 'test').rules[0].specificity,
    );
  });

  it('marks the sheet as asking about siblings', () => {
    assert.equal(compileCss('.x:is(.peer ~ *) { color: red }', 'test').structural, true);
  });

  it('still refuses a sibling test after a sibling combinator, which would reorder the two', () => {
    assert.throws(() => compileCss('.a ~ .x:is(.peer ~ *) { color: red }', 'test'), /combinator/);
  });
});

describe("a sibling's state and classes", () => {
  // A later sibling's style depends on its peer, and only the peer changes: focus moves to it, a
  // class arrives on it. Only the peer and its subtree were restyled, so the sibling kept what it
  // had matched before.
  const build = (css: string) => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'test') });
    const list = engine.createElement('view');
    const peer = engine.createElement('view');
    const between = engine.createElement('view');
    const label = engine.createElement('text');
    engine.setClasses(peer, 'peer');
    engine.setClasses(label, 'label');
    engine.appendChild(engine.root, list);
    for (const child of [peer, between, label]) engine.appendChild(list, child);
    engine.commit();
    return { engine, fabric, peer, label };
  };

  /** The props the last commit gave a node. */
  const lastProps = (fabric: FakeFabric, node: unknown): Record<string, unknown> => {
    const all = (n: FakeFabricNode): FakeFabricNode[] => [n, ...n.children.flatMap(all)];
    const found = fabric.committed.flatMap(all).find((n) => n.instanceHandle === node);
    assert.ok(found, 'committed');
    return found.props;
  };

  it('restyles a later sibling when focus reaches its peer, and again when it leaves', () => {
    const { engine, peer, label, fabric } = build('.peer:focus ~ .label { opacity: 0.5 }');
    const labelProps = () => lastProps(fabric, label);
    assert.equal(labelProps()['opacity'], undefined);

    engine.dispatchEvent(peer, 'topFocus', {});
    assert.equal(labelProps()['opacity'], 0.5, 'focused');

    engine.dispatchEvent(peer, 'topBlur', {});
    assert.equal(labelProps()['opacity'], null, 'blurred');
  });

  it('restyles a later sibling when its peer gains a class', () => {
    const { engine, peer, label, fabric } = build('.peer.on + * + .label { opacity: 0.5 }');
    engine.setClasses(peer, 'peer on');
    engine.commit();
    assert.equal(lastProps(fabric, label)['opacity'], 0.5);
  });
});

describe('matching one', () => {
  let Host: Type<{ count: { set(value: number): void } }>;
  let queries: BoundQueries;
  let host: { count: { set(value: number): void } };

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/structural.ts', import.meta.url)),
    );
    Host = mod['StructuralHost'] as Type<{ count: { set(value: number): void } }>;
  });

  const boot = async () => {
    const result = await render(Host);
    queries = result;
    host = result.instance;
  };

  const rows = () => queries.getAllByTestId(/^row/);

  it('picks the first and the last of a list', async () => {
    await boot();
    const all = rows();
    assert.equal(all.length, 3);
    assert.equal(all[0]!.props['borderTopWidth'], 2, 'the first row');
    assert.equal(all[1]!.props['borderTopWidth'], undefined);
    assert.equal(all[2]!.props['borderBottomWidth'], 4, 'the last row');
  });

  it('counts with nth-child, which is how a list stripes itself', async () => {
    await boot();
    const all = rows();
    assert.equal(all[0]!.props['backgroundColor'], 'rgb(238, 238, 238)');
    assert.equal(all[1]!.props['backgroundColor'], undefined);
    assert.equal(all[2]!.props['backgroundColor'], 'rgb(238, 238, 238)');
  });

  it('separates with the adjacent sibling combinator', async () => {
    // `.row + .row` is the separator idiom: a line between rows and not above the first.
    await boot();
    const all = rows();
    assert.equal(all[0]!.props['marginTop'], undefined);
    assert.equal(all[1]!.props['marginTop'], 8);
    assert.equal(all[2]!.props['marginTop'], 8);
  });

  it('re-matches the neighbours when a row is added, though nothing about them changed', async () => {
    // The whole difficulty of these selectors. The old last row is no longer the last, and
    // nothing in it moved: only its parent's child list did.
    await boot();
    host.count.set(4);
    await settle();

    const all = rows();
    assert.equal(all.length, 4);
    // Null rather than absent: the prop has to be cleared on the native node it was set on.
    assert.equal(all[2]!.props['borderBottomWidth'], null, 'no longer the last');
    assert.equal(all[3]!.props['borderBottomWidth'], 4, 'and the new row is');
  });

  it('re-matches when a row is removed', async () => {
    await boot();
    host.count.set(2);
    await settle();

    const all = rows();
    assert.equal(all.length, 2);
    assert.equal(all[1]!.props['borderBottomWidth'], 4);
  });
});

describe('a position test that is not at the top of its compound', () => {
  // `.row:not(:last-child)` is the separator idiom written the other way round, and `:empty` asks
  // about a child list too. The engine only restyles on a child-list change for a sheet marked as
  // asking about position, so these need the mark as much as `:last-child` does.
  const lastProps = (fabric: FakeFabric, node: unknown): Record<string, unknown> => {
    const all = (n: FakeFabricNode): FakeFabricNode[] => [n, ...n.children.flatMap(all)];
    const found = fabric.committed.flatMap(all).find((n) => n.instanceHandle === node);
    assert.ok(found, 'committed');
    return found.props;
  };

  it('marks the sheet when the test is inside :not() or :is(), or is :empty', () => {
    assert.equal(compileCss('.a:not(:last-child) { color: red }', 'test').structural, true);
    assert.equal(compileCss('.a:is(:first-child, .b) { color: red }', 'test').structural, true);
    assert.equal(compileCss('.a:empty { color: red }', 'test').structural, true);
  });

  it('restyles the old last row when a row is added after it', () => {
    const fabric = createFakeFabric();
    const css = '.row:not(:last-child) { border-bottom-width: 1px }';
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'test') });
    const list = engine.createElement('view');
    const first = engine.createElement('view');
    engine.setClasses(first, 'row');
    engine.appendChild(engine.root, list);
    engine.appendChild(list, first);
    engine.commit();
    assert.equal(lastProps(fabric, first)['borderBottomWidth'], undefined);

    const second = engine.createElement('view');
    engine.setClasses(second, 'row');
    engine.appendChild(list, second);
    engine.commit();
    assert.equal(lastProps(fabric, first)['borderBottomWidth'], 1, 'no longer the last');
  });

  it('restyles an :empty node when a child arrives', () => {
    const fabric = createFakeFabric();
    const css = '.list:empty { opacity: 0.5 }';
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'test') });
    const list = engine.createElement('view');
    engine.setClasses(list, 'list');
    engine.appendChild(engine.root, list);
    engine.commit();
    assert.equal(lastProps(fabric, list)['opacity'], 0.5);

    engine.appendChild(list, engine.createElement('view'));
    engine.commit();
    assert.equal(lastProps(fabric, list)['opacity'], null, 'no longer empty');
  });

  it('reads text of no length as nothing, and restyles when the text comes and goes', () => {
    // `<span>{{ label }}</span>` with nothing to show yet: a text node, and no text in it. A
    // browser's `:empty` matches, which is how a stylesheet keeps the line such a box is on.
    const fabric = createFakeFabric();
    const css = '.list:empty { opacity: 0.5 }';
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'test') });
    const list = engine.createElement('view');
    engine.setClasses(list, 'list');
    engine.appendChild(engine.root, list);
    const text = engine.createText('');
    engine.appendChild(list, text);
    engine.commit();
    assert.equal(lastProps(fabric, list)['opacity'], 0.5, 'empty with a text node of no length');

    engine.setText(text, 'One');
    engine.commit();
    assert.equal(lastProps(fabric, list)['opacity'], null, 'no longer empty');

    engine.setText(text, '');
    engine.commit();
    assert.equal(lastProps(fabric, list)['opacity'], 0.5, 'empty again');

    // A space is text: only no characters at all is nothing.
    engine.setText(text, ' ');
    engine.commit();
    assert.equal(lastProps(fabric, list)['opacity'], null);
  });

  // What a later sibling matches can hang on whether this node is empty, though nothing about the
  // sibling moved: `.box:empty + .spacer`.
  for (const combinator of ['+', '~']) {
    it(`restyles a sibling after :empty (${combinator}) when the node gains its first child and loses its last`, () => {
      const fabric = createFakeFabric();
      const css = `.spacer { height: 0 } .box:empty ${combinator} .spacer { height: 20px }`;
      const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'test') });
      const box = engine.createElement('view');
      engine.setClasses(box, 'box');
      // The anchor an @if leaves, which :empty does not see.
      engine.appendChild(box, engine.createAnchor());
      const spacer = engine.createElement('view');
      engine.setClasses(spacer, 'spacer');
      engine.appendChild(engine.root, box);
      engine.appendChild(engine.root, spacer);
      engine.commit();
      assert.equal(lastProps(fabric, spacer)['height'], 20);

      const child = engine.createElement('view');
      engine.insertBefore(box, child, box.children[0]!);
      engine.commit();
      assert.equal(lastProps(fabric, spacer)['height'], 0, 'the box is no longer empty');

      engine.removeChild(box, child);
      engine.commit();
      assert.equal(lastProps(fabric, spacer)['height'], 20, 'and is empty again');
    });
  }

  it('restyles a sibling after :empty when the child is appended, not inserted', () => {
    const fabric = createFakeFabric();
    const css = '.spacer { height: 0 } .box:empty + .spacer { height: 20px }';
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'test') });
    const box = engine.createElement('view');
    engine.setClasses(box, 'box');
    const spacer = engine.createElement('view');
    engine.setClasses(spacer, 'spacer');
    engine.appendChild(engine.root, box);
    engine.appendChild(engine.root, spacer);
    engine.commit();
    engine.appendChild(box, engine.createText('content'));
    engine.commit();
    assert.equal(lastProps(fabric, spacer)['height'], 0);
  });

  it('counts a node holding only the anchor of an empty @for or @if as :empty', () => {
    // The anchor is a comment on the web, and :empty ignores comments. A list whose @for has no
    // rows holds nothing else.
    const fabric = createFakeFabric();
    const css = '.list:empty { opacity: 0.5 }';
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'test') });
    const list = engine.createElement('view');
    engine.setClasses(list, 'list');
    engine.appendChild(engine.root, list);
    engine.appendChild(list, engine.createAnchor());
    engine.commit();
    assert.equal(lastProps(fabric, list)['opacity'], 0.5);
  });
});

describe('what a child list changing has styled again', () => {
  /** A list of five rows under `css`, committed, and what each row is committed with. */
  function list(css: string) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const parent = engine.createElement('view');
    engine.appendChild(engine.root, parent);
    const row = () => {
      const node = engine.createElement('view');
      engine.setClasses(node, 'row');
      return node;
    };
    const rows = Array.from({ length: 5 }, row);
    for (const node of rows) engine.appendChild(parent, node);
    engine.commit();
    /** Which of the rows there now are marked to be styled again, before the commit that does it. */
    const marked = () => parent.children.map((child) => (child.styleDirty ? 'x' : '.')).join('');
    const widths = () => {
      engine.commit();
      return fabric.committed[0]!.children.map((view) => view.props['borderTopWidth'] ?? 0);
    };
    return { engine, parent, rows, row, marked, widths };
  }

  const ENDS =
    '.row:first-child { border-top-width: 1px } .row:last-child { border-top-width: 9px } ' +
    '.row:not(:last-child):not(:first-child) { border-top-width: 5px }';

  it('is the rows at each end, where every sheet asks only which is first and which last', () => {
    const s = list(ENDS);
    assert.deepEqual(s.widths(), [1, 5, 5, 5, 9]);
    s.engine.appendChild(s.parent, s.row());
    assert.equal(s.marked(), 'xx..xx', 'the two at each end, and none between');
    assert.deepEqual(s.widths(), [1, 5, 5, 5, 5, 9]);
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[0]!);
    assert.equal(s.marked(), 'xx...xx');
    assert.deepEqual(s.widths(), [1, 5, 5, 5, 5, 5, 9]);
  });

  it('leaves the list itself as it was styled, unless it stops or starts being empty', () => {
    // Styled again, everything under it would be resolved again with it: every row of a list.
    const s = list(`${ENDS} .list:empty { opacity: 0.5 }`);
    s.engine.setClasses(s.parent, 'list');
    s.engine.commit();
    s.engine.appendChild(s.parent, s.row());
    assert.equal(s.parent.styleDirty, false);
    s.engine.commit();
    for (const node of [...s.parent.children]) s.engine.removeChild(s.parent, node);
    assert.equal(s.parent.styleDirty, true, 'its last row has gone');
    s.engine.commit();
    assert.equal(s.engine.root.children[0], s.parent);
    s.engine.appendChild(s.parent, s.row());
    assert.equal(s.parent.styleDirty, true, 'and its first has come');
  });

  it('has no rule to follow for a :has() on a box beside the one styled, which is refused', () => {
    // `.box:has(> .active) + .spacer` would hang what follows a box on what the box holds. The
    // compiler takes `:has()` on the element a rule styles and nowhere else, and says so, so a
    // child list changing has nothing beside its parent to style again.
    const refused: string[] = [];
    const sheet = compileCss('.box:has(> .active) + .spacer { opacity: 0.5 }', 'app.css', {
      onUnsupported: (message: string) => refused.push(message),
    }) as { rules: unknown[] };
    assert.deepEqual(sheet.rules, []);
    assert.equal(refused.length, 1);
  });

  it('is every row for a host whose own sheet counts, given while it was out of the tree', () => {
    const s = list(ENDS);
    const host = s.row();
    s.engine.setHostSheet(
      host,
      compileCss(':host(:nth-child(2)) { opacity: 0.5 }', 'host') as never,
    );
    s.engine.insertBefore(s.parent, host, s.parent.children[0]!);
    assert.equal(s.marked(), 'xxxxxx');
  });

  it('follows a row leaving either end, and one put in the middle', () => {
    const s = list(ENDS);
    s.engine.removeChild(s.parent, s.rows[4]!);
    assert.deepEqual(s.widths(), [1, 5, 5, 9]);
    s.engine.removeChild(s.parent, s.rows[0]!);
    assert.deepEqual(s.widths(), [1, 5, 9]);
    s.engine.insertBefore(s.parent, s.row(), s.rows[2]!);
    assert.equal(s.marked(), 'xxxx', 'the row put in is styled, with the ends');
    assert.deepEqual(s.widths(), [1, 5, 5, 9]);
  });

  it('follows a list coming down to one row, which is first and last, and to none', () => {
    const s = list('.row:only-child { border-top-width: 7px }');
    for (const node of s.rows.slice(1)) s.engine.removeChild(s.parent, node);
    assert.deepEqual(s.widths(), [7]);
    s.engine.appendChild(s.parent, s.row());
    assert.deepEqual(s.widths(), [0, 0]);
  });

  it('passes over what is not an element at an end: text is no first child', () => {
    const s = list(ENDS);
    s.engine.insertBefore(s.parent, s.engine.createText('x'), s.parent.children[0]!);
    s.engine.commit();
    s.engine.appendChild(s.parent, s.row());
    const elements = s.parent.children.filter((child) => child.kind === 'element');
    assert.equal(elements.map((child) => (child.styleDirty ? 'x' : '.')).join(''), 'xx..xx');
  });

  it('is every row where a sheet counts them, or asks about the one beside', () => {
    for (const css of [
      '.row:nth-child(odd) { border-top-width: 3px }',
      '.row:nth-last-child(2) { border-top-width: 3px }',
      '.row + .row { border-top-width: 3px }',
      '.row ~ .row { border-top-width: 3px }',
      '.row:not(:nth-child(2n)) { border-top-width: 3px }',
    ]) {
      const s = list(css);
      s.engine.insertBefore(s.parent, s.row(), s.parent.children[0]!);
      assert.equal(s.marked(), 'xxxxxx', css);
    }
    const counted = list('.row:nth-child(odd) { border-top-width: 3px }');
    counted.engine.insertBefore(counted.parent, counted.row(), counted.parent.children[0]!);
    assert.deepEqual(counted.widths(), [3, 0, 3, 0, 3, 0]);
  });

  it('is every row once a sheet that counts them is added to one that does not', () => {
    const s = list(ENDS);
    s.engine.addGlobalSheet(compileCss('.row:nth-child(2) { opacity: 0.5 }', 'more.css') as never);
    s.engine.commit();
    s.engine.appendChild(s.parent, s.row());
    assert.equal(s.marked(), 'xxxxxx');
  });
});
