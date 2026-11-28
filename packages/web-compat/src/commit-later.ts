import type { Engine } from '@ng-native/fabric';

/** The changes waiting for each app's next commit: see `commitLater`. */
const waiting = new Map<Engine, (() => void)[]>();

/**
 * Change the tree once the commit under way is done, with every other change asked for meanwhile,
 * and commit: what a drawer changes for many boxes at once, a page of icons as their image
 * arrives, is one commit rather than one each.
 */
export function commitLater(engine: Engine, change: () => void): void {
  const changes = waiting.get(engine);
  if (changes) return void changes.push(change);
  waiting.set(engine, [change]);
  queueMicrotask(() => {
    const each = waiting.get(engine) ?? [];
    waiting.delete(engine);
    try {
      for (const one of each) one();
    } finally {
      if (engine.pending) engine.commit();
    }
  });
}
