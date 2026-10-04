/**
 * The two places a package outside core can extend how a template is rendered: what a listener
 * is attached to, and what an engine node answers to. They are what a web-compatibility layer is
 * built on, and core knows nothing of the web for them.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, RendererFactory2, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { Engine, extendNodes, registerViewName, type EngineNode } from '@ng-native/fabric';
import { extendRenderer } from '@ng-native/platform';
import { cleanup, createFakeFabric, fireEvent, render, screen, settle } from '@ng-native/testing';

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

test('an extension is told of each element a template creates', async () => {
  const created: string[] = [];
  const undo = extendRenderer({ created: (node) => void created.push(node.name) });
  try {
    await render(Clicks);
    assert.deepEqual(created, ['x-clicks', 'view', 'text']);
  } finally {
    undo();
  }
});

test('an element name registered for a while goes back to what it was', async () => {
  const names = () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    return ['x-probe', 'text'].map((name) => {
      const node = engine.createElement(name);
      engine.appendChild(engine.root, node);
      engine.commit();
      return fabric.committed.at(-1)!.viewName;
    });
  };
  const before = names();
  const undoProbe = registerViewName('x-probe', 'RCTProbe');
  const undoText = registerViewName('text', 'RCTProbe');
  assert.deepEqual(names(), ['RCTProbe', 'RCTProbe']);
  undoText();
  undoProbe();
  assert.deepEqual(names(), before);
});

@Component({
  selector: 'x-attributes',
  template: `<div testID="box" title="a" [lang]="label()"></div>`,
})
class Attributes {
  readonly label = signal('one');
}

test('an extension takes the attributes and properties it answers for', async () => {
  const taken: [string, unknown][] = [];
  const undo = extendRenderer({
    set(node, name, value, engine) {
      if (name !== 'title' && name !== 'lang') return false;
      taken.push([name, value]);
      engine.setProp(node, 'accessibilityHint', `${name}=${String(value)}`);
      return true;
    },
  });
  try {
    await render(Attributes);
    const box = screen.getByTestId('box');
    assert.deepEqual(taken, [
      ['title', 'a'],
      ['lang', 'one'],
    ]);
    assert.equal(box.props['title'], undefined, 'not set as written');
    assert.equal(box.props['testID'], 'box', 'the rest are');
    assert.equal(box.props['accessibilityHint'], 'lang=one');
  } finally {
    undo();
  }
});

@Component({
  selector: 'x-styled',
  imports: [View],
  template: `<view testID="box" [style.inset-inline]="inset()" [style.opacity]="0.5"></view>`,
})
class Styled {
  readonly inset = signal<string | null>('4px 8px');
}

test('an extension answers the declarations a bound style is set as', async () => {
  const undo = extendRenderer({
    style(_node, name, value) {
      if (name !== 'inset-inline') return undefined;
      const [start, end] = value == null ? [null, null] : String(value).split(' ');
      return { start, end };
    },
  });
  try {
    const app = await render(Styled);
    const box = () => screen.getByTestId('box').props;
    assert.equal(box()['start'], 4, 'set as the renderer sets any declaration');
    assert.equal(box()['end'], 8);
    assert.equal(box()['insetInline'], undefined, 'and not as written');
    assert.equal(box()['opacity'], 0.5, 'one it does not answer for is left to the renderer');
    app.instance.inset.set(null);
    await settle();
    assert.equal(box()['start'] ?? null, null, 'and removed through it too');
    assert.equal(box()['end'] ?? null, null);
  } finally {
    undo();
  }
  await render(Styled);
  assert.equal(screen.getByTestId('box').props['insetInline'], '4px 8px', 'as written without it');
});

test('two extensions of one member are taken away in either order', async () => {
  const { componentRef } = await render(Clicks);
  const box = componentRef.injector.get(Engine).root.children[0] as EngineNode & {
    probe?: string;
    classList: unknown;
  };
  const first = () => extendNodes({ probe: { value: 'first' }, classList: { value: 'first' } });
  const second = () => extendNodes({ probe: { value: 'second' }, classList: { value: 'second' } });
  const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'classList');

  for (const order of ['newest first', 'oldest first'] as const) {
    const undoFirst = first();
    const undoSecond = second();
    assert.equal(box.probe, 'second', order);
    if (order === 'newest first') {
      undoSecond();
      assert.equal(box.probe, 'first', order);
      assert.equal(box.classList, 'first', order);
      undoFirst();
    } else {
      undoFirst();
      assert.equal(box.probe, 'second', 'the later one is not erased');
      assert.equal(box.classList, 'second', order);
      undoSecond();
    }
    assert.equal(box.probe, undefined, order);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'classList'),
      original,
      `${order}: the engine's own is back`,
    );
  }
});
