/**
 * Angular's event-manager plugins in an app that asked for them: a listener whose name a plugin
 * claims, such as Taiga UI's `tui-tab-activate.stop`, is attached by that plugin.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { EVENT_MANAGER_PLUGINS } from '@angular/platform-browser';
import { cleanup, render } from '@ng-native/testing';
import { provideEventPlugins } from './event-plugins-provider.ts';
import { provideWebCompat } from './index.ts';

type Listener = (event: Event) => void;
type Manager = {
  addEventListener(element: unknown, name: string, handler: Listener): () => void;
  getZone(): { runOutsideAngular<T>(run: () => T): T };
};

/** A plugin as Taiga's `.stop` one is: the event's own name heard, its propagation stopped. */
class StopPlugin {
  manager!: Manager;
  supports(name: string): boolean {
    return name.includes('.stop');
  }
  addEventListener(element: unknown, name: string, handler: Listener): () => void {
    return this.manager.addEventListener(element, name.replace('.stop', ''), (event) => {
      event.stopPropagation();
      handler(event);
    });
  }
}

/** A plugin as Taiga's `.zoneless` one is: the zone asked for, and its listener added in it. */
class ZonelessPlugin {
  manager!: Manager;
  supports(name: string): boolean {
    return name.includes('.zoneless');
  }
  addEventListener(element: unknown, name: string, handler: Listener): () => void {
    return this.manager
      .getZone()
      .runOutsideAngular(() =>
        this.manager.addEventListener(element, name.replace('.zoneless', ''), handler),
      );
  }
}

/** A plugin that claims every name, as Angular's own DOM one does: it is left to the renderer. */
class EveryEventPlugin {
  manager!: Manager;
  added: string[] = [];
  supports(): boolean {
    return true;
  }
  addEventListener(_element: unknown, name: string): () => void {
    this.added.push(name);
    return () => {};
  }
}

const heard: string[] = [];

@Component({
  selector: 'x-tabs',
  template: '<button>Tab</button>',
  host: {
    '(activate.stop)': 'note("stopped")',
    '(activate.zoneless)': 'note("zoneless")',
    '(activate)': 'note("plain")',
  },
})
class Tabs {
  note(name: string): void {
    heard.push(name);
  }
}

@Component({
  selector: 'x-page',
  imports: [Tabs],
  template: '<div (activate)="note()"><x-tabs /></div>',
})
class Page {
  readonly document = inject(DOCUMENT);
  outer = 0;
  note(): void {
    this.outer++;
  }
}

const plugins = (...classes: (new () => object)[]) =>
  classes.map((useClass) => ({ provide: EVENT_MANAGER_PLUGINS, useClass, multi: true }));

/** The tab inside `x-tabs`, as Taiga's tab sends its activation from it. */
const tabOf = ({ instance }: { instance: Page }): EventTarget =>
  instance.document.querySelector('button')!;

afterEach(() => {
  heard.length = 0;
  cleanup();
});

describe("Angular's event-manager plugins in an app that asked for them", () => {
  it('attaches a listener whose name a plugin claims through that plugin', async () => {
    const fixture = await render(Page, {
      providers: [
        provideWebCompat(),
        provideEventPlugins(),
        ...plugins(StopPlugin, ZonelessPlugin),
      ],
    });
    tabOf(fixture).dispatchEvent(new CustomEvent('activate', { bubbles: true }));
    assert.deepEqual(heard.sort(), ['plain', 'stopped', 'zoneless']);
    // `.stop` stopped it on `x-tabs`, so the page's own listener above never heard it.
    assert.equal(fixture.instance.outer, 0);
  });

  it('leaves a name no plugin claims, and every name to the renderer for a catch-all plugin', async () => {
    const fixture = await render(Page, {
      providers: [provideWebCompat(), provideEventPlugins(), ...plugins(EveryEventPlugin)],
    });
    tabOf(fixture).dispatchEvent(new CustomEvent('activate', { bubbles: true }));
    assert.deepEqual(heard, ['plain']);
    assert.equal(fixture.instance.outer, 1);
  });

  it('runs no plugin in an app that did not ask, nor after the app that asked has gone', async () => {
    await render(Page, {
      providers: [provideWebCompat(), provideEventPlugins(), ...plugins(StopPlugin)],
    });
    cleanup();
    const fixture = await render(Page, {
      providers: [provideWebCompat(), ...plugins(StopPlugin)],
    });
    tabOf(fixture).dispatchEvent(new CustomEvent('activate', { bubbles: true }));
    assert.deepEqual(heard, ['plain']);
    assert.equal(fixture.instance.outer, 1);
  });
});
