/**
 * The application-level sheet: the one set of rules allowed to cross a component boundary.
 *
 * Precedence is not a separate tier. Global and component rules cascade together by specificity,
 * with component rules given one extra class, which is exactly what Angular's emulated
 * encapsulation already does by rewriting a component rule to carry `[_ngcontent-x]`.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { cleanup, render, type BoundQueries } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

/**
 * Structural selectors from the *global* sheet.
 *
 * They are covered for a component's own styles already. This is the other half, and it is the
 * half an application sheet is for: a list striped by a rule the list's component never declared.
 */
describe('position pseudo-classes in the global sheet', () => {
  let Rows: Type<unknown>;

  before(async () => {
    const mod = await compileFixture('fixtures/global-styled.ts');
    Rows = mod['GlobalRows'] as Type<unknown>;
  });

  const bootRows = async (css: string) => {
    const { getAllByTestId } = await render(Rows, { globalStyles: compileCss(css, 'global') });
    return () => getAllByTestId(/^row/);
  };

  it('picks the first and the last', async () => {
    const rowsOf = await bootRows(`
      .row:first-child { border-top-width: 2px }
      .row:last-child { border-bottom-width: 4px }
    `);
    const all = rowsOf();
    assert.equal(all.length, 3);
    assert.equal(all[0]!.props['borderTopWidth'], 2);
    assert.equal(all[2]!.props['borderBottomWidth'], 4);
    assert.equal(all[1]!.props['borderTopWidth'], undefined);
  });

  /**
   * A `var()` is resolved when a node matches rather than when the sheet is compiled, so it
   * travels as a deferred declaration beside the plain ones. Applying the deferred set after the
   * plain set would make a token beat anything, whatever the cascade says - here a one-class rule
   * would repaint over a rule with a pseudo-class on top of it.
   */
  it('does not let a token jump the cascade', async () => {
    const rowsOf = await bootRows(`
      :root { --surface: rgb(240, 240, 245) }
      .row { background-color: var(--surface) }
      .row:nth-child(odd) { background-color: rgb(38, 38, 48) }
    `);
    const all = rowsOf();
    assert.equal(
      all[0]!.props['backgroundColor'],
      'rgb(38, 38, 48)',
      'the more specific rule wins',
    );
    assert.equal(all[1]!.props['backgroundColor'], 'rgb(240, 240, 245)');
    assert.equal(all[2]!.props['backgroundColor'], 'rgb(38, 38, 48)');
  });

  it('stripes with nth-child, which is the reason to write one in a global sheet at all', async () => {
    const rowsOf = await bootRows('.row:nth-child(odd) { background-color: #eee }');
    const all = rowsOf();
    assert.equal(all[0]!.props['backgroundColor'], 'rgb(238, 238, 238)');
    assert.equal(all[1]!.props['backgroundColor'], undefined);
    assert.equal(all[2]!.props['backgroundColor'], 'rgb(238, 238, 238)');
  });
});

describe('the global sheet', () => {
  let Component: Type<unknown>;
  let queries: BoundQueries;

  const boot = async (css: string) => {
    queries = await render(Component, { globalStyles: compileCss(css, 'global') });
  };

  before(async () => {
    const mod = await compileFixture('fixtures/global-styled.ts');
    Component = mod['GlobalStyled'] as Type<unknown>;
  });

  const byId = (id: string) => queries.getByTestId(id);
  const box = () => byId('box');
  const label = () => queries.getByText('labelled');

  it('reaches inside a component, which no other sheet may', async () => {
    await boot('.box { background-color: rgb(9, 9, 9) }');
    assert.equal(box().props['backgroundColor'], 'rgb(9, 9, 9)');
  });

  it('loses to a component rule of the same specificity, as [_ngcontent] makes it', async () => {
    // Both are one class. The component's carries the extra class Angular's shim would add.
    await boot('.box { padding: 40px }');
    assert.equal(box().props['paddingTop'], 2);
  });

  it('wins when it is genuinely more specific than the component rule', async () => {
    // The component's one-class rule is worth two after the bump, so `.box.box` only ties with it
    // and loses on source order. Three classes genuinely beats it. Nothing makes the global sheet
    // weaker in kind, it is simply one class behind.
    await boot('.box.box { padding: 40px }');
    assert.equal(
      box().props['paddingTop'],
      2,
      'two classes only ties, and a tie goes to the component',
    );

    await boot('.box.box.box { padding: 40px }');
    assert.equal(box().props['paddingTop'], 40);
  });

  it('honours !important from the global sheet over a component rule', async () => {
    await boot('.box { padding: 40px !important }');
    assert.equal(box().props['paddingTop'], 40);
  });

  it('inherits from the global sheet down through components', async () => {
    await boot('.plain { color: rgb(7, 7, 7) }');
    assert.equal(byId('plain-text').props['color'], 'rgb(7, 7, 7)');
  });

  it('still lets a component rule win on the element it owns', async () => {
    await boot('.label { color: rgb(7, 7, 7) }');
    assert.equal(label().props['color'], 'rgb(1, 1, 1)');
  });
});

/**
 * `ios:` and `android:` from `@ng-native/tailwind` compile to `.platform-ios <rule>`: they match
 * beneath a class naming the platform. `mount` puts that class on the root itself, so a platform
 * variant works in a new app with nothing to set up - before, the app had to know to add it, and
 * one that did not got variants that silently did nothing.
 */
describe('the platform class on the root', () => {
  it('lets a platform-scoped rule match with no class added by the app', async () => {
    const mod = await compileFixture('fixtures/global-styled.ts');
    const { getAllByTestId } = await render(mod['GlobalRows'] as Type<unknown>, {
      globalStyles: compileCss(
        '.platform-ios .row { padding-top: 8px } .platform-android .row { padding-top: 30px }',
        'global',
      ),
    });
    const rows = getAllByTestId(/^row/);
    assert.equal(rows[0]!.props['paddingTop'], 8, 'the ios rule, since the test platform is ios');
  });
});
