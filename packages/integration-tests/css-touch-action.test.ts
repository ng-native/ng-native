/**
 * `touch-action`: what a browser may do with a touch on an element, and so what the element
 * keeps for itself. `pan-y` on a slider says a drag across it is the slider's. From iOS 26 the
 * swipe back starts anywhere on a screen and takes a drag to the right from whatever was
 * following the finger, so a touch on such an element holds the screen's swipe off while it lasts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, registerViewName, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

registerViewName('rns-screen', 'RNSScreen');

const CSS =
  '.slider { touch-action: pan-y } .map { touch-action: none } .row { touch-action: pan-x }' +
  ' .plain { touch-action: manipulation } .both { touch-action: pan-x pan-y }';

function scene() {
  const reports: string[] = [];
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS, 'app.css', {
      onUnsupported: (m: string) => reports.push(m),
    }) as never,
  });
  const add = (name: string, classes: string, parent: EngineNode) => {
    const node = engine.createElement(name);
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes || name);
    engine.appendChild(parent, node);
    return node;
  };
  const screen = add('rns-screen', '', engine.root);
  const nodes: Record<string, EngineNode> = { screen };
  for (const name of ['slider', 'map', 'row', 'plain', 'both', 'button']) {
    nodes[name] = add('view', name, screen);
  }
  nodes['thumb'] = add('view', 'thumb', nodes['slider']!);
  engine.commit();
  const props = (id: string): Record<string, unknown> => {
    engine.commit();
    const find = (all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of all) {
        const found = each.props['nativeID'] === id ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(fabric.committed)!.props;
  };
  const touch = (name: string, phase: 'Start' | 'End' | 'Cancel') =>
    engine.dispatchEvent(nodes[name]!, `topTouch${phase}`, {
      touches: phase === 'Start' ? [{}] : [],
    });
  /** Whether the screen's swipe back can start: from anywhere, or from nowhere while held. */
  const swipe = () => {
    const distance = props('rns-screen')['gestureResponseDistance'] as { end?: number } | null;
    return distance?.end !== 0;
  };
  return { engine, nodes, props, touch, swipe, reports };
}

describe('touch-action', () => {
  it('is read, and nothing of it reaches a view', () => {
    const s = scene();
    assert.deepEqual(s.reports, []);
    assert.equal('touchAction' in s.props('slider'), false);
  });

  it('holds the swipe back off while a finger is on what keeps a sideways drag', () => {
    const s = scene();
    assert.equal(s.swipe(), true);
    s.touch('slider', 'Start');
    assert.equal(s.swipe(), false, 'pan-y: across is its own');
    s.touch('slider', 'End');
    assert.equal(s.swipe(), true, 'back once the finger lifts');
    s.touch('map', 'Start');
    assert.equal(s.swipe(), false, 'none: every drag is its own');
    s.touch('map', 'Cancel');
    assert.equal(s.swipe(), true);
  });

  it('holds it off for a touch on anything inside such an element', () => {
    const s = scene();
    s.touch('thumb', 'Start');
    assert.equal(s.swipe(), false);
    s.touch('thumb', 'End');
    assert.equal(s.swipe(), true);
  });

  it("leaves it on where a drag to the side is the browser's to take, or nothing is said", () => {
    const s = scene();
    for (const name of ['row', 'plain', 'both', 'button']) {
      s.touch(name, 'Start');
      assert.equal(s.swipe(), true, name);
      s.touch(name, 'End');
    }
  });

  it('leaves a screen whose swipe is off as it is, before and after', () => {
    const s = scene();
    // And one given a distance of its own has it back as it was.
    const own = { start: -1, end: 40, top: -1, bottom: -1 };
    s.engine.setProp(s.nodes['screen']!, 'gestureEnabled', false);
    s.engine.setProp(s.nodes['screen']!, 'gestureResponseDistance', own);
    s.touch('slider', 'Start');
    assert.equal(s.swipe(), false);
    s.touch('slider', 'End');
    assert.equal(s.props('rns-screen')['gestureEnabled'], false);
    assert.deepEqual(s.props('rns-screen')['gestureResponseDistance'], own);
  });
});
