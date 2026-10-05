/**
 * What a class restyles. A library marks its elements with classes few rules mention, or none:
 * an overlay that is animating, a control that has been touched. A class no selector names can
 * change no style, so it is set and nothing is styled again. One named only as what a rule's
 * element is inside, `.animating .close`, restyles the elements such rules are for and leaves
 * the rest of what is under it. Any other, a rule for the element itself or one that asks from
 * beside it or through `:not()`, `:is()` and `:has()`, restyles as it always has.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const sheet = (css: string) => compileCss(css, 'app.css') as StyleSheet;

/** A panel of twenty rows of five cells. */
function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet(css) });
  const all: EngineNode[] = [];
  const add = (classes: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    all.push(node);
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    return node;
  };
  const panel = add('panel', engine.root);
  for (let row = 0; row < 20; row++) {
    const at = add('row', panel);
    for (let cell = 0; cell < 5; cell++) add('cell', at);
  }
  engine.commit();
  const props = (name: string): Record<string, unknown> => {
    const find = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const each of nodes) {
        const found = each.props['nativeID'] === name ? each : find(each.children);
        if (found) return found;
      }
      return undefined;
    };
    return find(fabric.committed)!.props;
  };
  /** How many elements a change styles again: one kept is the very style it was. */
  const restyled = (change: () => void): number => {
    const before = all.map((node) => node.styleCache);
    change();
    engine.commit();
    return all.filter((node, i) => node.styleCache !== before[i]).length;
  };
  return { engine, panel, props, restyled };
}

const CSS =
  '.panel { opacity: 1 } .cell { color: black } .on { opacity: 0.5 } .dark .cell { color: white }';

describe('a class no stylesheet mentions', () => {
  it('styles nothing again, coming or going', () => {
    const s = scene(CSS);
    assert.equal(
      s.restyled(() => s.engine.addClass(s.panel, 'animating')),
      0,
    );
    assert.equal(
      s.restyled(() => s.engine.removeClass(s.panel, 'animating')),
      0,
    );
    assert.equal(
      s.restyled(() => s.engine.setClasses(s.panel, 'panel touched')),
      0,
    );
  });

  it('is matched by a sheet that comes to mention it after', () => {
    const s = scene(CSS);
    s.engine.addClass(s.panel, 'late');
    s.engine.commit();
    s.engine.addGlobalSheet(sheet('.late .cell { color: green } .late { opacity: 0.2 }'));
    s.engine.commit();
    assert.equal(s.props('cell')['color'], 'rgb(0, 128, 0)');
    assert.equal(s.props('panel')['opacity'], 0.2);
    // And from then on it is one a sheet mentions.
    assert.ok(s.restyled(() => s.engine.removeClass(s.panel, 'late')) > 100);
    assert.equal(s.props('cell')['color'], 'rgb(0, 0, 0)');
  });

  it('restyles as any other where a selector reading the class attribute could be answered by it', () => {
    // An icon with no size of its own, as a library writes it: `svg:not([class*='size-'])`.
    const s = scene(
      `${CSS} [class*="anim"] .cell { color: red } .cell[class~="exact"] { color: red }`,
    );
    assert.ok(s.restyled(() => s.engine.addClass(s.panel, 'animating')) > 100);
    assert.ok(s.restyled(() => s.engine.addClass(s.panel, 'exact')) > 100);
    // And nothing for one neither could be.
    assert.equal(
      s.restyled(() => s.engine.addClass(s.panel, 'touched')),
      0,
    );
  });

  it('restyles for every class where a selector reads the class attribute some other way', () => {
    const s = scene(`${CSS} [class^="pan"] .cell { color: red }`);
    assert.ok(s.restyled(() => s.engine.addClass(s.panel, 'touched')) > 100);
  });
});

describe('a class named only as what an element is inside', () => {
  const INSIDE = `${CSS} .busy .row { opacity: 0.4 } .quiet > .row > .cell { color: grey }`;

  it('restyles the elements those rules are for, and what is under them, and no other', () => {
    const s = scene(INSIDE);
    // Twenty rows, and the five cells under each: not the panel.
    assert.equal(
      s.restyled(() => s.engine.addClass(s.panel, 'busy')),
      120,
    );
    assert.equal(s.props('row')['opacity'], 0.4);
    assert.equal(s.props('panel')['opacity'], 1);
    assert.equal(
      s.restyled(() => s.engine.removeClass(s.panel, 'busy')),
      120,
    );
    assert.equal(s.props('row')['opacity'] ?? 1, 1);
    // A hundred cells, and not their rows.
    assert.equal(
      s.restyled(() => s.engine.setClasses(s.panel, 'panel quiet')),
      100,
    );
    assert.equal(s.props('cell')['color'], 'rgb(128, 128, 128)');
  });

  it('restyles everything under it once a rule is for the element itself too', () => {
    const s = scene(`${INSIDE} .busy { opacity: 0.9 }`);
    assert.equal(
      s.restyled(() => s.engine.addClass(s.panel, 'busy')),
      121,
    );
    assert.equal(s.props('panel')['opacity'], 0.9);
  });

  it('restyles as any other where a rule asks from beside the element', () => {
    const s = scene(`${CSS} .first ~ .row { opacity: 0.3 }`);
    const first = s.engine.createElement('view');
    s.engine.insertBefore(s.panel, first, s.panel.children[0]!);
    s.engine.commit();
    s.engine.addClass(first, 'first');
    s.engine.commit();
    assert.equal(s.props('row')['opacity'], 0.3);
  });
});

describe('a class a stylesheet does mention', () => {
  it('restyles its element where a rule is for it', () => {
    const s = scene(CSS);
    assert.ok(s.restyled(() => s.engine.addClass(s.panel, 'on')) >= 1);
    assert.equal(s.props('panel')['opacity'], 0.5);
    s.engine.setClasses(s.panel, 'panel');
    s.engine.commit();
    assert.equal(s.props('panel')['opacity'], 1);
  });

  it('restyles what is under its element where a rule asks about it from there', () => {
    const s = scene(CSS);
    // The hundred cells the rule is for.
    assert.equal(
      s.restyled(() => s.engine.addClass(s.panel, 'dark')),
      100,
    );
    assert.equal(s.props('cell')['color'], 'rgb(255, 255, 255)');
    assert.equal(
      s.restyled(() => s.engine.setClasses(s.panel, 'panel')),
      100,
    );
    assert.equal(s.props('cell')['color'], 'rgb(0, 0, 0)');
  });

  it('counts a class named inside :not(), :is() and :has()', () => {
    for (const selector of ['.panel:not(.quiet) .cell', ':is(.loud, .other) .cell']) {
      const name = selector.includes('quiet') ? 'quiet' : 'loud';
      const s = scene(`${CSS} ${selector} { color: red }`);
      assert.ok(s.restyled(() => s.engine.addClass(s.panel, name)) > 100, selector);
    }
  });
});
