import {
  DestroyRef,
  DOCUMENT,
  ENVIRONMENT_INITIALIZER,
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from '@angular/core';
import { Engine, extendNodes } from '@ng-native/fabric';
import { extendRenderer } from '@ng-native/platform';
import { documentFor } from './document.ts';
import { webListen } from './listen.ts';
import { nodeMembers, type CoreNode } from './node-members.ts';
import { installWindow } from './window.ts';

/** How many apps in the process asked for it: nodes share one prototype, and globals are global. */
let apps = 0;
let removals: (() => void)[] = [];
let removeWindow: (() => void) | undefined;

/** Add what every app shares: the node members and the renderer's listeners. */
function install(engine: Engine): void {
  const core = Object.getPrototypeOf(engine.root) as CoreNode;
  // Read now: once extended, the prototype's listeners are this package's.
  const { addEventListener, removeEventListener } = core;
  removals = [
    extendNodes(nodeMembers({ addEventListener, removeEventListener })),
    extendRenderer(webListen),
  ];
}

function uninstall(): void {
  for (const remove of removals) remove();
  removals = [];
  removeWindow?.();
  removeWindow = undefined;
}

/**
 * Let a component library written for the browser render in this app.
 *
 * - Nodes answer to the DOM members such a library calls on its elements.
 * - `DOCUMENT`, and the global `document`, create engine nodes, with a `body` that draws over the
 *   screen for overlays.
 * - The `window` globals a library reads exist, `ResizeObserver` among them.
 * - A `click` listener hears a press.
 *
 * All of it is there while any app that asked for it is up, and gone when the last is destroyed.
 */
export function provideWebCompat(): EnvironmentProviders {
  // Now, not when the app starts: a library reads `window` as it is imported.
  removeWindow ??= installWindow();
  return makeEnvironmentProviders([
    { provide: DOCUMENT, useFactory: () => documentFor(inject(Engine)) },
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        const engine = inject(Engine);
        if (apps === 0) install(engine);
        apps++;
        removeWindow ??= installWindow();
        // A library reads the global as often as the injected one. The last app up has it.
        const globals = globalThis as { document?: unknown };
        const before = globals.document;
        const document = documentFor(engine);
        globals.document = document;
        inject(DestroyRef).onDestroy(() => {
          if (globals.document === document) globals.document = before;
          if (--apps === 0) uninstall();
        });
      },
    },
  ]);
}
