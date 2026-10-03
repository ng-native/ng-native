/**
 * An SF Symbol's colour from a token. Its colour is the `tintColor` prop, and `tint-color` in a
 * stylesheet is the declaration that lands there, so it reads a token as any declaration does.
 */
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let app: Awaited<ReturnType<typeof render<{ accent: { set(value: string): void } }>>>;
const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const symbol = (id: string) =>
  flatten(app.fabric.committed).find((node) => node.props['nativeID'] === id)!;

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/symbol-tint.ts', import.meta.url)),
  );
  app = await render(mod['SymbolTint'] as Type<{ accent: { set(value: string): void } }>);
});
after(cleanup);

it('tints a symbol from a token with tint-color, and follows the token', async () => {
  assert.equal(symbol('tinted').props['tintColor'], 'rgb(1, 2, 3)');
  app.instance.accent.set('rgb(4, 5, 6)');
  await settle();
  assert.equal(symbol('tinted').props['tintColor'], 'rgb(4, 5, 6)');
});

it('does not tint from color, which is the colour of text', () => {
  assert.equal(symbol('coloured').props['tintColor'], undefined);
});

it('takes the tintColor input over the stylesheet', () => {
  assert.equal(symbol('input').props['tintColor'], 'rgb(9, 9, 9)');
});
