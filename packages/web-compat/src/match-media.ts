import type { MediaCondition } from '@ng-native/fabric';
import { CompatMediaQueryListEvent } from './event-classes.ts';
import { dispatch, listen, unlisten } from './events.ts';
import { readMedia } from './media-query.ts';

/**
 * What a media query here is asked of: the window's size, and the colour scheme and motion the
 * engine was given, light and no preference where it was given none, as it settles them.
 */
export interface Screen {
  readonly width: number;
  readonly height: number;
  readonly colorScheme?: 'light' | 'dark';
  readonly reducedMotion?: boolean;
}

/** Whether a condition holds for a window: `undefined` for a feature that is not known here. */
function holds(condition: MediaCondition, screen: Screen): boolean | undefined {
  if ('all' in condition || 'any' in condition) {
    const parts = 'all' in condition ? condition.all : condition.any;
    const answers = parts.map((part) => holds(part, screen));
    if (answers.includes(undefined)) return undefined;
    return 'all' in condition ? answers.every(Boolean) : answers.some(Boolean);
  }
  if (condition.feature === 'prefers-color-scheme') {
    return condition.value === (screen.colorScheme ?? 'light');
  }
  if (condition.feature === 'prefers-reduced-motion') {
    return (condition.value === 'reduce') === (screen.reducedMotion === true);
  }
  if (condition.feature === 'orientation') {
    return condition.value === (screen.width > screen.height ? 'landscape' : 'portrait');
  }
  return 'op' in condition ? compare(screen[condition.feature], condition) : undefined;
}

/** A size of the window against what a query compares it with. */
function compare(actual: number, { op, value }: { op: string; value: number }): boolean {
  if (op === 'gt') return actual > value;
  if (op === 'gte') return actual >= value;
  if (op === 'lt') return actual < value;
  if (op === 'lte') return actual <= value;
  return actual === value;
}

/**
 * Whether a media query list matches a window: any query of it. A query that cannot be read, or
 * asks what is not known here, matches nothing, negated or not.
 */
export function mediaMatches(media: string, screen: Screen): boolean {
  return readMedia(media).some((query) => {
    if (query === undefined) return false;
    const answer = holds('not' in query ? query.not : query, screen);
    return answer !== undefined && answer !== 'not' in query;
  });
}

/** What a list is asked against: the window's size, and a way to hear it change. */
export interface MediaSource {
  readonly screen: () => Screen;
  readonly watch: (changed: () => void) => () => void;
}

interface Kept {
  readonly media: string;
  readonly source: MediaSource;
  /** How many listeners it has, and what stops it hearing the window while it has any. */
  listeners: number;
  unwatch?: () => void;
  last: boolean;
  onchange: unknown;
  handler?: (event: unknown) => unknown;
}

const kept = new WeakMap<MediaQueryList, Kept>();
const making = Symbol('making');

/** A list's state, or a `TypeError` for a `this` that is no list. */
function keptOf(list: MediaQueryList): Kept {
  const state = kept.get(list);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}

/**
 * Hear the window while the list has a listener: told of a change of its answer, with a
 * `MediaQueryListEvent`, each as `addEventListener` and `addListener` added it. Not heard while
 * it has none, so a list asked once for `matches` and let go is not kept by the window.
 */
function heard(list: MediaQueryList, state: Kept): () => void {
  if (state.listeners++ === 0) {
    state.last = mediaMatches(state.media, state.source.screen());
    state.unwatch = state.source.watch(() => {
      const matches = mediaMatches(state.media, state.source.screen());
      if (matches === state.last) return;
      state.last = matches;
      dispatch(new CompatMediaQueryListEvent('change', { media: state.media, matches }), [list]);
    });
  }
  return () => {
    if (--state.listeners === 0) state.unwatch?.();
  };
}

/** `window.matchMedia`'s answer: whether a query matches the window, read each time it is asked. */
export class MediaQueryList {
  constructor(token: symbol, media: string, source: MediaSource) {
    if (token !== making) throw new TypeError('Illegal constructor');
    kept.set(this, { media, source, listeners: 0, last: false, onchange: null });
  }

  get media(): string {
    return keptOf(this).media;
  }

  get matches(): boolean {
    const { media, source } = keptOf(this);
    return mediaMatches(media, source.screen());
  }

  addEventListener(type: string, listener: unknown, options?: unknown): void {
    const state = keptOf(this);
    listen(this, String(type), listener, options, () =>
      type === 'change' ? heard(this, state) : undefined,
    );
  }

  removeEventListener(type: string, listener: unknown, options?: unknown): void {
    unlisten(this, String(type), listener, options);
  }

  dispatchEvent(event: unknown): boolean {
    return dispatch(event, [this]);
  }

  /** The older pair, which a library still calls where it finds them: a `change` listener. */
  addListener(listener: unknown): void {
    if (listener) this.addEventListener('change', listener);
  }

  removeListener(listener: unknown): void {
    if (listener) this.removeEventListener('change', listener);
  }

  get onchange(): unknown {
    return keptOf(this).onchange;
  }

  set onchange(value: unknown) {
    const state = keptOf(this);
    state.onchange = typeof value === 'function' ? value : null;
    // Where it was first set, among the listeners, as a browser keeps an event handler.
    if (state.onchange && !state.handler) {
      state.handler = (event: unknown) =>
        (state.onchange as (event: unknown) => unknown)?.call(this, event);
      this.addEventListener('change', state.handler);
    } else if (!state.onchange && state.handler) {
      this.removeEventListener('change', state.handler);
      state.handler = undefined;
    }
  }

  get [Symbol.toStringTag](): string {
    return 'MediaQueryList';
  }
}

/** A list for a query, over a source: what `matchMedia` answers. */
export const mediaQueryList = (media: string, source: MediaSource): MediaQueryList =>
  new MediaQueryList(making, media, source);
