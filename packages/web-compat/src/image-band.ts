import { markComponentHost, type Engine, type EngineNode } from '@ng-native/fabric';
import { watchCommits } from './commit-watch.ts';
import { styled } from './geometry.ts';
import { keptOwn } from './in-document.ts';
import { WeakList } from './weak-list.ts';

/**
 * An `<img>` clipped to a band of itself from side to side, `clip-path: polygon(a 0, b 0, b 100%,
 * a 100%)`: one picture over another, cut where a before-and-after slider is. A view has no clip
 * path, so the image is a plain view holding a box as wide as the band that hides what is past
 * its edges, and the picture is in that box at the size of the image, moved back by where the
 * band starts. The band is `clipBand`, which a library's sheet compiles `clip-path` to and a
 * script's `style.clipPath` is set as (`inline-style.ts`), and no view is sent it.
 *
 * Each image of an app is looked at after each of its commits, which is when the rules it
 * matches can have changed: one whose band is new, moved or gone is drawn again, in a commit
 * made before the frame. What is in the image is the page's own, and no script sees it.
 *
 * ponytail: an image drawn from an SVG is drawn whole, and a band of a `<style>` made while the
 * app runs is not read. Draw one through the band too if a library is seen cutting a drawing.
 */

/** Where a band starts and ends across its box, as percentages: from the left edge. */
interface Edges {
  readonly from: number;
  readonly to: number;
}

/** An edge of a polygon as a percentage of its box: one, or a zero that is a length. */
const EDGE = /^(?:(-?\d*\.?\d+)%|0(?:px)?)$/;

/** A band's four corners, as `share` writes each: the same two edges at the top and the bottom. */
const BAND = /^(-?[\d.]+) 0, (-?[\d.]+) 0, \2 100, \1 100$/;

const share = (text: string): string => {
  const found = EDGE.exec(text);
  return found ? String(Number(found[1] ?? 0)) : '?';
};

/** The edges of a band, from the text `clip-path` is written as: nothing for any other shape. */
export function bandOf(text: unknown): Edges | undefined {
  if (typeof text !== 'string') return undefined;
  const [, inside] = /^\s*polygon\(([^()]*)\)\s*(?:border-box\s*)?$/i.exec(text) ?? [];
  const corners = inside?.split(',').map((corner) => corner.trim().split(/\s+/).map(share));
  const [, a, b] = BAND.exec(corners?.map((corner) => corner.join(' ')).join(', ') ?? '') ?? [];
  if (a === undefined || b === undefined) return undefined;
  const [from, to] = [Number(a), Number(b)];
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/** What each image shown through a band holds: the box that is the band, and the picture. */
interface Band {
  readonly box: EngineNode;
  readonly picture: EngineNode;
}

const bands = new WeakMap<EngineNode, Band>();
/** The band each image was last drawn by, as written: none where it was drawn whole. */
const drawnBy = new WeakMap<EngineNode, string>();

/** Each app's images, looked at after its commits, and what stops that. */
const images = new Map<
  Engine,
  { readonly list: WeakList<EngineNode>; readonly stop: () => void }
>();

/** An image was made in an app with a page: drawn through its band from the commit it is in. */
export function watchBand(node: EngineNode, engine: Engine): void {
  let watched = images.get(engine);
  if (!watched) {
    const list = new WeakList<EngineNode>();
    watched = { list, stop: watchCommits(engine, () => drawBands(list, engine)) };
    images.set(engine, watched);
  }
  watched.list.add(new WeakRef(node));
}

/** An app has gone: its images are looked at no longer. */
export function forgetBands(engine: Engine): void {
  images.get(engine)?.stop();
  images.delete(engine);
}

function drawBands(list: WeakList<EngineNode>, engine: Engine): void {
  let changed = false;
  list.forEach((node) => {
    if (drawBand(node, engine)) changed = true;
  });
  // Before the frame: this commit's views are drawn only once the task is over.
  if (changed) engine.commit();
}

/** Draw an image through the band it is clipped to now. Answers whether that changed anything. */
function drawBand(node: EngineNode, engine: Engine): boolean {
  const written = styled(node, 'clipBand');
  const text = typeof written === 'string' ? written : undefined;
  if (text === drawnBy.get(node)) return false;
  const edges = bandOf(text);
  // A box of another's: a drawing's, which holds no picture (see `image.ts`), or a component's.
  if (!edges || (!bands.has(node) && node.componentHost)) {
    drawnBy.delete(node);
    return unband(node, engine);
  }
  drawnBy.set(node, text!);
  const { box, picture } = bands.get(node) ?? banded(node, engine);
  const [start, wide] = [edges.from, edges.to - edges.from];
  engine.setProp(box, 'style', {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: `${start}%`,
    width: `${wide}%`,
    overflow: 'hidden',
    // A touch is the image's, as it is where nothing clips it.
    pointerEvents: 'none',
  });
  // A share of the band: as wide as the image, from the image's left edge.
  const scale = wide > 0 ? 100 / wide : 0;
  engine.setProp(picture, 'style', {
    position: 'absolute',
    top: 0,
    height: '100%',
    left: `${-start * scale}%`,
    width: `${100 * scale}%`,
    resizeMode: styled(node, 'resizeMode') ?? 'stretch',
  });
  return true;
}

/** Make an image the box its band and picture are in: a plain view, as an image view holds nothing. */
function banded(node: EngineNode, engine: Engine): Band {
  const box = engine.createElement('view');
  const picture = engine.createElement('img');
  keptOwn.add(box);
  markComponentHost(node);
  engine.setProp(picture, 'source', node.props['source'] ?? null);
  engine.setProp(node, 'source', null);
  // What native says of the picture is said of the image.
  for (const name of ['topLoad', 'topError']) {
    engine.setEventListener(picture, name, (event) => {
      const said = (event as { nativeEvent?: unknown }).nativeEvent ?? event;
      engine.dispatchEvent(node, name, said as Record<string, unknown>);
    });
  }
  engine.appendChild(box, picture);
  engine.appendChild(node, box);
  const band = { box, picture };
  bands.set(node, band);
  return band;
}

/**
 * Draw an image whole again: the platform's image view, showing the picture its band did.
 * Answers whether it was drawn through one. Its band is read again after the next commit.
 */
export function unband(node: EngineNode, engine: Engine): boolean {
  const band = bands.get(node);
  if (!band) return false;
  bands.delete(node);
  drawnBy.delete(node);
  keptOwn.delete(band.box);
  if (band.box.parent === node) engine.removeChild(node, band.box);
  (node as { componentHost?: true }).componentHost = undefined;
  engine.setProp(node, 'source', band.picture.props['source'] ?? null);
  return true;
}

/** Show a `source` on an image: on the picture in its band, where it is drawn through one. */
export function showSource(node: EngineNode, source: unknown, engine: Engine): void {
  engine.setProp(bands.get(node)?.picture ?? node, 'source', source);
}
