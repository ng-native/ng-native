/**
 * What Reanimated's views settled on, read for the views a `[workletStyle]` drives.
 *
 * Reanimated keeps the values a worklet drew each view with in a registry, and applies every entry
 * to each commit React Native makes, cloning the view and each ancestor. A view stays there until
 * the values are in the props it is committed with. Reanimated's own React components read
 * `getSettledUpdates()` every half second while any is mounted and render what it hands them; a
 * view it handed over on one read and that has not moved since, it lets go on the next. Nothing
 * reads it for ours, so this does, and hands each view's values to whoever commits them.
 *
 * Kept apart from `reanimated.ts`, which reaches React Native's Flow source, so a test can drive it.
 */

/** One view's values, as Reanimated's `getSettledUpdates()` hands them over. */
export interface SettledUpdate {
  readonly viewTag: number;
  readonly styleProps: Readonly<Record<string, unknown>> | null;
}

/** How often Reanimated's own components read: `FLUSH_INTERVAL_MS` in its garbage collector. */
const EVERY_MS = 500;

export class SettledUpdates {
  readonly #listeners = new Map<number, (props: Readonly<Record<string, unknown>>) => void>();
  readonly #read: (isWatched: (tag: number) => boolean) => readonly SettledUpdate[] | undefined;
  readonly #isWatched = (tag: number): boolean => this.#listeners.has(tag);
  #timer: ReturnType<typeof setInterval> | null = null;

  /**
   * `read` is `getSettledUpdates()`, answering undefined where Reanimated has none. It is told
   * which views are watched, for a Reanimated that asks, so that it lets no other view go.
   */
  constructor(read: (isWatched: (tag: number) => boolean) => readonly SettledUpdate[] | undefined) {
    this.#read = read;
  }

  /**
   * Hand `listener` the values the view with `tag` settles on, each time it does. Read for while
   * any view is watched. Returns the function that stops it.
   */
  watch(tag: number, listener: (props: Readonly<Record<string, unknown>>) => void): () => void {
    this.#listeners.set(tag, listener);
    this.#timer ??= setInterval(() => this.collect(), EVERY_MS);
    return () => {
      // A view bound again keeps its tag: the newer listener stays.
      if (this.#listeners.get(tag) !== listener) return;
      this.#listeners.delete(tag);
      if (this.#listeners.size === 0 && this.#timer !== null) {
        clearInterval(this.#timer);
        this.#timer = null;
      }
    };
  }

  private collect(): void {
    for (const { viewTag, styleProps } of this.#read(this.#isWatched) ?? []) {
      if (styleProps) this.#listeners.get(viewTag)?.(styleProps);
    }
  }
}

/** One view's settled values as Reanimated hands them over: `styleProps` in 4.7, `props` and `style` from 4.8. */
export interface RawSettled {
  readonly viewTag: number;
  readonly styleProps?: Record<string, unknown> | null;
  readonly props?: Record<string, unknown>;
  readonly style?: Record<string, unknown>;
}

/** Reanimated's module, which hands the settled values over. */
export interface SettledSource {
  getSettledUpdates?(isViewRegistered?: (tag: number) => boolean): readonly RawSettled[];
}

/** Reanimated's inverse of its processing, from its garbage collector's module. */
export interface Unprocess {
  /** 4.7. */
  unprocessProps?(props: Record<string, unknown>): void;
  /** 4.8 and later. */
  unprocessSettledUpdate?(update: RawSettled): void;
}

/**
 * Read settled values in the shape this Reanimated hands them over in, turned back into a style
 * for the engine to process like any other. Null where there is no way to: before 4.7, which gives
 * no inverse to turn them back with.
 */
export function settledReader(source: SettledSource, unprocess: Unprocess): SettledUpdates | null {
  const read = source.getSettledUpdates?.bind(source);
  if (!read) return null;
  const { unprocessProps, unprocessSettledUpdate } = unprocess;
  if (unprocessSettledUpdate) {
    // 4.8 asks which views the reader commits, and lets only those go.
    return new SettledUpdates((isWatched) =>
      read(isWatched).map((update): SettledUpdate => {
        unprocessSettledUpdate(update);
        return { viewTag: update.viewTag, styleProps: { ...update.props, ...update.style } };
      }),
    );
  }
  if (!unprocessProps) return null;
  return new SettledUpdates(() =>
    read().map(({ viewTag, styleProps }): SettledUpdate => {
      if (styleProps) unprocessProps(styleProps);
      return { viewTag, styleProps: styleProps ?? null };
    }),
  );
}
