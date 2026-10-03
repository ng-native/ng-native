/**
 * The two places a package outside core can extend how a template is rendered: what a listener
 * is attached to, and what an engine node answers to. They are what a web-compatibility layer is
 * built on, and core knows nothing of the web for them.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, RendererFactory2, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { Engine, extendNodes, type EngineNode } from '@ng-native/fabric';
import { extendRenderer } from '@ng-native/platform';
import { cleanup, fireEvent, render, screen } from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'x-clicks',
  imports: [Text, View],
  template: `<view testID="box" (click)="clicks.set(clicks() + 1)"
    ><text>{{ clicks() }}</text></view
  >`,
})
class Clicks {
  readonly clicks = signal(0);
}

/** The renderer, for a listener a library attaches itself: `renderer.listen('window', ...)`. */
const rendererOf = (injector: { get<T>(token: unknown): T }) =>
  injector.get<RendererFactory2>(RendererFactory2).createRenderer(null, null);

test('an extension takes over the listeners it answers for, and leaves the rest', async () => {
  const heard: [unknown, string][] = [];
  const undo = extendRenderer({
    listen(target, eventName, callback, engine) {
      heard.push([typeof target === 'string' ? target : target.name, eventName]);
      if (typeof target === 'string' || eventName !== 'click') return undefined;
      // A click delivered from a layout, to show the extension chose what the event is.
      return engine.setEventListener(target, 'topLayout', callback);
    },
  });
  try {
    await render(Clicks);
    await fireEvent.layout(screen.getByTestId('box'), { width: 1, height: 1 });
    assert.ok(screen.getByText('1'), 'the click listener ran from the event the extension chose');
    assert.deepEqual(heard, [['view', 'click']]);

    const { componentRef } = await render(Clicks);
    rendererOf(componentRef.injector).listen('window', 'resize', () => {});
    assert.deepEqual(heard.slice(1), [
      ['view', 'click'],
      ['window', 'resize'],
    ]);
  } finally {
    undo();
  }
  heard.length = 0;
  await render(Clicks);
  assert.deepEqual(heard, [], 'and is not asked once it is taken away');
});

test('nodes answer to what a package gives them, until it is taken away', async () => {
  const undo = extendNodes({
    localName: {
      get(this: EngineNode) {
        return this.name;
      },
    },
    hasAttribute: {
      value(this: EngineNode, name: string) {
        return this.props[name] != null;
      },
    },
  });
  type Extended = EngineNode & { localName?: string; hasAttribute?(name: string): boolean };
  const { componentRef } = await render(Clicks);
  const root = componentRef.injector.get(Engine).root;
  const box = root.children[0]!.children[0] as Extended;
  try {
    assert.equal(box.localName, 'view');
    assert.equal(box.hasAttribute!('testID'), true);
    assert.equal(box.hasAttribute!('title'), false);
    for (const field of ['kind', 'props', 'children', 'defaultStyle', '__ngContext__']) {
      assert.throws(() => extendNodes({ [field]: { value: 'x' } }), new RegExp(field), field);
    }
  } finally {
    undo();
  }
  assert.equal(box.localName, undefined);
  assert.equal(box.hasAttribute, undefined);
});

test('a member a node already has is replaced, and put back', async () => {
  const { componentRef } = await render(Clicks);
  const box = componentRef.injector.get(Engine).root.children[0]!.children[0] as EngineNode & {
    classList: { contains?: unknown } | string;
  };
  const original = box.classList as { contains?: unknown };
  assert.equal(typeof original.contains, 'function');
  const undo = extendNodes({ classList: { get: () => 'replaced' } });
  try {
    assert.equal(box.classList, 'replaced');
  } finally {
    undo();
  }
  assert.equal(typeof (box.classList as { contains?: unknown }).contains, 'function');
});

test('members that cannot all be installed leave none behind', async () => {
  const { componentRef } = await render(Clicks);
  const box = componentRef.injector.get(Engine).root.children[0] as EngineNode & { first?: number };
  assert.throws(() =>
    extendNodes({ first: { value: 1 }, second: { value: 2, get: () => 2 } as PropertyDescriptor }),
  );
  assert.equal(box.first, undefined);
});

test('a member is taken away even when its descriptor says it is not configurable', async () => {
  const { componentRef } = await render(Clicks);
  const box = componentRef.injector.get(Engine).root.children[0] as EngineNode & { fixed?: number };
  const undo = extendNodes({ fixed: { value: 1, configurable: false } });
  assert.equal(box.fixed, 1);
  undo();
  assert.equal(box.fixed, undefined);
});

test('an extension added twice is removed once by each removal', async () => {
  let asked = 0;
  const extension = {
    listen: () => {
      asked++;
      return undefined;
    },
  };
  const first = extendRenderer(extension);
  const second = extendRenderer(extension);
  try {
    first();
    first();
    await render(Clicks);
    assert.equal(asked, 1, 'the second registration still answers');
  } finally {
    second();
  }
});
