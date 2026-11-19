/**
 * One event dispatcher per runtime, shared by every surface on it.
 *
 * Fabric keeps a single event handler: a second `registerEventHandler` replaces the first. With
 * one surface that is the engine's own. With several, as each desktop window and each iPadOS scene
 * is, the last engine to register took every event, and a press in another window reached a
 * responder system that had never heard of its target. So engines join this instead. It registers
 * once, and hands each event to the engine that made the target, which every node knows.
 */
import type { FabricUIManager } from './engine.ts';

/** What the dispatcher needs of an engine. */
export interface EventReceiver {
  dispatchEvent(instanceHandle: unknown, topLevelType: string, nativeEvent: unknown): void;
}

type Handler = (instanceHandle: unknown, topLevelType: string, nativeEvent: unknown) => void;

/**
 * What a facade is keyed by when it stands for the runtime's one Fabric: `getFabricUIManager`
 * makes a new facade on every call, so two windows hold two facades over one native manager.
 */
export const FABRIC_RUNTIME = Symbol.for('ng-native.fabricRuntime');

interface Dispatcher {
  readonly receivers: EventReceiver[];
  /** Whether Fabric has this dispatcher's handler, which it keeps once given. */
  registered: boolean;
}

const dispatchers = new WeakMap<object, Dispatcher>();

/** The engine a target belongs to, read off the node; null for none (an unmounted view). */
const ownerOf = (instanceHandle: unknown): unknown =>
  (instanceHandle as { engine?: unknown } | null)?.engine ?? null;

/**
 * Have `receiver` given the events whose target it made, from `fabric`'s one handler. Answers the
 * function that stops it, for a surface that goes away. An event with no target (its view gone)
 * goes to the earliest receiver still joined, which is the app's own surface where there is one.
 */
export function joinEvents(fabric: FabricUIManager, receiver: EventReceiver): () => void {
  if (!fabric.registerEventHandler) return () => {};
  const key = (fabric as { [FABRIC_RUNTIME]?: object })[FABRIC_RUNTIME] ?? fabric;
  let dispatcher = dispatchers.get(key);
  if (!dispatcher) dispatchers.set(key, (dispatcher = { receivers: [], registered: false }));
  const { receivers } = dispatcher;
  receivers.push(receiver);
  if (!dispatcher.registered) {
    dispatcher.registered = true;
    fabric.registerEventHandler(dispatchTo(receivers));
  }
  return () => {
    const at = receivers.indexOf(receiver);
    if (at !== -1) receivers.splice(at, 1);
  };
}

/**
 * The one handler Fabric keeps, for as long as the runtime runs. Made out here, apart from
 * `joinEvents`, so that it holds the list and nothing else: a closure shares the scope of every
 * other closure made in the same call, and one made there kept the first engine to join, its root
 * and every node it committed, long after that engine left.
 */
function dispatchTo(receivers: readonly EventReceiver[]): Handler {
  return (instanceHandle, topLevelType, nativeEvent) => {
    const owner = ownerOf(instanceHandle);
    const to = receivers.find((one) => one === owner) ?? (owner ? null : receivers[0]);
    to?.dispatchEvent(instanceHandle, topLevelType, nativeEvent);
  };
}
