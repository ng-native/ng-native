/**
 * `:first-of-type`, `:last-of-type`, `:only-of-type`, `:nth-of-type()` and
 * `:nth-last-of-type()`: a place among the siblings with the same element name, where
 * `:first-child` and its family count every sibling. A group of buttons squares the corners
 * between them with these, each button a component's host between the others.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function scene(css: string) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const group = engine.createElement('view');
  engine.appendChild(engine.root, group);
  /** An element called `id` at the end of the group, or before `before`. */
  const add = (name: string, id: string, before: EngineNode | null = null): EngineNode => {
    const node = engine.createElement(name);
    engine.setProp(node, 'testID', id);
    engine.insertBefore(group, node, before);
    return node;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** Which of the views called by these ids are committed at this opacity. */
  const lit = (ids: string[], opacity = 0.5): boolean[] => {
    engine.commit();
    const views = all(fabric.committed);
    return ids.map(
      (id) => views.find((view) => view.props['testID'] === id)?.props['opacity'] === opacity,
    );
  };
  return { engine, group, add, lit, reports };
}

describe('a place among siblings of the same element name', () => {
  it('is the first, the last and the only one of its name, whatever is between', () => {
    const css =
      'pressable:first-of-type { opacity: 0.5 } pressable:last-of-type { opacity: 0.25 } ' +
      'text:only-of-type { opacity: 0.5 }';
    const s = scene(css);
    s.add('text', 'label');
    s.add('pressable', 'a');
    s.add('view', 'gap');
    s.add('pressable', 'b');
    s.add('pressable', 'c');
    assert.deepEqual(s.reports, []);
    assert.deepEqual(s.lit(['label', 'a', 'b', 'c', 'gap']), [true, true, false, false, false]);
    assert.deepEqual(s.lit(['a', 'b', 'c'], 0.25), [false, false, true]);
  });

  it('counts with :nth-of-type() and :nth-last-of-type(), over its own name alone', () => {
    const s = scene(
      'pressable:nth-of-type(2) { opacity: 0.5 } pressable:nth-last-of-type(2n+1) { opacity: 0.25 }',
    );
    s.add('pressable', 'a');
    s.add('view', 'gap');
    s.add('pressable', 'b');
    s.add('text', 'label');
    s.add('pressable', 'c');
    assert.deepEqual(s.lit(['a', 'b', 'c']), [false, true, false]);
    assert.deepEqual(s.lit(['a', 'b', 'c'], 0.25), [true, false, true]);
  });

  it('is not the first of its name by being the first child of another', () => {
    // Asked with a class and no name, it is still the element's own name that is counted.
    const s = scene('.item:first-of-type { opacity: 0.5 }');
    const a = s.add('pressable', 'a');
    const b = s.add('view', 'b');
    const c = s.add('pressable', 'c');
    for (const node of [a, b, c]) s.engine.setClasses(node, 'item');
    assert.deepEqual(s.lit(['a', 'b', 'c']), [true, true, false]);
  });

  it('follows one of its name coming before it, after it, and going', () => {
    const s = scene(
      'pressable:first-of-type { opacity: 0.5 } pressable:last-of-type { opacity: 0.25 }',
    );
    const gap = s.add('view', 'gap');
    const b = s.add('pressable', 'b');
    assert.deepEqual(s.lit(['b']), [false], 'the last rule wins where it is both');
    assert.deepEqual(s.lit(['b'], 0.25), [true]);
    const a = s.add('pressable', 'a', gap);
    assert.deepEqual(s.lit(['a', 'b']), [true, false]);
    assert.deepEqual(s.lit(['a', 'b'], 0.25), [false, true]);
    s.add('pressable', 'c');
    assert.deepEqual(s.lit(['a', 'b', 'c'], 0.25), [false, false, true]);
    assert.equal(s.lit(['b'], 0.5)[0] || s.lit(['b'], 0.25)[0], false, 'the middle is neither');
    s.engine.removeChild(s.group, a);
    assert.deepEqual(s.lit(['b', 'c']), [true, false]);
    // One of another name coming and going changes nothing.
    s.add('text', 'label', b);
    assert.deepEqual(s.lit(['b', 'c']), [true, false]);
  });

  it('is asked of a box around the styled node too, as a group of buttons asks it', () => {
    const s = scene(
      'pressable:not(:first-of-type):not(:last-of-type) .face { opacity: 0.5 } ' +
        'pressable:first-of-type:not(:only-of-type) .face { opacity: 0.25 }',
    );
    const face = (host: EngineNode, id: string) => {
      const node = s.engine.createElement('view');
      s.engine.setClasses(node, 'face');
      s.engine.setProp(node, 'testID', id);
      s.engine.appendChild(host, node);
    };
    const hosts = ['a', 'b', 'c'].map((id) => s.add('pressable', `host-${id}`));
    hosts.forEach((host, at) => face(host, ['a', 'b', 'c'][at]!));
    assert.deepEqual(s.lit(['a', 'b', 'c']), [false, true, false]);
    assert.deepEqual(s.lit(['a', 'b', 'c'], 0.25), [true, false, false]);
    // Down to one: the only one of its name, and squared on no side.
    s.engine.removeChild(s.group, hosts[1]!);
    s.engine.removeChild(s.group, hosts[2]!);
    assert.deepEqual(s.lit(['a'], 0.25), [false]);
  });
});
