/**
 * A `calc()`, `min()` or `max()` of tokens bound as a style while the app runs, as Taiga UI sizes
 * a field's text: `el.style.fontSize = 'calc(1.25rem + var(--tui-font-offset))'`. Worked out where
 * the tokens are known, as the same sum in a stylesheet is, where native was sent the text.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** The props a view in `.a` commits with `prop` bound to `value`. */
function bound(css: string, prop: string, value: string): Record<string, unknown> {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'app.css') as never });
  const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
  const node = renderer.createElement('view') as EngineNode;
  renderer.setAttribute(node, 'nativeID', 'probe');
  renderer.setAttribute(node, 'class', 'a');
  renderer.setStyle(node, prop, value);
  renderer.appendChild(engine.root, node);
  engine.commit();
  const found = flatten(fabric.committed).find((one) => one.props['nativeID'] === 'probe')!;
  return { ...found.props, ...(found.props['style'] as Record<string, unknown> | undefined) };
}

describe('a sum of tokens bound as a style', () => {
  it('is worked out where the tokens are, as the same sum in a stylesheet is', () => {
    const css = '.a { --o: 2px; font-size: 10px }';
    assert.equal(bound(css, 'font-size', 'calc(1.25rem + var(--o))')['fontSize'], 22);
    assert.equal(bound(css, 'width', 'calc((var(--o) + 4px) * 2)')['width'], 12);
    assert.equal(bound(css, 'height', 'max(var(--o), 5px)')['height'], 5);
    assert.equal(bound(css, 'top', 'calc(var(--missing, 3px) * 2)')['top'], 6);
  });

  it('reads a token multiplied by a length as a number, as a stylesheet does', () => {
    const css = '.a { --scale: 2; --o: 2px }';
    assert.equal(bound(css, 'width', 'calc(var(--scale) * 1px)')['width'], 2);
    assert.equal(bound(css, 'width', 'calc(var(--missing, 3) * 1px)')['width'], 3);
    assert.equal(bound(css, 'width', 'calc(var(--o) + var(--scale) * 1px)')['width'], 4);
  });

  it('reads no space other than CSS white space between the parts, as a stylesheet does', () => {
    const css = '.a { --o: 2px; width: 7px }';
    assert.equal(bound(css, 'width', 'calc(var(--o)\n+ 1px)')['width'], 3);
    assert.notEqual(bound(css, 'width', 'calc(var(--o)\u00a0+ 1px)')['width'], 3);
  });

  it('is no text sent to native where it is no sum this reads', () => {
    const fontSize = bound('.a { --o: 2px }', 'font-size', 'calc(1.25rem + var(--o))')['fontSize'];
    assert.equal(typeof fontSize, 'number');
  });
});
