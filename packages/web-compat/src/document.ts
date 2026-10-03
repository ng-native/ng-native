import type { Engine, EngineNode } from '@ng-native/fabric';
import { descendants, matches } from './selector.ts';

/** The document a library is given: what it creates elements with and appends overlays to. */
export interface CompatDocument {
  readonly body: EngineNode;
  readonly head: EngineNode;
  readonly documentElement: EngineNode;
  [member: string]: unknown;
}

/** Each app's document, by its engine. An engine with one is an app that asked for this package. */
const documents = new WeakMap<Engine, CompatDocument>();

export const documentOf = (engine: Engine): CompatDocument | undefined => documents.get(engine);

/**
 * `document.body`: a layer over the whole screen that lets touches through to the app, so what a
 * library appends to it (an overlay container) draws above the screen. It joins the tree with its
 * first child, and is kept last under the root, which is on top.
 *
 * ponytail: raised when a library appends through the node. One appended through `Renderer2` after
 * the app's root view was added would sit under it; raise on the engine's append if that happens.
 */
function createBody(engine: Engine): EngineNode {
  const body = engine.createElement('view');
  engine.setProp(body, 'style', { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
  engine.setProp(body, 'pointerEvents', 'box-none');
  const raise = () => {
    if (engine.root.children.at(-1) !== body) engine.appendChild(engine.root, body);
  };
  Object.defineProperties(body, {
    appendChild: {
      value: (child: EngineNode) => {
        engine.appendChild(body, child);
        raise();
        return child;
      },
    },
    insertBefore: {
      value: (child: EngineNode, before: EngineNode | null) => {
        engine.insertBefore(body, child, before);
        raise();
        return child;
      },
    },
  });
  return body;
}

/** The app's document, made the first time it is asked for. */
export function documentFor(engine: Engine): CompatDocument {
  const existing = documents.get(engine);
  if (existing) return existing;
  const all = () => [...descendants(engine.root)];
  const body = createBody(engine);
  const created: CompatDocument = {
    body,
    // Somewhere for a library's style elements to go: never in the tree, so never drawn.
    head: engine.createElement('view'),
    documentElement: engine.root,
    nodeType: 9,
    readyState: 'complete',
    visibilityState: 'visible',
    activeElement: body,
    defaultView: globalThis,
    createElement: (name: string) => engine.createElement(name.toLowerCase()),
    createElementNS: (_: string, name: string) => engine.createElement(name.toLowerCase()),
    createTextNode: (text: string) => engine.createText(text),
    createComment: () => engine.createAnchor(),
    createDocumentFragment: () => engine.createElement('view'),
    getElementById: (id: string) => all().find((node) => node.props['nativeID'] === id) ?? null,
    querySelector: (selector: string) => all().find((node) => matches(node, selector)) ?? null,
    querySelectorAll: (selector: string) => all().filter((node) => matches(node, selector)),
    // Nothing on a device dispatches to the document.
    addEventListener: () => {},
    removeEventListener: () => {},
    hasFocus: () => true,
  };
  documents.set(engine, created);
  return created;
}
