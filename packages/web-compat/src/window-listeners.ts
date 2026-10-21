import type { Engine } from '@ng-native/fabric';
import { listenAnywhere } from './document.ts';

/**
 * The window's own listeners, a script's `window.addEventListener`, attached to what native says
 * in every app that is up: a press anywhere, a scroll, a resize, as the document's are. An app
 * that comes up after one was added is given it too, and one that goes takes its part away.
 *
 * A template's `(window:...)` listener is attached by the renderer to its own app instead, and
 * is not one of these: each listener is attached once, so a press is heard once.
 */

interface WindowListener {
  readonly type: string;
  readonly heard: (event: unknown) => unknown;
  /** What takes it off each app it was attached to. */
  readonly stops: Map<Engine, () => void>;
}

const listeners = new Set<WindowListener>();
const apps = new Set<Engine>();

function attach(listener: WindowListener, engine: Engine): void {
  const stop = listenAnywhere(engine, listener.type, listener.heard);
  if (stop) listener.stops.set(engine, stop);
}

/** Attach a listener the window was given to every app up, and to each that comes up after. */
export function listenOnWindow(type: string, heard: (event: unknown) => unknown): () => void {
  const listener: WindowListener = { type, heard, stops: new Map() };
  listeners.add(listener);
  for (const engine of apps) attach(listener, engine);
  return () => {
    listeners.delete(listener);
    for (const stop of listener.stops.values()) stop();
    listener.stops.clear();
  };
}

/** An app is up: the window's listeners hear it, until it goes. */
export function windowListensTo(engine: Engine): () => void {
  apps.add(engine);
  for (const listener of listeners) attach(listener, engine);
  return () => {
    apps.delete(engine);
    for (const listener of listeners) {
      listener.stops.get(engine)?.();
      listener.stops.delete(engine);
    }
  };
}
