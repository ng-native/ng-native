/**
 * A `var()` whose fallback is a `calc()` of a viewport or font unit and a length:
 * `max-width: var(--dialog-max-width, calc(100vw - 32px))`. The unit is the device's to settle,
 * as it is for the same `calc()` written with no `var()` around it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function scene(css: string, width = 400) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: sheet as never,
    conditions: { width, height: 800, colorScheme: 'light' },
  });
  const node = engine.createElement('view');
  engine.setClasses(node, 'a');
  engine.appendChild(engine.root, node);
  const props = () => {
    engine.commit();
    return fabric.committed[0]!.props;
  };
  return { engine, node, props, reports };
}

describe('a var() that falls back to a calc() of a unit the device settles', () => {
  it('is the viewport less a length, where nothing sets the token', () => {
    const s = scene('.a { max-width: var(--max, calc(100vw - 32px)) }');
    assert.equal(s.props()['maxWidth'], 368);
    assert.deepEqual(s.reports, []);
  });

  it('follows the viewport, and gives way to the token once it is set', () => {
    const s = scene('.a { max-width: var(--max, calc(100vw - 32px)) } .set { --max: 120px }');
    assert.equal(s.props()['maxWidth'], 368);
    s.engine.updateConditions({ width: 600, height: 800, colorScheme: 'light' });
    assert.equal(s.props()['maxWidth'], 568);
    s.engine.setClasses(s.node, 'a set');
    assert.equal(s.props()['maxWidth'], 120);
  });

  it('is a share of the font size and a length too', () => {
    const s = scene('.a { font-size: 10px; margin-top: var(--gap, calc(2em + 4px)) }');
    assert.equal(s.props()['marginTop'], 24);
  });
});
