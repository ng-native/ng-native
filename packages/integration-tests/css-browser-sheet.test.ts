/**
 * What a stylesheet read as a browser reads it says that an app's own does not: one compiled
 * with `generated`, as the app's Tailwind sheet is under the classes its `browser` option names.
 * A clip along one axis is a clip, a list that scrolls down the page is a scroll overflow, and a
 * control's state is the prop the control keeps it in. An app's own sheet is told
 * what to write instead, as before.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function compiled(css: string, generated = true) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'library.css', {
    generated,
    onUnsupported: (message: string) => reports.push(message),
  });
  return { sheet, reports };
}

function scene(css: string, generated = true) {
  const { sheet, reports } = compiled(css, generated);
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const view = engine.createElement('view');
  engine.setClasses(view, 'c');
  engine.appendChild(engine.root, view);
  const props = () => {
    engine.commit();
    return fabric.committed[0]!.props;
  };
  return { engine, view, props, reports };
}

describe('overflow along one axis, in a stylesheet read as a browser reads it', () => {
  it('clips both axes for one that clips, as a view clips on both or on neither', () => {
    for (const css of ['.c { overflow-x: hidden }', '.c { overflow-y: clip }']) {
      const s = scene(css);
      assert.equal(s.props()['overflow'], 'hidden', css);
      assert.deepEqual(s.reports, []);
    }
  });

  it('is a scroll overflow for a list down the page, and none for one that scrolls across', () => {
    // A plain view clips both axes at `scroll` and does not scroll: only a scroll view does.
    assert.equal(scene('.c { overflow-y: auto }').props()['overflow'], 'scroll');
    assert.equal(scene('.c { overflow-y: scroll }').props()['overflow'], 'scroll');
    const across = scene('.c { overflow-x: auto }');
    assert.equal(across.props()['overflow'], undefined);
    assert.deepEqual(across.reports, []);
  });

  it("is still refused in an app's own stylesheet, which is told to write overflow", () => {
    const s = scene('.c { overflow-x: hidden }', false);
    assert.equal(s.props()['overflow'], undefined);
    assert.equal(s.reports.length, 1);
    assert.match(s.reports[0]!, /Write 'overflow'/);
  });
});

describe("a control's state, in a stylesheet read as a browser reads it", () => {
  const CSS =
    '.box { opacity: 0.1 } .box:checked { opacity: 1 } .box:indeterminate { opacity: 0.5 } ' +
    '.box:not(:checked) { width: 4px } .box:enabled { height: 6px }';

  function control(generated = true) {
    const { sheet, reports } = compiled(CSS, generated);
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const box: EngineNode = engine.createElement('view');
    engine.setClasses(box, 'box');
    engine.appendChild(engine.root, box);
    const seen = () => {
      engine.commit();
      const { opacity, width = null, height = null } = fabric.committed[0]!.props;
      return { opacity, width, height };
    };
    return { engine, box, seen, reports };
  }

  it('is read from the prop the control keeps it in, and follows it changing', () => {
    const s = control();
    assert.deepEqual(s.reports, []);
    assert.deepEqual(s.seen(), { opacity: 0.1, width: 4, height: 6 });
    s.engine.setProp(s.box, 'checked', true);
    assert.deepEqual(s.seen(), { opacity: 1, width: null, height: 6 });
    s.engine.setProp(s.box, 'disabled', true);
    assert.deepEqual(s.seen(), { opacity: 1, width: null, height: null });
    s.engine.setProp(s.box, 'checked', undefined);
    s.engine.setProp(s.box, 'disabled', undefined);
    assert.deepEqual(s.seen(), { opacity: 0.1, width: 4, height: 6 });
    s.engine.setProp(s.box, 'indeterminate', true);
    assert.equal(s.seen().opacity, 0.5);
  });

  it('is read on the host as well, whose selector is one compound and not a list', () => {
    for (const [css, host] of [
      [':host(.active) { opacity: 0.5 }', { classes: ['active'], host: true }],
      [
        ':host(:checked) { opacity: 0.5 }',
        { classes: [], host: true, attributes: [{ name: 'checked' }] },
      ],
    ] as const) {
      const { sheet, reports } = compiled(css);
      assert.deepEqual(reports, [], css);
      assert.deepEqual(sheet.rules[0].compounds, [host], css);
    }
  });

  it("is still refused in an app's own stylesheet, which is told to bind an attribute", () => {
    const s = control(false);
    assert.equal(s.seen().opacity, 0.1);
    assert.ok(s.reports.some((message) => /data-checked/.test(message)));
  });
});
