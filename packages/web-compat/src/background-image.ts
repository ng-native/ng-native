import type { BackgroundDrawer, BackgroundStyle, Engine, EngineNode } from '@ng-native/fabric';
import { commitLater } from './commit-later.ts';
import { keptOwn } from './in-document.ts';
import { parseUrl } from './parse-url.ts';

/**
 * A box's background of one image, `background: url('/wallpaper.jpg') center / cover`, drawn as
 * the platform's image under what the box holds: native paints gradients alone as a background.
 * The engine tells this of each box's background image (`Engine.setBackgroundDrawer`). The image
 * is fetched from its address resolved against the page's, as an `<img>`'s is, and kept from a
 * script as the box's own.
 *
 * ponytail: sized and placed as the platform's image can be, by its `resizeMode`: `cover`,
 * `contain`, a size of the whole box both ways (`stretch`), an image of its own size repeated
 * (`repeat`), or alone and centred, scaled down where it is larger than the box. A position
 * other than the middle and a size in points are not read, a size said with a warning in
 * development; place the image in a view of its own if a library is seen needing them. Its
 * corners are not cut to the box's.
 */

const drawn = new WeakMap<EngineNode, EngineNode>();
const UNDER_ALL = -2147483647;

const URL_VALUE = /^url\(\s*(['"]?)([\s\S]*)\1\s*\)$/i;

/** What draws background images in an app with this package: see `Engine.setBackgroundDrawer`. */
export function backgroundDrawer(engine: Engine): BackgroundDrawer {
  return (node, background) => commitLater(engine, () => draw(node, background, engine));
}

function draw(node: EngineNode, background: BackgroundStyle | null, engine: Engine): void {
  const image = drawn.get(node);
  if (!background) {
    drawn.delete(node);
    if (image?.parent) engine.removeChild(image.parent, image);
    return;
  }
  const view = image ?? made(node, engine);
  if (view.parent !== node) {
    const first = node.childList[0];
    if (first) engine.insertBefore(node, view, first);
    else engine.appendChild(node, view);
  }
  const base = String((node as { baseURI?: unknown }).baseURI ?? 'about:blank');
  const written = JSON.parse(`"${URL_VALUE.exec(background.image)?.[2] ?? ''}"`) as string;
  // A list, as an `<img>`'s is: Android's image view reads no single source.
  engine.setProp(view, 'source', [{ uri: parseUrl(written, base)?.href ?? written }]);
  engine.setProp(view, 'resizeMode', resizeModeOf(background));
}

/** The image view a box's background is drawn by, over the whole box and under what it holds. */
function made(node: EngineNode, engine: Engine): EngineNode {
  const view = engine.createElement('image');
  // A view of this package's own, which no template writes or claims, and no rule matches or
  // counts among the box's children, for :empty and :first-child.
  view.anonymous = true;
  view.outsideCascade = true;
  keptOwn.add(view);
  engine.setProp(view, 'style', {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Under every box in it, one a rule sets below the rest included: a browser paints a box's
    // background before anything it holds.
    zIndex: UNDER_ALL,
    pointerEvents: 'none',
  });
  drawn.set(node, view);
  return view;
}

/** How the platform's image fills the box for a background's size and repeat. */
function resizeModeOf({ size, repeat }: BackgroundStyle): string {
  if (size === 'cover' || size === 'contain') return size;
  const { x, y } = (size ?? {}) as { x?: unknown; y?: unknown };
  if (x === '100%' && y === '100%') return 'stretch';
  if (size !== 'auto' && (x !== 'auto' || y !== 'auto')) unreadSize(size);
  const tiled = (repeat as { x?: unknown } | null)?.x !== 'no-repeat';
  return tiled ? 'repeat' : 'center';
}

const told = new Set<string>();

/** A size the image is not drawn at, said once per size in development. */
function unreadSize(size: unknown): void {
  const written = JSON.stringify(size);
  if ((typeof __DEV__ !== 'undefined' && !__DEV__) || told.has(written)) return;
  told.add(written);
  console.warn(
    `[angular-native] background-size: ${written} is not read for a background image, which ` +
      `is drawn at its own size. cover, contain and 100% 100% are.`,
  );
}

declare const __DEV__: boolean | undefined;
