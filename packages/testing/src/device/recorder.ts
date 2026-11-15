/**
 * A Fabric UIManager that records what the app commits, for the device test host: the tree is what
 * `createFakeFabric` from `@ng-native/testing` builds in a unit test (view names, props merged as
 * native merges them, children), so tests query it with the same queries, and a node's window
 * frame is read back from the real one.
 */
import type { FabricNode, FabricNodeSet, FabricUIManager } from '@ng-native/fabric';

/** A committed view, as the host reads it. */
export interface RecordedNode {
  /** Unique per clone, as `handle` is on the fake. */
  handle: number;
  /** The view's own, kept by every clone of it: what a test asks to measure. */
  reactTag: number;
  viewName: string;
  props: Record<string, unknown>;
  children: RecordedNode[];
}
export type Frame = { x: number; y: number; width: number; height: number };

/** How long a transition that never reports its end keeps the app busy. */
const TRANSITION_LIMIT_MS = 3000;
/**
 * How long a newly committed screen keeps the app busy before native says its transition began:
 * `topWillAppear` comes a frame or two after the commit, and a query can find the screen's content
 * in between.
 */
const SCREEN_SETTLE_MS = 250;
/** How long after a transition ends a tap can still be dropped: measured at 29ms on iOS 27. */
const ENDED_SETTLE_MS = 150;

/**
 * The fabric the engine is handed, forwarding every call to the real one and keeping a record of
 * each node it makes, keyed by the real node so a clone finds what it was cloned from.
 */
export function record(real: FabricUIManager) {
  const records = new WeakMap<object, RecordedNode>();
  const sets = new WeakMap<object, RecordedNode[]>();
  /** The real node behind each record, for `measure`; left out of what is sent. */
  const nodes = new WeakMap<RecordedNode, FabricNode>();
  /** The instance handle each record's view was created with, which its clones share. */
  const instances = new WeakMap<RecordedNode, unknown>();
  let dispatch: ((instanceHandle: unknown, type: string, event: unknown) => void) | null = null;
  let nextHandle = 0;
  let committed: RecordedNode[] = [];
  let transitions = 0;
  let transitionAt = 0;
  let screenAt = 0;
  let endedAt = 0;
  let touches = 0;

  const keep = (
    node: FabricNode,
    recorded: Omit<RecordedNode, 'handle'>,
    instanceHandle: unknown,
  ): FabricNode => {
    const entry = { handle: ++nextHandle, ...recorded };
    records.set(node as object, entry);
    nodes.set(entry, node);
    instances.set(entry, instanceHandle);
    return node;
  };
  const of = (node: FabricNode): RecordedNode =>
    records.get(node as object) ?? {
      handle: 0,
      reactTag: 0,
      viewName: 'unknown',
      props: {},
      children: [],
    };
  // Fabric merges raw props onto the node's, and JSI drops a key whose value is undefined.
  const merged = (node: FabricNode, props: object): Record<string, unknown> => {
    const next = { ...of(node).props };
    for (const [key, value] of Object.entries(props)) if (value !== undefined) next[key] = value;
    return next;
  };
  const cloneOf = (
    from: FabricNode,
    to: FabricNode,
    props: Record<string, unknown>,
    children: RecordedNode[],
  ): FabricNode =>
    keep(
      to,
      { reactTag: of(from).reactTag, viewName: of(from).viewName, props, children },
      instances.get(of(from)),
    );

  const overrides: Partial<FabricUIManager> = {
    createNode(reactTag, viewName, rootTag, props, instanceHandle) {
      const node = real.createNode(reactTag, viewName, rootTag, props, instanceHandle);
      if (/^RNS(Modal)?Screen$/.test(viewName)) screenAt = Date.now();
      return keep(
        node,
        { reactTag, viewName, props: merged(node, props), children: [] },
        instanceHandle,
      );
    },
    cloneNodeWithNewChildren(node, children) {
      const clone = real.cloneNodeWithNewChildren(node, children);
      return cloneOf(node, clone, of(node).props, (children ?? []).map(of));
    },
    cloneNodeWithNewProps(node, props) {
      return cloneOf(node, real.cloneNodeWithNewProps(node, props), merged(node, props), [
        ...of(node).children,
      ]);
    },
    cloneNodeWithNewChildrenAndProps(node, children, props) {
      const clone = real.cloneNodeWithNewChildrenAndProps(node, children, props);
      return cloneOf(node, clone, merged(node, props), children.map(of));
    },
    appendChild(parent, child) {
      const result = real.appendChild(parent, child);
      of(parent).children.push(of(child));
      return result;
    },
    createChildSet(rootTag) {
      const set = real.createChildSet(rootTag);
      sets.set(set as object, []);
      return set;
    },
    appendChildToSet(set: FabricNodeSet, child) {
      real.appendChildToSet(set, child);
      sets.get(set as object)?.push(of(child));
    },
    completeRoot(rootTag, set) {
      real.completeRoot(rootTag, set);
      committed = sets.get(set as object) ?? [];
    },
    registerEventHandler(handler) {
      dispatch = handler;
      real.registerEventHandler?.((instanceHandle, type, event) => {
        if (type === 'topTouchStart') touches++;
        // A screen's push, pop, presentation or dismissal: native drops a tap made during one.
        if (type === 'topWillAppear' || type === 'topWillDisappear') {
          transitions++;
          transitionAt = Date.now();
        } else if (type === 'topAppear' || type === 'topDisappear') {
          if (transitions > 0) transitions--;
          endedAt = Date.now();
        }
        handler(instanceHandle, type, event);
      });
    },
  };

  // Everything else goes straight to the real fabric, bound, as the engine would have called it.
  const fabric = new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key as keyof FabricUIManager];
      const value = (real as unknown as Record<PropertyKey, unknown>)[key];
      return typeof value === 'function' ? value.bind(real) : value;
    },
    has: (target, key) => key in target || key in (real as object),
  }) as FabricUIManager;

  const find = (reactTag: number, under: readonly RecordedNode[]): RecordedNode | undefined => {
    for (const node of under) {
      const hit = node.reactTag === reactTag ? node : find(reactTag, node.children);
      if (hit) return hit;
    }
    return undefined;
  };

  return {
    fabric,
    committed: (): RecordedNode[] => committed,
    touches: (): number => touches,
    busy: (): boolean =>
      (transitions > 0 && Date.now() - transitionAt < TRANSITION_LIMIT_MS) ||
      Date.now() - screenAt < SCREEN_SETTLE_MS ||
      Date.now() - endedAt < ENDED_SETTLE_MS,
    /** A committed view's window frame, or null when it is gone or native has not laid it out. */
    measure(reactTag: number): Frame | null {
      const recorded = find(reactTag, committed);
      const node = recorded && nodes.get(recorded);
      let frame: Frame | null = null;
      if (node)
        real.measureInWindow?.(node, (x, y, width, height) => (frame = { x, y, width, height }));
      return frame;
    },
    /**
     * Send a committed view an event as native would, through the engine's own handler: what a
     * unit test's fake Fabric does, on the real engine.
     */
    emit(reactTag: number, type: string, nativeEvent: unknown = {}): void {
      const recorded = find(reactTag, committed);
      if (!recorded || !dispatch)
        throw new Error(`No committed view ${reactTag} to send ${type} to`);
      dispatch(instances.get(recorded), type, nativeEvent);
    },
  };
}
