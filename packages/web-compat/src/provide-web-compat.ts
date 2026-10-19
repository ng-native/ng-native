import {
  DestroyRef,
  DOCUMENT,
  RendererFactory2,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { Engine, extendNodes } from '@ng-native/fabric';
import { extendRenderer } from '@ng-native/platform';
import { documentFor } from './document.ts';
import { webListen } from './listen.ts';
import { attributeMembers } from './attribute-members.ts';
import { characterDataMembers } from './character-data.ts';
import { forgetCommits } from './commit-watch.ts';
import { registerElements } from './elements.ts';
import { geometryMembers } from './geometry.ts';
import { withHtmlMembers } from './html-members.ts';
import { htmlMethods } from './html-methods.ts';
import { markupMembers } from './markup-members.ts';
import { nodeMembers, setAttributesWith, type CoreNode } from './node-members.ts';
import { relationMembers } from './node-relations.ts';
import { watchStyles } from './runtime-style.ts';
import { scrollingMembers } from './scrolling.ts';
import { selectorMembers } from './selector-members.ts';
import { treeMembers } from './tree-members.ts';
import { installWindow, windowOf } from './window.ts';

/** How many apps in the process asked for it: nodes share one prototype, and globals are global. */
let apps = 0;
let removals: (() => void)[] = [];
let removeWindow: (() => void) | undefined;
/** The documents of the apps that are up, oldest first, and the global there was before them. */
const documents: unknown[] = [];
let original: PropertyDescriptor | undefined;

/** Add what every app shares: the node members and the renderer's listeners. */
function install(engine: Engine): void {
  const core = Object.getPrototypeOf(engine.root) as CoreNode;
  // Read now: once extended, the prototype's listeners are this package's.
  const { addEventListener, removeEventListener } = core;
  removals = [
    // The properties of HTML elements over the rest: see `html-members.ts`.
    extendNodes(
      withHtmlMembers({
        ...nodeMembers({ addEventListener, removeEventListener }),
        ...treeMembers,
        ...characterDataMembers,
        ...relationMembers,
        ...attributeMembers,
        ...markupMembers,
        ...htmlMethods,
        ...selectorMembers,
        ...geometryMembers,
        ...scrollingMembers,
      }),
    ),
    extendRenderer(webListen),
    registerElements(),
  ];
}

/** Take away all of it, the globals too: no app that asked is up. */
function uninstall(): void {
  for (const remove of removals) remove();
  removals = [];
  removeWindow?.();
  removeWindow = undefined;
}

/** Make the global `document` the one given, or what was there before any app, for none. */
function setGlobalDocument(document: unknown): void {
  const globals = globalThis as { document?: unknown };
  if (document !== undefined) globals.document = document;
  else if (original) Object.defineProperty(globalThis, 'document', original);
  else delete globals.document;
}

/**
 * Let a component library written for the browser render in this app.
 *
 * - Nodes answer to the DOM members such a library calls on its elements: their names and
 *   namespaces, attributes, classes and `dataset`, the properties HTML reflects attributes as,
 *   their markup, the tree around them and every way to change it, the selectors they match and
 *   the elements under them that do, and their listeners.
 * - The HTML elements a library writes that the engine has no view for, a `<button>` or a
 *   `<table>`, are views, and a button and a link have their roles.
 * - `DOCUMENT`, and the global `document`, create engine nodes, with a `body` that draws over the
 *   screen for overlays, it finds elements by a selector, and its `implementation` makes
 *   documents that are never drawn.
 * - Elements say where they are and how big, and one whose style says so scrolls what overflows
 *   it, to be read and written as a browser's is.
 * - The `window` globals a library reads exist: its listeners, `Event`, its size, `screen`,
 *   `matchMedia`, `MutationObserver`, which hears what changes in the tree, `ResizeObserver` and
 *   `IntersectionObserver`, `DOMParser` and `XMLSerializer`, the interfaces of HTML's elements,
 *   and an element with an id as a global of that name.
 * - A `click` listener hears a press.
 *
 * Nothing is added until this is called, and all of it is taken away again when the last app
 * that asked for it is destroyed.
 */
export function provideWebCompat(): EnvironmentProviders {
  // Now, not when the app starts: a library reads `window` as it is imported.
  removeWindow ??= installWindow();
  return makeEnvironmentProviders([
    { provide: DOCUMENT, useFactory: () => documentFor(inject(Engine)) },
    provideEnvironmentInitializer(() => {
      const engine = inject(Engine);
      if (apps === 0) install(engine);
      apps++;
      removeWindow ??= installWindow();
      // A library reads the global as often as the injected one. The newest app up has it.
      if (!documents.length) original = Object.getOwnPropertyDescriptor(globalThis, 'document');
      const document = documentFor(engine);
      documents.push(document);
      setGlobalDocument(document);
      const forgetRenderer = setAttributesWith(
        engine,
        inject(RendererFactory2).createRenderer(null, null),
      );
      const leaveWindow = windowOf(engine);
      const unwatchStyles = watchStyles(engine);
      inject(DestroyRef).onDestroy(() => {
        unwatchStyles();
        // What an observer still watching in it heard of its commits: see `commit-watch.ts`.
        forgetCommits(engine);
        forgetRenderer();
        leaveWindow();
        // In whatever order the apps go: the newest still up, or what was there before any.
        documents.splice(documents.indexOf(document), 1);
        setGlobalDocument(documents.at(-1));
        if (--apps === 0) uninstall();
      });
    }),
  ]);
}
