/**
 * What a drawing defines for its shapes to use, made by a script as a chart library makes it: a
 * marker drawn at the end of a line, and a pattern a shape is filled with.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

type Dom = any;

@Component({ template: `<div id="box"></div>` })
class Page {}

const SVG = 'http://www.w3.org/2000/svg';

/** A drawing in the page, and a way to make what goes in it. */
const drawing = async () => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = (globalThis as Dom).document;
  const svg = document.createElementNS(SVG, 'svg');
  document.getElementById('box').appendChild(svg);
  const make = (name: string, attributes: Record<string, string>, parent: Dom = svg) => {
    const element = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent.appendChild(element);
    return element;
  };
  /** The native view of an element, as it was last committed. */
  const view = (element: unknown): FakeFabricNode => {
    const find = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
      for (const node of nodes) {
        if (node.instanceHandle === element) return node;
        const inside = find(node.children);
        if (inside) return inside;
      }
      return undefined;
    };
    return find(app.fabric.committed)!;
  };
  return { svg, make, view };
};

describe('@ng-native/web-compat, what a drawing defines', () => {
  it('draws a marker at the end of a line that names it', async () => {
    const { make, view } = await drawing();
    const defs = make('defs', {});
    const marker = make(
      'marker',
      {
        id: 'arrow',
        refX: '9',
        refY: '5',
        markerWidth: '10',
        markerHeight: '10',
        orient: 'auto',
        viewBox: '0 0 10 10',
      },
      defs,
    );
    make('path', { d: 'M 0 0 L 10 5 L 0 10 Z' }, marker);
    const line = make('path', { d: 'M 0 0 L 50 50', stroke: 'red', 'marker-end': 'url(#arrow)' });
    await settle();
    const drawn = view(marker);
    assert.equal(drawn.viewName, 'RNSVGMarker');
    const { name, refX, refY, markerWidth, markerHeight, orient, vbWidth, markerUnits } =
      drawn.props as Record<string, unknown>;
    assert.deepEqual(
      { name, refX, refY, markerWidth, markerHeight, orient, vbWidth, markerUnits },
      {
        name: 'arrow',
        refX: '9',
        refY: '5',
        markerWidth: '10',
        markerHeight: '10',
        orient: 'auto',
        vbWidth: 10,
        markerUnits: 'strokeWidth',
      },
    );
    assert.equal(view(line).props['markerEnd'], 'arrow');
    // And taken off again.
    line.removeAttribute('marker-end');
    line.setAttribute('marker-start', 'url(#arrow)');
    await settle();
    assert.equal(view(line).props['markerEnd'] ?? null, null);
    assert.equal(view(line).props['markerStart'], 'arrow');
  });

  it('fills a shape with a pattern it names, tiled at its size', async () => {
    const { make, view } = await drawing();
    const defs = make('defs', {});
    const pattern = make(
      'pattern',
      { id: 'stripes', patternUnits: 'userSpaceOnUse', width: '10', height: '10', x: '0', y: '0' },
      defs,
    );
    make('path', { d: 'M 0 0 L 10 10', stroke: '#544fc5', 'stroke-width': '3' }, pattern);
    const bar = make('rect', { x: '0', y: '0', width: '40', height: '80', fill: 'url(#stripes)' });
    await settle();
    const drawn = view(pattern);
    assert.equal(drawn.viewName, 'RNSVGPattern', 'drawn, where it was passed over');
    const { name, width, height, x, y, patternUnits, patternContentUnits } = drawn.props as Record<
      string,
      unknown
    >;
    assert.deepEqual(
      { name, width, height, x, y, patternUnits, patternContentUnits },
      {
        name: 'stripes',
        width: '10',
        height: '10',
        x: '0',
        y: '0',
        patternUnits: 1,
        patternContentUnits: 1,
      },
    );
    assert.equal(drawn.props['display'] ?? null, null);
    assert.equal(drawn.children[0]?.viewName, 'RNSVGPath');
    assert.deepEqual(view(bar).props['fill'], { type: 1, brushRef: 'stripes' });
  });

  it('draws nothing of a shape painted too faintly to see, and still takes a touch on it', async () => {
    // How Highcharts lays a wide line over a series to take touches near it: react-native-svg
    // clips to the outline of every stroke it draws, which for a line of thousands of points is
    // minutes of the main thread for nothing to see.
    const { make, view } = await drawing();
    const tracker = make('path', {
      d: 'M 0 0 L 50 50',
      fill: 'none',
      stroke: 'rgba(192,192,192,0.0001)',
      'stroke-width': '21',
    });
    await settle();
    assert.equal(view(tracker).props['opacity'], 0);
    assert.equal(view(tracker).props['strokeWidth'], '21', 'as wide as ever, to be touched');
    tracker.setAttribute('stroke', 'rgba(192,192,192,0.5)');
    await settle();
    assert.equal(view(tracker).props['opacity'] ?? null, null, 'seen again');
    // A fill that is not written may be the group's: nothing is taken for unseen then.
    const line = make('path', { d: 'M 0 0 L 50 50', stroke: 'transparent' });
    await settle();
    assert.equal(view(line).props['opacity'] ?? null, null);
    // An opacity of its own is its own once it is seen.
    tracker.setAttribute('opacity', '0.5');
    tracker.setAttribute('stroke', 'rgba(192,192,192,0.0001)');
    await settle();
    assert.equal(view(tracker).props['opacity'], 0);
    tracker.setAttribute('stroke', '#000');
    await settle();
    assert.equal(view(tracker).props['opacity'], 0.5);
    // A marker is painted by its own shapes, and drawn with the path it is on.
    const arrow = make('path', {
      d: 'M 0 0 L 50 50',
      fill: 'none',
      stroke: 'rgba(192,192,192,0.0001)',
      'marker-end': 'url(#head)',
    });
    await settle();
    assert.equal(view(arrow).props['opacity'] ?? null, null);
  });

  it('draws a line of more points than it is wide thinned, as written for a script, and again at a new scale', async () => {
    const { svg, make, view } = await drawing();
    svg.setAttribute('width', '300');
    svg.setAttribute('height', '100');
    svg.setAttribute('viewBox', '0 0 300 100');
    const group = make('g', { transform: 'translate(10,5)' });
    const points = Array.from(
      { length: 3000 },
      (_, at) => `${at ? 'L' : 'M'} ${(at / 10).toFixed(1)} ${at % 7}`,
    );
    const d = points.join(' ');
    const line = make('path', { d, fill: 'none', stroke: '#2caffe' }, group);
    await settle();
    const drawn = () => String(view(line).props['d']);
    assert.ok(drawn().length < d.length / 3, `${drawn().length} of ${d.length}`);
    assert.equal(line.getAttribute('d'), d, 'read back as written');
    // Set again, as every attribute of the path sets what it draws.
    line.setAttribute('stroke-width', '2');
    await settle();
    assert.ok(drawn().length < d.length / 3);
    // Made twice as wide, it is drawn with columns half as wide.
    const thinner = drawn().length;
    group.setAttribute('transform', 'translate(10,5) scale(2)');
    await settle();
    assert.ok(drawn().length > thinner * 1.5, `${drawn().length} against ${thinner}`);
    // Turned, it is drawn as written: a column across is no use.
    group.setAttribute('transform', 'rotate(90)');
    await settle();
    assert.equal(drawn(), d);
  });
});
