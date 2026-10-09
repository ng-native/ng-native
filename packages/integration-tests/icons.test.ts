/**
 * Icons: ng-icons' markup, react-native-svg's native shapes.
 *
 * Two halves, and the second is where the bugs would be. Parsing is a scanner over a trusted
 * constant. Translating is not: `fill` and `stroke` are brush structs rather than colours,
 * `stroke-linecap` is an integer rather than the word it is written as, and a shape has to
 * declare what it set so native knows what to inherit. Every one of those fails silently, so
 * every one is pinned here.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { parseSvg } from '../icons/src/parse-svg.ts';
import { registerSvgComponents } from '../icons/src/svg-elements.ts';
import {
  brushOf,
  gradientProps,
  nativeProps,
  pointsToPath,
  styleAttributes,
  textProps,
  transformMatrix,
  viewBoxProps,
} from '../icons/src/svg-props.ts';
import { cleanup, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const colour = { color: (value: string) => `processed:${value}` };

describe('parsing an icon', () => {
  it('reads the tree, keeping only elements', () => {
    const root = parseSvg(
      '<svg viewBox="0 0 24 24"><!-- a comment --><g><path d="M0 0"/></g></svg>',
    );
    assert.equal(root?.tag, 'svg');
    assert.equal(root?.attrs['viewBox'], '0 0 24 24');
    assert.equal(root?.children[0]?.tag, 'g');
    assert.equal(root?.children[0]?.children[0]?.attrs['d'], 'M0 0');
  });

  it('skips a comment even when it holds markup', () => {
    const root = parseSvg('<svg><!-- <path d="M0 0"/> --><circle r="1"/></svg>');
    assert.deepEqual(
      root?.children.map((child) => child.tag),
      ['circle'],
    );
  });

  it('handles both quote styles and an unclosed root', () => {
    const root = parseSvg(`<svg fill='none'><path d="M1 1"></path></svg>`);
    assert.equal(root?.attrs['fill'], 'none');
    assert.equal(root?.children.length, 1);
  });

  it('keeps self-closing elements as siblings, which the greedy attribute run hides', () => {
    const root = parseSvg('<svg><circle r="1"/><circle r="2"/><path d="M0 0"/></svg>');
    assert.equal(root?.children.length, 3);
    assert.deepEqual(
      root?.children.map((child) => child.children.length),
      [0, 0, 0],
      'nesting them would inherit paint that was never meant for them',
    );
  });

  it('is nothing for markup with no element in it', () => {
    assert.equal(parseSvg('<!-- nothing here -->'), null);
  });

  it('keeps the characters of a text and a tspan, which are what they draw', () => {
    const root = parseSvg(
      '<svg><text x="0">Fish &amp;\n   chips <tspan dy="4">&lt;hot&gt;</tspan></text><g> </g></svg>',
    );
    const text = root!.children[0]!;
    assert.deepEqual(
      text.children.map((child) => [child.tag, child.text]),
      [
        ['#text', 'Fish & chips '],
        ['tspan', undefined],
      ],
    );
    assert.equal(text.children[1]!.children[0]!.text, '<hot>');
    assert.deepEqual(root!.children[1]!.children, [], 'and nothing between other elements');
  });
});

describe('translating a gradient and a text', () => {
  /** A host whose colours are numbers, as a device's are: AARRGGBB. */
  const numbers = {
    color: (value: string) => {
      const hex = value.length === 4 ? value.replace(/[\da-f]/gi, '$&$&') : value;
      return Number.parseInt((hex.slice(7) || 'ff') + hex.slice(1, 7), 16);
    },
  };
  const node = (markup: string) => parseSvg(markup)!;

  it('gives a linear gradient its name, its line and its stops as native takes them', () => {
    const props = gradientProps(
      node(
        '<linearGradient id="g" x2="0" y2="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(2 3)">' +
          '<stop offset="100%" stop-color="#0000ff"/><stop offset="0.25" stop-color="#ff0000"/>' +
          '</linearGradient>',
      ),
      numbers,
    );
    assert.deepEqual(props, {
      name: 'g',
      // The line react-native-svg defaults to, with what the markup set.
      x1: '0%',
      y1: '0%',
      x2: '0',
      y2: '1',
      // Offsets in order, each with its colour as one number.
      gradient: [0.25, 0xffff0000 | 0, 1, 0xff0000ff | 0],
      gradientUnits: 1,
      gradientTransform: [1, 0, 0, 1, 2, 3],
    });
  });

  it("multiplies a stop's opacity into its colour's own, and reads either from a style", () => {
    const { gradient } = gradientProps(
      node(
        '<linearGradient id="g">' +
          '<stop stop-color="#ff000080" stop-opacity="0.5"/>' +
          '<stop offset="1" style="stop-color:#00ff00;stop-opacity:0"/>' +
          '<stop offset="1"/>' +
          '</linearGradient>',
      ),
      numbers,
    ) as { gradient: number[] };
    assert.deepEqual(gradient, [0, 0x40ff0000, 1, 0x0000ff00, 1, 0xff000000 | 0]);
  });

  it('gives a radial gradient the centre, radii and focus react-native-svg defaults', () => {
    const props = gradientProps(node('<radialGradient id="r" cx="25%" r="10"/>'), numbers);
    assert.deepEqual(props, {
      name: 'r',
      cx: '25%',
      cy: '50%',
      rx: '10',
      ry: '10',
      fx: '25%',
      fy: '50%',
      gradient: [],
      gradientUnits: 0,
      gradientTransform: null,
    });
  });

  it('paints a currentColor stop in the colour it is given, and black with none', () => {
    const stops = '<linearGradient id="g"><stop stop-color="currentColor"/></linearGradient>';
    assert.deepEqual(gradientProps(node(stops), numbers, '#00ff00')['gradient'], [
      0,
      0xff00ff00 | 0,
    ]);
    assert.deepEqual(gradientProps(node(stops), numbers)['gradient'], [0, 0xff000000 | 0]);
  });

  it('leaves out a stop whose colour the host cannot convert, as a var() is', () => {
    const none = {
      color: (value: string) => (value.startsWith('var(') ? null : numbers.color(value)),
    };
    const props = gradientProps(
      node(
        '<linearGradient id="g"><stop stop-color="var(--a)"/>' +
          '<stop offset="1" stop-color="#ff0000"/></linearGradient>',
      ),
      none,
    );
    assert.deepEqual(props['gradient'], [1, 0xffff0000 | 0]);
  });

  it('gives a text its font as one object and its positions as lists', () => {
    assert.deepEqual(
      textProps({
        x: '0 10,20',
        y: '18',
        dy: '2',
        'font-size': '17',
        'font-weight': '600',
        'font-family': "'Inter', sans-serif",
        'text-anchor': 'middle',
        'letter-spacing': '0.5',
      }),
      {
        x: ['0', '10', '20'],
        y: ['18'],
        dx: [],
        dy: ['2'],
        rotate: [],
        font: {
          fontSize: '17',
          fontWeight: '600',
          fontFamily: 'Inter',
          textAnchor: 'middle',
          letterSpacing: '0.5',
        },
      },
    );
  });
});

describe('a wordmark in the tree', () => {
  let instance: { tint: { set(value: string): void } };
  const warnings: string[] = [];

  before(async () => {
    registerSvgComponents();
    const mod = await compileFixture('fixtures/icon-wordmark.ts');
    const warn = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    try {
      ({ instance } = await render<typeof instance>(mod['WordmarkHost'] as Type<typeof instance>, {
        processColor: (value) => `processed:${String(value)}`,
      }));
    } finally {
      console.warn = warn;
    }
  });
  after(cleanup);

  const views = (id: string) => flatten([screen.getByTestId(id)]);
  const named = (id: string, viewName: string) =>
    views(id).find((view) => view.viewName === viewName)!;

  it('commits the gradient in defs and the text that is filled with it', () => {
    assert.deepEqual(
      views('mark').map((view) => view.viewName),
      ['RNSVGSvgView', 'RNSVGGroup', 'RNSVGDefs', 'RNSVGLinearGradient', 'RNSVGText', 'RNSVGTSpan'],
      'the stops are the gradient s own prop, and a title is no view',
    );
    const gradient = named('mark', 'RNSVGLinearGradient');
    assert.equal(gradient.props['name'], 'g');
    assert.deepEqual(gradient.props['gradient'], [0, 'processed:#437dfc', 1, 'processed:#4ad0ef']);
    assert.deepEqual(pick(gradient.props, 'x1', 'y1', 'x2', 'y2'), {
      x1: '0',
      y1: '0',
      x2: '0',
      y2: '1',
    });

    const text = named('mark', 'RNSVGText');
    assert.deepEqual(text.props['fill'], { type: 1, brushRef: 'g' });
    assert.deepEqual(text.props['propList'], ['fill']);
    assert.deepEqual(text.props['font'], { fontSize: '17', fontWeight: '600' });
    assert.deepEqual(pick(text.props, 'x', 'y'), { x: ['0'], y: ['18'] });
    assert.equal(named('mark', 'RNSVGTSpan').props['content'], 'Week');
  });

  it('is as wide as its box, since a wordmark is not square', () => {
    assert.deepEqual(pick(screen.getByTestId('mark').props, 'width', 'height'), {
      width: 96,
      height: 24,
    });
  });

  it('warns about an element it does not draw, once, and not about a title or a stop', () => {
    // Two icons, each with two masks.
    assert.deepEqual(
      warnings.filter((warning) => warning.includes('does not draw')),
      [
        '[angular-native] <ng-icon> does not draw <mask>, so it is left out of the icon. ' +
          'It draws svg, g, path, circle, ellipse, rect, line, polyline, polygon, defs, ' +
          'linearGradient, radialGradient, text, tspan and stop.',
      ],
    );
  });

  it('says so when a currentColor stop has no color input to take, and paints it black', () => {
    assert.equal(warnings.filter((warning) => warning.includes('currentColor')).length, 1);
    assert.deepEqual(named('untinted', 'RNSVGRadialGradient').props['gradient'], [
      0,
      'processed:#000',
      1,
      'color-mix(in srgb, processed:#000000 0%, transparent)',
    ]);
  });

  it("paints a currentColor stop in the icon's color input, and follows it", async () => {
    const stops = () => named('tinted', 'RNSVGRadialGradient').props['gradient'];
    const clear = 'color-mix(in srgb, processed:#000000 0%, transparent)';
    assert.deepEqual(stops(), [0, 'processed:#ff0000', 1, clear]);
    instance.tint.set('#00ff00');
    await settle();
    assert.deepEqual(stops(), [0, 'processed:#00ff00', 1, clear]);
  });
});

/** The named props, absent ones included as undefined. */
const pick = (props: Record<string, unknown>, ...names: string[]) =>
  Object.fromEntries(names.map((name) => [name, props[name]]));

describe('translating an icon', () => {
  it('turns paint into a brush, because native does not take a colour', () => {
    assert.deepEqual(brushOf('#fff', colour), { type: 0, payload: 'processed:#fff' });
    assert.equal(brushOf('none', colour), null);
    assert.deepEqual(brushOf('currentColor', colour), { type: 2 }, 'resolved by the view, later');
    assert.deepEqual(brushOf('url(#grad)', colour), { type: 1, brushRef: 'grad' });
  });

  it('turns the keyword props into the integers they really are', () => {
    const props = nativeProps(
      'path',
      { 'stroke-linecap': 'round', 'stroke-linejoin': 'bevel', 'fill-rule': 'evenodd', d: 'M0 0' },
      colour,
    );
    assert.equal(props['strokeLinecap'], 1);
    assert.equal(props['strokeLinejoin'], 2);
    assert.equal(props['fillRule'], 0);
    assert.equal(props['d'], 'M0 0');
  });

  it('reads a name that is only on Object.prototype as unknown', () => {
    const props = nativeProps(
      'constructor',
      {
        constructor: 'x',
        'stroke-linecap': 'toString',
        'stroke-linejoin': 'toString',
        'fill-rule': 'valueOf',
      },
      colour,
    );
    assert.deepEqual(props, {
      strokeLinecap: 0,
      strokeLinejoin: 0,
      fillRule: 1,
      propList: ['strokeLinecap', 'strokeLinejoin', 'fillRule'],
    });
  });

  it('turns the opacity props into numbers, because Android takes a float', () => {
    const props = nativeProps(
      'path',
      {
        opacity: '0.5',
        'fill-opacity': '.4',
        'stroke-opacity': '1',
        'stroke-dashoffset': '2',
        'stroke-miterlimit': '10',
        d: 'M0 0',
      },
      colour,
    );
    assert.equal(props['opacity'], 0.5);
    assert.equal(props['fillOpacity'], 0.4);
    assert.equal(props['strokeOpacity'], 1);
    assert.equal(props['strokeDashoffset'], 2);
    assert.equal(props['strokeMiterlimit'], 10);
  });

  it('falls back to the native default when an opacity does not parse', () => {
    const props = nativeProps(
      'path',
      { opacity: 'inherit', 'stroke-dashoffset': 'nonsense', 'stroke-miterlimit': 'nope' },
      colour,
    );
    assert.equal(props['opacity'], 1);
    assert.equal(props['strokeDashoffset'], 0);
    assert.equal(props['strokeMiterlimit'], 4);
  });

  it('reads an unknown fill rule as nonzero, the SVG default', () => {
    assert.equal(nativeProps('path', { 'fill-rule': 'sideways' }, colour)['fillRule'], 1);
  });

  it('leaves strokeWidth a string, which native takes either way', () => {
    const props = nativeProps('path', { 'stroke-width': '1.5' }, colour);
    assert.equal(props['strokeWidth'], '1.5');
  });

  it('lists what the shape set, which is what native inherits around', () => {
    const props = nativeProps('path', { stroke: 'currentColor', d: 'M0 0' }, colour);
    assert.deepEqual(props['propList'], ['stroke']);

    const bare = nativeProps('path', { d: 'M0 0' }, colour);
    assert.equal(bare['propList'], undefined, 'nothing of its own, so everything is inherited');
  });

  it("defaults a shape's absent geometry to 0, as react-native-svg's components do", () => {
    // Android's shape views read a missing length as null and crash drawing it.
    assert.deepEqual(
      pick(
        nativeProps('rect', { width: '10', height: '10', x: '2' }, colour),
        'x',
        'y',
        'width',
        'height',
      ),
      { x: '2', y: 0, width: '10', height: '10' },
    );
    assert.deepEqual(pick(nativeProps('circle', { r: '4' }, colour), 'cx', 'cy', 'r'), {
      cx: 0,
      cy: 0,
      r: '4',
    });
    assert.deepEqual(pick(nativeProps('ellipse', {}, colour), 'cx', 'cy', 'rx', 'ry'), {
      cx: 0,
      cy: 0,
      rx: 0,
      ry: 0,
    });
    assert.deepEqual(pick(nativeProps('line', { x2: '24' }, colour), 'x1', 'y1', 'x2', 'y2'), {
      x1: 0,
      y1: 0,
      x2: '24',
      y2: 0,
    });
  });

  it('makes a path out of a polyline, which has no component of its own', () => {
    assert.equal(pointsToPath('4,4 8,8 12,4', false), 'M4,4L8,8L12,4');
    assert.equal(pointsToPath('4 4 8 8', true), 'M4,4L8,8Z', 'a polygon closes');
    assert.equal(nativeProps('polygon', { points: '0,0 4,0 4,4' }, colour)['d'], 'M0,0L4,0L4,4Z');
  });

  it('fills in the custom property ng-icons carries its stroke width in', () => {
    assert.deepEqual(
      styleAttributes('stroke-width:var(--ng-icon__stroke-width, 1.5)', {}),
      { 'stroke-width': '1.5' },
      'the fallback, when the app said nothing',
    );
    assert.deepEqual(
      styleAttributes('stroke-width:var(--ng-icon__stroke-width, 1.5)', {
        '--ng-icon__stroke-width': 3,
      }),
      { 'stroke-width': '3' },
    );
  });

  it('reads a viewBox as the four props the view takes', () => {
    assert.deepEqual(viewBoxProps('0 0 24 24'), {
      minX: 0,
      minY: 0,
      vbWidth: 24,
      vbHeight: 24,
      align: 'xMidYMid',
      meetOrSlice: 0,
    });
    assert.deepEqual(viewBoxProps('nonsense'), {}, 'rather than committing NaN geometry');
    assert.deepEqual(viewBoxProps('0,0,24,24'), viewBoxProps('0 0 24 24'), 'commas separate too');
  });

  it('composes a transform into the matrix native takes', () => {
    assert.deepEqual(transformMatrix('matrix(1,2,3,4,5,6)'), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(transformMatrix('translate(4 5)'), [1, 0, 0, 1, 4, 5]);
    assert.deepEqual(transformMatrix('scale(2)'), [2, 0, 0, 2, 0, 0]);
    const rotated = transformMatrix('rotate(90)')!;
    assert.ok(Math.abs(rotated[0]!) < 1e-9 && Math.abs(rotated[1]! - 1) < 1e-9);
    const about = transformMatrix('rotate(90 12 12)')!.map((n) => Math.round(n * 1e9) / 1e9 || 0);
    assert.deepEqual(about, [0, 1, -1, 0, 24, 0], 'turned about its own centre');
    assert.deepEqual(
      transformMatrix('translate(10 0) scale(2)'),
      [2, 0, 0, 2, 10, 0],
      'applied right to left, as SVG composes a list',
    );
  });
});

describe('an icon in the tree', () => {
  let instance: { size: { set(value: number): void } };
  let mod: Record<string, unknown>;
  const warnings: string[] = [];

  before(async () => {
    registerSvgComponents();
    mod = await compileFixture('fixtures/icons.ts');
    const warn = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    try {
      const rendered = await render<{ size: { set(value: number): void } }>(
        mod['IconHost'] as Type<{ size: { set(value: number): void } }>,
        {
          processColor: (value) => `processed:${String(value)}`,
          providers: [provideIcons({ heroAcademicCap: mod['heroAcademicCap'] as string })],
        },
      );
      instance = rendered.instance;
    } finally {
      console.warn = warn;
    }
  });
  after(cleanup);

  const byId = (id: string) => screen.getByTestId(id);

  it('commits the host as the native svg view', () => {
    assert.equal(byId('named').viewName, 'RNSVGSvgView');
    // Style is flattened into props by the engine, so the size arrives as two of them.
    assert.equal(byId('named').props['width'], 24);
    assert.equal(byId('named').props['height'], 24);
    assert.equal(byId('named').props['name'], undefined, 'the input is not a native prop');
  });

  it('is as big as the text around it where it is given no size, as an icon is on the web', () => {
    // `@ng-icons/core` sizes an icon `1em`, so a library sizes one with a font size on it or
    // around it. The view scales what it draws to whatever size that comes to.
    assert.equal(byId('by-font').props['width'], 20);
    assert.equal(byId('by-font').props['height'], 20);
    assert.equal(byId('by-font').props['bbWidth'], '100%');
    assert.equal(byId('by-font').props['bbHeight'], '100%');
    // With no font size in scope it is the 16 an em falls back to.
    assert.equal(byId('raw').props['width'], 16);
    assert.equal(byId('raw').props['bbWidth'], '100%');
  });

  it('takes a size written as a static attribute, which arrives as a string', () => {
    // `size="32"` is how the web writes it. A string width is one native drops, and the icon
    // lost its size.
    assert.equal(byId('static').props['width'], 32);
    assert.equal(byId('static').props['bbWidth'], 32);
  });

  it('takes a size written with a unit, as a web app writes one', () => {
    // `size="18px"` is what `@ng-icons/core` documents: read as a number alone it is not one,
    // and the icon had no size at all.
    assert.equal(byId('in-px').props['width'], 18);
    assert.equal(byId('in-px').props['bbWidth'], 18);
    assert.equal(byId('in-rem').props['width'], 24);
    // One it cannot read is left the size of the text around it, and never NaN.
    assert.equal(byId('unread').props['width'], 16);
    // Nor one whose number is not a number, which matched as rem and came to NaN.
    assert.equal(byId('unread-rem').props['width'], 16);
  });

  it('finds the icon through provideIcons, by the name a web app uses', () => {
    const paths = flatten([byId('named')]).filter((n) => n.viewName === 'RNSVGPath');
    assert.equal(paths.length, 1, 'the heroicon drew');
    assert.equal(paths[0]?.props['strokeLinecap'], 1);
  });

  it('carries the root presentation on a group, so the shapes inherit it', () => {
    const group = byId('named').children[0]!;
    assert.equal(group.viewName, 'RNSVGGroup');
    assert.deepEqual(group.props['stroke'], { type: 2 }, 'currentColor, for the view to resolve');
    assert.equal(group.props['strokeWidth'], '1.5', 'from the custom property in its style');
  });

  it('hands the view the colour a currentColor brush paints from', () => {
    assert.equal(byId('named').props['color'], 'processed:#ff9f0a');
  });

  it('reads the viewBox off the markup rather than assuming one', () => {
    assert.equal(byId('named').props['vbWidth'], 24);
    assert.equal(byId('named').props['minX'], 0);
  });

  it('draws geometry and a polyline from raw markup, with the stroke width the app set', () => {
    const shapes = flatten([byId('raw')]).map((node) => node.viewName);
    assert.deepEqual(shapes, [
      'RNSVGSvgView',
      'RNSVGGroup',
      'RNSVGCircle',
      'RNSVGCircle',
      'RNSVGPath',
    ]);
    const group = byId('raw').children[0]!;
    assert.equal(group.children.length, 3, 'siblings, not one inside the next');
    assert.equal(
      byId('raw').children[0]?.props['strokeWidth'],
      '3',
      'the input filled in the custom property, as it does on the web',
    );
  });

  it('draws only the elements native has a view for, and is labelled for a screen reader', () => {
    const labelled = byId('labelled');
    assert.deepEqual(
      flatten([labelled])
        .map((n) => n.viewName)
        .filter((name) => name !== 'RNSVGSvgView'),
      ['RNSVGGroup', 'RNSVGCircle'],
    );
    assert.equal(labelled.props['accessible'], true);
    assert.equal(labelled.props['accessibilityRole'], 'image');
  });

  it('reads a name that is only on Object.prototype as no icon', () => {
    assert.deepEqual(byId('inherited').children, []);
    assert.ok(
      warnings.some((warning) => warning.includes('no icon named constructor')),
      'the lookup fell through rather than finding Object',
    );
  });

  it('takes the old drawing down when the markup changes', async () => {
    const host = instance as unknown as { odd: { set(value: string): void } };
    host.odd.set('<svg viewBox="0 0 24 24"><rect width="2" height="2"/></svg>');
    await settle();
    assert.deepEqual(
      flatten([byId('labelled')])
        .map((n) => n.viewName)
        .filter((name) => name !== 'RNSVGSvgView'),
      ['RNSVGGroup', 'RNSVGRect'],
    );
  });

  it('redraws when the icon changes, without leaving the old one behind', async () => {
    instance.size.set(40);
    await settle();
    assert.equal(byId('named').props['width'], 40);
    assert.equal(
      flatten([byId('named')]).filter((n) => n.viewName === 'RNSVGGroup').length,
      1,
      'one group, not two',
    );
  });
});
