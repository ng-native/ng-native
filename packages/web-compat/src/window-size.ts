import type { Engine, EngineNode } from '@ng-native/fabric';

/**
 * The window of each app that asked for the package: the part of the screen a library places an
 * overlay in. It ends at the top of the keyboard while that is up, as a browser on a phone ends
 * its window there, and starts under the navigation header of the screen in sight, which is over
 * the top of the screen: an overlay held inside the window is kept out from under both.
 */

/** Where each app's keyboard starts while it is up, in points from the top of the screen. */
const keyboards = new WeakMap<Engine, number>();
/** How tall the navigation header over each of an app's screens is, as the screen said. */
const headers = new WeakMap<Engine, Map<EngineNode, number>>();
/** Each app's body, which is what its window is measured by. */
const bodies = new WeakMap<Engine, EngineNode>();
/** How tall each app's window was measured to be, for the viewport it was measured under. */
const heights = new WeakMap<Engine, { viewport: object; height: number }>();
/** What is told of each change of the window that is not a change of the viewport. */
const resizes = new WeakMap<Engine, Set<() => void>>();

/**
 * The size of an app's window: the screen, from under the header and as far down as the keyboard
 * while that is up.
 *
 * ponytail: the keyboard's top is taken as it is on the screen, so a window that does not start
 * at the top of the screen (an iPad's split view) ends too low by where it starts.
 */
export function windowSize(engine: Engine): { width: number; height: number } {
  const height = windowHeight(engine);
  const end = Math.min(height, keyboards.get(engine) ?? height);
  return { width: engine.viewport.width, height: Math.max(end - windowTop(engine), 0) };
}

/**
 * How far down the screen an app's window starts: under the navigation header of the screen in
 * sight, which is the newest screen still in the tree, as a stack makes it. A header is over the
 * top of the screen, so an overlay held to the window's top edge would be behind it.
 *
 * ponytail: two stacks side by side, each with a header, would need the one a node is in.
 */
export function windowTop(engine: Engine): number {
  let top = 0;
  for (const [screen, height] of headers.get(engine) ?? []) {
    if (isWithin(screen, engine.root)) top = height;
  }
  return top;
}

const isWithin = (node: EngineNode, root: EngineNode): boolean => {
  for (let up: EngineNode | null = node; up; up = up.parent) if (up === root) return true;
  return false;
};

/**
 * A screen was made, said how tall its header is, or was taken away: `undefined`. A screen is
 * known from when it is made, at no height, so a newer one with no header is the one in sight.
 */
export function headerMoved(engine: Engine, screen: EngineNode, height: number | undefined): void {
  let known = headers.get(engine);
  if (height === undefined) {
    // One never heard of, in an app that did not ask for the package, is nothing to forget.
    if (!known?.delete(screen)) return;
  } else {
    if (!known) headers.set(engine, (known = new Map()));
    known.set(screen, height);
  }
  topMoved(engine);
}

/** Where each app's window was last said to start, to tell a `resize` listener of a change. */
const tops = new WeakMap<Engine, number>();

/**
 * Tell a `resize` listener where the window starts has changed: a header changed, or a screen
 * went, itself or with what it was in.
 */
export function topMoved(engine: Engine): void {
  if (!headers.has(engine)) return;
  const top = windowTop(engine);
  if (top === (tops.get(engine) ?? 0)) return;
  tops.set(engine, top);
  resized(engine);
}

/** An app's body has been made: it is what its window is measured by. */
export function windowBody(engine: Engine, body: EngineNode): void {
  bodies.set(engine, body);
}

/**
 * How tall an app's window is with no keyboard: as far down as its body is drawn, where that is
 * further than the app was told. Android draws an app edge to edge, under the status bar and the
 * gesture bar, and tells it of the height between the two; a library places an overlay from the
 * bottom of the window by the height it reads, and the body it is placed in is the whole height.
 */
export function windowHeight(engine: Engine): number {
  const { viewport } = engine;
  const kept = heights.get(engine);
  if (kept?.viewport === viewport) return Math.max(viewport.height, kept.height);
  const body = bodies.get(engine);
  // With the keyboard up the body ends at the keyboard, and is no measure of the window.
  if (!body || keyboards.has(engine)) return viewport.height;
  let drawn = 0;
  engine.measure(body, (frame) => (drawn = frame.y + frame.height));
  if (drawn > 0) heights.set(engine, { viewport, height: drawn });
  return Math.max(viewport.height, drawn);
}

/** The keyboard came up, moved or went: `undefined` for gone. A `resize` listener is told. */
export function keyboardMoved(engine: Engine, top: number | undefined): void {
  if (keyboards.get(engine) === top) return;
  if (top === undefined) keyboards.delete(engine);
  else keyboards.set(engine, top);
  resized(engine);
}

const resized = (engine: Engine) => {
  for (const tell of [...(resizes.get(engine) ?? [])]) tell();
};

/**
 * Hear the window of an app change size, as a `resize` listener on `window` does: the device
 * turning, the window given another size, the keyboard moving or the header changing.
 */
export function listenToResize(engine: Engine, listener: () => void): () => void {
  let listeners = resizes.get(engine);
  if (!listeners) resizes.set(engine, (listeners = new Set()));
  const own = () => listener();
  listeners.add(own);
  const unwatch = engine.watchViewport(own);
  return () => {
    listeners.delete(own);
    unwatch();
  };
}
