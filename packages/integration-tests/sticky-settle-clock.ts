/**
 * Puts a list's sticky-row settle timers in the test's hands. The list takes a scroll to be over
 * when no event has come for `STICKY_SETTLE_MS`, so a test that scrolls, awaits a frame and then
 * asserts "mid-scroll" races the wall clock: on a loaded runner the frame outlasts the window and
 * the list is at rest. Here a timer of that delay is held until `rest()` fires it, so a scroll
 * stays mid-scroll for as long as the test takes, and rest comes when the test says so.
 */
/** `STICKY_SETTLE_MS` in `@ng-native/components`, which does not export it. A change there fails the tests that need rest. */
const STICKY_SETTLE_MS = 64;

export interface StickySettleClock {
  /** Fires every held settle timer, as if the scroll had paused. */
  rest(): void;
  /** Puts the real timers back. */
  restore(): void;
}

export function holdStickySettle(): StickySettleClock {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const held = new Map<object, () => void>();
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) => {
    if (ms !== STICKY_SETTLE_MS) return (realSet as (...a: unknown[]) => unknown)(fn, ms, ...args);
    const id = {};
    held.set(id, fn);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id?: object) => {
    if (id && held.delete(id)) return;
    (realClear as (id?: unknown) => void)(id);
  }) as typeof clearTimeout;
  return {
    rest() {
      const fns = [...held.values()];
      held.clear();
      for (const fn of fns) fn();
    },
    restore() {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    },
  };
}
