/**
 * Several surfaces from one runtime, as each desktop window and each iPadOS scene is. Fabric keeps
 * a single event handler per runtime, so the engines share one dispatcher, which registers once and
 * hands each event to the engine that made the target. Before it, the last engine to register took
 * every event, and a press in the first window reached the second's responder system, which had
 * never heard of the button.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, getFabricUIManager, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';

/** A surface with one button that counts its presses, on the fake Fabric given. */
function surface(fabric: FakeFabric, rootTag: number) {
  const engine = new Engine(fabric, rootTag, {});
  const button = engine.createElement('view');
  engine.setProp(button, 'nativeID', `button-${rootTag}`);
  engine.appendChild(engine.root, button);
  let presses = 0;
  engine.setResponder(button, {
    onStartShouldSetResponder: () => true,
    onResponderRelease: () => presses++,
  });
  engine.commit();
  return { engine, button, presses: () => presses };
}

/** The fake's committed view for an engine node, which is what native sends events for. */
const viewOf = (fabric: FakeFabric, node: EngineNode): FakeFabricNode => {
  const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
    for (const each of all) {
      if (each.instanceHandle === node) return each;
      const hit = find(each.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const view = find(fabric.committed);
  if (view) return view;
  // The fake keeps the last surface's commit only: make one for an earlier surface's node.
  return { instanceHandle: node, reactTag: -1, viewName: 'View', props: {}, children: [] } as never;
};

const press = (fabric: FakeFabric, node: EngineNode) => {
  fabric.emit(viewOf(fabric, node), 'topTouchStart', { touches: [{}], changedTouches: [{}] });
  fabric.emit(viewOf(fabric, node), 'topTouchEnd', { touches: [], changedTouches: [{}] });
};

describe('one event dispatcher for every surface', () => {
  it('registers with Fabric once, however many engines share it', () => {
    const fabric = createFakeFabric();
    let registrations = 0;
    const register = fabric.registerEventHandler!.bind(fabric);
    fabric.registerEventHandler = (handler) => {
      registrations++;
      register(handler);
    };
    surface(fabric, 1);
    surface(fabric, 11);
    assert.equal(registrations, 1);
  });

  it('hands a press to the engine that made its target, in either window', () => {
    const fabric = createFakeFabric();
    const first = surface(fabric, 1);
    const second = surface(fabric, 11);
    press(fabric, first.button);
    assert.equal(first.presses(), 1, 'the first window pressed its own button');
    assert.equal(second.presses(), 0);
    press(fabric, second.button);
    assert.equal(second.presses(), 1);
    assert.equal(first.presses(), 1);
  });

  it('stops handing events to an engine that has left, and keeps the others', () => {
    const fabric = createFakeFabric();
    const first = surface(fabric, 1);
    const second = surface(fabric, 11);
    second.engine.leaveEvents();
    press(fabric, second.button);
    assert.equal(second.presses(), 0, 'a closed window is told nothing');
    press(fabric, first.button);
    assert.equal(first.presses(), 1);
  });

  it('keeps dispatching for an engine made after every other left', () => {
    const fabric = createFakeFabric();
    surface(fabric, 1).engine.leaveEvents();
    const later = surface(fabric, 21);
    press(fabric, later.button);
    assert.equal(later.presses(), 1);
  });

  it('shares one dispatcher between two facades over the one native manager', () => {
    const raw = createFakeFabric();
    let registrations = 0;
    const register = raw.registerEventHandler!.bind(raw);
    raw.registerEventHandler = (handler) => {
      registrations++;
      register(handler);
    };
    const scope = globalThis as { nativeFabricUIManager?: unknown };
    const was = scope.nativeFabricUIManager;
    scope.nativeFabricUIManager = raw;
    try {
      // `getFabricUIManager` makes a facade a call, as each window's mount makes its own.
      const first = new Engine(getFabricUIManager(), 1, {});
      const second = new Engine(getFabricUIManager(), 11, {});
      assert.equal(registrations, 1);
      first.leaveEvents();
      second.leaveEvents();
    } finally {
      scope.nativeFabricUIManager = was;
    }
  });
});
