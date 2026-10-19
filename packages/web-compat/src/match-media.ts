import type { MediaCondition } from '@ng-native/fabric';
import { CompatEvent, dispatch, listen, unlisten } from './events.ts';
import { readMedia } from './media-query.ts';

/** The size of a window, which is what a media query here is asked of. */
export interface Screen {
  readonly width: number;
  readonly height: number;
}

/**
 * Whether a condition holds for a window: `undefined` for a preference, the colour scheme or the
 * motion the user asked for, which the engine keeps and does not say.
 *
 * ponytail: so `(prefers-color-scheme: dark)` matches nothing here, where a stylesheet's holds as
 * the engine has it. Read the engine's conditions once it says them.
 */
function holds(condition: MediaCondition, screen: Screen): boolean | undefined {
  if ('all' in condition || 'any' in condition) {
    const parts = 'all' in condition ? condition.all : condition.any;
    const answers = parts.map((part) => holds(part, screen));
    if (answers.includes(undefined)) return undefined;
    return 'all' in condition ? answers.every(Boolean) : answers.some(Boolean);
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
      // ponytail: a plain event with the list's `media` and `matches`, where a browser sends a
      // `MediaQueryListEvent`: that class comes with the rest of the event classes.
      const event = Object.assign(new CompatEvent('change'), { media: state.media, matches });
      dispatch(event, [list]);
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
