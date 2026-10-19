import type { EngineNode } from '@ng-native/fabric';
import type { Engine } from '@ng-native/fabric';
import { fontNamed, textWidth } from './text-width.ts';
import { baselineOf, isCopyUnder, isShape, isToken, setSvg, shapeAttributes } from './svg.ts';

/**
 * How large a shape in a drawing is, for a library that builds a chart from script: it lays a
 * label out by the box a text says it has, and a legend by the box of the group it is in. A
 * browser answers from what it has drawn. Nothing is drawn here until the script is done, so
 * the answer is worked out from what the shape was given.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const NOTHING: Box = { x: 0, y: 0, width: 0, height: 0 };
/** The font size a page starts at, which a size in `em` or `rem` is a share of. */
const ROOT_FONT = 16;

/** How wide a text is drawn at a size, a weight and in a family: see `text-width.ts`. */
export const widthOf = (
  text: string,
  size: number,
  weight?: number | string,
  family?: string,
): number => textWidth(text, size, weight, fontNamed(family).metrics);

/** A length a style or an attribute gives, in points: a share of the font it is written in. */
function lengthOf(written: unknown, font: number): number | undefined {
  if (typeof written === 'number') return written;
  const number = Number.parseFloat(String(written));
  if (Number.isNaN(number)) return undefined;
  const text = String(written).trim();
  if (text.endsWith('rem')) return number * ROOT_FONT;
  if (text.endsWith('em')) return number * font;
  return text.endsWith('%') ? (number / 100) * font : number;
}

/**
 * The font size a node's text is drawn at: its own, or the nearest one above it, each a share
 * of the one above where it is written in `em`.
 */
export function fontSizeOf(node: EngineNode | null): number {
  if (!node) return ROOT_FONT;
  const own =
    shapeAttributes(node)['font-size'] ??
    (node.props['style'] as Record<string, unknown> | undefined)?.['fontSize'];
  if (own == null) return fontSizeOf(node.parent);
  // A size already in points is asked of nothing above it.
  const points = /^[\d.]+(px)?$/.test(String(own).trim());
  return lengthOf(own, points ? ROOT_FONT : fontSizeOf(node.parent)) ?? ROOT_FONT;
}

/** The weight a node's text is drawn in: its own, or the nearest one above it. */
export function fontWeightOf(node: EngineNode | null): string {
  if (!node) return '400';
  const own =
    shapeAttributes(node)['font-weight'] ??
    (node.props['style'] as Record<string, unknown> | undefined)?.['fontWeight'];
  return own == null || own === 'inherit' ? fontWeightOf(node.parent) : String(own);
}

/** The font stack a node's text is drawn in: its own, or the nearest one above it. */
export function fontFamilyOf(node: EngineNode | null): string | undefined {
  if (!node) return undefined;
  const own =
    shapeAttributes(node)['font-family'] ??
    (node.props['style'] as Record<string, unknown> | undefined)?.['fontFamily'];
  return own == null || own === 'inherit' ? fontFamilyOf(node.parent) : String(own);
}

/** Words of a text and the node whose font they are drawn in: the span they are in, or the text. */
interface Run {
  readonly words: string;
  readonly font: EngineNode;
}

const runsOf = (node: EngineNode, font: EngineNode): Run[] =>
  node.nodeKind === 'text'
    ? [{ words: node.nodeText, font }]
    : node.childList.flatMap((child) => runsOf(child, node));

/** A line of a text: its words, each in its own font, and how far under the one before it is. */
interface Line {
  readonly runs: Run[];
  readonly down: number;
}

/**
 * The lines a text is drawn in: one for each span that starts a new one, and its own. A copy of
 * the words drawn under them is drawn over by them, and adds nothing.
 */
function linesOf(text: EngineNode): Line[] {
  const lines: { runs: Run[]; down: number }[] = [];
  for (const child of text.childList) {
    if (isCopyUnder(child)) continue;
    const runs = runsOf(child, text);
    const attrs = child.nodeKind === 'element' ? shapeAttributes(child) : {};
    const starts = !lines.length || attrs['x'] != null || attrs['dy'] != null;
    if (starts)
      lines.push({ runs, down: lines.length ? Number.parseFloat(attrs['dy'] ?? '0') || 0 : 0 });
    else lines[lines.length - 1]!.runs.push(...runs);
  }
  return lines;
}

/** How wide a line is drawn: each of its words in the font of the span they are in. */
const lineWidth = (line: Line): number =>
  line.runs.reduce(
    (width, { words, font }) =>
      width + widthOf(words, fontSizeOf(font), fontWeightOf(font), fontFamilyOf(font)),
    0,
  );

/**
 * Where each line of a text starts among the letters native draws, and how wide it is: the
 * letters before it, a run of spaces as the one native keeps of it.
 */
export function lineStarts(text: EngineNode): { at: number; width: number }[] {
  let at = 0;
  return linesOf(text).map((line) => {
    const start = at;
    for (const run of line.runs) at += run.words.replace(/[ \t\n\r\f]+/g, ' ').length;
    return { at: start, width: lineWidth(line) };
  });
}

/** The largest font of a line's words, which its reach over and under its baseline is of. */
const lineSize = (line: Line | undefined, text: EngineNode): number => {
  const fonts = line?.runs.filter((run) => run.words).map((run) => fontSizeOf(run.font)) ?? [];
  return fonts.length ? Math.max(...fonts) : fontSizeOf(text);
};

function textBox(node: EngineNode): Box {
  const attrs = shapeAttributes(node);
  const lines = linesOf(node);
  const width = Math.max(0, ...lines.map(lineWidth));
  const anchor = attrs['text-anchor'];
  const shift = anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0;
  const number = (key: string) => Number.parseFloat(attrs[key] ?? '0') || 0;
  const font = fontNamed(fontFamilyOf(node)).metrics;
  // In whole pixels, as a browser has a line's reach over and under its baseline.
  const [first, last] = [lineSize(lines[0], node), lineSize(lines.at(-1), node)];
  const ascent = Math.round(font.ascent * first);
  const descent = Math.round(font.descent * last);
  // From the top of the first line to the foot of the last, each set under the one before.
  const down = lines.slice(1).reduce((sum, line) => sum + line.down, 0);
  const height = lines.length ? ascent + down + descent : 0;
  // Set on its middle, the text's place is that far under the top of its first line.
  const middle = /^(middle|central)$/.test(baselineOf(attrs) ?? '');
  return {
    x: number('x') - shift,
    y: number('y') - (middle ? ascent - font.middle * first : ascent),
    width,
    height,
  };
}

/** The box of the points a path is drawn through: every pair of numbers in it. */
function pathBox(d: string): Box {
  const numbers = numbersIn(d);
  const [xs, ys] = [numbers.filter((_, at) => at % 2 === 0), numbers.filter((_, at) => at % 2)];
  if (!xs.length || !ys.length) return NOTHING;
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

const numbersIn = (written: string | undefined): number[] =>
  (written?.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);

/** A box as it is under the transform its shape is given: moved, and scaled where it is. */
export function moved(box: Box, transform: string | undefined): Box {
  if (!transform) return box;
  const part = (name: string) => numbersIn(new RegExp(`${name}\\(([^)]*)\\)`).exec(transform)?.[1]);
  const matrix = part('matrix');
  const [moveX = matrix[4] ?? 0, moveY = matrix[5] ?? 0] = part('translate');
  const [scaleX = matrix[0] ?? 1, scaleY = matrix[3] ?? scaleX] = part('scale');
  return {
    x: box.x * scaleX + moveX,
    y: box.y * scaleY + moveY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

function around(boxes: Box[]): Box {
  const drawn = boxes.filter((box) => box.width > 0 || box.height > 0);
  if (!drawn.length) return NOTHING;
  const left = Math.min(...drawn.map((box) => box.x));
  const top = Math.min(...drawn.map((box) => box.y));
  return {
    x: left,
    y: top,
    width: Math.max(...drawn.map((box) => box.x + box.width)) - left,
    height: Math.max(...drawn.map((box) => box.y + box.height)) - top,
  };
}

const SIMPLE: Readonly<Record<string, (number: (key: string) => number) => Box>> = {
  rect: (n) => ({ x: n('x'), y: n('y'), width: n('width'), height: n('height') }),
  circle: (n) => ({
    x: n('cx') - n('r'),
    y: n('cy') - n('r'),
    width: 2 * n('r'),
    height: 2 * n('r'),
  }),
  ellipse: (n) => ({
    x: n('cx') - n('rx'),
    y: n('cy') - n('ry'),
    width: 2 * n('rx'),
    height: 2 * n('ry'),
  }),
  line: (n) => ({
    x: Math.min(n('x1'), n('x2')),
    y: Math.min(n('y1'), n('y2')),
    width: Math.abs(n('x2') - n('x1')),
    height: Math.abs(n('y2') - n('y1')),
  }),
};

/**
 * `getBBox()`: the box a shape takes up, where it draws itself, before any transform of its
 * own. A group's is the box around what is in it, each where its own transform puts it.
 *
 * ponytail: a rotation or a skew is not followed, and a path's box is that of its points, a
 * curve's handles among them. A library that turns a label works out the turned box itself.
 */
export function boxOf(node: EngineNode): Box {
  if (node.nodeKind !== 'element') return NOTHING;
  const attrs = shapeAttributes(node);
  if (node.tag === 'svg:text') return textBox(node);
  if (node.tag === 'path') return pathBox(attrs['d'] ?? '');
  const simple = SIMPLE[node.tag];
  if (simple) return simple((key) => Number.parseFloat(attrs[key] ?? '0') || 0);
  return around(
    node.childList
      .filter((child) => child.nodeKind === 'element')
      .map((child) => moved(boxOf(child), shapeAttributes(child)['transform'])),
  );
}

/** What a script styles a shape with that is an attribute of it: its paint, its line, its font. */
const STYLED = new Set([
  ...['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray'],
  ...['stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-weight', 'text-anchor'],
  'font-family',
]);

/**
 * A style a script sets on a shape: `text.style.fontSize`, `path.style.fill`. In a drawing
 * these are the shape's own, which the native shape reads as it does the attribute of the same
 * name, so each is set as that. A font size is set in points, worked out from the size around
 * it where it is written as a share of one. Answers whether the style was one of these.
 */
export function styleShape(
  node: EngineNode,
  name: string,
  value: unknown,
  engine: Engine,
): boolean {
  if (!isShape(node)) return false;
  const attr = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  // A text is painted with its fill, which a library sets as the colour it is to be read in.
  if (attr === 'color' && node.tag === 'svg:text') setSvg(node, 'fill', value, engine);
  if (!STYLED.has(attr)) return false;
  if (attr === 'font-size') {
    if (/(^|[^r])em$|%$/.test(String(value).trim())) shares.set(node, value);
    else shares.delete(node);
    sizeFont(node, value, engine);
    for (const child of node.childList) sizeFontsUnder(child, engine);
    return true;
  }
  // A length in pixels is the number an attribute has: `stroke-dasharray: 126px`.
  const plain = typeof value === 'string' && /^-?[\d.]+px$/.test(value) ? parseFloat(value) : value;
  setSvg(node, attr, plain, engine);
  handDown(node, attr, plain, engine);
  return true;
}

/** A shape's font size written as a share of the one around it, as Highcharts writes `0.7em`. */
const shares = new WeakMap<EngineNode, unknown>();

/** Set a shape's font size in points, worked out from the size around it now. */
function sizeFont(node: EngineNode, written: unknown, engine: Engine): void {
  const points = lengthOf(written, fontSizeOf(node.parent));
  setSvg(node, 'font-size', points ?? written, engine);
  inherited(node, 'fontSize', points, engine);
}

/**
 * Work out again each font size written as a share in a shape and what is in it, as it is put
 * somewhere or the size around it changes: a label styled before it is put in its group is a
 * share of the group's size, as in a browser, which works it out where it is drawn.
 */
export function sizeFontsUnder(node: EngineNode, engine: Engine): void {
  if (node.nodeKind !== 'element') return;
  const written = shares.get(node);
  if (written !== undefined) sizeFont(node, written, engine);
  for (const child of node.childList) sizeFontsUnder(child, engine);
}

/** Hand a paint down as the node's style. A token the cascade hands down, settled. */
function handDown(node: EngineNode, attr: string, value: unknown, engine: Engine): void {
  const handed = HANDED_DOWN[attr];
  if (handed) inherited(node, handed, isToken(value) ? undefined : (value ?? undefined), engine);
}

/**
 * What a shape's style hands down that its attribute does not: the cascade gives a shape inside
 * it, a text's span among them, what a rule above gives, where the style was the shape's own.
 */
const HANDED_DOWN: Readonly<Record<string, string>> = {
  fill: 'fill',
  stroke: 'stroke',
  'stroke-width': 'strokeWidth',
};

/**
 * A style of a shape that is the node's style as well: a font size in points, by which the
 * native text and its spans are sized, and a paint, which the spans of a text are drawn with.
 * The cascade gives each to what is in the shape, over what a rule above it gives.
 */
function inherited(node: EngineNode, key: string, value: unknown, engine: Engine): void {
  const { [key]: _had, ...style } = (node.props['style'] ?? {}) as Record<string, unknown>;
  engine.setProp(node, 'style', value == null ? style : { ...style, [key]: value });
}
