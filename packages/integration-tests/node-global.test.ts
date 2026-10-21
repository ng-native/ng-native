/**
 * The `Node` an engine node is an instance of, once React Native has set up its own.
 *
 * The Metro preset's polyfill defines a `Node` that recognises engine nodes, but a polyfill runs
 * before React Native's `InitializeCore`, whose `setUpDOM` puts `ReadOnlyNode` on the global in its
 * place. Angular's development build then threw `The provided value must be an instance of a DOM
 * Node but got #anchor` for every ICU plural and select on iOS and Android. The test runner has no
 * `InitializeCore`, so each test here stands in for it by replacing the global.
 */
import '@angular/localize/init';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, installNodeGlobal } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, settle, screen } from '@ng-native/testing';
import type { FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const scope = globalThis as { Node?: unknown };
const before = Object.getOwnPropertyDescriptor(globalThis, 'Node');

afterEach(async () => {
  await cleanup();
  if (before) Object.defineProperty(globalThis, 'Node', before);
  else delete scope.Node;
});

/** What `setUpDOM` leaves: a `Node` that knows nothing of the engine. */
function setUpDom() {
  class ReadOnlyNode {
    static ELEMENT_NODE = 1;
    static TEXT_NODE = 3;
    static COMMENT_NODE = 8;
  }
  class ReadOnlyText extends ReadOnlyNode {}
  Object.defineProperty(globalThis, 'Node', {
    value: ReadOnlyNode,
    configurable: true,
    writable: true,
  });
  return { ReadOnlyNode, ReadOnlyText };
}

describe("installing over React Native's Node", () => {
  it('makes every kind of engine node an instance of it, and leaves the rest to it', () => {
    const { ReadOnlyNode, ReadOnlyText } = setUpDom();
    const engine = new Engine(createFakeFabric(), 1);
    assert.equal(engine.createAnchor() instanceof ReadOnlyNode, false, 'before it is installed');

    installNodeGlobal();
    assert.equal(engine.createElement('view') instanceof ReadOnlyNode, true);
    assert.equal(engine.createText('hi') instanceof ReadOnlyNode, true);
    assert.equal(engine.createAnchor() instanceof ReadOnlyNode, true);
    assert.equal(new ReadOnlyNode() instanceof ReadOnlyNode, true, "React Native's own still are");
    assert.equal(new ReadOnlyText() instanceof ReadOnlyNode, true, 'and so are its subclasses');
    assert.equal({} instanceof ReadOnlyNode, false);
    assert.equal([] instanceof ReadOnlyNode, false);
    assert.equal(engine.createAnchor() instanceof ReadOnlyText, false, 'a subclass is not widened');
  });

  it('keeps an instance check its Node defines for itself, and patches it once', () => {
    const marked = { reactNative: true };
    class Own {
      static [Symbol.hasInstance](value: unknown) {
        return value === marked;
      }
    }
    Object.defineProperty(globalThis, 'Node', { value: Own, configurable: true, writable: true });
    installNodeGlobal();
    const patched = Own[Symbol.hasInstance];
    installNodeGlobal();
    assert.equal(Own[Symbol.hasInstance], patched, 'the check is wrapped once');

    const node = new Engine(createFakeFabric(), 1).createAnchor();
    assert.equal(node instanceof Own, true);
    assert.equal(marked instanceof Own, true);
    assert.equal({} instanceof Own, false);
  });

  it('does nothing where there is no Node', () => {
    delete scope.Node;
    assert.doesNotThrow(() => installNodeGlobal());
  });

  it('is what mount() does, so a plural renders in development where it threw', async () => {
    setUpDom();
    const rawText = (node: FakeFabricNode): string =>
      node.viewName === 'RawText'
        ? String(node.props['text'] ?? '')
        : node.children.map(rawText).join('');
    const mod = await compileFixture('fixtures/i18n.ts');
    const { instance } = await render(mod['I18nHost'] as Type<unknown>);
    (instance as { count: { set(v: number): void } }).count.set(5);
    await settle();
    assert.equal(rawText(screen.getByTestId('basket')), '5 items');
    assert.equal(rawText(screen.getByTestId('reply')), 'You replied');
  });
});
