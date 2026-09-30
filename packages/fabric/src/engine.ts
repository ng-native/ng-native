/**
 * Framework-agnostic retained tree + incremental Fabric commit.
 * Nothing Angular-specific may enter this file; lint bans the import (see docs/ARCHITECTURE.md).
 *
 * Angular mutates; Fabric is persistent. A committed node is never mutated, it is cloned with
 * new props and/or a new child set. Cloning a leaf therefore forces every ancestor to re-clone,
 * because a persistent parent holds references to specific child handles. That bubble is
 * inherent and is what React's own Fabric renderer does.
 */

import {
  StyleResolver,
  type Conditions,
  type StyleCache,
  type StyleSheet,
  type TokenValue,
} from './css.ts';
import {
  animationEvent,
  bezier,
  interpolate,
  sample,
  step,
  tracksOf,
  type AnimationSpec,
  type Keyframe,
  type RunningAnimation,
  type Transition,
  type TransitionSpec,
} from './transition.ts';
import { isFormsInput } from './forms-inputs.ts';
import { transformList } from './inline-transform.ts';
import { tokenFromValue } from './inline-token.ts';
import {
  NativeScrollDriver,
  scrollFeed,
  type DrivenProperty,
  type EventFeed,
  type NativeAnimated,
  type ScrollAxis,
  type ScrollDrive,
  type ScrollRange,
  type StaticTransform,
} from './native-drive.ts';
import type { DrivenChannels } from './scroll-animation.ts';

export type FabricNode = { readonly __fabricNode: unique symbol } | object;

/** Where a node is, in the window's coordinates. What `Engine.measure` reports. */
import type { HostEngine, HostNode, Settling } from './host.ts';
import { firstFrame, rangeOf, scrollChannels } from './scroll-animation.ts';
import { FontFaces } from './font-faces.ts';

/**
 * The animation a node's style asks for, with a play state from a rule of its own applied. Both
 * are instructions for this engine and nothing native has heard of them, so they come out of the
 * props; only when there, because a `delete` sends an object to Hermes's slow dictionary layout,
 * and this runs for every node that commits.
 */
function animationOf(props: Record<string, unknown>): AnimationSpec | undefined {
  const spec = props['$animation'] as AnimationSpec | undefined;
  if (spec !== undefined) delete props['$animation'];
  const playState = props['$playState'] as 'running' | 'paused' | undefined;
  if (playState === undefined) return spec;
  delete props['$playState'];
  return spec && { ...spec, paused: playState === 'paused' };
}

/**
 * Whether two specs ask for the same animation. By what they say rather than which object they
 * are: a spec with a token in its timing is settled afresh each time the node's style is, and an
 * animation that started again on every such commit would never get past its first frame.
 */
function sameAnimation(a: AnimationSpec, b: AnimationSpec): boolean {
  if (a === b) return true;
  return (
    SPEC_FIELDS.every((field) => a[field] === b[field]) &&
    a.easing.join() === b.easing.join() &&
    a.range?.start === b.range?.start &&
    a.range?.end === b.range?.end
  );
}

const SPEC_FIELDS = [
  'name',
  'duration',
  'delay',
  'iterations',
  'fill',
  'direction',
  'timeline',
] as const satisfies readonly (keyof AnimationSpec)[];

/** A node's scroll-driven animation: what it plays, what drives it, and the frame it commits. */
interface ScrollAnimation {
  readonly spec: AnimationSpec;
  readonly tracks: ReadonlyMap<string, readonly { offset: number; value: unknown }[]>;
  readonly resting: Record<string, unknown>;
  readonly first: Record<string, unknown>;
  readonly source: EngineNode | null;
  readonly drive: { update(channels: DrivenChannels): void; stop(): void } | null;
}

export interface WindowFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type FabricNodeSet = unknown;

/** The slice of `global.nativeFabricUIManager` we actually use. */
export interface FabricUIManager {
  createNode(
    reactTag: number,
    viewName: string,
    rootTag: number,
    props: object,
    instanceHandle: unknown,
  ): FabricNode;
  /** Clone with the *given* children (omitting the argument means none) and the same props. */
  cloneNodeWithNewChildren(node: FabricNode): FabricNode;
  /** Clone with the given props and the *same* children. */
  cloneNodeWithNewProps(node: FabricNode, newProps: object): FabricNode;
  /** Clone with the given props and the given children (omitting them means none). */
  cloneNodeWithNewChildrenAndProps(node: FabricNode, newProps: object): FabricNode;
  appendChild(parent: FabricNode, child: FabricNode): FabricNode;
  createChildSet(rootTag: number): FabricNodeSet;
  appendChildToSet(set: FabricNodeSet, child: FabricNode): void;
  completeRoot(rootTag: number, set: FabricNodeSet): void;
  registerEventHandler?(
    handler: (instanceHandle: unknown, topLevelType: string, nativeEvent: unknown) => void,
  ): void;
  /** Tells the native side that JS owns the gesture, and whether to stop its own. */
  setIsJSResponder?(node: FabricNode, isResponder: boolean, blockNativeResponder: boolean): void;
  /** A view command: `focus` on a text input, `scrollTo` on a scroll view. */
  dispatchCommand?(node: FabricNode, name: string, args: readonly unknown[]): void;
  /**
   * A node's frame in window coordinates, which is the only frame two nodes can be compared in.
   *
   * Optional because an older host may not have it, and because the callback is the platform's
   * own shape: on the new architecture it fires before this returns, which is what lets an
   * overlay place itself in the same frame it was opened in.
   */
  measureInWindow?(
    node: FabricNode,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
  ): void;
}

/**
 * RN's `directEventTypes`: delivered to the target only, never up the tree. Everything else
 * bubbles, which matches RN's `bubblingEventTypes` for the touch and input events that matter.
 *
 * ponytail: a hand-kept set rather than real ViewConfigs. It is wrong only for a nested
 * scroll view, where an ancestor listening for the same direct event would not fire (correct)
 * but a third-party component's custom direct event would bubble (harmless in practice).
 * Swap it for per-component ViewConfig metadata if that ever matters.
 */
/**
 * The scroll events that mean a finger is dragging the list rather than tapping something in it.
 *
 * `topScrollBeginDrag` is the precise one; `topScroll` is here because a scroll view configured
 * without drag events still reports movement, and a press surviving that is the bug either way.
 */
const SCROLL_CANCELS_PRESS = new Set(['topScroll', 'topScrollBeginDrag']);

const DIRECT_EVENTS = new Set([
  'topScroll',
  'topScrollBeginDrag',
  'topScrollEndDrag',
  'topMomentumScrollBegin',
  'topMomentumScrollEnd',
  'topScrollToTop',
  'topContentSizeChange',
  'topLayout',
  'topLoad',
  'topLoadStart',
  'topLoadEnd',
  'topError',
  'topProgress',
  'topRefresh',
  'topTextLayout',
  // react-native-screens. `topDismissed` is how a swipe-back or a native back button reaches
  // JS, and it must not bubble: the stack above would see its child's pop as its own.
  'topDismissed',
  'topNativeDismissCancelled',
  'topWillAppear',
  'topAppear',
  'topWillDisappear',
  'topDisappear',
  'topHeaderHeightChange',
  'topTransitionProgress',
  'topFinishTransitioning',
  // The tabs host reports its own selection, and only the host it happened in wants to know.
  'topTabSelected',
  // Safe-area insets, reported by the provider that measured them.
  'topInsetsChange',
]);

/**
 * What a listener receives. RN's synthetic event carries more, but `nativeEvent` is the part
 * every RN API is documented against, and `stopPropagation` is the part a nested control needs.
 *
 * `stopPropagation` ends the walk to the root after the current node, as it does in the DOM and
 * on RN's `SyntheticEvent`: the other listeners on the node that called it still run. It does not
 * touch the responder negotiation, which has already finished by the time a listener sees the
 * event, so it cannot take a press away from a pressable; the negotiation already keeps an inner
 * pressable's press from reaching the one around it.
 */
export interface NativeSyntheticEvent<T = unknown> {
  readonly nativeEvent: T;
  stopPropagation(): void;
  isPropagationStopped(): boolean;
}

/**
 * The event object a dispatch hands every listener along the path. Exported so another host can
 * hand its listeners the same shape rather than a bare `{ nativeEvent }` that lacks the methods
 * the type promises.
 */
export class SyntheticEvent<T = unknown> implements NativeSyntheticEvent<T> {
  readonly nativeEvent: T;
  private stopped = false;

  constructor(nativeEvent: T) {
    this.nativeEvent = nativeEvent;
  }

  stopPropagation(): void {
    this.stopped = true;
  }

  isPropagationStopped(): boolean {
    return this.stopped;
  }
}

/**
 * The JS responder system: RN's second touch layer, and the renderer's job rather than the app's.
 *
 * Fabric delivers raw touches to whichever node was hit. On top of that, React runs a negotiation
 * deciding *who owns the gesture*: a capture pass from the root down, then a bubble pass from the
 * target up, electing a single responder that alone receives grant/move/release/terminate. When
 * ownership changes the renderer tells native through `setIsJSResponder`, which is how a JS
 * control stops a native scroll view from also scrolling.
 *
 * All of RN's `Pressability` sits on this, never on raw touch events. Without it there is no way
 * for a button and an enclosing scroll view to agree on who owns a drag.
 */
/**
 * What a touch event carries. The responder system is touch-only, so its handlers are typed
 * against this rather than `unknown`: every consumer wants the coordinates and would otherwise
 * cast to get at them.
 */
export interface TouchPayload {
  readonly pageX?: number;
  readonly pageY?: number;
  readonly locationX?: number;
  readonly locationY?: number;
  readonly identifier?: number;
  readonly target?: number;
  readonly timestamp?: number;
}

export type ResponderEvent = NativeSyntheticEvent<TouchPayload>;

export interface ResponderHandlers {
  /** The `target` is the node the touch landed on, which a capturing ancestor may inspect. */
  onStartShouldSetResponderCapture?(event: ResponderEvent, target: EngineNode): boolean;
  onStartShouldSetResponder?(event: ResponderEvent, target: EngineNode): boolean;
  onMoveShouldSetResponderCapture?(event: ResponderEvent, target: EngineNode): boolean;
  onMoveShouldSetResponder?(event: ResponderEvent, target: EngineNode): boolean;
  onResponderGrant?(event: ResponderEvent): void;
  onResponderMove?(event: ResponderEvent): void;
  onResponderRelease?(event: ResponderEvent): void;
  onResponderTerminate?(event: ResponderEvent): void;
  /** Return false to keep the gesture when something else asks for it. Defaults to allowing. */
  onResponderTerminationRequest?(event: ResponderEvent): boolean;
  /** Ask native to stop its own gesture while we hold the responder (a slider inside a list). */
  blockNativeResponder?: boolean;
}

/**
 * Events the native side will not emit unless a **prop** opts in, separately from anyone
 * listening. `ShadowTree.cpp` guards the layout notification with `if (viewProps->onLayout)`,
 * so a view that never sets the prop is never measured, however many listeners it has.
 *
 * React gets this for free: attaching a handler puts `onLayout` in the props object. A renderer
 * that keeps listeners in its own registry has to set the prop deliberately, and the failure is
 * silent - the callback simply never runs.
 */
const EVENT_OPT_IN_PROPS: Record<string, string> = {
  topLayout: 'onLayout',
  /*
   * Hover, which exists on this platform after all.
   *
   * React Native implements the W3C pointer events, and on iPadOS a connected trackpad or mouse
   * produces them: `onPointerEnter` and `onPointerLeave` fire as the cursor crosses a view. A
   * phone never sends them, so this costs a phone two props and nothing else, and it is what
   * makes a hover style reachable on the one device that has a pointer.
   */
  topPointerEnter: 'onPointerEnter',
  topPointerLeave: 'onPointerLeave',
};

/**
 * The same opt-in, for events one view type guards with a prop of its own. Android's
 * `ReactImageView` emits no load events at all unless `shouldNotifyLoadEvents` is set, which
 * `Image.android.js` does whenever any load handler is attached. iOS ignores the prop.
 */
const VIEW_EVENT_OPT_IN_PROPS: Record<string, Record<string, string>> = {
  Image: {
    topLoadStart: 'shouldNotifyLoadEvents',
    topLoad: 'shouldNotifyLoadEvents',
    topLoadEnd: 'shouldNotifyLoadEvents',
    topError: 'shouldNotifyLoadEvents',
    topProgress: 'shouldNotifyLoadEvents',
  },
};

/**
 * Props the engine itself writes or reads off a node, so never a misspelling: the style, the
 * event opt-ins, and the bookkeeping keys that never reach native. See `checkProps`.
 */
const ENGINE_PROPS = new Set<string>([
  'style',
  'collapsable',
  // Read by the cascade for `:disabled`, whether or not the native view takes it.
  'disabled',
  'intrinsicSize',
  'styleOverride',
  ...Object.values(EVENT_OPT_IN_PROPS),
  ...Object.values(VIEW_EVENT_OPT_IN_PROPS).flatMap((props) => Object.values(props)),
]);

/** Touch events that drive the responder negotiation. */
const TOUCH_START = 'topTouchStart';
const TOUCH_MOVE = 'topTouchMove';
const TOUCH_END = 'topTouchEnd';
const TOUCH_CANCEL = 'topTouchCancel';

export type NodeKind = 'element' | 'text' | 'anchor';

/** What Fabric currently holds for a node. `null` until the node has been committed once. */
interface Committed {
  handle: FabricNode;
  /**
   * The react tag this node was created with. Kept because the native animation driver addresses
   * a view by tag and has no other way to find one of ours: `findNodeHandle` returns a number it
   * is given unchanged, so a tag is all an animated graph needs to point here.
   */
  tag: number;
  props: Record<string, unknown>;
  /** The child handles this node was committed with, in order. */
  childHandles: FabricNode[];
}

export interface EngineNode extends HostNode {
  readonly kind: NodeKind;
  /** Lowercase template spelling, e.g. `view`. Never the native view name. */
  readonly name: string;
  /** `name` again, for Angular 22.0, which reads it on a component's host element. */
  readonly tagName: string;
  props: Record<string, unknown>;
  text: string;
  children: EngineNode[];
  parent: EngineNode | null;
  listeners: Map<string, Set<(event: unknown) => void>> | null;

  /** CSS classes on this node, for selector matching. */
  classes: Set<string> | null;
  /** The compiled stylesheet of the component that created this node, if any. */
  sheet: StyleSheet | null;
  /** The sheet of the component this node hosts, if it hosts one. What `:host` matches against. */
  hostSheet: StyleSheet | null;
  /** Custom properties set on the node itself; see `StyleTarget.customProperties`. */
  customProperties: Record<string, TokenValue> | null;
  /** Resolved style, memoised across commits. Owned by the CSS resolver. */
  styleCache: StyleCache | null;
  /** Set when something that could change what this node matches has changed. */
  styleDirty: boolean;
  /** `:focus`, from the native focus and blur events. */
  focused?: boolean;
  /** `:active`, set on the responder and every ancestor of it. */
  active?: boolean;
  /**
   * The style object the platform adapter made for this node, and may therefore write into.
   *
   * Angular sets style properties one at a time, so building a fresh object per property means a
   * style of ten properties costs ten copies of a growing object, for every element that has one.
   * An object the adapter created is its to mutate; one that arrived any other way is copied,
   * once. A field rather than a `WeakSet` of such objects, which Hermes makes slow to consult.
   */
  ownStyle?: object;
  /** The resolved style this node was last committed with, for the skip check in `reconcile`. */
  styleCommitted: StyleCache | null;
  /**
   * Per-property transition state, for every property this node has ever seen a `transition` for.
   * A finished entry stays, because its target is what the next change is measured against.
   */
  transitions?: Map<string, Transition>;
  /** The `@keyframes` animation this node is playing, if any. One at a time. */
  playing?: RunningAnimation;
  /** An animation played by a scroll view's offset rather than the clock. See `scrollAnimated`. */
  scrolled?: ScrollAnimation;
  /**
   * The last `transform` built from the individual transform properties, and what it was built
   * from. Reused while the parts are the same objects, so an unrelated change does not re-send it.
   */
  composedTransform?: { parts: readonly unknown[]; value: unknown[] };
  /**
   * Set by the component that owns this element. A host primitive that reaches a commit without it
   * was written in a template that never imported the component, which is reported in dev.
   */
  claimed?: true;
  /**
   * Set by the platform adapter when Angular mounts a component on this element. What makes an
   * `<x-card>` host legitimate where a `<veiw>` typo is not, since both are names no view table
   * knows. See `markComponentHost`.
   */
  componentHost?: true;

  /**
   * Hoisted nodes (`registerHoist`) inside this subtree while it is out of the tree, held here
   * rather than by the engine. See `Engine.releaseDetached`.
   */
  dormantHoists?: EngineNode[] | null;

  committed: Committed | null;
  /** The node this one was committed as a child of, which native holds it to for its life. */
  committedUnder: EngineNode | null;
  /** The hoisted views this node keeps committed for, by element name. See `HoistOptions`. */
  kept?: Map<string, KeptHoist>;
  /** Commit this node again with its children so Fabric measures it again. `remeasureText`. */
  remeasure?: true;
  /**
   * A modal host committed as visible on iOS whose dismissal native has not yet reported. It
   * stays committed after `visible` goes false until `topDismiss`, as React Native's Modal.js
   * keeps it for the dismissal animation. See `Engine.withheld`.
   */
  presented?: true;
  /** This node's own props changed. */
  propsDirty: boolean;
  /** This node's child list changed. */
  structureDirty: boolean;
  /** Something below this node is dirty, so the walk must descend. */
  subtreeDirty: boolean;
}

/**
 * Canonical Fabric component names, taken from `RCTFabricComponentsPlugins.mm` and the C++
 * `ComponentName[]` declarations rather than guessed. Legacy `RCT`-prefixed names also work
 * today, but only through `componentNameByReactViewName`, a documented transition-period shim
 * that strips the prefix and maps `Text` to `Paragraph`.
 */
const VIEW_NAMES: Record<string, string | PlatformViewName> = {
  view: 'View',
  text: 'Paragraph',
  image: 'Image',
  'scroll-view': 'ScrollView',
  'safe-area-view': 'SafeAreaView',
  modal: 'ModalHostView',
  switch: 'Switch',
  'text-input': 'TextInput',
  'activity-indicator': 'ActivityIndicatorView',
  'refresh-control': 'PullToRefreshView',
  'input-accessory-view': 'InputAccessoryView',
  // Composites from the components package. Their host is a plain view; they are listed so a
  // template that uses one without importing it is reported like any other host primitive.
  pressable: 'View',
  'touchable-opacity': 'View',
  'image-background': 'View',
  'keyboard-avoiding-view': 'View',
  // The windowing component; its host really is a native scroll view.
  'virtual-list': 'ScrollView',
};

/**
 * The element names above, as they were before any app registered its own.
 *
 * Only these have a component in `@ng-native/components` to forget to import, which is what
 * the dev-mode check below is about. A name added by `registerViewName` may have nothing behind
 * it on purpose: an Expo view driven as a plain element is the whole point of
 * `@ng-native/expo`, and warning about it would be noise.
 */
const PRIMITIVE_NAMES = new Set(Object.keys(VIEW_NAMES));

/**
 * The props each host primitive's native view is sent, by element name, as the components
 * declare them: every input the element's component has, and the props it writes that no input
 * carries. What the development check for a misspelt prop compares against. See
 * `declareNativeProps`.
 */
const DECLARED_PROPS = new Map<string, Set<string>>();

/**
 * Declare props the native view behind an element accepts. `@ng-native/components` calls this
 * once per host primitive with the component's inputs; an app driving a primitive's native view
 * with a prop the component has no input for can declare that prop too.
 */
export function declareNativeProps(elementName: string, props: Iterable<string>): void {
  let declared = DECLARED_PROPS.get(elementName);
  if (!declared) DECLARED_PROPS.set(elementName, (declared = new Set()));
  for (const prop of props) declared.add(prop);
}

/**
 * Mark a host element as owned by its component. The components package calls this from each
 * host primitive's constructor; see `EngineNode.claimed`.
 */
export function claimHost(node: HostNode): void {
  node.claimed = true;
}

/**
 * Mark an element as the host of a component. The platform adapter calls this from
 * `RendererFactory2.createRenderer`, which Angular calls once for every component it mounts,
 * with the host element in hand, whatever the component's selector.
 */
export function markComponentHost(node: HostNode): void {
  (node as EngineNode).componentHost = true;
}

/** `text-input` -> `TextInput`: how the components package names the class for an element. */
const className = (element: string): string =>
  element.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase());

/** Names Android registers differently. */
export const ANDROID_VIEW_NAMES: Record<string, string> = {
  switch: 'AndroidSwitch',
  'text-input': 'AndroidTextInput',
  'activity-indicator': 'AndroidProgressBar',
  'refresh-control': 'AndroidSwipeRefreshLayout',
  // Neither exists on Android; RN's own wrappers render a plain view there too.
  'safe-area-view': 'View',
  'input-accessory-view': 'View',
};

/**
 * The platform the host reported at startup. Defaults to iOS, which is what the view-name table
 * above assumes too.
 *
 * Exposed because a few of React Native's JavaScript wrappers behave differently per platform in
 * ways nothing native can infer: `Text.js` makes a text an accessibility element on iOS always,
 * and on Android only when it can be pressed.
 */
let platformOS = 'ios';

export function nativePlatform(): string {
  return platformOS;
}

/**
 * Call once at startup with `Platform.OS`. The view names above are the iOS/canonical ones, so
 * only the mapping half is a no-op elsewhere.
 */
export function registerPlatformComponents(platform: string): void {
  platformOS = platform;
  if (platform !== 'android') return;
  for (const [element, viewName] of Object.entries(ANDROID_VIEW_NAMES)) {
    registerViewName(element, viewName);
  }
}

/**
 * Props RN's JS wrappers apply before the caller's, per native view name.
 *
 * The native ScrollView does not clip on its own; RN's `ScrollView.js` supplies
 * `{flexGrow, flexShrink, flexDirection, overflow: 'scroll'}` as a base style. Omit it and the
 * content spills straight out of the scroll view's bounds, which reads as a layout bug in the
 * content rather than a missing default.
 *
 * Caller props and styles are applied on top, so any of this can be overridden.
 */
const DEFAULT_PROPS: Record<string, Record<string, unknown>> = {
  ScrollView: { flexGrow: 1, flexShrink: 1, flexDirection: 'column', overflow: 'scroll' },
  // RN's Image.ios.js: without it a border radius rounds the view but not the picture.
  Image: { overflow: 'hidden' },
  // RN's Modal.js gives the native host this; without it the modal does not lay out.
  ModalHostView: { position: 'absolute' },
  // RN's InputAccessoryView.js does the same for the keyboard bar.
  InputAccessoryView: { position: 'absolute' },
  // RN's Text.js ends truncated text in an ellipsis; native's own default is to clip. A default
  // rather than a prop the component writes, so `text-overflow` in a stylesheet can change it.
  Paragraph: { ellipsizeMode: 'tail' },
};

const RAW_TEXT = 'RawText';
/**
 * A `<text>` nested inside another `<text>` is a span, not a paragraph.
 *
 * Note the name: the C++ component really is called `Text`, but that name is **unreachable
 * from JS**. `ComponentDescriptorRegistry::at` puts every lookup through
 * `componentNameByReactViewName`, which rewrites `Text` to `Paragraph` and `VirtualText` to
 * `Text`. Sending the canonical `Text` therefore yields a Paragraph nested inside a Paragraph,
 * which Fabric treats as an inline view attachment: the run renders top-aligned and does not
 * inherit the parent's text attributes. It looks like a superscript.
 */
const VIRTUAL_TEXT = 'VirtualText';
const DEFAULT_VIEW = 'View';
/** A top-level text, the one view that aligns its lines. A nested text is a `VirtualText`. */
const PARAGRAPH = 'Paragraph';

type TextDirection = 'ltr' | 'rtl';

const textDirection = (value: unknown): TextDirection | undefined =>
  value === 'ltr' || value === 'rtl' ? value : undefined;

/**
 * Resolve a paragraph's `text-align` against its direction, as CSS does.
 *
 * React Native reads `left` and `right` relative to the layout direction: in a right-to-left
 * layout `RCTAttributedTextUtils` swaps them, so its `left` is the start edge. `start` and `end`
 * are therefore `left` and `right` whatever the direction. Where the app set a direction, the
 * default is `start`, as on the web, rather than native's natural alignment, which follows the
 * app's language and not the subtree; a physical `left` or `right` is swapped back so it stays on
 * that side; and the paragraph's base writing direction follows unless a `writing-direction` says
 * otherwise, which is what puts neutral characters such as punctuation on the right side.
 */
function alignText(props: Record<string, unknown>, direction: TextDirection | undefined): void {
  const align = props['textAlign'] as string | undefined;
  if (!direction) {
    if (align !== undefined) props['textAlign'] = LOGICAL_ALIGN.get(align) ?? align;
    return;
  }
  props['textAlign'] = TEXT_ALIGN[direction].get(align ?? 'start') ?? align;
  props['writingDirection'] ??= direction;
}

/** React Native's `textAlign` for CSS's logical values, which means the same in either direction. */
const LOGICAL_ALIGN = new Map([
  ['start', 'left'],
  ['end', 'right'],
]);

/** React Native's `textAlign` for each CSS value, in a layout of each direction. */
const TEXT_ALIGN: Readonly<Record<TextDirection, ReadonlyMap<string, string>>> = {
  ltr: new Map([...LOGICAL_ALIGN, ['auto', 'left'], ['left', 'left'], ['right', 'right']]),
  rtl: new Map([...LOGICAL_ALIGN, ['auto', 'left'], ['left', 'right'], ['right', 'left']]),
};

/** The native modal host, which is left out of a commit while `visible` is false. */
const MODAL_HOST = 'ModalHostView';

/**
 * Register a codegen'd third-party Fabric component, e.g.
 * `registerViewName('rns-screen', 'RNSScreen')`, which is how the router reaches
 * react-native-screens.
 *
 * `defaultProps` is for a component whose React wrapper supplies a base style in JS, the way
 * `ScrollView` and `Modal` do below. Driving the native component directly skips that wrapper,
 * and skipping it is not cosmetic: `RNSScreenStackHeaderConfig` without its `position: absolute`
 * joins the screen's flex layout and pushes every page down by the height of the header.
 */
export function registerViewName(
  elementName: string,
  viewName: string | PlatformViewName,
  defaultProps?: Record<string, unknown>,
): void {
  VIEW_NAMES[elementName] = viewName;
  if (!defaultProps) return;
  for (const name of typeof viewName === 'string' ? [viewName] : [viewName.ios, viewName.android]) {
    DEFAULT_PROPS[name] = defaultProps;
  }
}

/**
 * A view whose native name differs by platform. Chosen when the view is looked up rather than when
 * it is registered, so it does not matter which ran first: an app's imports register the router's
 * views before its `main.ts` gets to report the platform.
 */
export interface PlatformViewName {
  readonly ios: string;
  readonly android: string;
}

/** An element's registered view name, for the platform the host reported. */
function registeredViewName(elementName: string): string | undefined {
  const name = VIEW_NAMES[elementName];
  if (name === undefined || typeof name === 'string') return name;
  return platformOS === 'android' ? name.android : name.ios;
}

/**
 * The views Fabric measures from their text, which a change of the system text size resizes:
 * a paragraph, and a text input on either platform. See `Engine.remeasureText`.
 */
const MEASURED_VIEWS = new Set(['Paragraph', 'TextInput', 'AndroidTextInput']);

/** What each mounted app does when faces register. See `fontsRegistered`. */
const fontListeners = new Set<(families: ReadonlySet<string>) => void>();

/** Hear about faces registering with the platform, until the returned function is called. */
export function onFontsRegistered(listener: (families: ReadonlySet<string>) => void): () => void {
  fontListeners.add(listener);
  return () => fontListeners.delete(listener);
}

/**
 * Faces just registered with the platform, by the family names text asks for them by. Every
 * mounted app lays out again the paragraphs and text inputs that name one: see
 * `Engine.fontsRegistered`.
 */
export function fontsRegistered(families: Iterable<string>): void {
  const names = new Set(families);
  if (!names.size) return;
  for (const listener of [...fontListeners]) listener(names);
}

/** Whether a paragraph, or a span in it, was committed asking for one of these families. */
function namesFamily(node: EngineNode, families: ReadonlySet<string>): boolean {
  const family = node.committed?.props['fontFamily'];
  if (typeof family === 'string' && families.has(family)) return true;
  return node.children.some((child) => namesFamily(child, families));
}

/** A text size cap far above any a platform offers, so it caps nothing. See `fontsRegistered`. */
const UNCAPPED = 1000;
/**
 * How far a paragraph's cap moves each time a face it names registers: just past the 0.005 React
 * Native compares text attributes to, so the layout it cached is not found, and too little for
 * an app's own cap to cap anything visibly differently.
 */
const FONT_REFRESH_STEP = 0.006;

/** The views that take a cursor, on either platform. */
const TEXT_INPUTS = new Set(['TextInput', 'AndroidTextInput']);

/** The views that scroll their content, which `focus` brings a field into view within. */
const SCROLL_VIEWS = new Set(['ScrollView', 'AndroidHorizontalScrollView']);

/** Element name -> the element name of the ancestor it commits into. See `registerHoist`. */
const HOISTS: Record<string, string> = {};
/** The `ancestorName`s, so a commit asks only those nodes what to hoist into them. */
const HOIST_TARGETS = new Set<string>();

/**
 * Commit every `elementName` as a direct child of its nearest `ancestorName`, wherever the
 * template put it, e.g. `registerHoist('native-header', 'screen')`.
 *
 * For a native component that reads a configuration node from its own direct children and
 * nowhere else. `RNSScreen.mm` finds its header that way, so a header written inside a
 * `safe-area-view`, or inside any component a page wraps itself in, was never found: no title,
 * no back button, and nothing said why. The retained tree keeps the node where Angular put it,
 * so styles, `@if` and removal all behave as written; only what reaches Fabric moves. It lands
 * just after the ancestor's child it was written in, or after all of them when it was written in
 * the ancestor itself, which keeps a page's scroll view ahead of its header as UIKit's large
 * title wants. A node with no such ancestor commits where it is.
 */
export function registerHoist(
  elementName: string,
  ancestorName: string,
  options: HoistOptions = {},
): void {
  HOISTS[elementName] = ancestorName;
  HOIST_TARGETS.add(ancestorName);
  if (options.standIn) STAND_INS[elementName] = options.standIn;
}

export interface HoistOptions {
  /**
   * Props for a native view the ancestor keeps once the element has committed into it.
   *
   * For a configuration node the native side reads when it arrives but never forgets when it
   * leaves. `RNSScreen` hides its navigation bar when a header config it holds says `hidden`, and
   * does nothing at all when the config is taken away, so the last bar it was told about stays on
   * screen. With a stand-in, removing the element commits these props onto the same native view,
   * children dropped, and the next element of that name adopts the view rather than creating
   * another, so what the native side sees is one config that is updated, never one that goes.
   */
  standIn?: Record<string, unknown>;
}

/** Element name -> the props it leaves behind in its ancestor. See `HoistOptions.standIn`. */
const STAND_INS: Record<string, Record<string, unknown>> = {};

/** A native view an ancestor keeps for a hoisted name with a stand-in, and who it is for now. */
interface KeptHoist {
  /** The element committed as this view, or null while the stand-in props are. */
  node: EngineNode | null;
  committed: Committed;
}

/**
 * Unregistered names commit as a plain RCTView, because that is what an **Angular component
 * host element** is. Angular always creates one (`<x-card>` is a real node in the tree), and
 * it carries the component's host bindings, so it cannot be elided. Guessing a native view
 * name from the element name instead produces `Unimplemented component: <XCard>` on device.
 *
 * The cost is that a typo'd element name would render as an empty view without a word, and
 * Angular's own unknown-element check cannot help (it no-ops without a DOM). So in dev the
 * engine reports a name that nothing accounts for: not a view name, not a component host (see
 * `markComponentHost`), and not an element selector any template declared (`declareElement`).
 * Use an attribute selector (`selector: '[card]'`) on a component to avoid the extra view.
 */
/**
 * A run of text as a paragraph shows it: without the space at the paragraph's very start or end.
 *
 * Angular collapses template whitespace to a single space rather than removing it, so
 * `<text>\n  {{ name }}\n</text>` arrives as ` Ada `. A browser drops that space where a line
 * starts or ends; React Native's Text draws it, and every label written across two lines, which
 * a formatter will do to any long one, comes out indented. Spaces between runs are left alone,
 * as they are in HTML.
 *
 * ponytail: worked out when the run itself changes. A run that stops being the first or last
 * because a sibling arrived keeps its old trim until it next changes, which is a space at most.
 */
function paragraphText(node: EngineNode): string {
  let root = node.parent;
  if (root?.name !== 'text') return node.text;
  // The commonest paragraph by far: one run and nothing else, so it is both the first and last.
  if (root.children.length === 1 && root.parent?.name !== 'text') return node.text.trim();
  while (root.parent?.name === 'text') root = root.parent;
  const runs: EngineNode[] = [];
  const collect = (from: EngineNode) => {
    for (const child of from.children) {
      if (child.kind === 'text') {
        if (child.text) runs.push(child);
      } else if (child.name === 'text') collect(child);
    }
  };
  collect(root);
  let text = node.text;
  if (runs[0] === node) text = text.replace(/^\s+/, '');
  if (runs[runs.length - 1] === node) text = text.replace(/\s+$/, '');
  return text;
}

/** The part of a node `viewNameOf` reads: an engine node, or any host's mirror of one. */
export interface ViewNameNode {
  readonly kind: string;
  readonly name: string;
  readonly parent: { readonly name: string } | null;
}

/**
 * The native view a node commits as: `Paragraph` for a `<text>`, `VirtualText` for one nested in
 * another, `RawText` for a run of text, and `View` for anything unregistered, which is what an
 * Angular component's host element is.
 *
 * Exported for tools that show a template beside what it becomes, such as the X-ray in the
 * documentation's course, which labels `@ng-native/web`'s DOM with these names. It reads the same
 * table the commit does, so after `registerPlatformComponents('android')` it answers for Android.
 */
export function viewNameOf(node: ViewNameNode): string {
  if (node.kind === 'text') return RAW_TEXT;
  // RN models nested text as a span inside a paragraph: `Paragraph > [RawText, Text > RawText]`.
  // Committing a nested `<text>` as another Paragraph gives a paragraph inside a paragraph,
  // which lays out as a separate block instead of flowing inline.
  if (node.name === 'text' && node.parent?.name === 'text') return VIRTUAL_TEXT;
  return registeredViewName(node.name) ?? DEFAULT_VIEW;
}

/** Whether `node` is `ancestor` or somewhere under it. */
function isWithin(node: EngineNode | null, ancestor: EngineNode): boolean {
  for (let at = node; at; at = at.parent) if (at === ancestor) return true;
  return false;
}

/**
 * The DOM events Angular's `@defer (on interaction)` and `(on hover)` listen for on the trigger
 * element, as the engine events that mean the same thing here.
 *
 * Interaction is `click` and `keydown`: a touch that lifts on the trigger or anything inside it,
 * and focus reaching it, which is what a keyboard or a screen reader does before acting on it.
 * Hover is `mouseenter`, `mouseover` and `focusin`: a pointer entering, which only a trackpad or a
 * mouse produces, and focus. Anything else is not a trigger and is ignored.
 */
const DEFER_TRIGGER_EVENTS: Readonly<Record<string, readonly string[]>> = {
  click: ['topTouchEnd'],
  keydown: ['topFocus'],
  mouseenter: ['topPointerEnter'],
  focusin: ['topFocus'],
};

/** Each trigger listener's teardowns, by DOM event name. Off the node, which rarely has one. */
const triggerListeners = new WeakMap<
  object,
  Map<(event: unknown) => void, Map<string, () => void>>
>();

/**
 * The react tag of the next view any engine creates.
 *
 * Even, because surface root tags are odd (1, 11, 21, ...): an odd view tag eventually collides
 * with a root, and UIKit throws inside `-[RCTViewComponentView mountChildComponentView:]` while
 * adding a view to itself, a native crash with no JS error at all.
 *
 * And far above 2, where React starts. Native keeps one registry of views by tag for every
 * surface, and React numbers its own views 2, 4, 6... on any surface it renders; a development
 * build always has one, LogBox, which renders the first `console.warn` on a surface of its own.
 * Starting where React starts put two views under one tag, and the app crashed natively in
 * `-[RCTComponentViewRegistry dequeueComponentViewWithComponentHandle:tag:]`. One counter for
 * every engine, so two Angular surfaces do not collide with each other either.
 *
 * ponytail: room for about 530 million views in one run of the app before a tag would pass
 * int32, which native keeps them as; recycled and cloned views take no new tag. Wrapping would
 * need to skip tags still mounted.
 */
const FIRST_TAG = 2 ** 30;
let lastTag = FIRST_TAG - 2;
const nextTag = (): number => (lastTag += 2);

let hoverReported = false;

/**
 * Said once, in development, the first time a `@defer (on hover)` trigger is registered: a phone
 * has no pointer, so on one the block waits for focus alone.
 */
function reportHover(host: HostEngine): void {
  if (hoverReported || !(host instanceof Engine) || !host.dev) return;
  hoverReported = true;
  console.warn(
    '[angular-native] @defer (on hover) fires when a pointer enters the trigger, which takes a trackpad or a mouse (an iPad, or an Android device with one), or when the trigger takes focus. On a phone it waits for focus alone; add another trigger, such as on interaction or on viewport.',
  );
}

/** Whether a value is one of the engine's own nodes. */
export function isEngineNode(value: unknown): value is EngineNode {
  return value instanceof RetainedNode;
}

/**
 * A retained node, as a class so every node has one shape from its first line: Hermes lays a
 * constructed object out once, where the object-spread this replaced built a literal and copied
 * eighteen fields across for each of the thousands of nodes a screen makes.
 *
 * The first three methods are what Angular's `animate.enter` and `animate.leave` ask an element
 * for directly, rather than through `Renderer2`; everything else those instructions do goes through
 * the renderer. `getAnimations` answers from the transitions the engine is actually running,
 * which is what tells Angular how long to wait before removing a leaving element.
 */
/**
 * What the Metro preset's `Node` stand-in recognises an engine node by, so that Angular's
 * `instanceof Node` checks pass for these and for nothing else.
 */
const ENGINE_NODE = Symbol.for('ng-native.node');

class RetainedNode {
  static {
    Object.defineProperty(RetainedNode.prototype, ENGINE_NODE, { value: true });
  }

  props: Record<string, unknown> = {};
  text = '';
  children: EngineNode[] = [];
  parent: EngineNode | null = null;
  listeners: Map<string, Set<(event: unknown) => void>> | null = null;
  classes: Set<string> | null = null;
  sheet: StyleSheet | null = null;
  hostSheet: StyleSheet | null = null;
  customProperties: Record<string, TokenValue> | null = null;
  styleCache: StyleCache | null = null;
  styleDirty = true;
  styleCommitted: StyleCache | null = null;
  ownStyle: object | undefined = undefined;
  claimed: true | undefined = undefined;
  dormantHoists: EngineNode[] | null = null;
  committed: Committed | null = null;
  committedUnder: EngineNode | null = null;
  kept: Map<string, KeptHoist> | undefined = undefined;
  remeasure: true | undefined = undefined;
  propsDirty = false;
  structureDirty = false;
  subtreeDirty = false;
  transitions?: Map<string, Transition>;
  playing?: RunningAnimation;
  scrolled?: ScrollAnimation;

  readonly kind: NodeKind;
  readonly name: string;
  /** See `HostNode.host`. */
  readonly host: HostEngine;

  constructor(kind: NodeKind, name: string, host: HostEngine) {
    this.kind = kind;
    this.name = name;
    this.host = host;
  }

  get tagName(): string {
    return this.name;
  }

  /** Angular's dev-mode assertion compares this against `Node.ELEMENT_NODE`. */
  get nodeType(): number {
    return 1;
  }

  getAnimations(): unknown[] {
    const running: unknown[] = [];
    const playing = this.playing;
    if (playing && !playing.done) {
      running.push({
        animationName: playing.spec.name,
        effect: {
          // `animate.enter` reads this to know how long to wait. A null count is `infinite`,
          // which is what the Web Animations shape spells as Infinity.
          getTiming: () => ({
            duration: playing.spec.duration * (playing.spec.iterations ?? Infinity),
            delay: playing.spec.delay,
            iterations: playing.spec.iterations ?? Infinity,
          }),
        },
      });
    }
    for (const [property, transition] of this.transitions ?? []) {
      if (transition.done) continue;
      running.push({
        transitionProperty: property,
        effect: {
          getTiming: () => ({ duration: transition.duration, delay: 0, iterations: 1 }),
        },
      });
    }
    return running;
  }

  /**
   * Where another node is relative to this one, as the DOM's `compareDocumentPosition` answers:
   * the bits for preceding (2), following (4), containing (8) and contained (16), in tree order.
   * Signal Forms asks, to focus the first of a form's fields in the order the screen shows them.
   */
  compareDocumentPosition(other: RetainedNode): number {
    if (other === this) return 0;
    const path = (node: RetainedNode): RetainedNode[] => {
      const chain: RetainedNode[] = [];
      for (let at: RetainedNode | null = node; at; at = at.parent as RetainedNode | null) {
        chain.unshift(at);
      }
      return chain;
    };
    const mine = path(this);
    const theirs = path(other);
    if (mine[0] !== theirs[0]) return 1 | 32 | 4;
    let depth = 0;
    while (depth < mine.length && depth < theirs.length && mine[depth] === theirs[depth]) depth++;
    if (depth === mine.length) return 4 | 16;
    if (depth === theirs.length) return 2 | 8;
    const siblings = mine[depth - 1]!.children as unknown as RetainedNode[];
    return siblings.indexOf(theirs[depth]!) < siblings.indexOf(mine[depth]!) ? 2 : 4;
  }

  /**
   * What Signal Forms' `focusBoundControl()` calls on a field's element, and what a DOM element
   * would do: see `HostEngine.focus`.
   */
  focus(): void {
    this.host.focus(this as unknown as EngineNode);
  }

  get classList(): { contains(name: string): boolean } {
    const classes = this.classes;
    return { contains: (name: string): boolean => classes?.has(name) ?? false };
  }

  /**
   * What `@defer (on interaction)` and `(on hover)` call on their trigger element, the one place
   * Angular listens on an element directly rather than through `Renderer2`. See
   * `DEFER_TRIGGER_EVENTS`.
   */
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const events = DEFER_TRIGGER_EVENTS[type];
    if (!events) return;
    let byListener = triggerListeners.get(this);
    if (!byListener) triggerListeners.set(this, (byListener = new Map()));
    let byType = byListener.get(listener);
    if (!byType) byListener.set(listener, (byType = new Map()));
    if (byType.has(type)) return;
    if (type === 'mouseenter') reportHover(this.host);
    const stops = events.map((event) =>
      this.host.setEventListener(this as unknown as EngineNode, event, listener),
    );
    byType.set(type, () => {
      for (const stop of stops) stop();
    });
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const byType = triggerListeners.get(this)?.get(listener);
    byType?.get(type)?.();
    byType?.delete(type);
  }
}

/**
 * RN-specific helpers, injected rather than imported so the engine stays runnable under Node.
 */
export interface EngineOptions {
  /**
   * React Native's `NativeAnimatedHelper`, which lets native move a view by a scroll with no
   * JavaScript in between: how sticky headers stay pinned on a fast fling. The platform supplies it
   * on a device; without it, the components move those views from JavaScript as before.
   */
  nativeAnimated?: NativeAnimated | null;
  /**
   * RN's `processColor`. Narrower than `unknown` on purpose: it is only ever handed the value of
   * a `*color` prop, and typing it that way is what lets an app pass RN's function straight in
   * rather than casting at every call site.
   */
  processColor?: (value: string | number) => unknown;
  /**
   * RN's `resolveAssetSource`. `require('./x.png')` compiles to an asset *id*, and only this
   * turns it into `{uri, width, height, scale}`. Without it local images cannot work at all,
   * while remote `{uri}` objects pass through and appear to prove the prop is fine.
   */
  resolveAssetSource?: (value: unknown) => unknown;
  /**
   * The application-level sheet, compiled at build time. The one set of rules allowed to match a
   * node whatever component created it, which is what resets, utility classes and `:root` tokens
   * all need.
   */
  globalStyles?: StyleSheet | null;
  /**
   * What media queries are evaluated against. Pushed in rather than read, because the engine
   * imports nothing from React Native and a host may have its own idea of the viewport.
   */
  conditions?: Conditions;
  /**
   * Custom properties the device knows and the stylesheet cannot: the hairline width, and
   * whatever else is settled before the first frame. Seeded on the root, below `:root`, so an
   * app's own sheet still overrides them. Values that only arrive later - the safe-area insets,
   * which nothing knows until a view has been laid out - come through `updateTokens` instead.
   */
  tokens?: Readonly<Record<string, TokenValue>>;
  /**
   * Report host primitives used without their component (see `claimHost`). Defaults to RN's
   * `__DEV__`, so a release build never looks.
   */
  dev?: boolean;
  /**
   * The clock CSS transitions run on. Pushed in for the same reason everything else is: the
   * engine imports nothing, and a test drives time rather than waiting for it.
   */
  now?: () => number;
  /**
   * Called when the tree goes from clean to dirty. The host uses it to schedule a commit for a
   * change that arrives outside change detection, which is where Angular's animation queue puts
   * the classes for `animate.enter` and `animate.leave`.
   */
  onDirty?: () => void;
  /**
   * Where an error thrown while a native event is being dispatched goes, with the event's name.
   * The platform adapter points it at the app's `ErrorHandler`. Without one it is logged, and
   * either way it is never rethrown: see `dispatchEvent` for why.
   */
  onError?: (error: unknown, topLevelType: string) => void;
}

/**
 * A prop whose value is a colour, and so has to go through `processColor` before native reads it.
 *
 * The `Android` suffix is part of the test because React Native names its platform-specific props
 * that way round: `underlineColorAndroid` is a colour and does not end in `color`, and Android's
 * `ColorPropConverter` takes a number or a platform-colour map and refuses a string, so an unnamed
 * one arrives as the wrong type. `iOS`-suffixed props are not in the set because none of them are
 * colours - `shouldRasterizeIOS` is a boolean.
 */
const IS_COLOR_PROP = /color(android)?$/i;
/** Answers per key name, once: the regex ran for every prop of every node in every commit. */
const colorProps = new Map<string, boolean>();
function isColorProp(key: string): boolean {
  let answer = colorProps.get(key);
  if (answer === undefined) colorProps.set(key, (answer = IS_COLOR_PROP.test(key)));
  return answer;
}
const ASSET_PROPS = new Set(['source', 'defaultSource', 'loadingIndicatorSource']);

/**
 * Props whose value is a list of objects with a `color` inside.
 *
 * Colour processing keys off the *property name*, which cannot see a colour nested in an array.
 * That matters more than it sounds: with `enableNativeCSSParsing` off, which is the default,
 * Fabric does not parse a colour string either, so an unprocessed nested colour is not
 * approximated, it is dropped.
 */
const NESTED_COLOR_LIST_PROPS = new Set(['boxShadow']);

/** Styles arrive as objects, arrays, nested arrays and nulls. Reduce to one object. */
function flattenStyle(value: unknown, into: Record<string, unknown>): Record<string, unknown> {
  if (!value) return into;
  if (Array.isArray(value)) {
    for (const entry of value) flattenStyle(entry, into);
    return into;
  }
  if (typeof value === 'object') Object.assign(into, value);
  return into;
}

/** The timing a rule can set apart from a property list, and the part of the spec each sets. */
const TRANSITION_TIMING = {
  $transitionDuration: 'duration',
  $transitionDelay: 'delay',
  $transitionEasing: 'easing',
} as const;

/**
 * The transition spec, with any timing set by a rule of its own laid over it: `.duration-700`
 * beside `.transition`. A rule that writes the timing itself compiles it to `null`, which is how
 * a stronger transition keeps its own.
 *
 * Every key is taken out of `props`: they are instructions for this engine, and nothing native
 * has ever heard of them. See `animated` for why each `delete` is guarded.
 */
function transitionSpec(
  props: Record<string, unknown>,
): Record<string, TransitionSpec> | undefined {
  // Keyed `$transition` by the compiler, so a view's own `transition` prop reaches it.
  let spec = props['$transition'] as Record<string, TransitionSpec> | undefined;
  if (spec !== undefined) delete props['$transition'];
  for (const [key, part] of Object.entries(TRANSITION_TIMING)) {
    if (!(key in props)) continue;
    const value = props[key];
    delete props[key];
    if (value === null || spec === undefined) continue;
    const timed: Record<string, TransitionSpec> = {};
    for (const name of Object.keys(spec)) timed[name] = { ...spec[name]!, [part]: value };
    spec = timed;
  }
  return spec;
}

/**
 * The keys CSS's `translate`, `rotate` and `scale` compile to, in the order they apply. The
 * compiler's `INDIVIDUAL_TRANSFORMS` in `packages/metro/css/properties.cjs` writes the same three.
 */
const INDIVIDUAL_TRANSFORMS = ['__translate', '__rotate', '__scale'] as const;

/**
 * Fold the individual transform properties into the one list native has.
 *
 * They cascade, transition and animate as properties of their own, so this runs last, on what
 * the node is about to paint. CSS Transforms 2 applies translate, then rotate, then scale, then
 * `transform`, and a list applies left to right, so that is the order they are written in.
 */
function composeTransform(
  node: EngineNode,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const [translate, rotate, scale] = INDIVIDUAL_TRANSFORMS.map((key) => props[key]);
  if (translate === undefined && rotate === undefined && scale === undefined) return props;
  // Guarded, as `animated` guards its own: a `delete` is what sends an object to Hermes's slow
  // dictionary layout, and most nodes have none of these.
  for (const key of INDIVIDUAL_TRANSFORMS) if (key in props) delete props[key];

  const transform = props['transform'];
  const parts = [translate, rotate, scale, transform];
  const last = node.composedTransform;
  let value: unknown[];
  if (last && last.parts.every((part, i) => part === parts[i])) {
    value = last.value;
  } else {
    // A bound style's transform is still the CSS string: see `inline-transform.ts`.
    const own = typeof transform === 'string' ? transformList(transform) : transform;
    value = [translate, rotate, scale, own].flatMap((part) => (Array.isArray(part) ? part : []));
    node.composedTransform = { parts, value };
  }

  if (value.length) props['transform'] = value;
  else delete props['transform'];
  return props;
}

/**
 * Fabric *merges* the raw props handed to a clone onto the node's existing props, so a prop
 * that has gone away has to be sent explicitly as `null`. Sending the whole prop object would
 * silently keep removed props alive.
 */
function diffProps(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> | null {
  let payload: Record<string, unknown> | null = null;
  for (const key of Object.keys(next)) {
    if (!Object.is(prev[key], next[key])) (payload ??= {})[key] = next[key];
  }
  for (const key of Object.keys(prev)) {
    if (!(key in next)) (payload ??= {})[key] = null;
  }
  return payload;
}

/**
 * The prop a replaced element, an image, puts its own pixel size in: `{ width, height }`.
 *
 * Not a style, because a style binding is inline style and beats every rule, so a picture's own
 * 600 by 600 would override `class="size-11"`. CSS gives a replaced element's natural size the
 * lowest precedence of all, below any rule and any bound style, and that is what this is for.
 * It never reaches native.
 */
const INTRINSIC_SIZE = 'intrinsicSize';

/**
 * The prop a component puts the style it must have the last word on in, over the caller's.
 *
 * The other end of the scale from `intrinsicSize`. Angular merges a component's host style
 * binding under the template's, so a caller's `[style]="{flex: 1}"` beats the host's own
 * `flex: 0`; that is the right order for a default and the wrong one for an adjustment the
 * component is making on the caller's behalf, which RN composes after the caller's style. A
 * keyboard-avoiding view's padding, height and flex are that. Applied after inline style, a key
 * at a time, so every other property the caller wrote still applies. It never reaches native.
 */
const STYLE_OVERRIDE = 'styleOverride';

interface IntrinsicSize {
  readonly width: number;
  readonly height: number;
}

const isSet = (value: unknown): boolean => value !== undefined && value !== null;

/**
 * Size a box from its content's natural size, where nothing else did, as CSS sizes an `<img>`.
 *
 * Neither dimension set: the natural size, or the natural width alone when the author gave an
 * aspect ratio for Yoga to take the height from. One dimension set: the other follows the
 * picture's proportions, through `aspectRatio`, unless the author gave one of their own.
 */
function applyIntrinsicSize(props: Record<string, unknown>, size: IntrinsicSize): void {
  const width = isSet(props['width']);
  const height = isSet(props['height']);
  if (width && height) return;
  const ownRatio = isSet(props['aspectRatio']);
  if (!width && !height) {
    props['width'] = size.width;
    if (!ownRatio) props['height'] = size.height;
    return;
  }
  if (!ownRatio && size.width > 0 && size.height > 0) {
    props['aspectRatio'] = size.width / size.height;
  }
}

const now = (): number => globalThis.performance?.now?.() ?? Date.now();

function sameHandles(a: readonly FabricNode[], b: readonly FabricNode[]): boolean {
  return a.length === b.length && a.every((handle, i) => handle === b[i]);
}

/** Dev-time commit accounting, so a slow frame can be attributed rather than guessed at. */
export interface EngineStats {
  commits: number;
  lastCommitMs: number;
  /** The initial mount, which is a different animal from a steady-state update. */
  firstCommitMs: number;
  /** Worst commit *after* the mount. This is the number that matters for frame rate. */
  worstCommitMs: number;
  /** Commits that blew a 60fps frame budget, excluding the mount. */
  slowCommits: number;
  /**
   * Worst `begin()`..`end()` span, excluding the mount. This brackets Angular's whole render
   * pass - template execution, bindings, the commit - so comparing it against `worstCommitMs`
   * says whether time is going into the renderer or into change detection around it.
   */
  worstRenderMs: number;
  createdNodes: number;
  clonedNodes: number;
}

const FRAME_BUDGET_MS = 8;

export class Engine implements HostEngine {
  /** Scopes the CSS resolver's memo. Bumped once per commit. */
  private styleEpoch = 0;

  /** The node `:focus` currently applies to. */
  private focusedNode: EngineNode | null = null;

  readonly stats: EngineStats = {
    commits: 0,
    lastCommitMs: 0,
    firstCommitMs: 0,
    worstCommitMs: 0,
    slowCommits: 0,
    worstRenderMs: 0,
    createdNodes: 0,
    clonedNodes: 0,
  };

  private eventsRegistered = false;

  readonly root: EngineNode = new RetainedNode('element', 'root', this);

  private readonly fabric: FabricUIManager;
  private readonly rootTag: number;
  private readonly styles: StyleResolver;
  /** Whether to run the development checks, which a release build skips. */
  readonly dev: boolean;
  private readonly now: () => number;
  private onDirty: (() => void) | undefined;
  private onError: ((error: unknown, topLevelType: string) => void) | undefined;
  /** Nodes with at least one transition in flight, so a frame walks those and nothing else. */
  private readonly running = new Set<EngineNode>();
  /** Nodes playing a `@keyframes` animation. */
  private readonly playing = new Set<EngineNode>();
  /**
   * Elements of a hoisted name (`registerHoist`) that are in the tree, so a commit need not search
   * for them. Only those in the tree: see `releaseDetached`.
   */
  private readonly hoisted = new Set<EngineNode>();
  /** Whether a child list has lost a member since the last commit. See `releaseDetached`. */
  private removedSinceCommit = false;
  /**
   * `@keyframes` by name, across every sheet seen so far. One registry rather than one per sheet,
   * because that is the scope CSS gives them: a name defined in a global stylesheet is usable
   * from a component's. The cost is that two components defining the same name collide, last one
   * in wins, exactly as two stylesheets in a document would.
   */
  private readonly keyframes = new Map<string, readonly Keyframe[]>();
  /** Element names already reported as unclaimed, so a list of a thousand rows reports once. */
  private readonly reported = new Set<string>();
  private readonly processColor: (value: string | number) => unknown;
  /**
   * Whether any sheet seen so far asks about a node's position among its siblings. Until one
   * does, a child list can move without anything else needing to be looked at again.
   */
  private structuralSheets = false;
  private readonly resolveAssetSource: (value: unknown) => unknown;

  constructor(fabric: FabricUIManager, rootTag: number, options: EngineOptions = {}) {
    this.fabric = fabric;
    this.rootTag = rootTag;
    const conditions = options.conditions ?? { width: 0, height: 0, colorScheme: 'light' };
    this.styles = new StyleResolver(options.globalStyles ?? null, conditions);
    this.viewportSize = { width: conditions.width, height: conditions.height };
    if (options.tokens) this.styles.setRootTokens(options.tokens);
    this.structuralSheets = options.globalStyles?.structural === true;
    this.dev = options.dev ?? (globalThis as { __DEV__?: boolean }).__DEV__ === true;
    if (this.dev)
      this.styles.onUndefinedToken = (name, props) => this.reportUndefinedToken(name, props);
    this.now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.onDirty = options.onDirty;
    this.onError = options.onError;
    this.registerSheet(options.globalStyles);
    this.processColor = options.processColor ?? ((value) => value);
    this.resolveAssetSource = options.resolveAssetSource ?? ((value) => value);
    this.scrollDriver = options.nativeAnimated
      ? new NativeScrollDriver(options.nativeAnimated)
      : null;
    // Eagerly, not on the first listener. Fabric holds exactly one event handler and
    // `ReactFabric` installs React's at module scope, so until we claim it every native event
    // lands in React's event plugins. Those look the name up in a view config registry we never
    // populate and throw `Unsupported top level event type` from inside the native dispatch, or
    // read `instanceHandle.stateNode.canonical` off our own node and throw on `canonical`.
    // Nothing here emits events until a component asks for one, so waiting looks safe; it is not.
    // `RNSScreen` fires `onWillAppear`/`onHeaderHeightChange` on its own during a push, with no
    // listener anywhere, and the throw unwinds through the mounting transaction that pushed it.
    // The next commit then reads freed props and the process dies in `updateProps`.
    this.registerEventHandler();
  }

  /**
   * A rotation, a window resize, or the system switching to dark mode.
   *
   * None of those change a single node, so nothing would be dirty and nothing would re-render.
   * Marking the root is what gets the tree walked again; every cached style is already invalid,
   * because each carries the conditions version it was resolved under.
   */
  /**
   * Move `:focus`, invalidating only the two nodes involved.
   *
   * Precise rather than by generation: unlike a rotation, the engine knows exactly which nodes
   * changed, and a keystroke's worth of focus movement should not invalidate the tree.
   */
  private setFocused(node: EngineNode | null): void {
    if (this.focusedNode === node) return;
    if (this.focusedNode) {
      this.focusedNode.focused = false;
      this.markProps(this.focusedNode);
    }
    this.focusedNode = node;
    if (node) {
      node.focused = true;
      this.markProps(node);
    }
    this.commit();
  }

  /**
   * Set or clear `:active` along a responder chain, marking each node so its style re-resolves.
   *
   * Returns whether anything moved, because the caller has to commit: a gesture changes no
   * binding, so nothing marks an Angular view dirty and no change-detection pass would follow.
   */
  private setActiveChain(from: EngineNode | null, active: boolean): boolean {
    let changed = false;
    for (let node = from; node; node = node.parent) {
      if (node.active === active) continue;
      node.active = active;
      this.markProps(node);
      changed = true;
    }
    return changed;
  }

  /**
   * Custom properties the device knows and the stylesheet cannot, once they change.
   *
   * Merged rather than replaced: the insets come from a view and the hairline from the device, so
   * a caller owns the properties it names and nothing else. Each owner writes all of its own at
   * once - four insets together, never one - so nothing is left over from a previous rotation.
   */
  updateTokens(next: Readonly<Record<string, TokenValue>>): void {
    this.styles.setRootTokens({ ...this.styles.rootTokens, ...next });
    this.root.subtreeDirty = true;
    this.commit();
  }

  /**
   * The system text size changed: measure every text and text input again, and commit.
   *
   * React Native's surface re-measures its text when the content size category changes, on a
   * commit of its own. The next commit from here is built from the handles the engine holds,
   * which are the nodes from before that, laid out at the old size, and Yoga keeps a clean node's
   * layout: every text whose content had not changed kept its old box, with its glyphs drawn at
   * the new size inside it, clipped. So each one is committed again, cloned with its children,
   * which is what makes Fabric dirty a measured node and measure it at the size now in effect.
   */
  remeasureText(): void {
    const visit = (node: EngineNode): void => {
      for (const child of node.children) {
        if (child.kind !== 'element') continue;
        if (child.committed && MEASURED_VIEWS.has(viewNameOf(child))) {
          child.remeasure = true;
          this.markProps(child, false);
        }
        visit(child);
      }
    };
    visit(this.root);
    this.commit();
  }

  /** Whether any text has been laid out again for a face. See `fontsRegistered`. */
  private fontsRefreshed = false;
  /** How many times each paragraph or text input has been laid out again for a face. */
  private readonly fontRefreshes = new WeakMap<EngineNode, number>();
  /** The text inputs whose `fontFamily` the next commit sends again. See `fontsRegistered`. */
  private readonly fontResends = new WeakSet<EngineNode>();

  /**
   * Faces registered after text naming them was laid out: lay that text out again, and commit.
   *
   * Native keeps a paragraph's text layout, face included, keyed by what the paragraph asks for.
   * iOS caches the attributed string it built and the size it measured, so text laid out before
   * its face registered stays in the fallback face, and committing it again unchanged hits the
   * same cache. What it asks for has to change, and nothing visible can: each paragraph naming
   * one of the families is committed with its text size cap raised by a step too small to see, or
   * set far above any size the platform offers where it had none. Its view, and everything native
   * holds for it, stays where it is. Android keys its text layout the same way and applies the
   * cap the same way, so the same change works there.
   *
   * A text input takes its font another way. iOS sets it on the field again only when the input's
   * text attributes change, which the same cap does. Android sets it only when `fontFamily` is in
   * the props it is sent, and the engine sends only what changed, so it is sent again once.
   */
  fontsRegistered(families: ReadonlySet<string>): void {
    const visit = (node: EngineNode): void => {
      for (const child of node.children) {
        if (child.kind !== 'element') continue;
        const viewName = viewNameOf(child);
        const input = TEXT_INPUTS.has(viewName);
        if (child.committed && (viewName === PARAGRAPH || input) && namesFamily(child, families)) {
          this.fontRefreshes.set(child, (this.fontRefreshes.get(child) ?? 0) + 1);
          if (input) this.fontResends.add(child);
          this.fontsRefreshed = true;
          this.markProps(child, false);
        } else {
          visit(child);
        }
      }
    };
    visit(this.root);
    this.commit();
  }

  /**
   * Put the cursor in a text input; bring anything else on screen, in the scroll view it is in.
   * A form sends the user to the first field that needs fixing this way, and a toggle or a picker
   * has no cursor to take, so it is scrolled to instead.
   */
  focus(node: EngineNode): void {
    if (TEXT_INPUTS.has(viewNameOf(node))) this.dispatchCommand(node, 'focus');
    else this.reveal(node);
  }

  /**
   * Scroll the nearest scroll view the node is in by as little as brings the node fully on
   * screen, with `margin` to spare - UIKit's `scrollRectToVisible`. `visibleBottom` is where in
   * the window the visible area ends when something covers the bottom of the scroll view: the
   * keyboard's top edge, for a field the keyboard would otherwise hide.
   *
   * Measured in the window, all of it, so the scroll view's offset needs no tracking: it is how
   * far its content's top edge is above its own.
   */
  reveal(node: EngineNode, options: { visibleBottom?: number; margin?: number } = {}): void {
    // The nearest scroll view that scrolls up and down: a sideways carousel on a page is not
    // what moves a field clear of the bottom of the screen.
    let scroll = node.parent;
    while (
      scroll &&
      !(SCROLL_VIEWS.has(viewNameOf(scroll)) && scroll.props['horizontal'] !== true)
    ) {
      scroll = scroll.parent;
    }
    const content = scroll && this.visibleChildren(scroll)[0];
    if (!scroll || !content) return;
    const margin = options.margin ?? 16;
    this.measure(scroll, (view) => {
      this.measure(content, (inner) => {
        this.measure(node, (target) => {
          const offset = view.y - inner.y;
          const top = view.y + margin;
          const bottom = Math.min(view.y + view.height, options.visibleBottom ?? Infinity) - margin;
          let by = 0;
          if (target.y + target.height > bottom) by = target.y + target.height - bottom;
          else if (target.y < top) by = target.y - top;
          if (by !== 0)
            this.dispatchCommand(scroll, 'scrollTo', [0, Math.max(0, offset + by), true]);
        });
      });
    });
  }

  /**
   * Commit one measured node again, cloned with its children, so Fabric measures it once more.
   *
   * A text input is measured from its native state, and a text set from JavaScript reaches that
   * state only in the layout after the measurement, so the commit carrying the text sizes the
   * field for the text it had before. This is the commit that sizes it for the new one: one of
   * the exceptions to a commit per pass, because waiting for the next pass would leave the field
   * the wrong height until something else changed.
   */
  remeasure(node: EngineNode): void {
    if (!node.committed) return;
    node.remeasure = true;
    this.markProps(node, false);
    this.commit();
  }

  /**
   * A node's component rules are its creating sheet's, so this matches it against `like`'s, or
   * against the one it was created with once `like` is null.
   */
  adoptScope(node: EngineNode, like: EngineNode | null): void {
    if (like && !this.ownSheets.has(node)) this.ownSheets.set(node, node.sheet);
    const sheet = like ? like.sheet : this.ownSheets.get(node);
    if (sheet === undefined || node.sheet === sheet) return;
    node.sheet = sheet;
    if (sheet?.structural) this.structuralSheets = true;
    this.markProps(node);
  }

  /** The sheet each node given another's scope was created with. */
  private readonly ownSheets = new WeakMap<EngineNode, StyleSheet | null>();

  /** The window's size, from the conditions media queries use. Zero until the platform says. */
  get viewport(): { readonly width: number; readonly height: number } {
    return this.viewportSize;
  }

  private viewportSize: { readonly width: number; readonly height: number };

  updateConditions(next: Conditions): void {
    this.viewportSize = { width: next.width, height: next.height };
    this.styles.setConditions(next);
    this.root.subtreeDirty = true;
    // Committed here rather than left to the next change-detection pass, because there may not
    // be one: no view is dirty, so a tick does no work and never reaches the renderer at all.
    this.commit();
  }

  // --- mutation API -----------------------------------------------------

  createElement(name: string, sheet: StyleSheet | null = null): EngineNode {
    const node = new RetainedNode('element', name, this);
    node.sheet = sheet;
    if (sheet?.structural) this.structuralSheets = true;
    if (HOISTS[name]) this.hoisted.add(node);
    return node;
  }

  addClass(node: EngineNode, name: string): void {
    (node.classes ??= new Set()).add(name);
    this.markProps(node);
  }

  removeClass(node: EngineNode, name: string): void {
    node.classes?.delete(name);
    this.markProps(node);
  }

  /**
   * The sheet of the component `node` hosts, whose `:host` rules it matches. Set again when a hot
   * swap replaces the component's sheet, which recreates the views inside but not the host, so the
   * host is styled afresh here.
   */
  setHostSheet(node: EngineNode, sheet: StyleSheet | null): void {
    if (node.hostSheet === sheet) return;
    node.hostSheet = sheet;
    this.markProps(node);
  }

  /** `class="a b"` from a template. Replaces the set rather than adding to it. */
  setClasses(node: EngineNode, value: string): void {
    const names = value.split(/\s+/).filter(Boolean);
    node.classes = names.length ? new Set(names) : null;
    this.markProps(node);
  }

  /** Angular's `@if`/`@for`/`ViewContainerRef` markers. Ordered, never committed. */
  createAnchor(): EngineNode {
    return new RetainedNode('anchor', '#anchor', this);
  }

  createText(value: string): EngineNode {
    const node = new RetainedNode('text', '#text', this);
    node.text = value;
    return node;
  }

  appendChild(parent: EngineNode, child: EngineNode): void {
    this.detach(child);
    child.parent = parent;
    parent.children.push(child);
    if (child.dormantHoists) this.wakeHoists(child);
    this.markStructure(parent);
  }

  insertBefore(parent: EngineNode, child: EngineNode, ref: EngineNode | null): void {
    this.detach(child);
    child.parent = parent;
    const at = ref ? parent.children.indexOf(ref) : -1;
    if (at < 0) parent.children.push(child);
    else parent.children.splice(at, 0, child);
    if (child.dormantHoists) this.wakeHoists(child);
    this.markStructure(parent);
  }

  removeChild(parent: EngineNode | null, child: EngineNode): void {
    const target = parent ?? child.parent;
    if (!target) return;
    const at = target.children.indexOf(child);
    if (at < 0) return;
    target.children.splice(at, 1);
    child.parent = null;
    this.removedSinceCommit = true;
    this.markStructure(target);
  }

  /** A subtree that went out of the tree is back in: its hoisted nodes commit again. */
  private wakeHoists(node: EngineNode): void {
    for (const hoisted of node.dormantHoists!) this.hoisted.add(hoisted);
    node.dormantHoists = null;
  }

  /**
   * Let go of everything the engine holds for nodes that have left the tree.
   *
   * Removal is the only signal a destroyed subtree reliably sends. Angular calls `destroyNode` for
   * the top-level nodes of the view it destroys and not for anything inside a child component's
   * view, so a screen's own template is never told it is gone. A reference the engine keeps to any
   * one node of such a subtree keeps all of it, because a node reaches every other node of its
   * subtree through its parent and children, and each of those holds its committed Fabric handle,
   * which keeps its native shadow node alive. A screen with a header was retained in full that way,
   * every native node of it, for as long as the app ran.
   *
   * Removal is not destruction, though: a detached screen can be put back, and must come back
   * whole. So a hoisted node moves to the root of the subtree it left with, which is garbage along
   * with it if the subtree never returns, and is handed back when it does. An animation on a node
   * out of the tree stops rather than running a frame loop for something nobody can see, and
   * starts again if the node returns.
   *
   * Once per commit, and only after a removal: the walks are the depth of a handful of nodes.
   */
  private releaseDetached(): void {
    this.removedSinceCommit = false;
    for (const node of this.hoisted) {
      const top = this.topOf(node);
      if (top === this.root) continue;
      this.hoisted.delete(node);
      (top.dormantHoists ??= []).push(node);
    }
    for (const node of this.playing) {
      if (this.topOf(node) === this.root) continue;
      this.playing.delete(node);
      node.playing = undefined;
      this.markProps(node, false);
    }
    for (const nodes of this.scrollTimelines.values()) {
      for (const node of nodes) {
        if (this.topOf(node) === this.root) continue;
        this.stopScrolled(node);
        this.markProps(node, false);
      }
    }
    if (this.focusedNode && this.topOf(this.focusedNode) !== this.root) this.focusedNode = null;
  }

  /** The root of the tree a node is in: the engine's root while it is attached. */
  private topOf(node: EngineNode): EngineNode {
    let top = node;
    while (top.parent) top = top.parent;
    return top;
  }

  /**
   * Angular calls this per node on view destroy, but only when `Renderer2.destroyNode` is
   * non-null. Without it the listener sets on discarded nodes stay reachable from the
   * closures Angular hands us, which is a slow leak on any screen that churns views.
   */
  destroyNode(node: EngineNode): void {
    node.listeners?.clear();
    node.listeners = null;
    node.committed = null;
    node.transitions = undefined;
    node.playing = undefined;
    this.stopScrolled(node);
    this.running.delete(node);
    this.playing.delete(node);
    this.hoisted.delete(node);
    node.kept = undefined;
    // A field popped with the keyboard up never sends its blur.
    if (this.focusedNode === node) this.focusedNode = null;
  }

  parentNode(node: EngineNode): EngineNode | null {
    return node.parent;
  }

  nextSibling(node: EngineNode): EngineNode | null {
    const siblings = node.parent?.children;
    if (!siblings) return null;
    return siblings[siblings.indexOf(node) + 1] ?? null;
  }

  setProp(node: EngineNode, key: string, value: unknown): void {
    if (value === undefined || value === null) {
      // Nothing to remove, so nothing changed. Worth its own branch because it is the common
      // case, not a rare one: a host primitive carries a host binding for every prop React Native
      // reads, so every element on screen writes some thirty of these on every pass, and the
      // work being skipped is a walk to the root marking ancestors dirty.
      if (!(key in node.props)) return;
      delete node.props[key];
    } else {
      if (node.props[key] === value) return;
      node.props[key] = value;
    }
    // Inline style is applied after the cascade and inherited by nothing, so it cannot change
    // what any node matches or inherits. Every other prop can: `[disabled]` is a selector. An
    // inline `direction` is the exception, because the paragraphs below it align by it.
    this.markProps(node, key !== 'style' || this.noteInlineDirection(node));
  }

  /** Whether a node's inline style sets `direction`, remembering that one has. */
  private noteInlineDirection(node: EngineNode): boolean {
    const style = node.props['style'];
    if (!style || (typeof style === 'object' && !Array.isArray(style) && !('direction' in style))) {
      return false;
    }
    if (flattenStyle(style, {})['direction'] === undefined) return false;
    this.inlineDirection = true;
    return true;
  }

  /**
   * The style object a node already holds has been changed in place.
   *
   * Angular's styling instructions set one property at a time, so a style of ten properties would
   * otherwise mean ten copies of a growing object per element. The adapter owns the object it put
   * there and may write into it; this is how it says so, since nothing about the object's identity
   * has changed for the props diff to notice.
   */
  styleChanged(node: EngineNode): void {
    this.markProps(node, this.noteInlineDirection(node));
  }

  /**
   * Set a custom property on a node, `--tint` from `[style.--tint]`, or remove it with `null`.
   *
   * Not a prop: Fabric has no such thing, and would be sent one. It is a token for the cascade,
   * converted from the value here because nothing built it ahead of time (`inline-token.ts`), and
   * changing it re-resolves the node and so everything under it.
   */
  setCustomProperty(node: EngineNode, name: string, value: unknown): void {
    const token = value === null || value === undefined ? undefined : tokenFromValue(value);
    const current = node.customProperties;
    if (!token) {
      if (!current || !(name in current)) return;
      const { [name]: _removed, ...rest } = current;
      node.customProperties = Object.keys(rest).length ? rest : null;
    } else {
      node.customProperties = { ...current, [name]: token };
    }
    this.markProps(node);
  }

  setText(node: EngineNode, value: string): void {
    node.text = value;
    this.markProps(node);
  }

  setEventListener(
    node: EngineNode,
    topLevelType: string,
    fn: (event: unknown) => void,
  ): () => void {
    this.registerEventHandler();

    const optIn =
      EVENT_OPT_IN_PROPS[topLevelType] ?? VIEW_EVENT_OPT_IN_PROPS[viewNameOf(node)]?.[topLevelType];
    if (optIn && node.props[optIn] !== true) this.setProp(node, optIn, true);

    const listeners = (node.listeners ??= new Map());
    let set = listeners.get(topLevelType);
    if (!set) listeners.set(topLevelType, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  // --- dirty marking ----------------------------------------------------

  private markProps(node: EngineNode, affectsStyle = true): void {
    node.propsDirty = true;
    // Classes, `nativeID` and anything else a selector can read live in props, so any of them
    // changing can change what this node matches, and through it what its whole subtree does.
    // Marking only when it can is what keeps an animated `[style]` from re-cascading everything
    // beneath it on every frame.
    if (affectsStyle) {
      node.styleDirty = true;
      // `.peer:focus ~ .label`: what a later sibling matches can hang on this node's classes and
      // state, though nothing about the sibling moved. Only sheets that ask about siblings pay.
      if (this.structuralSheets) this.markLaterSiblings(node);
    }
    // The root has no parent to carry the mark, so it carries its own: `.dark` on the root alone
    // restyles everything beneath it.
    this.markPath(node.parent ?? node);
  }

  private markLaterSiblings(node: EngineNode): void {
    const siblings = node.parent?.children;
    if (!siblings) return;
    for (let i = siblings.indexOf(node) + 1; i < siblings.length; i++) {
      siblings[i]!.styleDirty = true;
    }
  }

  private markStructure(node: EngineNode): void {
    node.structureDirty = true;
    // A child list that moved changes what its members match, though nothing about them did:
    // the old last row is no longer the last. Only sheets that ask about position pay for this.
    if (this.structuralSheets) {
      node.styleDirty = true;
      for (const child of node.children) child.styleDirty = true;
    }
    this.markPath(node.parent);
  }

  /** Walk up until we hit a node already known to have a dirty subtree. */
  private markPath(node: EngineNode | null): void {
    const wasClean = !this.root.structureDirty && !this.root.subtreeDirty;
    for (let current = node; current && !current.subtreeDirty; current = current.parent) {
      current.subtreeDirty = true;
    }
    // The tree has just gone from clean to dirty. Inside a change-detection pass that means
    // nothing, because the pass ends in a commit; outside one it means the change has no commit
    // coming, and the host has to arrange a frame.
    if (wasClean && this.root.subtreeDirty) this.onDirty?.();
  }

  private isClean(node: EngineNode): boolean {
    return (
      node.committed !== null && !node.propsDirty && !node.structureDirty && !node.subtreeDirty
    );
  }

  // --- commit -----------------------------------------------------------

  /**
   * Incremental: clone only what changed and reuse untouched subtrees by reference. A full
   * rebuild would mint fresh shadow nodes for every node on every tick, which drops scroll
   * offset, text cursor and keyboard focus. That is a correctness requirement, not an
   * optimisation.
   */
  commit(): boolean {
    if (this.removedSinceCommit) this.releaseDetached();
    // The root is never reconciled itself, so it has no `committed` record and `isClean` would
    // always say dirty. Ask the flags directly, or every change-detection pass ends in a
    // completeRoot that changes nothing: during a fling that is one wasted native commit per
    // frame, since any listener firing marks the view for refresh.
    this.settleCreated();
    if (!this.root.structureDirty && !this.root.subtreeDirty) return false;

    const started = now();
    // One epoch per commit. Node props do not change while a commit runs, so every node can be
    // resolved once and shared with each of its descendants for the length of this walk.
    this.styleEpoch++;
    // Faces registered before the walk, the global sheet's among them, reach every node in it.
    this.facesAdded = false;
    const set = this.fabric.createChildSet(this.rootTag);
    for (const child of this.visibleChildren(this.root)) {
      if (this.withheld(child)) continue;
      this.fabric.appendChildToSet(set, this.reconcileUnder(this.root, child));
    }
    this.clearFlags(this.root);
    this.fabric.completeRoot(this.rootTag, set);

    const elapsed = now() - started;
    this.stats.commits++;
    this.stats.lastCommitMs = elapsed;
    if (this.stats.commits === 1) {
      this.stats.firstCommitMs = elapsed;
    } else {
      if (elapsed > this.stats.worstCommitMs) this.stats.worstCommitMs = elapsed;
      if (elapsed > FRAME_BUDGET_MS) this.stats.slowCommits++;
    }

    this.flushTransitionEvents();
    this.scrollDriver?.afterCommit();
    if (this.facesAdded) this.rematchFonts();
    return true;
  }

  private readonly scrollDriver: NativeScrollDriver | null;

  /** Whether native can move a view by a scroll with no JavaScript in between. */
  get drivesScroll(): boolean {
    return this.scrollDriver !== null;
  }

  /** See `HostEngine.driveByScroll`. The connection waits for a commit of both views. */
  driveByScroll(
    view: EngineNode,
    scroll: EngineNode,
    axis: ScrollAxis,
    range: ScrollRange,
    statics: readonly StaticTransform[] = [],
  ): ScrollDrive | null {
    const property = axis === 'x' ? 'translateX' : 'translateY';
    return this.driveByEvent(view, scroll, scrollFeed(axis), property, range, statics);
  }

  /** See `HostEngine.driveByEvent`. */
  driveByEvent(
    view: EngineNode,
    source: EngineNode,
    feed: EventFeed,
    property: DrivenProperty,
    range: ScrollRange,
    statics: readonly StaticTransform[] = [],
    shift: number | null = null,
  ): ScrollDrive | null {
    if (!this.scrollDriver) return null;
    // As Animated does: Fabric flattens a view that only lays out, and then there is no native
    // view for the animation to move.
    this.setProp(view, 'collapsable', false);
    return this.scrollDriver.drive(
      view,
      source,
      feed,
      property,
      range,
      statics,
      (node) => (node as EngineNode).committed?.tag ?? null,
      shift,
    );
  }

  /**
   * `transitionstart` and `transitionend`, for anything listening.
   *
   * Angular's `animate.enter` and `animate.leave` are built on these: they add a class, wait for
   * the transition it starts, and clean up when it ends. Nothing native emits them - there is no
   * CSS animation in React Native to emit them - so the engine that runs the transition is what
   * says when one began and ended.
   */
  /** Created since the last commit and waiting to settle. See `HostEngine.settle`. */
  private unsettled: Settling[] = [];

  settle(target: Settling): void {
    this.unsettled.push(target);
  }

  /**
   * Let every element created since the last commit write what its inputs say. One that was
   * checked already has, and answers at once; one whose view is detached writes its props here,
   * so the commit that first mounts it carries them.
   */
  private settleCreated(): void {
    if (this.unsettled.length === 0) return;
    const created = this.unsettled;
    this.unsettled = [];
    for (const target of created) target.settleProps();
  }

  private readonly transitionEvents: { node: EngineNode; type: string; property: string }[] = [];

  private emitTransition(node: EngineNode, type: string, property: string): void {
    if (!node.listeners?.has(type)) return;
    this.transitionEvents.push({ node, type, property });
  }

  /**
   * After the commit, never during it: a listener is free to add a class or drop an element, and
   * a tree that changes halfway through being walked is the one thing a commit cannot survive.
   */
  private flushTransitionEvents(): void {
    if (this.transitionEvents.length === 0) return;
    for (const { node, type, property } of this.transitionEvents.splice(0)) {
      for (const listener of [...(node.listeners?.get(type) ?? [])]) {
        listener(animationEvent(type, node, property));
      }
    }
  }

  /** Anchors take part in sibling ordering but never reach Fabric. */
  private visibleChildren(node: EngineNode): EngineNode[] {
    return node.children.filter((child) => child.kind !== 'anchor');
  }

  /**
   * Everything a node renders with, unprocessed. Precedence, weakest first: native defaults,
   * matched CSS, explicit props, inline style, a component's `styleOverride`. Inline wins over CSS for the same reason it does
   * on the web.
   *
   * Raw, because this is what the next commit diffs against. Colours and asset ids are converted
   * on the way out instead (`processed`), and only for the keys that changed: the converters
   * return fresh objects, so diffing their output would re-send every image and shadow on every
   * unrelated change.
   */
  private mergeProps(node: EngineNode, viewName: string): Record<string, unknown> {
    if (node.kind === 'text') return { text: paragraphText(node) };
    if (this.dev) this.checkProps(node);
    this.registerSheet(node.sheet);
    this.registerSheet(node.hostSheet);
    const props: Record<string, unknown> = { ...DEFAULT_PROPS[viewName] };
    Object.assign(props, this.styles.resolve(node, this.styleEpoch).style);
    for (const key of Object.keys(node.props)) {
      // No native prop has a hyphen. `data-*` and `aria-*` attributes stay on the node for
      // selectors to match, and the components package maps `aria-*` to what native reads.
      if (
        key !== 'style' &&
        key !== INTRINSIC_SIZE &&
        key !== STYLE_OVERRIDE &&
        !key.includes('-')
      ) {
        props[key] = node.props[key];
      }
    }
    const style = flattenStyle(node.props['style'], props);
    const intrinsic = node.props[INTRINSIC_SIZE] as IntrinsicSize | undefined;
    if (intrinsic) applyIntrinsicSize(style, intrinsic);
    flattenStyle(node.props[STYLE_OVERRIDE], style);
    this.fontFaces.apply(style);
    if (viewName === PARAGRAPH) alignText(style, this.directionOf(node, style));
    if (this.fontsRefreshed) this.capForFonts(node, style);
    return composeTransform(node, this.animated(node, this.transitioned(node, style)));
  }

  /**
   * The text size cap that lays a paragraph or text input out again once a face it names has
   * registered: a step per face above the app's own cap where it set one (below 1 is none, on
   * both platforms), or above any text size there is. Counted per view, so an app's cap moves by
   * a step for each face its text names and no further. See `fontsRegistered`.
   */
  private capForFonts(node: EngineNode, props: Record<string, unknown>): void {
    const refreshes = this.fontRefreshes.get(node);
    if (refreshes === undefined) return;
    const own = props['maxFontSizeMultiplier'];
    props['maxFontSizeMultiplier'] =
      (typeof own === 'number' && own >= 1 ? own : UNCAPPED) + refreshes * FONT_REFRESH_STEP;
  }

  /** Set once any node has had a `direction` in its inline style. See `directionOf`. */
  private inlineDirection = false;

  /**
   * The direction a paragraph is laid out in, where the app wrote one: its own, or the nearest
   * ancestor's. Undefined when nothing above it says, which leaves the platform's own.
   *
   * A stylesheet's `direction` is inherited through the cascade, so it is already in `props`. An
   * inline one is not, and is found by walking up, which only happens once some node has had one.
   */
  private directionOf(node: EngineNode, props: Record<string, unknown>): TextDirection | undefined {
    const own = textDirection(props['direction']);
    if (!this.inlineDirection) return own;
    for (let at: EngineNode | null = node; at; at = at.parent) {
      const inline = textDirection(flattenStyle(at.props['style'], {})['direction']);
      if (inline) return inline;
      const cascaded = textDirection(at.styleCache?.style['direction']);
      if (cascaded && cascaded !== textDirection(at.parent?.styleCache?.style['direction'])) {
        return cascaded;
      }
    }
    return own;
  }

  /**
   * Hold back what a transition is meant to ease into.
   *
   * Called with everything the node would otherwise commit with, so a property is compared
   * against the last value aimed at rather than the last one painted: a transition redirected
   * halfway carries on from where it had got to instead of snapping.
   *
   * A property seen for the first time is recorded and left alone. That is CSS's own rule, and
   * without it every element would fade in from whatever the previous value happened to be.
   */
  /**
   * Take a sheet's `@keyframes` and `@font-face` rules into the registries. Cheap and idempotent;
   * sheets are few.
   */
  private registerSheet(sheet: StyleSheet | null | undefined): void {
    if (!sheet || this.knownSheets.has(sheet)) return;
    this.knownSheets.add(sheet);
    for (const name of Object.keys(sheet.keyframes ?? {})) {
      this.keyframes.set(name, sheet.keyframes![name]!);
    }
    if (sheet.fonts && this.fontFaces.add(sheet.fonts)) this.facesAdded = true;
  }

  /** Every `@font-face` seen, global as on the web: a face declared in one sheet serves all. */
  private readonly fontFaces = new FontFaces();
  /** Whether a sheet first used in this commit declared a face. See `rematchFonts`. */
  private facesAdded = false;

  /**
   * Faces a sheet declared partway through a commit: text resolved before it, in this commit or
   * an earlier one, matched without them. Resolve every text naming a family again, and commit.
   * Once per sheet that declares faces, so walking the tree costs nothing that matters.
   */
  private rematchFonts(): void {
    const visit = (node: EngineNode): void => {
      for (const child of node.children) {
        if (child.kind !== 'element') continue;
        if (typeof child.committed?.props['fontFamily'] === 'string') this.markProps(child, false);
        visit(child);
      }
    };
    visit(this.root);
    this.commit();
  }

  private readonly knownSheets = new WeakSet<StyleSheet>();

  /**
   * Start, advance or stop the `@keyframes` animation a node's style asks for.
   *
   * Unlike a transition this does not need anything to have changed: an animation plays from its
   * own frames, which is what lets an element animate in without differing from anything.
   */
  private animated(node: EngineNode, props: Record<string, unknown>): Record<string, unknown> {
    const spec = animationOf(props);

    // One played by a scroll that is no longer asked for, whatever is asked for instead.
    if (node.scrolled && !spec?.timeline) this.stopScrolled(node);
    if (!spec) {
      if (node.playing) {
        node.playing = undefined;
        this.playing.delete(node);
      }
      return props;
    }

    const frames = this.keyframes.get(spec.name);
    if (!frames) {
      if (this.dev) this.reportMissingKeyframes(spec.name);
      return props;
    }
    if (spec.timeline) return this.scrollAnimated(node, spec, frames, props);
    this.startPlaying(node, spec, frames, props);
    return Object.assign(props, node.playing?.values ?? {});
  }

  /** Start the clock on an animation, unless the node is already playing this one. */
  private startPlaying(
    node: EngineNode,
    spec: AnimationSpec,
    frames: readonly Keyframe[],
    props: Record<string, unknown>,
  ): void {
    const current = node.playing;
    if (!current || !sameAnimation(current.spec, spec)) {
      const started: RunningAnimation = {
        spec,
        tracks: tracksOf(frames, props),
        start: this.now(),
        values: {},
        done: false,
      };
      // Sampled straight away, so the very commit that starts the animation paints its first
      // frame. Otherwise an element appears in its resting style for one frame and then jumps,
      // which is the flash this whole mechanism exists to avoid.
      //
      // A delayed animation therefore holds its first frame through the delay rather than the
      // resting style: `animation-fill-mode: backwards` behaviour, always. It is what an entrance
      // wants, and the alternative is the flash again.
      started.values = sample(started, this.now()).values;
      node.playing = started;
      if (spec.paused) started.pausedAt = this.now();
      else this.playing.add(node);
      this.emitTransition(node, 'topAnimationstart', spec.name);
      return;
    }
    this.playOrPause(node, current, spec);
  }

  /**
   * `animation-play-state` changed on an animation already playing: pausing holds the frame it
   * has reached, and running again carries on from there, the paused time left out of its clock.
   * Neither starts it over, as a change of play state does not in CSS.
   */
  private playOrPause(node: EngineNode, current: RunningAnimation, spec: AnimationSpec): void {
    current.spec = spec;
    const now = this.now();
    if (spec.paused && current.pausedAt === undefined && !current.done) {
      current.pausedAt = now;
      this.playing.delete(node);
    } else if (!spec.paused && current.pausedAt !== undefined) {
      current.start += now - current.pausedAt;
      current.pausedAt = undefined;
      this.playing.add(node);
    }
  }

  /** Every node playing a scroll-driven animation, by the scroll view that plays it. */
  private readonly scrollTimelines = new Map<EngineNode, Set<EngineNode>>();
  /** How far each such scroll view scrolls, along each axis, once one of its events has said. */
  private readonly scrollExtents = new Map<EngineNode, { x: number; y: number }>();

  /**
   * An animation played by the nearest scroll view's offset: `animation-timeline: scroll()`.
   *
   * Its keyframes are laid along the offset and handed to native, which plays them as the view
   * scrolls, with no JavaScript between (`scroll-animation.ts`, `NativeScrollDriver.animate`).
   * The frame at the offset the view starts at is committed once and then left alone: a prop that
   * changed on a later commit would reset what native is animating.
   */
  private scrollAnimated(
    node: EngineNode,
    spec: AnimationSpec,
    frames: readonly Keyframe[],
    props: Record<string, unknown>,
  ): Record<string, unknown> {
    const current = node.scrolled;
    if (current && sameAnimation(current.spec, spec)) return Object.assign(props, current.first);
    if (current) this.stopScrolled(node);
    if (node.playing) {
      node.playing = undefined;
      this.playing.delete(node);
    }

    const tracks = tracksOf(frames, props);
    const source = this.scrollSourceOf(node);
    const extent = source ? (this.scrollExtents.get(source)?.[spec.timeline!] ?? null) : null;
    const range = rangeOf(spec, extent);
    const first: Record<string, unknown> = firstFrame(tracks, spec, range);
    const resting = { ...props };
    if (!source && this.dev) this.reportUnscrolled(spec.name);
    const drive = source ? this.driveScrolled(node, source, spec, tracks, resting, range) : null;
    // As Animated does: Fabric flattens a view that only lays out, and then there is no native
    // view for the animation to move. Committed with the first frame, so it stays put.
    if (drive) first['collapsable'] = false;
    node.scrolled = { spec, tracks, resting, first, source, drive };
    return Object.assign(props, first);
  }

  /** Hand a scroll-driven animation's channels to native, fed by `source`'s scroll events. */
  private driveScrolled(
    node: EngineNode,
    source: EngineNode,
    spec: AnimationSpec,
    tracks: ScrollAnimation['tracks'],
    resting: Record<string, unknown>,
    range: readonly [number, number],
  ): ScrollAnimation['drive'] {
    if (!this.scrollDriver) return null;
    const { channels, held } = scrollChannels(tracks, spec, resting, range);
    if (held.length && this.dev) this.reportHeld(spec.name, held);
    let playing = this.scrollTimelines.get(source);
    if (!playing) this.scrollTimelines.set(source, (playing = new Set()));
    playing.add(node);
    return this.scrollDriver.animate(
      node,
      source,
      scrollFeed(spec.timeline!),
      channels,
      (one) => (one as EngineNode).committed?.tag ?? null,
    );
  }

  /** The scroll view a scroll-driven animation on `node` follows: the nearest one it is inside. */
  private scrollSourceOf(node: EngineNode): EngineNode | null {
    for (let up = node.parent; up; up = up.parent) {
      const name = viewNameOf(up);
      if (name === 'ScrollView' || name === 'AndroidHorizontalScrollView') return up;
    }
    return null;
  }

  private stopScrolled(node: EngineNode): void {
    const scrolled = node.scrolled;
    if (!scrolled) return;
    node.scrolled = undefined;
    scrolled.drive?.stop();
    if (scrolled.source) this.scrollTimelines.get(scrolled.source)?.delete(node);
  }

  /**
   * A scroll view has said how far it scrolls. Every animation on it with a range that depends on
   * that - none written, or a percentage - is laid out again along the new extent.
   */
  private measuredScroll(source: EngineNode, event: unknown): void {
    const { contentSize, layoutMeasurement } = (event ?? {}) as {
      contentSize?: { width: number; height: number };
      layoutMeasurement?: { width: number; height: number };
    };
    if (!contentSize || !layoutMeasurement) return;
    const extent = {
      x: Math.max(0, contentSize.width - layoutMeasurement.width),
      y: Math.max(0, contentSize.height - layoutMeasurement.height),
    };
    const known = this.scrollExtents.get(source);
    if (known && known.x === extent.x && known.y === extent.y) return;
    this.scrollExtents.set(source, extent);
    for (const node of this.scrollTimelines.get(source) ?? []) {
      const scrolled = node.scrolled;
      if (!scrolled?.drive) continue;
      const range = rangeOf(scrolled.spec, extent[scrolled.spec.timeline!]);
      scrolled.drive.update(
        scrollChannels(scrolled.tracks, scrolled.spec, scrolled.resting, range).channels,
      );
    }
  }

  private reportUnscrolled(name: string): void {
    if (this.reported.has(`scroll ${name}`)) return;
    this.reported.add(`scroll ${name}`);
    console.error(
      `[angular-native] '${name}' plays by animation-timeline: scroll(), but the element is not ` +
        `inside a scroll view, so nothing moves it. It shows its first frame.`,
    );
  }

  private reportHeld(name: string, properties: readonly string[]): void {
    if (this.reported.has(`held ${name}`)) return;
    this.reported.add(`held ${name}`);
    console.error(
      `[angular-native] '${name}' plays by a scroll, which native drives for opacity and ` +
        `transforms only. ${properties.join(', ')} holds its first frame.`,
    );
  }

  private reportMissingKeyframes(name: string): void {
    if (this.reported.has(`@keyframes ${name}`)) return;
    this.reported.add(`@keyframes ${name}`);
    console.error(
      `[angular-native] no @keyframes named '${name}'. Nothing animates, and the element ` +
        `renders with its resting style. Keyframes are global across every stylesheet the app ` +
        `has loaded, so the block has to exist somewhere by the time the animation starts.`,
    );
  }

  private transitioned(node: EngineNode, props: Record<string, unknown>): Record<string, unknown> {
    const spec = transitionSpec(props);
    if (!spec && !node.transitions) return props;

    const state = (node.transitions ??= new Map());
    const now = this.now();

    // The properties a transition *names*, even where the node has none yet. A property is only
    // transitioned once it has been seen settling, and one that does not exist is never seen - so
    // `transition: transform` with no transform until a class adds one would arrive instantly,
    // which is the commonest way to write one. `all` names nothing, so it keeps the old rule.
    const named = spec ? Object.keys(spec).filter((key) => key !== 'all') : [];

    for (const key of new Set([...Object.keys(props), ...named])) {
      if (step(state, key, props, spec?.[key] ?? spec?.['all'], now)) {
        this.running.add(node);
        this.emitTransition(node, 'topTransitionstart', key);
      }
    }

    if (state.size === 0) node.transitions = undefined;
    return props;
  }

  /** One `@keyframes` player, one frame on. */
  private advancePlayer(node: EngineNode, now: number): void {
    const running = node.playing;
    if (!running) {
      this.playing.delete(node);
      return;
    }

    if (running.pausedAt !== undefined) {
      this.playing.delete(node);
      return;
    }
    const { values, finished } = sample(running, now);
    // Without a forwards fill a finished animation stops holding anything, and the element falls
    // back to whatever the cascade gives it. 'backwards' fills the start only.
    const holds = running.spec.fill === 'forwards' || running.spec.fill === 'both';
    running.values = finished && !holds ? {} : values;
    this.markProps(node, false);

    if (!finished) return;
    running.done = true;
    this.playing.delete(node);
    this.emitTransition(node, 'topAnimationend', running.spec.name);
  }

  /**
   * Late-bound because the host that wants the callback is usually built from this engine, so
   * neither can be constructed with the other in hand.
   */
  setOnDirty(fn: () => void): void {
    this.onDirty = fn;
  }

  /** Late-bound for the same reason: the app's `ErrorHandler` lives in an injector built later. */
  setOnError(fn: (error: unknown, topLevelType: string) => void): void {
    this.onError = fn;
  }

  /** Whether any transition or animation still has frames left to run. */
  get animating(): boolean {
    return this.running.size > 0 || this.playing.size > 0;
  }

  /**
   * Whether anything has changed since the last commit.
   *
   * The frame loop reads this because a `transitionend` listener runs after its commit has
   * finished, and what it does is often to remove the element that just finished leaving. That
   * change needs a commit of its own or the view stays on screen, fully transparent, forever.
   */
  get pending(): boolean {
    return this.root.structureDirty || this.root.subtreeDirty;
  }

  /**
   * Advance every transition to `now` and mark what changed. The caller commits afterwards; on a
   * device the platform pumps this from `requestAnimationFrame` for as long as it returns true.
   */
  advanceAnimations(now: number = this.now()): boolean {
    for (const node of [...this.playing]) this.advancePlayer(node, now);
    for (const node of [...this.running]) {
      let live = false;
      for (const [key, transition] of node.transitions ?? []) {
        if (transition.done) continue;
        const elapsed = now - transition.start;
        // Still inside the delay: nothing to paint yet, but the transition is not over.
        if (elapsed < 0) {
          live = true;
          continue;
        }
        const progress = transition.duration <= 0 ? 1 : Math.min(1, elapsed / transition.duration);
        if (progress >= 1) {
          transition.current = transition.to;
          transition.done = true;
          this.emitTransition(node, 'topTransitionend', key);
        } else {
          transition.current = interpolate(
            transition.from,
            transition.to,
            bezier(transition.easing, progress),
          );
          live = true;
        }
        this.markProps(node, false);
      }
      if (!live) this.running.delete(node);
    }
    return this.animating;
  }

  /** The host's conversions, applied to a copy. A removed prop travels as null and stays null. */
  private processed(props: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === null || value === undefined) out[key] = value;
      else if (isColorProp(key)) out[key] = this.color(value);
      // A list of sources has already been resolved by whoever built it, as RN's resolver
      // also assumes: it passes any object through and only turns a number into one.
      else if (ASSET_PROPS.has(key) && !Array.isArray(value))
        out[key] = this.resolveAssetSource(value);
      else if (NESTED_COLOR_LIST_PROPS.has(key)) out[key] = this.processNestedColors(value);
      else if (key === 'experimental_backgroundImage') out[key] = this.processGradients(value);
      else if (key === 'filter') out[key] = this.processFilters(value);
      // A bound style's transform is still the CSS string: see `inline-transform.ts`.
      else if (key === 'transform' && typeof value === 'string') out[key] = transformList(value);
      else out[key] = value;
    }
    return out;
  }

  /** Copy a list of shadow-like objects, running each `color` through the host's converter. */
  private processNestedColors(value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => {
      const item = entry as Record<string, unknown>;
      if (item?.['color'] === undefined) return entry;
      return { ...item, color: this.color(item['color'] as string | number) };
    });
  }

  /**
   * Copy a filter list, running a drop shadow's colour through the host's converter. Android reads
   * that colour as a number and throws on a string, taking the whole surface down with it.
   */
  private processFilters(value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => {
      const shadow = (entry as { dropShadow?: Record<string, unknown> })?.dropShadow;
      if (shadow?.['color'] === undefined) return entry;
      return {
        dropShadow: { ...shadow, color: this.color(shadow['color'] as string | number) },
      };
    });
  }

  /**
   * Copy a list of gradients, running every stop's colour through the host's converter.
   *
   * A stop's colour is a colour like any other, but it is two levels down and nothing else looks
   * there: without this the device is handed the string `rgb(255, 0, 0)` where it wants a number,
   * and paints nothing.
   */
  private processGradients(value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => {
      const gradient = entry as { colorStops?: { color?: unknown }[] };
      if (!Array.isArray(gradient?.colorStops)) return entry;
      return {
        ...gradient,
        colorStops: gradient.colorStops.map((stop) => ({
          ...stop,
          color: this.color(stop.color),
        })),
      };
    });
  }

  private clearFlags(node: EngineNode): void {
    node.propsDirty = false;
    node.structureDirty = false;
    node.subtreeDirty = false;
  }

  private reconcile(node: EngineNode): FabricNode {
    // A clean node can still need re-rendering: if an ancestor's class changed, what this node
    // inherits changed with it, and nothing marked this node dirty. The resolver hands back the
    // very same cache object when nothing has changed, so one reference comparison settles it,
    // and a subtree whose inherited context is unmoved is skipped exactly as before.
    const style = node.kind === 'element' ? this.styles.resolve(node, this.styleEpoch) : null;
    const styleChanged = node.styleCommitted !== style;
    if (this.isClean(node) && !styleChanged) return node.committed!.handle;
    node.styleCommitted = style;

    const childHandles = this.reconcileChildren(node, style);
    const previous = node.committed;
    const viewName = viewNameOf(node);
    this.notePresented(node, viewName);
    if (!previous)
      return this.create(node, viewName, this.mergeProps(node, viewName), childHandles);

    // `propsDirty` is precise: Angular only calls setProperty when a binding actually changed.
    // It is not sufficient on its own, though. A node whose ancestor's class changed inherits
    // something new without any binding of its own having moved, so it is not propsDirty and
    // would never re-clone. `styleChanged` is the other half of that question. An ancestor that
    // is here only because something beneath it moved has the props it had.
    const propsMoved = node.propsDirty || styleChanged;
    const props = propsMoved ? this.mergeProps(node, viewName) : previous.props;
    const propsPayload = propsMoved ? this.propsPayload(node, previous.props, props) : null;

    const childrenChanged = this.childrenMoved(node, childHandles, previous.childHandles);

    let handle = previous.handle;
    if (childrenChanged || propsPayload) {
      handle = this.clone(
        previous.handle,
        propsPayload && this.processed(propsPayload),
        childrenChanged ? childHandles : null,
      );
      // A clone is the same view, so it keeps the tag it was created with, not the newest tag
      // handed out, which is some other node's.
      node.committed = { handle, tag: previous.tag, props, childHandles };
    }
    this.clearFlags(node);
    return handle;
  }

  /** What a clone sends: the props that changed, and a text input's font once it registered. */
  private propsPayload(
    node: EngineNode,
    previous: Record<string, unknown>,
    props: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const payload = diffProps(previous, props);
    if (payload && this.fontsRefreshed && this.fontResends.delete(node)) {
      payload['fontFamily'] = props['fontFamily'];
    }
    return payload;
  }

  /**
   * Whether a node has to be committed with its children again.
   *
   * A child that re-cloned has a new handle, so the parent must re-clone too. This is the bubble
   * that persistent trees force, and it is why dirty marking propagates upwards. A node to be
   * measured again is cloned with its children even when they are the same ones: new children
   * is what makes Fabric dirty a measured node (`remeasureText`).
   */
  private childrenMoved(node: EngineNode, next: FabricNode[], previous: FabricNode[]): boolean {
    const remeasure = node.remeasure === true;
    node.remeasure = undefined;
    return remeasure || !sameHandles(next, previous);
  }

  /**
   * The handles of a node's children, reconciling only the ones that can have changed.
   *
   * One changed row in a list of a thousand makes the list re-clone, and the other 999 are asked
   * for their handle. A clean child whose style still holds under this node's is its committed
   * handle as it stands, so it is answered here without the call, the resolve and the walk -
   * which, per child, was most of what a one-row update cost.
   */
  private reconcileChildren(node: EngineNode, style: StyleCache | null): FabricNode[] {
    const context = style?.context;
    if (HOIST_TARGETS.has(node.name)) return this.reconcileHoistTarget(node, context);
    const handles: FabricNode[] = [];
    for (const child of node.children) {
      if (child.kind === 'anchor' || this.committedElsewhere(child) || this.withheld(child)) {
        continue;
      }
      handles.push(this.reconcileUnder(node, child, context));
    }
    return handles;
  }

  /** Remember an iOS modal host committed as showing, so hiding it waits for `topDismiss`. */
  private notePresented(node: EngineNode, viewName: string): void {
    if (viewName !== MODAL_HOST || node.props['visible'] === false) return;
    if (platformOS === 'ios') node.presented = true;
  }

  /**
   * Whether a child is left out of its parent's commit: a modal host whose `visible` is false.
   *
   * The native host covers the screen and takes every touch whether or not it presents anything,
   * which is why React Native's Modal.js renders null while hidden. This is the same thing, so a
   * hidden `<modal>` leaves the screen under it usable. On iOS a modal that was showing stays
   * committed, with `visible` false, until native reports `topDismiss`: Modal.js keeps it that
   * long so the dismissal animates and `(dismiss)` fires. Android drops it at once, as Modal.js
   * does there.
   *
   * A withheld host is unmounted, and Fabric drops an unmounted view's event target for good
   * (`EventEmitter::setEnabled`), so its committed handles are forgotten and it is created afresh
   * when it is shown again, as Modal.js creates it afresh. Committed again, it ignores every touch.
   */
  private withheld(child: EngineNode): boolean {
    if (child.props['visible'] !== false || child.presented) return false;
    if (viewNameOf(child) !== MODAL_HOST) return false;
    if (child.committed) this.forgetCommitted(child);
    return true;
  }

  /**
   * `reconcileChildren` for a node other nodes hoist into: its own children, each followed by
   * the hoisted nodes written inside it, then those written in it directly, then the views it
   * keeps for hoisted nodes that are gone.
   */
  private reconcileHoistTarget(node: EngineNode, context: object | undefined): FabricNode[] {
    const handles: FabricNode[] = [];
    const hoisted = this.hoistedInto(node);
    const landed = new Set<string>();
    // One written directly in the node goes after its siblings: a page writes its header first,
    // and UIKit collapses a large title against the scroll view down the screen's first subviews,
    // which RNS keeps clear by never letting the header config be the first.
    const direct: EngineNode[] = [];
    for (const child of node.children) {
      if (child.kind === 'anchor' || this.committedElsewhere(child) || this.withheld(child)) {
        continue;
      }
      if (this.hoisted.has(child)) direct.push(child);
      else handles.push(this.reconcileUnder(node, child, context));
      const moved = hoisted?.get(child);
      if (moved) for (const written of moved) handles.push(this.land(node, written, landed));
    }
    for (const child of direct) handles.push(this.land(node, child, landed));
    if (node.kept) this.standIn(node, landed, handles);
    return handles;
  }

  /**
   * A child's handle as a child of `parent`, created again when it was committed under another.
   *
   * Native gives a view one parent for as long as it lives: `ShadowNodeFamily::setParent`
   * asserts it in a debug build, and a release build keeps the first parent and measures and lays
   * the view out against the wrong ancestry. A node Angular moves - content projected into a
   * container that was mounted again, a scroll view Android wraps in its swipe layout - is
   * therefore created afresh, with everything under it, as React creates an element that moves.
   * Its native state goes with it, as it would there.
   */
  private reconcileUnder(parent: EngineNode, child: EngineNode, context?: object): FabricNode {
    if (child.committed && child.committedUnder !== parent) this.forgetCommitted(child);
    const handle = this.stillCommitted(child, context) ?? this.reconcile(child);
    child.committedUnder = parent;
    return handle;
  }

  /** Let a node and everything under it be created again at the next commit. */
  private forgetCommitted(node: EngineNode): void {
    node.committed = null;
    node.committedUnder = null;
    node.styleCommitted = null;
    for (const child of node.children) if (child.committed) this.forgetCommitted(child);
  }

  /** A hoisted node, which commits into an ancestor further up than the parent it is in. */
  private committedElsewhere(child: EngineNode): boolean {
    return this.hoisted.has(child) && this.hoistsAbove(child);
  }

  /**
   * Reconcile a hoisted element committing into `target`, into the native view `target` already
   * keeps for its name when it has one (`HoistOptions.standIn`), and keep the view it commits as.
   */
  private land(target: EngineNode, child: EngineNode, landed: Set<string>): FabricNode {
    if (!STAND_INS[child.name]) return this.reconcileUnder(target, child);
    const kept = target.kept?.get(child.name);
    if (kept && kept.node !== child && child.committed === null && !isWithin(kept.node, target)) {
      // A node taken out without being destroyed would otherwise come back holding this tag too.
      if (kept.node) kept.node.committed = null;
      child.committed = kept.committed;
      child.propsDirty = true;
    }
    const handle = this.reconcile(child);
    child.committedUnder = target;
    (target.kept ??= new Map()).set(child.name, { node: child, committed: child.committed! });
    landed.add(child.name);
    return handle;
  }

  /**
   * Commit the stand-in props onto every view `target` keeps whose element is gone, on the view
   * itself so the native side sees an update rather than a removal.
   */
  private standIn(target: EngineNode, landed: Set<string>, handles: FabricNode[]): void {
    for (const [name, kept] of target.kept!) {
      if (landed.has(name)) continue;
      if (kept.node) {
        const props = {
          ...DEFAULT_PROPS[registeredViewName(name) ?? DEFAULT_VIEW],
          ...STAND_INS[name],
        };
        const payload = diffProps(kept.committed.props, props);
        const handle = this.clone(kept.committed.handle, payload && this.processed(payload), []);
        kept.committed = { handle, tag: kept.committed.tag, props, childHandles: [] };
        kept.node = null;
      }
      handles.push(kept.committed.handle);
    }
  }

  /** A clean child's committed handle, when its style still holds under its parent's. */
  private stillCommitted(child: EngineNode, context: object | undefined): FabricNode | null {
    const committed = child.committed;
    if (
      committed === null ||
      context === undefined ||
      child.propsDirty ||
      child.structureDirty ||
      child.subtreeDirty
    ) {
      return null;
    }
    if (child.kind === 'text') return committed.handle;
    const holds = child.styleCache === child.styleCommitted && this.styles.holds(child, context);
    return holds ? committed.handle : null;
  }

  /**
   * The hoisted nodes that commit as direct children of `node`, keyed by the child of `node` each
   * was written inside. Null when there are none, which is nearly always.
   */
  private hoistedInto(node: EngineNode): Map<EngineNode, EngineNode[]> | null {
    let found: Map<EngineNode, EngineNode[]> | null = null;
    for (const candidate of this.hoisted) {
      if (candidate.parent === node || HOISTS[candidate.name] !== node.name) continue;
      let written: EngineNode = candidate;
      let above = candidate.parent;
      while (above && above !== node && above.name !== node.name) {
        written = above;
        above = above.parent;
      }
      if (above !== node) continue;
      found ??= new Map();
      const list = found.get(written);
      if (list) list.push(candidate);
      else found.set(written, [candidate]);
    }
    return found;
  }

  /** Whether a hoisted node commits further up than the parent it was written in. */
  private hoistsAbove(node: EngineNode): boolean {
    const target = HOISTS[node.name];
    if (node.parent?.name === target) return false;
    for (let above = node.parent?.parent; above; above = above.parent) {
      if (above.name === target) return true;
    }
    return false;
  }

  private create(
    node: EngineNode,
    viewName: string,
    props: Record<string, unknown>,
    childHandles: FabricNode[],
  ): FabricNode {
    if (this.dev) {
      this.checkClaimed(node);
      this.checkKnown(node);
    }
    const tag = nextTag();
    this.stats.createdNodes++;
    // instanceHandle is the retained node itself: it is what Fabric hands back on events.
    const handle = this.fabric.createNode(tag, viewName, this.rootTag, this.processed(props), node);
    for (const child of childHandles) this.fabric.appendChild(handle, child);
    node.committed = { handle, tag, props, childHandles };
    this.clearFlags(node);
    return handle;
  }

  /**
   * Angular's own unknown-element check does not run in this pipeline, so a `<text>` in a
   * template that never imported `Text` compiles, renders as a plain view, and looks like a
   * layout bug. On the first commit of any known element with no component behind it, say so.
   */
  private checkClaimed(node: EngineNode): void {
    if (node.kind !== 'element' || node.claimed || !PRIMITIVE_NAMES.has(node.name)) return;
    if (this.reported.has(node.name)) return;
    this.reported.add(node.name);
    console.error(
      `[angular-native] <${node.name}> is used in a template that does not import ` +
        `${className(node.name)}. Add it to the component's \`imports\` from ` +
        `'@ng-native/components'; without it the element renders as a plain view.`,
    );
  }

  /**
   * The misspelt-prop check. Angular's own "Can't bind to" check needs a DOM to run, so a
   * `[numberofLines]` on a `<text>`, or a static `iosBackgroundColor` on a `<switch>`, went to
   * native as a prop no view reads, and nothing said so. A prop on a host primitive that its
   * component did not declare is reported once per element name and prop, with the declared name
   * it most likely meant when there is one.
   */
  private readonly undefinedTokens = new Set<string>();

  /** Said once per name: a phone has no inspector to show the declaration struck out. */
  private reportUndefinedToken(name: string, props: readonly string[]): void {
    if (this.undefinedTokens.has(name)) return;
    this.undefinedTokens.add(name);
    console.warn(
      `[angular-native] var(${name}) in ${props.join(', ')} names a custom property nothing in` +
        ` scope defines, so the declaration is dropped, as a browser drops it. Define ${name} on` +
        ` :root or an ancestor, or give the var() a fallback.`,
    );
  }

  private checkProps(node: EngineNode): void {
    if (!node.claimed || !PRIMITIVE_NAMES.has(node.name)) return;
    const declared = DECLARED_PROPS.get(node.name);
    if (!declared) return;
    for (const key of Object.keys(node.props)) {
      if (this.isDeclared(declared, key, node.props[key])) continue;
      const report = `${node.name} ${key}`;
      if (this.reported.has(report)) continue;
      this.reported.add(report);
      const meant = [...declared].find((name) => name.toLowerCase() === key.toLowerCase());
      console.warn(
        `[angular-native] <${node.name}> has no prop '${key}', so native ignores it.` +
          (meant ? ` Did you mean '${meant}'?` : '') +
          ` Check the spelling against the ${className(node.name)} page, or declare it with` +
          ` declareNativeProps('${node.name}', ['${key}']) if the native view does read it.`,
      );
    }
  }

  private isDeclared(declared: Set<string>, key: string, value: unknown): boolean {
    return (
      declared.has(key) ||
      ENGINE_PROPS.has(key) ||
      this.declaredAttributes.has(key) ||
      // A forms directive's input has a report of its own, naming the import it is missing.
      isFormsInput(key) ||
      key.includes('-') ||
      // A bare marker attribute, `<text listHeader>`, is there for a selector to match.
      value === ''
    );
  }

  /**
   * Element names some template's directives select by tag: every component with an element
   * selector, and directives such as Angular's `router-outlet` that own an element without
   * hosting a component. Declared by the platform adapter, which sees each template's directive
   * registry as the component is created.
   */
  private readonly declaredElements = new Set<string>();

  /** An element name a directive or component selects, and so is not a typo. */
  declareElement(name: string): void {
    this.declaredElements.add(name);
  }

  /**
   * Attribute names that belong to Angular rather than to a native view: what a directive selects
   * on or takes as an input, and what a component's `<ng-content select>` projects by. Angular
   * writes a static attribute to the node whatever consumes it, so without these a
   * `nativeRouterLink` or a `listHeader` marker would read as a misspelt prop. See `checkProps`.
   */
  private readonly declaredAttributes = new Set<string>();

  declareAttribute(name: string): void {
    this.declaredAttributes.add(name);
  }

  /**
   * The typo check. The set a name is looked up in is app-wide rather than per template, so a
   * directive imported in one template also quiets its name in another that forgot it. That is
   * the trade for not holding a registry per component, and the typo is the case that matters.
   */
  private checkKnown(node: EngineNode): void {
    if (node.kind !== 'element' || node.componentHost || node.name in VIEW_NAMES) return;
    if (this.declaredElements.has(node.name) || this.reported.has(node.name)) return;
    this.reported.add(node.name);
    console.error(
      `[angular-native] <${node.name}> is not a known element: no component, directive or ` +
        `registered native view claims it, so it renders as an empty view. Check the spelling, ` +
        `or import the component that owns it.`,
    );
  }

  // --- responder system -------------------------------------------------

  private readonly responders = new WeakMap<EngineNode, ResponderHandlers>();
  private currentResponder: EngineNode | null = null;

  /** Register a node as a candidate responder. Returns an unsubscribe. */
  setResponder(node: EngineNode, handlers: ResponderHandlers): () => void {
    this.registerEventHandler();
    this.responders.set(node, handlers);
    this.keepNative(node, true);
    return () => {
      this.responders.delete(node);
      this.keepNative(node, false);
      if (this.currentResponder !== node) return;
      // Torn down under the finger: no release is coming, so the chain it marked is cleared
      // here or it stays `:active` for good.
      const changed = this.setActiveChain(node, false);
      this.tellNative(node, false);
      this.currentResponder = null;
      if (changed) this.commit();
    };
  }

  /**
   * Keep a native view for this node, or stop keeping one.
   *
   * Fabric flattens a view whose props say nothing visual and nothing interactive: no native view
   * is created and its layout is folded into the parent. Responders live here, in JavaScript, and
   * Fabric cannot see them - so a transparent touch-catcher looks exactly like a view worth
   * flattening, and gets flattened, and never receives the touch it exists to catch.
   *
   * That is a popover that will not close. The full-screen catcher over the app has no background
   * and nothing else on it; the dialog's backdrop survived the same treatment only because
   * `bg-black/50` happened to make it visual.
   *
   * Only plain views: flattening is `ViewShadowNode`'s, so a paragraph, a scroll view or a text
   * input is already a native view and marking it would be a prop on every text node in the tree
   * that buys nothing.
   *
   * A floor rather than an override: `collapsable="true"` written on an element is left alone,
   * because someone who writes it means it.
   */
  private keepNative(node: EngineNode, keep: boolean): void {
    if (viewNameOf(node) !== DEFAULT_VIEW) return;
    if (keep) {
      if (node.props['collapsable'] === undefined) this.setProp(node, 'collapsable', false);
      return;
    }
    if (node.props['collapsable'] === false) this.setProp(node, 'collapsable', null);
  }

  /**
   * A view command, by name: `focus` and `blur` on a text input, `scrollTo` on a scroll view.
   * Fabric addresses the committed shadow node, so a node that has not reached a commit yet has
   * nothing to receive it and the call is dropped.
   */
  dispatchCommand(node: EngineNode, name: string, args: readonly unknown[] = []): void {
    const handle = node.committed?.handle;
    if (handle && this.fabric.dispatchCommand) this.fabric.dispatchCommand(handle, name, args);
  }

  /**
   * Where a node is, in window coordinates.
   *
   * `(layout)` reports a frame in the parent's coordinates, which sizes a view and says nothing
   * about where it is relative to anything else. This is what an anchored overlay needs: a
   * popover and its trigger live in different parts of the tree and can only be compared in the
   * window's frame.
   *
   * The callback is the platform's own shape rather than a promise, and on the new architecture
   * it fires before this returns - so a caller that needs the value immediately can capture it,
   * and one that does not is unaffected if that ever changes.
   *
   * Silent when the node has never been committed, or when the host has no `measureInWindow`.
   * Reporting zeroes would be worse than reporting nothing: a zero frame is a position, and an
   * overlay would believe it and place itself in the corner.
   */
  measure(node: EngineNode, into: (frame: WindowFrame) => void): void {
    const handle = node.committed?.handle;
    if (!handle || !this.fabric.measureInWindow) return;
    this.fabric.measureInWindow(handle, (x, y, width, height) => into({ x, y, width, height }));
  }

  /**
   * The react tag a node was committed with, or null if it has never reached a commit.
   *
   * This is what the native animation driver writes to: `connectAnimatedNodeToView` takes a tag,
   * and `findNodeHandle` hands a number straight back, so an animated graph can point at one of
   * our nodes without a React instance existing anywhere.
   */
  tagOf(node: EngineNode): number | null {
    return node.committed?.tag ?? null;
  }

  /**
   * The shadow node Fabric currently holds for a node, or null before its first commit.
   *
   * A clone-on-write tree hands back a different object every time a node's props change, so
   * this is not an identity. What is stable is the family behind it, which is what native keys a
   * node by, and is why a UI-thread animation given one of these keeps writing to the right view
   * however many times the node is cloned afterwards.
   */
  shadowNodeOf(node: EngineNode): FabricNode | null {
    return node.committed?.handle ?? null;
  }

  /** The node currently owning the gesture, if any. */
  get responder(): EngineNode | null {
    return this.currentResponder;
  }

  /**
   * The node native last reported focused, if any: the text input the keyboard belongs to.
   *
   * Checked against the tree rather than trusted, because a focused node that outlives its view
   * is not a stale style - it is every tap in the application being swallowed. Every scroll view
   * reads this on every touch to decide whether the touch means "dismiss the keyboard", and one
   * that decides yes *captures* the touch before any child sees it. So a field left focused after
   * its view is gone makes the whole app untappable until it is restarted.
   *
   * Neither teardown hook can be relied on to clear it. `removeChild` unlinks the subtree's root
   * and leaves everything under it pointing at its own parent, so a focused descendant still looks
   * attached; and Angular calls `destroyNode` for the nodes it tracks, not for every node in a
   * removed subtree. An overlay closing with a field inside it misses both.
   *
   * So it is answered by looking: a node still in the tree reaches the root by walking up. That
   * costs the depth of one node, on a touch, and only while something is focused.
   */
  get focused(): EngineNode | null {
    if (this.focusedNode && !this.isAttached(this.focusedNode)) this.focusedNode = null;
    return this.focusedNode;
  }

  /** Whether a node is still part of the tree, rather than in a subtree that was removed. */
  private isAttached(node: EngineNode): boolean {
    let current: EngineNode | null = node;
    while (current) {
      if (current === this.root) return true;
      current = current.parent;
    }
    return false;
  }

  /** The host's `resolveAssetSource`, for a component that needs an asset's size up front. */
  resolveAsset(value: unknown): unknown {
    return this.resolveAssetSource(value);
  }

  /**
   * The host's `processColor`, and the one place a platform colour becomes one.
   *
   * Props are processed by name - anything ending in `color` - which covers every colour that is
   * a prop. A colour *nested* inside a prop native parses itself is invisible to that rule: a tab
   * bar's appearance carries eight of them, and unprocessed they arrive as strings native reads
   * as nothing at all. So this is public, and the commit walk uses it too.
   *
   * `platform-color(label)` cannot be resolved at build time - the same declaration is
   * `{semantic}` on iOS and `{resource_paths}` on Android - so the names travel and the shape is
   * put on here. `processColor` understands both, exactly as it does for RN's own `PlatformColor`.
   */
  color(value: unknown): unknown {
    if (value === undefined) return undefined;

    const names = (value as { platformColor?: readonly string[] })?.platformColor;
    if (!names) return this.processColor(value as string | number);

    const key = nativePlatform() === 'android' ? 'resource_paths' : 'semantic';
    return this.processColor({ [key]: [...names] } as never);
  }

  /** Root-first, so a capture pass reads forwards and a bubble pass reads backwards. */
  private pathTo(node: EngineNode): EngineNode[] {
    const path: EngineNode[] = [];
    for (let current: EngineNode | null = node; current; current = current.parent)
      path.push(current);
    return path.reverse();
  }

  private negotiate(
    target: EngineNode,
    event: ResponderEvent,
    phase: 'Start' | 'Move',
  ): EngineNode | null {
    const path = this.pathTo(target);
    const capture = `on${phase}ShouldSetResponderCapture` as const;
    const bubble = `on${phase}ShouldSetResponder` as const;

    // Capture runs root -> target, so an ancestor can claim before its children see it.
    for (const node of path) {
      if (this.responders.get(node)?.[capture]?.(event, target)) return node;
    }
    // Bubble runs target -> root: the innermost interested node wins.
    for (let i = path.length - 1; i >= 0; i--) {
      if (this.responders.get(path[i]!)?.[bubble]?.(event, target)) return path[i]!;
    }
    return null;
  }

  private grant(node: EngineNode, event: ResponderEvent): void {
    const previous = this.currentResponder;
    if (previous === node) return;

    if (previous) {
      const handlers = this.responders.get(previous);
      // An undefined handler means "yes": RN's default is to allow the takeover.
      if (handlers?.onResponderTerminationRequest?.(event) === false) return;
      this.tellNative(previous, false);
      handlers?.onResponderTerminate?.(event);
    }

    // After the takeover is agreed, not before: a refusal would otherwise leave `:active` on a
    // node that never became the responder. Both calls run, so neither is short-circuited away.
    const cleared = this.setActiveChain(previous, false);
    const marked = this.setActiveChain(node, true);

    this.currentResponder = node;
    this.tellNative(node, true);
    this.responders.get(node)?.onResponderGrant?.(event);
    if (cleared || marked) this.commit();
  }

  private release(event: ResponderEvent, terminated: boolean): void {
    const node = this.currentResponder;
    if (!node) return;
    const changed = this.setActiveChain(node, false);
    this.currentResponder = null;
    this.tellNative(node, false);
    const handlers = this.responders.get(node);
    if (terminated) handlers?.onResponderTerminate?.(event);
    else handlers?.onResponderRelease?.(event);
    if (changed) this.commit();
  }

  private tellNative(node: EngineNode, isResponder: boolean): void {
    const handle = node.committed?.handle;
    if (!handle || !this.fabric.setIsJSResponder) return;
    const block = this.responders.get(node)?.blockNativeResponder ?? false;
    this.fabric.setIsJSResponder(handle, isResponder, block);
  }

  /** Runs before listener propagation, as React's responder plugin does. */
  private runResponder(target: EngineNode, type: string, event: ResponderEvent): void {
    if (type === TOUCH_START) {
      const elected = this.negotiate(target, event, 'Start');
      if (elected) this.grant(elected, event);
      return;
    }
    if (type === TOUCH_MOVE) {
      if (this.currentResponder) {
        this.responders.get(this.currentResponder)?.onResponderMove?.(event);
      } else {
        const elected = this.negotiate(target, event, 'Move');
        if (elected) this.grant(elected, event);
      }
      return;
    }
    if (type === TOUCH_END) this.release(event, false);
    else if (type === TOUCH_CANCEL) this.release(event, true);
  }

  // --- events -----------------------------------------------------------

  private registerEventHandler(): void {
    if (this.eventsRegistered || !this.fabric.registerEventHandler) return;
    this.eventsRegistered = true;
    this.fabric.registerEventHandler((instanceHandle, topLevelType, nativeEvent) =>
      this.dispatchEvent(instanceHandle, topLevelType, nativeEvent),
    );
  }

  /**
   * Fabric's `(instanceHandle, topLevelType, nativeEvent)` callback.
   *
   * **Events propagate up the retained tree.** Fabric hands JS only the hit target; React
   * implements two-phase propagation itself by walking the fiber tree, and so must we. Without
   * it a tap on a `<text>` label inside a `<pressable>` reaches the text node and stops, so the
   * button only responds on its padding. That reads as "taps sometimes do not register".
   *
   * ponytail: event priority (`unstable_getCurrentEventPriority` and the
   * `unstable_*EventPriority` constants) is read into the facade but not acted on. Angular's
   * zoneless scheduler already flushes on a microtask, which is soon enough for taps. It stops
   * being soon enough for a controlled TextInput, where the echo has to beat the next
   * keystroke. `mostRecentEventCount` covers that today by letting native reject a stale write;
   * a synchronous flush for discrete priority is the fix if it ever stops being enough.
   *
   * **Nothing thrown here may escape.** Fabric calls this synchronously from C++
   * (`UIManagerBinding::dispatchEventToJS`), often from inside a mounting transaction, and a throw
   * unwinds through that transaction: for a screen push the next commit then reads props freed on
   * the way out and the process dies with no JS stack at all. Angular
   * already catches what its own template listeners throw; everything else on this path - the
   * responder handlers, listeners registered on the engine directly, a commit started by a focus
   * change - is caught here and handed to `onError`, which the platform points at the app's
   * `ErrorHandler`. Each listener is guarded on its own, so one that throws does not stop the
   * bubble for the rest, as in the DOM.
   */
  dispatchEvent(instanceHandle: unknown, topLevelType: string, nativeEvent: unknown): void {
    const target = instanceHandle as EngineNode | null;
    this.trace(target, topLevelType);

    // Listeners get RN's documented shape, `{nativeEvent}`. Fabric hands us the payload bare;
    // React wraps it in a synthetic event and every RN API is written against `event.nativeEvent`,
    // so handlers ported from RN would silently read undefined otherwise.
    const event = new SyntheticEvent(nativeEvent);

    try {
      if (topLevelType === 'topDismiss' && target) this.dismissed(target);
      if (topLevelType === 'topScroll' && target && this.scrollTimelines.has(target)) {
        this.measuredScroll(target, nativeEvent);
      }
      this.trackFocus(target, topLevelType);
      if (target) this.cancelPressForScroll(target, topLevelType, event as ResponderEvent);
      if (target) this.runResponder(target, topLevelType, event as ResponderEvent);
    } catch (error) {
      this.reportEventError(error, topLevelType);
    }
    this.propagate(target, topLevelType, event);
  }

  /** A presented modal host has finished leaving, so a hidden one can come out of the tree. */
  private dismissed(target: EngineNode): void {
    if (!target.presented) return;
    target.presented = undefined;
    if (target.props['visible'] === false) this.markProps(target, false);
  }

  private reportEventError(error: unknown, topLevelType: string): void {
    if (this.onError) {
      this.onError(error, topLevelType);
      return;
    }
    console.error(`[angular-native] an error was thrown while dispatching ${topLevelType}`, error);
  }

  /**
   * A list that scrolls under a finger takes the touch away from whatever it started on.
   *
   * Distance alone cannot tell a scroll from a tap. The press rect is the control's own bounds
   * plus a retention offset, which is right - a 15pt threshold cancels an ordinary thumb tap on a
   * full-width button - but on a 72pt list row it means a 72pt drag still counts as a tap, and a
   * 72pt drag is unmistakably a scroll. So the list is asked instead of the arithmetic: it knows
   * it is scrolling, and every platform cancels the touch at that moment.
   *
   * Only a responder *inside* the thing that scrolled, so a scroll view moving does not cancel a
   * press somewhere else on screen. And only while a touch is in progress: momentum after the
   * finger has lifted, and programmatic scrolling, have no press to cancel.
   */
  private cancelPressForScroll(target: EngineNode, type: string, event: ResponderEvent): void {
    if (!SCROLL_CANCELS_PRESS.has(type)) return;
    const responder = this.currentResponder;
    if (!responder || responder === target) return;
    for (let node: EngineNode | null = responder; node; node = node.parent) {
      if (node === target) {
        this.release(event, true);
        return;
      }
    }
  }

  /**
   * Tell "the native side never sent it" from "it arrived and nothing was listening", which are
   * otherwise identical symptoms. One line per event, so it is off unless asked for.
   */
  private trace(target: EngineNode | null, topLevelType: string): void {
    if (!(globalThis as { __angularNativeEventLog?: boolean }).__angularNativeEventLog) return;
    let matched = 0;
    for (let n = target; n; n = DIRECT_EVENTS.has(topLevelType) ? null : n.parent) {
      matched += n.listeners?.get(topLevelType)?.size ?? 0;
    }
    console.log('[event]', topLevelType, target?.name ?? '(no handle)', matched);
  }

  /**
   * `:focus` follows the native events rather than being inferred from a tap, so it is right for a
   * field focused programmatically or by the keyboard's next-field button.
   */
  private trackFocus(target: EngineNode | null, topLevelType: string): void {
    if (topLevelType === 'topFocus') this.setFocused(target);
    else if (topLevelType === 'topBlur' && this.focusedNode === target) this.setFocused(null);
  }

  /** Walk target to root. Fabric hands JS only the hit target; the propagation is ours to do. */
  private propagate(target: EngineNode | null, topLevelType: string, event: SyntheticEvent): void {
    for (let node = target; node; node = node.parent) {
      const listeners = node.listeners?.get(topLevelType);
      if (listeners) {
        for (const fn of [...listeners]) {
          try {
            fn(event);
          } catch (error) {
            this.reportEventError(error, topLevelType);
          }
        }
      }
      if (DIRECT_EVENTS.has(topLevelType) || event.isPropagationStopped()) return;
    }
  }

  /**
   * Clone a committed node with whatever changed. Fabric's persistent tree has no in-place edit:
   * a new revision is a new node, which is why a changed child forces its parent to clone too.
   *
   * `children` is null when the child list is unchanged, in which case Fabric keeps the previous
   * revision's children and there is nothing to append.
   *
   * Otherwise this clones the way React does: the no-children form, then `appendChild` per child.
   * Omitting the child list gives the clone *empty* children, not the old ones, and whether a
   * binding takes that argument cannot be feature-detected - `UIManagerBinding.cpp` registers
   * both clone methods with a fixed `paramCount` and argument validation is commented out - so
   * `fn.length` says nothing. One code path, no detection.
   */
  private clone(
    previous: FabricNode,
    props: Record<string, unknown> | null,
    children: FabricNode[] | null,
  ): FabricNode {
    this.stats.clonedNodes++;

    if (children === null) return this.fabric.cloneNodeWithNewProps(previous, props!);

    const handle = props
      ? this.fabric.cloneNodeWithNewChildrenAndProps(previous, props)
      : this.fabric.cloneNodeWithNewChildren(previous);
    for (const child of children) this.fabric.appendChild(handle, child);
    return handle;
  }

  private detach(child: EngineNode): void {
    if (child.parent) this.removeChild(child.parent, child);
  }
}
