/**
 * `:host`, which is not merely unimplemented without this but unreachable.
 *
 * A component's host node is created by its *parent's* renderer, so it belongs to the parent's
 * sheet. Each renderer therefore tags the host it was created for with its own sheet, and a
 * `:host` compound matches a node whose tag is the sheet currently being evaluated.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { StyleResolver, matches, type StyleTarget } from '@ng-native/fabric';
import {
  cleanup,
  render,
  type FakeFabric,
  type FakeFabricNode,
  compileCss,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

after(cleanup);

describe(':host', () => {
  let Parent: Type<{ dark: { set(v: boolean): void } }>;
  let fabric: FakeFabric;

  const boot = async (dark: boolean) => {
    const result = await render(Parent);
    fabric = result.fabric;
    result.instance.dark.set(dark);
    await result.rerender();
  };

  before(async () => {
    const mod = await compileFixture('fixtures/host-styles.ts');
    Parent = mod['HostParent'] as Type<{ dark: { set(v: boolean): void } }>;
  });

  const hosts = () =>
    flatten(fabric.committed).filter((n) => n.props['backgroundColor'] !== undefined);
  const labels = () => flatten(fabric.committed).filter((n) => n.viewName === 'Paragraph');

  it("styles the child's own host node from the child's sheet", async () => {
    await boot(false);
    assert.deepEqual(
      hosts().map((n) => n.props['backgroundColor']),
      ['rgb(1, 1, 1)', 'rgb(2, 2, 2)'],
      ':host applied to both, and :host(.active) beat it on the second',
    );
  });

  it('does not leak :host onto the elements inside the component', async () => {
    await boot(false);
    assert.deepEqual(
      labels().map((n) => n.props['backgroundColor']),
      [undefined, undefined],
    );
  });

  it("does not style the host from the child's plain rules, only its :host ones", async () => {
    // The parent puts class="active" on the second kid. The kid's own .active rule is for
    // elements inside it: emulated encapsulation scopes it to them, so the host is left alone.
    await boot(false);
    assert.deepEqual(
      hosts().map((n) => n.props['paddingTop']),
      [undefined, undefined],
    );
  });

  it('matches a descendant through `:host .label`', async () => {
    await boot(false);
    assert.deepEqual(
      labels().map((n) => n.props['color']),
      ['rgb(3, 3, 3)', 'rgb(3, 3, 3)'],
    );
  });

  it('applies :host-context only when an ancestor matches', async () => {
    await boot(false);
    assert.deepEqual(
      labels().map((n) => n.props['letterSpacing']),
      [undefined, undefined],
    );

    await boot(true);
    assert.deepEqual(
      labels().map((n) => n.props['letterSpacing']),
      [4, 4],
    );
  });
});

describe('a host node, straight from the resolver', () => {
  const hostOf = (hostSheet: StyleTarget['hostSheet'], classes: string[]): StyleTarget => ({
    name: 'view',
    parent: null,
    classes: new Set(classes),
    props: {},
    sheet: null,
    hostSheet,
    styleCache: null,
    styleDirty: true,
  });

  it('matches :host-context() on the host itself, as well as on its ancestors', () => {
    const sheet = compileCss(':host-context(.dark) { color: red }', 'host');
    assert.equal(matches(hostOf(sheet, ['dark']), sheet.rules[0], sheet), true);
    assert.equal(matches(hostOf(sheet, []), sheet.rules[0], sheet), false);
  });

  it('needs every :host-context() written in one compound, each on the host or above it', () => {
    const sheet = compileCss(':host-context(.dark):host-context(.compact) { color: red }', 'host');
    const under = (classes: string[], parent: StyleTarget): StyleTarget => ({
      ...hostOf(sheet, classes),
      parent,
    });
    const both = under([], under(['compact'], hostOf(null, ['dark'])));
    assert.equal(matches(both, sheet.rules[0], sheet), true);
    assert.equal(matches(hostOf(sheet, ['dark', 'compact']), sheet.rules[0], sheet), true);
    const compactOnly = under([], hostOf(null, ['compact']));
    assert.equal(matches(compactOnly, sheet.rules[0], sheet), false);
    const darkOnly = under([], hostOf(null, ['dark']));
    assert.equal(matches(darkOnly, sheet.rules[0], sheet), false);
  });

  it('reads a bare name in :host-context() as an element type', () => {
    const sheet = compileCss(':host-context(view) { color: red }', 'host');
    assert.equal(matches(hostOf(sheet, []), sheet.rules[0], sheet), true, 'the host is a view');
    const text = compileCss(':host-context(text) { color: red }', 'host');
    assert.equal(matches(hostOf(text, []), text.rules[0], text), false);
  });

  it("gives the component's :host rules a class of weight over the global sheet's", () => {
    // `:host` is one class of specificity, and a component's rules gain one more, as Angular's
    // emulated encapsulation grants them: enough to beat a global rule of a type and a class.
    const global = compileCss('view.card { color: red }', 'global');
    const own = compileCss(':host { color: blue }', 'host');
    const resolver = new StyleResolver(global, { width: 400, height: 800, colorScheme: 'light' });
    assert.equal(resolver.resolve(hostOf(own, ['card']), 1).style['color'], 'rgb(0, 0, 255)');
  });
});
