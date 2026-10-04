import type { Engine, EngineNode } from '@ng-native/fabric';

const engineOf = (node: EngineNode): Engine => (node as unknown as { host: Engine }).host;

/** A `ResizeObserver` over the engine's layout events: it reports once native has laid a node out. */
class LayoutResizeObserver {
  private readonly stops = new Map<EngineNode, () => void>();
  private readonly callback: (entries: unknown[], observer: unknown) => void;

  constructor(callback: (entries: unknown[], observer: unknown) => void) {
    this.callback = callback;
  }

  observe(node: EngineNode): void {
    if (!node || this.stops.has(node)) return;
    const stop = engineOf(node).setEventListener(node, 'topLayout', (event) => {
      const layout = (event as { nativeEvent?: { layout?: { width: number; height: number } } })
        .nativeEvent?.layout;
      const contentRect = { width: layout?.width ?? 0, height: layout?.height ?? 0 };
      this.callback([{ target: node, contentRect }], this);
    });
    this.stops.set(node, stop);
  }

  unobserve(node: EngineNode): void {
    this.stops.get(node)?.();
    this.stops.delete(node);
  }

  disconnect(): void {
    for (const stop of this.stops.values()) stop();
    this.stops.clear();
  }
}

const noop = () => {};

/** What a library reads from `window`, some of it as it loads. */
const GLOBALS: Readonly<Record<string, unknown>> = {
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: () => true,
  matchMedia: (media: string) => ({
    media,
    matches: false,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
  }),
  getComputedStyle: (node: { style?: unknown }) => node.style ?? {},
  getSelection: () => null,
  // All three: the CDK's scroll blocking calls `scroll`, and restores the page with it.
  scroll: noop,
  scrollTo: noop,
  scrollBy: noop,
  ResizeObserver: LayoutResizeObserver,
};

/**
 * Define the globals above that the runtime does not have, and answer what removes them again.
 * One the runtime has is left alone: React Native's own `requestAnimationFrame`, a test's jsdom.
 */
export function installWindow(): () => void {
  const target = globalThis as Record<string, unknown>;
  const added = Object.keys(GLOBALS).filter((name) => typeof target[name] === 'undefined');
  for (const name of added) target[name] = GLOBALS[name];
  const sized = Object.keys(SIZES).filter((name) => typeof target[name] === 'undefined');
  for (const name of sized) {
    Object.defineProperty(target, name, { configurable: true, get: SIZES[name] });
  }
  return () => {
    for (const name of added) if (target[name] === GLOBALS[name]) delete target[name];
    for (const name of sized) delete target[name];
  };
}

/** The engines of the apps that are up, oldest first: the newest is the one `window` speaks for. */
const engines: Engine[] = [];

/** An app that asked for the package has started: its window is the one read, until it goes. */
export function windowOf(engine: Engine): () => void {
  engines.push(engine);
  return () => void engines.splice(engines.indexOf(engine), 1);
}

const viewport = () => engines.at(-1)?.viewport;

/**
 * The window's size, read each time: a library positions an overlay from it, and the device can
 * turn. Nothing scrolls the window itself, so its scroll position is always the top.
 */
const SIZES: Readonly<Record<string, () => number>> = {
  innerWidth: () => viewport()?.width ?? 0,
  innerHeight: () => viewport()?.height ?? 0,
  scrollX: () => 0,
  scrollY: () => 0,
  pageXOffset: () => 0,
  pageYOffset: () => 0,
};
