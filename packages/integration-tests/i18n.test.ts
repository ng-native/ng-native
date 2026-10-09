/**
 * Angular's i18n runtime, rendering onto Fabric.
 *
 * It decides whether an i18n node is text or a comment by the DOM's `Node.TEXT_NODE` and
 * `Node.COMMENT_NODE`. The Metro polyfills define a `Node` for Angular's dev assertions, and while
 * that `Node` had only `ELEMENT_NODE`, both read `undefined`, the comment case matched first, and
 * every translated string was created as an empty comment: an `i18n` element rendered nothing.
 *
 * `@angular/localize/init` with no translations loaded, so each message renders its source text.
 * Translations, extraction and the rest are in `localisation.test.ts`.
 */
import '@angular/localize/init';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, screen, render, settle } from '@ng-native/testing';
import type { FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('i18n', () => {
  let host: {
    name: { set(v: string): void };
    count: { set(v: number): void };
    author: { set(v: string): void };
  };

  before(async () => {
    const mod = await compileFixture('fixtures/i18n.ts');
    const rendered = await render(mod['I18nHost'] as Type<unknown>);
    host = rendered.instance as typeof host;
  });

  after(cleanup);

  // The library has no "text content of a node found by id" query, so this walks the found
  // node's own subtree for `RawText` rather than using `getByTestId` alone.
  const rawText = (node: FakeFabricNode): string =>
    node.viewName === 'RawText'
      ? String(node.props['text'] ?? '')
      : node.children.map(rawText).join('');
  const textOf = (id: string) => rawText(screen.getByTestId(id));

  it('renders an i18n element as text, not as an empty comment', () => {
    assert.equal(textOf('plain'), 'Plain text');
  });

  it('renders an interpolation inside an i18n message, and follows it', async () => {
    assert.equal(textOf('greeting'), 'Hello, Ada!');
    host.name.set('Grace');
    await settle();
    assert.equal(textOf('greeting'), 'Hello, Grace!');
  });

  // Angular reads each case of a plural or select by parsing it as HTML in an inert document,
  // which threw `Cannot read properties of undefined (reading 'createHTMLDocument')`.
  it('renders a plural, by exact match and then by the locale category', async () => {
    host.count.set(0);
    await settle();
    assert.equal(textOf('basket'), 'No items');
    host.count.set(1);
    await settle();
    assert.equal(textOf('basket'), 'One item');
    host.count.set(5);
    await settle();
    assert.equal(textOf('basket'), '5 items');
  });

  it('renders a select with text around it, and an interpolation in a case', async () => {
    host.name.set('Grace');
    host.author.set('me');
    await settle();
    assert.equal(textOf('reply'), 'You replied');
    host.author.set('them');
    await settle();
    assert.equal(textOf('reply'), 'Grace replied');
  });

  it('renders a plural nested in a select', async () => {
    host.author.set('me');
    host.count.set(1);
    await settle();
    assert.equal(textOf('owned'), 'You have one');
    host.count.set(4);
    await settle();
    assert.equal(textOf('owned'), 'You have 4');
    host.author.set('them');
    await settle();
    assert.equal(textOf('owned'), 'They have some');
  });

  it('keeps an ampersand and a lone < in a case as text', () => {
    assert.equal(textOf('entity'), 'Fish & chips < £5');
  });

  it('leaves out an element in a case, which Angular keeps only from its HTML allowlist', () => {
    assert.equal(textOf('element'), 'Before  after');
  });

  it('creates an element from the allowlist in a case, with its attributes', () => {
    const find = (node: FakeFabricNode): FakeFabricNode | undefined =>
      node.props['title'] === undefined ? node.children.map(find).find(Boolean) : node;
    assert.equal(textOf('html'), 'Pay now');
    const bold = find(screen.getByTestId('html'));
    assert.equal(bold?.props['title'], 'at once');
    assert.equal(bold && rawText(bold), 'now');
  });

  it('keeps the source text of an i18n- attribute', () => {
    assert.equal(screen.getByTestId('close').props['accessibilityLabel'], 'Close');
  });
});
