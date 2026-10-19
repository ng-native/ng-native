import type { Engine } from '@ng-native/fabric';

/**
 * Hear each commit of an app, which is when what native lays out can have changed: what an
 * observer looks again after. The engine's `commit` is wrapped on the engine itself while
 * something listens, and nothing else: an app with no observer commits as it does without this
 * package. The wrapper goes with the last listener, and with the app.
 */

interface Watch {
  readonly listeners: Set<() => void>;
  readonly wrapper: Engine['commit'];
  /** The engine's own `commit` before this one, where it had one of its own. */
  readonly before: PropertyDescriptor | undefined;
}

const watches = new Map<Engine, Watch>();

/** Take the wrapper off an engine, and forget its listeners. */
function unwrap(engine: Engine, watch: Watch): void {
  watches.delete(engine);
  watch.listeners.clear();
  // Something wrapped it after this did: leave theirs, which calls through to ours, alone.
  if (engine.commit !== watch.wrapper) return;
  if (watch.before) Object.defineProperty(engine, 'commit', watch.before);
  else delete (engine as Partial<Engine>).commit;
}

/** Call `listener` after each commit of the app that changed anything, until what is answered. */
export function watchCommits(engine: Engine, listener: () => void): () => void {
  let watch = watches.get(engine);
  if (!watch) {
    const listeners = new Set<() => void>();
    const before = Object.getOwnPropertyDescriptor(engine, 'commit');
    const commit = engine.commit;
    const wrapper = function (this: Engine): boolean {
      const committed = commit.call(this);
      if (committed) for (const each of [...listeners]) each();
      return committed;
    };
    watch = { listeners, wrapper, before };
    engine.commit = wrapper;
    watches.set(engine, watch);
  }
  const listening = watch;
  listening.listeners.add(listener);
  return () => {
    listening.listeners.delete(listener);
    if (!listening.listeners.size && watches.get(engine) === listening) unwrap(engine, listening);
  };
}

/** An app has gone: its commits are its own again, whatever still listened. */
export function forgetCommits(engine: Engine): void {
  const watch = watches.get(engine);
  if (watch) unwrap(engine, watch);
}
