/**
 * What `installJsdomEnvironment` + `mount` are to `src/*.test.ts`, for a real page.
 *
 * Most of that file's job disappears here, which is the point worth stating: there is no jsdom to
 * construct, no `ResizeObserver` to stub, no `PointerEvent` to substitute a `MouseEvent` for, no
 * `setPointerCapture` to no-op, and no `Element.prototype.scrollTo` to invent. Chromium has all
 * of those and has had them for years, so a component under test here is talking to the real
 * implementations rather than to this project's guesses about them - which is most of why the
 * assertions in this directory can be about numbers at all.
 *
 * What replaces it is smaller and about the opposite problem. A real browser is asynchronous
 * where jsdom is not: layout happens between frames, a `ResizeObserver` delivers before paint
 * rather than on a microtask, and a CSS transition finishes on a clock. So `settle()` here waits
 * for real frames rather than for a drained microtask queue, and the tests below wait for a
 * condition rather than for a fixed number of turns.
 *
 * Each call mounts into a fresh element and the previous one is torn down, because a page
 * persists across tests in a way a per-test jsdom document does not - and an `<overlay-host>`
 * left behind by a previous test is an element the next one's `getElementById` would find first.
 */
import { beforeEach, afterEach } from 'vitest';
import type { Type } from '@angular/core';
import { mount, type MountResult } from '../src/mount.ts';
import './styles.css';

/** The Playwright-side commands `vitest.config.ts` defines, for what a page cannot do itself. */
declare module 'vitest/browser' {
  interface BrowserCommands {
    /** Move a real mouse over the element and hold its button down, until `pointerUp`. */
    pointerDown(selector: string): Promise<void>;
    pointerUp(): Promise<void>;
    /** What `prefers-color-scheme` answers, as an OS setting would change it. */
    emulateColorScheme(scheme: 'light' | 'dark'): Promise<void>;
    /** How many device pixels a CSS pixel is, as a high-density screen would say. */
    deviceScale(scale: number): Promise<void>;
    /** The Tailwind 3 web preset's sheet for `classes`, built with `prefix`. */
    tailwind3(classes: string, prefix: string): Promise<string>;
  }
}

let mounted: MountResult | null = null;
let root: Element | null = null;

/** One animation frame, plus the layout that follows it. */
export function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Long enough for anything driven by measurement to have run: a `ResizeObserver` fires before
 * paint, the signal write it makes schedules change detection, and the style that lands is only
 * laid out on the frame after that. Three frames is the shortest span that reliably contains all
 * three, and every wait in this directory that is not a `waitFor` is this.
 */
export async function settle(): Promise<void> {
  await frame();
  await frame();
  await frame();
}

/**
 * Waits for a predicate rather than for a duration.
 *
 * A transition has a real length here, and a test that asserted after a fixed sleep would be
 * asserting about this machine's speed. Everything with a clock in it - a height animating, an
 * overlay measuring itself - is awaited through this instead.
 */
export async function waitFor<T>(
  predicate: () => T | null | undefined | false,
  message = 'condition',
  timeout = 2000,
): Promise<T> {
  const deadline = performance.now() + timeout;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await frame();
  }
}

export interface Booted extends MountResult {
  readonly root: Element;
  /** `document.getElementById`, but a miss is an error rather than a null dereference later. */
  byId(id: string): HTMLElement;
  /** A full press: down, then up, then settled. Real `PointerEvent`s, as `responder.ts` wants. */
  press(id: string): Promise<void>;
  pointer(id: string, type: string, init?: PointerEventInit): void;
}

export function boot(component: Type<unknown>, { asAnAppMounts = false } = {}): Booted {
  root = document.createElement('app-root');
  document.body.appendChild(root);
  // `styles.css` imports `reset.css` into Tailwind's `base` layer, the same substitution
  // `examples/web/src/main.ts` makes and for the same cascade-layer reason documented there.
  // Injecting it again as an unlayered `<style>` would beat every Tailwind utility on the page.
  // A test of what `mount` does by default asks for no options at all.
  mounted = mount(root, component, asAnAppMounts ? {} : { injectReset: false });

  const byId = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`No element with id "${id}"`);
    return el as HTMLElement;
  };
  const pointer = (id: string, type: string, init: PointerEventInit = {}): void => {
    byId(id).dispatchEvent(
      new PointerEvent(type, { pointerId: 1, bubbles: true, isPrimary: true, ...init }),
    );
    mounted!.applicationRef.tick();
  };
  const press = async (id: string): Promise<void> => {
    pointer(id, 'pointerdown');
    pointer(id, 'pointerup');
    await settle();
  };

  return { ...mounted, root, byId, press, pointer };
}

beforeEach(() => {
  // A previous file's viewport is not this one's business. Tests that need a size set it
  // themselves; this is the size they can assume they start from.
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  mounted?.componentRef.destroy();
  root?.remove();
  mounted = null;
  root = null;
});
