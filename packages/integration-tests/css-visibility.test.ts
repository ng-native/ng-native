/**
 * `visibility`, in a stylesheet read as a browser reads it: one compiled with `generated`, as the
 * app's Tailwind sheet is under the classes its `browser` option names. A box that is `hidden` keeps its room and is not seen or touched,
 * which is a view with no opacity that takes no touch. An app's own stylesheet is told to write
 * that itself, as before: nothing of a native view is called visibility.
 *
 * A library hides the copy of a field's text it measures by, and shows a panel by setting it
 * back to `visible` with a stronger rule.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function scene(css: string, classes: string, generated = true) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'library.css', {
    generated,
    onUnsupported: (message: string) => reports.push(message),
  });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const view = engine.createElement('view');
  engine.setClasses(view, classes);
  engine.appendChild(engine.root, view);
  const seen = () => {
    engine.commit();
    const { opacity = null, pointerEvents = null, visibility = null } = fabric.committed[0]!.props;
    return { opacity, pointerEvents, visibility };
  };
  return { engine, view, seen, reports };
}

const CSS =
  '.mirror { visibility: hidden } .faint { opacity: 0.5 } .shown { visibility: visible } ' +
  '.gone { visibility: collapse }';

describe('visibility in a stylesheet read as a browser reads it', () => {
  it('is no opacity and no touch for a box that is hidden, with nothing of its own sent', () => {
    const s = scene(CSS, 'mirror');
    assert.deepEqual(s.seen(), { opacity: 0, pointerEvents: 'none', visibility: null });
    assert.deepEqual(s.reports, []);
    assert.deepEqual(scene(CSS, 'gone').seen(), {
      opacity: 0,
      pointerEvents: 'none',
      visibility: null,
    });
  });

  it('hides a box committed before the sheet that hides it was added', () => {
    // Nothing in the app had asked for what only such a sheet is read for, until then.
    const s = scene('.faint { opacity: 0.5 }', 'faint mirror');
    assert.deepEqual(s.seen(), { opacity: 0.5, pointerEvents: null, visibility: null });
    s.engine.addGlobalSheet(compileCss(CSS, 'late.css', { generated: true }));
    assert.deepEqual(s.seen(), { opacity: 0, pointerEvents: 'none', visibility: null });
  });

  it('is over an opacity the box has, and gives it back when the box is visible again', () => {
    const s = scene(CSS, 'faint mirror');
    assert.equal(s.seen().opacity, 0);
    // A pointerEvents taken off travels as `auto`, which react-native-svg's Android root reads.
    s.engine.setClasses(s.view, 'faint mirror shown');
    assert.deepEqual(s.seen(), { opacity: 0.5, pointerEvents: 'auto', visibility: null });
    s.engine.setClasses(s.view, 'faint');
    assert.deepEqual(s.seen(), { opacity: 0.5, pointerEvents: 'auto', visibility: null });
  });

  it('is nothing at all for a box that is only ever visible', () => {
    assert.deepEqual(scene(CSS, 'shown').seen(), {
      opacity: null,
      pointerEvents: null,
      visibility: null,
    });
  });

  it("is still refused in an app's own stylesheet, which is told what to write", () => {
    const s = scene(CSS, 'mirror', false);
    assert.deepEqual(s.seen(), { opacity: null, pointerEvents: null, visibility: null });
    assert.ok(
      s.reports.some((message) => /visibility/.test(message) && /opacity: 0/.test(message)),
    );
  });
});

describe('a box clipped to nothing in a stylesheet read as a browser reads it', () => {
  // How a library hides what is for a screen reader alone: a box one pixel square, clipped to
  // an empty rectangle. A view is clipped to no smaller than itself, its shadow is drawn
  // outside it, and a minimum width is over the pixel: so a button hidden this way was a line
  // of shadow as wide as a button. It draws nothing and takes no touch, and is still there to
  // be read, which a box with no opacity is not.
  const drawn = (css: string, classes: string, generated = true) => {
    const reports: string[] = [];
    const sheet = compileCss(css, 'library.css', {
      generated,
      onUnsupported: (message: string) => reports.push(message),
    });
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const view = engine.createElement('view');
    engine.setClasses(view, classes);
    engine.appendChild(engine.root, view);
    engine.commit();
    const { props } = fabric.committed[0]!;
    const pick = (key: string) => props[key] ?? null;
    return {
      reports,
      keys: Object.keys(props),
      shadow: pick('boxShadow'),
      background: pick('backgroundColor'),
      min: [pick('minWidth'), pick('minHeight')],
      overflow: pick('overflow'),
      touch: pick('pointerEvents'),
      opacity: pick('opacity'),
    };
  };
  const BUTTON = '.raised.raised { min-width: 64px; background: red; box-shadow: 0 2px 4px black }';
  const NOTHING = {
    shadow: [],
    background: 'rgba(0, 0, 0, 0)',
    min: [0, 0],
    overflow: 'hidden',
    touch: 'none',
    opacity: null,
  };

  for (const clip of [
    'clip: rect(0 0 0 0)',
    'clip: rect(0, 0, 0, 0)',
    'clip: rect(0px, 0px, 0px, 0px)',
    'clip: rect(1px, 1px, 1px, 1px)',
    'clip-path: inset(50%)',
  ]) {
    it(`draws nothing and is still there, over rules that would draw it: ${clip}`, () => {
      const { reports, keys, ...seen } = drawn(
        `${BUTTON} .sr { position: absolute; width: 1px; height: 1px; ${clip} }`,
        'raised sr',
      );
      assert.deepEqual(seen, NOTHING);
      assert.deepEqual(reports, []);
      assert.equal(keys.includes('clipped'), false, 'with nothing of its own sent');
    });
  }

  it('is drawn again once it is no longer clipped', () => {
    const css = `${BUTTON} .sr { position: absolute; width: 1px; height: 1px; clip: rect(0 0 0 0) }`;
    const sheet = compileCss(css, 'library.css', { generated: true });
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const view = engine.createElement('view');
    engine.setClasses(view, 'raised sr');
    engine.appendChild(engine.root, view);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['minWidth'], 0);
    engine.setClasses(view, 'raised');
    engine.commit();
    const { props } = fabric.committed[0]!;
    assert.equal(props['minWidth'], 64);
    assert.equal(props['backgroundColor'], 'rgb(255, 0, 0)');
    assert.equal(props['overflow'] ?? null, null);
  });

  it('is drawn where the rectangle has something in it, and that is said', () => {
    const s = drawn(
      `${BUTTON} .part { position: absolute; clip: rect(0, 10px, 10px, 0) }`,
      'raised part',
    );
    assert.equal(s.min[0], 64);
    assert.equal(s.reports.length, 1);
  });

  it('is told to an app whose own stylesheet says it, as before', () => {
    const s = drawn(
      `${BUTTON} .sr { position: absolute; clip: rect(0 0 0 0) }`,
      'raised sr',
      false,
    );
    assert.equal(s.min[0], 64);
    assert.equal(s.reports.length, 1);
  });
});
