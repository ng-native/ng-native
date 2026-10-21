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
  /**
   * What native draws on a view with each scroll view fed to it at `scroll` and each animation
   * still playing `clock` of its way along: every graph connected to the view, evaluated, a
   * transform as its entries. A value nothing feeds or plays is at the value it was last set to.
   * Two graphs setting one prop of a view is an error, as native would draw whichever it updated
   * last.
   */
  /** Each value an event feeds at `scroll`, and each an animation still plays at `clock` of it. */
  const feed = (values: Map<unknown, number>, scroll: number, clock: number) => {
    const fed = new Set<unknown>();
    for (const [, , , mapping] of named('event')) {
      fed.add((mapping as { animatedValueTag: number }).animatedValueTag);
    }
    for (const [, , , value] of named('removeEvent')) fed.delete(value);
    for (const tag of fed) values.set(tag, scroll);
    for (const [, id, node, config] of named('start')) {
      if (ends.has(id as number)) values.set(node, clock * (config as { toValue: number }).toValue);
    }
  };
  const drawn = (viewTag: unknown, { scroll = 0, clock = 0 } = {}): Record<string, unknown> => {
    const { configs, values, parents } = graphOf(calls);
    feed(values, scroll, clock);
    const evaluate = evaluator(configs, values, parents);
    const out: Record<string, unknown> = {};
    for (const propsTag of connected().get(viewTag) ?? []) {
      const style = configs.get((configs.get(propsTag)!['props'] as { style: unknown }).style)!;
      for (const [key, tag] of Object.entries(style['style'] as Record<string, unknown>)) {
        if (key in out) throw new Error(`two graphs set ${key} on view ${String(viewTag)}`);
        out[key] = evaluate(tag);
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
  return { native, calls, named, drives, connected, animates, painted, drawn, finish };
}

type Config = Record<string, unknown> & { type: string };

/** Each node made, by its tag; each value node's value; and the nodes connected into each. */
function graphOf(calls: readonly (readonly unknown[])[]) {
  const configs = new Map<unknown, Config>();
  const values = new Map<unknown, number>();
  const parents = new Map<unknown, unknown[]>();
  for (const [name, a, b] of calls) {
    if (name === 'create') configs.set(a, b as Config);
    if (name === 'create' && (b as Config).type === 'value') {
      values.set(a, (b as { value: number }).value);
    }
    if (name === 'set') values.set(a, b as number);
    if (name === 'connect') parents.set(b, [...(parents.get(b) ?? []), a]);
    if (name === 'disconnect')
      parents.set(
        b,
        (parents.get(b) ?? []).filter((at) => at !== a),
      );
  }
  return { configs, values, parents };
}

/**
 * What a node comes to, each value node at its value in `values`: a transform its entries, each
 * at its amount, and a colour its config.
 */
function evaluator(
  configs: ReadonlyMap<unknown, Config>,
  values: ReadonlyMap<unknown, number>,
  parents: ReadonlyMap<unknown, unknown[]>,
) {
  const number = (tag: unknown): number => {
    const config = configs.get(tag);
    if (config?.type === 'value') return values.get(tag)!;
    if (config?.type === 'addition') {
      return (config['input'] as unknown[]).reduce<number>((sum, at) => sum + number(at), 0);
    }
    if (config?.type !== 'interpolation') throw new Error(`no value for node ${String(tag)}`);
    const [parent] = parents.get(tag) ?? [];
    const [input, output] = [config['inputRange'], config['outputRange']] as number[][];
    return clamped(number(parent), input!, output!);
  };
  return (tag: unknown): unknown => {
    const config = configs.get(tag)!;
    if (config.type === 'color') return config;
    if (config.type !== 'transform') return round(number(tag));
    const entries = config['transforms'] as {
      property: string;
      nodeTag?: unknown;
      value?: number;
    }[];
    return entries.map((entry) => ({
      [entry.property]: round(entry.nodeTag === undefined ? entry.value! : number(entry.nodeTag)),
    }));
  };
}

/** Where native's interpolation puts `x`, clamped at both ends. */
function clamped(x: number, input: readonly number[], output: readonly number[]): number {
  if (x <= input[0]!) return output[0]!;
  if (x >= input.at(-1)!) return output.at(-1)!;
  let i = 0;
  while (x > input[i + 1]!) i++;
  const span = input[i + 1]! - input[i]! || 1;
  return output[i]! + ((output[i + 1]! - output[i]!) * (x - input[i]!)) / span;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
