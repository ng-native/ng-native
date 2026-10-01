/**
 * The Renderer2 surface Angular actually exercises, plus golden parity assertions so a
 * refactor of the commit path cannot silently change output.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { mount, type MountResult } from '@ng-native/platform';
import type { EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Features {
  mode: { set(value: 'a' | 'b' | 'c'): void };
  ready: { set(value: boolean): void };
  showListener: { set(value: boolean): void };
  insert(): { destroy(): void };
}

function findEngineNode(node: EngineNode, name: string): EngineNode | undefined {
  if (node.name === name) return node;
  for (const child of node.children) {
    const hit = findEngineNode(child, name);
    if (hit) return hit;
  }
  return undefined;
}

describe('the renderer', () => {
  let fabric: FakeFabric;
  let app: MountResult;
  let instance: Features;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/features.ts', import.meta.url)),
    );
    fabric = createFakeFabric();
    app = mount(1, mod['Features'] as Type<unknown>, fabric);
    instance = app.componentRef.instance as Features;
    await settle();
  });

  after(() => app.applicationRef.destroy());

  it('renders the matching @switch case', () => {
    assert.match(fabric.render(), /RawText "mode a"/);
    assert.doesNotMatch(fabric.render(), /mode b|mode other/);
  });

  it('re-renders @switch on a case change, including @default', async () => {
    instance.mode.set('b');
    await settle();
    assert.match(fabric.render(), /RawText "mode b"/);

    instance.mode.set('c');
    await settle();
    assert.match(fabric.render(), /RawText "mode other"/);
    assert.doesNotMatch(fabric.render(), /"mode a"|"mode b"/);
  });

  it('renders the @placeholder before the @defer trigger fires', () => {
    assert.match(fabric.render(), /RawText "placeholder"/);
    assert.doesNotMatch(fabric.render(), /RawText "deferred"/);
  });

  it('swaps in the @defer block once triggered', async () => {
    instance.ready.set(true);
    await settle();
    await settle();
    assert.match(fabric.render(), /RawText "deferred"/);
    assert.doesNotMatch(fabric.render(), /RawText "placeholder"/);
  });

  it('projects content into named and default slots in order', () => {
    const lines = fabric
      .render()
      .split('\n')
      .map((l) => l.trim());
    const header = lines.indexOf('RawText "slotted header"');
    const body = lines.indexOf('RawText "slotted body"');
    assert.ok(header > -1 && body > -1, 'both slots projected');
    assert.ok(header < body, 'named slot renders before the default slot');
  });

  it('inserts a component through ViewContainerRef and commits it', async () => {
    // A frame an earlier test left pending commits whatever is dirty when it fires, and firing
    // between the insert and its change detection would count as a second commit. Off a device
    // the frame is a 16ms timer, so waiting one out leaves only this insert's own commit.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = fabric.calls.completeRoot;
    const ref = instance.insert();
    await settle();

    assert.equal(fabric.calls.completeRoot - before, 1, 'one commit for the insert');
    assert.match(fabric.render(), /RawText "\[badge\]"/);

    ref.destroy();
    await settle();
    assert.doesNotMatch(fabric.render(), /RawText "\[badge\]"/);
  });

  it('calls destroyNode so listeners do not outlive their view', async () => {
    const pressable = findEngineNode(app.engine.root, 'pressable');
    assert.ok(pressable, 'pressable is in the retained tree');
    assert.ok(pressable.listeners?.size, 'listener registered while the view is alive');

    instance.showListener.set(false);
    await settle();

    assert.equal(pressable.listeners, null, 'destroyNode cleared the listeners');
    assert.equal(findEngineNode(app.engine.root, 'pressable'), undefined, 'node detached');
  });
});

describe('golden parity', () => {
  it('commits a stable golden tree for a given template', async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/features.ts', import.meta.url)),
    );
    const fabric = createFakeFabric();
    const app = mount(1, mod['Features'] as Type<unknown>, fabric);
    await settle();

    assert.equal(
      fabric.render({ props: true }),
      [
        // Every paragraph is an accessibility element on iOS, and ends truncated text in an
        // ellipsis, as `Text.js` makes it.
        'View {"height":"100%"}',
        '  Paragraph {"accessible":true,"ellipsizeMode":"tail"}',
        '    RawText "mode a"',
        '  Paragraph {"accessible":true,"ellipsizeMode":"tail"}',
        '    RawText "placeholder"',
        '  View',
        '    View',
        '      Paragraph {"accessible":true,"ellipsizeMode":"tail","header":""}',
        '        RawText "slotted header"',
        '      Paragraph {"accessible":true,"ellipsizeMode":"tail"}',
        '        RawText "slotted body"',
        '  View',
        // A pressable is an element and focusable, and measures itself for its press rectangle,
        // so it opts into layout events too. `collapsable: false` is the responder's: Fabric
        // flattens a view whose props say nothing interactive, and a responder is registered in
        // JavaScript where Fabric cannot see it. The two pointer props are hover: a control that
        // can be pressed always wants the hover look on a device that has a cursor, and Fabric
        // will not dispatch a pointer event to a view whose props have not asked for one.
        '  View {"accessible":true,"collapsable":false,"focusable":true,"onLayout":true,' +
          '"onPointerEnter":true,"onPointerLeave":true}',
        '    Paragraph {"accessible":true,"ellipsizeMode":"tail"}',
        '      RawText "listener"',
      ].join('\n'),
    );

    app.applicationRef.destroy();
  });
});
