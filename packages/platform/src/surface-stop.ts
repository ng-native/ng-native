/**
 * An app goes with the surface it is mounted on.
 *
 * Fabric stops a surface by calling `RN$stopSurface` with the surface's id, which is the root tag
 * `mount` was given. React's renderer installs that function, when React Native first loads it,
 * and tears down its own root there; nothing told an app mounted here. An Android activity
 * Android recreates, after the font size or the display size changes for one, starts a new
 * surface, runs the app's runnable on it and then stops the old surface, so the old app ran on
 * beside the new one: its timers, its subscriptions, its back button handlers and its effects.
 *
 * The function is wrapped as anything else wraps a global, around what is there when an app
 * mounts, and wrapped again by a later mount when something replaced it since.
 */

type StopSurface = (surfaceId: number) => void;

const scope = globalThis as { RN$stopSurface?: StopSurface };

/** What each surface's apps do when it stops. */
const stops = new Map<number, Set<() => void>>();

let installed: StopSurface | undefined;

/** Call `stop` when the surface `rootTag` stops. Answers the function that stops waiting. */
export function onSurfaceStop(rootTag: number, stop: () => void): () => void {
  installSurfaceStop();
  let callbacks = stops.get(rootTag);
  if (!callbacks) stops.set(rootTag, (callbacks = new Set()));
  callbacks.add(stop);
  return () => void callbacks.delete(stop);
}

function installSurfaceStop(): void {
  if (installed && scope.RN$stopSurface === installed) return;
  const next = scope.RN$stopSurface;
  installed = (surfaceId) => {
    const callbacks = stops.get(surfaceId);
    // A stopped surface is not started again: its id is not reused.
    stops.delete(surfaceId);
    // Every app on the surface goes, and the wrapped function runs, whatever one of them throws;
    // the first thing thrown is thrown after, as it would have been from the function alone.
    const failures: unknown[] = [];
    for (const stop of callbacks ?? []) {
      try {
        stop();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      next?.(surfaceId);
    } finally {
      if (failures.length > 0) throw failures[0];
    }
  };
  scope.RN$stopSurface = installed;
}
