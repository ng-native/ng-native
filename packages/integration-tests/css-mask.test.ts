/**
 * A mask in a sheet read as a browser reads it: compiled to what `@ng-native/web-compat` draws
 * from, and told by the engine to whoever draws it, settled against the node it is on.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type MaskStyle, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const ICON = 'url("icon.svg")';

function compiled(css: string, generated = true) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'lib', {
    generated,
    onUnsupported: (m: string) => reports.push(m),
  });
  return { sheet: sheet as StyleSheet, reports, rule: sheet.rules[0] };
}

describe('a mask, compiled from a sheet read as a browser reads it', () => {
  it('keeps the one url() a mask is drawn from, and none', () => {
    assert.equal(compiled('.a { mask-image: url(icon.svg) }').rule.declarations.maskImage, ICON);
    assert.equal(
      compiled('.a { -webkit-mask-image: url(icon.svg) }').rule.declarations.maskImage,
      ICON,
    );
    assert.equal(compiled('.a { mask-image: none }').rule.declarations.maskImage, null);
  });

  it("keeps a token's image for the device to read", () => {
    assert.deepEqual(compiled('.a { mask-image: var(--icon) }').rule.deferred, [
      { props: ['maskImage'], kind: 'keyword', reference: '--icon' },
    ]);
  });

  it('keeps the first layer of the size, each axis on its own', () => {
    const size = (value: string) => {
      const { rule, reports } = compiled(`.a { mask-size: ${value} }`);
      assert.deepEqual(reports, [], value);
      return [rule.declarations.maskWidth, rule.declarations.maskHeight];
    };
    assert.deepEqual(size('contain'), ['contain', 'contain']);
    assert.deepEqual(size('cover'), ['cover', 'cover']);
    assert.deepEqual(size('20px'), [20, 'auto']);
    assert.deepEqual(size('50% 10px, 100%'), ['50%', 10]);
    assert.deepEqual(size('calc(100% + 10px) 100%'), [{ size: '100%', plus: 10 }, '100%']);
  });

  it("reads Taiga UI's icon sizes, with a token and a share of the box in them", () => {
    const { rule, reports } = compiled(
      '.a { mask-size: calc(min(1em, 100%) + 10 * var(--stroke)) min(1em, 100%), 100% }',
    );
    assert.deepEqual(reports, []);
    assert.deepEqual(rule.deferred, [
      {
        props: ['maskWidth'],
        within: {
          size: { __defer: { unit: 'em', factor: 1 } },
          upTo: '100%',
          plus: { __calc: { expression: ['*', 10, { reference: '--stroke' }], kind: 'length' } },
        },
      },
      {
        props: ['maskHeight'],
        within: { size: { __defer: { unit: 'em', factor: 1 } }, upTo: '100%' },
      },
    ]);
  });

  it('keeps the position and reads the shorthand', () => {
    const { rule } = compiled('.a { mask: url(icon.svg) right 2px top / contain no-repeat }');
    assert.deepEqual(rule.declarations, {
      maskImage: ICON,
      maskWidth: 'contain',
      maskHeight: 'contain',
      maskPosition: { right: 2, top: 0 },
    });
  });

  it('reports what is not drawn: a gradient, several layers, a repeat, a composite', () => {
    for (const css of [
      '.a { mask-image: linear-gradient(red, blue) }',
      '.a { mask-image: url(a.svg), url(b.svg) }',
      '.a { mask-repeat: repeat }',
      '.a { mask-composite: intersect }',
      '.a { mask-mode: luminance }',
    ]) {
      assert.equal(compiled(css).reports.length, 1, css);
    }
    assert.equal(compiled('.a { mask-image: linear-gradient(red, blue) }').rule, undefined);
  });

  it('reports a box the mask is placed in or cut to other than the one inside the border', () => {
    for (const css of [
      '.a { mask-origin: content-box }',
      '.a { mask-clip: content-box }',
      '.a { mask-clip: no-clip }',
      '.a { mask: url(a.svg) content-box border-box no-repeat }',
    ]) {
      assert.equal(compiled(css).reports.length, 1, css);
    }
    for (const css of [
      '.a { mask-origin: border-box; mask-clip: border-box }',
      '.a { mask-origin: padding-box; mask-clip: padding-box }',
      '.a { mask: url(a.svg) no-repeat }',
    ]) {
      assert.deepEqual(compiled(css).reports, [], css);
    }
  });

  it('keeps what an earlier declaration set where a later one is dropped whole', () => {
    const kept = compiled(
      '.a { mask-image: url(old.svg); mask: url(new.svg) center / max(1em, 10px) no-repeat }',
    );
    assert.equal(kept.reports.length, 1);
    assert.deepEqual(kept.rule.declarations, { maskImage: 'url("old.svg")' });
    const half = compiled('.a { mask-size: 10px 20px; mask-size: 30px max(1em, 10px) }');
    assert.deepEqual(
      [half.rule.declarations.maskWidth, half.rule.declarations.maskHeight],
      [10, 20],
    );
    const replaced = compiled(
      '.a { mask-image: url(old.svg); mask: url(new.svg) center / contain no-repeat }',
    );
    assert.equal(replaced.rule.declarations.maskImage, 'url("new.svg")');
  });

  it('keeps a relative length beside a token in the size', () => {
    const { rule, reports } = compiled('.a { mask-size: 1em var(--h) }');
    assert.deepEqual(reports, []);
    assert.deepEqual(rule.deferred, [
      { props: ['maskWidth'], within: { __defer: { unit: 'em', factor: 1 } } },
      { props: ['maskHeight'], kind: 'length', reference: '--h' },
    ]);
    assert.deepEqual(compiled('.a { mask-size: 10px var(--h) }').rule.declarations, {
      maskWidth: 10,
    });
  });

  it("is refused in an app's own stylesheet, which says what draws one", () => {
    const { reports } = compiled('.a { mask-image: url(icon.svg) }', false);
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /web-compat/);
  });
});

/** A view wearing `.a` under `css`, and every mask the engine told of. */
function masked(css: string, drawer = true) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compiled(css).sheet,
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });
  const told: (MaskStyle | null)[] = [];
  if (drawer) engine.setMaskDrawer((_node: EngineNode, mask: MaskStyle | null) => told.push(mask));
  const view = engine.createElement('view');
  engine.setClasses(view, 'a');
  engine.appendChild(engine.root, view);
  engine.commit();
  const props = () => (fabric.committed[0] as FakeFabricNode).props;
  return { engine, view, told, props };
}

describe('a mask, told by the engine to what draws it', () => {
  const ICON_CSS =
    '.a { font-size: 16px; --stroke: 2px; --icon: url(icon.svg); position: static;' +
    ' background: rgb(255, 0, 0); mask-image: var(--icon); mask-position: center;' +
    ' mask-size: calc(min(1em, 100%) + 10 * var(--stroke)) min(1em, 100%) }';

  it('is told settled against the node, with the colour the box would paint', () => {
    const { told } = masked(ICON_CSS);
    assert.deepEqual(told, [
      {
        image: ICON,
        width: { size: 16, upTo: '100%', plus: 20 },
        height: { size: 16, upTo: '100%' },
        position: { left: '50%', top: '50%' },
        colour: 'rgb(255, 0, 0)',
      },
    ]);
  });

  it('commits no mask, no background of its own, and holds what is drawn in it', () => {
    const { props } = masked(ICON_CSS);
    for (const key of ['maskImage', 'maskWidth', 'maskHeight', 'maskPosition', 'backgroundColor']) {
      assert.equal(props()[key], undefined, key);
    }
    assert.equal(props()['position'], 'relative');
  });

  it('is told again for a new colour or token, once, and nothing for a commit that changes neither', () => {
    const { engine, view, told } = masked(ICON_CSS);
    engine.setProp(view, 'style', { backgroundColor: 'rgb(0, 0, 255)' });
    engine.commit();
    engine.setProp(view, 'nativeID', 'x');
    engine.commit();
    engine.setCustomProperty(view, '--icon', 'url(other.svg)');
    engine.commit();
    assert.deepEqual(
      told.map((mask) => [mask?.image, mask?.colour]),
      [
        [ICON, 'rgb(255, 0, 0)'],
        [ICON, 'rgb(0, 0, 255)'],
        ['url(other.svg)', 'rgb(0, 0, 255)'],
      ],
    );
  });

  it('is told there is none when the mask goes, and the background comes back', () => {
    const { engine, view, told, props } = masked(ICON_CSS);
    engine.setCustomProperty(view, '--icon', 'none');
    engine.commit();
    assert.equal(told.at(-1), null);
    assert.equal(props()['backgroundColor'], 'rgb(255, 0, 0)');
  });

  it('leaves the box as it was where nothing draws masks', () => {
    const { props } = masked(ICON_CSS, false);
    assert.equal(props()['backgroundColor'], 'rgb(255, 0, 0)');
    assert.equal(props()['maskImage'], undefined);
    assert.equal(props()['position'], 'static');
  });

  it('is told of a relative length beside a token, settled', () => {
    const { told } = masked(
      '.a { font-size: 16px; --h: 4px; mask-image: url(icon.svg); mask-size: 1em var(--h) }',
    );
    assert.deepEqual([told[0]?.width, told[0]?.height], [16, 4]);
  });

  it('is not told of a token of several layers, which is reported and drawn unmasked', () => {
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => void warned.push(message);
    try {
      const { engine, view, told, props } = masked(ICON_CSS);
      engine.setCustomProperty(view, '--icon', 'url(a.svg), url(b.svg)');
      engine.commit();
      assert.equal(told.at(-1), null);
      assert.equal(props()['backgroundColor'], 'rgb(255, 0, 0)');
      assert.equal(props()['maskImage'], undefined);
      assert.equal(warned.length, 1);
      assert.match(warned[0]!, /several layers/);
    } finally {
      console.warn = warn;
    }
  });

  it('commits no mask key from a rule with no image, with or without a drawer', () => {
    for (const drawer of [true, false]) {
      const { props } = masked('.a { mask-size: 20px 10px; mask-position: center }', drawer);
      for (const key of ['maskWidth', 'maskHeight', 'maskPosition']) {
        assert.equal(props()[key], undefined, `${key}, drawer ${drawer}`);
      }
    }
  });

  it("is told the colour a component's own override paints, which is not committed", () => {
    const { engine, view, told, props } = masked(ICON_CSS);
    engine.setProp(view, 'styleOverride', { backgroundColor: 'rgb(0, 0, 255)' });
    engine.commit();
    assert.equal(told.at(-1)?.colour, 'rgb(0, 0, 255)');
    assert.equal(props()['backgroundColor'], undefined);
  });

  it('moves no static box by its insets, and keeps those of a box already positioned', () => {
    const still = masked(`${ICON_CSS} .a { top: 12px; left: 4px }`);
    assert.equal(still.props()['position'], 'relative');
    assert.deepEqual([still.props()['top'], still.props()['left']], [undefined, undefined]);
    const moved = masked(`${ICON_CSS} .a { position: relative; top: 12px }`);
    assert.equal(moved.props()['top'], 12);
  });
});

describe('an absolute box in a static box with a mask', () => {
  // Chrome would place it against the positioned box above; here the drawn mask makes the masked
  // box positioned, and the engine places what is in it against that box too.
  const CSS =
    '.g { position: relative; width: 400px; height: 200px } ' +
    '.h { position: static; width: 40px; height: 40px } .m { mask-image: url(icon.svg) } ' +
    '.a { position: absolute; width: 50%; height: 10px; top: 0; left: 0 }';

  const scene = (drawer: boolean) => {
    const fabric = createLaidOutFabric();
    const engine = new Engine(fabric, 1, { globalStyles: compiled(CSS).sheet });
    if (drawer) engine.setMaskDrawer(() => {});
    const add = (name: string, parent: EngineNode) => {
      const node = engine.createElement('view');
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name);
      engine.appendChild(parent, node);
      return node;
    };
    const box = add('h m', add('g', engine.root));
    add('a', box);
    const width = () => {
      engine.commit();
      return fabric.box('a').width;
    };
    return { engine, box, width };
  };

  it('takes a share of the masked box where a drawer draws it, and of the one above where not', () => {
    assert.equal(scene(true).width(), 20);
    assert.equal(scene(false).width(), 200);
  });

  it('takes a share of the box above once the mask goes, and of its own when it comes back', () => {
    const { engine, box, width } = scene(true);
    assert.equal(width(), 20);
    engine.setClasses(box, 'h');
    assert.equal(width(), 200);
    engine.setClasses(box, 'h m');
    assert.equal(width(), 20);
  });
});
