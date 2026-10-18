/**
 * A frame of an animation that only paints: a spinner turning, a skeleton pulsing. Nothing about
 * the layout moved, so the engine plans no block again, lays out no grid and reads no box back
 * from native for it. A spinner on a page is a commit on every frame for as long as the page is
 * open, and each of those was paying for the whole page's layout.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type FabricUIManager } from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS = `
  @keyframes spin { to { transform: rotate(360deg) } }
  @keyframes grow { from { height: 10px } to { height: 110px } }
  .p { position: relative; width: 300px; height: 200px }
  .centre { position: absolute; left: 0; right: 0; margin: 0 auto; width: 100px; height: 10px }
  .spin { width: 20px; height: 20px; animation: spin 1s linear infinite }
  .grow { animation: grow 1s linear infinite }
  .wide { width: 200px }
`;

function scene(...classes: string[]) {
  const fabric = createLaidOutFabric();
  let reads = 0;
  const read = (fabric as FabricUIManager).getBoundingClientRect!;
  (fabric as FabricUIManager).getBoundingClientRect = (...args) => {
    reads++;
    return read(...args);
  };
  let now = 0;
  const sheet = compileCss(CSS, 'app.css');
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never, now: () => now });
  const nodes = new Map<string, EngineNode>();
  const add = (name: string, parent: EngineNode) => {
    const node = engine.createElement('view');
    engine.setClasses(node, name);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    return node;
  };
  const p = add('p', engine.root);
  for (const name of classes) add(name, p);
  engine.commit();
  /** One frame, `ms` later: what the platform's frame loop does. Answers the boxes read for it. */
  const frame = (ms: number): number => {
    now += ms;
    reads = 0;
    engine.advanceAnimations();
    engine.commit();
    return reads;
  };
  const left = (name: string) => fabric.box(name).left;
  return { engine, fabric, nodes, frame, left };
}

describe('a frame of an animation that only paints', () => {
  it('reads nothing back from native, where a frame that moves layout does', () => {
    const s = scene('centre', 'spin');
    assert.equal(s.left('centre'), 100);
    assert.equal(s.frame(100), 0);
    assert.equal(s.frame(100), 0);
    assert.equal(s.fabric.box('spin').width, 20);
    // The same frame of an animation of a height is a frame of layout.
    const moving = scene('centre', 'grow');
    assert.ok(moving.frame(100) > 0);
  });

  it('is a frame of layout again when anything else changed in it', () => {
    const s = scene('centre', 'spin');
    assert.equal(s.frame(100), 0);
    s.engine.setClasses(s.nodes.get('centre')!, 'centre wide');
    assert.ok(s.frame(100) > 0);
    assert.equal(s.left('centre'), 50);
    // And only that one: the frame after it paints again.
    assert.equal(s.frame(100), 0);
    // A box that comes, and one that goes.
    const added = s.engine.createElement('view');
    s.engine.setClasses(added, 'centre');
    s.engine.setProp(added, 'nativeID', 'late');
    s.engine.appendChild(s.nodes.get('p')!, added);
    assert.ok(s.frame(100) > 0);
    assert.equal(s.left('late'), 100);
    s.engine.removeChild(s.nodes.get('p')!, added);
    assert.ok(s.frame(100) > 0);
  });
  // A listener that throws leaves no frame painting only: what comes next is laid out.
  it('lays out a change after a frame whose listener threw', () => {
    const fabric = createLaidOutFabric();
    let now = 0;
    let fail = false;
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(CSS, 'app.css') as never,
      now: () => now,
      onDirty: () => {
        if (fail) throw new Error('listener');
      },
    });
    const add = (name: string, parent: EngineNode) => {
      const node = engine.createElement('view');
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name);
      engine.appendChild(parent, node);
      return node;
    };
    const p = add('p', engine.root);
    const centre = add('centre', p);
    add('spin', p);
    engine.commit();
    now += 100;
    fail = true;
    assert.throws(() => engine.advanceAnimations(), /listener/);
    fail = false;
    engine.setClasses(centre, 'centre wide');
    engine.commit();
    assert.equal(fabric.box('centre').left, 50);
  });
});

describe('a frame that only paints, beside a sticky box and a sum', () => {
  it('reads neither back, where a frame that moves layout reads both', () => {
    const fabric = createLaidOutFabric();
    // Which views are read back, by name.
    let reads = new Set<unknown>();
    const read = (fabric as FabricUIManager).getBoundingClientRect!;
    (fabric as FabricUIManager).getBoundingClientRect = (...args) => {
      reads.add((args[0] as { props?: Record<string, unknown> }).props?.['nativeID']);
      return read(...args);
    };
    let now = 0;
    const sheet = compileCss(
      `${CSS} .scroll { height: 300px } .head { position: sticky; top: 0; height: 20px }` +
        ' .sum { width: calc(100% - 20px); height: 10px } .narrow { width: 200px }',
      'app.css',
    );
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never, now: () => now });
    const add = (element: string, name: string, parent: EngineNode) => {
      const node = engine.createElement(element);
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name);
      engine.appendChild(parent, node);
      return node;
    };
    const scroll = add('scroll-view', 'scroll', engine.root);
    add('view', 'head', scroll);
    add('view', 'sum', scroll);
    const spinner = add('view', 'spin', scroll);
    engine.commit();
    const frame = () => {
      reads = new Set();
      now += 16;
      engine.advanceAnimations();
      engine.commit();
      return [...reads];
    };
    assert.deepEqual(frame(), []);
    assert.deepEqual(frame(), []);
    // The window changing size, which marks no node: what is laid out from it is read again.
    reads = new Set();
    engine.updateConditions({ width: 300, height: 800, colorScheme: 'light' });
    assert.ok(reads.has('head'), `${[...reads]}`);
    assert.deepEqual(frame(), []);
    // An animation of a size beside them: a frame of layout, which reads them.
    // With the scroll view narrower in the same frame: the sticky box is read and the sum follows.
    assert.equal(fabric.box('sum').width, 380);
    engine.setClasses(spinner, 'grow');
    engine.setClasses(scroll, 'scroll narrow');
    assert.ok(frame().includes('head'));
    assert.equal(fabric.box('sum').width, 180);
  });
});
