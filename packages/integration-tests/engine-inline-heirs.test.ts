/**
 * A child that takes a value from its parent with `inherit` follows the parent's inline style,
 * replaced or changed in place, which is how `[style.opacity]` writes it.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss('.child { opacity: inherit }', 'app.css') as StyleSheet,
  });
  const parent = engine.createElement('view');
  const child = engine.createElement('view');
  engine.setClasses(child, 'child');
  engine.appendChild(parent, child);
  engine.appendChild(engine.root, parent);
  const childOpacity = () => fabric.committed[0]!.children[0]!.props['opacity'];
  return { engine, parent, childOpacity };
}

it('control: a replaced inline style reaches a child that inherits from it', () => {
  const s = scene();
  s.engine.setProp(s.parent, 'style', { opacity: 0.3 });
  s.engine.commit();
  assert.equal(s.childOpacity(), 0.3);
  s.engine.setProp(s.parent, 'style', { opacity: 0.7 });
  s.engine.commit();
  assert.equal(s.childOpacity(), 0.7);
});

it('an inline style changed in place reaches a child that inherits from it', () => {
  const s = scene();
  const style: Record<string, unknown> = { opacity: 0.3 };
  s.engine.setProp(s.parent, 'style', style);
  s.engine.commit();
  assert.equal(s.childOpacity(), 0.3);
  style['opacity'] = 0.7;
  s.engine.styleChanged(s.parent);
  s.engine.commit();
  assert.equal(s.childOpacity(), 0.7);
});
