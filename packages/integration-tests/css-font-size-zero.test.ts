/**
 * A font size of 0. Chrome draws no text at it. React Native on Android throws on a size that is
 * not above zero (`TextAttributeProps.letterSpacing`), and iOS reads 0 as the default size, so
 * the engine commits a size too small to see instead, whichever way the 0 arrives.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function scene(css = '') {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
  const add = (id: string, classes: string, element = 'text', parent = engine.root): EngineNode => {
    const node = renderer.createElement(element) as EngineNode;
    renderer.setAttribute(node, 'class', classes);
    renderer.setAttribute(node, 'testID', id);
    if (element === 'text') renderer.appendChild(node, renderer.createText('Words'));
    renderer.appendChild(parent, node);
    return node;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** The font size the view called `id` is committed with. */
  const size = (id: string): unknown => {
    engine.commit();
    return all(fabric.committed).find((each) => each.props['testID'] === id)!.props['fontSize'];
  };
  return { renderer, add, size };
}

/** A size above zero that draws nothing anyone can see. */
function unseen(size: unknown): void {
  assert.equal(typeof size, 'number');
  assert.ok((size as number) > 0 && (size as number) < 0.01, String(size));
}

describe('a font size of 0', () => {
  it('commits a size above zero from a stylesheet, written or clamped', () => {
    const s = scene(
      '.zero { font-size: 0 } .px { font-size: 0px } .clamped { font-size: calc(0px - 5px) } .em { font-size: 0em }',
    );
    for (const id of ['zero', 'px', 'clamped', 'em']) s.add(id, id);
    for (const id of ['zero', 'px', 'clamped', 'em']) unseen(s.size(id));
  });

  it('commits a size above zero from an inline style and from a token', () => {
    const s = scene('.token { font-size: var(--s) }');
    const inline = s.add('inline', '');
    s.renderer.setStyle(inline, 'font-size', '0px');
    const clamped = s.add('clamped', '');
    s.renderer.setStyle(clamped, 'font-size', 'calc(1px - 5px)');
    const token = s.add('token', 'token');
    s.renderer.setStyle(token, '--s', '0px');
    unseen(s.size('inline'));
    unseen(s.size('clamped'));
    unseen(s.size('token'));
    // And the size it had once the 0 goes.
    s.renderer.setStyle(token, '--s', '12px');
    assert.equal(s.size('token'), 12);
    // And none once the inline 0 goes, as native takes a null to put its own back.
    s.renderer.removeStyle(inline, 'font-size', 0 as never);
    assert.equal(s.size('inline'), null);
  });

  it('commits a size above zero on a run of text inside a paragraph, and on a field', () => {
    const s = scene('.zero { font-size: 0 }');
    const paragraph = s.add('paragraph', '');
    s.add('run', 'zero', 'text', paragraph);
    s.add('field', 'zero', 'text-input');
    unseen(s.size('run'));
    unseen(s.size('field'));
  });

  it('leaves a small size above zero as it is', () => {
    const s = scene('.small { font-size: 0.5px }');
    s.add('small', 'small');
    assert.equal(s.size('small'), 0.5);
  });
});
