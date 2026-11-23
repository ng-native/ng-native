/**
 * An outline icon's shapes, drawn as one path where that cannot change a pixel: lucide's icons are
 * four shapes on average, and each is a native view.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { mergeShapes, pathData, wellFormed } from '../icons/src/merge-shapes.ts';
import { parseSvg, type SvgNode } from '../icons/src/parse-svg.ts';
import { compileFixture } from './compile.ts';

const merge = (markup: string) => mergeShapes(parseSvg(markup)!);
/** The tags of the root's children after merging, with a merged path's data. */
const drawn = (markup: string) =>
  merge(markup).children.map((child) => (child.tag === 'path' ? child.attrs['d'] : child.tag));
const outline = (shapes: string, root = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"${root}>${shapes}</svg>`;
const shape = (tag: string, attrs: string) =>
  parseSvg(`<svg><${tag} ${attrs}/></svg>`)!.children[0]!;

describe('shapes in one stroke and no fill', () => {
  it('are one path, each as the path it draws, in the order they were drawn', () => {
    assert.deepEqual(drawn(outline('<path d="M1 1L2 2"/><line x1="3" y1="3" x2="4" y2="4"/>')), [
      'M1 1L2 2M3 3L4 4',
    ]);
  });

  it('keep what they share on the path, and lose the geometry each had', () => {
    const [path] = merge(
      outline(
        '<circle cx="5" cy="5" r="1" stroke-linecap="round"/><path d="M1 1" stroke-linecap="round"/>',
      ),
    ).children as [SvgNode];
    assert.deepEqual(path.attrs, {
      'stroke-linecap': 'round',
      d: 'M4 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0zM1 1',
    });
  });

  it('are left as they are where only one would be in the path', () => {
    const root = parseSvg(outline('<circle cx="5" cy="5" r="1"/>'))!;
    assert.equal(mergeShapes(root), root, 'the same tree, so nothing is copied');
  });

  it('merge inside a group, apart from the shapes beside it', () => {
    const [before, group, after] = merge(
      outline(
        '<path d="M1 1"/><g stroke-width="3"><path d="M2 2"/><path d="M3 3"/></g><path d="M4 4"/>',
      ),
    ).children as [SvgNode, SvgNode, SvgNode];
    assert.equal(before.attrs['d'], 'M1 1');
    assert.deepEqual(
      group.children.map((child) => child.attrs['d']),
      ['M2 2M3 3'],
    );
    assert.equal(
      after.attrs['d'],
      'M4 4',
      'not drawn under the group, as it would be in the first path',
    );
  });

  it('merge where the stroke width is the one ng-icons hands the icon, in a style', () => {
    const width = 'style="stroke-width:var(--ng-icon__stroke-width, 1.5)"';
    assert.deepEqual(drawn(outline(`<path d="M1 1" ${width}/><path d="M2 2" ${width}/>`)), [
      'M1 1M2 2',
    ]);
  });

  it('merge without an id nothing points at, and keep one something does', () => {
    assert.deepEqual(drawn(outline('<path id="a" d="M1 1"/><path id="b" d="M2 2"/>')), [
      'M1 1M2 2',
    ]);
    const pointed = outline('<path id="a" d="M1 1"/><path d="M2 2"/><use href="#a"/>');
    assert.deepEqual(drawn(pointed), ['M1 1', 'M2 2', 'use']);
    assert.deepEqual(drawn(outline('<path id="a" d="M1 1"/><path d="M2 2" mask="url(#a)"/>')), [
      'M1 1',
      'M2 2',
    ]);
  });
});

describe('shapes drawn as they are', () => {
  const cases: [string, string][] = [
    [
      'a fill, whose overlap a path could cancel',
      outline('<path d="M1 1" fill="red"/><path d="M2 2" fill="red"/>'),
    ],
    ['a fill they take from the root', `<svg stroke="red"><path d="M1 1"/><path d="M2 2"/></svg>`],
    [
      'an opacity, painted once where two overlap',
      outline('<path d="M1 1" opacity=".5"/><path d="M2 2" opacity=".5"/>'),
    ],
    [
      'a stroke opacity from the root',
      outline('<path d="M1 1"/><path d="M2 2"/>', ' stroke-opacity=".5"'),
    ],
    [
      'a dash from the root, which each starts again',
      outline('<path d="M1 1"/><path d="M2 2"/>', ' stroke-dasharray="2"'),
    ],
    [
      "a marker from the root, drawn at each one's ends",
      outline('<path d="M1 1"/><path d="M2 2"/>', ' marker-end="url(#m)"'),
    ],
    [
      'a transform',
      outline('<path d="M1 1" transform="scale(2)"/><path d="M2 2" transform="scale(2)"/>'),
    ],
    [
      'a paint from a custom property',
      outline('<path d="M1 1" stroke="var(--a)"/><path d="M2 2" stroke="var(--a)"/>'),
    ],
    [
      'a stroke width from a custom property other than the one ng-icons hands it',
      outline(
        '<path d="M1 1" style="stroke-width:var(--a, 2)"/><path d="M2 2" style="stroke-width:var(--a, 2)"/>',
      ),
    ],
    [
      'a style that sets more than the stroke',
      outline('<path d="M1 1" style="fill:red"/><path d="M2 2" style="fill:red"/>'),
    ],
    ['path data with an error in it', outline('<path d="M1 1L2"/><path d="M2 2"/>')],
    [
      'a shape with something in it',
      outline('<path d="M1 1"><title>a</title></path><path d="M2 2"/>'),
    ],
    ['a radius in percent', outline('<circle r="10%"/><circle r="2"/>')],
  ];
  for (const [what, markup] of cases) {
    it(`with ${what}`, () => {
      const root = parseSvg(markup)!;
      assert.equal(mergeShapes(root), root);
    });
  }

  it('in different strokes, each run its own', () => {
    assert.deepEqual(
      drawn(
        outline(
          '<path d="M1 1"/><path d="M2 2"/><path d="M3 3" stroke="red"/><path d="M4 4" stroke="red"/>',
        ),
      ),
      ['M1 1M2 2', 'M3 3M4 4'],
    );
  });
});

describe('a closed shape no bigger than its stroke', () => {
  // Its stroke's inner edge folds over itself, and iOS fills that fold otherwise in a path of
  // several shapes: tdesign's dots and ionicons' list bullets came out hollow.
  const dot = '<path d="M18.998 17.998H19.002V18.002H18.998V17.998Z"/>';

  it('is drawn as it is, beside shapes that still merge', () => {
    assert.deepEqual(
      drawn(outline(`<path d="M1 1L9 9"/><path d="M2 2L8 8"/>${dot}`, ' stroke-width="2"')),
      ['M1 1L9 9M2 2L8 8', 'M18.998 17.998H19.002V18.002H18.998V17.998Z'],
    );
    assert.deepEqual(
      drawn(
        outline('<circle cx="5" cy="5" r="8"/><circle cx="9" cy="9" r="8"/>', ' stroke-width="32"'),
      ),
      ['circle', 'circle'],
    );
  });

  it('takes its stroke from the width ng-icons hands the icon', () => {
    const markup = outline(
      '<circle cx="5" cy="5" r="1"/><circle cx="9" cy="9" r="1"/>',
      ' style="stroke-width:var(--ng-icon__stroke-width, 1)"',
    );
    const merged = (width?: number) =>
      mergeShapes(parseSvg(markup)!, width).children.map((child) => child.tag);
    assert.deepEqual(merged(), ['path'], 'the fallback, 1, inside a circle 2 across');
    assert.deepEqual(merged(3), ['circle', 'circle'], 'the app asked for 3');
  });

  it('is drawn as it is where its stroke is not a number known here', () => {
    const shapes =
      '<path d="M1 1h4v4h-4z"/><path d="M6 6h4v4h-4z"/><path d="M1 1L2 2"/><path d="M3 3L4 4"/>';
    assert.deepEqual(drawn(outline(shapes, ' stroke-width="10%"')), [
      'M1 1h4v4h-4z',
      'M6 6h4v4h-4z',
      'M1 1L2 2M3 3L4 4',
    ]);
  });
});

describe('a shape as the path it draws', () => {
  it('moves to where a path starting with a relative move would start, after another', () => {
    assert.equal(pathData(shape('path', 'd="m3 4l1 1"')), 'M0 0m3 4l1 1');
  });

  it('draws a circle and an ellipse as two arcs, closed', () => {
    assert.equal(
      pathData(shape('circle', 'cx="5" cy="6" r="2"')),
      'M3 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z',
    );
    assert.equal(
      pathData(shape('ellipse', 'rx="3" ry="1"')),
      'M-3 0a3 1 0 1 0 6 0a3 1 0 1 0 -6 0z',
    );
    assert.equal(pathData(shape('circle', 'r="0"')), undefined, 'which native draws as nothing');
  });

  it('draws a rect with the corners SVG gives it', () => {
    assert.equal(pathData(shape('rect', 'x="1" y="2" width="4" height="3"')), 'M1 2h4v3h-4z');
    assert.equal(
      pathData(shape('rect', 'width="10" height="4" rx="1"')),
      'M1 0h8a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-8a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z',
      'one radius is both',
    );
    assert.equal(
      pathData(shape('rect', 'width="4" height="4" rx="9" ry="1"')),
      'M2 0h0a2 1 0 0 1 2 1v2a2 1 0 0 1 -2 1h0a2 1 0 0 1 -2 -1v-2a2 1 0 0 1 2 -1z',
      'and each at most half its side',
    );
    assert.equal(pathData(shape('rect', 'width="0" height="4"')), undefined);
  });

  it('draws a line, a polyline and a polygon', () => {
    assert.equal(pathData(shape('line', 'x2="3" y2="4"')), 'M0 0L3 4');
    assert.equal(pathData(shape('polyline', 'points="1,1 2,2"')), 'M1,1L2,2');
    assert.equal(pathData(shape('polygon', 'points="1,1 2,2 3,1"')), 'M1,1L2,2L3,1Z');
  });
});

describe('path data that reads to its end', () => {
  it('reads repeats, implicit commands and arc flags run together', () => {
    for (const d of ['M1 2L3 4', 'm1,2 3,4z', 'M0 0a1 1 0 01.5.5', 'M1 2h3v4H1z', 'M1e2-3l.5.5']) {
      assert.ok(wellFormed(d), d);
    }
  });

  it('stops at a command short of its numbers, a flag that is not one, or a stray letter', () => {
    for (const d of ['M1', 'M1 2L3', 'M0 0a1 1 0 2 0 5 5', 'M1 2 X', 'M0 0C1 2 3']) {
      assert.ok(!wellFormed(d), d);
    }
  });
});

describe('an outline icon on screen', () => {
  afterEach(cleanup);

  it('commits one path under its group', async () => {
    const Fixture = (await compileFixture('fixtures/icon-merge.ts'))['IconMerge'] as Type<unknown>;
    const { fabric } = await render(Fixture);
    const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const icon = flatten(fabric.committed).find((node) => node.props['nativeID'] === 'icon')!;
    assert.deepEqual(
      flatten([icon]).map((node) => node.viewName),
      ['RNSVGSvgView', 'RNSVGGroup', 'RNSVGPath'],
    );
    assert.equal(
      icon.children[0]!.children[0]!.props['d'],
      'M1 1L2 2M4 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0z',
    );
  });
});
