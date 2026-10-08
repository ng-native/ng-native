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
  /** A list of rows under `css`, five unless told, committed, and what each is committed with. */
  function list(css: string, count = 5) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const parent = engine.createElement('view');
    engine.appendChild(engine.root, parent);
    const row = () => {
      const node = engine.createElement('view');
      engine.setClasses(node, 'row');
      return node;
    };
    const rows = Array.from({ length: count }, row);
    for (const node of rows) engine.appendChild(parent, node);
    engine.commit();
    /** Which of the rows there now are marked to be styled again, before the commit that does it. */
    const marked = () =>
      parent.children.map((child) => (child.styleDirty || child.stateDirty ? 'x' : '.')).join('');
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
    assert.equal(
      elements.map((child) => (child.styleDirty || child.stateDirty ? 'x' : '.')).join(''),
      'xx..xx',
    );
  });

  it('is the rows after the change where a sheet counts from the start, with the ends', () => {
    // A row's place from the start hangs on the rows before it, and on none after.
    for (const css of [
      '.row:nth-child(odd) { border-top-width: 3px }',
      '.row:not(:nth-child(2n)) { border-top-width: 3px }',
      '.row:is(:nth-child(odd)) { border-top-width: 3px }',
    ]) {
      const s = list(css, 8);
      s.engine.appendChild(s.parent, s.row());
      assert.equal(s.marked(), 'xx.....xx', `${css}: a row at the end moves none before it`);
      assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3]);
      s.engine.insertBefore(s.parent, s.row(), s.parent.children[5]!);
      assert.equal(s.marked(), 'xx...xxxxx', `${css}: one in the middle moves those after it`);
      assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3, 0]);
      s.engine.removeChild(s.parent, s.parent.children[4]!);
      assert.equal(s.marked(), 'xx..xxxxx', `${css}: as does one leaving the middle`);
      assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3]);
      s.engine.removeChild(s.parent, s.parent.children[8]!);
      assert.equal(s.marked(), 'xx....xx', `${css}: and one leaving the end moves none`);
      assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0]);
      s.engine.insertBefore(s.parent, s.row(), s.parent.children[0]!);
      assert.equal(s.marked(), 'xxxxxxxxx', `${css}: one at the start moves them all`);
      assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3]);
    }
  });

  it('is the rows before the change where a sheet counts from the end, with the ends', () => {
    for (const css of [
      '.row:nth-last-child(odd) { border-top-width: 3px }',
      '.row:not(:nth-last-child(2n)) { border-top-width: 3px }',
    ]) {
      const s = list(css, 8);
      s.engine.insertBefore(s.parent, s.row(), s.parent.children[0]!);
      assert.equal(s.marked(), 'xx.....xx', `${css}: a row at the start moves none after it`);
      assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3]);
      s.engine.insertBefore(s.parent, s.row(), s.parent.children[5]!);
      assert.equal(s.marked(), 'xxxxxx..xx', `${css}: one in the middle moves those before it`);
      assert.deepEqual(s.widths(), [0, 3, 0, 3, 0, 3, 0, 3, 0, 3]);
      s.engine.removeChild(s.parent, s.parent.children[4]!);
      assert.equal(s.marked(), 'xxxx...xx', `${css}: as does one leaving the middle`);
      assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3]);
      s.engine.removeChild(s.parent, s.parent.children[0]!);
      assert.equal(s.marked(), 'xx....xx', `${css}: and one leaving the start moves none`);
      assert.deepEqual(s.widths(), [0, 3, 0, 3, 0, 3, 0, 3]);
      s.engine.appendChild(s.parent, s.row());
      assert.equal(s.marked(), 'xxxxxxxxx', `${css}: one at the end moves them all`);
      assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3]);
    }
  });

  it('is the rows after the change where a sheet asks about any row before', () => {
    const css = '.row ~ .row { border-top-width: 3px }';
    const s = list(css, 8);
    s.engine.appendChild(s.parent, s.row());
    assert.equal(s.marked(), 'xx.....xx', css);
    assert.deepEqual(s.widths(), [0, 3, 3, 3, 3, 3, 3, 3, 3]);
    s.engine.removeChild(s.parent, s.parent.children[0]!);
    assert.equal(s.marked(), 'xxxxxxxx', `${css}: the row after the first is now the first`);
    assert.deepEqual(s.widths(), [0, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('is the one row after the change where a sheet asks only about the row just before', () => {
    // `+` reads the one element before, so a change reaches the one after it. The first three
    // are marked for `.row:first-child + .row`: what follows the old first row and the new.
    const s = list('.row + .row { border-top-width: 3px }', 10);
    const widths = (count: number) => [0, ...Array.from({ length: count - 1 }, () => 3)];
    s.engine.appendChild(s.parent, s.row());
    assert.equal(s.marked(), 'xxx......xx', 'a row at the end');
    assert.deepEqual(s.widths(), widths(11));
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[5]!);
    assert.equal(s.marked(), 'xxx..xx...xx', 'one in the middle, and the row after it');
    assert.deepEqual(s.widths(), widths(12));
    s.engine.removeChild(s.parent, s.parent.children[5]!);
    assert.equal(s.marked(), 'xxx..x...xx', 'one leaving the middle: the row that was after it');
    assert.deepEqual(s.widths(), widths(11));
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[0]!);
    assert.equal(s.marked(), 'xxx.......xx', 'one at the start');
    assert.deepEqual(s.widths(), widths(12));
    s.engine.removeChild(s.parent, s.parent.children[0]!);
    assert.equal(s.marked(), 'xxx......xx', 'and the first leaving');
    assert.deepEqual(s.widths(), widths(11));
  });

  it('is as many rows after the change as a rule steps from one to the next', () => {
    const s = list('.row + .row + .row { border-top-width: 3px }', 10);
    const widths = (count: number) => [0, 0, ...Array.from({ length: count - 2 }, () => 3)];
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[5]!);
    assert.equal(s.marked(), 'xxxx.xxx.xx', 'the two rows after the one put in');
    assert.deepEqual(s.widths(), widths(11));
    s.engine.removeChild(s.parent, s.parent.children[5]!);
    assert.equal(s.marked(), 'xxxx.xx.xx', 'the two that were after the one taken out');
    assert.deepEqual(s.widths(), widths(10));
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[0]!);
    assert.equal(s.marked(), 'xxxx.....xx');
    assert.deepEqual(s.widths(), widths(11));
  });

  it('follows what comes after the first row as far as a rule steps from it', () => {
    // The row put first makes the old first the second: the row two after it is the third no
    // longer, and nothing about that row or the one before it changed.
    const s = list('.row:first-child + .row + .row { border-top-width: 3px }', 10);
    assert.deepEqual(s.widths(), [0, 0, 3, 0, 0, 0, 0, 0, 0, 0]);
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[0]!);
    assert.deepEqual(s.widths(), [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    s.engine.removeChild(s.parent, s.parent.children[0]!);
    s.engine.removeChild(s.parent, s.parent.children[0]!);
    assert.deepEqual(s.widths(), [0, 0, 3, 0, 0, 0, 0, 0, 0]);
  });

  it('passes over a text between two rows: the row after it is the one after', () => {
    const s = list('.row + .row { border-top-width: 3px }', 10);
    s.engine.insertBefore(s.parent, s.engine.createText('x'), s.rows[5]!);
    s.engine.commit();
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[5]!);
    const kinds = s.parent.children.map((child) => (child.kind === 'text' ? 't' : 'r')).join('');
    assert.equal(kinds, 'rrrrrrtrrrrr');
    assert.equal(s.marked()[7], 'x', 'the row past the text');
    assert.equal(s.marked()[8], '.', 'and none past that');
    // The text is committed as a view of its own, the seventh, with no border.
    assert.deepEqual(s.widths(), [0, 3, 3, 3, 3, 3, 0, 3, 3, 3, 3, 3]);
  });

  it('follows a row moved along a list that asks about the row just before', () => {
    const s = list('.row + .row { border-top-width: 3px }', 10);
    s.engine.insertBefore(s.parent, s.rows[7]!, s.rows[3]!);
    assert.equal(s.marked(), 'xxxxx...xx', 'the row after where it lands, and after where it left');
    assert.deepEqual(s.widths(), [0, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('is every row after where a sheet asks about the row just before and counts or looks further', () => {
    for (const css of [
      '.row + .row { border-top-width: 3px } .row ~ .on { opacity: 0.5 }',
      '.row + .row { border-top-width: 3px } .row:nth-child(4) { opacity: 0.5 }',
      '.row ~ .row + .row { border-top-width: 3px }',
    ]) {
      const s = list(css, 10);
      s.engine.insertBefore(s.parent, s.row(), s.parent.children[5]!);
      assert.equal(s.marked(), 'xx...xxxxxx', css);
    }
    // Another sheet coming into play reaches as far as it asks.
    const s = list('.row + .row { border-top-width: 3px }', 10);
    s.engine.addGlobalSheet(compileCss('.row ~ .on { opacity: 0.5 }', 'more.css') as never);
    s.engine.commit();
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[5]!);
    assert.equal(s.marked(), 'xx...xxxxxx');
    // And one that steps further has the rows after as far as that.
    const stepped = list('.row + .row { border-top-width: 3px }', 14);
    stepped.engine.addGlobalSheet(
      compileCss('.on + .row + .row + .row { opacity: 0.5 }', 'more.css') as never,
    );
    stepped.engine.commit();
    stepped.engine.insertBefore(stepped.parent, stepped.row(), stepped.parent.children[7]!);
    assert.equal(stepped.marked(), 'xxxxx..xxxx..xx');
  });

  it('is the rows before the change and the one after, counting from the end and asking before', () => {
    const s = list('.row:nth-last-child(2) + .row { border-top-width: 3px }', 10);
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[5]!);
    assert.equal(s.marked(), 'xxxxxxx..xx');
    assert.deepEqual(s.widths(), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
  });

  it('is every row where sheets count from both ends, or count from the end and ask beside', () => {
    for (const css of [
      '.row:nth-child(odd) { border-top-width: 3px } .row:nth-last-child(2) { opacity: 0.5 }',
      '.row:nth-last-child(2) ~ .row { border-top-width: 3px }',
      '.row:nth-child(2):nth-last-child(odd) { border-top-width: 3px }',
    ]) {
      const s = list(css, 8);
      s.engine.insertBefore(s.parent, s.row(), s.parent.children[4]!);
      assert.equal(s.marked(), 'xxxxxxxxx', css);
    }
    // One sheet from each end is both, whichever came into play first.
    const s = list('.row:nth-last-child(odd) { border-top-width: 3px }', 8);
    s.engine.addGlobalSheet(compileCss('.row:nth-child(3) { opacity: 0.5 }', 'more.css') as never);
    s.engine.commit();
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[4]!);
    assert.equal(s.marked(), 'xxxxxxxxx');
  });

  it('is every row where a :has() counts, in a sheet that asks about position besides', () => {
    // What a `:has()` is asked of is matched again by its own means. The rows are all marked as
    // they were, rather than this working out which way a count inside one reaches.
    const s = list(`${ENDS} .list:has(> .row:nth-child(2)) { opacity: 0.5 }`, 8);
    s.engine.appendChild(s.parent, s.row());
    assert.equal(s.marked(), 'xxxxxxxxx');
  });

  it('follows a row moved along the list, from where it left to where it lands', () => {
    const s = list('.row:nth-child(odd) { border-top-width: 3px }', 9);
    const [third, seventh] = [s.rows[2]!, s.rows[6]!];
    s.engine.insertBefore(s.parent, seventh, s.rows[4]!);
    assert.equal(s.marked(), 'xx..xxxxx', 'from where it lands on: none before it moved');
    assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3]);
    assert.equal(s.parent.children[4], seventh);
    s.engine.appendChild(s.parent, third);
    assert.equal(s.marked(), 'xxxxxxxxx', 'from where it left on');
    assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3]);
    assert.equal(s.parent.children[8], third);
  });

  it('styles the one row again whose place a rule names, as rows come and go around it', () => {
    const s = list('.row:nth-child(5) { border-top-width: 3px }', 9);
    assert.deepEqual(s.widths(), [0, 0, 0, 0, 3, 0, 0, 0, 0]);
    s.engine.removeChild(s.parent, s.rows[3]!);
    assert.deepEqual(s.widths(), [0, 0, 0, 0, 3, 0, 0, 0]);
    s.engine.insertBefore(s.parent, s.row(), s.rows[4]!);
    assert.deepEqual(s.widths(), [0, 0, 0, 0, 3, 0, 0, 0, 0]);
    const fromEnd = list('.row:nth-last-child(5) { border-top-width: 3px }', 9);
    fromEnd.engine.removeChild(fromEnd.parent, fromEnd.rows[6]!);
    assert.deepEqual(fromEnd.widths(), [0, 0, 0, 3, 0, 0, 0, 0]);
    fromEnd.engine.insertBefore(fromEnd.parent, fromEnd.row(), fromEnd.rows[5]!);
    assert.deepEqual(fromEnd.widths(), [0, 0, 0, 0, 3, 0, 0, 0, 0]);
  });

  it('is the rows after it once a sheet that counts from the start is added', () => {
    const s = list(ENDS, 8);
    s.engine.addGlobalSheet(compileCss('.row:nth-child(2) { opacity: 0.5 }', 'more.css') as never);
    s.engine.commit();
    s.engine.appendChild(s.parent, s.row());
    assert.equal(s.marked(), 'xx.....xx');
    s.engine.insertBefore(s.parent, s.row(), s.parent.children[3]!);
    assert.equal(s.marked(), 'xx.xxxxxxx');
  });
});

/**
 * A row whose place changed is matched again. Where it matches the rules it did, it keeps its
 * style and what is under it is not looked at: its place is read by its own rules and no other.
 * Where a rule reads the place of a row like it from under it, the row is styled again with
 * everything under it, since what is under it can change though the row matches the same.
 */
describe('what a row whose place changed keeps', () => {
  /** Ten rows, every third one `.on`, each holding a label. */
  function list(css: string) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const parent = engine.createElement('view');
    engine.appendChild(engine.root, parent);
    let made = 0;
    const row = () => {
      const node = engine.createElement('view');
      engine.setClasses(node, made++ % 3 === 0 ? 'row on' : 'row');
      const label = engine.createElement('view');
      engine.setClasses(label, 'label');
      engine.appendChild(node, label);
      return node;
    };
    const rows = Array.from({ length: 10 }, row);
    for (const node of rows) engine.appendChild(parent, node);
    engine.commit();
    return {
      engine,
      parent,
      rows,
      row,
      /** Each row before the commit: `x` to be styled again, `m` matched again, `.` left. */
      marks: () =>
        parent.children
          .map((child) => (child.styleDirty || child.ownDirty ? 'x' : child.stateDirty ? 'm' : '.'))
          .join(''),
      /** How many nodes the commit styled, a row or a label, rather than kept as they were. */
      styled() {
        const all = () => parent.children.flatMap((node) => [node, ...node.children]);
        const before = new Map(all().map((node) => [node, node.styleCache]));
        engine.commit();
        return all().filter((node) => node.styleCache !== before.get(node)).length;
      },
      widths: () => fabric.committed[0]!.children.map((view) => view.props['borderTopWidth'] ?? 0),
      labels: () =>
        fabric.committed[0]!.children.map((view) => view.children[0]!.props['opacity'] ?? 1),
    };
  }

  it('leaves what is under each row that matches as it did, a row put first in the list', () => {
    const s = list('.row ~ .row { border-top-width: 3px }');
    s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
    assert.equal(s.marks(), 'xmmmmmmmmmm', 'the row that came is styled, the rest matched');
    // The row that came and the one that was first, which now has a row before it, and the
    // label in each. Nine rows match as they did, and their labels are not looked at.
    assert.equal(s.styled(), 4);
    assert.deepEqual(s.widths(), [0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('styles again the rows a count now names and no longer names, and no others', () => {
    const s = list('.row:nth-child(3) { border-top-width: 3px }');
    s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
    assert.equal(s.marks(), 'xmmmmmmmmmm');
    // The row that came, the old second and the old third, with their labels.
    assert.equal(s.styled(), 6);
    assert.deepEqual(s.widths(), [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    s.engine.removeChild(s.parent, s.parent.children[0]!);
    assert.equal(s.styled(), 4, 'and back: the two rows the count moved between');
    assert.deepEqual(s.widths(), [0, 0, 3, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('styles every row again where each one matches differently, as stripes do', () => {
    const s = list('.row:nth-child(odd) { border-top-width: 3px }');
    s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
    assert.equal(s.styled(), 22);
    assert.deepEqual(s.widths(), [3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3]);
  });

  it('styles a row again with all under it where a rule reads its place from under it', () => {
    for (const css of [
      '.row:nth-child(3) .label { opacity: 0.5 }',
      '.row:nth-child(3) > .label { opacity: 0.5 }',
      '.label:is(.row:nth-child(3) *) { opacity: 0.5 }',
      '.label:is(.row:nth-child(3) > *) { opacity: 0.5 }',
    ]) {
      const s = list(css);
      s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
      assert.equal(s.marks(), 'xxxxxxxxxxx', css);
      s.engine.commit();
      assert.deepEqual(s.labels(), [1, 1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1], css);
    }
  });

  it('styles a row again with all under it where a rule steps to it and reads on from under it', () => {
    // No count at all: whether `.on` is just before a row is its place, read by its label.
    const s = list('.on + .row .label { opacity: 0.5 }');
    assert.deepEqual(s.labels(), [1, 0.5, 1, 1, 0.5, 1, 1, 0.5, 1, 1]);
    s.engine.insertBefore(s.parent, s.row(), s.rows[1]!);
    assert.equal(s.marks(), 'xxx......xx', 'the row that came, the one after it, and the ends');
    s.engine.commit();
    assert.deepEqual(s.labels(), [1, 0.5, 1, 1, 1, 0.5, 1, 1, 0.5, 1, 1]);
  });

  it('asks it only of the rows a rule could mean, by their classes', () => {
    const s = list(
      '.on:nth-child(3) .label { opacity: 0.5 } .row ~ .row { border-top-width: 3px }',
    );
    s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
    // The rows made `.on` are the first, fourth, seventh and tenth, and the one that came.
    assert.equal(s.marks(), 'xxmmxmmxmmx');
    s.engine.commit();
    assert.deepEqual(s.labels(), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
    s.engine.commit();
    assert.deepEqual(s.labels(), [1, 1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('styles a row again that changed in another way in the same commit', () => {
    const s = list(
      '.row ~ .row { border-top-width: 3px } .row.wide.wide { border-top-width: 7px }',
    );
    s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
    s.engine.setClasses(s.rows[4]!, 'row wide');
    assert.equal(s.marks()[5], 'x', 'a class a rule styles it by');
    // It, the row that came and the old first, each with its label. The rows after it are left
    // as they are: no rule steps from the class that came, only from `row`.
    assert.equal(s.styled(), 6);
    assert.deepEqual(s.widths(), [0, 3, 3, 3, 3, 7, 3, 3, 3, 3, 3]);
  });

  it('leaves a row matched again where a class changed that only what is under it reads', () => {
    // The class is no rule's for the row itself: the label it is for is styled, and no more.
    const s = list('.row ~ .row { border-top-width: 3px } .wide .label { opacity: 0.5 }');
    s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
    s.engine.setClasses(s.rows[4]!, 'row wide');
    assert.equal(s.marks()[5], 'm');
    s.engine.commit();
    assert.deepEqual(s.labels(), [1, 1, 1, 1, 1, 0.5, 1, 1, 1, 1, 1]);
  });

  it('keeps as much once a sheet that asks is added to a list already styled', () => {
    const s = list('.row { border-bottom-width: 1px }');
    s.engine.addGlobalSheet(
      compileCss('.row ~ .row { border-top-width: 3px }', 'later.css') as never,
    );
    s.engine.commit();
    s.engine.insertBefore(s.parent, s.row(), s.rows[0]!);
    assert.equal(s.styled(), 4);
    assert.deepEqual(s.widths(), [0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });
});

/**
 * The marks above are a saving, and a row left unmarked that should have been styled again shows
 * as nothing at all: a stripe on the wrong row. So every change to a list is held to the same
 * list built from nothing, which styles every row.
 */
describe('a child list changed a row at a time, beside the same list built fresh', () => {
  const SHEETS = [
    '.row:nth-child(odd) { border-top-width: 3px } .row:nth-child(odd) .label { opacity: 0.5 }',
    '.row:nth-child(3) { border-top-width: 3px } .row:nth-child(2n + 1) > .label { opacity: 0.5 }',
    '.row:nth-last-child(odd) { border-top-width: 3px } .row:nth-last-child(2) .label { opacity: 0.5 }',
    '.row:nth-last-child(3) { border-top-width: 3px }',
    '.row:nth-child(odd) { border-top-width: 3px } .row:nth-last-child(odd) { opacity: 0.5 }',
    '.row + .row { border-top-width: 3px } .on + .row .label { opacity: 0.5 }',
    '.row ~ .on { border-top-width: 3px } .on ~ .row > .label { opacity: 0.5 }',
    '.row:first-child + .row { border-top-width: 3px } .row:not(:last-child) + .row { opacity: 0.5 }',
    '.row:nth-last-child(2) ~ .row { border-top-width: 3px } .row:nth-last-child(odd) + .row .label { opacity: 0.5 }',
    '.row:nth-child(even) + .row .label { opacity: 0.5 } .row:nth-child(even) ~ .on { border-top-width: 3px }',
    '.row:not(:nth-child(2n)) { border-top-width: 3px } .row:is(:nth-last-child(2n), .on) { opacity: 0.5 }',
    '.row:only-child { border-top-width: 3px } .row:first-child { opacity: 0.5 } .row:last-child .label { opacity: 0.25 }',
    '.list:has(> .on:nth-child(2)) { border-top-width: 3px } .list:has(> .on:nth-last-child(2)) { opacity: 0.5 } .row:nth-child(odd) { opacity: 0.25 }',
    '.list:empty { border-top-width: 3px } .on:nth-child(2) + .row:nth-last-child(2) { opacity: 0.5 }',
  ];

  /** What a list holds: a row by its number, or a text, which is no element and is not counted. */
  type Item = number | 'text';

  /**
   * A list of rows, each a view holding a label that holds a title, a text with words in it, so
   * that what a row hands down, a colour or a custom property, shows two levels under it.
   * `later` is a second sheet, added once the list is committed.
   */
  function sceneOf(css: string, items: readonly Item[], later?: string) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
    const parent = engine.createElement('view');
    engine.setClasses(parent, 'list');
    engine.appendChild(engine.root, parent);
    const made = new Map<Item, ReturnType<Engine['createElement']>>();
    const node = (item: Item) => {
      let found = made.get(item);
      if (found) return found;
      if (item === 'text') found = engine.createText('t');
      else {
        found = engine.createElement('view');
        engine.setClasses(found, `row r${item}${item % 3 === 0 ? ' on' : ''}`);
        const label = engine.createElement('view');
        engine.setClasses(label, 'label');
        engine.appendChild(found, label);
        const title = engine.createElement('text');
        engine.setClasses(title, 'title');
        engine.appendChild(title, engine.createText(`row ${item}`));
        engine.appendChild(label, title);
      }
      made.set(item, found);
      return found;
    };
    for (const item of items) engine.appendChild(parent, node(item));
    engine.commit();
    if (later !== undefined) {
      engine.addGlobalSheet(compileCss(later, 'later.css') as never);
      engine.commit();
    }
    // A prop a view no longer has travels as null, which a view that never had it does not carry.
    const styled = (view: FakeFabricNode): unknown => ({
      name: view.viewName,
      props: Object.fromEntries(Object.entries(view.props).filter(([, value]) => value !== null)),
      children: view.children.map(styled),
    });
    return {
      engine,
      parent,
      node,
      /** The list as committed: every view's name and props, all the way down. */
      committed() {
        engine.commit();
        return fabric.committed.map(styled);
      },
    };
  }

  /** The list after a step, and the step done to a scene. */
  interface Step {
    readonly what: string;
    readonly after: readonly Item[];
    apply(s: ReturnType<typeof sceneOf>): void;
  }

  /** Every way to put one item in, take one out or move one along, from `items`. */
  function steps(items: readonly Item[], fresh: Item): Step[] {
    const out: Step[] = [];
    const put = (item: Item, at: number, from: readonly Item[], what: string) => {
      const after = [...from.slice(0, at), item, ...from.slice(at)];
      const before = from[at];
      out.push({
        what,
        after,
        apply: (s) =>
          before === undefined
            ? s.engine.appendChild(s.parent, s.node(item))
            : s.engine.insertBefore(s.parent, s.node(item), s.node(before)),
      });
    };
    for (let at = 0; at <= items.length; at++) {
      put(fresh, at, items, `row ${fresh} put at ${at}`);
      if (!items.includes('text')) put('text', at, items, `a text put at ${at}`);
    }
    for (const [at, item] of items.entries()) {
      const without = items.filter((other) => other !== item);
      out.push({
        what: `${item} taken from ${at}`,
        after: without,
        apply: (s) => s.engine.removeChild(s.parent, s.node(item)),
      });
      for (let to = 0; to <= without.length; to++) {
        if (to !== at) put(item, to, without, `${item} moved from ${at} to ${to}`);
      }
    }
    return out;
  }

  const START: readonly Item[] = [0, 1, 2, 'text', 3, 4, 5];

  /**
   * Every step from `start` held to a fresh list, and a second step from one in `every` of them,
   * so a list is not only ever one step from fresh: after a commit between the two for half of
   * those, and with both in one commit for the rest.
   */
  function holdToFresh(css: string, start: readonly Item[], every: number, later?: string): void {
    const scene = (sheet: string, items: readonly Item[]) => sceneOf(sheet, items, later);
    for (const [index, step] of steps(start, 99).entries()) {
      const s = scene(css, start);
      step.apply(s);
      assert.deepEqual(s.committed(), scene(css, step.after).committed(), step.what);
      if (index % every !== 0) continue;
      for (const next of steps(step.after, 98)) {
        const twice = scene(css, start);
        step.apply(twice);
        if (index % (every * 2) === 0) twice.engine.commit();
        next.apply(twice);
        assert.deepEqual(
          twice.committed(),
          scene(css, next.after).committed(),
          `${step.what}, then ${next.what}`,
        );
      }
    }
  }

  for (const css of SHEETS) {
    it(`commits what a fresh list would, under ${css}`, () => holdToFresh(css, START, 6));
  }

  /**
   * Sheets that ask only about the element just before, which reach as few rows after a change as
   * a rule steps along, on a list long enough that most of its rows are out of that reach.
   */
  const STEPPING = [
    '.row + .row { border-top-width: 3px } .on + .row .label { opacity: 0.5 }',
    '.row + .row + .row { border-top-width: 3px } .on + .row + .row > .label { opacity: 0.5 }',
    '.row:first-child + .row + .row { border-top-width: 3px } .row:not(:first-child) + .on { opacity: 0.5 }',
    '.row:first-child + .row { border-top-width: 3px } .row:not(:last-child) + .row + .on { opacity: 0.5 }',
    '.row:only-child + .row { border-top-width: 3px } .row:last-child { opacity: 0.5 } .on + .on + .row + .row .label { opacity: 0.25 }',
    '.row:nth-last-child(2) + .row { border-top-width: 3px } .row:nth-last-child(4) + .row + .row .label { opacity: 0.5 }',
    '.list:empty + .row { border-top-width: 3px } .r4 + .row + .row { opacity: 0.5 } .r7 + .r8 .label { opacity: 0.25 }',
    '.row:not(.on) + .row:is(.on, .r1) { border-top-width: 3px } .label + .label { opacity: 0.5 }',
  ];
  const LONG: readonly Item[] = [0, 1, 2, 3, 4, 'text', 5, 6, 7, 8, 9, 10, 11];

  for (const css of STEPPING) {
    it(`commits what a fresh long list would, under ${css}`, () => holdToFresh(css, LONG, 90));
  }

  /**
   * Sheets where a row's place reaches what is under it: by a rule that reads the place from
   * below, by a colour or a custom property a placed row hands down, through `:has()`, and by
   * rules that read it only for the row itself, beside ones that read other things from below.
   * A row that matches the rules it did keeps what is under it, so these are where that could
   * leave a title or a label as it was when it should have changed.
   */
  const BENEATH = [
    '.row:nth-child(3) { color: rgb(255, 0, 0); font-size: 20px } .row:nth-last-child(2) { color: rgb(0, 0, 255) }',
    '.row:nth-child(3) { --c: 0.5 } .label { opacity: var(--c, 1) } .row:nth-last-child(2) { --w: 3px } .title { border-top-width: var(--w, 0) }',
    '.row:first-child .label { opacity: 0.5 } .row:last-child > .label > .title { border-top-width: 3px }',
    '.row:nth-child(2) .title { border-top-width: 3px } .row:nth-last-child(odd) > .label { opacity: 0.5 }',
    '.label:is(.on:first-child *) { opacity: 0.5 } .label:is(.row:nth-last-child(2) > *) { border-top-width: 3px }',
    '.title:is(.row:nth-child(even) *) { border-top-width: 3px } .row:nth-child(even) { opacity: 0.5 }',
    '.row:nth-child(2):has(> .label) { opacity: 0.5 } .list:has(> .on:last-child) { border-top-width: 3px } .row ~ .row { border-top-width: 1px }',
    '.on ~ .row .title { border-top-width: 3px } .row:nth-child(4) ~ .on > .label { opacity: 0.5 }',
    '.r1 + .r2 .label { opacity: 0.5 } .r4 + .row > .label > .title { border-top-width: 3px } .row:nth-child(n + 3) { border-top-width: 3px }',
    '.row ~ .on { border-top-width: 3px } .row:not(:first-child) { opacity: 0.5 } .on .title { color: rgb(255, 0, 0) }',
    '.row:nth-child(3) { color: rgb(255, 0, 0) } .title { color: inherit } .row:nth-child(2) > .label { color: rgb(0, 0, 255) }',
    '.row:not(.on):nth-child(odd) .label { opacity: 0.5 } .on:nth-child(odd) { border-top-width: 3px }',
    '.row:not(:nth-child(2)) > .label { opacity: 0.5 } .row:is(:nth-last-child(2), .r9) .title { border-top-width: 3px }',
  ];

  for (const css of BENEATH) {
    it(`commits what a fresh list would beneath its rows, under ${css}`, () =>
      holdToFresh(css, START, 6));
  }

  it('commits what a fresh list would under a sheet added once the list is there', () => {
    // The rows were styled before any sheet asked about their place, and are asked from then on.
    const first = '.row { border-bottom-width: 1px } .label { opacity: 0.75 }';
    for (const later of [...BENEATH, ...SHEETS.slice(0, 7), ...STEPPING.slice(0, 3)]) {
      holdToFresh(first, START, 24, later);
    }
  });

  it('commits what a fresh list would as a short list empties and fills again', () => {
    for (const css of [...SHEETS, ...STEPPING, ...BENEATH]) {
      const scene = sceneOf;
      const s = scene(css, [0, 1]);
      s.engine.removeChild(s.parent, s.node(0));
      assert.deepEqual(s.committed(), scene(css, [1]).committed(), css);
      s.engine.removeChild(s.parent, s.node(1));
      assert.deepEqual(s.committed(), scene(css, []).committed(), css);
      s.engine.appendChild(s.parent, s.node(3));
      assert.deepEqual(s.committed(), scene(css, [3]).committed(), css);
      s.engine.insertBefore(s.parent, s.node(4), s.node(3));
      s.engine.appendChild(s.parent, s.node(5));
      assert.deepEqual(s.committed(), scene(css, [4, 3, 5]).committed(), `${css}, two at once`);
    }
  });
});
