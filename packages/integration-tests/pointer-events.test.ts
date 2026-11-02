/**
 * Pointer events, which reach JavaScript by a path of their own. Fabric finds the view an event
 * landed on with `instanceHandle.stateNode.node` (`PointerEventsProcessor.cpp`) and drops the
 * event, with no error, where that is not an object. It reads the listeners from that view's
 * props, so a stale revision misses one added after the view was created.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, scrollsOverflow, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const add = (id: string, parent: EngineNode = engine.root): EngineNode => {
    const node = engine.createElement('view');
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const hover = (node: EngineNode) => {
    const heard: string[] = [];
    for (const type of ['topPointerEnter', 'topPointerLeave']) {
      engine.setEventListener(node, type, () => heard.push(type));
    }
    return heard;
  };
  const find = (id: string): FakeFabricNode => {
    const walk = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const node of nodes) {
        const found = node.props['nativeID'] === id ? node : walk(node.children);
        if (found) return found;
      }
      return undefined;
    };
    const found = walk(fabric.committed);
    assert.ok(found, `nothing committed as ${id}`);
    return found;
  };
  const stateNode = (node: FakeFabricNode) =>
    (node.instanceHandle as EngineNode).stateNode.node as unknown as FakeFabricNode | undefined;
  return { engine, fabric, add, hover, find, stateNode };
}

describe('a pointer event', () => {
  it('reaches a listener, entering and leaving', () => {
    const { engine, fabric, add, hover, find } = scene();
    const heard = hover(add('box'));
    engine.commit();
    fabric.emit(find('box'), 'topPointerEnter');
    fabric.emit(find('box'), 'topPointerLeave');
    assert.deepEqual(heard, ['topPointerEnter', 'topPointerLeave']);
  });

  it('finds the view as it was created', () => {
    const { engine, add, find, stateNode } = scene();
    add('box');
    engine.commit();
    assert.equal(stateNode(find('box')), find('box'));
  });

  it('finds the newest clone, which has a listener added after the view was created', () => {
    const { engine, add, hover, find, stateNode } = scene();
    const node = add('box');
    engine.commit();
    const created = find('box');
    assert.equal(stateNode(created), created);
    hover(node);
    engine.commit();
    const clone = find('box');
    assert.notEqual(clone, created, 'the listener cloned the view');
    assert.equal(stateNode(created), clone);
    assert.equal(stateNode(created)!.props['onPointerEnter'], true);
  });

  it('lands on the box of an element whose children are in a wrapper', () => {
    const { engine, fabric, add, hover, find, stateNode } = scene();
    const page = add('page');
    const heard = hover(page);
    engine.wrapChildren(page, { viewName: 'Wrapper', props: {} });
    add('child', page);
    engine.commit();
    const wrapper = find('page').children[0]!;
    assert.equal(wrapper.viewName, 'Wrapper');
    assert.equal(stateNode(wrapper), find('page'));
    assert.equal(find('page').props['onPointerEnter'], true, 'the box is what listens');
    fabric.emit(wrapper, 'topPointerEnter');
    assert.deepEqual(heard, ['topPointerEnter']);
  });

  it('lands on the box of a scroll view, from the view its content is in', () => {
    const { engine, fabric, add, hover, find, stateNode } = scene();
    const panel = add('panel');
    scrollsOverflow(panel);
    engine.setProp(panel, 'style', { overflow: 'auto' });
    const heard = hover(panel);
    engine.commit();
    const content = find('panel').children[0]!;
    assert.equal(stateNode(content), find('panel'));
    assert.equal(find('panel').props['onPointerEnter'], true, 'the box is what listens');
    fabric.emit(content, 'topPointerLeave');
    assert.deepEqual(heard, ['topPointerLeave']);
  });

  it('names no view once the node was removed, and is dropped', () => {
    const { engine, fabric, add, hover, find, stateNode } = scene();
    const node = add('box');
    const heard = hover(node);
    engine.commit();
    const view = find('box');
    engine.removeChild(engine.root, node);
    engine.commit();
    assert.equal(stateNode(view), undefined);
    fabric.emit(view, 'topPointerEnter');
    assert.deepEqual(heard, []);
  });
});
