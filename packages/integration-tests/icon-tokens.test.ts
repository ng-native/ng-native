/**
 * An icon's own markup taking a colour from a custom property: `stroke="var(--brand)"`, or the
 * same in `style`. On the web that resolves against the cascade. Here the shape is a node in the
 * cascade too, so its paint is settled with the tokens in scope and follows them.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Tokens {
  brand: { set(value: string | undefined): void };
}
let app: Awaited<ReturnType<typeof render<Tokens>>>;
const warnings: string[] = [];
const warn = console.warn;

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
/** The path inside the icon with this `nativeID`. */
const path = (id: string): FakeFabricNode => {
  const icon = flatten(app.fabric.committed).find((node) => node.props['nativeID'] === id)!;
  return flatten([icon]).find((node) => node.viewName === 'RNSVGPath')!;
};
const solid = (colour: string) => ({ type: 0, payload: colour });

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/icon-tokens.ts', import.meta.url)),
  );
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  app = await render(mod['IconTokens'] as Type<Tokens>, { dev: true });
});

after(() => {
  console.warn = warn;
  cleanup();
});

describe("a custom property in an icon's own paint", () => {
  it('paints a stroke written in style from the token in scope', () => {
    assert.deepEqual(path('styled').props['stroke'], solid('rgb(1, 2, 3)'));
    assert.ok((path('styled').props['propList'] as string[]).includes('stroke'));
  });

  it('paints a fill written as an attribute, beside a colour written out', () => {
    assert.deepEqual(path('attribute').props['fill'], solid('rgb(1, 2, 3)'));
    assert.deepEqual(path('attribute').props['stroke'], solid('red'));
  });

  it('takes the fallback when the token is unset', () => {
    assert.deepEqual(path('fallback').props['stroke'], solid('rgb(7, 8, 9)'));
  });

  it('never sends the text of the var() as a colour', () => {
    for (const id of ['styled', 'attribute', 'fallback', 'unset']) {
      assert.doesNotMatch(JSON.stringify(path(id).props), /var\(/, id);
    }
  });

  it('says so in development when the token is unset with nothing to fall back to', () => {
    assert.equal(path('unset').props['stroke'] ?? undefined, undefined);
    assert.match(warnings.join('\n'), /var\(--nowhere\) in stroke/);
  });

  it('follows the token when it changes', async () => {
    app.instance.brand.set('rgb(9, 9, 9)');
    await settle();
    assert.deepEqual(path('styled').props['stroke'], solid('rgb(9, 9, 9)'));
    assert.deepEqual(path('attribute').props['fill'], solid('rgb(9, 9, 9)'));
  });
});
