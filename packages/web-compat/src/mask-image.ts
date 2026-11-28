import type { Engine, EngineNode, MaskAxis, MaskDrawer, MaskStyle } from '@ng-native/fabric';
import { serializeOuter, type DefaultTreeAdapterMap } from 'parse5';
import { styled } from './geometry.ts';
import { setMarkup } from './html.ts';
import { drawingIn } from './image.ts';
import { commitLater } from './commit-later.ts';
import { keptOwn } from './in-document.ts';
import { parseUrl } from './parse-url.ts';
import { engineOf } from './window.ts';
import { wellFormed } from '@ng-native/icons';

/**
 * A box's mask of one SVG, drawn as that SVG in the colour the box would paint: how a UI library
 * draws an icon, a box painted `currentColor` and cut to the icon's shape. Taiga UI does it with
 * `mask-image: var(--t-icon-start)`, and Iconify's CSS icons with a `data:` URL. The engine tells
 * this of each box's mask (`Engine.setMaskDrawer`) and stops the box painting its own background.
 *
 * The drawing is under what the box holds, cut to the box as a mask is, and kept from a script as
 * the box's own. Its paints are the box's colour wherever the SVG paints anything: a mask keeps
 * how much of each point is covered and none of its colour. It is sized and placed as the mask's
 * first layer is: a length, a percentage, `min()` of the two, points added, `contain` or
 * `cover`, at the position written. An image is fetched once for all the boxes that have it.
 *
 * ponytail: the mask's size in points, which a line written in `vw` and `vh` (Taiga's) and one that
 * does not scale with the drawing are worked out from, takes the box's size from its style where
 * that is in points, from its last layout where not, and 24 points before it has one. A gradient
 * a shape fills with is drawn in its own colours.
 */

/** What is drawn of each box's mask. */
interface Drawn {
  mask: MaskStyle;
  /** The SVG as fetched, recoloured: built again for another size where its lines read it. */
  markup?: string;
  /** What holds the drawing, placed over the box, and the drawing itself. */
  outer?: EngineNode;
  holder?: EngineNode;
  svg?: EngineNode;
  /** Whether a line width is worked out from the mask's size, so a new size builds it again. */
  sized?: boolean;
  /** Whether it was placed to contain or cover the box, which set the drawing's aspect ratio. */
  fitted?: boolean;
}

type Element = DefaultTreeAdapterMap['element'];

const drawn = new WeakMap<EngineNode, Drawn>();
/** Each image an address names, fetched once while a fetch of it is under way or has worked. */
const fetched = new Map<string, Promise<string | undefined>>();

const URL_VALUE = /^url\(\s*(['"]?)([\s\S]*)\1\s*\)$/i;

/** What draws masks in an app with this package: see `Engine.setMaskDrawer`. */
export function maskDrawer(engine: Engine): MaskDrawer {
  return (node, mask) => {
    const was = drawn.get(node);
    if (!mask) {
      drawn.delete(node);
      return commitLater(engine, () => removed(was, engine));
    }
    if (was && was.mask.image === mask.image) {
      was.mask = mask;
      return commitLater(engine, () => placed(node, was, engine));
    }
    const now: Drawn = { mask };
    drawn.set(node, now);
    commitLater(engine, () => removed(was, engine));
    const address = unescaped(URL_VALUE.exec(mask.image)?.[2] ?? '');
    void markupOf(address, node).then((markup) => {
      if (drawn.get(node) !== now || markup === undefined) return;
      now.markup = markup;
      commitLater(engine, () => placed(node, now, engine));
    });
  };
}

/**
 * A URL as CSS wrote it in a string, its escapes read: Taiga UI writes an SVG into a data URL as
 * it is, `url('data:image/svg+xml,<svg xmlns="...">')`, which reaches here as `\\"` for each quote.
 */
function unescaped(text: string): string {
  return text.replace(/\\(?:([0-9a-f]{1,6})\s?|(\n)|([\s\S]))/gi, (_, hex, newline, char) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : newline ? '' : char,
  );
}

/** Take a drawing out of its box. */
function removed(was: Drawn | undefined, engine: Engine): void {
  const outer = was?.outer;
  if (outer?.parent) engine.removeChild(outer.parent, outer);
}

/** The markup an address names: a `data:` URL read here, any other fetched against the page. */
function markupOf(address: string, node: EngineNode): Promise<string | undefined> {
  if (/^data:/i.test(address)) return Promise.resolve(dataOf(address));
  const base = String((node as { baseURI?: unknown }).baseURI ?? 'about:blank');
  const uri = parseUrl(address, base)?.href ?? address;
  let found = fetched.get(uri);
  if (!found) {
    const fetching = (globalThis as { fetch?: typeof fetch }).fetch;
    found = Promise.resolve(fetching?.(uri))
      .then((response) => (response?.ok ? response.text() : undefined))
      .catch(() => undefined)
      .then((markup) => {
        // Not kept when it failed: a box that names it later asks again, once the network is back.
        if (markup === undefined) fetched.delete(uri);
        return markup;
      });
    fetched.set(uri, found);
  }
  return found;
}

/** What a `data:` URL holds, as text. */
function dataOf(address: string): string | undefined {
  const comma = address.indexOf(',');
  if (comma < 0) return undefined;
  const head = address.slice(5, comma);
  const body = address.slice(comma + 1);
  try {
    return /;base64$/i.test(head) ? atob(body) : decodeURIComponent(body);
  } catch {
    return undefined;
  }
}

/** A drawing built in its box, or placed and painted again where it is built. */
function placed(node: EngineNode, now: Drawn, engine: Engine): void {
  if (drawn.get(node) !== now || now.markup === undefined) return;
  const size = maskSize(node, now.mask, now.markup);
  // Built again once it no longer contains or covers the box, for the drawing's own aspect ratio.
  if (!now.svg || now.sized || (now.fitted && !fits(now.mask))) build(node, now, size, engine);
  if (!now.svg) return;
  place(now, size, engine);
  now.fitted = fits(now.mask);
}

const fits = (mask: MaskStyle): boolean => mask.width === 'contain' || mask.width === 'cover';

/** The drawing built from its markup, for a mask of `size` points, in a holder of its own. */
function build(node: EngineNode, now: Drawn, size: Size, engine: Engine): void {
  const drawing = drawingIn(now.markup!);
  if (!drawing) return;
  now.sized = recoloured(drawing, size);
  if (!now.outer) {
    now.outer = engine.createElement('view');
    now.holder = engine.createElement('view');
    // Views of this package's own, which no template writes or claims, and no rule matches or
    // counts among the box's children, for :empty and :first-child.
    now.outer.anonymous = true;
    now.outer.outsideCascade = true;
    now.holder.anonymous = true;
    keptOwn.add(now.outer);
    const first = node.childList[0];
    if (first) engine.insertBefore(node, now.outer, first);
    else engine.appendChild(node, now.outer);
  }
  setMarkup(now.holder!, serializeOuter(drawing), engine);
  now.svg = now.holder!.childList.find((child) => child.tag === 'svg');
  if (now.holder!.parent !== now.outer) arrange(now, engine);
}

/** Size, as `{ width, height }` in points, of a mask on a node: see the ponytail note above. */
interface Size {
  width: number;
  height: number;
}

/**
 * The mask's size in points, from the box's where the axis is a share of it. An `auto` axis is the
 * other by the image's own ratio, where the other is written and the image has both sides, and
 * its own side where not; an image with no size of its own on that side is the box's.
 */
function maskSize(node: EngineNode, mask: MaskStyle, markup: string): Size {
  const box = boxOf(node);
  const own = ownSize(markup);
  const width = mask.width === 'auto' ? undefined : writtenAxis(mask.width, box.width);
  const height = mask.height === 'auto' ? undefined : writtenAxis(mask.height, box.height);
  const ratio = ratioOf(own);
  const fallback = { width: own.width ?? box.width, height: own.height ?? box.height };
  return {
    width: width ?? byRatio(height, ratio) ?? fallback.width,
    height: height ?? byRatio(width, ratio && 1 / ratio) ?? fallback.height,
  };
}

/** An image's width over its height, where it has both. */
const ratioOf = (own: Partial<Size>): number | undefined =>
  own.width && own.height ? own.width / own.height : undefined;

/** One axis from the other by a ratio, where both are known. */
const byRatio = (other: number | undefined, ratio: number | undefined): number | undefined =>
  other !== undefined && ratio ? other * ratio : undefined;

/** One axis written other than `auto`, in points of a box `room` points along it. */
function writtenAxis(written: MaskAxis, room: number): number {
  if (written === 'contain' || written === 'cover') return room;
  const { size, upTo, plus } = axisOf(written);
  const base = typeof size === 'number' ? size : (percentOf(size) * room) / 100;
  const capped = upTo === undefined ? base : Math.min(base, (percentOf(upTo) * room) / 100);
  return capped + plus;
}

/** A box's size in points, from its style or its last layout. */
function boxOf(node: EngineNode): Size {
  const layout = () => engineOf(node).layoutOf(node);
  const side = (key: 'width' | 'height') => {
    const written = styled(node, key);
    return typeof written === 'number' ? written : (layout()?.[key] ?? 24);
  };
  return { width: side('width'), height: side('height') };
}

/** An SVG's own size: its `width` and `height`, or its view box, and undefined with neither. */
function ownSize(markup: string): Partial<Size> {
  const drawing = drawingIn(markup);
  const attr = (name: string) => drawing?.attrs.find((each) => each.name === name)?.value;
  const box = (attr('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const side = (name: 'width' | 'height', fallback: number | undefined) => {
    const given = parseFloat(attr(name) ?? '');
    return Number.isFinite(given) ? given : Number.isFinite(fallback) ? fallback : undefined;
  };
  return { width: side('width', box[2]), height: side('height', box[3]) };
}

/** One axis of a size as a size, what caps it and the points added. */
function axisOf(written: MaskAxis): { size: number | string; upTo?: string; plus: number } {
  if (typeof written === 'object') return { ...written, plus: written.plus ?? 0 };
  // `calc(100% + 20px)`, as the engine settles a share and a token added.
  const sum =
    typeof written === 'string'
      ? /^calc\(\s*([\d.-]+%)\s*([+-])\s*([\d.]+)px\s*\)$/.exec(written)
      : null;
  if (sum) return { size: sum[1]!, plus: Number(sum[3]) * (sum[2] === '-' ? -1 : 1) };
  return { size: written, plus: 0 };
}

const percentOf = (value: number | string): number =>
  typeof value === 'number' ? value : parseFloat(value);

/**
 * Every paint the drawing has, the box's colour: a mask keeps a shape's coverage and none of its
 * colour, and a shape with no fill of its own fills, as an SVG's does. A line width written in
 * `vw` and `vh`, of the mask's size, is worked out, and one that does not scale with the drawing,
 * `vector-effect: non-scaling-stroke`, is made the width it is drawn at. Answers whether either
 * read the size.
 */
function recoloured(drawing: Element, size: Size): boolean {
  const own = ownSize(serializeOuter(drawing));
  const scale =
    Math.min(size.width / (own.width || size.width), size.height / (own.height || size.height)) ||
    1;
  let sized = false;
  const walk = (element: Element, inheritedWidth: number | undefined) => {
    // A path native could not read raises an error natively: left out, as a browser leaves out
    // what it cannot draw of one.
    element.childNodes = element.childNodes.filter(
      (child) =>
        !('attrs' in child) ||
        child.nodeName !== 'path' ||
        wellFormed(attrOf(child as Element, 'd') ?? ''),
    );
    let width = inheritedWidth;
    for (const attr of [...element.attrs]) {
      const read = repainted(element, attr, size);
      if ('width' in read) width = read.width;
      sized ||= read.sized === true;
    }
    if (attrOf(element, 'vector-effect') === 'non-scaling-stroke' && width !== undefined) {
      setAttr(element, 'stroke-width', String(Math.round((width / scale) * 1000) / 1000));
      sized = true;
    }
    for (const child of element.childNodes) {
      if ('attrs' in child) walk(child as Element, width);
    }
  };
  walk(drawing, undefined);
  if (!drawing.attrs.some((attr) => attr.name === 'fill')) setAttr(drawing, 'fill', 'currentColor');
  // Its own size is the box it is placed in.
  drawing.attrs = drawing.attrs.filter((attr) => attr.name !== 'width' && attr.name !== 'height');
  return sized;
}

/**
 * One attribute of a mask's drawing made what the mask draws: a paint the box's colour, its alpha
 * kept as the paint's opacity, and a line width read, worked out where it is in `vw` or `vh` of
 * the mask's size (`sized`).
 */
function repainted(
  element: Element,
  attr: { name: string; value: string },
  size: Size,
): { width?: number | undefined; sized?: boolean } {
  if (/^(fill|stroke)$/i.test(attr.name) && !/^(none|url\()/i.test(attr.value.trim())) {
    const alpha = alphaOf(attr.value);
    attr.value = 'currentColor';
    if (alpha !== undefined) {
      const name = `${attr.name.toLowerCase()}-opacity`;
      const opacity = parseFloat(attrOf(element, name) ?? '1');
      setAttr(element, name, String(rounded((Number.isFinite(opacity) ? opacity : 1) * alpha)));
    }
  } else if (attr.name === 'style') {
    attr.value = attr.value.replace(
      /(^|;)\s*(fill|stroke)\s*:\s*(?!none|url\()([^;]+)/gi,
      (_, start: string, paint: string, value: string) => {
        const alpha = alphaOf(value);
        const opacity = alpha === undefined ? '' : `; ${paint}-opacity: ${rounded(alpha)}`;
        return `${start}${paint}: currentColor${opacity}`;
      },
    );
  } else if (attr.name === 'stroke-width' && /v[wh]|vmin|vmax/i.test(attr.value)) {
    const width = viewportLength(attr.value, size);
    attr.value = String(width ?? 1);
    return { width, sized: true };
  } else if (attr.name === 'stroke-width') {
    return { width: parseFloat(attr.value) };
  }
  return {};
}

/**
 * A colour's alpha where it lets some of what is under it through: `transparent`, a hex colour of
 * four or eight digits, or a colour function's last channel. Undefined for an opaque one.
 * ponytail: a named colour, `color-mix()` and a relative colour are taken as opaque.
 */
function alphaOf(paint: string): number | undefined {
  const text = paint.trim().toLowerCase();
  if (text === 'transparent') return 0;
  const hex = /^#(?:[\da-f]{3}([\da-f])|[\da-f]{6}([\da-f]{2}))$/.exec(text);
  const alpha = hex
    ? parseInt(hex[1] ? hex[1].repeat(2) : hex[2]!, 16) / 255
    : channelAlpha(/^[a-z]+\(([^()]*)\)$/.exec(text)?.[1]);
  return Number.isFinite(alpha) && alpha < 1 ? Math.max(alpha, 0) : undefined;
}

/** The alpha of a colour function's channels: after a slash, or the fourth of four by commas. */
function channelAlpha(channels: string | undefined): number {
  const byComma = channels?.split(',');
  const last = channels?.includes('/')
    ? channels.split('/')[1]!
    : byComma?.length === 4
      ? byComma[3]!
      : undefined;
  if (last === undefined) return 1;
  return last.trim().endsWith('%') ? parseFloat(last) / 100 : parseFloat(last);
}

const rounded = (value: number): number => Math.round(value * 1000) / 1000;

const attrOf = (element: Element, name: string) =>
  element.attrs.find((attr) => attr.name === name)?.value?.trim();

function setAttr(element: Element, name: string, value: string): void {
  const attr = element.attrs.find((each) => each.name === name);
  if (attr) attr.value = value;
  else element.attrs.push({ name, value });
}

/**
 * A length in `vw`, `vh`, `vmin` or `vmax` of the mask, in `calc()` with numbers and points:
 * Taiga UI's `calc((100vw - 100vh) / 10)`. Undefined for anything else.
 */
function viewportLength(text: string, size: Size): number | undefined {
  const units: Record<string, number> = {
    vw: size.width / 100,
    vh: size.height / 100,
    vmin: Math.min(size.width, size.height) / 100,
    vmax: Math.max(size.width, size.height) / 100,
  };
  const numbers = text
    .trim()
    .replace(/^calc\(([\s\S]*)\)$/i, '$1')
    .replace(/(-?[\d.]+)(vw|vh|vmin|vmax|px)?/gi, (_, n: string, unit?: string) =>
      String(Number(n) * (unit ? (units[unit.toLowerCase()] ?? 1) : 1)),
    );
  return arithmetic(numbers);
}

/** `+ - * /` and brackets of numbers, or undefined for anything else. */
function arithmetic(text: string): number | undefined {
  const tokens = text.match(/-?\d*\.?\d+(?:e-?\d+)?|[()+\-*/]/g) ?? [];
  if (tokens.join('') !== text.replace(/\s+/g, '')) return undefined;
  let at = 0;
  const sum = (): number => {
    let value = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++];
      value = op === '+' ? value + product() : value - product();
    }
    return value;
  };
  const product = (): number => {
    let value = term();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++];
      value = op === '*' ? value * term() : value / term();
    }
    return value;
  };
  const term = (): number => {
    if (tokens[at] !== '(') return Number(tokens[at++]);
    at++;
    const value = sum();
    at++;
    return value;
  };
  const value = sum();
  return at === tokens.length && Number.isFinite(value) ? value : undefined;
}

/** Where a position puts the mask on each axis: a share of the room left, and points along. */
function placing(position: MaskStyle['position']): { x: Along; y: Along } {
  const along = (start: string, end: string): Along => {
    const from = position[start] ?? (position[end] === undefined ? '0%' : undefined);
    const value = from ?? position[end]!;
    const share = typeof value === 'string' ? parseFloat(value) / 100 : 0;
    const points = typeof value === 'number' ? value : 0;
    return from === undefined ? { share: 1 - share, points: -points } : { share, points };
  };
  return { x: along('left', 'right'), y: along('top', 'bottom') };
}

interface Along {
  share: number;
  points: number;
}

/** The holder in the view over the box: see `place`. */
function arrange(now: Drawn, engine: Engine): void {
  engine.appendChild(now.outer!, now.holder!);
}

/**
 * Each view the drawing is placed by, styled for the mask as it now is: one over the whole box,
 * cut to it, which places the holder, the mask's size, at the start, the middle or the end of
 * each axis as the position says, moved along by its points. The drawing is the holder's size and
 * the points the mask's size adds, spread on each side as the position puts them.
 */
function place(now: Drawn, size: Size, engine: Engine): void {
  const { mask, outer, holder, svg } = now;
  const { x, y } = placing(mask.position);
  const style = (node: EngineNode, value: Record<string, unknown>) =>
    engine.setProp(node, 'style', value);
  style(outer!, {
    ...FILLED,
    overflow: 'hidden',
    pointerEvents: 'none',
    flexDirection: 'row',
    justifyContent: FLEX[side(x.share)],
    alignItems: FLEX[side(y.share)],
  });
  // A mask that contains or covers the box fills it, and the drawing is placed in it by its
  // `preserveAspectRatio`.
  const fitted = fits(mask);
  const axis = (written: MaskAxis, own: number) => {
    if (fitted) return { size: '100%', plus: 0 };
    return written === 'auto' ? { size: own, plus: 0 } : axisOf(written);
  };
  const width = axis(mask.width, size.width);
  const height = axis(mask.height, size.height);
  style(holder!, {
    position: 'relative',
    width: width.size,
    height: height.size,
    ...(width.upTo ? { maxWidth: width.upTo } : {}),
    ...(height.upTo ? { maxHeight: height.upTo } : {}),
    flexShrink: 0,
    left: x.points,
    top: y.points,
  });
  const { start: left, end: right } = spread(x, width.plus);
  const { start: top, end: bottom } = spread(y, height.plus);
  style(svg!, {
    position: 'absolute',
    width: 'auto',
    height: 'auto',
    left,
    right,
    top,
    bottom,
    pointerEvents: 'none',
    color: mask.colour ?? 'transparent',
  });
  if (fitted) {
    engine.setProp(svg!, 'align', `x${side(x.share)}Y${side(y.share)}`);
    engine.setProp(svg!, 'meetOrSlice', mask.width === 'cover' ? 1 : 0);
  }
}

/**
 * Where a share of the room left puts the holder, as flexbox places it.
 * ponytail: a share between the start, the middle and the end is put at the nearest of the three;
 * place it by a percentage margin if a library's masks are seen off by a few points.
 */
const FLEX: Record<string, string> = { Min: 'flex-start', Mid: 'center', Max: 'flex-end' };

/** The points a mask's size adds past the holder, before it and after it on one axis. */
function spread(at: Along, plus: number): { start: number; end: number } {
  const share = side(at.share) === 'Min' ? 0 : side(at.share) === 'Max' ? 1 : 0.5;
  return { start: -share * plus, end: -(1 - share) * plus };
}

const FILLED = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };

/** The side of the drawing's box a share of the room puts it at, as `preserveAspectRatio` names it. */
const side = (share: number): string => (share < 0.25 ? 'Min' : share > 0.75 ? 'Max' : 'Mid');
