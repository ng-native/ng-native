/**
 * A view moved by a scroll view's offset on the native side, with no JavaScript in between.
 *
 * A sticky header moved by a transform set from each scroll event lags the scroll: the event
 * reaches JavaScript, the transform is committed, and by the time Fabric mounts it the content has
 * moved on, so on a fast fling the header shudders and comes away from the edge it is pinned to.
 * React Native's own sticky headers do not, because `ScrollViewStickyHeader` maps the offset onto
 * an animated value on the native side and interpolates the header's translate from it there.
 * This is that mapping, for the engine's nodes: the scroll view's offset along one axis feeds a
 * value, the value an interpolation, the interpolation a translate, and native applies it on every
 * frame the scroll view moves.
 *
 * It goes through React Native's own `NativeAnimatedHelper`, whose node tags every other animated
 * value in the app also comes from, so none of them can collide.
 */

/** The part of React Native's `NativeAnimatedHelper` default export this uses. */
export interface NativeAnimated {
  generateNewNodeTag(): number;
  generateNewAnimationId?(): number;
  readonly API: {
    /** Run a value through `config` on the native side, and say when it has ended. */
    startAnimatingNode?(
      animationId: number,
      nodeTag: number,
      config: object,
      end: (result: { finished: boolean }) => void,
    ): void;
    stopAnimation?(animationId: number): void;
    createAnimatedNode(tag: number, config: object): void;
    connectAnimatedNodes(parentTag: number, childTag: number): void;
    disconnectAnimatedNodes(parentTag: number, childTag: number): void;
    connectAnimatedNodeToView(nodeTag: number, viewTag: number): void;
    disconnectAnimatedNodeFromView(nodeTag: number, viewTag: number): void;
    dropAnimatedNode(tag: number): void;
    addAnimatedEventToView(
      viewTag: number,
      eventName: string,
      mapping: { nativeEventPath: string[]; animatedValueTag: number },
    ): void;
    removeAnimatedEventFromView(viewTag: number, eventName: string, nodeTag: number): void;
    setAnimatedNodeValue(nodeTag: number, value: number): void;
    flushQueue?(): void;
  };
}

import type { DrivenChannels } from './scroll-animation.ts';

export type ScrollAxis = 'x' | 'y';

/** A native event that feeds a value: the events carrying it, and the path to it in each. */
export interface EventFeed {
  readonly events: readonly string[];
  readonly path: readonly string[];
}

/** What a driven view moves along. */
export type DrivenProperty = 'translateX' | 'translateY';

/** Where a driven view sits for each scroll offset, as an interpolation clamped at both ends. */
export interface ScrollRange {
  readonly input: readonly number[];
  readonly output: readonly number[];
}

/** A transform native keeps beside the driven translate, such as an inverted list's flip. */
export type StaticTransform = Readonly<Record<string, number>>;

/**
 * A view moved by a scroll. `update` moves it by a new range; `shift` adds an amount to where the
 * range puts it, for a drive made with one; `stop` lets it go.
 */
export interface ScrollDrive {
  update(range: ScrollRange): void;
  shift(amount: number): void;
  stop(): void;
}

interface Offset {
  readonly value: number;
  readonly viewTag: number;
  readonly feed: EventFeed;
  users: number;
}

interface Nodes {
  interpolation: number;
  /** The shift JavaScript sets, and the sum of it and the interpolation, for a shifted drive. */
  shift: number | null;
  sum: number | null;
  transform: number;
  style: number;
  props: number;
}

interface Drive {
  viewTag: number | null;
  range: ScrollRange;
  /** The amount added to the range's translate, or null for a drive without one. */
  shift: number | null;
  nodes: Nodes | null;
  stopped: boolean;
}

/**
 * Told of each view a graph is connected to, with the props it sets there. Once a graph has set
 * a view's `transform` or `opacity`, React Native lets no commit change it again: iOS skips both
 * for good (`propKeysManagedByAnimated`), and Android puts the last value set back over each
 * commit's (`overrideBySynchronousMountPropsAtMountingAndroid`), until the view is made again.
 */
export type Touched = (view: object, viewTag: number, keys: readonly string[]) => void;

/**
 * What a view is set to on native with no animation, where a graph has set it before: see
 * `NativeScrollDriver.set`. A transform is each entry's amount: points, a factor, or an angle in
 * radians.
 */
export interface SetValues {
  opacity?: number;
  transform?: readonly { readonly property: string; readonly value: number }[];
}

/** The graph that sets a view's values: a value node for each number, by its path. */
interface Setter {
  readonly tag: number;
  readonly shape: string;
  readonly props: number;
  /** Every node made, the props node first, for dropping them. */
  readonly nodes: readonly number[];
  readonly leaves: ReadonlyMap<string, number>;
}

/** The style keys a graph's channels set. */
function channelKeys(channels: DrivenChannels): string[] {
  const keys = Object.keys(channels.colors ?? {});
  if (channels.opacity) keys.push('opacity');
  if (channels.transform.length) keys.push('transform');
  return keys;
}

/** Every number a set of values holds, by its path in the graph. */
function leavesOf(values: SetValues): Map<string, number> {
  const leaves = new Map<string, number>();
  if (values.opacity !== undefined) leaves.set('opacity', values.opacity);
  values.transform?.forEach((entry, at) => leaves.set(`transform.${at}`, entry.value));
  return leaves;
}

/** What makes two sets of values the same graph: which keys, and the transform's properties. */
function shapeOf(values: SetValues): string {
  const transform = values.transform?.map((entry) => entry.property).join(',');
  return `${values.opacity === undefined ? '' : 'o'}|${transform ?? '-'}`;
}

const NONE_HELD: ReadonlySet<string> = new Set();

export class NativeScrollDriver {
  private readonly native: NativeAnimated;
  private readonly touched: Touched | undefined;
  /** One value per source view and feed, by the feed's key. */
  private readonly offsets = new Map<object, Map<string, Offset>>();
  private readonly pending = new Set<() => boolean>();
  /** The keys each graph connected to a view sets, by its props node, while it is connected. */
  private readonly live = new WeakMap<object, Map<number, readonly string[]>>();
  /** The graph setting each view's values, where one does: see `set`. */
  private readonly setters = new WeakMap<object, Setter>();

  constructor(native: NativeAnimated, touched?: Touched) {
    this.native = native;
    this.touched = touched;
  }

  /** The style keys a graph of this driver's playing or driving a view sets on it now. */
  held(view: object): ReadonlySet<string> {
    const graphs = this.live.get(view);
    return graphs ? new Set([...graphs.values()].flat()) : NONE_HELD;
  }

  /**
   * Set a view's values on native, where a graph that has let it go set them before and no commit
   * can now (see `Touched`). One graph per view, connected until the view is let go or a graph
   * that plays it is connected: a value node for each number, set where it changed.
   */
  set(view: object, viewTag: number, values: SetValues): void {
    const { API } = this.native;
    const shape = shapeOf(values);
    let setter = this.setters.get(view);
    const fresh = setter?.tag !== viewTag || setter.shape !== shape;
    if (fresh) {
      this.forget(view);
      setter = this.buildSetter(viewTag, shape, values);
      this.setters.set(view, setter);
      this.touched?.(view, viewTag, Object.keys(values));
    }
    for (const [path, value] of leavesOf(values)) {
      API.setAnimatedNodeValue(setter!.leaves.get(path)!, value);
    }
    this.flush();
  }

  /** Let go of a view `set` set values on: it is made again, or gone. */
  forget(view: object): void {
    const setter = this.setters.get(view);
    if (!setter) return;
    this.setters.delete(view);
    const { API } = this.native;
    API.disconnectAnimatedNodeFromView(setter.props, setter.tag);
    for (const node of setter.nodes) API.dropAnimatedNode(node);
    this.flush();
  }

  private buildSetter(viewTag: number, shape: string, values: SetValues): Setter {
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
    if (values.transform) {
      const transforms = values.transform.map((entry, at) => ({
        type: 'animated',
        property: entry.property,
        nodeTag: leaf(`transform.${at}`, entry.value),
      }));
      const transform = made({ type: 'transform', transforms });
      for (const entry of transforms) API.connectAnimatedNodes(entry.nodeTag, transform);
      style['transform'] = transform;
    }
    // A style node between, as `Animated` builds it: see `build`.
    const styleNode = made({ type: 'style', style });
    for (const node of Object.values(style)) API.connectAnimatedNodes(node, styleNode);
    const props = made({ type: 'props', props: { style: styleNode } });
    API.connectAnimatedNodes(styleNode, props);
    API.connectAnimatedNodeToView(props, viewTag);
    return { tag: viewTag, shape, props, nodes: nodes.reverse(), leaves };
  }

  /**
   * Note a graph connected to a view, for `held`, and tell whoever asked of it. The graph that
   * set the view's values lets go: the one that plays it sets them from here.
   */
  private hold(view: object, viewTag: number, props: number, keys: readonly string[]): void {
    this.forget(view);
    const graphs = this.live.get(view) ?? new Map<number, readonly string[]>();
    this.live.set(view, graphs.set(props, keys));
    this.touched?.(view, viewTag, keys);
  }

  private letGo(view: object, props: number): void {
    const graphs = this.live.get(view);
    if (graphs?.delete(props) && !graphs.size) this.live.delete(view);
  }

  /**
   * Move a view by a scroll. `tagOf` answers a node's view tag once it has been committed, and
   * null before, which is why the connection may wait for a commit: `connect` is tried again by
   * `afterCommit` until both views exist.
   */
  drive(
    view: object,
    source: object,
    feed: EventFeed,
    property: DrivenProperty,
    range: ScrollRange,
    statics: readonly StaticTransform[],
    tagOf: (node: object) => number | null,
    shift: number | null = null,
  ): ScrollDrive {
    const drive: Drive = { viewTag: null, range, shift, nodes: null, stopped: false };
    const key = feedKey(feed);
    const connect = (): boolean => {
      if (drive.stopped) return true;
      const viewTag = tagOf(view);
      const sourceTag = tagOf(source);
      if (viewTag === null || sourceTag === null) return false;
      drive.viewTag = viewTag;
      const offset = this.offset(source, sourceTag, feed, key);
      drive.nodes = this.build(offset.value, viewTag, property, drive, statics);
      this.hold(view, viewTag, drive.nodes.props, ['transform']);
      this.flush();
      return true;
    };
    if (!connect()) this.pending.add(connect);
    return {
      update: (next) => {
        if (drive.stopped || sameRange(drive.range, next)) return;
        drive.range = next;
        if (!drive.nodes || drive.viewTag === null) return;
        this.tearDown(drive.nodes, drive.viewTag);
        this.letGo(view, drive.nodes.props);
        const offset = this.offsets.get(source)!.get(key)!;
        drive.nodes = this.build(offset.value, drive.viewTag, property, drive, statics);
        this.hold(view, drive.viewTag, drive.nodes.props, ['transform']);
        this.flush();
      },
      shift: (amount) => {
        if (drive.stopped || drive.shift === null || drive.shift === amount) return;
        drive.shift = amount;
        if (drive.nodes?.shift == null) return;
        this.native.API.setAnimatedNodeValue(drive.nodes.shift, amount);
        this.flush();
      },
      stop: () => {
        if (drive.stopped) return;
        drive.stopped = true;
        this.pending.delete(connect);
        if (!drive.nodes || drive.viewTag === null) return;
        this.tearDown(drive.nodes, drive.viewTag);
        this.letGo(view, drive.nodes.props);
        this.release(source, key);
        this.flush();
      },
    };
  }

  /**
   * Play a view's opacity and transform by a scroll: each channel an interpolation from the
   * offset, as `scroll-animation.ts` lays a `@keyframes` animation along it. `update` rebuilds
   * the channels, when the scroll view says how far it scrolls; `stop` lets the view go.
   */
  animate(
    view: object,
    source: object,
    feed: EventFeed,
    channels: DrivenChannels,
    tagOf: (node: object) => number | null,
  ): { update(channels: DrivenChannels): void; stop(): void } {
    const state = {
      channels,
      viewTag: null as number | null,
      nodes: null as number[] | null,
      stopped: false,
    };
    const key = feedKey(feed);
    const connect = (): boolean => {
      if (state.stopped) return true;
      const viewTag = tagOf(view);
      const sourceTag = tagOf(source);
      if (viewTag === null || sourceTag === null) return false;
      state.viewTag = viewTag;
      const offset = this.offset(source, sourceTag, feed, key);
      state.nodes = this.buildChannels(view, offset.value, viewTag, state.channels);
      this.flush();
      return true;
    };
    if (!connect()) this.pending.add(connect);
    return {
      update: (next) => {
        if (state.stopped) return;
        state.channels = next;
        if (!state.nodes || state.viewTag === null) return;
        this.dropChannels(view, state.nodes, state.viewTag);
        const offset = this.offsets.get(source)!.get(key)!;
        state.nodes = this.buildChannels(view, offset.value, state.viewTag, next);
        this.flush();
      },
      stop: () => {
        if (state.stopped) return;
        state.stopped = true;
        this.pending.delete(connect);
        if (!state.nodes || state.viewTag === null) return;
        this.dropChannels(view, state.nodes, state.viewTag);
        this.release(source, key);
        this.flush();
      },
    };
  }

  /**
   * Play a view's opacity and transform by the clock: each channel an interpolation from a value
   * native runs from nothing to `timing.toValue`, over the frames it is given, as many times as
   * asked. Nothing runs in JavaScript while it plays. `ended` is told when native reaches the end
   * of the last iteration; `stop` lets the view go, and stops an animation still playing.
   *
   * Null where the native module cannot start an animation, and the caller plays it itself.
   */
  play(
    view: object,
    channels: DrivenChannels,
    timing: { frames: readonly number[]; toValue: number; iterations: number },
    tagOf: (node: object) => number | null,
    ended: () => void,
  ): { stop(): void } | null {
    const { API } = this.native;
    const start = API.startAnimatingNode;
    if (!start || !API.stopAnimation || !this.native.generateNewAnimationId) return null;
    const state = {
      viewTag: null as number | null,
      nodes: null as number[] | null,
      value: 0,
      id: 0,
      over: false,
    };
    const connect = (): boolean => {
      if (state.over) return true;
      const viewTag = tagOf(view);
      if (viewTag === null) return false;
      state.viewTag = viewTag;
      state.value = this.native.generateNewNodeTag();
      API.createAnimatedNode(state.value, { type: 'value', value: 0, offset: 0 });
      state.nodes = this.buildChannels(view, state.value, viewTag, channels);
      state.id = this.native.generateNewAnimationId!();
      const config = { type: 'frames', frames: [...timing.frames], toValue: timing.toValue };
      start(state.id, state.value, { ...config, iterations: timing.iterations }, (result) => {
        // Stopped rather than finished is the caller's own doing, and it knows.
        if (!result.finished || state.over) return;
        state.id = 0;
        // Written once more, to the view as it is now. A view is mounted when the task that
        // made it is over, and an animation no longer than that task is over before there is a
        // view to move: the view is then mounted at the frame the animation started from.
        API.setAnimatedNodeValue(state.value, timing.toValue);
        this.flush();
        ended();
      });
      this.flush();
      return true;
    };
    if (!connect()) this.pending.add(connect);
    return {
      stop: () => {
        if (state.over) return;
        state.over = true;
        this.pending.delete(connect);
        if (!state.nodes || state.viewTag === null) return;
        if (state.id) API.stopAnimation!(state.id);
        this.dropChannels(view, state.nodes, state.viewTag);
        API.dropAnimatedNode(state.value);
        this.flush();
      },
    };
  }

  /** The nodes for a set of channels, connected to the view; the props node first. */
  private buildChannels(
    view: object,
    value: number,
    viewTag: number,
    channels: DrivenChannels,
  ): number[] {
    const { API } = this.native;
    const made: number[] = [];
    const interpolation = (range: ScrollRange): number => {
      const tag = this.native.generateNewNodeTag();
      API.createAnimatedNode(tag, {
        type: 'interpolation',
        inputRange: [...range.input],
        outputRange: [...range.output],
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      API.connectAnimatedNodes(value, tag);
      made.push(tag);
      return tag;
    };
    const style: Record<string, number> = {};
    if (channels.opacity) style['opacity'] = interpolation(channels.opacity);
    for (const [property, parts] of Object.entries(channels.colors ?? {})) {
      const [r, g, b, a] = parts.map(interpolation);
      const colour = this.native.generateNewNodeTag();
      API.createAnimatedNode(colour, { type: 'color', r, g, b, a });
      for (const part of [r, g, b, a]) API.connectAnimatedNodes(part!, colour);
      style[property] = colour;
      made.push(colour);
    }
    if (channels.transform.length) {
      const transforms = channels.transform.map((channel) =>
        'range' in channel
          ? { type: 'animated', property: channel.property, nodeTag: interpolation(channel.range) }
          : { type: 'static', property: channel.property, value: channel.value },
      );
      const transform = this.native.generateNewNodeTag();
      API.createAnimatedNode(transform, { type: 'transform', transforms });
      for (const entry of transforms) {
        if (entry.type === 'animated') API.connectAnimatedNodes(entry.nodeTag!, transform);
      }
      style['transform'] = transform;
      made.push(transform);
    }
    const styleTag = this.native.generateNewNodeTag();
    API.createAnimatedNode(styleTag, { type: 'style', style });
    for (const tag of Object.values(style)) API.connectAnimatedNodes(tag, styleTag);
    const props = this.native.generateNewNodeTag();
    API.createAnimatedNode(props, { type: 'props', props: { style: styleTag } });
    API.connectAnimatedNodes(styleTag, props);
    API.connectAnimatedNodeToView(props, viewTag);
    this.hold(view, viewTag, props, channelKeys(channels));
    return [props, styleTag, ...made.reverse()];
  }

  private dropChannels(view: object, nodes: readonly number[], viewTag: number): void {
    const { API } = this.native;
    this.letGo(view, nodes[0]!);
    API.disconnectAnimatedNodeFromView(nodes[0]!, viewTag);
    for (const tag of nodes) API.dropAnimatedNode(tag);
  }

  /** Connects every drive still waiting for its views, now that a commit may have made them. */
  afterCommit(): void {
    for (const connect of [...this.pending]) if (connect()) this.pending.delete(connect);
  }

  /** One value per source view and feed, fed by its events, shared by every view it drives. */
  private offset(source: object, viewTag: number, feed: EventFeed, key: string): Offset {
    let feeds = this.offsets.get(source);
    if (!feeds) this.offsets.set(source, (feeds = new Map()));
    let offset = feeds.get(key);
    if (!offset) {
      const value = this.native.generateNewNodeTag();
      this.native.API.createAnimatedNode(value, { type: 'value', value: 0, offset: 0 });
      for (const event of feed.events) {
        this.native.API.addAnimatedEventToView(viewTag, event, {
          nativeEventPath: [...feed.path],
          animatedValueTag: value,
        });
      }
      offset = { value, viewTag, feed, users: 0 };
      feeds.set(key, offset);
    }
    offset.users++;
    return offset;
  }

  private release(source: object, key: string): void {
    const feeds = this.offsets.get(source);
    const offset = feeds?.get(key);
    if (!feeds || !offset || --offset.users > 0) return;
    feeds.delete(key);
    if (feeds.size === 0) this.offsets.delete(source);
    for (const event of offset.feed.events) {
      this.native.API.removeAnimatedEventFromView(offset.viewTag, event, offset.value);
    }
    this.native.API.dropAnimatedNode(offset.value);
  }

  private build(
    value: number,
    viewTag: number,
    property: DrivenProperty,
    drive: Drive,
    statics: readonly StaticTransform[],
  ): Nodes {
    const { API } = this.native;
    const range = drive.range;
    const interpolation = this.native.generateNewNodeTag();
    API.createAnimatedNode(interpolation, {
      type: 'interpolation',
      inputRange: [...range.input],
      outputRange: [...range.output],
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    let shift: number | null = null;
    let sum: number | null = null;
    if (drive.shift !== null) {
      shift = this.native.generateNewNodeTag();
      API.createAnimatedNode(shift, { type: 'value', value: drive.shift, offset: 0 });
      sum = this.native.generateNewNodeTag();
      API.createAnimatedNode(sum, { type: 'addition', input: [interpolation, shift] });
    }
    const transform = this.native.generateNewNodeTag();
    API.createAnimatedNode(transform, {
      type: 'transform',
      transforms: [
        {
          type: 'animated',
          property,
          nodeTag: sum ?? interpolation,
        },
        ...statics.flatMap((entry) =>
          Object.entries(entry).map(([property, amount]) => ({
            type: 'static',
            property,
            value: amount,
          })),
        ),
      ],
    });
    // A style node between, as `Animated` builds it: RN's props node on iOS reads its values from
    // a style node and ignores a transform node connected to it directly.
    const style = this.native.generateNewNodeTag();
    API.createAnimatedNode(style, { type: 'style', style: { transform } });
    const props = this.native.generateNewNodeTag();
    API.createAnimatedNode(props, { type: 'props', props: { style } });
    API.connectAnimatedNodes(value, interpolation);
    if (shift !== null && sum !== null) {
      API.connectAnimatedNodes(interpolation, sum);
      API.connectAnimatedNodes(shift, sum);
      API.connectAnimatedNodes(sum, transform);
    } else {
      API.connectAnimatedNodes(interpolation, transform);
    }
    API.connectAnimatedNodes(transform, style);
    API.connectAnimatedNodes(style, props);
    API.connectAnimatedNodeToView(props, viewTag);
    return { interpolation, shift, sum, transform, style, props };
  }

  private tearDown(nodes: Nodes, viewTag: number): void {
    const { API } = this.native;
    API.disconnectAnimatedNodeFromView(nodes.props, viewTag);
    API.dropAnimatedNode(nodes.props);
    API.dropAnimatedNode(nodes.style);
    API.dropAnimatedNode(nodes.transform);
    if (nodes.sum !== null) API.dropAnimatedNode(nodes.sum);
    if (nodes.shift !== null) API.dropAnimatedNode(nodes.shift);
    API.dropAnimatedNode(nodes.interpolation);
  }

  private flush(): void {
    this.native.API.flushQueue?.();
  }
}

function feedKey(feed: EventFeed): string {
  return `${feed.events.join(',')}:${feed.path.join('.')}`;
}

/** A scroll view's offset along an axis, as `onScroll` carries it. */
export function scrollFeed(axis: ScrollAxis): EventFeed {
  return { events: ['onScroll'], path: ['contentOffset', axis] };
}

function sameRange(a: ScrollRange, b: ScrollRange): boolean {
  return (
    a.input.length === b.input.length &&
    a.input.every((value, i) => value === b.input[i]) &&
    a.output.every((value, i) => value === b.output[i])
  );
}

/**
 * The translate a pinned view needs at each scroll offset: none until the offset reaches where
 * the view starts, then the offset past that, until `until`, where the next pinned view pushes it
 * off and it stays. `start` and `until` are in the scroll view's own coordinates.
 */
export function pinnedRange(start: number, until = Infinity): ScrollRange {
  if (!Number.isFinite(until) || until <= start) {
    // A large finite end, since native interpolation takes numbers and extends nothing here.
    return { input: [start, start + 1e7], output: [0, 1e7] };
  }
  return { input: [start, until], output: [0, until - start] };
}
