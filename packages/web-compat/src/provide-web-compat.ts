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
import { registerElements } from './elements.ts';
import { webListen } from './listen.ts';
import { nodeMembers, type CoreNode } from './node-members.ts';
import { installWindow } from './window.ts';

/** How many apps in the process asked for it: nodes share one prototype, and globals are global. */
let apps = 0;
let removals: (() => void)[] = [];
let removeWindow: (() => void) | undefined;
/** The documents of the apps that are up, oldest first, and the global there was before them. */
const documents: unknown[] = [];
let original: unknown;

/** Add what every app shares: the node members and the renderer's listeners. */
function install(engine: Engine): void {
  const core = Object.getPrototypeOf(engine.root) as CoreNode;
  // Read now: once extended, the prototype's listeners are this package's.
  const { addEventListener, removeEventListener } = core;
  removals = [
    extendNodes(nodeMembers({ addEventListener, removeEventListener })),
    extendRenderer(webListen),
    registerElements(),
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
        // A library reads the global as often as the injected one. The newest app up has it.
        const globals = globalThis as { document?: unknown };
        if (!documents.length) original = globals.document;
        const document = documentFor(engine);
        documents.push(document);
        globals.document = document;
        inject(DestroyRef).onDestroy(() => {
          // In whatever order the apps go: the newest still up, or what was there before any.
          documents.splice(documents.indexOf(document), 1);
          globals.document = documents.at(-1) ?? original;
          if (--apps === 0) uninstall();
        });
      },
    },
  ]);
}
