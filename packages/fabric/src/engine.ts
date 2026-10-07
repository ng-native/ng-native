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
  boundDeclaration,
  faded,
  fills,
  inlineInherited,
  setsInherited,
  StyleResolver,
  usesActive,
  elementsAtEnd,
  placeReadElsewhere,
  siblingReach,
  type Compound,
  type Conditions,
  type DeferredDeclaration,
  type StyleCache,
  type StyleSheet,
  type Subjects,
  type TokenValue,
} from './css.ts';
import { applyAria } from './aria-props.ts';
import { STYLED_ELEMENTS } from './element-styles.ts';
import {
  animationEvent,
  bezier,
  interpolate,
  readsInheritedColour,
  sample,
  step,
  steppedKeys,
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
import {
  clockChannels,
  firstFrame,
  movesByShare,
  rangeOf,
  scrollChannels,
  sharesAsPoints,
} from './scroll-animation.ts';
import { FontFaces } from './font-faces.ts';
import { premultipliedStops } from './premultiplied-stops.ts';

/**
 * The animation a node's style asks for, with a play state from a rule of its own applied. Both
 * are instructions for this engine and nothing native has heard of them, so they come out of the
 * props; only when there, because a `delete` sends an object to Hermes's slow dictionary layout,
 * and this runs for every node that commits.
 */
function animationOf(props: Record<string, unknown>): AnimationSpec | undefined {
  let spec = props['$animation'] as AnimationSpec | undefined;
  if (spec !== undefined) delete props['$animation'];
  for (const [key, field] of Object.entries(ANIMATION_PARTS)) {
    if (!(key in props)) continue;
    const value = props[key];
    delete props[key];
    if (spec && value !== null) spec = { ...spec, ...animationPart(field, value) };
  }
  return spec;
}

const ANIMATION_PARTS = {
  $animationDuration: 'duration',
  $animationDelay: 'delay',
  $animationEasing: 'easing',
  $animationIterations: 'iterations',
  $animationDirection: 'direction',
  $animationFill: 'fill',
  $playState: 'paused',
} as const;

function animationPart(
  field: (typeof ANIMATION_PARTS)[keyof typeof ANIMATION_PARTS],
  value: unknown,
): Partial<AnimationSpec> {
  switch (field) {
    case 'iterations':
      return { iterations: value === 'infinite' ? null : (value as number) };
    case 'direction':
      return {
        direction: value === 'normal' ? undefined : (value as AnimationSpec['direction']),
      };
    case 'paused':
      return { paused: value === 'paused' ? true : undefined };
    default:
      return { [field]: value };
  }
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
  /** The `@keyframes` it was laid out from, so a hot swap that edits them lays it out again. */
  readonly frames: readonly Keyframe[];
  readonly tracks: ReadonlyMap<string, readonly { offset: number; value: unknown }[]>;
  readonly resting: Record<string, unknown>;
  readonly first: Record<string, unknown>;
  /** The colour the node inherits, which the tracks were built with, for frames that read it. */
  readonly inherited: unknown;
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
 * The scroll events that mean a finger is dragging the list rather than tapping something in it.
 *
 * `topScrollBeginDrag` is the precise one; `topScroll` is here because a scroll view configured
 * without drag events still reports movement, and a press surviving that is the bug either way.
 */
const SCROLL_CANCELS_PRESS = new Set(['topScroll', 'topScrollBeginDrag']);

/**
 * RN's `directEventTypes`: delivered to the target only, never up the tree. Everything else
 * bubbles, which matches RN's `bubblingEventTypes` for the touch and input events that matter.
 * The web host's engine reads this set too, so both hosts deliver an event the same way.
 *
 * ponytail: a hand-kept set rather than real ViewConfigs. It is wrong only for a nested
 * scroll view, where an ancestor listening for the same direct event would not fire (correct)
 * but a third-party component's custom direct event would bubble (harmless in practice).
 * Swap it for per-component ViewConfig metadata if that ever matters.
 */
export const DIRECT_EVENTS: ReadonlySet<string> = new Set([
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
  /**
   * The node the event happened on, which a listener further up can compare with its own: RN's
   * `event.target`. Null where a host has no node to name.
   */
  readonly target?: unknown;
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
  readonly target: unknown;
  private stopped = false;

  constructor(nativeEvent: T, target: unknown = null) {
    this.nativeEvent = nativeEvent;
    this.target = target;
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
  /** The native view it was created as, which a clone cannot change. */
  viewName: string;
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
  /** See `StyleTarget.hasDirty`. */
  hasDirty: boolean;
  /** See `StyleTarget.stateDirty`. */
  stateDirty: boolean;
  /** A family left out while it loads. See `loadingFamilies`. */
  heldFamily?: string;
  /** See `StyleTarget.inlineInherits`. */
  inlineInherits?: boolean;
  /** See `StyleTarget.boundStyle`: the declarations, and the same by the property each sets. */
  boundStyle?: readonly DeferredDeclaration[] | null;
  boundByProp?: Map<string, DeferredDeclaration>;
  /**
   * Whether this node, or one inside it, takes touches under a `pointer-events: none` it would
   * otherwise inherit. Kept as each node is reconciled, children first. See `noteTouches`.
   */
  touchWithin?: boolean;
  /**
   * The paragraph the engine makes around a run of text written straight into a view. It is in no
   * template and in no node's `children`: it holds the text, and commits where the text would.
   */
  box?: EngineNode;
  /** A node the engine made, which no rule matches: it only inherits. */
  anonymous?: true;
  /** See `StyleTarget.styled`. */
  styled?: true;
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
   * How this node laid its children out when one of them last had a `fit-content` size, as
   * `containerOf` says it. Set by such a child, and compared on each reconcile so the children
   * are worked out again when the direction or alignment changes. Unset on every other node.
   */
  fitContainer?: string;
  /**
   * Whether this node had a height a percentage could be taken of, when a box beneath it with a
   * percentage height last asked, as `definiteHeight` says it. Compared on each reconcile so its
   * children are worked out again when it changes. Unset on every other node.
   */
  heightBasis?: boolean;
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
  /** The commit that created this node's view, by its number: see `Engine.commitUnseen`. */
  bornIn?: number;
  /** The last bound `transform` string and the list it reads as, undefined where CSS cannot. */
  boundTransform?: { text: string; list: unknown[] | undefined };
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
  /** See `keepNativeView`. */
  nativeView?: true;
  /** Props kept for selectors to match and left out of what is committed. See `keepAsAttribute`. */
  attributeOnly?: Set<string>;
  /** The child this node's background is painted on instead of itself. See `paintOn`. */
  paintsOn?: EngineNode;
  /**
   * Style weaker than every sheet, where no rule and no inline style says otherwise. What lets the
   * root component's host fill the surface by default and still give way to its own `:host`. See
   * `setDefaultStyle`.
   */
  defaultStyle?: Readonly<Record<string, unknown>>;

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
  /** On a text field, the row aligned by baseline that takes a baseline from it: `lineBaseline`. */
  onBaseline?: EngineNode;
  /** On such a row, the fields it has marked, which it unmarks when they are no longer its own. */
  baselineFields?: Set<EngineNode>;
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
 * HTML's text elements, which a template can write as it would for a browser.
 *
 * Each is text when it holds only text and other text elements, and a view when it holds anything
 * else: a box inside a paragraph has no layout, so `<span>Inbox<view class="dot" /></span>` is a
 * view with its text in a paragraph of its own. Decided as the element is committed, by
 * `viewNameOf`. They have no component to import, so they are not `PRIMITIVE_NAMES`.
 */
const TEXT_ELEMENTS = new Set([
  ...['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'strong', 'b', 'em', 'i'],
  ...['u', 's', 'small', 'code', 'mark', 'abbr', 'cite', 'time'],
]);

/** HTML's layout elements, each a plain view, as a browser's are boxes with a name. */
const LAYOUT_ELEMENTS = [
  ...['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'ul', 'ol', 'li'],
];

for (const name of TEXT_ELEMENTS) VIEW_NAMES[name] = 'Paragraph';
for (const name of LAYOUT_ELEMENTS) VIEW_NAMES[name] = 'View';

/**
 * What an HTML element has for its name alone, given to the node as it is made: a heading's role,
 * which a binding can replace as it can any prop, and whether the engine has styles for it.
 */
const HTML_ELEMENTS = new Map<string, { role?: string; styled?: true }>([
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((name) => [name, { role: 'header' }] as const),
  ...[...STYLED_ELEMENTS].map((name) => [name, { styled: true }] as const),
]);

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

/**
 * Say that a component's host is the native view its element name is registered as: a typed
 * wrapper for the view, where a component of the app's own with the same selector is a plain view.
 * Called from the component's constructor. See `ViewNameOptions.yieldsToComponents`.
 */
export function keepNativeView(node: HostNode): void {
  (node as EngineNode).nativeView = true;
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
 * iOS's names for the elements Android names differently, so reporting iOS after Android puts
 * them back.
 */
const IOS_VIEW_NAMES: Record<string, string> = Object.fromEntries(
  Object.keys(ANDROID_VIEW_NAMES).map((element) => [element, VIEW_NAMES[element] as string]),
);

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
  const names = platform === 'android' ? ANDROID_VIEW_NAMES : IOS_VIEW_NAMES;
  for (const [element, viewName] of Object.entries(names)) registerViewName(element, viewName);
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

/**
 * The box Yoga takes a view's baseline from where the view has none of its own: its first child
 * that is laid out in its flow. Words written straight into the view are the paragraph the
 * engine makes around them, and a child that is not displayed has no view to ask.
 */
function firstInFlow(node: EngineNode): EngineNode | undefined {
  for (const child of node.children ?? []) {
    // Not the paragraph itself, which holds the words it was made around.
    if (child.kind === 'text' && child.box) return child.box === node ? undefined : child.box;
    if (child.kind !== 'element' || ownLayout(child, 'display') === 'none') continue;
    if (ownLayout(child, 'position') !== 'absolute') return child;
  }
  return undefined;
}

const isNode = (node: EngineNode | undefined): node is EngineNode => node !== undefined;

/** Whether a row lays a child out among its others, and so can take its baseline from it. */
const inFlow = (child: EngineNode): boolean =>
  child.kind === 'element' && ownLayout(child, 'position') !== 'absolute';

/** The text field a row's box takes its baseline from: itself, or the first in its flow down. */
function fieldOnBaseline(item: EngineNode): EngineNode | undefined {
  let at: EngineNode | undefined = item;
  while (at?.kind === 'element' && !TEXT_INPUTS.has(viewNameOf(at))) at = firstInFlow(at);
  return at?.kind === 'element' ? at : undefined;
}

type TextDirection = 'ltr' | 'rtl';

const textDirection = (value: unknown): TextDirection | undefined =>
  value === 'ltr' || value === 'rtl' ? value : undefined;

/**
 * What iOS scales a text's `lineHeight` by: the system text size, capped by the text's own
 * `maxFontSizeMultiplier` where it is at least 1, and 1 without font scaling
 * (`RCTEffectiveFontSizeMultiplierFromTextAttributes`).
 */
function textScale(props: Record<string, unknown>, fontScale = 1): number {
  if (props['allowFontScaling'] === false) return 1;
  const cap = props['maxFontSizeMultiplier'];
  return typeof cap === 'number' && cap >= 1 ? Math.min(fontScale, cap) : fontScale;
}

/** A field's padding and border on its top or bottom edge, as they are written. */
const blockEdge = (
  props: Record<string, unknown>,
  side: 'Top' | 'Bottom',
  logical: 'Start' | 'End',
): unknown[] => [
  props[`padding${side}`] ??
    props[`paddingBlock${logical}`] ??
    props['paddingBlock'] ??
    props['paddingVertical'] ??
    props['padding'] ??
    0,
  props[`border${side}Width`] ?? props['borderWidth'] ?? 0,
];

/**
 * A multiline field's `rows` as its height, where it was given none: that many lines of its
 * line height at the system text size, inside its padding and border, as a browser sizes a `<textarea>`. A native field
 * is as tall as its text, which is one line before anything is typed.
 */
function rowsTall(props: Record<string, unknown>, fontScale: number | undefined): void {
  const rows = Number(props['rows']);
  const line = props['lineHeight'];
  if (props['multiline'] !== true || !(rows > 0) || typeof line !== 'number') return;
  if (isSet(props['height']) && props['height'] !== 'auto') return;
  // A content box's height is its lines alone: Yoga adds the padding and border itself.
  const edges =
    props['boxSizing'] === 'content-box'
      ? []
      : [...blockEdge(props, 'Top', 'Start'), ...blockEdge(props, 'Bottom', 'End')];
  if (!edges.every((part) => typeof part === 'number')) return;
  // At the system text size, which the field's lines are drawn at.
  const lines = rows * line * textScale(props, fontScale);
  props['height'] = edges.reduce<number>((sum, part) => sum + (part as number), lines);
}

/** A field's own minimum height: none where it says `auto`, which a web element starts with. */
const ownMinimum = (minHeight: unknown): unknown => (minHeight === 'auto' ? 0 : (minHeight ?? 0));

/** How tall the system's font is, as a share of its size: its rise over the baseline and fall under. */
const FONT_LINE = 0.95 + 0.24;

/**
 * How tall a field is by its line: the line, padding and border of a border-box field, Yoga's
 * default, and its content alone for a content-box one, which Yoga adds the padding and border
 * to itself. In a row aligned by baseline some of the line is kept as padding: `lineBaseline`.
 */
function lineBox(
  props: Record<string, unknown>,
  box: readonly number[],
  onBaseline: boolean,
  fontScale: number | undefined,
): number {
  const half = onBaseline ? lineBaseline(props, box[0]!, box, fontScale) : 0;
  if (props['boxSizing'] === 'content-box') return box[0]! - 2 * half;
  return box.reduce((sum, part) => sum + part, 0);
}

/**
 * `lineBaseline` for a field a height sizes: the room is what the height leaves its text, and
 * the field stays that height. A content-box field's height is its content's, so what is now
 * padding comes out of it.
 */
function heightBaseline(
  props: Record<string, unknown>,
  height: number,
  onBaseline: boolean,
  fontScale: number | undefined,
): void {
  if (!onBaseline) return;
  const edges = [...blockEdge(props, 'Top', 'Start'), ...blockEdge(props, 'Bottom', 'End')];
  if (!edges.every((part) => typeof part === 'number')) return;
  const content = props['boxSizing'] === 'content-box';
  const room = content ? height : (edges as number[]).reduce((left, part) => left - part, height);
  const half = lineBaseline(props, room, [room, ...(edges as number[])], fontScale);
  if (content) props['height'] = height - 2 * half;
}

/**
 * Give a field with its line height left out the baseline of a paragraph in a line as tall, for
 * a field in a row aligned by baseline: half the room the line has over the font is kept as
 * padding over and under the text. React Native says a field's baseline from its text and its
 * top padding, so without this it is the font's own, and the row lifts the paragraphs beside the
 * field to it: a form field's prefix and suffix sit higher than what is typed. Answers the half.
 *
 * ponytail: the font is taken to be as tall as the system's, `FONT_LINE` of its size. Read from
 * the font if a field in another face is seen a point off its prefix.
 */
function lineBaseline(
  props: Record<string, unknown>,
  line: number,
  [, top, , bottom]: readonly number[],
  fontScale: number | undefined,
): number {
  const size = props['fontSize'];
  if (typeof size !== 'number') return 0;
  const half = Math.max(0, (line - size * textScale(props, fontScale) * FONT_LINE) / 2);
  props['paddingTop'] = top! + half;
  props['paddingBottom'] = bottom! + half;
  return half;
}

/**
 * Centre the text of a single-line text field that has a line height, as Chrome centres an
 * input's, keeping the height the line height gives it.
 *
 * Where a `height` in points sizes the field, the line height has nothing left to do, and is left
 * out on both platforms: on Android, `EditText` centres a line box taller than the font's own
 * about 1.7pt high of centre in a 44pt field, and centres the font's own exactly. A percentage
 * height sizes the field only where its parent's height is definite, which is known at layout
 * alone, so such a field is left as it was. Elsewhere Android sizes the field by the line height
 * and centres the text in it itself, and keeps it.
 *
 * On iOS, React Native's field sets `lineHeight` as the paragraph's minimum and maximum line
 * height and, unlike a paragraph (`RCTApplyBaselineOffset`), never offsets the baseline, so the
 * glyphs sit at the bottom of a line box taller than the font. One line has nothing to space, so
 * the line height is left out. What it does in Chrome, and on Android, is set the field's height:
 * line height, padding and border. That is kept as a `minHeight`, the larger of it and the field's
 * own, within its `maxHeight`: the whole sum for a border-box field, Yoga's default, and the line
 * height alone for a content-box one. A null `height` is no height. A value that is not a number
 * cannot be added up, and leaves the field as it was.
 */
function centreSingleLine(
  viewName: string,
  props: Record<string, unknown>,
  fontScale: number | undefined,
  onBaseline = false,
): void {
  const lineHeight = props['lineHeight'];
  if (!TEXT_INPUTS.has(viewName) || typeof lineHeight !== 'number') return;
  if (props['multiline'] === true) return;
  const height = props['height'];
  if (typeof height === 'number') {
    delete props['lineHeight'];
    heightBaseline(props, height, onBaseline, fontScale);
    return;
  }
  // A percentage is a fixed height only where the parent's is definite, known at layout alone.
  if (isSet(height) && height !== 'auto') return;
  // Android sizes the field by its line height, and centres the text in it, itself.
  if (viewName !== 'TextInput') return;
  const edge = (side: 'Top' | 'Bottom', logical: 'Start' | 'End') =>
    blockEdge(props, side, logical);
  const line = lineHeight * textScale(props, fontScale);
  const box = [line, ...edge('Top', 'Start'), ...edge('Bottom', 'End')];
  const own = ownMinimum(props['minHeight']);
  const max = props['maxHeight'] ?? Infinity;
  if (![...box, own, max].every((part) => typeof part === 'number')) return;
  delete props['lineHeight'];
  const content = lineBox(props, box as number[], onBaseline, fontScale);
  props['minHeight'] = Math.max(own as number, Math.min(content, max as number));
}

const NO_STYLE: Readonly<Record<string, unknown>> = {};

/**
 * An element's inline style, less each property a rule it matches declared `!important`: an
 * inline style is the last of the plain declarations, under every important one.
 *
 * ponytail: by the name a property is committed under, so an inline `padding` is not taken out
 * by an important `padding-top`. Expand the inline shorthand here if one is ever written so.
 */
function inlineOf(node: EngineNode): Readonly<Record<string, unknown>> {
  if (!node.props['style']) return NO_STYLE;
  const inline = flattenStyle(node.props['style'], {});
  for (const key of node.styleCache?.important ?? []) delete inline[key];
  return inline;
}

/**
 * What a container's own style says for `key`, in the order `mergeProps` applies them: a
 * component's override, inline, a prop, its stylesheet, its default.
 */
function ownLayout(node: EngineNode, key: string): unknown {
  return (
    flattenStyle(node.props[STYLE_OVERRIDE], {})[key] ??
    inlineOf(node)[key] ??
    node.props[key] ??
    node.styleCache?.style[key] ??
    node.defaultStyle?.[key]
  );
}

/**
 * A container's main axis and how it aligns across it, as `row` or `column` and a keyword. A
 * `display: contents` node is no container: its children are laid out in the one above it.
 */
function containerOf(node: EngineNode): string {
  if (ownLayout(node, 'display') === 'contents') return 'contents';
  const direction = String(ownLayout(node, 'flexDirection') ?? 'column');
  return `${direction.startsWith('row') ? 'row' : 'column'} ${ownLayout(node, 'alignItems') ?? 'stretch'}`;
}

/**
 * The node a box is laid out in: its parent, or the one above every `display: contents` ancestor.
 * Each of those is told a `fit-content` child passed through, so that when it stops being
 * `contents`, and is the container, the child is worked out again.
 */
function layoutParent(node: EngineNode): EngineNode | null {
  let parent = node.parent;
  while (parent && containerOf(parent) === 'contents') {
    parent.fitContainer = 'contents';
    parent = parent.parent;
  }
  return parent;
}

const STRETCHES = new Set([undefined, null, 'auto', 'stretch']);

/**
 * `width: fit-content` and `height: fit-content`, which Yoga has no size for.
 *
 * Along its container's main axis a box is as big as its content already, so the size is
 * dropped. Across it a box stretches, where a browser keeps it at its content's size and at the
 * start: `align-self: flex-start` does both. An alignment the container or the box asked for is
 * kept, since it stops the stretch already.
 */
function fitContent(node: EngineNode, props: Record<string, unknown>): void {
  const capped = {
    row: capAtContent(props, 'width', 'maxWidth'),
    column: capAtContent(props, 'height', 'maxHeight'),
  };
  const width = props['width'] === 'fit-content';
  const height = props['height'] === 'fit-content';
  if (!width && !height) return;
  if (width) delete props['width'];
  if (height) delete props['height'];
  const parent = layoutParent(node);
  if (!parent) return;
  const container = containerOf(parent);
  parent.fitContainer = container;
  const [direction, align] = container.split(' ');
  if (capped[direction === 'row' ? 'row' : 'column']) withoutGrowth(props);
  const across = direction === 'row' ? height : width;
  if (across && align === 'stretch' && STRETCHES.has(props['alignSelf'] as string)) {
    props['alignSelf'] = 'flex-start';
  }
}

/**
 * A box capped at its content along its container's main axis, where it would grow: a browser
 * clamps a growing item by its maximum, and there is no such cap to hand Yoga. So it does not
 * grow, and starts from its content, which is as far as the cap would let it get. It may still
 * shrink.
 */
function withoutGrowth(props: Record<string, unknown>): void {
  if (typeof props['flex'] === 'number' && props['flex'] > 0) {
    delete props['flex'];
    props['flexShrink'] ??= 1;
  }
  delete props['flexGrow'];
  delete props['flexBasis'];
}

/**
 * `max-width: max-content`, and the same of a height: no bigger than its content, which for a
 * box that would fill its container is `fit-content`. Yoga has no such cap. Answers whether the
 * box is the size of its content for it: one that would fill, or one that was `fit-content` as
 * written.
 *
 * ponytail: a size in points is left as it is, since nothing here knows how big the content
 * is. Measure it if a box is ever given both.
 */
function capAtContent(props: Record<string, unknown>, size: string, cap: string): boolean {
  if (props[cap] !== 'max-content') return false;
  delete props[cap];
  const own = props[size];
  const fills = own == null || own === 'auto' || (typeof own === 'string' && own.endsWith('%'));
  if (fills) props[size] = 'fit-content';
  return fills || own === 'fit-content';
}

const isPercent = (value: unknown): boolean => typeof value === 'string' && value.endsWith('%');

/** Whether a `flex-basis` is a length or a percentage of something: not zero, and not `auto`. */
const isSizedBasis = (basis: unknown): boolean =>
  isPercent(basis)
    ? Number.parseFloat(basis as string) !== 0
    : typeof basis === 'number' && basis !== 0;

/**
 * A `flex-basis` that is a length or a percentage, as the size it is along its container's main
 * axis: a width in a row and a height in a column, over one written for that axis.
 *
 * Yoga works a `flexBasis` out once for a view and keeps the answer, and React Native never has
 * it forgotten when the view's props change (`computedFlexBasis`, cleared only by
 * `markDirtyAndPropagate`). A basis that changes after the first layout is not read again, and
 * a percentage does not follow the box it is a share of. A size is worked out on every pass, and
 * with no basis Yoga takes the size along the main axis as the basis: the same sum.
 *
 * A basis of zero is left as it is, which is every `flex: 1`: under a container with no size on
 * its main axis Yoga passes over a basis and sizes the box by its content, where a size of zero
 * would be zero. A box out of the flow is no flex item, and keeps its own size.
 */
function basisAsSize(node: EngineNode, props: Record<string, unknown>): void {
  const basis = props['flexBasis'];
  if (!isSizedBasis(basis) || props['position'] === 'absolute') return;
  const parent = layoutParent(node);
  if (!parent) return;
  const container = containerOf(parent);
  // Remembered on the container, so the box is merged again when the direction changes.
  parent.fitContainer = container;
  delete props['flexBasis'];
  if (container.startsWith('row')) props['width'] = basis;
  else {
    props['height'] = basis;
    percentHeight(node, props);
  }
}

/**
 * Whether a box has a height a percentage can be taken of, as CSS defines one: a height of its
 * own, or one the layout around it gives it. A box as tall as what it holds has none.
 *
 * Asked of each box on the way up, and remembered on it, so a change to any of them works out
 * again the boxes beneath it. Where the answer is not known for certain it is yes, which leaves
 * the percentage to Yoga as before: a view native sizes itself, or one placed out of the flow.
 */
function definiteHeight(node: EngineNode): boolean {
  return (node.heightBasis = hasDefiniteHeight(node));
}

function hasDefiniteHeight(node: EngineNode): boolean {
  // The root is the screen, and only a plain view is sized by its content alone.
  if (!node.parent || node.kind !== 'element' || viewNameOf(node) !== 'View') return true;
  const parent = layoutParent(node);
  if (!parent) return true;
  const height = ownLayout(node, 'height');
  if (isPercent(height)) return definiteHeight(parent);
  return sizesItself(node, height) || heightFromLayout(node, parent);
}

const NO_HEIGHT = new Set([undefined, null, 'auto', 'fit-content']);

/** Whether a box has a height from its own style: written, or placed, or kept in proportion. */
function sizesItself(node: EngineNode, height: unknown): boolean {
  if (!NO_HEIGHT.has(height as string)) return true;
  return ownLayout(node, 'position') === 'absolute' || ownLayout(node, 'aspectRatio') != null;
}

/** Whether the container a box is in gives it a height: a row's, or a share of a column's. */
function heightFromLayout(node: EngineNode, parent: EngineNode): boolean {
  const [direction, align] = containerOf(parent).split(' ');
  if (direction === 'row') {
    // Stretched across a row, it is as tall as the row, where the row has a height to be. One
    // as tall as its content gives none: Yoga takes the percentage of the space on offer there
    // too, the screen's, where a browser takes it of the row once its content has sized it.
    const self = ownLayout(node, 'alignSelf') as string | undefined;
    return STRETCHES.has(self) && align === 'stretch' && definiteHeight(parent);
  }
  // In a column it has the height it grows to, where the column has one to share out.
  const grows = Number(ownLayout(node, 'flexGrow') ?? ownLayout(node, 'flex') ?? 0) > 0;
  return grows && definiteHeight(parent);
}

/**
 * A placeholder's opacity, which native has none for, as its colour faded by that share: none of
 * it at 0, which is how a stylesheet hides a placeholder under a label, and all of it at 1.
 *
 * ponytail: with no colour of its own the placeholder is native's default, and a platform colour
 * is native's to resolve: neither is known here, so each is hidden at 0 and left as it is above
 * that. Name the platform's default, or read the colour back, if one is faded part of the way.
 */
function placeholderFaded(props: Record<string, unknown>): void {
  const opacity = props['placeholderOpacity'];
  if (opacity === undefined) return;
  delete props['placeholderOpacity'];
  if (typeof opacity !== 'number' || opacity >= 1) return;
  const colour = props['placeholderTextColor'];
  if (typeof colour === 'string')
    props['placeholderTextColor'] = faded(colour, Math.max(opacity, 0));
  else if (opacity <= 0) props['placeholderTextColor'] = 'rgba(0, 0, 0, 0)';
}

/** The least alpha iOS sends a touch to a view at: under a hundredth it is passed over. */
const TOUCHED_ALPHA = 0.011;

/**
 * A view that takes a touch and has no opacity, committed with the least there is to be sent
 * one. A browser sends a press to an element at `opacity: 0`, which is how a see-through
 * backdrop hears a press outside a menu; iOS passes over a view it would not draw. A hundredth
 * of what the view draws is not seen.
 */
function stillTouched(props: Record<string, unknown>): void {
  // One told to take no touch is not to be sent one, seen or not.
  if (props['pointerEvents'] === 'none') return;
  const opacity = props['opacity'];
  if (typeof opacity === 'number' && opacity < TOUCHED_ALPHA) props['opacity'] = TOUCHED_ALPHA;
}

/**
 * Leave `aspect-ratio` out for a box with both a width and a height. CSS takes the ratio only
 * for a size that is `auto`; Yoga takes it over one of two that are given, the height in a
 * column and the width in a row.
 */
function ratioForAutoSize(props: Record<string, unknown>): void {
  if (!isSet(props['aspectRatio'])) return;
  const given = (size: unknown) => isSet(size) && size !== 'auto';
  if (given(props['width']) && given(props['height'])) delete props['aspectRatio'];
}

const OUTLINE_KEYS = ['outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset'];

/**
 * Send nothing for an outline of no width, which is what `outline: none` is: it draws nothing,
 * and a view with no outline is the same view. Sent, it is an update that is not one, and on
 * Android a text field given an outline prop after it is first drawn has its background set
 * again, with which the padding Android gives a text field comes back over the padding it was
 * laid out with: a field as tall as its line clips its text away. A stylesheet takes a
 * browser's focus ring off a field with `outline: none` for the focused field alone.
 */
function noOutline(props: Record<string, unknown>): void {
  if (props['outlineWidth'] !== 0) return;
  for (const key of OUTLINE_KEYS) delete props[key];
}

/**
 * A box with `display: none`, out of the flow as well. It takes no room either way, but Yoga
 * reads an item's baseline from its first child that is in the flow, and a hidden one has no
 * layout to read: under a row with `align-items: baseline` the baseline is not a number, and
 * the row comes to no height with nothing in it placed. Out of the flow it is passed over.
 */
function hiddenOutOfFlow(props: Record<string, unknown>): void {
  if (props['display'] === 'none') props['position'] = 'absolute';
}

/**
 * `height: 50%` under a parent with no height to take it of, which CSS reads as `auto`. Yoga
 * takes it of the space on offer, the screen's or everything a scroll view holds, so no height
 * is sent.
 */
function percentHeight(node: EngineNode, props: Record<string, unknown>): void {
  if (!isPercent(props['height'])) return;
  // Out of the flow, it is of the box that holds it, which is laid out first and has a height.
  if (props['position'] === 'absolute') return;
  const parent = layoutParent(node);
  if (parent && !definiteHeight(parent)) delete props['height'];
}

/**
 * Start a multiline Android text field's text at the top, as iOS and a `<textarea>` do.
 *
 * React Native maps an unset `textAlignVertical` to `Gravity.NO_GRAVITY`, which `ReactEditText`
 * reads as the `EditText`'s own gravity, `center_vertical`. One the app set, through the input or
 * a CSS `vertical-align`, stays.
 */
function alignMultiline(viewName: string, props: Record<string, unknown>): void {
  if (viewName !== 'AndroidTextInput' || props['multiline'] !== true) return;
  props['textAlignVertical'] ??= 'top';
}

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
 * A screen's `gestureResponseDistance` that no touch is within: how far from each edge a swipe
 * back may start, with -1 for no limit, and none at all from the leading edge. It is what
 * `react-native-screens` reads as the swipe is about to begin; whether the swipe is enabled it
 * read when the finger came down, before anything here had heard of the touch.
 */
const NO_SWIPE = Object.freeze({ start: -1, end: 0, top: -1, bottom: -1 });

/** A screen of a native stack, which is what the swipe back is a gesture of. */
const STACK_SCREEN = 'RNSScreen';

/** What an element's `touch-action` is: bound on it, or from the rules it matches. */
function touchActionOf(node: EngineNode): unknown {
  return inlineOf(node)['touchAction'] ?? node.styleCache?.style['touchAction'];
}

/** Where a touch is on the screen: its own point, or its first finger's. */
function pointOf(nativeEvent: unknown): { x: number; y: number } {
  const event = (nativeEvent ?? {}) as TouchPayload & { touches?: readonly TouchPayload[] };
  const touch = event.pageX === undefined ? event.touches?.[0] : event;
  return { x: touch?.pageX ?? 0, y: touch?.pageY ?? 0 };
}

/**
 * What a touch on a node leaves to the browser: the `touch-action` of it, or of the nearest
 * element over it that says. Nothing where none does, which leaves everything.
 */
function touchActions(node: EngineNode): readonly string[] | undefined {
  for (let up: EngineNode | null = node; up; up = up.parent) {
    const said = up.kind === 'element' ? touchActionOf(up) : undefined;
    if (typeof said === 'string') return said.split(' ');
  }
  return undefined;
}

const PANS_ACROSS = ['auto', 'manipulation', 'pan-x', 'pan-left', 'pan-right'];
const PANS_ALONG = ['auto', 'manipulation', 'pan-y', 'pan-up', 'pan-down'];

/** Whether an element keeps a drag in one direction: its `touch-action` leaves no pan that way. */
const keeps = (actions: readonly string[] | undefined, pans: readonly string[]): boolean =>
  actions !== undefined && !actions.some((action) => pans.includes(action));

/** How far a finger moves before a browser has settled which way a drag is going. */
const DRAG_SLOP = 4;

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
  options?: ViewNameOptions,
): void {
  VIEW_NAMES[elementName] = viewName;
  if (options?.yieldsToComponents) YIELDING.add(elementName);
  else YIELDING.delete(elementName);
  // A name the app registers is the app's: no longer decided by what the element holds.
  TEXT_ELEMENTS.delete(elementName);
  for (const name of typeof viewName === 'string' ? [viewName] : [viewName.ios, viewName.android]) {
    if (defaultProps) DEFAULT_PROPS[name] = defaultProps;
    if (options?.textContent) TEXT_CONTENT_PROPS[name] = options.textContent;
  }
}

/** What else a registered view needs the engine to know about it. */
export interface ViewNameOptions {
  /**
   * The prop the view reads its text from, where it takes no children: SwiftUI's `Text` through
   * `@expo/ui` reads `text`. The text written inside the element becomes that prop, as `<text>`
   * takes its own content, and is not committed as children. An explicit prop wins over it.
   */
  readonly textContent?: string;
  /**
   * Whether the name gives way to a component of the app's own with the same selector, whose host
   * is then a plain view. For a set of views registered under a prefix an app may also use for
   * its design system, as `@expo/ui`'s are under `ui-`. A component that is the view itself, a
   * typed wrapper for it, says so with `keepNativeView`.
   */
  readonly yieldsToComponents?: boolean;
}

/** The registered names that give way to a component's own host. See `ViewNameOptions`. */
const YIELDING = new Set<string>();

/** The prop each view that takes its text content as a prop reads it from. See `ViewNameOptions`. */
const TEXT_CONTENT_PROPS: Record<string, string> = {};

/** Whether `node` takes its text content as a prop rather than as text children. */
function takesTextAsProp(node: EngineNode): boolean {
  return node.kind === 'element' && TEXT_CONTENT_PROPS[viewNameOf(node)] !== undefined;
}

/** Sets a view's text prop from its content, unless the prop is set explicitly. */
function withTextContent(node: EngineNode, viewName: string, props: Record<string, unknown>): void {
  const prop = TEXT_CONTENT_PROPS[viewName];
  if (!prop || node.props[prop] !== undefined) return;
  const text = textContent(node);
  if (text) props[prop] = text;
}

/**
 * The whitespace a paragraph drops at its ends is what CSS collapses: spaces, tabs and line
 * breaks. A no-break space is text, as in a browser, so `&nbsp;` is how a value keeps a space at
 * its end; `String.prototype.trim` would take that too.
 */
const trimStart = (text: string): string => text.replace(/^[ \t\n\r\f]+/, '');
const trimEnd = (text: string): string => text.replace(/[ \t\n\r\f]+$/, '');
const trimEnds = (text: string): string => trimEnd(trimStart(text));

/**
 * The text written inside a view that takes it as a prop: every run joined, with the whitespace at
 * the two ends dropped as a paragraph drops it, and kept inside. A nested view is drawn after the
 * text, as SwiftUI's `Text` through `@expo/ui` draws a child `Text`, so the space before it stays.
 */
function textContent(node: EngineNode): string {
  let text = '';
  let nested = false;
  for (const child of node.children) {
    if (child.kind === 'text') text += child.text;
    else if (child.kind === 'element') nested = true;
  }
  return nested ? trimStart(text) : trimEnd(trimStart(text));
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

/** Leave a family that is still loading out of `style`, remembering it. See `loadingFamilies`. */
function holdLoadingFamily(node: EngineNode, style: Record<string, unknown>): void {
  const family = style['fontFamily'];
  if (typeof family === 'string' && loadingFamilies.has(family)) {
    delete style['fontFamily'];
    node.heldFamily = family;
  } else if (node.heldFamily !== undefined) {
    node.heldFamily = undefined;
  }
}

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

/**
 * Families a load has asked the platform for and not yet settled, by how many loads asked. Text
 * naming one is laid out in the fallback without the name until it settles: native caches a
 * text's measurement by its family name, so a fallback measurement under the face's name would
 * outlast the face arriving.
 */
const loadingFamilies = new Map<string, number>();

/** Faces a load is about to ask the platform for. See `loadingFamilies`. */
export function fontsLoading(families: Iterable<string>): void {
  for (const family of families)
    loadingFamilies.set(family, (loadingFamilies.get(family) ?? 0) + 1);
}

/** What each mounted app does when a load settles. See `fontsSettled`. */
const settleListeners = new Set<(families: ReadonlySet<string>) => void>();

/** Hear about loads settling, until the returned function is called. */
export function onFontsSettled(listener: (families: ReadonlySet<string>) => void): () => void {
  settleListeners.add(listener);
  return () => settleListeners.delete(listener);
}

/**
 * Faces a load asked for and has finished with, registered or not, before `fontsRegistered`.
 * Text held back for one that no load still asks for is laid out with the name again: see
 * `Engine.fontsSettled`.
 */
export function fontsSettled(families: Iterable<string>): void {
  const settled = new Set<string>();
  for (const family of families) {
    const left = (loadingFamilies.get(family) ?? 1) - 1;
    if (left > 0) loadingFamilies.set(family, left);
    else {
      loadingFamilies.delete(family);
      settled.add(family);
    }
  }
  if (settled.size) for (const listener of [...settleListeners]) listener(settled);
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
  // Text written straight into a view is a paragraph of its own, and all of it.
  if (root === null || !isTextElement(root)) return node.box ? trimEnds(node.text) : node.text;
  // The commonest paragraph by far: one run and nothing else, so it is both the first and last.
  if (root.children.length === 1 && !isTextElement(root.parent)) return trimEnds(node.text);
  while (isTextElement(root.parent)) root = root.parent!;
  const runs: EngineNode[] = [];
  const collect = (from: EngineNode) => {
    for (const child of from.children) {
      if (child.kind === 'text') {
        if (child.text) runs.push(child);
      } else if (isTextElement(child)) collect(child);
    }
  };
  collect(root);
  let text = node.text;
  if (runs[0] === node) text = trimStart(text);
  if (runs[runs.length - 1] === node) text = trimEnd(text);
  return text;
}

/** The part of a node `viewNameOf` reads: an engine node, or any host's mirror of one. */
export interface ViewNameNode {
  readonly kind: string;
  readonly name: string;
  readonly parent: ViewNameNode | null;
  /** Whether a component is mounted on it, and whether that component is the native view. */
  readonly componentHost?: boolean;
  readonly nativeView?: boolean;
  /** What it holds, which decides whether one of HTML's text elements is text or a view. */
  readonly children?: readonly ViewNameNode[];
  /** Set on the paragraph the engine makes for a run of text written straight into a view. */
  readonly anonymous?: boolean;
}

/**
 * Whether an element is text: a `<text>`, or one of HTML's text elements that holds only text and
 * other such elements. Worked out each time, from the tree as it is, so nothing can go stale.
 */
function isTextElement(node: ViewNameNode | null): boolean {
  if (node === null || node.kind !== 'element') return false;
  if (node.name === 'text') return true;
  // One lookup settles nearly every other element, which is a view.
  if (registeredViewName(node.name) !== PARAGRAPH) return false;
  return !TEXT_ELEMENTS.has(node.name) || holdsOnlyText(node);
}

/** Whether a text element holds text and nothing else. One that holds nothing holds no text. */
function holdsOnlyText(node: ViewNameNode): boolean {
  const children = node.children ?? [];
  for (const child of children) {
    if (child.kind === 'element' && !isTextElement(child)) return false;
  }
  return children.length > 0;
}

const ALIGNS = new Set(['center', 'flex-end', 'space-around', 'space-evenly']);

/**
 * Whether one of HTML's text elements is a flex container that aligns the one run of text it
 * holds, as an avatar's initials are centred: `<span class="flex items-center justify-center">`.
 *
 * A browser makes the run a flex item and places it. A paragraph's text is its content, which no
 * alignment moves, so such an element commits as a view, and its text as the paragraph any view's
 * loose text is. Read from the node's own style on each reconcile, which a change to it brings
 * about, so nothing is kept to go stale. The run can be a text element of its own, a label in a
 * span, which is then the item placed. A `<text>` is a paragraph whatever its style, and an
 * element holding more than the one run is left as it was.
 */
function aligningText(node: EngineNode): boolean {
  if (node.kind !== 'element' || node.name === 'text' || !TEXT_ELEMENTS.has(node.name)) {
    return false;
  }
  if (node.children.length !== 1 || !oneRun(node.children[0]!)) return false;
  // Under a text element it is a span of that paragraph, unless that one is a view placing it.
  if (isTextElement(node.parent) && !aligningText(node.parent as EngineNode)) return false;
  if (ownLayout(node, 'display') !== 'flex') return false;
  return (
    ALIGNS.has(ownLayout(node, 'alignItems') as string) ||
    ALIGNS.has(ownLayout(node, 'justifyContent') as string)
  );
}

/** One run of text to place: text itself, or a text element around some, a label in a span. */
const oneRun = (child: EngineNode): boolean =>
  child.kind === 'text' || (child.kind === 'element' && TEXT_ELEMENTS.has(child.name));

/** The view a node is committed as: `viewNameOf`, but for a text element that aligns its text. */
const committedViewName = (node: EngineNode): string =>
  aligningText(node) ? DEFAULT_VIEW : viewNameOf(node);

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
  // A component of the app's own under a name a view set registered: its host is a plain view.
  if (node.componentHost && !node.nativeView && YIELDING.has(node.name)) return DEFAULT_VIEW;
  const registered = registeredViewName(node.name);
  // Nearly every element: a view of some kind, by its name alone.
  if (registered !== PARAGRAPH) return registered ?? DEFAULT_VIEW;
  // One of HTML's text elements that holds something other than text: a view.
  if (node.name !== 'text' && TEXT_ELEMENTS.has(node.name) && !holdsOnlyText(node)) {
    return DEFAULT_VIEW;
  }
  // The paragraph the engine makes for a view's loose text is under a view, whatever the name
  // of the element that view is.
  return nestedText(node) ? VIRTUAL_TEXT : PARAGRAPH;
}

/**
 * Whether a text element is a span of the paragraph above it: under another text element, but
 * not one that is a view for placing this one (see `aligningText`), nor the engine's own box.
 */
const nestedText = (node: ViewNameNode): boolean =>
  !node.anonymous && isTextElement(node.parent) && !placesText(node.parent);

/** Whether a node's parent is a text element committed as a view, to place the run it holds. */
const placesText = (parent: ViewNameNode | null | undefined): boolean =>
  parent != null && 'props' in parent && aligningText(parent as unknown as EngineNode);

/**
 * The props every native view reads as a boolean: the `bool` fields of React Native's
 * `BaseViewProps`, `AccessibilityProps` and `HostPlatformViewProps`, by the names JavaScript sends.
 *
 * An attribute arrives as text. A component that declares the prop as an input turns it into a
 * boolean itself, but an element nothing claims, such as a component's own host, holds what it
 * was given, and Android refuses a string where it reads a boolean: `focusable="false"` is
 * `java.lang.String cannot be cast to java.lang.Boolean` at the first commit. iOS ignores it.
 *
 * So the text is made a boolean as it is committed, `"false"` false and anything else true, as an
 * attribute reads in HTML. The node keeps the text, which is what `[focusable="false"]` in a
 * stylesheet matches against.
 */
const BOOLEAN_VIEW_PROPS = new Set([
  'accessibilityElementsHidden',
  'accessibilityIgnoresInvertColors',
  'accessibilityRespondsToUserInteraction',
  'accessibilityShowsLargeContentViewer',
  'accessibilityViewIsModal',
  'accessible',
  'collapsable',
  'collapsableChildren',
  'focusable',
  'hasTVPreferredFocus',
  'needsOffscreenAlphaCompositing',
  // The flags native reads to know an event has a listener, which are booleans as well.
  'onAccessibilityAction',
  'onAccessibilityEscape',
  'onAccessibilityMagicTap',
  'onAccessibilityTap',
  'onLayout',
  'removeClippedSubviews',
  'renderToHardwareTextureAndroid',
  'screenReaderFocusable',
  'shouldRasterizeIOS',
]);

/**
 * Whether `node` holds nothing `:empty` sees besides `moved`: so it was empty before `moved` came,
 * or is now that it has gone. What `:empty` does not see is `fills` in css.ts to say.
 */
function wasOrIsEmptyWithout(node: EngineNode, moved: EngineNode): boolean {
  if (!fills(moved)) return false;
  return !node.children.some((child) => child !== moved && fills(child));
}

/**
 * Have the child that paints a node's background merged again with the node: nothing of the
 * child's own moved, and what it paints may have.
 */
function repaint(node: EngineNode): void {
  if (node.paintsOn?.parent === node) node.paintsOn.propsDirty = true;
}

/** A sixtieth of a second: how far apart the frames native is given for an animation are. */
const NATIVE_FRAME = 1000 / 60;

/** The style keys that are a view's background. */
const PAINT_KEYS = [
  'backgroundColor',
  'experimental_backgroundImage',
  'experimental_backgroundSize',
  'experimental_backgroundPosition',
  'experimental_backgroundRepeat',
];

/**
 * A node's own props onto what it commits with. No native prop has a hyphen: `data-*` and `aria-*`
 * attributes stay on the node for selectors to match, and an `aria-*` one is mapped to the prop
 * native reads. The node's `attributeOnly` names stay on it the same way.
 */
function writeOwnProps(
  own: Record<string, unknown>,
  props: Record<string, unknown>,
  attributeOnly?: ReadonlySet<string>,
): void {
  let aria = false;
  for (const key of Object.keys(own)) {
    if (attributeOnly?.has(key)) continue;
    if (key.includes('-')) aria ||= key.startsWith('aria-');
    else if (key !== 'style' && key !== INTRINSIC_SIZE && key !== STYLE_OVERRIDE) {
      props[key] = committedProp(key, own[key]);
    }
  }
  if (!aria) return;
  // An attribute-only `aria-*` is not mapped to the prop native reads either.
  const mapped = attributeOnly?.size
    ? Object.fromEntries(Object.entries(own).filter(([key]) => !attributeOnly.has(key)))
    : own;
  applyAria(mapped, props);
}

/** A prop as it is committed: a boolean view prop held as text is the boolean the text says. */
function committedProp(key: string, value: unknown): unknown {
  return typeof value === 'string' && BOOLEAN_VIEW_PROPS.has(key) ? value !== 'false' : value;
}

/**
 * The `pointer-events` an element ends up with, in the order its props are merged: its inline
 * style's, then its `pointerEvents` prop, then what the sheets resolve. The inline one is read for
 * itself because an element no rule matches resolves to what it inherits, with its own inline
 * value only in what it hands down.
 */
function pointerEventsOf(node: EngineNode, resolved: Record<string, unknown>): unknown {
  const inline = node.inlineInherits ? inlineInherited(node.props['style']) : null;
  const own = inline?.['pointerEvents'];
  // Merged over the prop, so its `inherit` is what the sheets and the parent settled, not the prop.
  if (own === 'inherit') return resolved['pointerEvents'];
  return own ?? node.props['pointerEvents'] ?? resolved['pointerEvents'];
}
/**
 * A node's `pointer-events` as native takes it, once its props and styles are merged.
 *
 * In CSS `none` is the element alone, and a descendant's `auto` takes touches again, which native
 * calls `box-none`: what a `none` with something inside to open it is committed as. Native's own
 * `none` is the whole subtree. It is what a `none` with nothing inside to open it stays, because
 * Android's text and images take no `pointerEvents` of their own and only an ancestor's `none`
 * keeps touches off them. It is also what the `pointerEvents` prop means, so a `none` that is the
 * prop's is left as it is.
 *
 * An inline `inherit` is what the element has without it, which is `resolved`: what the sheets
 * and its parent settled.
 */
function nativePointerEvents(
  node: EngineNode,
  style: Record<string, unknown>,
  resolved: unknown,
): void {
  let value = style['pointerEvents'];
  if (value === undefined) return;
  if (value === 'inherit') {
    value = resolved;
    if (value === undefined) delete style['pointerEvents'];
    else style['pointerEvents'] = value;
  }
  if (value === 'none' && node.touchWithin && node.props['pointerEvents'] !== 'none') {
    style['pointerEvents'] = 'box-none';
  }
}
/** Whether `node`, whose `pointer-events` is `value`, takes touches or holds something that does. */
function takesTouches(node: EngineNode, value: unknown, prop: unknown): boolean {
  if (value === undefined) return false;
  // The prop's `none` is native's: the whole subtree, whatever is inside it.
  if (value === 'none' && prop === 'none') return false;
  // CSS's `none` and native's `box-none` take no touches themselves: their children answer.
  if (value === 'none' || value === 'box-none') {
    return node.children.some((child) => child.touchWithin);
  }
  return true;
}

/**
 * Records on `node` whether it, or something inside it, takes touches where it would inherit
 * `none`. When that changes a `none` element's own answer, its props are marked to be committed
 * again.
 *
 * Called as a node is reconciled, after its children, so theirs are already current: a child that
 * was skipped as clean has nothing beneath it that changed, and a change beneath marks every
 * ancestor to come back through here.
 */
function noteTouches(node: EngineNode, style: StyleCache | null): void {
  if (!style) return;
  // Nearly every node: no `pointer-events` in any sheet, style or prop, and nothing recorded.
  const resolved = style.style['pointerEvents'];
  const prop = node.props['pointerEvents'];
  if (resolved === undefined && prop === undefined && !node.inlineInherits && !node.touchWithin) {
    return;
  }
  const value = pointerEventsOf(node, style.style);
  const within = takesTouches(node, value, prop);
  if (within === !!node.touchWithin) return;
  node.touchWithin = within;
  if (value === 'none') node.propsDirty = true;
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
  fitContainer: string | undefined = undefined;
  heightBasis: boolean | undefined = undefined;
  hasDirty = false;
  stateDirty = false;
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
  touchWithin: boolean | undefined = undefined;
  box: EngineNode | undefined = undefined;
  anonymous: true | undefined = undefined;
  styled: true | undefined = undefined;
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
/**
 * Colour props React Native does not name with a `color` suffix: `<switch>`'s pair ends in the
 * state each one paints - `trackColorForTrue` and `trackColorForFalse`. They are the same type
 * problem the `Android` suffix causes: Android's `ColorPropConverter` takes a number or a
 * platform-colour map, refuses a string, and throws rather than approximating one.
 */
const STATE_COLOR_PROPS = new Set(['trackColorForTrue', 'trackColorForFalse']);
/** Answers per key name, once: the regex ran for every prop of every node in every commit. */
const colorProps = new Map<string, boolean>();
function isColorProp(key: string): boolean {
  let answer = colorProps.get(key);
  if (answer === undefined) {
    colorProps.set(
      key,
      (answer = IS_COLOR_PROP.test(key) || STATE_COLOR_PROPS.has(key) || BRUSH_PROPS.has(key)),
    );
  }
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

/** The props of an SVG shape that take a brush, not a colour. */
const BRUSH_PROPS = new Set(['fill', 'stroke']);

/** Styles arrive as objects, arrays, nested arrays and nulls. Reduce to one object. */
/**
 * A bound transform is still the CSS string: see `inline-transform.ts`. One CSS cannot read
 * leaves the transform the rules set, as a browser drops it.
 */
function boundTransform(
  node: EngineNode,
  style: Record<string, unknown>,
  cascaded: unknown,
): Record<string, unknown> {
  const text = style['transform'];
  if (typeof text !== 'string') return style;
  // The same list for the same string, commit after commit: a transition compares the two ends
  // it is given, and a list made afresh each time reads as a new place to go.
  if (node.boundTransform?.text !== text) node.boundTransform = { text, list: transformList(text) };
  const list = node.boundTransform.list ?? cascaded;
  if (list === undefined) delete style['transform'];
  else style['transform'] = list;
  return style;
}

/** A transform string as the list native reads, and none for one CSS cannot read. */
const transformOf = (value: string): unknown[] => transformList(value) ?? [];

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
    const own = typeof transform === 'string' ? transformOf(transform) : transform;
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

/**
 * Whether a node could be the element a compound is written for, by its classes alone: its own,
 * and those of an alternative in its `:is()`, which is where Tailwind names a group or a peer.
 * A compound with no class in either could be any element.
 */
function couldBe(compound: Compound, node: EngineNode): boolean {
  if (!compound.classes.every((name) => node.classes?.has(name))) return false;
  return !compound.is?.length || compound.is.some((chain) => couldBe(chain.at(-1)!, node));
}

/** Dev-time commit accounting, so a slow frame can be attributed rather than guessed at. */
export interface EngineStats {
  commits: number;
  lastCommitMs: number;
  /** The initial mount, which is a different animal from a steady-state update. */
  firstCommitMs: number;
  /** Worst commit *after* the mount. This is the number that matters for frame rate. */
  worstCommitMs: number;
  /** Commits that took longer than 8ms, a frame at 120Hz, excluding the mount. */
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
  /** The nodes taken out of a child list since the last commit. See `releaseDetached`. */
  private readonly removedSinceCommit = new Set<EngineNode>();
  /**
   * `@keyframes` by name, across every sheet registered. One registry rather than one per sheet,
   * because that is the scope CSS gives them: a name defined in a global stylesheet is usable
   * from a component's. The cost is that two components defining the same name collide, last one
   * in wins, exactly as two stylesheets in a document would.
   */
  private readonly keyframes = new Map<string, readonly Keyframe[]>();
  /** Every sheet registered, in the order a document would hold them. See `sheetReplaced`. */
  private readonly sheetOrder: StyleSheet[] = [];
  /** The `@keyframes` each playing animation was started from. See `startPlaying`. */
  private readonly playedFrames = new WeakMap<RunningAnimation, readonly Keyframe[]>();
  /** Element names already reported as unclaimed, so a list of a thousand rows reports once. */
  private readonly reported = new Set<string>();
  private readonly processColor: (value: string | number) => unknown;
  /**
   * Whether any sheet seen so far asks about a node's position among its siblings. Until one
   * does, a child list can move without anything else needing to be looked at again.
   */
  private structuralSheets = false;
  /** How many children after a change in a list one of them reaches. See `siblingReach`. */
  private structuralAfter = 0;
  /** Whether one of them reaches the children before it. */
  private structuralBefore = false;
  /** The compounds of theirs that read an element's place from under it. See `markPlace`. */
  private readonly placeElsewhere = new Set<Compound>();
  /** The sheets `watchStructure` has read, which it is asked about once an element. */
  private readonly watchedStructure = new WeakSet<StyleSheet>();
  /** Whether any sheet uses `:has()`. See `markBeneath`. */
  private hasSheets = false;
  private readonly resolveAssetSource: (value: unknown) => unknown;

  constructor(fabric: FabricUIManager, rootTag: number, options: EngineOptions = {}) {
    this.fabric = fabric;
    this.rootTag = rootTag;
    const conditions = options.conditions ?? { width: 0, height: 0, colorScheme: 'light' };
    this.styles = new StyleResolver(options.globalStyles ?? null, conditions);
    this.viewportSize = { width: conditions.width, height: conditions.height };
    this.fontScale = conditions.fontScale;
    if (options.tokens) this.styles.setRootTokens(options.tokens);
    this.watchStructure(options.globalStyles);
    this.watchHas(options.globalStyles);
    this.watchActive(options.globalStyles);
    this.dev = options.dev ?? (globalThis as { __DEV__?: boolean }).__DEV__ === true;
    if (this.dev) {
      this.styles.onUndefinedToken = (name, props, on) =>
        this.reportUndefinedToken(name, props, on);
      this.styles.onUnreadDisplay = (name, value) => this.reportUnreadDisplay(name, value);
    }
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
      this.markActive(node);
      changed = true;
    }
    return changed;
  }

  /** Whether any sheet styles a pressed element, and each compound that asks about one from another. */
  private activeUse: { own: boolean; elsewhere: readonly Compound[] } = {
    own: false,
    elsewhere: [],
  };

  /** What each sheet in play asks about a pressed element: `activeUse` is all of them together. */
  private readonly activeBySheet = new Map<StyleSheet, ReturnType<typeof usesActive>>();

  /** Note what a sheet in play asks about a pressed element. See `markActive`. */
  private watchActive(sheet: StyleSheet | null | undefined): void {
    // Asked for every element a component's sheet is given to: noted once a sheet.
    if (!sheet || this.activeBySheet.has(sheet)) return;
    const use = usesActive(sheet);
    this.activeBySheet.set(sheet, use);
    if (!use.own && !use.elsewhere.length) return;
    this.countActive();
    if (this.styles.tracksHas) return;
    // What a pressed element is compared with is the rules it matched, which no cache kept until
    // a sheet asked. Nothing is resolved yet when the sheet is the one the engine was made with.
    this.styles.tracksHas = true;
    if (!this.root) return;
    this.root.styleDirty = true;
    this.markPath(this.root);
  }

  /** A sheet has left play, by a hot swap or by being removed: what it asked goes with it. */
  private unwatchActive(sheet: StyleSheet): void {
    if (this.activeBySheet.delete(sheet)) this.countActive();
  }

  private countActive(): void {
    const all = [...this.activeBySheet.values()];
    this.activeUse = {
      own: all.some((use) => use.own),
      elsewhere: all.flatMap((use) => use.elsewhere),
    };
  }

  /**
   * A press began or ended on `node` or under it, which is all that changed about it. A press
   * reaches every ancestor up to the root, and marking each as restyled would style the whole
   * screen again, twice a press. So each is only matched again, and keeps its style and all
   * that is under it unless it now matches other rules. An element a rule asks about from
   * inside or beside it, `.card:active .title`, changes more than itself, and is restyled with
   * everything under it as any other change is. With no rule for a pressed element at all there
   * is nothing to match.
   */
  private markActive(node: EngineNode): void {
    const { own, elsewhere } = this.activeUse;
    if (!own && !elsewhere.length) return;
    if (elsewhere.some((compound) => couldBe(compound, node))) return this.markProps(node);
    node.stateDirty = true;
    this.markPath(node.parent ?? node);
  }

  /**
   * Custom properties the device knows and the stylesheet cannot, once they change.
   *
   * Merged rather than replaced: the insets come from a view and the hairline from the device, so
   * a caller owns the properties it names and nothing else. Each owner writes all of its own at
   * once - four insets together, never one - so nothing is left over from a previous rotation.
   */
  /**
   * Match `sheet` against every node from now on, after the global sheet the engine was made
   * with, and restyle everything; false, and nothing done, when it already is. How a platform
   * applies a component whose CSS is not scoped, such as Angular's `ViewEncapsulation.None`.
   * `replacing` is a sheet added before that this one takes the place of, after a hot swap.
   */
  addGlobalSheet(sheet: StyleSheet, replacing?: StyleSheet): boolean {
    if (!this.styles.addGlobalSheet(sheet, replacing)) return false;
    if (replacing) this.sheetReplaced(replacing, sheet);
    else this.registerSheet(sheet);
    this.watchStructure(sheet);
    this.watchHas(sheet);
    this.watchActive(sheet);
    this.markPath(this.root);
    this.markWrittenFor(sheet, this.root);
    return true;
  }

  /**
   * Have styled again each node a sheet just added could match. The rest keep the style they
   * have, which the resolver lets stand for a node none of the sheet's rules is written for,
   * so a commit steps over them: the walk here is what finds the ones it must not step over.
   */
  private markWrittenFor(sheet: StyleSheet, node: EngineNode): void {
    if (node.kind === 'element' && this.styles.couldMatch(sheet, node)) {
      node.styleDirty = true;
      this.markPath(node);
    }
    for (const child of node.children) this.markWrittenFor(sheet, child);
  }

  /**
   * Stop matching a sheet `addGlobalSheet` added, and restyle everything; false, and nothing
   * done, when it is not one. A hot swap that leaves a None component no rules, or makes it scoped.
   */
  removeGlobalSheet(sheet: StyleSheet): boolean {
    if (!this.styles.removeGlobalSheet(sheet)) return false;
    this.sheetReplaced(sheet, null);
    this.markPath(this.root);
    return true;
  }

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
    const again = (measured: EngineNode): void => {
      measured.remeasure = true;
      this.markProps(measured, false);
    };
    const visit = (node: EngineNode): void => {
      for (const child of node.children) {
        // The paragraph of a run of text written straight into a view is kept on the text.
        if (child.kind === 'text' && child.box?.committed) again(child.box);
        if (child.kind !== 'element') continue;
        if (child.committed && MEASURED_VIEWS.has(committedViewName(child))) again(child);
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
  /**
   * Loads have settled for these families: every node held back for one, a span inside a
   * paragraph included, is laid out with the name again, registered or not. See `loadingFamilies`.
   */
  fontsSettled(families: ReadonlySet<string>): void {
    let held = false;
    const visit = (node: EngineNode): void => {
      for (const child of node.children) {
        if (child.heldFamily !== undefined && families.has(child.heldFamily)) {
          this.markProps(child, false);
          held = true;
        }
        visit(child);
      }
    };
    visit(this.root);
    if (held) this.commit();
  }

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
    this.styles.noteSheet(sheet);
    this.watchStructure(sheet);
    this.watchHas(sheet);
    this.watchActive(sheet);
    this.markProps(node);
  }

  /** The sheet each node given another's scope was created with. */
  private readonly ownSheets = new WeakMap<EngineNode, StyleSheet | null>();

  /** The window's size, from the conditions media queries use. Zero until the platform says. */
  get viewport(): { readonly width: number; readonly height: number } {
    return this.viewportSize;
  }

  private viewportSize: { readonly width: number; readonly height: number };
  /** The system text size, from the conditions. See `Conditions.fontScale`. */
  private fontScale: number | undefined;

  private readonly viewportWatchers = new Set<() => void>();

  /** Calls `listener` after each change of conditions, which is when `viewport` can change. */
  watchViewport(listener: () => void): () => void {
    this.viewportWatchers.add(listener);
    return () => this.viewportWatchers.delete(listener);
  }

  updateConditions(next: Conditions): void {
    this.viewportSize = { width: next.width, height: next.height };
    this.fontScale = next.fontScale;
    this.styles.setConditions(next);
    this.root.subtreeDirty = true;
    // Committed here rather than left to the next change-detection pass, because there may not
    // be one: no view is dirty, so a tick does no work and never reaches the renderer at all.
    this.commit();
    for (const watcher of this.viewportWatchers) watcher();
  }

  // --- mutation API -----------------------------------------------------

  createElement(name: string, sheet: StyleSheet | null = null): EngineNode {
    const node = new RetainedNode('element', name, this);
    node.sheet = sheet;
    this.styles.noteSheet(sheet);
    const html = HTML_ELEMENTS.get(name);
    if (html !== undefined) {
      if (html.role) node.props['accessibilityRole'] = html.role;
      node.styled = html.styled;
    }
    this.watchStructure(sheet);
    this.watchHas(sheet);
    this.watchActive(sheet);
    if (HOISTS[name]) this.hoisted.add(node);
    return node;
  }

  addClass(node: EngineNode, name: string): void {
    (node.classes ??= new Set()).add(name);
    this.markClasses(node, [name]);
  }

  removeClass(node: EngineNode, name: string): void {
    node.classes?.delete(name);
    this.markClasses(node, [name]);
  }

  /**
   * Mark a node whose classes changed, by what the rules that name those classes can restyle.
   *
   * A class no selector names changes no style: a library's own marker, of an overlay that is
   * animating or a control that was touched. One named only as what a rule's element is
   * inside, `.animating .close`, restyles the elements under the node that such rules are for.
   * Either way a whole subtree is not styled again for a class that has no say in it. Any other
   * class restyles the node and everything under it, as any other change to it does.
   *
   * A sheet that names a class later restyles what it is for as it arrives, and a node not yet
   * committed is styled when it is, with the class as it is then.
   */
  private markClasses(node: EngineNode, changed: Iterable<string>): void {
    const reach = this.styles.reachOf(changed);
    if (reach === true) return this.markProps(node);
    this.markProps(node, false);
    if (reach) this.markUnder(node, reach);
  }

  /** Have styled again each element under a node that one of `subjects`' rules could be for. */
  private markUnder(node: EngineNode, subjects: Subjects): void {
    for (const child of node.children) {
      if (child.kind !== 'element') continue;
      if (this.styles.isFor(subjects, child)) {
        // And with it all under it, which is styled from it.
        child.styleDirty = true;
        this.markPath(child);
      } else this.markUnder(child, subjects);
    }
  }

  /**
   * The sheet of the component `node` hosts, whose `:host` rules it matches. Set again when a hot
   * swap replaces the component's sheet, which recreates the views inside but not the host, so the
   * host is styled afresh here.
   */
  setHostSheet(node: EngineNode, sheet: StyleSheet | null): void {
    if (node.hostSheet === sheet) return;
    node.hostSheet = sheet;
    this.styles.noteSheet(sheet);
    this.watchStructure(sheet);
    this.watchActive(sheet);
    this.markProps(node);
  }

  /**
   * Style for `node` that any matched rule or inline style overrides, as a browser's own default
   * for an element is. `mount` gives the root component's host the surface's height this way, as
   * the web's mount point has, unless the app's `:host` sizes it otherwise.
   */
  setDefaultStyle(node: EngineNode, style: Readonly<Record<string, unknown>> | undefined): void {
    node.defaultStyle = style;
    this.markProps(node);
  }

  /** `class="a b"` from a template. Replaces the set rather than adding to it. */
  setClasses(node: EngineNode, value: string): void {
    const names = value.split(/\s+/).filter(Boolean);
    const before = node.classes;
    node.classes = names.length ? new Set(names) : null;
    // Each class that came or went: one in both changes nothing.
    const changed = [...names.filter((name) => !before?.has(name))];
    for (const name of before ?? []) if (!node.classes?.has(name)) changed.push(name);
    this.markClasses(node, changed);
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
    this.markStructure(parent, child, parent.children.length - 1);
    this.markTextContent(parent, child);
  }

  insertBefore(parent: EngineNode, child: EngineNode, ref: EngineNode | null): void {
    this.detach(child);
    child.parent = parent;
    const at = ref ? parent.children.indexOf(ref) : -1;
    if (at < 0) parent.children.push(child);
    else parent.children.splice(at, 0, child);
    if (child.dormantHoists) this.wakeHoists(child);
    this.markStructure(parent, child, at < 0 ? parent.children.length - 1 : at);
    this.markTextContent(parent, child);
  }

  removeChild(parent: EngineNode | null, child: EngineNode): void {
    const target = parent ?? child.parent;
    if (!target) return;
    const at = target.children.indexOf(child);
    if (at < 0) return;
    target.children.splice(at, 1);
    child.parent = null;
    this.removedSinceCommit.add(child);
    this.markStructure(target, child, at);
    this.markTextContent(target, child);
  }

  /**
   * A child came or went under a view that takes its text as a prop: that prop changed. A span
   * changes it too, by keeping or dropping the space before it.
   */
  private markTextContent(parent: EngineNode, child: EngineNode): void {
    if (child.kind !== 'anchor' && takesTextAsProp(parent)) this.markProps(parent);
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
   * starts again if the node returns. And a node out of the tree when the commit runs forgets its
   * committed views, as a withheld modal does: the commit unmounts them, Fabric never re-enables an
   * unmounted view's events (`EventEmitter::setEnabled`), and committed again they would ignore
   * every touch. It comes back created afresh, as React creates an element it mounts again. One
   * put back before the commit never left, and keeps its views.
   *
   * Once per commit, and only after a removal: the walks are the depth of a handful of nodes, and
   * forgetting walks each subtree that left once.
   */
  private releaseDetached(): void {
    this.forgetDetached();
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
    this.releasePlayedNatively();
    for (const nodes of this.scrollTimelines.values()) {
      for (const node of nodes) {
        if (this.topOf(node) === this.root) continue;
        this.stopScrolled(node);
        this.markProps(node, false);
      }
    }
    if (this.focusedNode && this.topOf(this.focusedNode) !== this.root) this.focusedNode = null;
  }

  /** Forget the committed views of each node removed since the last commit that is still out. */
  private forgetDetached(): void {
    for (const node of this.removedSinceCommit) {
      if (node.committed && this.topOf(node) !== this.root) this.forgetCommitted(node);
    }
    this.removedSinceCommit.clear();
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
    // With what it holds: a node Angular destroys can be put back, as content projected into
    // an `@if` is, and its children's views would then be handed to the view it is made again
    // as. Native gives a view one parent for its life, and aborts on a second.
    if (node.committed) this.forgetCommitted(node);
    node.transitions = undefined;
    if (node.playing) this.stopNative(node, node.playing);
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
    // A prop written again is a binding's, and is committed as any other is.
    if (node.attributeOnly?.delete(key)) this.markProps(node, false);
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
    // And a child that takes one of this node's own values, an `inherit`, follows it.
    const heirs = node.styleCache?.heirs === true;
    this.markProps(node, key !== 'style' || this.inlineReachesStyle(node) || heirs);
  }

  /**
   * Paint a node's background on one of its children instead of on the node: the node keeps its
   * `background-color` and `background-image` in the cascade, where a stylesheet wrote them, and
   * the child is the view that draws them. What a view that masks its children and not itself
   * needs, as `<gradient-text>` is.
   */
  paintOn(node: EngineNode, child: EngineNode): void {
    node.paintsOn = child;
    this.markProps(node, false);
    this.markProps(child, false);
  }

  /**
   * Keep a prop the node already has as an attribute: on the node for a selector such as
   * `:host([variant='primary'])` to match, and left out of what is committed to the native view.
   * It is committed again once the prop is next written. What the platform adapter does with a
   * static attribute that is an input of the host's component.
   */
  keepAsAttribute(node: EngineNode, key: string): void {
    if (!(key in node.props)) return;
    (node.attributeOnly ??= new Set()).add(key);
    this.markProps(node, false);
  }

  /**
   * Whether a node's inline style can change what it or anything below it resolves to: it sets,
   * or until now set, a property its children inherit.
   */
  private inlineReachesStyle(node: EngineNode): boolean {
    const inherits = setsInherited(node.props['style']);
    const inherited = node.inlineInherits === true;
    node.inlineInherits = inherits;
    return this.noteInlineDirection(node) || inherits || inherited;
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
    this.markProps(node, this.inlineReachesStyle(node));
  }

  /**
   * A bound declaration, `[style.color]`, whose value may be a `var()`. One that is, is kept as a
   * declaration the cascade settles with the node's tokens, as a rule's is, and true is answered:
   * the text is no value to put in the node's style. Any other value forgets what was kept.
   */
  setBoundStyle(node: EngineNode, prop: string, value: unknown): boolean {
    const text = typeof value === 'string' && /^\s*var\(/i.test(value) ? value : undefined;
    const bound =
      text === undefined ? null : boundDeclaration(prop, tokenFromValue(text), node.name);
    if (!bound && !node.boundByProp?.has(prop)) return false;
    const byProp = (node.boundByProp ??= new Map());
    if (bound) byProp.set(prop, bound);
    else byProp.delete(prop);
    node.boundStyle = byProp.size ? [...byProp.values()] : null;
    this.markProps(node);
    return bound !== null;
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
    const filled = (node.text === '') !== (value === '');
    node.text = value;
    this.markProps(node);
    if (!node.parent) return;
    this.markTextContent(node.parent, node);
    // Text of no length is nothing to `:empty`: its first character and its last change what
    // the element it is in matches, and what comes after that element.
    if (filled && this.structuralSheets) this.markFilled(node.parent);
  }

  private markFilled(node: EngineNode): void {
    node.styleDirty = true;
    this.markLaterSiblings(node);
    this.markPath(node);
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
      if (this.hasSheets) this.markBeneath(node.parent);
    }
    // The root has no parent to carry the mark, so it carries its own: `.dark` on the root alone
    // restyles everything beneath it.
    this.markPath(node.parent ?? node);
  }

  /** Start matching ancestors again on a change, once a sheet that uses `:has()` is in play. */
  private watchHas(sheet: StyleSheet | null | undefined): void {
    if (!sheet?.has || this.hasSheets) return;
    this.hasSheets = true;
    this.styles.tracksHas = true;
    // What is already resolved kept no record of the rules it matched: resolve it again. Nothing
    // is, when the sheet is the one the engine was made with.
    if (!this.root) return;
    this.root.styleDirty = true;
    this.markPath(this.root);
  }

  /**
   * Something at or beneath `from` changed: every node from there up may match a `:has()` rule
   * it did not, or stop matching one. They are matched again rather than marked for restyling,
   * which would restyle everything under them. Only sheets that use `:has()` pay.
   */
  private markBeneath(from: EngineNode | null): void {
    for (let node = from; node; node = node.parent) node.hasDirty = true;
  }

  private markLaterSiblings(node: EngineNode): void {
    const siblings = node.parent?.children;
    if (!siblings) return;
    for (let i = siblings.indexOf(node) + 1; i < siblings.length; i++) {
      siblings[i]!.styleDirty = true;
    }
  }

  /** `node`'s child list changed: `moved` came into it at `at`, or went out of it from there. */
  private markStructure(node: EngineNode, moved: EngineNode, at: number): void {
    node.structureDirty = true;
    // A child list that moved changes what its members match, though nothing about them did:
    // the old last row is no longer the last. Only sheets that ask about position pay for this.
    if (this.structuralSheets) {
      moved.styleDirty = true;
      this.markRepositioned(node.children, at, moved);
      // What the node itself matches hangs on its child list only through `:empty`, which only
      // its first child arriving or its last one leaving changes: and then what a later sibling
      // matches can too, `.box:empty + .spacer`. Styled again for any other change, everything
      // under it would be resolved again with it.
      if (wasOrIsEmptyWithout(node, moved)) {
        node.styleDirty = true;
        this.markLaterSiblings(node);
      }
    }
    if (this.hasSheets) this.markBeneath(node);
    this.markPath(node.parent);
  }

  /**
   * Mark the children whose place in a child list that changed at `at` a sheet could read
   * differently. The two at each end always, which are the old first and last and the new. Those
   * from `at` on where some sheet counts from the start or asks about any one before, since a
   * child's place from the start hangs only on those before it; and those before `at` where one
   * counts from the end. Styling one again resolves everything under it again, so a long list
   * gaining a row at its end is not the whole list.
   *
   * Where the sheets ask no further than the element just before (`+`), a rule steps a known
   * number of elements along from one whose own match changed, and those are all there is to
   * mark: that many after the change, and that many after the two at the start, either of which
   * may have stopped or started being first. Nothing comes after the two at the end.
   */
  private markRepositioned(children: readonly EngineNode[], at: number, moved: EngineNode): void {
    const steps = this.structuralAfter;
    const pastFirst = steps === Infinity ? 0 : steps;
    for (const child of elementsAtEnd(children, 2 + pastFirst, false)) this.markPlace(child);
    for (const child of elementsAtEnd(children, 2, true)) this.markPlace(child);
    if (this.structuralBefore) for (let i = 0; i < at; i++) this.markPlace(children[i]!);
    // The elements after the change, not counting the one that came, which is marked already.
    let left = steps;
    for (let i = at; i < children.length && left > 0; i++) {
      const child = children[i]!;
      this.markPlace(child);
      if (child.kind === 'element' && child !== moved) left--;
    }
  }

  /**
   * A child's place in its list changed, which is all that changed about it. It is matched
   * again, and keeps its style and all that is under it unless it now matches other rules: its
   * place is read by the rules that style it and by no other. Not where a rule reads the place
   * of an element like it from under it, `.row:nth-child(odd) .label`: that changes more than
   * the element itself, which is then styled again with everything under it, as is a child
   * that is no element.
   */
  private markPlace(child: EngineNode): void {
    if (child.kind !== 'element' || this.placeReadFromUnder(child)) child.styleDirty = true;
    else child.stateDirty = true;
  }

  /**
   * Whether a rule could read this element's place from another element. By its classes alone,
   * which every such compound it could be asks for: a compound with none could be any element.
   */
  private placeReadFromUnder(node: EngineNode): boolean {
    for (const compound of this.placeElsewhere) {
      if (compound.classes.every((name) => node.classes?.has(name))) return true;
    }
    return false;
  }

  /** Note what a sheet coming into play asks about a child list. None is unset: see `structural`. */
  private watchStructure(sheet: StyleSheet | null | undefined): void {
    if (!sheet?.structural || this.watchedStructure.has(sheet)) return;
    this.watchedStructure.add(sheet);
    this.structuralSheets = true;
    const reach = siblingReach(sheet);
    this.structuralAfter = Math.max(this.structuralAfter, reach.after);
    if (reach.before) this.structuralBefore = true;
    for (const compound of placeReadElsewhere(sheet)) this.placeElsewhere.add(compound);
    // What a child whose place changed is compared with is the rules it matched, which a cache
    // keeps from here on. One made before has none, and is styled again the first time, as it
    // was before any sheet asked.
    this.styles.tracksHas = true;
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
    if (this.removedSinceCommit.size) this.releaseDetached();
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
    this.announceCommit();
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
    this.playSized();
    this.scrollDriver?.afterCommit();
    // Read first: the commit that settles keyframes starts by clearing it.
    const facesAdded = this.facesAdded;
    if (this.awaitingKeyframes.size) this.settleKeyframes();
    if (facesAdded) this.rematchFonts();
    return true;
  }

  private beforeCommit: (() => void) | null = null;

  private announceCommit(): void {
    const run = this.beforeCommit;
    this.beforeCommit = null;
    run?.();
  }

  /**
   * Run `run` once, as the next commit hands its tree to the host and before the host has it: the
   * moment for something the host applies to its next commit, which is only this one from here.
   * A pass that changes nothing commits nothing and runs nothing, so a request waits until it is
   * taken back with the function returned. A later request replaces an earlier one.
   */
  beforeNextCommit(run: () => void): () => void {
    this.beforeCommit = run;
    return () => {
      if (this.beforeCommit === run) this.beforeCommit = null;
    };
  }

  /** The first commit whose new views have not been drawn yet, while `commitUnseen` runs. */
  private unseen = Infinity;

  /**
   * A commit for what changed in the same turn as earlier commits, before a frame was drawn.
   * `since` is how many commits there had been before the first of them (`stats.commits`).
   *
   * A view those commits created has not been seen in the style they gave it, so what this one
   * gives it is where it starts, and no transition runs toward it. That is what a browser
   * does with a class added to an element in the turn that inserted it, and what `animate.enter`
   * is built on: Angular adds the enter class after the render pass that created the element, and
   * takes it off a frame later, which is the one change the transition is for.
   */
  commitUnseen(since: number): boolean {
    this.unseen = since;
    try {
      return this.commit();
    } finally {
      this.unseen = Infinity;
    }
  }

  /** Nodes that asked for `@keyframes` this commit had not met, by the name they asked for. */
  private readonly awaitingKeyframes = new Map<EngineNode, string>();

  /**
   * A sheet is registered when the first node it styles is committed, so a node committed before
   * it can name keyframes that arrive later in the same commit. Those nodes play them from another
   * commit straight away, as a browser applies keyframes however the sheets arrived; a name still
   * unknown once the commit is over is reported.
   */
  private settleKeyframes(): void {
    const waiting = [...this.awaitingKeyframes];
    this.awaitingKeyframes.clear();
    let found = false;
    for (const [node, name] of waiting) {
      if (this.keyframes.has(name)) {
        this.markProps(node, false);
        found = true;
      } else if (this.dev) {
        this.reportMissingKeyframes(name);
      }
    }
    if (found) this.commit();
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
      // One listener that throws stops neither the rest nor the node being let go.
      for (const listener of [...(node.listeners?.get(type) ?? [])]) {
        try {
          listener(animationEvent(type, node, property));
        } catch (error) {
          this.reportEventError(error, type);
        }
      }
      if (type === 'topAnimationend') this.letGo(node);
    }
  }

  /**
   * The nodes whose animation has ended with no fill and is still held at its last frame, until
   * its `animationend` has been heard. A browser runs that listener before it paints again, and
   * an exit animation's listener takes the element away: it is never seen back at rest. Here the
   * listener runs after the commit, so the commit that ends the animation paints the last frame,
   * and the element goes back to rest once the listener has run and left it there.
   */
  private readonly lettingGo = new Set<EngineNode>();

  private letGo(node: EngineNode): void {
    if (!this.lettingGo.delete(node)) return;
    const running = node.playing;
    if (!running?.done) return;
    running.values = {};
    this.markProps(node, false);
  }

  /** Anchors take part in sibling ordering but never reach Fabric. */
  private visibleChildren(node: EngineNode): EngineNode[] {
    // A view that takes its text as a prop has no text children to commit. See `ViewNameOptions`.
    const textAsProp = takesTextAsProp(node);
    return node.children.filter(
      (child) => child.kind !== 'anchor' && !(textAsProp && child.kind === 'text'),
    );
  }

  /**
   * Everything a node renders with, unprocessed. Precedence, weakest first: native defaults, the
   * node's `defaultStyle`, matched CSS, explicit props, inline style, a component's
   * `styleOverride`. Inline wins over CSS as it does on the web, but for a declaration marked
   * `!important`, which stands over it: see `inlineOf`.
   *
   * Raw, because this is what the next commit diffs against. Colours and asset ids are converted
   * on the way out instead (`processed`), and only for the keys that changed: the converters
   * return fresh objects, so diffing their output would re-send every image and shadow on every
   * unrelated change.
   */
  /** What a touch on an element that keeps a drag holds off, while it lasts: see `holdSwipe`. */
  private heldFor(node: EngineNode, merged: Record<string, unknown>): void {
    if (node === this.swipeHeld) merged['gestureResponseDistance'] = NO_SWIPE;
    if (node === this.scrollHeld) merged['scrollEnabled'] = false;
  }

  private mergeProps(node: EngineNode, viewName: string): Record<string, unknown> {
    if (node.kind === 'text') return { text: paragraphText(node) };
    if (this.dev) this.checkProps(node);
    this.registerSheet(node.sheet);
    this.registerSheet(node.hostSheet);
    const props: Record<string, unknown> = { ...DEFAULT_PROPS[viewName], ...node.defaultStyle };
    Object.assign(props, this.styles.resolve(node, this.styleEpoch).style);
    const resolved = props['pointerEvents'];
    writeOwnProps(node.props, props, node.attributeOnly);
    withTextContent(node, viewName, props);
    const cascaded = props['transform'];
    const inline = inlineOf(node);
    const style = boundTransform(node, Object.assign(props, inline), cascaded);
    if (inline !== NO_STYLE) this.styles.overOtherForms(inline, style);
    nativePointerEvents(node, style, resolved);
    // Before an image's own size: `fit-content` is no size, so the image's is what it gets.
    fitContent(node, style);
    percentHeight(node, style);
    placeholderFaded(style);
    const intrinsic = node.props[INTRINSIC_SIZE] as IntrinsicSize | undefined;
    if (intrinsic) applyIntrinsicSize(style, intrinsic);
    flattenStyle(node.props[STYLE_OVERRIDE], style);
    this.fontFaces.apply(style);
    holdLoadingFamily(node, style);
    if (viewName === PARAGRAPH) alignText(style, this.directionOf(node, style));
    if (this.fontsRefreshed) this.capForFonts(node, style);
    alignMultiline(viewName, style);
    rowsTall(style, this.fontScale);
    const merged = composeTransform(node, this.animated(node, this.transitioned(node, style)));
    // On iOS: Android's field says the baseline of the line it is sized and centred by.
    // Still under the row that marked it: a row taken away is not committed again to unmark it.
    const row = node.onBaseline;
    const onBaseline = viewName === 'TextInput' && row !== undefined && isWithin(node, row);
    centreSingleLine(viewName, merged, this.fontScale, onBaseline);
    // After a transition, which eases the basis as the basis it was written as.
    basisAsSize(node, merged);
    // After the basis, which is a size given where it is committed as one.
    ratioForAutoSize(merged);
    noOutline(merged);
    // Last, on what is committed: an override or an animation can hide a box, or place it.
    hiddenOutOfFlow(merged);
    delete merged['touchAction'];
    if (this.responders.has(node)) stillTouched(merged);
    this.heldFor(node, merged);
    this.movePaint(node, merged);
    return merged;
  }

  /**
   * Leave a node's background out of what it commits when a child paints it, and give that child
   * its parent's: the cascade's, and over it the parent's inline style.
   */
  private movePaint(node: EngineNode, merged: Record<string, unknown>): void {
    if (node.paintsOn) for (const key of PAINT_KEYS) delete merged[key];
    const from = node.parent?.paintsOn === node ? node.parent : null;
    if (!from) return;
    const paint = { ...this.styles.resolve(from, this.styleEpoch).style, ...inlineOf(from) };
    for (const key of PAINT_KEYS) if (paint[key] !== undefined) merged[key] = paint[key];
  }

  /**
   * A container whose direction or alignment changed since a child with a `fit-content` size
   * read it, or whose height stopped or started being one a percentage is taken of since a child
   * with a percentage height asked: those children are merged again. A change to a container
   * marks nothing beneath it, since none of these is inherited.
   */
  private refitChildren(node: EngineNode): void {
    // Both are asked, and both remembered, before either has the children merged again.
    const basis = node.heightBasis;
    const based = basis !== undefined && definiteHeight(node) !== basis;
    const fitted = node.fitContainer !== undefined && containerOf(node) !== node.fitContainer;
    if (fitted) node.fitContainer = containerOf(node);
    if (based || fitted) this.refit(node);
  }

  /** Have a container's children merged again, through any `display: contents` among them. */
  private refit(container: EngineNode): void {
    for (const child of container.children) {
      if (child.kind !== 'element') continue;
      child.propsDirty = true;
      if (containerOf(child) === 'contents') this.refit(child);
    }
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
      const inline = textDirection(inlineOf(at)['direction']);
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
    this.styles.noteSheet(sheet);
    this.sheetOrder.push(sheet);
    for (const name of Object.keys(sheet.keyframes ?? {})) {
      this.keyframes.set(name, sheet.keyframes![name]!);
    }
    if (sheet.fonts && this.fontFaces.add(sheet.fonts)) this.facesAdded = true;
  }

  /**
   * A hot swap edited a component's sheet into `next`, or took it away with null: `sheet`'s
   * `@keyframes` go, and `next`'s take its place among the others, as an edited stylesheet keeps
   * its place in a document. A name another sheet also defines falls back to that one. Every
   * animation re-resolves the name it plays, so one whose keyframes went stops, as in a browser.
   * A `sheet` already gone, such as a global sheet removed, leaves `next` registered last.
   */
  sheetReplaced(sheet: StyleSheet, next: StyleSheet | null): void {
    if (sheet === next && this.knownSheets.has(sheet)) return;
    this.unwatchActive(sheet);
    this.watchActive(next);
    const at = this.sheetOrder.indexOf(sheet);
    if (at === -1) {
      this.registerSheet(next);
      return;
    }
    this.knownSheets.delete(sheet);
    if (next && !this.knownSheets.has(next)) {
      this.knownSheets.add(next);
      this.styles.noteSheet(next);
      this.sheetOrder[at] = next;
    } else {
      this.sheetOrder.splice(at, 1);
    }
    if (sheet.keyframes || next?.keyframes) this.reindexKeyframes();
    if (sheet.fonts || next?.fonts) this.reindexFonts();
  }

  /**
   * Every sheet's `@font-face` rules again, in order, and every text that names a family matched
   * again: a face whose rule went is no longer matched, though the platform keeps it registered.
   */
  private reindexFonts(): void {
    this.fontFaces.clear();
    for (const sheet of this.sheetOrder) if (sheet.fonts) this.fontFaces.add(sheet.fonts);
    this.markFontText(this.root);
  }

  /** Every sheet's `@keyframes` again, in order, and every animation told to look them up. */
  private reindexKeyframes(): void {
    this.keyframes.clear();
    for (const sheet of this.sheetOrder) {
      for (const name of Object.keys(sheet.keyframes ?? {})) {
        this.keyframes.set(name, sheet.keyframes![name]!);
      }
    }
    this.markAnimated(this.root);
  }

  /** Mark every node under `node` with an animation, so it looks its keyframes up again. */
  private markAnimated(node: EngineNode): void {
    for (const child of node.children) {
      if (child.playing || child.scrolled) this.markProps(child, false);
      this.markAnimated(child);
    }
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
    this.markFontText(this.root);
    this.commit();
  }

  /** Mark every element under `node` committed with a family, so it is matched again. */
  private markFontText(node: EngineNode): void {
    const named = (text: EngineNode | undefined): void => {
      if (typeof text?.committed?.props['fontFamily'] === 'string') this.markProps(text, false);
    };
    for (const child of node.children) {
      // The paragraph of a run of text written straight into a view is kept on the text.
      if (child.kind === 'text') named(child.box);
      if (child.kind !== 'element') continue;
      named(child);
      this.markFontText(child);
    }
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
        this.cancelPlaying(node);
        node.playing = undefined;
        this.playing.delete(node);
      }
      return props;
    }

    const frames = this.keyframes.get(spec.name);
    if (!frames) {
      // Keyframes a hot swap deleted, from under an animation that was playing them, or ones a
      // sheet later in this commit has: see `settleKeyframes`.
      this.cancelPlaying(node);
      node.playing = undefined;
      this.playing.delete(node);
      this.stopScrolled(node);
      this.awaitingKeyframes.set(node, spec.name);
      return props;
    }
    if (spec.timeline) return this.scrollAnimated(node, spec, frames, props);
    this.startPlaying(node, spec, frames, props);
    return Object.assign(props, node.playing?.values ?? {});
  }

  /**
   * A clock animation the scroll plays instead: the same animation where only the timeline moved,
   * and one cancelled where the name changed.
   */
  private handOverToScroll(node: EngineNode, spec: AnimationSpec): void {
    if (!node.playing) return;
    this.stopNative(node, node.playing);
    if (node.playing.spec.name !== spec.name) this.cancelPlaying(node);
    node.playing = undefined;
    this.playing.delete(node);
  }

  /**
   * `animationcancel` for an animation stopped before it ended: the element no longer asks for it,
   * asks for another by name, or its keyframes went, as a browser fires it.
   */
  private cancelPlaying(node: EngineNode): void {
    const running = node.playing;
    if (running) this.stopNative(node, running);
    if (running && !running.done)
      this.emitTransition(node, 'topAnimationcancel', running.spec.name);
  }

  /** Stop on native each animation whose view has left the tree. */
  private releasePlayedNatively(): void {
    for (const node of [...this.playedNatively]) {
      if (this.topOf(node) === this.root) continue;
      this.stopNative(node, node.playing!);
      node.playing = undefined;
      this.markProps(node, false);
    }
  }

  /** Every node whose animation native is playing, with no frame of it in JavaScript. */
  private readonly playedNatively = new Set<EngineNode>();

  /**
   * Hand an animation that has just started to native, where native can play it: one that moves
   * only opacity and transforms, starts at once, and repeats a whole number of times. Native then
   * runs it frame by frame, and JavaScript hears of it again when it ends. Anything else is
   * played from here, a commit a frame. See `NativeScrollDriver.play`.
   */
  /**
   * The nodes whose animation moves them by a share of their own size and had no size yet when
   * it started, each with the style it rests at: asked again once the commit has laid them out.
   */
  private readonly unsized = new Map<EngineNode, Record<string, unknown>>();

  /**
   * An animation's frames as native can interpolate them: a move by a share of the box,
   * `translateX(200%)`, as the points that is of the size the view is laid out at. Nothing where
   * the view has no size yet, which is every view until its first commit: it is played from
   * JavaScript, and handed over once that commit has laid it out. See `playSized`.
   *
   * ponytail: the size it had when it started. A box that changes size goes on moving by the
   * points of the old one until the animation starts again; restart it from the box's layout
   * event if a bar that resizes mid-animation comes up.
   */
  private sized(
    node: EngineNode,
    running: RunningAnimation,
    props: Record<string, unknown>,
  ): { tracks: RunningAnimation['tracks']; resting: Record<string, unknown> } | null {
    // One that waits, or takes no time, is played from here whatever it moves by.
    if (running.spec.delay !== 0 || running.spec.duration <= 0) return null;
    if (!movesByShare(running.tracks, props)) return { tracks: running.tracks, resting: props };
    let size: { width: number; height: number } | undefined;
    this.measure(node, (frame) => (size = frame));
    if (size) return sharesAsPoints(running.tracks, props, size);
    this.unsized.set(node, props);
    return null;
  }

  /**
   * Hand to native each animation that was waiting for its view to have a size. The commit just
   * made painted its first frame, so its clock starts here: no frame of it has been seen move.
   */
  private playSized(): void {
    if (!this.unsized.size) return;
    const waiting = [...this.unsized];
    this.unsized.clear();
    for (const [node, props] of waiting) {
      const running = node.playing;
      if (!running || running.done || running.native || !this.playing.has(node)) continue;
      // Native plays it from its first frame, so its clock starts here: but only where native
      // takes it. Left in JavaScript, it goes on from the clock it started on.
      const started = running.start;
      running.start = this.now();
      if (this.playNatively(node, running, props)) {
        this.playing.delete(node);
        // `collapsable`, which keeps a view for native to move, is in what it holds now.
        this.markProps(node, false);
      } else {
        running.start = started;
      }
    }
    // One with no size after its commit is not laid out at all, and is played from JavaScript.
    this.unsized.clear();
  }

  private playNatively(
    node: EngineNode,
    running: RunningAnimation,
    props: Record<string, unknown>,
  ): boolean {
    const { spec } = running;
    const sized = this.scrollDriver ? this.sized(node, running, props) : null;
    if (!this.scrollDriver || !sized) return false;
    const { channels, held, span } = clockChannels(sized.tracks, spec, sized.resting);
    if (held.length || !(channels.opacity || channels.transform.length)) return false;
    // There and back is one native animation: an odd number of ways has no whole number of them.
    const count = spec.iterations === null ? -1 : spec.iterations / span;
    if (count !== -1 && !(Number.isInteger(count) && count > 0)) return false;
    const length = Math.max(2, Math.round((spec.duration * span) / NATIVE_FRAME) + 1);
    const frames = Array.from({ length }, (_, i) => i / (length - 1));
    const native = this.scrollDriver.play(
      node,
      channels,
      { frames, toValue: span, iterations: count },
      (view) => this.tagOf(view as EngineNode),
      () => this.endedNatively(node, running),
    );
    if (!native) return false;
    running.native = native;
    // As Animated does: Fabric flattens a view that only lays out, and then there is no native
    // view for the animation to move.
    running.values = { ...running.values, collapsable: false };
    this.playedNatively.add(node);
    return true;
  }

  /**
   * Native reached the end of an animation it was playing. The frame it ends at, or the resting
   * style where it does not fill, is committed before the view is let go, so nothing shows of
   * the frame it started at, which is what the view had been committed with.
   */
  private endedNatively(node: EngineNode, running: RunningAnimation): void {
    if (node.playing !== running || !running.native) return;
    const { native, spec } = running;
    running.native = undefined;
    this.playedNatively.delete(node);
    const end = running.start + spec.duration * (spec.iterations ?? 1);
    this.advancePlayer(node, Math.max(this.now(), end));
    this.commit();
    native.stop();
  }

  /** Take an animation back from native, which stops it there. The caller plays it on, or not. */
  private stopNative(node: EngineNode, running: RunningAnimation): void {
    if (!running.native) return;
    running.native.stop();
    running.native = undefined;
    this.playedNatively.delete(node);
  }

  /**
   * Play on from JavaScript an animation native was playing, from where its clock has got to:
   * what a pause, other frames or a view made again need, none of which native can be told of.
   */
  private backToScript(node: EngineNode, running: RunningAnimation): void {
    if (!running.native) return;
    this.stopNative(node, running);
    running.values = sample(running, this.now()).values;
    if (!running.done && running.pausedAt === undefined) this.playing.add(node);
  }

  /** Start the clock on an animation, unless the node is already playing this one. */
  private startPlaying(
    node: EngineNode,
    spec: AnimationSpec,
    frames: readonly Keyframe[],
    props: Record<string, unknown>,
  ): void {
    const current = node.playing;
    const inherited = this.inheritedColour(node, frames);
    if (!current || !sameAnimation(current.spec, spec)) {
      if (current && current.spec.name !== spec.name) this.cancelPlaying(node);
      else if (current) this.stopNative(node, current);
      const started: RunningAnimation = {
        spec,
        tracks: tracksOf(frames, props, inherited),
        inherited,
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
      this.playedFrames.set(started, frames);
      node.playing = started;
      if (spec.paused) started.pausedAt = this.now();
      else if (!this.playNatively(node, started, props)) this.playing.add(node);
      this.emitTransition(node, 'topAnimationstart', spec.name);
      return;
    }
    // A view made again is another view: the one native was moving is gone.
    if (node.committed === null) this.backToScript(node, current);
    if (this.playedFrames.get(current) !== frames || inherited !== current.inherited) {
      this.backToScript(node, current);
      this.reframe(node, current, frames, props, inherited);
    }
    this.playOrPause(node, node.playing!, spec);
  }

  /**
   * The colour `node` inherits, for frames that set `color: currentColor`, which is that colour
   * wherever the animation has got to, as in CSS. Undefined for frames that do not.
   */
  private inheritedColour(node: EngineNode, frames: readonly Keyframe[]): unknown {
    if (!readsInheritedColour(frames)) return undefined;
    const parent = node.parent && this.styles.resolve(node.parent, this.styleEpoch);
    return parent?.inherited['color'] ?? 'black';
  }

  /**
   * The name an animation plays now has other frames: a hot swap edited them, or took away the
   * sheet whose copy won. Or the colour its `color: currentColor` stands for has changed. It
   * carries on along the new tracks, on its own clock, as a browser does, paused or not.
   */
  private reframe(
    node: EngineNode,
    current: RunningAnimation,
    frames: readonly Keyframe[],
    props: Record<string, unknown>,
    inherited: unknown,
  ): void {
    const tracks = tracksOf(frames, props, inherited);
    const reframed: RunningAnimation = { ...current, tracks, inherited };
    const { values, finished } = sample(reframed, current.pausedAt ?? this.now());
    const holds = current.spec.fill === 'forwards' || current.spec.fill === 'both';
    reframed.values = finished && !holds ? {} : values;
    this.playedFrames.set(reframed, frames);
    node.playing = reframed;
    // One that had nothing to paint was let go of: with frames that say something it plays on.
    const stopped = reframed.done || reframed.pausedAt !== undefined || reframed.native;
    if (!stopped) this.playing.add(node);
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
      this.backToScript(node, current);
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
    const inherited = this.inheritedColour(node, frames);
    if (current?.frames === frames && sameAnimation(current.spec, spec)) {
      return Object.assign(props, this.rescrolled(node, current, frames, props, inherited));
    }
    this.stopScrolled(node);
    this.handOverToScroll(node, spec);

    const tracks = tracksOf(frames, props, inherited);
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
    node.scrolled = { spec, frames, tracks, resting, first, source, drive, inherited };
    return Object.assign(props, first);
  }

  /**
   * The first frame of a scroll-driven animation already playing. When the colour its
   * `color: currentColor` stands for has changed, that frame's colour is taken from tracks built
   * again. Native drives opacity and transforms only, so a colour holds its first frame, and
   * nothing native animates is touched.
   */
  private rescrolled(
    node: EngineNode,
    current: ScrollAnimation,
    frames: readonly Keyframe[],
    props: Record<string, unknown>,
    inherited: unknown,
  ): Record<string, unknown> {
    if (inherited === current.inherited) return current.first;
    // The element's own colour, which a track with no first frame starts at, may be the one it
    // inherits, so it is read again too.
    const resting = { ...current.resting, color: props['color'] };
    const tracks = tracksOf(frames, resting, inherited);
    const extent = current.source ? this.scrollExtents.get(current.source) : undefined;
    const range = rangeOf(current.spec, extent?.[current.spec.timeline!] ?? null);
    const first = { ...current.first };
    const colour = firstFrame(tracks, current.spec, range)['color'];
    if ('color' in first) first['color'] = colour;
    node.scrolled = { ...current, tracks, resting, first, inherited };
    return first;
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
    // Nobody saw what the last commit gave a view it created, so this is where the view starts.
    if (node.bornIn! >= this.unseen) node.transitions = undefined;
    const spec = transitionSpec(props);
    if (!spec && !node.transitions) return props;

    const state = (node.transitions ??= new Map());
    const now = this.now();

    for (const key of steppedKeys(props, spec, state)) {
      if (step(state, key, props, spec?.[key] ?? spec?.['all'], now)) {
        this.running.add(node);
        this.emitTransition(node, 'topTransitionstart', key);
      }
    }

    if (state.size === 0) node.transitions = undefined;
    return props;
  }

  /**
   * Whether an animation that has finished goes on holding its last frame. With a forwards fill
   * it does, for good: without one the element falls back to whatever the cascade gives it, and
   * 'backwards' fills the start only. Heard, it holds until whoever listens has been told: see
   * `lettingGo`.
   */
  private keeps(node: EngineNode, running: RunningAnimation): boolean {
    if (running.spec.fill === 'forwards' || running.spec.fill === 'both') return true;
    // One that listened and has stopped leaves an empty set behind: nobody to hear it.
    if (!node.listeners?.get('topAnimationend')?.size) return false;
    this.lettingGo.add(node);
    return true;
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
    // Frames that say nothing paint nothing: a keyframe's one declaration refused at build time
    // leaves these. No frame of it is committed, and one that never ends has nothing left to do.
    const idle = running.tracks.size === 0;
    const { values, finished } = sample(running, now);
    // One of no time is finished already, endless or not, and ends as any other does.
    if (idle && !finished && running.spec.iterations === null) {
      this.playing.delete(node);
      return;
    }
    running.values = finished && !this.keeps(node, running) ? {} : values;
    // Its end is still a commit: that is what its `animationend` is sent after.
    if (!idle || finished) this.markProps(node, false);

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
      else if (isColorProp(key)) out[key] = this.painted(key, value);
      // A list of sources has already been resolved by whoever built it, as RN's resolver
      // also assumes: it passes any object through and only turns a number into one.
      else if (ASSET_PROPS.has(key) && !Array.isArray(value))
        out[key] = this.resolveAssetSource(value);
      else if (NESTED_COLOR_LIST_PROPS.has(key)) out[key] = this.processNestedColors(value);
      else if (key === 'experimental_backgroundImage') out[key] = this.processGradients(value);
      else if (key === 'filter') out[key] = this.processFilters(value);
      // A bound style's transform is still the CSS string: see `inline-transform.ts`.
      else if (key === 'transform' && typeof value === 'string') out[key] = transformOf(value);
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
   * Mark the text field each box of a row aligned by baseline takes its baseline from, before
   * the field is merged, and unmark it when the row is aligned another way.
   */
  private noteBaselineFields(row: EngineNode): void {
    const aligned = ownLayout(row, 'alignItems') === 'baseline';
    const before = row.baselineFields;
    if (!aligned && !before) return;
    const now = new Set(
      aligned ? row.children.filter(inFlow).map(fieldOnBaseline).filter(isNode) : [],
    );
    // One that is no longer this row's, and that no other row has marked since.
    for (const field of before ?? []) {
      if (!now.has(field) && field.onBaseline === row) this.onBaselineOf(field, undefined);
    }
    for (const field of now) if (field.onBaseline !== row) this.onBaselineOf(field, row);
    row.baselineFields = now.size ? now : undefined;
  }

  private onBaselineOf(field: EngineNode, row: EngineNode | undefined): void {
    field.onBaseline = row;
    this.markProps(field, false);
  }

  /**
   * Have the text a row aligned by baseline takes a baseline from measured again, where that
   * text is inside one of the row's boxes and the row is committed again. React Native keeps
   * what a paragraph measured on the one copy of its node that was measured, and Yoga copies a
   * node it lays out around: a row that is laid out again asks a box for its baseline, the box
   * asks the paragraph in it, and a copy that was never measured works it out then, on a node
   * that is by then not to be changed. A debug build stops there. Committed to be measured
   * again (`remeasure`), the paragraph is measured in this commit and has the answer.
   *
   * ponytail: the first box in the flow at each level, which is the one Yoga asks unless
   * another is aligned by baseline itself. A row a commit lays out again without the engine
   * cloning it, as its room changing does, is not reached: clone on a layout event if one is
   * seen to stop there.
   */
  private freshBaselines(row: EngineNode): void {
    if (!row.committed || ownLayout(row, 'alignItems') !== 'baseline') return;
    for (const item of row.children) {
      let at = firstInFlow(item);
      while (at?.committed && committedViewName(at) !== PARAGRAPH) at = firstInFlow(at);
      if (!at?.committed) continue;
      at.remeasure = true;
      for (let up: EngineNode | null = at; up && up !== row; up = up.parent) up.subtreeDirty = true;
    }
  }

  /**
   * Copy a list of gradients, running every stop's colour through the host's converter.
   *
   * A stop's colour is a colour like any other, but it is two levels down and nothing else looks
   * there: without this the device is handed the string `rgb(255, 0, 0)` where it wants a number,
   * and paints nothing. The stops are first rewritten so native's interpolation paints what
   * CSS's premultiplied one does (see `premultipliedStops`).
   */
  private processGradients(value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    return value.map((entry) => {
      const gradient = entry as { colorStops?: { color?: unknown }[] };
      if (!Array.isArray(gradient?.colorStops)) return entry;
      return {
        ...gradient,
        colorStops: premultipliedStops(gradient.colorStops).map((stop) => ({
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
    repaint(node);
    this.refitChildren(node);

    const viewName = committedViewName(node);
    this.forgetRenamed(node, viewName);
    this.noteBaselineFields(node);
    this.freshBaselines(node);
    const childHandles = this.reconcileChildren(node, viewName, style);
    noteTouches(node, style);
    const previous = node.committed;
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
      node.committed = { handle, tag: previous.tag, props, childHandles, viewName };
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
  private reconcileChildren(
    node: EngineNode,
    viewName: string,
    style: StyleCache | null,
  ): FabricNode[] {
    const context = style?.context;
    if (HOIST_TARGETS.has(node.name)) return this.reconcileHoistTarget(node, context);
    const handles: FabricNode[] = [];
    for (const child of node.children) {
      if (child.kind === 'anchor' || this.committedElsewhere(child) || this.withheld(child)) {
        continue;
      }
      if (child.kind === 'text') {
        const handle = this.reconcileText(node, child, viewName, context);
        if (handle) handles.push(handle);
        continue;
      }
      handles.push(this.reconcileUnder(node, child, context));
    }
    return handles;
  }

  /**
   * The paragraph a run of text written straight into a view is drawn in, or nothing for a run of
   * whitespace, which a browser draws nothing for between the items of a flex box either.
   *
   * It is the text's own, kept on the text node, and no part of the tree: its parent is the view,
   * so it inherits what the view's text would, and no rule matches it.
   */
  /**
   * A run of text under `parent`, which commits as `viewName`: the text itself inside a text, a
   * paragraph of its own inside any other view, and nothing where the view takes its text as a
   * prop (see `ViewNameOptions`) or the run is whitespace between a view's children.
   */
  private reconcileText(
    parent: EngineNode,
    text: EngineNode,
    viewName: string,
    context?: object,
  ): FabricNode | null {
    if (TEXT_CONTENT_PROPS[viewName] !== undefined) return null;
    if (viewName === PARAGRAPH || viewName === VIRTUAL_TEXT) {
      // Under a text element, the paragraph it had in a view is done with. Under that paragraph
      // itself, which is where a loose run is committed, it is the one to keep.
      if (text.box && text.box !== parent) text.box = undefined;
      return this.reconcileUnder(parent, text, context);
    }
    const box = this.looseText(parent, text);
    return box ? this.reconcileUnder(parent, box, context) : null;
  }

  private looseText(parent: EngineNode, text: EngineNode): EngineNode | null {
    if (!trimEnds(text.text)) return null;
    let box = text.box;
    if (!box) {
      box = new RetainedNode('element', 'text', this);
      box.anonymous = true;
      box.children = [text];
      text.box = box;
    }
    box.parent = parent;
    // The text is not under the box in the tree, so a change to it never marked the box.
    if (!this.isClean(text)) box.subtreeDirty = true;
    return box;
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
    if (this.undisplayed(child)) return true;
    if (child.props['visible'] !== false || child.presented) return false;
    if (viewNameOf(child) !== MODAL_HOST) return false;
    if (child.committed) this.forgetCommitted(child);
    return true;
  }

  /**
   * Whether an element is `display: none`, which has no box and so no view, nor has anything
   * in it. A view that is committed and not displayed looks the same, but Yoga marks one as
   * laid out each time it measures what holds it, and React Native clears the mark only where it
   * reads that parent's layout: a debug build stops at the mark, on a later commit that has the
   * parent's layout already. Shown again it is made again, as an element put back in the tree
   * is: what its views held of their own, a scroll offset, is not kept.
   */
  private undisplayed(child: EngineNode): boolean {
    if (child.kind !== 'element') return false;
    this.styles.resolve(child, this.styleEpoch);
    if (ownLayout(child, 'display') !== 'none') return false;
    if (child.committed) {
      this.forgetCommitted(child);
      // A field in it has no view to send its blur from.
      if (isWithin(this.focusedNode, child)) this.setFocused(null);
    }
    return true;
  }

  /**
   * Whether a node hoisted into `target` is not displayed where it was written: it, or a box
   * between it and the child of `target` it was written in. That child is asked before this is.
   */
  private undisplayedUnder(target: EngineNode, written: EngineNode): boolean {
    for (let at: EngineNode | null = written; at && at.parent !== target; at = at.parent) {
      if (!this.undisplayed(at)) continue;
      if (written.committed) this.forgetCommitted(written);
      return true;
    }
    return false;
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
      for (const written of moved ?? []) {
        if (!this.undisplayedUnder(node, written)) handles.push(this.land(node, written, landed));
      }
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

  /**
   * A node whose native view is no longer the one it was created as is created again: a text
   * element that came to hold a view, or stopped. A clone keeps the view it was made as.
   */
  private forgetRenamed(node: EngineNode, viewName: string): void {
    if (node.committed && node.committed.viewName !== viewName) this.forgetCommitted(node);
  }

  /**
   * Let a node and everything under it be created again at the next commit. The views it keeps
   * for hoisted names go too: they are children of the native view it is losing.
   */
  private forgetCommitted(node: EngineNode): void {
    node.committed = null;
    node.committedUnder = null;
    node.styleCommitted = null;
    node.kept = undefined;
    if (node.box?.committed) this.forgetCommitted(node.box);
    for (const child of node.children) {
      if (child.committed || child.box?.committed) this.forgetCommitted(child);
    }
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
        kept.committed = { ...kept.committed, handle, props, childHandles: [] };
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
    node.committed = { handle, tag, props, childHandles, viewName };
    node.bornIn = this.stats.commits;
    this.clearFlags(node);
    return handle;
  }

  /**
   * Angular's own unknown-element check does not run in this pipeline, so a `<text>` in a
   * template that never imported `Text` compiles, draws without the component, and looks like a
   * layout bug. On the first commit of any known element with no component behind it, say so.
   */
  private checkClaimed(node: EngineNode): void {
    // The paragraph the engine wraps loose text in is its own: no template wrote it.
    if (node.kind !== 'element' || node.claimed || node.anonymous) return;
    if (!PRIMITIVE_NAMES.has(node.name)) return;
    if (this.reported.has(node.name)) return;
    this.reported.add(node.name);
    console.error(
      `[angular-native] <${node.name}> is used in a template that does not import ` +
        `${className(node.name)}. Add it to the component's \`imports\` from ` +
        `'@ng-native/components'; without it the element has none of the component's inputs ` +
        `or behavior, so a prop written on it stays the text it was written as.`,
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
  private reportUndefinedToken(name: string, props: readonly string[], on?: string): void {
    if (this.undefinedTokens.has(name)) return;
    this.undefinedTokens.add(name);
    // A bound declaration has no rule to be found by, so it says which element it is on.
    const where = on === undefined ? props.join(', ') : `${props.join(', ')}, bound on <${on}>,`;
    console.warn(
      `[angular-native] var(${name}) in ${where} names a custom property nothing in` +
        ` scope defines, so the declaration is dropped, as a browser drops it. Define ${name} on` +
        ` :root or an ancestor, or give the var() a fallback.`,
    );
  }

  private readonly unreadDisplays = new Set<string>();

  /**
   * Said once per token and value: the compiler refuses `display: grid` written out, but a token
   * is only known here, and without this the view lays out as flex with nothing said.
   */
  private reportUnreadDisplay(name: string, value: string | undefined): void {
    const report = `${name} ${value}`;
    if (this.unreadDisplays.has(report)) return;
    this.unreadDisplays.add(report);
    console.warn(
      `[angular-native] display: var(${name}) is ${value ?? 'no keyword'}, which is no display` +
        ` native has, so display is unset and the view lays out as flex. Native has flex, none` +
        ` and contents, and reads block, inline, inline-block, flow-root and inline-flex as flex.`,
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
    // What it is committed with can hang on whether it takes a touch: see `stillTouched`.
    this.markProps(node);
    return () => {
      this.responders.delete(node);
      this.keepNative(node, false);
      this.markProps(node);
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
   * A colour prop as native takes it. A shape's `fill` or `stroke` the cascade settled from a
   * token is the solid brush react-native-svg takes, and `none` no paint at all.
   */
  private painted(key: string, value: unknown): unknown {
    if (!BRUSH_PROPS.has(key)) return this.color(value);
    // Already a brush, as the icon wrote it: only one the cascade settled is still text.
    if (typeof value !== 'string') return value;
    return value === 'none' ? null : { type: 0, payload: this.color(value) };
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
    const asked = this.responders.get(node)?.blockNativeResponder ?? false;
    // And for a drag an element's `touch-action` keeps from the page: see `holdSwipe`.
    const block = asked || this.drag?.held === true;
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
    // What has the focus does not take it again: native answering a focus it was told of, where
    // whoever asked has already said so.
    if (topLevelType === 'topFocus' && target !== null && this.focusedNode === target) return;

    // Listeners get RN's documented shape, `{nativeEvent}`. Fabric hands us the payload bare;
    // React wraps it in a synthetic event and every RN API is written against `event.nativeEvent`,
    // so handlers ported from RN would silently read undefined otherwise.
    const event = new SyntheticEvent(nativeEvent, target);

    try {
      if (topLevelType === 'topDismiss' && target) this.dismissed(target);
      if (topLevelType === 'topScroll' && target && this.scrollTimelines.has(target)) {
        this.measuredScroll(target, nativeEvent);
      }
      this.holdSwipe(target, topLevelType, nativeEvent);
      this.trackFocus(target, topLevelType);
      if (target) this.cancelPressForScroll(target, topLevelType, event as ResponderEvent);
      if (target) this.runResponder(target, topLevelType, event as ResponderEvent);
    } catch (error) {
      this.reportEventError(error, topLevelType);
    }
    this.propagate(target, topLevelType, event);
  }

  /** The screen whose swipe back is held off while a finger is on what keeps a sideways drag. */
  private swipeHeld: EngineNode | null = null;

  /**
   * Hold a screen's swipe back off for a touch that starts on an element whose `touch-action`
   * keeps a drag to the side for itself, and give it back when the last finger lifts. From iOS
   * 26 the swipe starts anywhere on a screen once a finger has moved a little to the right, and
   * takes the touch from whatever was following it: a slider's thumb stops and the screen
   * leaves. The screen is told before the finger has moved that far.
   */
  private holdSwipe(target: EngineNode | null, type: string, nativeEvent: unknown): void {
    if (type === TOUCH_START) this.holdFrom(target, nativeEvent);
    else if (type === 'topTouchMove') this.settleDrag(nativeEvent);
    else if (type === 'topTouchEnd' || type === 'topTouchCancel') this.releaseSwipe(nativeEvent);
  }

  /**
   * A touch on an element that keeps a drag to the side: where it began, and whether native's
   * own gestures are held off for it. Held from the start where the element keeps a drag down
   * the page too (`none`); from the moment the finger sets off across where it leaves that one
   * to the page (`pan-y`), and never for that touch where it sets off down.
   */
  private drag: {
    x: number;
    y: number;
    settled: boolean;
    held: boolean;
    on: EngineNode;
  } | null = null;

  private holdFrom(target: EngineNode | null, nativeEvent: unknown): void {
    // A first finger down is a new touch: the last one's end never came where what it was on
    // went from under the finger.
    const fingers = (nativeEvent as { touches?: readonly unknown[] } | null)?.touches?.length;
    if (this.drag && fingers === 1) this.releaseSwipe(null);
    if (this.drag || !target) return;
    const actions = touchActions(target);
    if (!keeps(actions, PANS_ACROSS)) return;
    const all = keeps(actions, PANS_ALONG);
    this.drag = { ...pointOf(nativeEvent), settled: all, held: all, on: target };
    if (all) this.holdScroll(target);
    const screen = this.screenOf(target);
    if (!screen) return;
    this.swipeHeld = screen;
    this.tellScreen(screen);
  }

  /** The scroll view whose scrolling is off while a drag over it is an element's own. */
  private scrollHeld: EngineNode | null = null;

  /**
   * Stop the scroll view a node is in from scrolling, until the touch ends. Telling native who
   * holds the touch does this on Android. On iOS a scroll view is held off only by a responder
   * that is over it, never one inside it, so it is told not to scroll.
   */
  private holdScroll(node: EngineNode): void {
    for (let up = node.parent; up; up = up.parent) {
      if (up.kind !== 'element' || !SCROLL_VIEWS.has(viewNameOf(up))) continue;
      this.scrollHeld = up;
      this.tellScreen(up);
      return;
    }
  }

  /** Settle which way a drag set off, and hold native's own off one that set off across. */
  private settleDrag(nativeEvent: unknown): void {
    const drag = this.drag;
    if (!drag || drag.settled) return;
    const at = pointOf(nativeEvent);
    const [across, along] = [Math.abs(at.x - drag.x), Math.abs(at.y - drag.y)];
    if (Math.max(across, along) < DRAG_SLOP) return;
    drag.settled = true;
    drag.held = across > along;
    if (!drag.held) return;
    if (this.currentResponder) this.tellNative(this.currentResponder, true);
    this.holdScroll(drag.on);
  }

  /** Give the swipe back once the last finger has lifted. */
  private releaseSwipe(nativeEvent: unknown): void {
    const left = (nativeEvent as { touches?: readonly unknown[] } | null)?.touches?.length ?? 0;
    if (left > 0) return;
    this.drag = null;
    for (const held of [this.scrollHeld, this.swipeHeld]) {
      if (held === this.scrollHeld) this.scrollHeld = null;
      else this.swipeHeld = null;
      if (held) this.tellScreen(held);
    }
  }

  /**
   * Commit a screen or a scroll view again now, not with whatever next changes: the swipe begins
   * once the finger has moved ten points or so, which is a frame or two after it came down.
   */
  private tellScreen(screen: EngineNode): void {
    // Its props alone: nothing a selector reads moved, so nothing under it is styled again.
    this.markProps(screen, false);
    this.commit();
  }

  /** The screen of a native stack a node is on, or nothing where it is on none. */
  private screenOf(node: EngineNode): EngineNode | null {
    for (let up: EngineNode | null = node; up; up = up.parent) {
      if (up.kind === 'element' && viewNameOf(up) === STACK_SCREEN) return up;
    }
    return null;
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
