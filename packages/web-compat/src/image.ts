import {
  markComponentHost,
  registerViewName,
  type Engine,
  type EngineNode,
} from '@ng-native/fabric';
import { parseFragment, serializeOuter, type DefaultTreeAdapterMap } from 'parse5';
import { documentOf } from './document.ts';
import { setMarkup } from './html.ts';
import { showSource, unband, watchBand } from './image-band.ts';
import { keptOwn } from './in-document.ts';
import { parseUrl } from './parse-url.ts';
import {
  own,
  parseFloatingPoint,
  parseInteger,
  unsigned,
  type Reflecting,
  type Reflection,
} from './reflect.ts';

/**
 * An `<img>`, in an app that asked for this package: the platform's image view, shown from its
 * `src` resolved against the page's address when it is set. Its `alt` is what a screen reader
 * says, and an empty one passes it over. It is the size its `width` and
 * `height` attributes say, under any size a stylesheet gives it, and the size of its picture once
 * that has loaded where nothing else sizes it: the engine's `intrinsicSize`. `naturalWidth`,
 * `naturalHeight` and `complete` say what has loaded, and `load` and `error` are told as native
 * says them. Its picture fills its box, as `object-fit: fill` does, and a stylesheet's
 * `object-fit` is the `resizeMode` the image view takes; what is past the box is clipped. One a
 * library's sheet or a script clips to a band of itself is drawn through it: see `image-band.ts`.
 *
 * A picture that is an SVG, by its name, is fetched and drawn as an `<svg>` written in a template
 * is, which no image view reads.
 *
 * ponytail: `srcset`, `sizes`, `loading` and `decoding` are left as attributes, and the picture is
 * the one `src` names. Read `srcset` as `<image>` does if a library's pictures are seen blurred.
 * `width` and `height` read the attribute or the picture, not the size the image is laid out at.
 */
export function registerImage(): () => void {
  return registerViewName('img', 'Image', undefined, { yieldsToComponents: true });
}

/** What each image knows of the picture it shows. */
interface Picture {
  /** The URL it is shown from, resolved: none where it has no `src`. */
  uri: string | null;
  /** Whether the picture is still to arrive, or has, or failed to. */
  state: 'loading' | 'loaded' | 'broken';
  /** Its size, once it has loaded. */
  width: number;
  height: number;
}

const pictures = new WeakMap<EngineNode, Picture>();

/** What a browser's own stylesheet gives an image that a native one does not have. */
const IMAGE_DEFAULTS = { resizeMode: 'stretch' };

/**
 * An `<img>` was made: the image view in an app that asked for the package, with what a browser's
 * has, and the plain view it is without the package in one that did not.
 */
export function imageCreated(node: EngineNode, engine: Engine): void {
  if (node.tag !== 'img') return;
  if (!documentOf(engine)) return markComponentHost(node);
  pictures.set(node, { uri: null, state: 'loaded', width: 0, height: 0 });
  engine.setDefaultStyle(node, { ...node.defaultStyle, ...IMAGE_DEFAULTS });
  // Before any listener a template adds, so what loaded is known to it.
  engine.setEventListener(node, 'topLoad', (event) => loaded(node, event, engine));
  engine.setEventListener(node, 'topError', () => {
    const picture = pictures.get(node);
    if (picture) Object.assign(picture, { state: 'broken', width: 0, height: 0 });
  });
  // Drawn through a band of itself where a rule or a script clips it to one: see `image-band.ts`.
  watchBand(node, engine);
}

/** What native says of a picture that has loaded: its size, as `{ source: { width, height } }`. */
function loaded(node: EngineNode, event: unknown, engine: Engine): void {
  const picture = pictures.get(node);
  // A picture of a src taken away since: nothing is shown.
  if (!picture?.uri) return;
  type Said = { source?: { width?: number; height?: number } };
  const said = (event as { nativeEvent?: Said }).nativeEvent ?? (event as Said);
  const { width = 0, height = 0 } = said?.source ?? {};
  Object.assign(picture, { state: 'loaded', width, height });
  engine.setProp(node, 'intrinsicSize', width > 0 && height > 0 ? { width, height } : null);
  queueMicrotask(() => {
    if (engine.pending) engine.commit();
  });
}

/** A picture that is a drawing: an SVG by its name, with or without a query after it. */
const DRAWN = /\.svg(?:[?#]|$)/i;

/** The drawing each image shows, where its picture is an SVG. */
const drawings = new WeakMap<EngineNode, EngineNode>();
/** The images made a plain view for a drawing, which are image views again without one. */
const hosting = new WeakSet<EngineNode>();

/** Show a `src`, or nothing for none: another picture is another size, unknown until it loads. */
function show(node: EngineNode, picture: Picture, value: unknown, engine: Engine): void {
  const written = value == null ? '' : String(value);
  const base = String((node as { baseURI?: unknown }).baseURI ?? 'about:blank');
  const uri = written === '' ? null : (parseUrl(written, base)?.href ?? written);
  Object.assign(picture, { uri, state: uri ? 'loading' : 'loaded', width: 0, height: 0 });
  engine.setProp(node, 'intrinsicSize', null);
  undraw(node, engine);
  if (uri && DRAWN.test(uri)) {
    // A drawing is drawn whole: see `image-band.ts`.
    unband(node, engine);
    return draw(node, uri, engine);
  }
  // On the picture in its band, where it is drawn through one.
  showSource(node, uri ? [{ uri }] : null, engine);
}

/**
 * Draw an SVG from its markup: fetched, and built in the image's box as an `<svg>` written in a
 * template is. The box is a plain view while it holds one, since an image view holds nothing,
 * and the drawing fills it, kept from a script as the image's own. Its size is the drawing's
 * `width` and `height`, or its view box, said as a load.
 */
function draw(node: EngineNode, uri: string, engine: Engine): void {
  markComponentHost(node);
  hosting.add(node);
  engine.setProp(node, 'source', null);
  const fetching = (globalThis as { fetch?: typeof fetch }).fetch;
  const answer = fetching?.(uri).then((response) => (response.ok ? response.text() : undefined));
  void Promise.resolve(answer)
    .then((markup) => {
      // Another source since, or none: this one is no longer what the image shows.
      if (pictures.get(node)?.uri !== uri) return;
      const drawing = markup === undefined ? undefined : drawnFrom(node, markup, engine);
      if (!drawing) return void engine.dispatchEvent(node, 'topError', {});
      const size = sizeOf(drawing as Reflecting);
      engine.dispatchEvent(node, 'topLoad', { source: { ...size, uri } });
    })
    .catch(() => {
      if (pictures.get(node)?.uri === uri) engine.dispatchEvent(node, 'topError', {});
    });
}

type Parsed = DefaultTreeAdapterMap['parentNode'];

const SVG = 'http://www.w3.org/2000/svg';
/** What draws no shape, and would fetch, frame or run something: never built from a picture. */
const NOT_DRAWN = new Set(['foreignObject', 'script']);

/** Take out of a parsed element each one that is not a shape of the drawing, all the way down. */
function prune(parent: Parsed): void {
  parent.childNodes = parent.childNodes.filter(
    (child) =>
      !('namespaceURI' in child) || (child.namespaceURI === SVG && !NOT_DRAWN.has(child.nodeName)),
  );
  for (const child of parent.childNodes) if ('childNodes' in child) prune(child as Parsed);
}

/**
 * The first `<svg>` of a picture's markup, with only what it draws: a browser draws an SVG as an
 * image with nothing in it fetched, framed or run, and here what markup builds is a live element
 * from the moment it is parsed. Parsed apart first, so no element of it is built until then.
 */
function shapesOf(markup: string): string | undefined {
  const find = (parent: Parsed): Parsed | undefined => {
    for (const child of parent.childNodes) {
      if (child.nodeName === 'svg' && 'namespaceURI' in child && child.namespaceURI === SVG) {
        return child as Parsed;
      }
      const found = 'childNodes' in child ? find(child as Parsed) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  const drawing = find(parseFragment(markup));
  if (!drawing) return undefined;
  prune(drawing);
  return serializeOuter(drawing as DefaultTreeAdapterMap['element']);
}

/** Build the `<svg>` an image's markup has in its box, and nothing else of it. */
function drawnFrom(node: EngineNode, markup: string, engine: Engine): EngineNode | undefined {
  const shapes = shapesOf(markup);
  if (shapes === undefined) return undefined;
  setMarkup(node, shapes, engine);
  const drawing = node.childList.find((child) => child.tag === 'svg');
  for (const child of [...node.childList]) if (child !== drawing) engine.removeChild(node, child);
  if (!drawing) return undefined;
  keptOwn.add(drawing);
  drawings.set(node, drawing);
  // A picture takes no touch, as an image's does not: a link in it is no link.
  engine.setProp(drawing, 'style', { width: '100%', height: '100%', pointerEvents: 'none' });
  return drawing;
}

/** A drawing's own size: its `width` and `height`, or the box it is drawn in where it has none. */
function sizeOf(drawing: Reflecting): { width: number; height: number } {
  const box = (drawing.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  // A percentage is of a box the picture has none of, and a box that is no numbers is none.
  const side = (name: 'width' | 'height', fallback: number | undefined) => {
    const written = drawing.getAttribute(name) ?? '';
    const given = written.includes('%') ? undefined : parseFloatingPoint(written);
    return given ?? (Number.isFinite(fallback) ? fallback! : 0);
  };
  return { width: side('width', box[2]), height: side('height', box[3]) };
}

/** Stop drawing an image from markup: it is the platform's image view again. */
function undraw(node: EngineNode, engine: Engine): void {
  if (hosting.delete(node)) (node as { componentHost?: true }).componentHost = undefined;
  const drawing = drawings.get(node);
  if (!drawing) return;
  drawings.delete(node);
  keptOwn.delete(drawing);
  if (drawing.parent === node) engine.removeChild(node, drawing);
}

/** A `width` or `height` as HTML reads one: so many points, or a share of what it is in. */
function dimension(value: unknown): number | string | undefined {
  const found = /^[\t\n\f\r ]*(\d+(?:\.\d+)?)(%?)/.exec(String(value ?? ''));
  if (!found) return undefined;
  return found[2] ? `${found[1]}%` : Number(found[1]);
}

/** The size each image's own `width` and `height` give it, under any stylesheet's. */
const attributes = new WeakMap<EngineNode, Record<string, number | string>>();

function sizeBy(node: EngineNode, side: string, value: unknown, engine: Engine): void {
  const { [side]: _, ...size } = attributes.get(node) ?? {};
  const given = dimension(value);
  if (given !== undefined) size[side] = given;
  attributes.set(node, size);
  const { width: _w, height: _h, ...rest } = node.defaultStyle ?? {};
  engine.setDefaultStyle(node, { ...rest, ...size });
}

/**
 * Take an attribute of an image: its `src`, its `alt` and its size, which the image view has no
 * prop of the name for. Answers whether it was one of those, which is kept as written to read
 * back. Nothing of an image of an app that did not ask.
 */
export function setImage(node: EngineNode, name: string, value: unknown, engine: Engine): boolean {
  const picture = node.tag === 'img' ? pictures.get(node) : undefined;
  if (!picture) return false;
  if (name === 'src') show(node, picture, value, engine);
  else if (name === 'alt') {
    // An empty `alt` is a picture that says nothing, which is passed over.
    const label = value == null || value === '' ? null : String(value);
    engine.setProp(node, 'accessibilityLabel', label);
    engine.setProp(node, 'accessible', label === null ? null : true);
  } else if (name === 'width' || name === 'height') sizeBy(node, name, value, engine);
  else return false;
  return true;
}

/** An image's picture as a canvas draws it: what it is shown from, once it has loaded. */
export function loadedPicture(
  node: EngineNode,
): { uri: string; width: number; height: number } | null {
  const picture = pictures.get(node);
  if (!picture?.uri || drawings.has(node) || picture.state !== 'loaded' || !picture.width) {
    return null;
  }
  return { uri: picture.uri, width: picture.width, height: picture.height };
}

/** `width` and `height`: the attribute, where it is a number, or the picture's own. */
const side = (name: 'width' | 'height'): Reflection =>
  own((node) => {
    const written = node.getAttribute(name);
    const own = written === null || written.includes('%') ? undefined : parseInteger(written);
    return own !== undefined && own >= 0 ? own : (pictures.get(node)?.[name] ?? 0);
  }, unsigned(name).set);

/** An image's members, over what HTML reflects: see `html-members.ts`. */
export const IMAGE_MEMBERS: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  img: {
    width: side('width'),
    height: side('height'),
    naturalWidth: own((node) => pictures.get(node)?.width ?? 0),
    naturalHeight: own((node) => pictures.get(node)?.height ?? 0),
    // Done with: loaded, failed, or with nothing to load.
    complete: own((node) => pictures.get(node)?.state !== 'loading'),
  },
};

/** Give a copy of an image what the one it is a copy of shows, which it loads for itself. */
export function copyImage(from: EngineNode, to: EngineNode, engine: Engine): void {
  if (!pictures.has(from) || to.tag !== 'img') return;
  imageCreated(to, engine);
  for (const name of ['src', 'alt', 'width', 'height']) {
    const written = (to as Reflecting).getAttribute(name);
    if (written !== null) setImage(to, name, written, engine);
  }
}
