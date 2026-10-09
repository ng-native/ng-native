/**
 * An element moved under another box is styled by what is over it there.
 *
 * A box with nothing to style and nothing to hand down shares one cache with every other such
 * box, once it is resolved a second time: after the window is resized, say. Two of them then
 * look alike to what is under them, and an element moved from one to the other kept the style it
 * had, though a rule of its component asks about a class only one of them has.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const find = (nodes: readonly FakeFabricNode[], id: string): FakeFabricNode | undefined => {
  for (const each of nodes) {
    const found = each.props['nativeID'] === id ? each : find(each.children, id);
    if (found) return found;
  }
  return undefined;
};

/** Two boxes with no rules of their own, one `dark`, and an element of a component in the first. */
function scene() {
  const component = compileCss(
    '.dark .label { opacity: 0.25 } .label { opacity: 0.5 }',
    'component.css',
  ) as StyleSheet;
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {});
  const box = (classes: string): EngineNode => {
    const node = engine.createElement('view');
    if (classes) engine.setClasses(node, classes);
    engine.appendChild(engine.root, node);
    return node;
  };
  const dark = box('dark');
  const plain = box('');
  const label = (id: string): EngineNode => {
    const node = engine.createElement('view', component);
    engine.setClasses(node, 'label');
    engine.setProp(node, 'nativeID', id);
    return node;
  };
  const opacity = (id: string): unknown => find(fabric.committed, id)!.props['opacity'];
  /** Every cache is made again, and the two boxes come to share one. */
  const resize = (): void => {
    engine.updateConditions({ width: 500, height: 800, colorScheme: 'light' });
    assert.equal(dark.styleCache, plain.styleCache, 'the two boxes share a cache');
  };
  return { engine, dark, plain, label, opacity, resize };
}

describe('an element moved between two boxes that share a cache', () => {
  it('is styled by the box it is moved to, taken out and put in', () => {
    const s = scene();
    const label = s.label('label');
    s.engine.appendChild(s.dark, label);
    s.engine.commit();
    s.resize();
    assert.equal(s.opacity('label'), 0.25);

    s.engine.removeChild(s.dark, label);
    s.engine.appendChild(s.plain, label);
    s.engine.commit();
    assert.equal(s.opacity('label'), 0.5);

    s.engine.removeChild(s.plain, label);
    s.engine.insertBefore(s.dark, label, null);
    s.engine.commit();
    assert.equal(s.opacity('label'), 0.25);
  });

  it('is styled by the box it is moved to in one step', () => {
    const s = scene();
    const label = s.label('label');
    s.engine.appendChild(s.dark, label);
    s.engine.commit();
    s.resize();

    s.engine.appendChild(s.plain, label);
    s.engine.commit();
    assert.equal(s.opacity('label'), 0.5);
  });

  it('has what is under it styled by the box it is moved to, with no rule of its own', () => {
    const s = scene();
    const group = s.engine.createElement('view');
    s.engine.appendChild(group, s.label('label'));
    s.engine.appendChild(s.dark, group);
    s.engine.commit();
    s.resize();
    assert.equal(s.opacity('label'), 0.25);

    s.engine.removeChild(s.dark, group);
    s.engine.appendChild(s.plain, group);
    s.engine.commit();
    assert.equal(s.opacity('label'), 0.5);
  });

  it('keeps its style, and all under it, put back in the box it was taken from', () => {
    const s = scene();
    const first = s.label('first');
    const second = s.label('second');
    s.engine.appendChild(s.dark, first);
    s.engine.appendChild(s.dark, second);
    s.engine.commit();
    s.resize();
    const before = [first.styleCache, second.styleCache];

    // Moved to the end of the box it is in: a list reordered, which styles nothing again.
    s.engine.appendChild(s.dark, first);
    s.engine.commit();
    assert.deepEqual([first.styleCache, second.styleCache], before);
    assert.equal(s.opacity('first'), 0.25);
  });
});

describe('a box that shares a cache, changed in a commit that resolves another like it', () => {
  it('has what is under it styled again for a class any element under it may be matched by', () => {
    const component = compileCss(
      '.box:not(.plain) .label { opacity: 0.25 } .label { opacity: 0.5 }',
      'component.css',
    ) as StyleSheet;
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {});
    const box = (): EngineNode => {
      const node = engine.createElement('view');
      engine.setClasses(node, 'box');
      engine.appendChild(engine.root, node);
      return node;
    };
    const first = box();
    const second = box();
    const label = engine.createElement('view', component);
    engine.setClasses(label, 'label');
    engine.setProp(label, 'nativeID', 'label');
    engine.appendChild(second, label);
    engine.commit();
    engine.updateConditions({ width: 500, height: 800, colorScheme: 'light' });
    assert.equal(first.styleCache, second.styleCache, 'the two boxes share a cache');
    assert.equal(find(fabric.committed, 'label')!.props['opacity'], 0.25);

    // The first box is resolved before the second in the commit, and sets the cache's epoch.
    engine.setProp(first, 'nativeID', 'first');
    engine.addClass(second, 'plain');
    engine.commit();
    assert.equal(find(fabric.committed, 'label')!.props['opacity'], 0.5);
  });
});
