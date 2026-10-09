/**
 * A `var()` naming a custom property nothing in scope defines, and with no fallback, is dropped,
 * as a browser drops it. A browser's inspector shows the declaration struck out; a phone has no
 * inspector, so in development the engine says so, once per name.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('a custom property nothing defines', () => {
  let Host: Type<unknown>;
  const warnings: string[] = [];
  const warn = console.warn;

  before(async () => {
    const mod = await compileFixture('fixtures/undefined-token.ts');
    Host = mod['UndefinedToken'] as Type<unknown>;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  });

  after(() => {
    console.warn = warn;
  });

  afterEach(() => {
    cleanup();
    warnings.length = 0;
  });

  const said = () => warnings.filter((line) => line.includes('custom property'));

  it('drops the declaration, and says so once in development', async () => {
    const { fabric } = await render(Host, { dev: true });
    const a = flatten(fabric.committed).find((n) => n.props['nativeID'] === 'a')!;
    assert.equal(a.props['backgroundColor'], undefined);
    const reports = said();
    assert.equal(reports.length, 1, reports.join('\n'));
    assert.match(reports[0]!, /var\(--backdrop\)/);
    assert.match(reports[0]!, /background-color|backgroundColor/);
  });

  it('says nothing of a fallback, a token defined on the node or one inherited', async () => {
    const { fabric } = await render(Host, { dev: true });
    const f = flatten(fabric.committed).find((n) => n.props['nativeID'] === 'f')!;
    assert.equal(f.props['paddingTop'], 4);
    assert.ok(!said().some((line) => /--unset-tint|--tone|--edge/.test(line)), said().join('\n'));
  });

  it('says nothing in a release build', async () => {
    await render(Host, { dev: false });
    assert.deepEqual(said(), []);
  });
});
