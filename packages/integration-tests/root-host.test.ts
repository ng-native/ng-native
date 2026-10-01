/**
 * The root component's host, which `mount` commits as a view of its own so `:host` reaches it as
 * it reaches any other component's host.
 *
 * It used to be the surface root, which is never committed: a root component's `:host` resolved
 * onto a node no commit read, so its background and padding were dropped without a word. The
 * host fills the surface unless the app's `:host` says otherwise, as the web's mount point does,
 * so a template whose top view has `flex: 1` fills the screen with or without a `:host` rule.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { layOutTree } from './layout.ts';

const SCREEN = { width: 400, height: 800 };
const LINE = 20;

after(cleanup);

describe("the root component's host", () => {
  let RootStyled: Type<unknown>;
  let RootBare: Type<unknown>;
  let RootSized: Type<unknown>;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/root-host.ts', import.meta.url)),
    );
    RootStyled = mod['RootStyled'] as Type<unknown>;
    RootBare = mod['RootBare'] as Type<unknown>;
    RootSized = mod['RootSized'] as Type<unknown>;
  });

  const sizes = (committed: readonly FakeFabricNode[]) =>
    layOutTree(committed, SCREEN, (node) =>
      node.viewName === 'Paragraph' ? { height: LINE } : undefined,
    );

  it('commits as a view holding the template', async () => {
    const { fabric } = await render(RootBare);
    assert.equal(fabric.committed.length, 1, 'one view on the surface');
    const host = fabric.committed[0]!;
    assert.equal(host.viewName, 'View');
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0]!.children[0]!.viewName, 'Paragraph');
  });

  it("takes the background and padding from the component's :host", async () => {
    const { fabric } = await render(RootStyled);
    const host = fabric.committed[0]!;
    assert.equal(host.props['backgroundColor'], 'rgb(244, 239, 230)');
    assert.equal(host.props['paddingTop'], 20);
    assert.equal(host.props['paddingLeft'], 20);
    const laid = sizes(fabric.committed);
    assert.deepEqual(laid.get(host), SCREEN, 'the host still fills the surface');
    assert.deepEqual(
      laid.get(host.children[0]!),
      { width: SCREEN.width - 40, height: SCREEN.height - 40 },
      'and the screen inside it fills the host within its padding',
    );
  });

  it('fills the surface with no :host rule, so a flex: 1 view fills the screen', async () => {
    const { fabric } = await render(RootBare);
    const host = fabric.committed[0]!;
    const laid = sizes(fabric.committed);
    assert.deepEqual(laid.get(host), SCREEN);
    assert.deepEqual(laid.get(host.children[0]!), SCREEN);
  });

  it("gives way to the app's own :host", async () => {
    const { fabric } = await render(RootSized);
    const host = fabric.committed[0]!;
    assert.equal(host.props['height'], 300);
    assert.equal(sizes(fabric.committed).get(host)!.height, 300);
  });
});
