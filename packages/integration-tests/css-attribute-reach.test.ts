/**
 * A prop no rule reads restyles nothing. Any prop can be what a selector asks about, `[disabled]`
 * say, so one changing has its element matched again and everything in it: a progress bar's
 * `aria-valuenow` twenty times a second, a field's text on every key. Only the names a loaded
 * sheet's selectors mention can change what anything matches.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { resetStyleStats, styleStats } from '../fabric/src/css.ts';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS =
  '.a { color: red } [data-on] .b { width: 1px } .a:not([aria-busy]) .b { height: 2px } #named { opacity: 0.5 }';

function scene() {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const a = engine.createElement('view');
  engine.setClasses(a, 'a');
  engine.appendChild(engine.root, a);
  const b = engine.createElement('view');
  engine.setClasses(b, 'b');
  engine.appendChild(a, b);
  engine.commit();
  const resolved = (change: () => void): number => {
    resetStyleStats();
    change();
    engine.commit();
    return styleStats.nodesResolved;
  };
  const inner = () => fabric.committed[0]!.children[0]!.props;
  return { engine, a, b, resolved, inner };
}

it('matches nothing again for a prop no selector names', () => {
  const s = scene();
  assert.equal(
    s.resolved(() => s.engine.setProp(s.a, 'accessibilityValue', { now: 5 })),
    0,
  );
  assert.equal(
    s.resolved(() => s.engine.setProp(s.a, 'testID', 'bar')),
    0,
  );
  assert.equal(
    s.resolved(() => s.engine.setProp(s.a, 'testID', null)),
    0,
  );
});

it('matches again for one a selector names, wherever in the selector, and for an id', () => {
  const s = scene();
  assert.ok(s.resolved(() => s.engine.setProp(s.a, 'data-on', true)) > 0);
  assert.equal(s.inner()['width'], 1);
  assert.ok(s.resolved(() => s.engine.setProp(s.a, 'data-on', null)) > 0);
  assert.equal(s.inner()['width'] ?? null, null);
  // Named inside a `:not()`.
  assert.equal(s.inner()['height'], 2);
  assert.ok(s.resolved(() => s.engine.setProp(s.a, 'aria-busy', true)) > 0);
  assert.equal(s.inner()['height'] ?? null, null);
  assert.ok(s.resolved(() => s.engine.setProp(s.b, 'nativeID', 'named')) > 0);
  assert.equal(s.inner()['opacity'], 0.5);
});
