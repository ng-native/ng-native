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

  it('hides what is in a hidden box, a box inside it that is visible included', () => {
    // A browser shows a `visibility: visible` box inside a hidden one. Here the hidden box is a
    // view with no opacity, and that is the opacity of all that is in it: the box inside is not
    // seen. This pins that, so a box shown inside a hidden one is a change made on purpose.
    const sheet = compileCss(CSS, 'library.css', { generated: true });
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const outer = engine.createElement('view');
    const inner = engine.createElement('view');
    engine.setClasses(outer, 'mirror');
    engine.setClasses(inner, 'shown');
    engine.appendChild(outer, inner);
    engine.appendChild(engine.root, outer);
    engine.commit();
    const [box] = fabric.committed;
    assert.equal(box!.props['opacity'], 0);
    assert.equal(box!.children.length, 1);
    assert.equal(box!.children[0]!.props['opacity'] ?? null, null);
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

  it('draws no border or outline, and is still there', () => {
    const css =
      '.ring { border: 1px solid red; outline: 2px solid blue; border-inline-start-width: 3px } ' +
      '.sr { position: absolute; width: 1px; height: 1px; clip: rect(0 0 0 0) }';
    const sheet = compileCss(css, 'library.css', { generated: true });
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const view = engine.createElement('view');
    engine.setClasses(view, 'ring sr');
    engine.appendChild(engine.root, view);
    const widths = () => {
      engine.commit();
      assert.equal(fabric.committed.length, 1, 'still in the tree');
      const { props } = fabric.committed[0]!;
      return Object.fromEntries(
        Object.keys(props)
          .filter((key) => /^(border|outline)\w*Width$/.test(key))
          .map((key) => [key, props[key]]),
      );
    };
    const clipped = widths();
    assert.ok(Object.keys(clipped).length > 0);
    for (const [key, width] of Object.entries(clipped)) assert.equal(width, 0, key);
    engine.setClasses(view, 'ring');
    const drawn = widths();
    assert.equal(drawn['borderTopWidth'], 1);
    assert.equal(drawn['borderStartWidth'], 3);
    assert.equal(drawn['outlineWidth'], 2);
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

describe('a box clipped to a band in a stylesheet read as a browser reads it', () => {
  // One picture over another, cut where a before-and-after slider is: the picture on top is
  // clipped to a band of itself from side to side. The band is kept for what draws an image
  // through it, and no native view is sent it.
  const BAND = 'clip-path: polygon(0 0, 50% 0, 50% 100%, 0 100%)';
  const compiled = (declaration: string, generated = true) => {
    const reports: string[] = [];
    const sheet = compileCss(`.top { position: absolute; ${declaration} }`, 'library.css', {
      generated,
      onUnsupported: (message: string) => reports.push(message),
    });
    const declarations = sheet.rules[0]?.declarations ?? {};
    return { sheet, reports, clipBand: declarations['clipBand'] };
  };

  it('is kept as the band it is, in a library sheet', () => {
    const band = compiled(BAND);
    assert.deepEqual(
      [band.clipBand, band.reports],
      ['polygon(0% 0%, 50% 0%, 50% 100%, 0% 100%)', []],
    );
    // Written another way: an edge that is part of a point, a zero that is a share, and the box
    // it is a band of named.
    const written = compiled(
      'clip-path: polygon(25% 0%, 75.5% 0, 75.5% 100%, 25% 100%) border-box',
    );
    assert.deepEqual(
      [written.clipBand, written.reports],
      ['polygon(25% 0%, 75.5% 0%, 75.5% 100%, 25% 100%)', []],
    );
  });

  it('is no band for clip-path: none, which ends one a rule before gave the box', () => {
    const none = compiled('clip-path: none');
    assert.deepEqual([none.clipBand, none.reports], ['none', []]);
  });

  it("is refused in an app's own stylesheet, as before", () => {
    const { clipBand, reports } = compiled(BAND, false);
    assert.equal(clipBand, undefined);
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /dropped 'clip-path'/);
  });

  describe('with an edge that is a token, settled for the box as a browser substitutes it', () => {
    const TOKENED = 'clip-path: polygon(0 0, var(--x, 50%) 0, var(--x, 50%) 100%, 0 100%)';
    const banded = (declaration: string, rule = '') => {
      const { sheet, reports } = compiled(`${declaration}${rule}`);
      const engine = new Engine(createFakeFabric(), 1, { globalStyles: sheet as never });
      const view = engine.createElement('view');
      engine.setClasses(view, 'top');
      engine.appendChild(engine.root, view);
      engine.commit();
      return { engine, view, reports, band: () => view.styleCache?.style['clipBand'] };
    };
    const band = (from: string, to: string) =>
      `polygon(${from}% 0%, ${to}% 0%, ${to}% 100%, ${from}% 100%)`;

    it('is the fallback where the token is not set', () => {
      const { band: clipBand, reports } = banded(TOKENED);
      assert.deepEqual([clipBand(), reports], [band('0', '50'), []]);
    });

    it("is the token's where a rule sets it", () => {
      assert.equal(banded(TOKENED, '; --x: 30%').band(), band('0', '30'));
    });

    it('moves as a script sets the token, and goes back to the fallback as it is taken away', () => {
      const { engine, view, band: clipBand } = banded(TOKENED);
      engine.setCustomProperty(view, '--x', '72.5%');
      engine.commit();
      assert.equal(clipBand(), band('0', '72.5'));
      engine.setCustomProperty(view, '--x', '');
      engine.commit();
      assert.equal(clipBand(), band('0', '50'));
    });

    it('takes a token for either edge, each the same at the top and the bottom', () => {
      const both =
        'clip-path: polygon(var(--a) 0, var(--b, 80%) 0, var(--b, 80%) 100%, var(--a) 100%)';
      assert.equal(banded(both, '; --a: 20%').band(), band('20', '80'));
    });

    it('is no band where the token is no share of the box, or is unset with nothing beside it', () => {
      assert.equal(banded(TOKENED, '; --x: 40px').band(), undefined);
      const bare = 'clip-path: polygon(0 0, var(--x) 0, var(--x) 100%, 0 100%)';
      assert.equal(banded(bare).band(), undefined);
    });

    it('is refused where the two ends of an edge are not the same', () => {
      const { clipBand, reports } = compiled(
        'clip-path: polygon(0 0, var(--x, 50%) 0, var(--y, 50%) 100%, 0 100%)',
      );
      assert.equal(clipBand, undefined);
      assert.equal(reports.length, 1);
    });
  });

  for (const other of [
    'polygon(0 0, 100% 0, 50% 100%)',
    'polygon(0 0, 40px 0, 40px 100%, 0 100%)',
    'polygon(0 0, 50% 0, 60% 100%, 0 100%)',
    'polygon(0 10%, 50% 10%, 50% 100%, 0 100%)',
    'polygon(0 0, calc(50% + 2px) 0, calc(50% + 2px) 100%, 0 100%)',
    'polygon(0 0, 50% 0, 50% 100%, 0 100%) content-box',
    'inset(10%)',
  ]) {
    it(`refuses any other shape: ${other}`, () => {
      const { clipBand, reports } = compiled(`clip-path: ${other}`);
      assert.equal(clipBand, undefined);
      assert.equal(reports.length, 1);
    });
  }

  it('is sent to no native view, and kept for the engine', () => {
    const { sheet } = compiled(BAND);
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const view = engine.createElement('view');
    engine.setClasses(view, 'top');
    engine.appendChild(engine.root, view);
    // A drawing's shape names the clip path it uses by a prop of that name, which native reads.
    const shape = engine.createElement('view');
    engine.setProp(shape, 'clipPath', 'c');
    engine.appendChild(engine.root, shape);
    engine.commit();
    const [banded, clipped] = fabric.committed;
    assert.equal(banded!.props['position'], 'absolute');
    assert.deepEqual(
      Object.keys(banded!.props).filter((key) => /^clip/.test(key)),
      [],
    );
    assert.equal(view.styleCache?.style['clipBand'], 'polygon(0% 0%, 50% 0%, 50% 100%, 0% 100%)');
    assert.equal(clipped!.props['clipPath'], 'c');
  });
});
