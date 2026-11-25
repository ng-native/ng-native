/**
 * A `var()` fallback below zero, on a property that takes nothing below zero. Written out, it is
 * invalid when it is used, and Chrome unsets the property; the result of a math function is
 * clamped to zero instead. `em` and viewport units are settled on the device, where the two are
 * otherwise the same marker.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(source: string, context?: string, options?: object): StyleSheet;
};

function props(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const sheet = compileCss(`.a { width: 10px; font-size: 10px } ${css}`, 'fallback.css', {
    onUnsupported: () => {},
  });
  const node = engine.createElement('view', sheet);
  engine.addClass(node, 'a');
  engine.appendChild(engine.root, node);
  engine.commit();
  return fabric.committed[0]!.props;
}

describe('a var() fallback below zero, where nothing below zero is taken', () => {
  it('unsets the width, written in em as in points', () => {
    assert.equal(props('.a { width: var(--x, -1em) }')['width'] ?? null, null);
    assert.equal(props('.a { width: var(--x, -4px) }')['width'] ?? null, null);
  });

  it('is 0 from a math function, em as points', () => {
    assert.equal(props('.a { width: var(--x, calc(1em - 2em)) }')['width'], 0);
    assert.equal(props('.a { width: var(--x, calc(1px - 2px)) }')['width'], 0);
  });

  it('unsets every side of a padding with one side below zero, and a margin keeps it', () => {
    const padding = props('.a { padding: 3px; padding: var(--x, 4px -1px) }');
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      assert.equal(padding[`padding${side}`] ?? null, null, side);
    }
    const inEm = props('.a { padding: 3px; padding: var(--x, 1em -0.5em) }');
    assert.equal(inEm['paddingTop'] ?? null, null, 'a side in em below zero too');
    const margin = props('.a { margin: var(--x, 4px -1px) }');
    assert.equal(margin['marginTop'], 4);
    assert.equal(margin['marginRight'], -1);
  });

  it('unsets every side for a percentage below zero, and clamps a math side alone', () => {
    const percent = props('.a { padding: 3px; padding: var(--x, 4px -1%) }');
    assert.equal(percent['paddingTop'] ?? null, null);
    const math = props('.a { padding: var(--x, 4px calc(1em - 2em)) }');
    assert.equal(math['paddingTop'], 4, 'a written side above zero stays');
    assert.equal(math['paddingRight'], 0, "a math side is clamped, as a math function's result is");
    const radius = props('.a { border-radius: var(--x, 4px calc(1em - 2em)) }');
    assert.equal(radius['borderTopLeftRadius'], 4);
    assert.equal(radius['borderTopRightRadius'], 0);
  });

  it('unsets every corner of a radius with one corner below zero', () => {
    const radius = props('.a { border-radius: var(--x, 4px -1px) }');
    assert.equal(radius['borderTopLeftRadius'] ?? null, null);
    assert.equal(radius['borderTopRightRadius'] ?? null, null);
  });

  it('is read as it is above zero', () => {
    assert.equal(props('.a { width: var(--x, 2em) }')['width'], 20);
  });
});
