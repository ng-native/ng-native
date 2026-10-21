/**
 * An attribute a package keeps for a node apart from its props: a drawing's `width`, whose native
 * view reads a prop of another name. `keepAttribute` hands it to the engine, so an attribute
 * selector matches it as it would a prop, and a change to it restyles what a prop's would.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(css: string, context: string, options?: { generated?: boolean }): unknown;
};

function scene(css: string, generated = false) {
  const fabric = createFakeFabric();
  const sheet = compileCss(css, 'app.css', { generated });
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** The committed props of the view with `testID`. */
  const props = (testID: string): Record<string, unknown> | undefined => {
    engine.commit();
    return all(fabric.committed).find((node) => node.props['testID'] === testID)?.props;
  };
  const el = (testID: string, parent: EngineNode = engine.root, name = 'view'): EngineNode => {
    const node = engine.createElement(name);
    engine.setProp(node, 'testID', testID);
    engine.appendChild(parent, node);
    return node;
  };
  return { engine, fabric, props, el };
}

describe('an attribute a package keeps apart from props', () => {
  it('matches an attribute selector, and stops matching as it changes or goes', () => {
    const s = scene('[width="16"] { opacity: 0.5 } view[height] { margin-top: 3px }');
    const node = s.el('drawing');
    assert.equal(s.props('drawing')?.['opacity'] ?? null, null);
    s.engine.keepAttribute(node, 'width', '16');
    s.engine.keepAttribute(node, 'height', '16');
    assert.equal(s.props('drawing')?.['opacity'], 0.5);
    assert.equal(s.props('drawing')?.['marginTop'], 3);
    s.engine.keepAttribute(node, 'width', '20');
    assert.equal(s.props('drawing')?.['opacity'] ?? null, null);
    s.engine.keepAttribute(node, 'height', null);
    assert.equal(s.props('drawing')?.['marginTop'] ?? null, null);
  });

  it('is what the selector reads where a prop has the same name', () => {
    const s = scene('[fill="none"] { opacity: 0.5 }');
    const node = s.el('shape');
    s.engine.setProp(node, 'fill', 4278190080);
    s.engine.keepAttribute(node, 'fill', 'none');
    assert.equal(s.props('shape')?.['opacity'], 0.5);
    // And it is no prop: the native view is sent what it reads.
    assert.equal(s.props('shape')?.['fill'], 4278190080);
  });

  it('matches where a prop of the same name is false, which is no attribute of its own', () => {
    const s = scene('[fill] { opacity: 0.5 }');
    const node = s.el('shape');
    s.engine.setProp(node, 'fill', false);
    assert.equal(s.props('shape')?.['opacity'] ?? null, null);
    s.engine.keepAttribute(node, 'fill', 'red');
    assert.equal(s.props('shape')?.['opacity'], 0.5);
  });

  it('has a `:has()` on the parent matched again as such a child comes or changes', () => {
    const s = scene('.host:has(> [width="16"]) { opacity: 0.5 }');
    const host = s.el('host');
    s.engine.setClasses(host, 'host');
    assert.equal(s.props('host')?.['opacity'] ?? null, null);
    const child = s.engine.createElement('view');
    s.engine.keepAttribute(child, 'width', '16');
    s.engine.appendChild(host, child);
    assert.equal(s.props('host')?.['opacity'], 0.5);
    s.engine.keepAttribute(child, 'width', '20');
    assert.equal(s.props('host')?.['opacity'] ?? null, null);
    s.engine.keepAttribute(child, 'width', '16');
    assert.equal(s.props('host')?.['opacity'], 0.5);
  });

  it('gives a box a rule names by that attribute alone', () => {
    const s = scene('[width="16"]::before { content: ""; width: 4px }', true);
    const node = s.el('drawing');
    s.props('drawing');
    const box = () => s.engine.root.childList[0]!.childList[0]?.tag;
    assert.equal(box(), undefined);
    s.engine.keepAttribute(node, 'width', '16');
    s.props('drawing');
    assert.equal(box(), '::before');
    s.engine.keepAttribute(node, 'width', null);
    s.props('drawing');
    assert.equal(box(), undefined);
  });
});
