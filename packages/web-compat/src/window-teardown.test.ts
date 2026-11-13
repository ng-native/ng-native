/**
 * The window's listening as an app that asked for the package is destroyed. The package's own
 * teardown runs before the destroy hooks of the services the app made after it, so a root service
 * that listens on the window, as Taiga UI's root does with `fromEvent(window, 'resize')`, takes
 * its listener off after the window's listeners have gone with the last app.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { cleanup, render } from '@ng-native/testing';
import { config, fromEvent } from 'rxjs';
import { provideWebCompat } from './index.ts';

/** What a library sees of the window: loosely typed, as its own code would be. */
type Dom = any;

const LISTENING = ['addEventListener', 'removeEventListener', 'dispatchEvent'];
const had = new Map(LISTENING.map((name) => [name, Object.hasOwn(globalThis, name)]));

/** The services that heard a `resize` on the window, by the order they were made in. */
let made = 0;
const heard: number[] = [];

/** A root service that listens on the window for as long as its app is up. */
@Injectable({ providedIn: 'root' })
class Resizes {
  readonly view: Dom = inject(DOCUMENT).defaultView;
  readonly id = ++made;

  constructor() {
    fromEvent(this.view, 'resize')
      .pipe(takeUntilDestroyed())
      .subscribe(() => void heard.push(this.id));
  }
}

/** One that reads the window's size as a signal, as Taiga UI's root does. */
@Injectable({ providedIn: 'root' })
class Sized {
  readonly resized = toSignal(fromEvent(inject(DOCUMENT).defaultView as Dom, 'resize'));
}

@Component({ selector: 'x-page', template: '<div></div>' })
class Page {
  readonly resizes = inject(Resizes);
  readonly sized = inject(Sized);
}

@Component({ selector: 'x-plain', template: '<div></div>' })
class Plain {}

/**
 * What `run` threw, and what rxjs did not throw at it: taking a listener off a window that has no
 * `removeEventListener` throws from `toSignal`'s teardown, and is dropped by
 * `takeUntilDestroyed`'s, which has already completed, or thrown later from a timer.
 */
async function errorsOf(run: () => void): Promise<unknown[]> {
  const errors: unknown[] = [];
  const { onUnhandledError, onStoppedNotification } = config;
  config.onUnhandledError = (error) => void errors.push(error);
  config.onStoppedNotification = (notification) => {
    if (notification.kind === 'E') errors.push(notification.error);
  };
  try {
    run();
    await new Promise((settled) => setTimeout(settled));
  } catch (error) {
    errors.push(error);
  } finally {
    Object.assign(config, { onUnhandledError, onStoppedNotification });
  }
  return errors;
}

const resize = (view: Dom) => view.dispatchEvent(new Event('resize'));

afterEach(() => {
  try {
    cleanup();
  } finally {
    heard.length = 0;
    // What the package leaves on the window, taken off for the next test as it found it.
    for (const name of LISTENING) if (!had.get(name)) delete (globalThis as Dom)[name];
  }
});

describe('the window as an app that asked for the package goes', () => {
  it('lets a root service take its window listener off after the package has gone', async () => {
    const { resizes } = (await render(Page, { providers: [provideWebCompat()] })).instance;
    resize(resizes.view);
    assert.deepEqual(heard, [resizes.id]);
    assert.deepEqual(await errorsOf(cleanup), []);
    // Gone with the app: a resize sent after, or in the next app, is not heard by it.
    heard.length = 0;
    resize(resizes.view);
    const next = (await render(Page, { providers: [provideWebCompat()] })).instance.resizes;
    resize(next.view);
    assert.deepEqual(heard, [next.id]);
  });

  it('takes a listener off after the app has gone, and the next app does not hear it', async () => {
    await render(Plain, { providers: [provideWebCompat()] });
    const view = globalThis as Dom;
    const late: string[] = [];
    const listener = () => void late.push('late');
    view.addEventListener('picked', listener);
    cleanup();
    assert.doesNotThrow(() => view.removeEventListener('picked', listener));
    assert.equal(view.dispatchEvent(new Event('picked')), true);
    await render(Plain, { providers: [provideWebCompat()] });
    view.dispatchEvent(new Event('picked'));
    assert.deepEqual(late, []);
  });

  it('keeps a listener added once the app has gone for the next app, as the window would', async () => {
    await render(Plain, { providers: [provideWebCompat()] });
    cleanup();
    const view = globalThis as Dom;
    const later: string[] = [];
    const removed = () => void later.push('removed');
    view.addEventListener('picked', () => void later.push('kept'));
    view.addEventListener('picked', removed);
    view.removeEventListener('picked', removed);
    await render(Plain, { providers: [provideWebCompat()] });
    view.dispatchEvent(new Event('picked'));
    assert.deepEqual(later, ['kept']);
  });

  it('stays for the app still up as another goes, and goes with the last', async () => {
    const first = await render(Page, { providers: [provideWebCompat()] });
    const second = await render(Page, { providers: [provideWebCompat()] });
    const two = second.instance.resizes;
    assert.notEqual(first.instance.resizes, two);
    assert.deepEqual(await errorsOf(first.unmount), []);
    resize(two.view);
    assert.deepEqual(heard, [two.id], 'the app still up hears it, and the one gone does not');
    assert.equal(typeof (globalThis as Dom).matchMedia, 'function');
    heard.length = 0;
    assert.deepEqual(await errorsOf(second.unmount), []);
    resize(two.view);
    assert.deepEqual(heard, []);
    // The rest of the package went with the last app.
    assert.equal((globalThis as Dom).matchMedia, undefined);
  });

  it("puts Metro's stand-ins back under a root service, for the next app to be handed", async () => {
    // What `withWebCompat` runs before any module: see `before-modules.test.ts`.
    new Function('global', readFileSync(new URL('../before-modules.js', import.meta.url), 'utf8'))(
      globalThis,
    );
    const view = globalThis as Dom;
    const standIn = view.addEventListener;
    const { resizes } = (await render(Page, { providers: [provideWebCompat()] })).instance;
    assert.notEqual(view.addEventListener, standIn);
    assert.deepEqual(await errorsOf(cleanup), []);
    assert.equal(view.addEventListener, standIn);
    const later: string[] = [];
    view.addEventListener('picked', () => void later.push('kept'));
    const next = (await render(Page, { providers: [provideWebCompat()] })).instance.resizes;
    view.dispatchEvent(new Event('picked'));
    resize(view);
    assert.deepEqual(later, ['kept']);
    assert.deepEqual(heard, [next.id], `not ${resizes.id}, of the app that went`);
  });
});
