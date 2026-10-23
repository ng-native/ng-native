/**
 * What a view paints, set on native with no commit: its opacity, transform and colours, through
 * React Native's animated nodes, as `Animated` with the native driver sets them.
 *
 * A commit for a change of paint alone costs the whole round: the path from the root cloned,
 * native's diff, and a layout of every view on the screen, for a progress bar stepped every 50ms
 * twenty times a second. A value set on a native animated node reaches the view directly, by
 * `synchronouslyUpdateViewOnUIThread`, with none of that. Each view has one graph: a value node
 * for every number it paints, the transform and colour nodes over them, a style node and a props
 * node connected to the view. A change of a number is a value set; a change of what the view
 * paints, another key or a transform of another shape, builds the graph again.
 *
 * Only what native can change without a layout goes this way: React Native's props node updates
 * the view's props and not the shadow tree, so the engine commits the values the views hold
 * once they are left alone, or before anything reads where they are drawn.
 */
import type { NativeAnimated, Touched } from './native-drive.ts';

export type NumericTransform = readonly { readonly property: string; readonly value: number }[];

/** A colour as native's colour node takes it: red, green and blue to 255, alpha to 1. */
export type Rgba = readonly [number, number, number, number];

/** What a view paints, as numbers native's nodes take. */
export interface PaintValues {
  opacity?: number;
  /**
   * Each entry's property and its amount: points, a factor, or an angle in radians. Or a list
   * as a commit carries it, for one a transform node cannot take, a matrix: native is given it
   * whole, as an object node, and each change of it builds the graph again.
   */
  transform?: NumericTransform | { readonly literal: readonly unknown[] };
  colors?: Readonly<Record<string, Rgba>>;
}

interface Graph {
  tag: number;
  shape: string;
  props: number;
  /** Every node made, the props node first, for dropping them. */
  nodes: number[];
  /** The value node for each number painted, by its path: `opacity`, `transform.0`, `color.r`. */
  leaves: Map<string, number>;
  /** The last value each leaf was set or eased to. Absent where an ease was stopped part way. */
  values: Map<string, number>;
  /** The animation easing each leaf, by its id, while one does. */
  easing: Map<string, number>;
}

const PARTS = ['r', 'g', 'b', 'a'] as const;

/** Every number a view paints, by its path in the graph. */
function leavesOf(values: PaintValues): Map<string, number> {
  const leaves = new Map<string, number>();
  if (values.opacity !== undefined) leaves.set('opacity', values.opacity);
  for (const [key, rgba] of Object.entries(values.colors ?? {})) {
    rgba.forEach((part, at) => leaves.set(`${key}.${PARTS[at]}`, part));
  }
  const transform = values.transform;
  if (Array.isArray(transform)) {
    (transform as NumericTransform).forEach((entry, at) => {
      leaves.set(`transform.${at}`, entry.value);
    });
  }
  return leaves;
}

/** What makes two sets of values the same graph: which keys, and the transform's properties. */
function shapeOf(values: PaintValues): string {
  const colours = Object.keys(values.colors ?? {}).sort();
  const list = values.transform;
  const transform = !list
    ? undefined
    : Array.isArray(list)
      ? (list as NumericTransform).map((entry) => entry.property).join(',')
      : JSON.stringify((list as { literal: unknown }).literal);
  return `${values.opacity === undefined ? '' : 'o'}|${colours.join(',')}|${transform ?? '-'}`;
}

export class NativePainter {
  private readonly native: NativeAnimated;
  private readonly touched: Touched | undefined;
  private readonly graphs = new WeakMap<object, Graph>();

  constructor(native: NativeAnimated, touched?: Touched) {
    this.native = native;
    this.touched = touched;
  }

  /** Whether native can ease a value as well as set it. */
  get eases(): boolean {
    const { API } = this.native;
    return !!(API.startAnimatingNode && API.stopAnimation && this.native.generateNewAnimationId);
  }

  /** Have native paint these values on a view, setting only what changed. */
  paint(view: object, tag: number, values: PaintValues): void {
    const graph = this.graphFor(view, tag, values);
    for (const [path, value] of leavesOf(values)) {
      if (graph.values.get(path) === value) continue;
      this.stopLeaf(graph, path);
      this.native.API.setAnimatedNodeValue(graph.leaves.get(path)!, value);
      graph.values.set(path, value);
    }
    this.flush();
  }

  /**
   * Ease what a view paints from where native has it to `to`, over the frames given, as eased
   * progress from nothing to one. A view with no graph of this shape starts at `from`. `ended`
   * is told once every value has got there; `stop` leaves each where it has got to.
   */
  ease(
    view: object,
    tag: number,
    from: PaintValues,
    to: PaintValues,
    frames: readonly number[],
    ended: () => void,
  ): { stop(): void } {
    const { API } = this.native;
    // Built from where it starts, where that is the same shape; from where it ends otherwise.
    const graph = this.graphFor(view, tag, shapeOf(from) === shapeOf(to) ? from : to);
    const mine = new Map<string, number>();
    const stop = () => {
      for (const [path, id] of mine) {
        if (graph.easing.get(path) !== id) continue;
        API.stopAnimation!(id);
        graph.easing.delete(path);
        // Somewhere between the two: the next value set is set, whatever it is.
        graph.values.delete(path);
      }
      mine.clear();
      this.flush();
    };
    if (!this.eases) {
      this.paint(view, tag, to);
      ended();
      return { stop };
    }
    for (const [path, value] of leavesOf(to)) {
      if (graph.values.get(path) === value) continue;
      this.stopLeaf(graph, path);
      const id = this.native.generateNewAnimationId!();
      mine.set(path, id);
      graph.easing.set(path, id);
      graph.values.set(path, value);
      const config = { type: 'frames', frames: [...frames], toValue: value, iterations: 1 };
      API.startAnimatingNode!(id, graph.leaves.get(path)!, config, (result) => {
        if (graph.easing.get(path) === id) graph.easing.delete(path);
        if (!mine.delete(path) || !result.finished) return;
        if (mine.size === 0) ended();
      });
    }
    this.flush();
    if (mine.size === 0) ended();
    return { stop };
  }

  /** Whether native paints a view, with a graph connected to it. */
  paints(view: object): boolean {
    return this.graphs.has(view);
  }

  /** Let a view go: native no longer paints anything on it. */
  release(view: object): void {
    const graph = this.graphs.get(view);
    if (!graph) return;
    this.graphs.delete(view);
    this.tearDown(graph);
    this.flush();
  }

  /** The view's graph for values of this shape, built again where it was of another. */
  private graphFor(view: object, tag: number, values: PaintValues): Graph {
    const shape = shapeOf(values);
    const graph = this.graphs.get(view);
    if (graph?.tag === tag && graph.shape === shape) return graph;
    if (graph) this.tearDown(graph);
    const built = this.build(tag, shape, values);
    this.graphs.set(view, built);
    this.touched?.(view, tag, Object.keys(this.styleOf(values)));
    return built;
  }

  /** The style keys a graph for these values sets. */
  private styleOf(values: PaintValues): Record<string, true> {
    const keys: Record<string, true> = {};
    if (values.opacity !== undefined) keys['opacity'] = true;
    for (const key of Object.keys(values.colors ?? {})) keys[key] = true;
    if (values.transform) keys['transform'] = true;
    return keys;
  }

  private build(tag: number, shape: string, values: PaintValues): Graph {
    const { API } = this.native;
    const nodes: number[] = [];
    const leaves = new Map<string, number>();
    const made = (config: object): number => {
      const node = this.native.generateNewNodeTag();
      API.createAnimatedNode(node, config);
      nodes.push(node);
      return node;
    };
    const leaf = (path: string, value: number): number => {
      const node = made({ type: 'value', value, offset: 0 });
      leaves.set(path, node);
      return node;
    };
    const style: Record<string, number> = {};
    if (values.opacity !== undefined) style['opacity'] = leaf('opacity', values.opacity);
    for (const [key, rgba] of Object.entries(values.colors ?? {})) {
      const [r, g, b, a] = rgba.map((part, at) => leaf(`${key}.${PARTS[at]}`, part));
      const colour = made({ type: 'color', r, g, b, a });
      for (const part of [r, g, b, a]) API.connectAnimatedNodes(part!, colour);
      style[key] = colour;
    }
    const list = values.transform;
    if (list && !Array.isArray(list)) {
      style['transform'] = made({ type: 'object', value: (list as { literal: unknown }).literal });
    } else if (list) {
      const transforms = (list as NumericTransform).map((entry, at) => ({
        type: 'animated',
        property: entry.property,
        nodeTag: leaf(`transform.${at}`, entry.value),
      }));
      const transform = made({ type: 'transform', transforms });
      for (const entry of transforms) API.connectAnimatedNodes(entry.nodeTag, transform);
      style['transform'] = transform;
    }
    const styleNode = made({ type: 'style', style });
    for (const node of Object.values(style)) API.connectAnimatedNodes(node, styleNode);
    const props = made({ type: 'props', props: { style: styleNode } });
    API.connectAnimatedNodes(styleNode, props);
    API.connectAnimatedNodeToView(props, tag);
    return {
      tag,
      shape,
      props,
      nodes: [props, ...nodes.filter((node) => node !== props).reverse()],
      leaves,
      values: leavesOf(values),
      easing: new Map(),
    };
  }

  private stopLeaf(graph: Graph, path: string): void {
    const id = graph.easing.get(path);
    if (id === undefined) return;
    graph.easing.delete(path);
    this.native.API.stopAnimation?.(id);
  }

  private tearDown(graph: Graph): void {
    const { API } = this.native;
    for (const id of graph.easing.values()) API.stopAnimation?.(id);
    graph.easing.clear();
    API.disconnectAnimatedNodeFromView(graph.props, graph.tag);
    for (const node of graph.nodes) API.dropAnimatedNode(node);
  }

  private flush(): void {
    this.native.API.flushQueue?.();
  }
}
