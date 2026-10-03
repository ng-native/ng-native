/**
 * `width: fit-content` and `height: fit-content`. Yoga has no such size: a box is as big as its
 * content along its container's main axis already, and stretched across it. So on the cross axis
 * the box stops stretching and sits at the start, which is where a browser puts it, and on the
 * main axis nothing changes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';
import { build } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};

/** A parent with classes `parent` holding a child with classes `child`, under `css`. */
function scene(css: string, parent = 'p', child = 'c') {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const outer = engine.createElement('view');
  engine.setClasses(outer, parent);
  engine.appendChild(engine.root, outer);
  const inner = engine.createElement('view');
  engine.setClasses(inner, child);
  engine.appendChild(outer, inner);
  const props = (): Record<string, unknown> => {
    engine.commit();
    return fabric.committed[0]!.children[0]!.props;
  };
  return { reports, engine, outer, inner, props };
}

const FIT = '.c { width: fit-content }';

describe('width: fit-content', () => {
  it('stops a box stretching across a column, and sends no width', () => {
    const s = scene(FIT);
    const props = s.props();
    assert.equal(props['alignSelf'], 'flex-start');
    assert.equal('width' in props, false);
    assert.deepEqual(s.reports, []);
  });

  it('changes nothing in a row, where a box is as wide as its content already', () => {
    const props = scene(`.p { flex-direction: row } ${FIT}`).props();
    assert.equal('alignSelf' in props, false);
    assert.equal('width' in props, false);
  });

  it('keeps the alignment the container or the box asked for', () => {
    assert.equal('alignSelf' in scene(`.p { align-items: center } ${FIT}`).props(), false);
    assert.equal(scene(`${FIT} .c { align-self: flex-end }`).props()['alignSelf'], 'flex-end');
    // `stretch` written out is the default written out: the width still decides.
    assert.equal(scene(`${FIT} .c { align-self: stretch }`).props()['alignSelf'], 'flex-start');
  });

  it('follows the container when its direction or alignment changes', () => {
    const s = scene(`.row { flex-direction: row } .mid { align-items: center } ${FIT}`);
    assert.equal(s.props()['alignSelf'], 'flex-start');
    s.engine.addClass(s.outer, 'row');
    assert.equal(s.props()['alignSelf'] ?? null, null);
    s.engine.removeClass(s.outer, 'row');
    assert.equal(s.props()['alignSelf'], 'flex-start');
    s.engine.addClass(s.outer, 'mid');
    assert.equal(s.props()['alignSelf'] ?? null, null);
  });

  it('follows a container whose direction is set inline', () => {
    const s = scene(FIT);
    assert.equal(s.props()['alignSelf'], 'flex-start');
    s.engine.setProp(s.outer, 'style', { flexDirection: 'row' });
    assert.equal(s.props()['alignSelf'] ?? null, null);
    s.engine.setProp(s.outer, 'style', null);
    assert.equal(s.props()['alignSelf'], 'flex-start');
  });

  it('goes when the rule no longer applies', () => {
    const s = scene(FIT);
    assert.equal(s.props()['alignSelf'], 'flex-start');
    s.engine.removeClass(s.inner, 'c');
    assert.equal(s.props()['alignSelf'] ?? null, null);
  });

  it('gives way to a width set inline, and is read from an inline style too', () => {
    const s = scene(FIT);
    s.engine.setProp(s.inner, 'style', { width: 40 });
    assert.equal(s.props()['width'], 40);
    assert.equal(s.props()['alignSelf'] ?? null, null);

    const inline = scene('');
    inline.engine.setProp(inline.inner, 'style', { width: 'fit-content' });
    assert.equal(inline.props()['alignSelf'], 'flex-start');
    assert.equal('width' in inline.props(), false);
  });
});

describe('Tailwind', () => {
  it('reads w-fit and h-fit', () => {
    const css = flattenTailwind(build('native', 'w-fit h-fit flex-row'));
    assert.equal(scene(css, '', 'w-fit').props()['alignSelf'], 'flex-start');
    const row = scene(css, 'flex-row', 'h-fit');
    assert.equal(row.props()['alignSelf'], 'flex-start');
    assert.deepEqual(row.reports, []);
  });
});

describe('height: fit-content', () => {
  it('stops a box stretching across a row, and changes nothing in a column', () => {
    const row = scene('.p { flex-direction: row } .c { height: fit-content }');
    assert.equal(row.props()['alignSelf'], 'flex-start');
    assert.equal('height' in row.props(), false);
    assert.deepEqual(row.reports, []);

    const column = scene('.c { height: fit-content }').props();
    assert.equal('alignSelf' in column, false);
    assert.equal('height' in column, false);
  });
});

describe('the other intrinsic sizes', () => {
  it('are still refused, by name', () => {
    for (const value of ['max-content', 'min-content']) {
      const s = scene(`.c { width: ${value} }`);
      s.props();
      assert.equal(s.reports.length, 1, value);
    }
    const s = scene('.c { max-width: fit-content }');
    s.props();
    assert.equal(s.reports.length, 1);
  });
});
