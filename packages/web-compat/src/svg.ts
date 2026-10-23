import { nativePlatform, registerViewName, type Engine, type EngineNode } from '@ng-native/fabric';
import { nativeProps, viewBoxProps } from '@ng-native/icons';
import { DEFINED, MARKED, definitionProps } from './svg-definitions.ts';
import { isUnseen } from './svg-unseen.ts';
import {
  fontFamilyOf,
  fontSizeOf,
  fontWeightOf,
  lineStarts,
  sizeFontsUnder,
  widthOf,
} from './svg-box.ts';
import { fontNamed } from './text-width.ts';
import {
  FILTERED,
  STEP,
  STEP_VIEWS,
  filterProps,
  shadowDrawn,
  shadowProps,
  shadowRemoved,
  KEPT as KEPT_NODE,
} from './svg-filter.ts';
import {
  LONG_PATH,
  drawnPathData,
  redrawLongPathsUnder,
  type DrawingReader,
} from './dense-drawing.ts';

/**
 * An `<svg>` a library writes in its own template, a checkbox's tick or a switch's icon, drawn
 * by react-native-svg's native shapes: the same views `@ng-native/icons` draws an icon with,
 * under the names a browser has for them. What a stylesheet paints them with is the engine's.
 */
/** A `<text>` in a drawing, by a name of its own: `text` is the app's text element. */
const SVG_TEXT = 'svg:text';
/** A link in a drawing, which groups what it holds: HTML's `<a>` is a view, which draws nothing in one. */
const SVG_LINK = 'svg:a';

/**
 * What a drawing holds that nothing here draws: its effects, and what describes it. A chart's
 * `<title>` is what a pointer over a bar is told, and is no part of the picture.
 */
const NOT_DRAWN = /^(symbol|use|image|style|title|desc|metadata|animate[a-z]*|set)$/;
/** One of those in a template: a view that is not displayed, with all that is in it. */
const SVG_UNDRAWN = 'svg:undrawn';
const UNDRAWN = { display: 'none' };

/**
 * The element a name stands for inside an `<svg>`: another than the name's own where the drawing
 * has one, and its own otherwise, which keeps it the drawing's.
 */
export function svgNamed(name: string, namespace: string): string | undefined {
  if (namespace !== 'svg') return undefined;
  if (name === 'text') return SVG_TEXT;
  // A span a template writes in a text, placed by attributes of its own: a label of two lines.
  if (name === 'tspan') return SVG_SPAN;
  if (name === 'a') return SVG_LINK;
  // A step of a filter the drawing has none of its own for: see `svg-filter.ts`.
  if (/^fe[A-Z]/.test(name) && !Object.hasOwn(FILTERED, name)) return STEP;
  return NOT_DRAWN.test(name.toLowerCase()) ? SVG_UNDRAWN : name;
}

/**
 * An element markup or a script makes, by its name: in a drawing, the one the name stands for
 * there, which the engine draws as a library's drawing, as it does one a template writes in an
 * `<svg>`. Its own name is still what a stylesheet reads, where it is kept by another.
 */
export function drawingElement(engine: Engine, name: string, drawn: boolean): EngineNode {
  if (!drawn) return engine.createElement(name);
  const node = engine.createElement(svgNamed(name, 'svg') ?? name);
  node.namespace = 'svg';
  if (node.tag !== name) node.typeName = name;
  return node;
}

/**
 * What a shape with no fill of its own is filled with, and every shape in it that has none:
 * black, which is where SVG starts. Given to what is written straight into the drawing, as a
 * default under any stylesheet: the native shapes take a fill from the one they are in, and
 * the drawing's native view has none to give.
 */
const FILLED = { fill: 'black' };

/**
 * The paint a shape written straight into a drawing starts with, where it says none of its own:
 * the drawing's, `<svg fill="currentColor">` as Material's icons have, or black for a fill.
 *
 * ponytail: a drawing's paint that names a token, `fill="var(--ink)"`, is not settled here. Give
 * it the cascade, as a shape's own is in `paintByToken`, if a library is seen to write one.
 */
function startingPaint(node: EngineNode): Record<string, string> | undefined {
  if (node.parent?.tag !== 'svg') return undefined;
  const own = attributesOf(node).attrs;
  const drawing = attributesOf(node.parent).attrs;
  const fill = 'fill' in own ? undefined : (drawing['fill'] ?? 'black');
  const stroke = 'stroke' in own ? undefined : drawing['stroke'];
  if (fill === 'black' && stroke === undefined) return FILLED;
  if (fill === undefined && stroke === undefined) return undefined;
  return { ...(fill !== undefined && { fill }), ...(stroke !== undefined && { stroke }) };
}

const TEXT_PATH = 'textPath';

const SHAPES: Readonly<Record<string, string>> = {
  g: 'RNSVGGroup',
  [SVG_LINK]: 'RNSVGGroup',
  path: 'RNSVGPath',
  circle: 'RNSVGCircle',
  ellipse: 'RNSVGEllipse',
  rect: 'RNSVGRect',
  line: 'RNSVGLine',
  polyline: 'RNSVGPath',
  polygon: 'RNSVGPath',
  // What an icon keeps aside and names: drawn where a shape refers to it, and not where it is.
  defs: 'RNSVGDefs',
  clipPath: 'RNSVGClipPath',
  mask: 'RNSVGMask',
  linearGradient: 'RNSVGLinearGradient',
  radialGradient: 'RNSVGRadialGradient',
  // The drawing's own text, which a template writes as `<text>` inside an `<svg>`: see `named`.
  [SVG_TEXT]: 'RNSVGText',
  // A text set along a path, which a chart library curves a label round a ring with.
  [TEXT_PATH]: 'RNSVGTextPath',
  // HTML in the drawing, at its place and size: a chart's card or tree map label.
  foreignObject: 'RNSVGForeignObject',
  // A marker at a line's end, and a pattern a shape is filled with: see `svg-definitions.ts`.
  ...DEFINED,
  // A filter, and the drop shadow in one: see `svg-filter.ts`.
  ...FILTERED,
};

/** What a definition, or a shape too faint to see, adds to its props: see `svg-definitions.ts`. */
function ownedProps(
  name: string,
  attrs: Readonly<Record<string, string>>,
): Record<string, unknown> {
  if (name in DEFINED) return definitionProps(name, attrs);
  return name in UNSEEN_SHAPES && isUnseen(attrs) ? { opacity: 0 } : {};
}

/** The shapes that are drawn with no opacity where they are painted too faintly to see. */
const UNSEEN_SHAPES: Readonly<Record<string, true>> = {
  path: true,
  rect: true,
  circle: true,
  ellipse: true,
  line: true,
  polyline: true,
  polygon: true,
};

/** The elements whose own words are drawn by a span the engine keeps for them. */
const WORDED: readonly string[] = [SVG_TEXT, TEXT_PATH];

/** The span of a text that holds what it says: the native text draws nothing of its own. */
const SVG_SPAN = 'svg:tspan';

/**
 * What a drawing's own elements are given as they are put in it: a gradient its stops, its
 * definitions their place, and a shape the fill a drawing starts with.
 */
export function svgInserted(node: EngineNode, parent: EngineNode, engine: Engine): void {
  if (isShape(node)) sizeFontsUnder(node, engine);
  partInserted(node, parent, engine);
  if (node.tag === 'stop' && parent.tag in GRADIENTS) return stopped(node, parent, engine);
  if (node.tag === 'defs') return defined(node, parent, engine);
  if (node.tag === SVG_UNDRAWN) return engine.setDefaultStyle(node, UNDRAWN);
  if (node.tag === 'feDropShadow') drawAgain(node, engine);
  // One with no attribute is never drawn by one being set, and is the whole drawing.
  if (node.tag === 'foreignObject') drawLater(node, engine);
  startFilled(node, engine);
  longPathsMoved(node, engine);
}

/** Where a long path, or a group of them, is put changes the scale it is drawn across. */
function longPathsMoved(node: EngineNode, engine: Engine): void {
  if (node.tag === 'path' && (attributesOf(node).attrs['d']?.length ?? 0) >= LONG_PATH) {
    drawLater(node, engine);
  } else if (node.tag === 'g') {
    redrawLongPathsUnder(node, engine, (path) => drawLater(path, engine));
  }
}

/** What a text is drawn by beside its words, put in it: a path it is set along, a copy as its outline. */
function partInserted(node: EngineNode, parent: EngineNode, engine: Engine): void {
  const copy = isCopyUnder(node) ? node : isCopyUnder(parent) ? parent : undefined;
  if (node.tag === TEXT_PATH || copy) partMoved(node, textOver(node, parent), engine);
}

/**
 * The text a node put under a parent is a part of: its parent, or the one its span, or the path
 * its words are set along, is in.
 */
function textOver(node: EngineNode, parent: EngineNode): EngineNode | undefined {
  if (parent.tag === SVG_TEXT) return parent;
  const above = parent.parent;
  if (parent.tag === TEXT_PATH && above?.tag === SVG_TEXT) return above;
  if (node.tag === TEXT_PATH || parent.tag !== SVG_SPAN || !above) return undefined;
  return above.tag === SVG_TEXT ? above : textOver(parent, above);
}

/**
 * A span of a text that is a copy of its words, stroked under them as their outline, and ends
 * with a span that puts the place back where the text starts: how Highcharts outlines a label.
 * See `outlined` for how it is drawn.
 */
export function isCopyUnder(node: EngineNode): boolean {
  if (node.tag !== SVG_SPAN) return false;
  const last = node.childList.filter((child) => child.nodeKind === 'element').at(-1);
  return last?.tag === SVG_SPAN && shapeAttributes(last)['x'] != null;
}

/**
 * Put a drawing's definitions before what uses them. The native drawing finds a gradient by
 * its name as it draws a shape, and has heard of none that comes later: a file written by a
 * design tool has its definitions last, and its shapes were filled by nothing.
 */
function defined(defs: EngineNode, parent: EngineNode, engine: Engine): void {
  const first = parent.childList.find((child) => child.nodeKind === 'element');
  if (first && first !== defs) engine.insertBefore(parent, defs, first);
}

/** The gradients, each with where its line or its circle is when nothing says. */
const GRADIENTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  linearGradient: { x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
  radialGradient: { cx: '50%', cy: '50%', r: '50%' },
};

/** Each gradient's stops as they were written: how far along, the colour, and how solid. */
const stops = new WeakMap<EngineNode, EngineNode[]>();

/** `50%` or `0.5` as a share of the way along. */
const share = (written: unknown): number => {
  const number = Number.parseFloat(String(written ?? 0)) || 0;
  return String(written).trim().endsWith('%') ? number / 100 : number;
};

/**
 * A stop put in a gradient: a colour at a place along it, which the native gradient takes as
 * a list and not as views. It is read and taken out again, and the gradient is given the list.
 */
function stopped(stop: EngineNode, gradient: EngineNode, engine: Engine): void {
  stops.set(gradient, [...(stops.get(gradient) ?? []), stop]);
  gradients.set(stop, gradient);
  engine.removeChild(gradient, stop);
  hearStopsDestroyed(engine);
  stopChanged(stop, engine);
}

/**
 * The engines told of a stop a template destroys. The renderer tells its extensions nothing of a
 * node taken out that is in no parent, and a stop is in none once it is read: a stop a loop
 * makes goes as its view is destroyed, which the engine is told of.
 */
const hearingStops = new WeakSet<Engine>();
function hearStopsDestroyed(engine: Engine): void {
  if (hearingStops.has(engine)) return;
  hearingStops.add(engine);
  const { destroyNode } = engine;
  engine.destroyNode = function (node) {
    stopRemoved(node, engine);
    destroyNode.call(this, node);
  };
}

/** The gradient each stop taken out of one is a stop of. */
const gradients = new WeakMap<EngineNode, EngineNode>();
/** The gradients whose stops changed, each given its list once what changes them is done. */
const restopped = new Map<EngineNode, Engine>();

/**
 * A stop was put in a gradient, or given an offset or a colour: its gradient has its list
 * again, once the template setting it is done. A stop a template makes in a loop is put in
 * before its bindings are set, and has no colour to read until they are. Answers false: what
 * was set is the renderer's to keep, where the list is read from.
 */
export function stopChanged(stop: EngineNode, engine: Engine): boolean {
  const gradient = gradients.get(stop);
  if (!gradient) return false;
  if (!restopped.size) {
    queueMicrotask(() => {
      const changed = [...restopped];
      restopped.clear();
      for (const [each, its] of changed) its.setProp(each, 'gradient', stopList(each, its));
      for (const its of new Set(changed.map(([, each]) => each))) its.commit();
    });
  }
  restopped.set(gradient, engine);
  return false;
}

/** A stop was taken away: its gradient runs between the ones that are left. */
function stopRemoved(stop: EngineNode, engine: Engine): void {
  const gradient = gradients.get(stop);
  if (!gradient) return;
  stopChanged(stop, engine);
  gradients.delete(stop);
  stops.set(
    gradient,
    (stops.get(gradient) ?? []).filter((each) => each !== stop),
  );
}

/** A gradient's stops as the native gradient takes them: a place and a colour each, in order. */
function stopList(gradient: EngineNode, engine: Engine): unknown[] {
  const list = (stops.get(gradient) ?? []).map((stop): [number, unknown] => {
    const own = {
      ...((stop.props['style'] as Record<string, unknown> | undefined) ?? {}),
      ...stop.props,
    };
    const colour = engine.color(own['stop-color'] ?? own['stopColor'] ?? 'black');
    const solid = Number(own['stop-opacity'] ?? own['stopOpacity'] ?? 1);
    return [share(own['offset']), fadedBy(colour, Math.min(Math.max(solid, 0), 1))];
  });
  return list.sort((a, b) => a[0] - b[0]).flat();
}

/**
 * A colour as the platform has it, less solid by a stop's own opacity: its alpha is the top
 * byte. One the platform has no number for is left as it is, with how solid it is said after.
 */
function fadedBy(colour: unknown, solid: number): unknown {
  if (typeof colour !== 'number') return solid === 1 ? colour : `${String(colour)}@${solid}`;
  const alpha = Math.round(((colour >>> 24) / 255) * solid * 255);
  return (colour & 0x00ffffff) | (alpha << 24) | 0;
}

/** A gradient's own props: its name, where it runs, and what its measures are of. */
function gradientProps(
  name: string,
  attrs: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const at = Object.fromEntries(
    Object.entries(GRADIENTS[name]!).map(([key, start]) => [key, attrs[key] ?? start]),
  );
  // A circle is as wide as it is tall, and looks from its middle where nothing says.
  const round =
    name === 'radialGradient'
      ? { rx: at['r'], ry: at['r'], fx: attrs['fx'] ?? at['cx'], fy: attrs['fy'] ?? at['cy'] }
      : {};
  const { r: _, ...placed } = { ...at, ...round } as Record<string, unknown>;
  return {
    ...placed,
    name: attrs['id'],
    gradientUnits: attrs['gradientUnits'] === 'userSpaceOnUse' ? 1 : 0,
  };
}

/** A shape's reference to something in the definitions: `clip-path="url(#clip)"`. */
const REFERENCES: Readonly<Record<string, string>> = {
  'clip-path': 'clipPath',
  mask: 'mask',
  filter: 'filter',
  ...MARKED,
};
const NAMED = /^url\(\s*#([^)\s]+)\s*\)$/;

/**
 * One paint of a shape as the native view takes it: a gradient in the definitions by its name,
 * a token left to the cascade, and the text colour for one the engine could not read.
 */
function painted(paint: string, written: string | undefined, props: Record<string, unknown>): void {
  const named = NAMED.exec(written ?? '');
  if (named) props[paint] = { type: 1, brushRef: named[1] };
  else if (isToken(written)) notOwn(props, paint);
  else if (unread(props[paint])) props[paint] = { type: 2 };
}

/**
 * A shape's props as the native view can take them. A paint the engine has no colour for, a
 * `var()` that only a stylesheet could settle, is the element's text colour rather than a
 * brush with nothing in it, which the native view throws on. And what the shape is clipped or
 * masked by is named, as what is in the definitions is by its `id`.
 *
 * ponytail: a `var()` paint is not followed to its token. Settle it as a bound style's is if
 * an icon is ever seen in the wrong colour for it.
 */
function drawable(
  name: string,
  attrs: Readonly<Record<string, string>>,
  props: Record<string, unknown>,
): Record<string, unknown> {
  for (const paint of PAINTS) painted(paint, attrs[paint], props);
  if (name in GRADIENTS) Object.assign(props, gradientProps(name, attrs));
  for (const [attr, prop] of Object.entries(REFERENCES)) {
    const named = NAMED.exec(attrs[attr] ?? '');
    if (named) props[prop] = named[1];
  }
  // What a shape is referred to by: a clip, a mask, the path a text is set along.
  if (attrs['id']) props['name'] = attrs['id'];
  Object.assign(props, ownedProps(name, attrs));
  placeable(props);
  // ponytail: all that is in it with it, where SVG lets a shape inside say it is visible.
  if (attrs['visibility'] === 'hidden') props['display'] = 'none';
  ofKind(name, attrs, props);
  return name === SVG_TEXT || name === SVG_SPAN ? { ...props, ...placed(attrs) } : props;
}

/** What a shape of one kind adds of its own: a path's place, a filter's region, a group's family. */
function ofKind(
  name: string,
  attrs: Readonly<Record<string, string>>,
  props: Record<string, unknown>,
): void {
  if (name === TEXT_PATH) Object.assign(props, along(attrs));
  if (name === 'filter') Object.assign(props, filterProps(attrs));
  if (name === 'foreignObject') Object.assign(props, areaOf(attrs));
  if (name === 'g' && attrs['font-family']) props['font'] = familyOf(attrs);
}

/** The area a `foreignObject` takes, all of the drawing where its markup does not say. */
const areaOf = (attrs: Readonly<Record<string, string>>): Record<string, string> => ({
  x: attrs['x'] ?? '0%',
  y: attrs['y'] ?? '0%',
  width: attrs['width'] ?? '100%',
  height: attrs['height'] ?? '100%',
});

/** The family a shape's `font-family` is drawn in, where it is not the system font's. */
function familyOf(attrs: Readonly<Record<string, string>>): Record<string, string> {
  const { family } = fontNamed(attrs['font-family']);
  return family ? { fontFamily: family } : {};
}

/** The path a text is set along, by its name, and how far along it the text starts. */
function along(attrs: Readonly<Record<string, string>>): Record<string, unknown> {
  const path = (attrs['href'] ?? attrs['xlink:href'] ?? '').replace(/^.*#/, '');
  const from = attrs['startOffset'];
  return { ...placed(attrs), href: path, ...(from == null ? {} : { startOffset: from }) };
}

/**
 * Take off a transform that has what is no number in it, which a script works out from a
 * measure it did not get: the native drawing places a layer by it, and stops the app on one.
 */
function placeable(props: Record<string, unknown>): void {
  const matrix = props['matrix'];
  if (Array.isArray(matrix) && !matrix.every(Number.isFinite)) delete props['matrix'];
}

/**
 * Where a text is drawn and how it is set against that place. Each position is a list, since
 * SVG places a glyph at a time.
 *
 * ponytail: its size and weight are a stylesheet's, which the native text does not read: it is
 * drawn at the size native starts a text at. Hand it the resolved font if a value is seen small.
 */
function placed(attrs: Readonly<Record<string, string>>): Record<string, unknown> {
  const at: Record<string, unknown> = {};
  for (const side of ['x', 'y', 'dx', 'dy']) if (attrs[side] != null) at[side] = [attrs[side]];
  const font: Record<string, string> = {};
  if (attrs['text-anchor']) font['textAnchor'] = attrs['text-anchor'];
  if (attrs['font-size']) font['fontSize'] = attrs['font-size'];
  if (attrs['font-weight']) font['fontWeight'] = attrs['font-weight'];
  Object.assign(font, familyOf(attrs));
  // What line of the words is at its place: the native text has one prop for the two.
  const baseline = baselineOf(attrs);
  if (baseline) at['alignmentBaseline'] = baseline;
  return { ...at, font };
}

/** The line of a text's words that is at its place: `middle`, where a word cloud says. */
export const baselineOf = (attrs: Readonly<Record<string, string>>): string | undefined =>
  attrs['alignment-baseline'] ?? attrs['dominant-baseline'];

const PAINTS = ['fill', 'stroke'];

/**
 * Whether a paint is written as a token, `fill="var(--ink)"`, or as a colour that may be made of
 * one: a mix, `color-mix(in srgb, var(--ink), white 20%)`, or a relative colour, `color(from
 * var(--ink) srgb r g b)`. The cascade settles each.
 */
export const isToken = (written: unknown): boolean =>
  typeof written === 'string' && /^\s*(var|color-mix)\(|^\s*[a-z]+\(\s*from\s/i.test(written);

/** Take a paint off a shape's own props: it is its style's to give, where a token is set. */
function notOwn(props: Record<string, unknown>, paint: string): void {
  delete props[paint];
  const own = (props['propList'] as string[] | undefined)?.filter((name) => name !== paint);
  if (own?.length) props['propList'] = own;
  else delete props['propList'];
}

/**
 * A paint that names a token is a declaration for the cascade, as a bound style's is: the shape
 * is that colour where the token is set, and what it inherits where it is not.
 */
function paintByToken(node: EngineNode, name: string, written: string | undefined, engine: Engine) {
  if (PAINTS.includes(name)) engine.setBoundStyle(node, name, isToken(written) ? written : null);
}

/** Whether a paint is a colour the engine could not read: a brush with nothing in it. */
function unread(brush: unknown): boolean {
  const colour = brush as { type?: number; payload?: unknown } | null | undefined;
  return colour?.type === 0 && colour.payload == null;
}

/**
 * A shape made by a script and not by a template: the element, with what the native view reads
 * of its attributes. What a canvas's context draws is made of these.
 */
export function shapeOf(
  engine: Engine,
  name: string,
  attrs: Readonly<Record<string, string>>,
): EngineNode {
  const node = engine.createElement(name === 'text' ? SVG_TEXT : name);
  wordsInSpans(node);
  const props = drawable(
    node.tag,
    attrs,
    nativeProps(node.tag, attrs, { color: (colour: string) => engine.color(colour) }),
  );
  // A script never reaches it to style it: what it is drawn by is all it was given.
  const given = { ...attrs };
  drawn.set(node, { attrs: given, written: given, props });
  for (const [key, value] of Object.entries(props)) engine.setProp(node, key, value);
  return node;
}

/**
 * A shape a canvas has put in its drawing, or drawn again: a long path is drawn thinned at the
 * scale it is drawn at, as one a template writes is. A canvas puts its shapes in itself, where
 * `svgInserted` does not hear of them.
 */
export function thinPlaced(node: EngineNode, engine: Engine): void {
  if (node.tag !== 'path') return;
  const d = attributesOf(node).props['d'];
  if (typeof d !== 'string' || d.length < LONG_PATH) return;
  const drawn = drawnPathData(node, d, READER, engine);
  if (drawn !== node.props['d']) engine.setProp(node, 'd', drawn);
}

/**
 * The same shape with other attributes: what the native view reads of them now, set where it
 * is another than it was. A canvas drawn again is mostly the shapes it was, each a little moved.
 */
export function reshape(
  engine: Engine,
  node: EngineNode,
  attrs: Readonly<Record<string, string>>,
): void {
  const shape = attributesOf(node);
  const props = drawable(
    node.tag,
    attrs,
    nativeProps(node.tag, attrs, { color: (colour: string) => engine.color(colour) }),
  );
  for (const key of Object.keys(shape.props)) {
    if (!(key in props)) engine.setProp(node, key, gone(key));
  }
  for (const [key, value] of Object.entries(props)) {
    if (!sameProp(shape.props[key], value)) engine.setProp(node, key, value);
  }
  shape.attrs = shape.written = { ...attrs };
  shape.props = props;
}

/**
 * What a prop taken off is set to. A transform is the identity: iOS only sets one of six numbers,
 * so for nothing it keeps the one it had.
 */
const gone = (key: string): unknown => (key === 'matrix' ? [1, 0, 0, 1, 0, 0] : null);

/** Whether a prop is what it was: the same value, or a list or a brush that says the same. */
const sameProp = (before: unknown, after: unknown): boolean =>
  before === after ||
  (typeof after === 'object' && JSON.stringify(before) === JSON.stringify(after));

/**
 * A gradient made by a script: where it runs, and the colours along it, which the native
 * gradient takes as one list. Given again, it is the same gradient with other colours.
 */
export function gradientShapeOf(
  engine: Engine,
  name: string,
  attrs: Readonly<Record<string, string>>,
  colours: readonly (readonly [at: number, colour: string])[],
  node = shapeOf(engine, name, attrs),
): EngineNode {
  const list = [...colours]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([at, colour]) => [Math.min(Math.max(at, 0), 1), engine.color(colour)]);
  if (!sameProp(node.props['gradient'], list)) engine.setProp(node, 'gradient', list);
  return node;
}

/** A text made the same way, with its words. */
export function textShapeOf(
  engine: Engine,
  attrs: Readonly<Record<string, string>>,
  words: string,
): EngineNode {
  const text = shapeOf(engine, 'text', attrs);
  engine.appendChild(text, engine.createText(words));
  return text;
}

/** What a paint set on a shape changes beside its own prop: its token, and its starting fill. */
function paintSet(node: EngineNode, name: string, written: string | undefined, engine: Engine) {
  paintByToken(node, name, written, engine);
  if (PAINTS.includes(name)) startFilled(node, engine);
}

/**
 * Give a shape written straight into a drawing the paint a drawing starts with, where it says
 * none of its own: `fill="none"` is one, and is no fill.
 */
function startFilled(node: EngineNode, engine: Engine): void {
  if (node.nodeKind !== 'element' || !Object.hasOwn(SHAPES, node.tag)) return;
  const paint = startingPaint(node);
  const had = node.defaultStyle;
  if (
    had === paint ||
    (had && paint && had['fill'] === paint['fill'] && had['stroke'] === paint['stroke'])
  )
    return;
  engine.setDefaultStyle(node, paint);
}

/**
 * What a shape is drawn by: the attributes a template or a script gave it, and the styles a
 * script set as them. None for what is no shape.
 */
export const shapeAttributes = (node: EngineNode): Readonly<Record<string, string>> =>
  drawn.get(node)?.attrs ?? NO_ATTRIBUTES;

/** A shape's attributes alone, without the styles set as them: what `getAttribute` reads. */
export const writtenAttributes = (node: EngineNode): Readonly<Record<string, string>> =>
  drawn.get(node)?.written ?? NO_ATTRIBUTES;

function setOrTake(values: Record<string, string>, name: string, value: unknown): void {
  if (value == null) delete values[name];
  else values[name] = String(value);
}
const NO_ATTRIBUTES: Readonly<Record<string, string>> = {};

/** Whether a node is one of a drawing's own: a shape, a text or a span of one. */
export const isShape = (node: EngineNode): boolean =>
  node.nodeKind === 'element' && (node.tag === SVG_SPAN || Object.hasOwn(SHAPES, node.tag));

/** Register the SVG elements, and answer what takes them away again. */
export function registerSvg(): () => void {
  const root = nativePlatform() === 'android' ? 'RNSVGSvgViewAndroid' : 'RNSVGSvgView';
  const undo = [
    registerViewName('svg', root),
    ...Object.entries(SHAPES)
      .filter(([name]) => !WORDED.includes(name))
      .map(([name, view]) => registerViewName(name, view)),
    // What a span holds is what it draws, said to the view as a prop.
    registerViewName(SVG_SPAN, 'RNSVGTSpan', undefined, {
      textContent: 'content',
      spacedText: true,
    }),
    registerViewName(SVG_UNDRAWN, 'View'),
    ...Object.entries(STEP_VIEWS).map(([name, view]) => registerViewName(name, view)),
    registerViewName(LINE, 'RNSVGTSpan'),
  ];
  worded = registerWorded();
  return () => {
    undo.forEach((each) => each());
    worded.forEach((each) => each());
    worded = [];
  };
}

/** The registrations of the elements whose words a span draws, while the package is in. */
let worded: (() => void)[] = [];

/**
 * A text's own words are drawn by a span the engine keeps for them: the native text draws nothing
 * itself, and what a script or a template put in it stays as it was put.
 */
const registerWorded = (): (() => void)[] =>
  WORDED.map((name) => registerViewName(name, SHAPES[name]!, undefined, { looseText: SVG_SPAN }));

/**
 * Say again, as a text is made, that its words are drawn by a span. What a native view's loose
 * words are drawn by is the view's, and the last registration of any element that names it says:
 * `@ng-native/icons` names the native text for its own and says nothing of it, the first time an
 * icon is drawn, which may be while this package is in.
 */
export function wordsInSpans(node: EngineNode): void {
  if (!worded.length || !WORDED.includes(node.tag)) return;
  worded.forEach((each) => each());
  worded = registerWorded();
}

/** What is left to the renderer on a shape: what a selector or a test reads, not a shape's own. */
const KEPT = /^(class|style|id|testID|nativeID|hidden|role|aria-.*|data-.*)$/;

/** Whether an attribute of a shape is kept as its prop, as any element's is: see `KEPT`. */
export const isKeptOnShape = (name: string): boolean => KEPT.test(name) && name !== 'id';

interface Drawn {
  /** What the shape is drawn by: its attributes, and the styles a script set as them. */
  attrs: Record<string, string>;
  /** Its attributes alone, as a script reads them and a selector matches them. */
  written: Record<string, string>;
  /** The props the attributes were last set as, to clear the ones that have gone. */
  props: Record<string, unknown>;
}
const drawn = new WeakMap<EngineNode, Drawn>();

/**
 * Take an attribute of an `<svg>` or of a shape in one, and set what the native view reads for
 * all it has. Answers whether it was one. An attribute is handed to the engine as well, for a
 * selector to match, where a style set as one is not: `styled` says it is a style.
 */
export function setSvg(
  node: EngineNode,
  name: string,
  value: unknown,
  engine: Engine,
  styled = false,
): boolean {
  if (node.tag === 'stop') return stopChanged(node, engine);
  const drawn = node.tag === 'svg' || node.tag === SVG_SPAN || Object.hasOwn(SHAPES, node.tag);
  return drawn && setShape(node, name, value, engine, styled);
}

/**
 * Give a copy of a shape, or of an `<svg>`, the attributes it was given, and the styles a script
 * set as them as styles still: see `cloneNode`.
 */
export function copyShape(from: EngineNode, to: EngineNode, engine: Engine): void {
  const written = writtenAttributes(from);
  for (const [name, value] of Object.entries(written)) setSvg(to, name, value, engine);
  for (const [name, value] of Object.entries(shapeAttributes(from))) {
    if (written[name] !== value) setSvg(to, name, value, engine, true);
  }
}

function setShape(
  node: EngineNode,
  name: string,
  value: unknown,
  engine: Engine,
  styled: boolean,
): boolean {
  const root = node.tag === 'svg';
  // An `id` is the renderer's, and the name of what a definition is referred to by as well.
  const kept = KEPT.test(name);
  if (kept && name !== 'id') return false;
  const shape = attributesOf(node);
  setOrTake(shape.attrs, name, value);
  const written = shape.attrs[name];
  if (!styled) {
    setOrTake(shape.written, name, value);
    engine.keepAttribute(node, name, written);
  }
  if (root) {
    // Its own size is a default, as a browser has an attribute under any rule of a stylesheet.
    const props = drawAgain(node, engine);
    engine.setDefaultStyle(node, { ...proportioned(props), ...sizeOf(shape.attrs) });
    if (name === 'fill' || name === 'stroke') {
      for (const child of node.childList) startFilled(child, engine);
    }
    redrawLongPathsUnder(node, engine, (path) => drawLater(path, engine));
  } else {
    drawLater(node, engine);
    paintSet(node, name, written, engine);
  }
  partChanged(node, engine);
  return !kept;
}

/**
 * The shapes whose attributes were set since they were last drawn, in each app. A script sets a
 * shape's attributes one at a time, Highcharts seven of them for a point, and each would draw it
 * again from all of them: it is drawn once, as the script that set them ends, or before the
 * commit or anything else reads what it was drawn as.
 */
const undrawn = new Map<Engine, Set<EngineNode>>();

function drawLater(node: EngineNode, engine: Engine): void {
  let nodes = undrawn.get(engine);
  if (!nodes) {
    undrawn.set(engine, (nodes = new Set()));
    const draw = () => drawUndrawn(engine);
    engine.settle({ settleProps: draw });
    queueMicrotask(draw);
  }
  nodes.add(node);
}

/** Draw every shape of an app set since it was last drawn: see `undrawn`. */
function drawUndrawn(engine: Engine): void {
  const nodes = undrawn.get(engine);
  if (!nodes) return;
  undrawn.delete(engine);
  for (const node of nodes) {
    const matrix = attributesOf(node).props['matrix'];
    drawAgain(node, engine);
    // A group scaled anew draws the long paths in it across other columns.
    if (node.tag === 'g' && !sameProp(matrix, attributesOf(node).props['matrix'])) {
      redrawLongPathsUnder(node, engine, (path) => drawAgain(path, engine));
    }
  }
}

/** What drawing a long path reads of the shapes it is in. */
const READER: DrawingReader = {
  props: (node) => attributesOf(node).props,
  attrs: (node) => attributesOf(node).attrs,
};

/** A path a text is set along gives the text its anchor, and a span of a copy its outline. */
function partChanged(node: EngineNode, engine: Engine): void {
  const text = partsIn.get(node);
  const part =
    node.tag === TEXT_PATH || isCopyUnder(node) || (node.parent && isCopyUnder(node.parent));
  if (part && text && drawn.has(text)) drawAgain(text, engine);
}

/** What the native view reads of a shape's attributes as they are. */
function propsOf(node: EngineNode, engine: Engine): Record<string, unknown> {
  const attrs = attributesOf(node).attrs;
  if (node.tag === 'svg') return viewBox(attrs['viewBox']);
  if (node.tag === 'feDropShadow') return shadowProps(attrs);
  const color = (colour: string) => engine.color(sideFor(node, colour, engine));
  const props = drawable(node.tag, attrs, nativeProps(node.tag, attrs, { color }));
  // A long line is drawn thinned; what a script reads of it is as written.
  if (node.tag === 'path' && typeof props['d'] === 'string') {
    props['d'] = drawnPathData(node, props['d'], READER, engine);
  }
  return props;
}

/**
 * The shapes in each app a `light-dark()` paints, drawn again as its colour scheme changes, and
 * the scheme they were drawn in.
 *
 * ponytail: a shape taken out of its drawing is kept here for as long as its app is. Hold them
 * weakly if an app that draws and drops many such shapes is seen to.
 */
const schemed = new WeakMap<Engine, { nodes: Set<EngineNode>; dark: boolean }>();

/** A colour as the side of a `light-dark()` for the app's scheme, which light is before any. */
function sideFor(node: EngineNode, colour: string, engine: Engine): string {
  const inside = /^\s*light-dark\((.*)\)\s*$/is.exec(colour)?.[1];
  if (inside === undefined) return colour;
  const dark = engine.conditions?.colorScheme === 'dark';
  let painted = schemed.get(engine);
  if (!painted) {
    schemed.set(engine, (painted = { nodes: new Set(), dark }));
    engine.watchViewport(() => schemeChanged(engine));
  }
  painted.nodes.add(node);
  let depth = 0;
  for (let at = 0; at < inside.length; at++) {
    const char = inside[at];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      const side = dark ? inside.slice(at + 1) : inside.slice(0, at);
      return sideFor(node, side.trim(), engine);
    }
  }
  return colour;
}

/** Draw again what a `light-dark()` paints, where the app's scheme is another than it was. */
function schemeChanged(engine: Engine): void {
  const painted = schemed.get(engine)!;
  const dark = engine.conditions?.colorScheme === 'dark';
  if (dark === painted.dark) return;
  painted.dark = dark;
  for (const node of painted.nodes) if (drawn.has(node)) drawAgain(node, engine);
}

/** A copy under a text's words starts over at the text's place: see `outlined`. */
function startsOver(copy: EngineNode, props: Record<string, unknown>): void {
  if (copy.parent?.tag !== SVG_TEXT) return;
  const x = attributesOf(copy.parent).props['x'] as unknown[] | undefined;
  props['x'] = [x?.[0] ?? '0'];
}

/** Set what the native view reads of a shape's attributes as they are, and answer it. */
function drawAgain(node: EngineNode, engine: Engine): Record<string, unknown> {
  const shape = attributesOf(node);
  const props = propsOf(node, engine);
  let copy: EngineNode | undefined;
  if (node.tag === SVG_TEXT) {
    anchoredAlong(node, props);
    copy = outlined(node, props, engine);
    if (!copy) linesAnchored(node, props);
  }
  if (node.tag === SVG_SPAN && isCopyUnder(node)) startsOver(node, props);
  for (const key of Object.keys(shape.props)) {
    if (!(key in props)) engine.setProp(node, key, gone(key));
  }
  for (const [key, set] of Object.entries(props)) engine.setProp(node, key, set);
  shape.props = props;
  if (node.tag === 'feDropShadow') {
    // Its steps go with it: see `hearRemovals`.
    hearRemovals(engine);
    shadowDrawn(node, shape.attrs, engine);
  }
  // Its outline starts where it does, which is read from the props just set.
  if (copy && drawn.has(copy)) drawAgain(copy, engine);
  return props;
}

/** The text each path, span or copy is a part of, to be drawn again when it leaves it. */
const partsIn = new WeakMap<EngineNode, EngineNode>();

/**
 * A text set along a path is anchored as the path says, where it says nothing itself. SVG reads
 * `text-anchor` on a `<textPath>` for the words in it; the native path passes its font over,
 * and the native text sets its words against their place by its own.
 */
function anchoredAlong(text: EngineNode, props: Record<string, unknown>): void {
  const font = props['font'] as Record<string, unknown> | undefined;
  if (font?.['textAnchor']) return;
  const path = text.childList.find((child) => child.tag === TEXT_PATH);
  const anchor = path && shapeAttributes(path)['text-anchor'];
  if (anchor) props['font'] = { ...font, textAnchor: anchor };
}

/**
 * Draw a copy of a text's words, stroked under them, as their outline: how Highcharts makes a
 * label stand out from what it is on. Native draws a span's own words and nothing in it, so the
 * span that ends the copy and puts the place back where the text starts is not drawn; and it
 * sets each span against the text's place by the width of all of them. So the copy starts over
 * at the text's place, a part of its own, and the words are moved back by as much of the copy
 * as was counted against them, in the text's own `dx` after the copy's letters. Along a path
 * the copy and the words are one run, set against the path as one: the copy is moved on by as
 * much of itself as the run was moved back for it, and the words back by all of it. A copy of
 * more than one line is not drawn.
 *
 * ponytail: a text with a `dx` of more than one letter keeps it, and its outline is drawn where
 * the words were, a copy's width away. Fold the two together if a label is seen with one.
 */
function outlined(
  text: EngineNode,
  props: Record<string, unknown>,
  engine: Engine,
): EngineNode | undefined {
  const path = text.childList.find((child) => child.tag === TEXT_PATH);
  const copy = (path ?? text).childList.find(isCopyUnder);
  const words = copy && oneLine(copy);
  unlinedBut(text, words === undefined ? copy : undefined, engine);
  if (copy && words === undefined && !path && inLines(text, copy, props, engine)) return copy;
  if (copy) engine.setDefaultStyle(copy, words === undefined ? UNDRAWN : undefined);
  return words !== undefined && setBack(text, path, words, props) ? copy : undefined;
}

/** How much of a run of words native sets back from its place: half on its middle, all at its end. */
const setBackShare = (anchor: string | undefined): number =>
  anchor === 'middle' ? 0.5 : anchor === 'end' ? 1 : 0;

/** Move a text's words back over the copy of them before them: see `outlined`. */
function setBack(
  text: EngineNode,
  path: EngineNode | undefined,
  words: string,
  props: Record<string, unknown>,
): boolean {
  const own = props['dx'] as unknown[] | undefined;
  const first = Number(own?.[0] ?? 0);
  if ((own && own.length > 1) || !Number.isFinite(first)) return false;
  const width = widthOf(words, fontSizeOf(text), fontWeightOf(text), fontFamilyOf(text));
  const anchor =
    (path && shapeAttributes(path)['text-anchor']) ?? attributesOf(text).attrs['text-anchor'];
  const share = setBackShare(anchor);
  // The text's own first `dx`, as Highcharts writes `dx="0"`, moves its first letter still.
  const on = path ? width * share : 0;
  const moved = Array.from({ length: words.length }, (_, at) => (at ? 0 : first + on));
  props['dx'] = [...moved, -width * (path ? 1 : 1 - share)];
  return true;
}

/** The copy of more than one line each text is outlined by, and the span kept for its first. */
const linedIn = new WeakMap<EngineNode, EngineNode>();
const firstLines = new WeakMap<EngineNode, EngineNode>();
const LINE = `${KEPT_NODE}line`;

/** A run of spaces as the one native keeps of it. */
const spaced = (words: string): string => words.replace(/[ \t\n\r\f]+/g, ' ');

/**
 * Draw a copy of a text of more than one line as its outline, a line at a time. Native draws a
 * span's own words or the spans in it, never both: the copy draws the spans in it, its first line
 * in a span the engine keeps for it, set from the text's place, and each line after in the span
 * that breaks to it, each from a place of its own and so set on it by its own width. The words
 * after the copy are set against the text's place by the width of both, so each of their lines is
 * moved on by as much as the others moved it back. Answers whether it was drawn so: not a copy
 * with more in a line than words, as a bold word in a span.
 */
function inLines(
  text: EngineNode,
  copy: EngineNode,
  props: Record<string, unknown>,
  engine: Engine,
): boolean {
  const lines = copyLines(copy);
  if (!lines) return false;
  const letters = drawLines(text, copy, lines, engine);
  // The words after the copy, each line moved on from the copy's letters.
  const starts = lineStarts(text);
  shiftLines(text, props, letters, 2 * starts.reduce((sum, line) => sum + line.width, 0));
  return true;
}

/** The lines of a copy, each the span that breaks to it and its words: none for more in a line. */
function copyLines(copy: EngineNode): { words: string; head?: EngineNode }[] | undefined {
  const lines: { words: string; head?: EngineNode }[] = [{ words: '' }];
  for (const part of copy.childList.slice(0, -1)) {
    if (part.nodeKind === 'text') lines[lines.length - 1]!.words += part.nodeText;
    else if (
      part.nodeKind !== 'element' ||
      part.childList.some((each) => each.nodeKind !== 'text')
    ) {
      return undefined;
    } else lines.push({ words: wordsIn(part), head: part });
  }
  return lines;
}

/** Draw a copy's lines in the spans in it, and answer how many letters native draws of it. */
function drawLines(
  text: EngineNode,
  copy: EngineNode,
  lines: readonly { words: string; head?: EngineNode }[],
  engine: Engine,
): number {
  engine.setDefaultStyle(copy, undefined);
  // No words of its own, which native reads as none: it draws the spans in it.
  engine.setProp(copy, 'content', '');
  let first = firstLines.get(copy);
  if (!first) firstLines.set(copy, (first = engine.createElement(LINE)));
  if (first.parent !== copy) engine.insertBefore(copy, first, copy.childList[0] ?? null);
  engine.setProp(first, 'content', spaced(lines[0]!.words));
  engine.setProp(first, 'x', [attributesOf(text).attrs['x'] ?? '0']);
  for (const { words, head } of lines) if (head) engine.setProp(head, 'content', spaced(words));
  linedIn.set(text, copy);
  const back = wordsIn(copy.childList.at(-1)!).length;
  return lines.reduce((sum, { words }) => sum + spaced(words).length, back);
}

/** Stop drawing a line at a time the copy a text was, unless it is the one it still is. */
function unlinedBut(text: EngineNode, copy: EngineNode | undefined, engine: Engine): void {
  const lined = linedIn.get(text);
  if (lined && lined !== copy) unlined(text, lined, engine);
}

/** A copy no longer drawn a line at a time: its spans draw their own words again. */
function unlined(text: EngineNode, copy: EngineNode, engine: Engine): void {
  linedIn.delete(text);
  const first = firstLines.get(copy);
  if (first?.parent) engine.removeChild(first.parent, first);
  engine.setProp(copy, 'content', undefined);
  for (const part of copy.childList) {
    if (part.nodeKind === 'element' && part !== first) engine.setProp(part, 'content', undefined);
  }
}

/**
 * Set each line of a text of more than one, on its middle or its end, by its own width, as a
 * browser sets each run of words from a place of its own. Native sets every line against the
 * text's place by the width of all of them, so each is moved on, in the text's own `dx` at the
 * letter it starts with, by as much as the other lines moved it back.
 */
function linesAnchored(text: EngineNode, props: Record<string, unknown>): void {
  const starts = lineStarts(text);
  if (starts.length < 2) return;
  shiftLines(
    text,
    props,
    0,
    starts.reduce((sum, line) => sum + line.width, 0),
  );
}

/**
 * Move each line of a text's words on, in its `dx` at the letter it starts with after `letters`
 * drawn before them, by as much as native set it back for the rest of the `all` it measured.
 */
function shiftLines(
  text: EngineNode,
  props: Record<string, unknown>,
  letters: number,
  all: number,
): void {
  const share = setBackShare(attributesOf(text).attrs['text-anchor']);
  const starts = lineStarts(text);
  if (!share || !starts.length) return;
  const own = (props['dx'] as unknown[] | undefined) ?? [];
  const length = letters + starts.at(-1)!.at + 1;
  const dx = Array.from({ length }, (_, at) => Number(own[at] ?? 0) || 0);
  for (const { at, width } of starts) dx[letters + at]! += (all - width) * share;
  props['dx'] = [...dx, ...own.slice(dx.length)];
}

/**
 * The words of a copy that is one line, the span that ends it aside: a span in it that starts a
 * line of its own makes it more, and undefined.
 */
function oneLine(copy: EngineNode): string | undefined {
  const parts = copy.childList.slice(0, -1);
  const starts = (node: EngineNode): boolean =>
    node.nodeKind === 'element' &&
    (shapeAttributes(node)['x'] != null ||
      shapeAttributes(node)['dy'] != null ||
      node.childList.some(starts));
  return parts.some(starts) ? undefined : parts.map(wordsIn).join('');
}

const wordsIn = (node: EngineNode): string =>
  node.nodeKind === 'text' ? node.nodeText : node.childList.map(wordsIn).join('');

/** A path or a span put in a text, or taken out of one: the text is drawn again. */
function partMoved(part: EngineNode, text: EngineNode | undefined, engine: Engine): void {
  const was = partsIn.get(part);
  if (text) {
    partsIn.set(part, text);
    hearRemovals(engine);
  } else partsIn.delete(part);
  for (const each of new Set([was, text])) if (each && drawn.has(each)) drawAgain(each, engine);
}

/**
 * The engines told of a part taken out of its text, or of words of one changed. A script does
 * both through the engine, which tells the renderer's listeners nothing, so they are heard
 * there, as a mutation observer hears them.
 */
const hearing = new WeakSet<Engine>();
function hearRemovals(engine: Engine): void {
  if (hearing.has(engine)) return;
  hearing.add(engine);
  const { removeChild, setText } = engine;
  engine.removeChild = function (parent, child) {
    const from = parent ?? child.parent;
    removeChild.call(this, parent, child);
    if (child.parent) return;
    shadowRemoved(child, engine);
    if (partsIn.has(child)) return partMoved(child, undefined, engine);
    // Words taken out of a part, put in it before it was one: the text is drawn without them.
    const text = from && (partsIn.get(from) ?? textOver(child, from));
    if (text && drawn.has(text)) drawAgain(text, engine);
  };
  engine.setText = function (node, value) {
    setText.call(this, node, value);
    const text = node.parent && partsIn.get(node.parent);
    if (text && drawn.has(text)) drawAgain(text, engine);
  };
}

/**
 * The view box an `<svg>` is given. One with no width or no height is left out: native divides
 * by them, and places every shape in the drawing at no number at all.
 *
 * ponytail: a browser draws nothing under such a view box; here the drawing is as with none.
 */
function viewBox(written: string | undefined): Record<string, unknown> {
  const props = viewBoxProps(written);
  return Number(props['vbWidth']) > 0 && Number(props['vbHeight']) > 0 ? props : {};
}

function attributesOf(node: EngineNode): Drawn {
  let shape = drawn.get(node);
  if (!shape) drawn.set(node, (shape = { attrs: {}, written: {}, props: {} }));
  return shape;
}

/**
 * What an `<svg>` is sized as with nothing said: as wide as what holds it, and as tall as its
 * view box makes that, which is how a browser sizes one with a view box and no width or height.
 * A stylesheet's own size, or the element's, is over this.
 */
function proportioned(viewBox: Record<string, unknown>): Record<string, unknown> | undefined {
  const [width, height] = [Number(viewBox['vbWidth']), Number(viewBox['vbHeight'])];
  return width > 0 && height > 0 ? { width: '100%', aspectRatio: width / height } : undefined;
}

/** `width="24"` on an `<svg>`: the size of its view, where no stylesheet gives it one. */
function sizeOf(attrs: Readonly<Record<string, string>>): Record<string, unknown> {
  const size: Record<string, unknown> = {};
  for (const side of ['width', 'height']) {
    const points = Number.parseFloat(attrs[side] ?? '');
    if (!Number.isNaN(points)) size[side] = points;
  }
  return size;
}
