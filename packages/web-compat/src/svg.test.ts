/**
 * A shape a script draws: its attributes set one at a time, as a chart library sets them, and
 * what the native view is given for them.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

type Dom = any;

@Component({ template: `<div id="box"></div>` })
class Page {}

const SVG = 'http://www.w3.org/2000/svg';

const POINT = {
  d: 'M 0 0 L 10 0 L 10 10 Z',
  fill: '#2caffe',
  stroke: '#ffffff',
  'stroke-width': '1',
  opacity: '0.5',
  class: 'highcharts-point',
};

const drawing = async () => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = (globalThis as Dom).document;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '100');
  document.getElementById('box').appendChild(svg);
  await settle();
  const engine = svg.engine;
  /** How often each prop of `element` is set from here on. */
  const counted = (element: unknown) => {
    const counts: Record<string, number> = {};
    const setProp = engine.setProp;
    engine.setProp = function (node: unknown, key: string, value: unknown) {
      if (node === element) counts[key] = (counts[key] ?? 0) + 1;
      return setProp.call(this, node, key, value);
    };
    return { counts, stop: () => void (engine.setProp = setProp) };
  };
  const view = (element: unknown): FakeFabricNode | undefined => {
    const find = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const node of nodes) {
        if (node.instanceHandle === element) return node;
        const inside = find(node.children);
        if (inside) return inside;
      }
      return undefined;
    };
    return find(app.fabric.committed);
  };
  return { document, engine, svg, counted, view };
};

describe('@ng-native/web-compat, a shape a script draws', () => {
  it('is drawn once for the attributes set one after another, as the script ends', async () => {
    const { document, svg, counted, view } = await drawing();
    const path = document.createElementNS(SVG, 'path');
    svg.appendChild(path);
    const { counts, stop } = counted(path);
    try {
      for (const [name, value] of Object.entries(POINT)) path.setAttribute(name, value);
      assert.equal(counts['d'] ?? 0, 0, 'not while the script sets them');
      await Promise.resolve();
      assert.equal(counts['d'], 1, 'once, after it');
    } finally {
      stop();
    }
    await settle();
    assert.equal(view(path)!.props['d'], POINT.d);
    assert.equal(view(path)!.props['opacity'], 0.5);
  });

  it('is drawn before a commit the same script asks for, and as set again after', async () => {
    const { document, engine, svg, view } = await drawing();
    const path = document.createElementNS(SVG, 'path');
    for (const [name, value] of Object.entries(POINT)) path.setAttribute(name, value);
    svg.appendChild(path);
    engine.commit();
    assert.equal(view(path)!.props['d'], POINT.d);
    path.setAttribute('d', 'M 1 1 L 2 2');
    path.removeAttribute('opacity');
    engine.commit();
    assert.equal(view(path)!.props['d'], 'M 1 1 L 2 2');
    assert.equal(view(path)!.props['opacity'] ?? 1, 1);
  });

  it('is drawn as set while it was out of the drawing, once it is back', async () => {
    const { document, svg, view } = await drawing();
    const path = document.createElementNS(SVG, 'path');
    for (const [name, value] of Object.entries(POINT)) path.setAttribute(name, value);
    svg.appendChild(path);
    await settle();
    path.remove();
    path.setAttribute('d', 'M 5 5 L 6 6');
    await settle();
    svg.appendChild(path);
    await settle();
    assert.equal(view(path)!.props['d'], 'M 5 5 L 6 6');
  });
});

/** A noisy line of `count` points across `width`, written as a path, the same every time. */
function lineOf(count: number, width: number): string {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, at) => {
    const x = Math.round((at / (count - 1)) * width * 100) / 100;
    const y = Math.round((50 + (random() - 0.5) * 40) * 100) / 100;
    return `${at ? 'L' : 'M'} ${x} ${y}`;
  }).join(' ');
}

/** The points a path goes through. */
const pointsIn = (d: string): number => (d.match(/[ML]/g) ?? []).length;

describe('@ng-native/web-compat, a long line a script draws', () => {
  const LONG = lineOf(5000, 300);

  it('is thinned for the native drawing, and read back whole', async () => {
    const { document, svg, view } = await drawing();
    svg.setAttribute('width', '300');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', LONG);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'black');
    svg.appendChild(path);
    await settle();
    const drawn = view(path)!.props['d'] as string;
    assert.ok(pointsIn(drawn) <= 2 * 300 + 4, `${pointsIn(drawn)} points drawn`);
    assert.equal(path.getAttribute('d'), LONG);
    const box = path.getBBox();
    assert.equal(box.x, 0);
    assert.equal(box.width, 300);
  });

  it('draws a short path as written', async () => {
    const { document, svg, view } = await drawing();
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', POINT.d);
    svg.appendChild(path);
    await settle();
    assert.equal(view(path)!.props['d'], POINT.d);
  });

  it('is drawn as written once it is short, and again when it is long', async () => {
    const { document, svg, view } = await drawing();
    svg.setAttribute('width', '300');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', LONG);
    svg.appendChild(path);
    await settle();
    assert.ok(pointsIn(view(path)!.props['d'] as string) < 700);
    path.setAttribute('d', 'M 1 1 L 2 2');
    await settle();
    assert.equal(view(path)!.props['d'], 'M 1 1 L 2 2');
    path.setAttribute('d', LONG);
    await settle();
    assert.ok(pointsIn(view(path)!.props['d'] as string) < 700);
    path.removeAttribute('d');
    await settle();
    assert.equal(view(path)!.props['d'] ?? null, null);
    assert.equal(path.getAttribute('d'), null);
  });

  it('is thinned again where a group it is in is scaled, and back where that is taken off', async () => {
    const { document, svg, view } = await drawing();
    svg.setAttribute('width', '300');
    const group = document.createElementNS(SVG, 'g');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', LONG);
    group.appendChild(path);
    svg.appendChild(group);
    await settle();
    const plain = pointsIn(view(path)!.props['d'] as string);
    // Drawn twice as wide, a column is half a unit: twice the points are worth keeping.
    group.setAttribute('transform', 'matrix(2 0 0 2 0 0)');
    await settle();
    const doubled = pointsIn(view(path)!.props['d'] as string);
    assert.ok(doubled > plain * 1.5, `${doubled} after ${plain}`);
    group.removeAttribute('transform');
    await settle();
    assert.equal(pointsIn(view(path)!.props['d'] as string), plain);
    // Turned, a column is no use: it is drawn as written.
    group.setAttribute('transform', 'rotate(30)');
    await settle();
    assert.equal(view(path)!.props['d'], LONG);
  });

  it('is thinned across the scale of the group it is moved into', async () => {
    const { document, svg, view } = await drawing();
    svg.setAttribute('width', '300');
    const group = document.createElementNS(SVG, 'g');
    group.setAttribute('transform', 'matrix(2 0 0 2 0 0)');
    svg.appendChild(group);
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', LONG);
    svg.appendChild(path);
    await settle();
    const plain = pointsIn(view(path)!.props['d'] as string);
    group.appendChild(path);
    await settle();
    assert.ok(pointsIn(view(path)!.props['d'] as string) > plain * 1.5);
  });

  it('is drawn as written in a drawing whose width is no count of points', async () => {
    // `100%` of a box not known here: not a hundred points, which would thin it far too much.
    const { document, svg, view } = await drawing();
    svg.setAttribute('viewBox', '0 0 300 100');
    svg.setAttribute('width', '100%');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', LONG);
    svg.appendChild(path);
    await settle();
    assert.equal(view(path)!.props['d'], LONG);
  });

  it('is thinned to the width its drawing is given, and again where that changes', async () => {
    const { document, svg, view } = await drawing();
    svg.setAttribute('viewBox', '0 0 300 100');
    svg.setAttribute('width', '300');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', LONG);
    svg.appendChild(path);
    await settle();
    const full = pointsIn(view(path)!.props['d'] as string);
    svg.setAttribute('width', '150');
    await settle();
    const half = pointsIn(view(path)!.props['d'] as string);
    assert.ok(half < full * 0.75, `${half} after ${full}`);
  });
});

describe('@ng-native/web-compat, react-native-svg', () => {
  it('is drawn with by the names of its native views, and none of its JavaScript is imported', () => {
    // An app without it installed sees nothing where a drawing is, as it does for an icon: the
    // platform has no view of the name. So no module of it is asked for, here or by the icons.
    const script = `
      import { registerHooks } from 'node:module';
      registerHooks({
        resolve(specifier, context, next) {
          if (/^react-native-svg(\\/|$)/.test(specifier)) throw new Error('imported ' + specifier);
          return next(specifier, context);
        },
      });
      await import(${JSON.stringify(new URL('./index.ts', import.meta.url).href)});
    `;
    execFileSync(
      process.execPath,
      ['--import', '@ng-native/testing/register', '--input-type=module', '--eval', script],
      { cwd: new URL('..', import.meta.url), stdio: 'pipe' },
    );
  });
});
