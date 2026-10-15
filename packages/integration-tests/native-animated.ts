/** A stand-in for React Native's animated module that records what it is asked to build. */
import type { NativeAnimated } from '@ng-native/fabric';

export function recorder() {
  let next = 1;
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push([name, ...args]);
  /** What each animation started with, and what tells the engine it has ended, by its id. */
  const ends = new Map<number, (result: { finished: boolean }) => void>();
  const native: NativeAnimated = {
    generateNewNodeTag: () => next++,
    generateNewAnimationId: () => next++,
    API: {
      startAnimatingNode: (id, node, config, end) => {
        calls.push(['start', id, node, config]);
        ends.set(id, end);
      },
      stopAnimation: (id) => {
        calls.push(['stop', id]);
        ends.delete(id);
      },
      createAnimatedNode: record('create'),
      connectAnimatedNodes: record('connect'),
      disconnectAnimatedNodes: record('disconnect'),
      connectAnimatedNodeToView: record('toView'),
      disconnectAnimatedNodeFromView: record('fromView'),
      dropAnimatedNode: record('drop'),
      addAnimatedEventToView: record('event'),
      removeAnimatedEventFromView: record('removeEvent'),
      setAnimatedNodeValue: record('set'),
      flushQueue: record('flush'),
    },
  };
  const named = (name: string) => calls.filter((call) => call[0] === name);
  /** The interpolation driving each view still connected, by view tag. */
  const drives = () => {
    const configs = new Map(named('create').map(([, tag, config]) => [tag, config]));
    const parents = new Map<unknown, unknown[]>();
    for (const [, parent, child] of named('connect')) {
      parents.set(child, [...(parents.get(child) ?? []), parent]);
    }
    /** The interpolation up the graph from a node. */
    const interpolationOf = (node: unknown): unknown => {
      if ((configs.get(node) as { type?: string } | undefined)?.type === 'interpolation') {
        return configs.get(node);
      }
      for (const parent of parents.get(node) ?? []) {
        const found = interpolationOf(parent);
        if (found) return found;
      }
      return undefined;
    };
    const live = new Map<unknown, unknown>();
    for (const [name, props, view] of calls) {
      if (name === 'toView') live.set(view, props);
      if (name === 'fromView' && live.get(view) === props) live.delete(view);
    }
    return new Map(
      [...live].map(([view, props]) => [
        view as number,
        interpolationOf(props) as { inputRange: number[] },
      ]),
    );
  };
  /** The props nodes connected to each view, by view tag, in the order they were connected. */
  const connected = () => {
    const live = new Map<unknown, unknown[]>();
    for (const [name, props, view] of calls) {
      if (name === 'toView') live.set(view, [...(live.get(view) ?? []), props]);
      if (name === 'fromView') {
        live.set(
          view,
          (live.get(view) ?? []).filter((each) => each !== props),
        );
      }
    }
    return live;
  };
  /** Whether a node has an interpolation up its graph: whether an animation drives it. */
  const animates = (node: unknown): boolean => {
    const configs = new Map(named('create').map(([, tag, config]) => [tag, config]));
    const seen = new Set<unknown>();
    const up = (at: unknown): boolean => {
      if (seen.has(at)) return false;
      seen.add(at);
      if ((configs.get(at) as { type?: string } | undefined)?.type === 'interpolation') return true;
      return named('connect').some(([, parent, child]) => child === at && up(parent));
    };
    return up(node);
  };
  /**
   * What a graph that plays no animation sets on a view, each value node at the value it was
   * last set to: a transform is its entries.
   */
  const painted = (viewTag: unknown): Record<string, unknown> => {
    type Config = Record<string, unknown> & { type: string };
    const configs = new Map<unknown, Config>(
      named('create').map(([, tag, config]) => [tag, config as Config]),
    );
    const values = new Map<unknown, number>();
    for (const [name, tag, value] of calls) {
      if (name === 'create' && (value as Config).type === 'value') {
        values.set(tag, (value as { value: number }).value);
      }
      if (name === 'set') values.set(tag, value as number);
    }
    const out: Record<string, unknown> = {};
    for (const propsTag of connected().get(viewTag) ?? []) {
      if (animates(propsTag)) continue;
      const style = configs.get((configs.get(propsTag)!['props'] as { style: unknown }).style)!;
      for (const [key, tag] of Object.entries(style['style'] as Record<string, unknown>)) {
        const config = configs.get(tag)!;
        if (config.type === 'value') {
          out[key] = values.get(tag);
          continue;
        }
        const entries = config['transforms'] as { property: string; nodeTag?: unknown }[];
        out[key] = entries.map((entry) => ({ [entry.property]: values.get(entry.nodeTag) }));
      }
    }
    return out;
  };
  /** Native reaching the end of an animation it was started on, as it tells JavaScript. */
  const finish = (id: number) => {
    const end = ends.get(id);
    ends.delete(id);
    end?.({ finished: true });
  };
  return { native, calls, named, drives, connected, animates, painted, finish };
}
