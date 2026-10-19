/**
 * Drawing an inline `<svg>` natively, as react-native-svg's views, painted by a stylesheet: what
 * the engine gives a shape where its paint, its font or its words come from the cascade, and the
 * name a type selector reads where a renderer keeps an element under another.
 *
 * An icon drawn today commits what it did: every piece of this is asked for by what an app adds,
 * a sheet compiled as a library's, a paint written in a style, a view registered to keep its
 * spaces or a package that says where a touch is.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import {
  Engine,
  registerPlatformComponents,
  registerViewName,
  type EngineNode,
} from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(
    css: string,
    context: string,
    options?: { generated?: boolean; onUnsupported?: (message: string) => void },
  ): { rules: Record<string, unknown>[] };
};

const generated = (css: string) => compileCss(css, 'library.css', { generated: true });

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** Register names for the test's own elements, taken away again whatever it does. */
function withViews<T>(names: Record<string, string>, run: () => T): T {
  const undo = Object.entries(names).map(([name, view]) => registerViewName(name, view));
  try {
    return run();
  } finally {
    undo.forEach((each) => each());
  }
}

/**
 * An engine, and what adds an element to it: one of a library's drawing, as the renderer creates
 * an element written in a namespace an extension names, or with `drawing` false one of an icon's.
 */
function scene(css?: string, drawing = true) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    ...(css && { globalStyles: generated(css) as never }),
    // As React Native's: a keyword of CSS's alone is no colour it reads.
    processColor: (value) => (String(value).toLowerCase() === 'currentcolor' ? null : value),
  });
  const add = (name: string, parent = engine.root, classes = '') => {
    const node = engine.createElement(name);
    if (drawing) node.namespace = 'svg';
    if (classes) engine.setClasses(node, classes);
    engine.appendChild(parent, node);
    return node;
  };
  return { fabric, engine, add };
}

const SHAPES = { 'x-svg': 'RNSVGSvgView', 'x-g': 'RNSVGGroup', 'x-path': 'RNSVGPath' };

describe('an icon an app draws today', () => {
  afterEach(cleanup);

  // What main committed for these icons, on both platforms, before a drawing could be painted by
  // a stylesheet: in a view whose text style, colour and token every shape inherits.
  const text = { fontSize: 18, fontWeight: 700 };
  const ink = { ...text, color: 'rgb(4, 5, 6)' };
  const svgView = (nativeID: string, color = 'rgb(4, 5, 6)') => [
    'RNSVGSvgView',
    {
      ...text,
      color,
      width: 18,
      height: 18,
      nativeID,
      bbWidth: '100%',
      bbHeight: '100%',
      minX: 0,
      minY: 0,
      vbWidth: 24,
      vbHeight: 24,
      align: 'xMidYMid',
      meetOrSlice: 0,
      accessible: false,
    },
  ];
  const lists = { x: [], y: [], dx: [], dy: [], rotate: [] };
  const DRAWN = [
    svgView('outline'),
    [
      'RNSVGGroup',
      {
        ...ink,
        stroke: { type: 2 },
        strokeWidth: '2',
        propList: ['fill', 'stroke', 'strokeWidth'],
      },
    ],
    ['RNSVGPath', { ...ink, d: 'M0 0L5 5' }],
    [
      'RNSVGCircle',
      { ...ink, fill: { type: 0, payload: 'red' }, propList: ['fill'], cx: '4', cy: '4', r: '2' },
    ],
    svgView('glyph', 'rgb(9, 9, 9)'),
    ['RNSVGGroup', { ...text, color: 'rgb(9, 9, 9)', fill: { type: 2 }, propList: ['fill'] }],
    ['RNSVGPath', { ...text, color: 'rgb(9, 9, 9)', d: 'M1 1L6 6' }],
    svgView('token'),
    ['RNSVGGroup', { ...ink, stroke: { type: 0, payload: 'rgb(1, 2, 3)' }, propList: ['stroke'] }],
    ['RNSVGGroup', { ...ink, fill: { type: 0, payload: 'blue' }, propList: ['stroke', 'fill'] }],
    ['RNSVGPath', { ...ink, d: 'M2 2L7 7' }],
    ['RNSVGPath', { ...ink, d: 'M3 3L8 8' }],
    svgView('words'),
    ['RNSVGGroup', ink],
    [
      'RNSVGText',
      { ...ink, x: ['1'], y: ['10'], dx: [], dy: [], rotate: [], font: { fontSize: '8' } },
    ],
    ['RNSVGTSpan', { ...ink, content: 'Hi ' }],
    ['RNSVGTSpan', { ...ink, ...lists, font: { fontWeight: 'bold' } }],
    ['RNSVGTSpan', { ...ink, content: 'there' }],
  ];

  for (const platform of ['ios', 'android']) {
    it(`commits the same shapes on ${platform}`, async () => {
      registerPlatformComponents(platform);
      try {
        const mod = await compileFixture('fixtures/svg-icons-unchanged.ts');
        const app = await render(mod['SvgIconsUnchanged'] as Type<unknown>);
        const drawn = flatten(app.fabric.committed)
          .filter((node) => node.viewName.startsWith('RNSVG'))
          .map((node) => [node.viewName, node.props]);
        assert.deepEqual(drawn, DRAWN);
      } finally {
        registerPlatformComponents('ios');
      }
    });
  }
});

describe("a shape's paint, in a sheet read as a browser reads it", () => {
  const CSS =
    '.tick { fill: none; stroke: currentColor; stroke-width: 3.12px; stroke-dashoffset: 29.5; ' +
    'stroke-dasharray: 29.5 } .icon { fill: var(--ink, #ff0000) } .dot { stroke: #00ff00 }';

  it('is refused in any other sheet', () => {
    const dropped: string[] = [];
    compileCss(CSS, 'app.css', { onUnsupported: (message) => dropped.push(message) });
    assert.equal(dropped.length, 7);
  });

  it('takes its width from a token, as a length is read', () => {
    withViews(SHAPES, () => {
      const { fabric, add, engine } = scene('.line { stroke-width: var(--weight, 2px) }');
      add('x-path', engine.root, 'line');
      engine.commit();
      assert.equal(fabric.committed[0]!.props['strokeWidth'], 2);
    });
  });

  it('is the props a shape of a drawing is drawn with, named as the ones it sets itself', () => {
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene(CSS);
      const tick = add('x-path', engine.root, 'tick');
      // What the element's own attribute set, which the stylesheet's are added to.
      engine.setProp(tick, 'd', 'M0 0');
      engine.setProp(tick, 'propList', ['fillRule']);
      const root = add('x-svg', engine.root, 'icon');
      add('x-path', root, 'plain');
      add('x-path', root, 'dot');
      engine.commit();
      const [first, svg] = fabric.committed;
      assert.deepEqual(
        { ...first!.props, propList: [...(first!.props['propList'] as string[])].sort() },
        {
          d: 'M0 0',
          fill: null,
          stroke: { type: 2 },
          strokeWidth: 3.12,
          strokeDashoffset: 29.5,
          strokeDasharray: [29.5],
          propList: [
            'fill',
            'fillRule',
            'stroke',
            'strokeDasharray',
            'strokeDashoffset',
            'strokeWidth',
          ],
        },
      );
      // A shape with no paint of its own has what holds it has, as a browser hands `fill` down.
      const red = { type: 0, payload: engine.color('rgb(255, 0, 0)') };
      const [plain, dot] = svg!.children;
      assert.deepEqual(plain!.props, { fill: red, propList: ['fill'] });
      assert.deepEqual(dot!.props['stroke'], { type: 0, payload: engine.color('rgb(0, 255, 0)') });
      assert.deepEqual([...(dot!.props['propList'] as string[])].sort(), ['fill', 'stroke']);
      // And is committed once: the same paint the next time is no change to send.
      const before = fabric.calls.completeRoot;
      engine.commit();
      assert.equal(fabric.calls.completeRoot, before);
    });
  });

  it("is an icon's style as any view's, handed down and named by nothing", () => {
    // An icon's group hands its paint down natively, from what each shape names as its own.
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene(CSS, false);
      const tick = add('x-path', engine.root, 'tick');
      engine.setProp(tick, 'propList', ['fillRule']);
      const root = add('x-svg', engine.root, 'icon');
      add('x-path', root, 'plain');
      engine.commit();
      const [first, svg] = fabric.committed;
      assert.deepEqual(first!.props['propList'], ['fillRule']);
      assert.equal(first!.props['stroke'], undefined, 'currentColor is no brush here');
      assert.deepEqual(svg!.children[0]!.props, {});
    });
  });

  it("hands down a shape's own paint over one it inherits, as a group's none is", () => {
    // `<svg style="stroke: red"><g stroke="none"><path/></g><path/></svg>`: the group names the
    // stroke as its own and sets none, which is what react-native-svg reads of such a list.
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene('.ink { stroke: #ff0000 }');
      const root = add('x-svg', engine.root, 'ink');
      const group = add('x-g', root);
      engine.setProp(group, 'propList', ['stroke']);
      add('x-path', group);
      add('x-path', root);
      engine.commit();
      const red = { type: 0, payload: engine.color('rgb(255, 0, 0)') };
      const [svg] = fabric.committed;
      const [g, beside] = svg!.children;
      assert.equal(g!.children[0]!.props['stroke'] ?? null, null, 'nothing strokes it');
      assert.deepEqual(beside!.props['stroke'], red);
      // And follows the group's own paint as it changes, and as it goes.
      engine.setProp(group, 'stroke', { type: 0, payload: 7 });
      engine.commit();
      assert.deepEqual(fabric.committed[0]!.children[0]!.children[0]!.props['stroke'], {
        type: 0,
        payload: 7,
      });
      engine.setProp(group, 'propList', undefined);
      engine.setProp(group, 'stroke', undefined);
      engine.commit();
      assert.deepEqual(fabric.committed[0]!.children[0]!.children[0]!.props['stroke'], red);
    });
  });

  it('keeps a list naming no paint on a shape that stops naming one, so native lets it go', () => {
    // react-native-svg keeps the list it had where it is sent none, on Android, or an empty one,
    // on iOS: the shape would keep the paint as its own after the rule stopped giving it.
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene('.dark { fill: #000000 }');
      const shape = add('x-path', engine.root, 'dark');
      engine.commit();
      assert.deepEqual(fabric.committed[0]!.props['propList'], ['fill']);
      engine.setClasses(shape, '');
      engine.commit();
      assert.deepEqual(fabric.committed[0]!.props['propList'], ['vectorEffect']);
      assert.equal(fabric.committed[0]!.props['fill'] ?? null, null);
    });
  });

  const CARD =
    'background-color: white; padding: 14px; border-radius: 10px; border-width: 1px; ' +
    'margin: 4px; box-shadow: 0 1px 2px black';
  const box = (props: Record<string, unknown>) =>
    Object.keys(props).filter((key) => /^(background|border|padding|margin|boxShadow)/.test(key));

  it('draws no box a sheet gives a shape of a drawing, as a browser draws none', () => {
    // A shape is a view to native, whose background is drawn over the drawing it is in.
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene(`.card { ${CARD}; fill: red } .frame { ${CARD} }`);
      const root = add('x-svg', engine.root, 'frame');
      add('x-path', root, 'card');
      engine.commit();
      const [svg] = fabric.committed;
      assert.deepEqual(box(svg!.children[0]!.props), []);
      assert.deepEqual(svg!.children[0]!.props['fill'], {
        type: 0,
        payload: engine.color('rgb(255, 0, 0)'),
      });
      assert.ok(box(svg!.props).includes('backgroundColor'), 'the drawing is still a box');
    });
  });

  it("keeps the box an app gives an icon's shape, as it always has", () => {
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene(`.card { ${CARD} }`, false);
      add('x-path', engine.root, 'card');
      engine.commit();
      assert.ok(box(fabric.committed[0]!.props).includes('backgroundColor'));
    });
  });
});

describe('a paint written in a style', () => {
  const painted = (drawing: boolean) =>
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene(undefined, drawing);
      const path = add('x-path');
      engine.setProp(path, 'style', { fill: 'currentColor', stroke: 'currentcolor' });
      engine.commit();
      const { fill, stroke } = fabric.committed[0]!.props;
      return { fill, stroke };
    });

  it('is the colour of the view it is in for currentColor in a drawing, which native follows', () => {
    assert.deepEqual(painted(true), { fill: { type: 2 }, stroke: { type: 2 } });
  });

  it("is dropped on an icon's shape, as a colour the host cannot read is", () => {
    assert.deepEqual(painted(false), { fill: undefined, stroke: undefined });
  });
});

describe("a drawing's text on Android", () => {
  const onAndroid = <T>(run: () => T): T => {
    registerPlatformComponents('android');
    try {
      return withViews({ 'x-text': 'RNSVGText', 'x-span': 'RNSVGTSpan' }, run);
    } finally {
      registerPlatformComponents('ios');
    }
  };

  it('is sent its size and weight in its font, which either sent beside it would replace there', () => {
    // Android's react-native-svg sets the whole font from `fontSize` or `fontWeight` alone, in
    // whichever order the props come: a chart tooltip's bold value was drawn at the text's weight.
    onAndroid(() => {
      const { fabric, engine, add } = scene();
      const text = add('x-text');
      const span = add('x-span', text);
      engine.setProp(text, 'style', { fontSize: 12 });
      engine.setProp(span, 'style', { fontWeight: 'bold' });
      engine.commit();
      const props = () => fabric.committed[0]!.children[0]!.props;
      assert.deepEqual(props()['font'], { fontSize: 12, fontWeight: 'bold' });
      assert.equal(props()['fontSize'], undefined);
      assert.equal(props()['fontWeight'], undefined);
      // Sent again as either changes, and without what is no longer there.
      engine.setProp(text, 'style', { fontSize: 14 });
      engine.commit();
      assert.deepEqual(props()['font'], { fontSize: 14, fontWeight: 'bold' });
      engine.setProp(span, 'style', {});
      engine.commit();
      assert.deepEqual(props()['font'], { fontSize: 14 });
      // What the shape's own font says stands over a size it inherits.
      engine.setProp(span, 'font', { fontSize: 8 });
      engine.commit();
      assert.deepEqual(props()['font'], { fontSize: 8 });
    });
  });

  it("is an icon's text sent its size and weight as any view is", () => {
    onAndroid(() => {
      const { fabric, engine, add } = scene(undefined, false);
      const text = add('x-text');
      add('x-span', text);
      engine.setProp(text, 'style', { fontSize: 12, fontWeight: 'bold' });
      engine.commit();
      const { font, fontSize, fontWeight } = fabric.committed[0]!.children[0]!.props;
      assert.deepEqual(
        { font, fontSize, fontWeight },
        {
          font: undefined,
          fontSize: 12,
          fontWeight: 'bold',
        },
      );
    });
  });
});

describe('a span of a drawing that keeps its spaces', () => {
  it('runs them into one, and drops them only at the ends of the text it is in', () => {
    // Highcharts writes `<tspan>● </tspan><tspan>1903</tspan>`: the space parts the dot and year.
    const undo = [
      registerViewName('x-text', 'RNSVGText', undefined, { looseText: 'x-span' }),
      registerViewName('x-span', 'RNSVGTSpan', undefined, {
        textContent: 'content',
        spacedText: true,
      }),
    ];
    try {
      const { fabric, engine, add } = scene();
      const label = add('x-text');
      const spans = ['  ●  ', '1903 '].map((words) => {
        const span = add('x-span', label);
        engine.appendChild(span, engine.createText(words));
        return span;
      });
      engine.commit();
      const content = () => fabric.committed[0]!.children.map((each) => each.props['content']);
      assert.deepEqual(content(), ['● ', '1903']);
      // The year is no longer the last words once more follow it, and is again once they go.
      const more = add('x-span', label);
      engine.appendChild(more, engine.createText('First'));
      engine.commit();
      assert.deepEqual(content(), ['● ', '1903 ', 'First']);
      engine.removeChild(label, more);
      engine.commit();
      assert.deepEqual(content(), ['● ', '1903']);
      assert.equal(spans.length, 2);
    } finally {
      undo.forEach((each) => each());
    }
  });

  it('is a span like any other once registered without keeping them', () => {
    // Registered again without them, as another package names the same view.
    const undo = [
      registerViewName('x-text', 'RNSVGText', undefined, { looseText: 'x-span' }),
      registerViewName('x-span', 'RNSVGTSpan', undefined, { textContent: 'content' }),
    ];
    try {
      const { fabric, engine, add } = scene();
      const label = add('x-text');
      for (const words of ['  ●  ', '1903 ']) {
        engine.appendChild(add('x-span', label), engine.createText(words));
      }
      engine.commit();
      assert.deepEqual(
        fabric.committed[0]!.children.map((each) => each.props['content']),
        ['●', '1903'],
      );
    } finally {
      undo.forEach((each) => each());
    }
  });
});

describe('where a touch is taken to be', () => {
  function touched() {
    const { engine, add } = scene();
    const drawing = add('view');
    const shape = add('view', drawing);
    const heard: string[] = [];
    for (const [name, node] of [
      ['drawing', drawing],
      ['shape', shape],
    ] as const) {
      for (const type of ['topTouchStart', 'topTouchMove', 'topTouchEnd']) {
        engine.setEventListener(node, type, () => heard.push(`${name} ${type}`));
      }
    }
    engine.commit();
    return { engine, drawing, shape, heard };
  }

  it('is on what a package finds, from the start of a touch until the finger lifts', () => {
    const { engine, drawing, shape, heard } = touched();
    const asked: EngineNode[] = [];
    engine.setTouchTarget((target) => {
      asked.push(target);
      return target === drawing ? shape : target;
    });
    for (const type of ['topTouchStart', 'topTouchMove', 'topTouchEnd']) {
      engine.dispatchEvent(drawing, type, { identifier: 1 });
    }
    assert.deepEqual(asked, [drawing], 'asked once, as the touch starts');
    assert.deepEqual(heard, [
      'shape topTouchStart',
      'drawing topTouchStart',
      'shape topTouchMove',
      'drawing topTouchMove',
      'shape topTouchEnd',
      'drawing topTouchEnd',
    ]);
    // Native's again once the package says nothing.
    heard.length = 0;
    engine.setTouchTarget(null);
    engine.dispatchEvent(drawing, 'topTouchStart', { identifier: 2 });
    assert.deepEqual(heard, ['drawing topTouchStart']);
  });

  it("is native's own where no package says", () => {
    const { engine, drawing, heard } = touched();
    engine.dispatchEvent(drawing, 'topTouchStart', { identifier: 1 });
    assert.deepEqual(heard, ['drawing topTouchStart']);
  });
});

describe('the name a type selector reads', () => {
  it('is the type name a node has, where a renderer keeps it under another', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(
        'text { opacity: 0.5 } .chart text { opacity: 0.25 }',
        'app.css',
      ) as never,
    });
    const chart = engine.createElement('view');
    engine.setClasses(chart, 'chart');
    engine.appendChild(engine.root, chart);
    const drawn = engine.createElement('svg:text');
    drawn.typeName = 'text';
    engine.appendChild(chart, drawn);
    const other = engine.createElement('svg:text');
    engine.appendChild(engine.root, other);
    engine.commit();
    assert.equal(fabric.committed[0]!.children[0]!.props['opacity'], 0.25);
    assert.equal(fabric.committed[1]!.props['opacity'], undefined);
  });
});

describe("a library sheet's shape paint, refused", () => {
  it('costs only its own declaration, as any refused declaration does', () => {
    const dropped: string[] = [];
    const { rules } = compileCss('.icon { width: 24px; fill: CanvasText }', 'library.css', {
      generated: true,
      onUnsupported: (message) => dropped.push(message),
    });
    assert.equal(rules.length, 1, 'the rule is kept');
    const declarations = rules[0]!['declarations'] as Record<string, unknown>;
    assert.equal(declarations['width'], 24);
    assert.equal(declarations['fill'], undefined);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]!, /fill/);
  });

  it('is replaced by a later one, as any declaration is', () => {
    const { rules } = generated('.icon { fill: var(--brand); fill: red }');
    const rule = rules[0]!;
    const declarations = rule['declarations'] as Record<string, unknown>;
    assert.ok(declarations['fill'] !== undefined, 'the later paint is kept');
    const deferred = (rule['deferred'] ?? []) as { props: string[] }[];
    assert.equal(
      deferred.some((each) => each.props.includes('fill')),
      false,
      'the earlier token paint is not settled over it',
    );
  });
});

describe('a touch a package finds a target for', () => {
  it("goes to native's own target where the package throws, and is reported", () => {
    const { engine, drawing, heard } = (() => {
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1);
      const drawing = engine.createElement('view');
      engine.appendChild(engine.root, drawing);
      const heard: string[] = [];
      engine.setEventListener(drawing, 'topTouchStart', () => heard.push('drawing'));
      engine.commit();
      return { engine, drawing, heard };
    })();
    const logged: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      engine.setTouchTarget(() => {
        throw new Error('no layout yet');
      });
      assert.doesNotThrow(() => engine.dispatchEvent(drawing, 'topTouchStart', { identifier: 1 }));
      assert.deepEqual(heard, ['drawing']);
      assert.equal(logged.length, 1);
    } finally {
      console.error = error;
      engine.setTouchTarget(null);
    }
  });
});

describe('a span registered again by another package', () => {
  it('keeps its spaces again once the registration that did not is taken away', () => {
    const undo = [
      registerViewName('x-text', 'RNSVGText', undefined, { looseText: 'x-span' }),
      registerViewName('x-span', 'RNSVGTSpan', undefined, {
        textContent: 'content',
        spacedText: true,
      }),
    ];
    try {
      registerViewName('x-span', 'RNSVGTSpan', undefined, { textContent: 'content' })();
      const { fabric, engine, add } = scene();
      const label = add('x-text');
      for (const words of ['  ●  ', '1903 ']) {
        engine.appendChild(add('x-span', label), engine.createText(words));
      }
      engine.commit();
      assert.deepEqual(
        fabric.committed[0]!.children.map((each) => each.props['content']),
        ['● ', '1903'],
      );
    } finally {
      undo.forEach((each) => each());
    }
  });
});

describe("a library sheet's stroke length", () => {
  const declared = (css: string) => {
    const dropped: string[] = [];
    const { rules } = compileCss(`.a { ${css} }`, 'library.css', {
      generated: true,
      onUnsupported: (message) => dropped.push(message),
    });
    return { declarations: rules[0]?.['declarations'] as Record<string, unknown>, dropped };
  };

  it('is a number for points and a percentage string for a percentage, as native takes them', () => {
    assert.equal(declared('stroke-width: 2px').declarations['strokeWidth'], 2);
    assert.equal(declared('stroke-width: 50%').declarations['strokeWidth'], '50%');
    assert.equal(declared('stroke-dashoffset: 1rem').declarations['strokeDashoffset'], 16);
    assert.deepEqual(declared('stroke-dasharray: 4px 50%').declarations['strokeDasharray'], [
      4,
      '50%',
    ]);
  });

  it('is reported where native has no length for its unit, not drawn as a bare number', () => {
    for (const css of ['stroke-width: 1in', 'stroke-dasharray: 4px 1in']) {
      const { declarations, dropped } = declared(`width: 4px; ${css}`);
      assert.equal(declarations['width'], 4, 'the rest of the rule is kept');
      assert.equal(declarations['strokeWidth'] ?? declarations['strokeDasharray'], undefined);
      assert.equal(dropped.length, 1);
      assert.match(dropped[0]!, /stroke-(width|dasharray)/);
    }
  });

  it('is settled against the font of the shape it is on, for an em', () => {
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene(
        '.a { font-size: 10px; stroke-width: 2em; stroke-dasharray: 1em 2px }',
      );
      add('x-path', engine.root, 'a');
      engine.commit();
      const { strokeWidth, strokeDasharray } = fabric.committed[0]!.props;
      assert.deepEqual(
        { strokeWidth, strokeDasharray },
        { strokeWidth: 20, strokeDasharray: [10, 2] },
      );
    });
  });
});

describe("a library drawing's stroke-dasharray: none", () => {
  it('draws a shape in a dashed group solid, as a dash it names as its own and sets none', () => {
    withViews(SHAPES, () => {
      const { fabric, engine, add } = scene(
        '.dashed { stroke-dasharray: 4px 2px } .solid { stroke-dasharray: none }',
      );
      const group = add('x-g', engine.root, 'dashed');
      add('x-path', group, 'solid');
      add('x-path', group);
      engine.commit();
      const [g] = fabric.committed;
      assert.deepEqual(g!.props['strokeDasharray'], [4, 2]);
      const [solid, dashed] = g!.children;
      assert.ok('strokeDasharray' in solid!.props, 'the shape sends one of its own');
      assert.equal(solid!.props['strokeDasharray'], null);
      assert.ok((solid!.props['propList'] as string[]).includes('strokeDasharray'));
      assert.equal(dashed!.props['strokeDasharray'], undefined, 'native hands the dash down');
    });
  });
});
