/**
 * An island in a host app that hydrates server-rendered markup, as one with
 * `provideClientHydration()` does (Analog turns it on by default).
 *
 * Hydration installs hooks that are global rather than per app: once it is on, every component
 * Angular creates has its host element asked for `ngSkipHydration` and `ngh`, including the ones
 * an island creates through this package's renderer, whose host is a `BrowserNode`. The markup is
 * what `@angular/platform-server` would write for `HydratedHost`, by hand: an `ngh` index on each
 * component's host, `<ng-native-island>` included, their entry in the transfer state (one, as both
 * views are empty and the server writes identical entries once), and the integrity marker
 * hydration checks for. What the island renders is absent from it, because islands render only in
 * the browser. The page's hydration takes `<ng-native-island>`'s `ngh` before the island mounts,
 * so the island's own root never reads it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ApplicationRef } from '@angular/core';
import { installJsdomEnvironment } from './jsdom-env.ts';

const SERVER_RENDERED =
  '<!--nghm-->' +
  '<app-hydrated-host ngh="0"><p id="host-count">0</p><ng-native-island ngh="0"></ng-native-island>' +
  '</app-hydrated-host>' +
  '<script id="ng-state" type="application/json">{"__nghData__":[{}]}</script>';

async function bootHydrated() {
  const { document } = installJsdomEnvironment();
  document.body.innerHTML = SERVER_RENDERED;
  const serverCount = document.getElementById('host-count');
  const [{ bootstrapApplication, provideClientHydration }, core, app] = await Promise.all([
    import('@angular/platform-browser'),
    import('@angular/core'),
    import('./hydration-app.ts'),
  ]);
  const errors: unknown[] = [];
  const appRef: ApplicationRef = await bootstrapApplication(app.HydratedHost, {
    providers: [
      core.provideZonelessChangeDetection(),
      provideClientHydration(),
      {
        provide: core.ErrorHandler,
        useValue: { handleError: (error: unknown) => errors.push(error) },
      },
    ],
  });
  await appRef.whenStable();
  return { document, appRef, errors, serverCount };
}

afterEach(async () => {
  const { destroyPlatform } = await import('@angular/core');
  destroyPlatform();
});

const text = (document: Document, id: string) =>
  document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim();

describe('an island in a hydrated host app', () => {
  it('renders, rather than failing on the hydration hooks', async () => {
    const { document, errors } = await bootHydrated();
    assert.deepEqual(errors, []);
    assert.equal(text(document, 'island-label'), 'Presses: 0');
  });

  it("leaves the host's own hydration working", async () => {
    const { document, serverCount } = await bootHydrated();
    assert.equal(document.getElementById('host-count'), serverCount, 'the server-rendered node');
    const host = document.querySelector('app-hydrated-host')!;
    assert.equal(host.hasAttribute('ngh'), false, 'claimed by hydration');
    const island = document.querySelector('ng-native-island')!;
    assert.equal(island.hasAttribute('ngh'), false, "and the island element's, by the page");
  });

  it('responds to a press, in the island and in the host', async () => {
    const { document, appRef } = await bootHydrated();
    const target = document.getElementById('island-press')!;
    for (const type of ['pointerdown', 'pointerup']) {
      target.dispatchEvent(
        new (globalThis as any).PointerEvent(type, { pointerId: 1, bubbles: true }),
      );
    }
    await appRef.whenStable();
    assert.equal(text(document, 'island-label'), 'Presses: 1');
    assert.equal(text(document, 'host-count'), '1');
  });
});
