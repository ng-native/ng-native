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

  it('is read at the end of a chain of tokens, where none of them is set', () => {
    const s = scene(
      '.a { max-width: var(--max, var(--other, calc(100vw - 32px))) } .set { --other: 90px }',
    );
    assert.equal(s.props()['maxWidth'], 368);
    s.engine.setClasses(s.node, 'a set');
    assert.equal(s.props()['maxWidth'], 90);
  });

  it('is a share of the font size and a length too', () => {
    const s = scene('.a { font-size: 10px; margin-top: var(--gap, calc(2em + 4px)) }');
    assert.equal(s.props()['marginTop'], 24);
  });
});

describe('a side of a shorthand that is a calc() of more than one step around a var()', () => {
  // A stepper's header: `padding: calc((var(--header-height, 72px) - 24px) / 2) 24px`, which
  // is half of what its height leaves over a line. The longhand takes the same sum.
  const CSS = '.a { padding: calc((var(--h, 72px) - 24px) / 2) 24px } .short { --h: 56px }';

  it('is worked out from the fallback where nothing sets the token', () => {
    const s = scene(CSS);
    const { paddingTop, paddingBottom, paddingLeft, paddingRight } = s.props();
    assert.deepEqual([paddingTop, paddingRight, paddingBottom, paddingLeft], [24, 24, 24, 24]);
    assert.deepEqual(s.reports, []);
  });

  it('follows the token being set and unset', () => {
    const s = scene(CSS);
    s.engine.setClasses(s.node, 'a short');
    assert.equal(s.props()['paddingTop'], 16);
    assert.equal(s.props()['paddingLeft'], 24);
    s.engine.setClasses(s.node, 'a');
    assert.equal(s.props()['paddingBottom'], 24);
  });

  it('is the same in a pair, and beside a plain var()', () => {
    const s = scene('.a { --w: 8px; margin: calc((var(--h, 40px) + 4px) * 2) var(--w) }');
    const { marginTop, marginBottom, marginLeft } = s.props();
    assert.deepEqual([marginTop, marginBottom, marginLeft], [88, 88, 8]);
  });
});
