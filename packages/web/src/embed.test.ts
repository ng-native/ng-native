/**
 * Angular Native components inside an ordinary Angular web app.
 *
 * The host here is a real `bootstrapApplication` app on Angular's own DOM renderer, which is the
 * case this covers: a web app that already exists, and a native component placed in one region of
 * it. `mount(element, component, { injector })` puts the island inside that app rather than beside
 * it - one set of services, one change detection - and `<ng-native-island>` does the same from a
 * template, with inputs and outputs.
 *
 * Without `injector`, `mount` still builds a separate app of its own; the other test files cover
 * that, and this one checks the two do not interfere.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ApplicationRef } from '@angular/core';
import { installJsdomEnvironment } from './jsdom-env.ts';

async function bootHost<T>(root: 'app-host', component: () => Promise<T>) {
  const { document } = installJsdomEnvironment();
  document.body.appendChild(document.createElement(root));
  const [{ bootstrapApplication }, core, app, host] = await Promise.all([
    import('@angular/platform-browser'),
    import('@angular/core'),
    import('./embed-app.ts'),
    component(),
  ]);
  app.handled.length = 0;
  const appRef: ApplicationRef = await bootstrapApplication(host as never, {
    providers: [
      core.provideZonelessChangeDetection(),
      { provide: app.HOST_NAME, useValue: 'Ada' },
      // The host's own error handler, to see whether an island's errors reach it.
      {
        provide: core.ErrorHandler,
        useValue: { handleError: (error: unknown) => app.handled.push(error) },
      },
    ],
  });
  return { document, appRef, app, core };
}

// Each test boots its own host app on its own jsdom document. The browser platform holds on to the
// document it was created with, so it goes after every test and the next boot makes a fresh one.
afterEach(async () => {
  const { destroyPlatform } = await import('@angular/core');
  destroyPlatform();
});

const text = (document: Document, id: string) =>
  document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim();

const press = (document: Document, id: string) => {
  const target = document.getElementById(id)!;
  target.dispatchEvent(
    new (globalThis as any).PointerEvent('pointerdown', { pointerId: 1, bubbles: true }),
  );
  target.dispatchEvent(
    new (globalThis as any).PointerEvent('pointerup', { pointerId: 1, bubbles: true }),
  );
};

describe('mount() with an injector: an island inside a host app', () => {
  async function bootIsland(which: 'IslandCounter' | 'IslandDetails' = 'IslandCounter') {
    const booted = await bootHost(
      'app-host',
      async () => (await import('./embed-app.ts')).HostShell,
    );
    const { mount } = await import('./mount.ts');
    const shell = booted.appRef.components[0]!.instance as InstanceType<
      typeof booted.app.HostShell
    >;
    const island = mount(shell.slot().nativeElement, booted.app[which], {
      injector: shell.injector,
    });
    await booted.appRef.whenStable();
    return { ...booted, shell, island };
  }

  it("uses the host app's root services, not copies of them", async () => {
    const { shell, island } = await bootIsland();
    const counter = island.componentRef.instance as InstanceType<
      (typeof import('./embed-app.ts'))['IslandCounter']
    >;
    assert.equal(counter.tally, shell.tally, 'one Tally, shared');
  });

  it("sees what the host app's bootstrap provided", async () => {
    const { document } = await bootIsland();
    assert.equal(text(document, 'island-label'), 'Ada: 0');
  });

  it('sees what a component above it provides', async () => {
    const { document } = await bootIsland('IslandDetails');
    assert.equal(text(document, 'details-section'), 'Accounts');
  });

  it("hands its errors to the host app's ErrorHandler", async () => {
    const { document, app, appRef } = await bootIsland('IslandDetails');
    press(document, 'details-fail');
    await appRef.whenStable();
    assert.equal(app.handled.length, 1);
    assert.match(String(app.handled[0]), /island press failed/);
  });

  it('reads the browser for its device services', async () => {
    const { island } = await bootIsland('IslandDetails');
    const details = island.componentRef.instance as { screen: { window(): { width: number } } };
    assert.equal(details.screen.window().width, (globalThis as any).window.innerWidth);
    assert.ok(details.screen.window().width > 0, 'a real width, not the phone default of zero');
  });

  it('renders native elements into the host page', async () => {
    const { document } = await bootIsland();
    const slot = document.getElementById('slot')!;
    assert.ok(slot.contains(document.getElementById('island-label')), 'inside the slot');
    assert.equal(slot.getAttribute('data-rn-root'), '', 'the slot is the island root');
  });

  it("is checked by the host app's own change detection", async () => {
    const { document, shell, appRef } = await bootIsland();
    shell.tally.increment();
    await appRef.whenStable();
    assert.equal(text(document, 'island-label'), 'Ada: 1');
    assert.equal(text(document, 'host-count'), '1');
  });

  it('carries a press in the island out to the host', async () => {
    const { document, appRef } = await bootIsland();
    press(document, 'island-press');
    await appRef.whenStable();
    assert.equal(text(document, 'host-count'), '1');
    assert.equal(text(document, 'island-label'), 'Ada: 1');
  });

  it("leaves the host page's own html and body alone", async () => {
    const { document } = await bootIsland();
    const styles = [...document.head.querySelectorAll('style')].map((style) => style.textContent);
    const reset = styles.find((css) => css?.includes('[data-rn-root]'));
    assert.ok(reset, 'the island still gets its element reset');
    assert.doesNotMatch(reset!, /(^|[\s,}])(html|body)\s*[,{]/, 'but no rule for html or body');
    assert.match(reset!, /\[data-rn-root\][^{]*\{[^}]*font-family/, 'the root carries the font');
  });

  it('leaves an element its own ngSkipHydration when it comes apart', async () => {
    const booted = await bootHost(
      'app-host',
      async () => (await import('./embed-app.ts')).HostShell,
    );
    const { mount } = await import('./mount.ts');
    const shell = booted.appRef.components[0]!.instance as InstanceType<
      typeof booted.app.HostShell
    >;
    const slot = shell.slot().nativeElement as Element;
    slot.setAttribute('ngSkipHydration', 'true');
    mount(slot, booted.app.IslandCounter, { injector: shell.injector }).destroy();
    assert.equal(slot.getAttribute('ngSkipHydration'), 'true');
  });

  it('comes apart without taking the host app with it', async () => {
    const { document, island, appRef, shell } = await bootIsland();
    island.destroy();
    assert.equal(document.getElementById('island-label'), null, 'the island is gone');
    const slot = document.getElementById('slot');
    assert.ok(slot, 'the element it was mounted into stays in the page');
    assert.equal(slot!.childNodes.length, 0, 'emptied');
    assert.equal(slot!.hasAttribute('data-rn-root'), false, 'and no longer marked as a root');
    assert.equal(slot!.hasAttribute('ngSkipHydration'), false, 'nor kept out of hydration');
    assert.equal(appRef.destroyed, false, 'the host is still running');
    shell.tally.increment();
    await appRef.whenStable();
    assert.equal(text(document, 'host-count'), '1', 'and still rendering');
  });
});

describe('<ng-native-island>: an island from a host template', () => {
  async function bootPage() {
    const booted = await bootHost(
      'app-host',
      async () => (await import('./embed-app.ts')).HostPage,
    );
    await booted.appRef.whenStable();
    const page = booted.appRef.components[0]!.instance as InstanceType<typeof booted.app.HostPage>;
    return { ...booted, page };
  }

  it('mounts the component with its inputs', async () => {
    const { document } = await bootPage();
    assert.equal(text(document, 'badge-label'), 'Ada');
  });

  it('passes a changed input through without remounting', async () => {
    const { document, page, appRef, app } = await bootPage();
    const before = app.destroyed.count;
    page.label.set('Grace');
    await appRef.whenStable();
    assert.equal(text(document, 'badge-label'), 'Grace');
    assert.equal(app.destroyed.count, before, 'the same component, so its state survives');
  });

  it('names the outputs a component has when given one it does not', async () => {
    const { page, appRef, app } = await bootPage();
    page.outputs.set({ nope: () => {} });
    await appRef.whenStable();
    assert.equal(app.handled.length, 1);
    assert.match(String(app.handled[0]), /Badge has no output 'nope' \(its outputs: pressed\)/);
  });

  it("calls the host's handler when the island emits", async () => {
    const { document, page, appRef } = await bootPage();
    press(document, 'badge');
    await appRef.whenStable();
    assert.deepEqual(page.presses, ['Ada']);
  });

  it('swaps the island when the component changes', async () => {
    const { document, page, appRef, app } = await bootPage();
    const before = app.destroyed.count;
    page.component.set(app.OtherBadge);
    await appRef.whenStable();
    assert.equal(document.getElementById('badge-label'), null);
    assert.equal(text(document, 'other-label'), 'Other Ada');
    assert.equal(app.destroyed.count, before + 1, 'the first one was destroyed');
  });

  it('destroys the island with the host element', async () => {
    const { document, page, appRef, app } = await bootPage();
    const before = app.destroyed.count;
    page.shown.set(false);
    await appRef.whenStable();
    assert.equal(document.getElementById('badge-label'), null);
    assert.equal(app.destroyed.count, before + 1);
    assert.equal(appRef.destroyed, false);
  });
});

describe('PLATFORM_ID in the browser', () => {
  it("is 'browser' for an app of its own, because it is running in a DOM", async () => {
    installJsdomEnvironment();
    const [{ mount }, { Badge }, { PLATFORM_ID }] = await Promise.all([
      import('./mount.ts'),
      import('./embed-app.ts'),
      import('@angular/core'),
    ]);
    const island = mount(document.getElementById('app-root')!, Badge);
    assert.equal(island.componentRef.injector.get(PLATFORM_ID), 'browser');
    island.destroy();
  });

  it("is the host app's own for an island inside it", async () => {
    const booted = await bootHost(
      'app-host',
      async () => (await import('./embed-app.ts')).HostShell,
    );
    const { mount } = await import('./mount.ts');
    const shell = booted.appRef.components[0]!.instance as InstanceType<
      typeof booted.app.HostShell
    >;
    const island = mount(shell.slot().nativeElement, booted.app.IslandCounter, {
      injector: shell.injector,
    });
    assert.equal(island.componentRef.injector.get(booted.core.PLATFORM_ID), 'browser');
  });
});

describe('mount() on its own: destroy()', () => {
  it('ends the app it built, and leaves its element in the page, empty', async () => {
    const { document } = installJsdomEnvironment();
    const [{ mount }, { Badge }] = await Promise.all([
      import('./mount.ts'),
      import('./embed-app.ts'),
    ]);
    const root = document.getElementById('app-root')!;
    const island = mount(root, Badge, { inputs: { label: 'Ada' } });
    assert.equal(text(document, 'badge-label'), 'Ada', 'inputs set before the first render');

    island.destroy();
    assert.equal(island.applicationRef.destroyed, true, 'its own app is gone');
    assert.equal(document.getElementById('app-root'), root, 'the element is still in the page');
    assert.equal(root.childNodes.length, 0);
  });
});
