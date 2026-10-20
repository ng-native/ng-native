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
  boundRelativeLength,
  CSS_SPACE,
  isNegativeLineHeight,
  faded,
  fills,
  inlineInherited,
  setsInherited,
  handsDownPaint,
  StyleResolver,
  underOwnShorthands,
  usesActive,
  elementsAtEnd,
  hasAbove,
  couldAsk,
  hasBeside,
  forgetHasAnswers,
  keepHasAnswers,
  joinSubjects,
  placeReadElsewhere,
  siblingReach,
  type Compound,
  type HasAbove,
  type PlaceReader,
  type Conditions,
  type DeferredDeclaration,
  type StyleCache,
  type StyleSheet,
  type Subjects,
  type TokenValue,
  isGenerated,
  noteGeneratedBoxes,
} from './css.ts';
import { applyAria } from './aria-props.ts';
import { STYLED_ELEMENTS } from './element-styles.ts';
import {
  aimsElsewhere,
  animationEvent,
  bezier,
  interpolate,
  readsInheritedColour,
  sample,
  step,
  steppedKeys,
  tracksOf,
  type AnimationSpec,
  type EasedNatively,
  type Keyframe,
  type RunningAnimation,
  type TrackPoint,
  type Transition,
  type TransitionSpec,
} from './transition.ts';
import { isFormsInput } from './forms-inputs.ts';
import { transformList } from './inline-transform.ts';
import { tokenFromValue } from './inline-token.ts';
import {
  NativeScrollDriver,
  pinnedRange,
  scrollFeed,
  type ComposedDrive,
  type DrivenProperty,
  type EventFeed,
  type FollowingTransform,
  type NativeAnimated,
  type ScrollAxis,
  type ScrollDrive,
  type ScrollRange,
  type SetValues,
  type StaticTransform,
} from './native-drive.ts';
import type { DrivenChannels } from './scroll-animation.ts';

export type FabricNode = { readonly __fabricNode: unique symbol } | object;

/** Where a node is, in the window's coordinates. What `Engine.measure` reports. */
import type { HostEngine, HostNode, Settling } from './host.ts';
import {
  clockChannels,
  colourChannels,
  firstFrame,
  heldTransform,
  movesByShare,
  rangeOf,
  scrollChannels,
  sharesAsPoints,
} from './scroll-animation.ts';
import { layOutGrid, type GridItem, type GridLayout, type Rect } from './grid.ts';
import {
  isBlockContainer,
  placeInFlow,
  planFlow,
  type FlowKey,
  type FlowPlan,
  type FlowTree,
} from './flow.ts';
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
  for (const [key, field] of ANIMATION_ENTRIES) {
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
/** Listed once: `animationOf` reads them for every node that commits. */
const ANIMATION_ENTRIES = Object.entries(ANIMATION_PARTS);

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
  /** The properties among `tracks` declared `!important`, left where the rule puts them. */
  readonly pinned: readonly string[];
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
  cloneNodeWithNewChildren(node: FabricNode, children?: readonly FabricNode[]): FabricNode;
  /** Clone with the given props and the *same* children. */
  cloneNodeWithNewProps(node: FabricNode, newProps: object): FabricNode;
  /** Clone with the given children and the given props. */
  cloneNodeWithNewChildrenAndProps(
    node: FabricNode,
    children: readonly FabricNode[],
    newProps: object,
  ): FabricNode;
  appendChild(parent: FabricNode, child: FabricNode): FabricNode;
  /**
   * Have native move each view whose frame the next commit changes to where it ends up, over a
   * time and by one of its own curves, with no frame of it in JavaScript.
   */
  configureNextLayoutAnimation?(
    config: { duration: number; update: { type: string } },
    ended: () => void,
    failed: () => void,
  ): void;
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
  /**
   * A node's box as the last commit laid it out: x, y, width, height. Fabric lays a commit out
   * before `completeRoot` returns, so this answers for a commit made a line earlier, and what
   * was read can be committed again before anything is drawn. That is how a grid is laid out.
   * Optional because a test's fabric has no layout to read.
   */
  getBoundingClientRect?(
    node: FabricNode,
    includeTransform: boolean,
  ): readonly [number, number, number, number] | undefined;
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
  // `ReactTextInputManager` watches each of these only behind a prop of the handler's name,
  // which `TextInput.js` sets by passing the handler through. iOS's field sends them unasked.
  AndroidTextInput: {
    topContentSizeChange: 'onContentSizeChange',
    topScroll: 'onScroll',
    topKeyPress: 'onKeyPress',
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
  readonly nodeKind: NodeKind;
  /** Lowercase template spelling, e.g. `view`. Never the native view name. */
  readonly tag: string;
  /** `tag` again, for Angular 22.0, which reads it on a component's host element. */
  readonly tagName: string;
  /**
   * The element's name as a stylesheet's type selector reads it, where it is not `tag`: a
   * drawing's `text` is kept as `svg:text` and is still `text` to `.chart text`.
   */
  typeName?: string;
  /**
   * The namespace a renderer created the element in where an extension names elements in one,
   * as Angular creates what is written inside an `<svg>`: a library's drawing, whose shapes are
   * painted and given their font as a browser does. An icon's shapes are created by name alone
   * and have none, and commit as they always have.
   */
  namespace?: string;
  props: Record<string, unknown>;
  nodeText: string;
  childList: EngineNode[];
  parent: EngineNode | null;
  listeners: Map<string, Set<(event: unknown) => void>> | null;

  /** CSS classes on this node, for selector matching. */
  classes: Set<string> | null;
  /** The compiled stylesheet of the component that created this node, if any. */
  templateSheet: StyleSheet | null;
  /** The sheet of the component this node hosts, if it hosts one. What `:host` matches against. */
  hostSheet: StyleSheet | null;
  /** Custom properties set on the node itself; see `StyleTarget.customProperties`. */
  customProperties: Record<string, TokenValue> | null;
  /** Resolved style, memoised across commits. Owned by the CSS resolver. */
  styleCache: StyleCache | null;
  /** Set when something that could change what this node matches has changed. */
  styleDirty: boolean;
  /** See `StyleTarget.ownDirty`. */
  ownDirty: boolean;
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
   * template and in no node's `childList`: it holds the text, and commits where the text would.
   */
  box?: EngineNode;
  /**
   * The paragraphs of a run of text beside a box in a line, one a word: see `wordBoxes`. In no
   * node's `childList` either, and kept on the text as its one paragraph is.
   */
  words?: EngineNode[];
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
   * Whether a browser lays this element out inline, with no display of its own: `always`, as a
   * span is, which is what the box that holds it reads; or `unless-block`, as a custom element
   * is, which the engine lays out as an inline-block or as a block by what it holds. Set with
   * `setInline`. Unset on every other node.
   */
  inlineLevel?: 'always' | 'unless-block';
  /** Set by `scrollsOverflow`: with `overflow: auto` or `scroll` this element is a scroll view. */
  scrollsOverflow?: true;
  /** Set while this element is one: see `Engine.settleScrolling`. */
  scrollView?: true;
  /** The view a scrolling element's children are in, as it was last committed. */
  inside?: { handle: FabricNode; childHandles: FabricNode[] };
  /** Set while `settleLine` has given an always-inline element a line for the boxes it holds. */
  lined?: true;
  /** Set while an always-inline element is a flex box or a grid by its own style. */
  boxed?: true;
  /**
   * How this node lays its children out as a block container, and which of them are in its flow:
   * made on each reconcile from its children's styles, so a child added, removed or restyled is
   * followed. Unset on every node that is not a block container. See `flow.ts`.
   */
  flow?: Flow;
  /**
   * What an out-of-flow box is committed with in place of what Yoga cannot resolve: its `auto`
   * margins as lengths, or the place it would have had in the flow. A null takes the prop away.
   * See `settleAbsolute`.
   */
  resolved?: Readonly<Record<string, number | null>>;
  /** Where a `position: sticky` box sticks, and how far it is moved now. See `settleSticky`. */
  sticky?: StickyState;
  /**
   * The node a `position: fixed` box is committed under in place of its parent: the page it is
   * on, or the root. Unset on every node that is not fixed.
   */
  fixedTo?: EngineNode;
  /**
   * Set once a child of this node has had an `order`: its children are then committed in that
   * order, which Yoga has no property for. Left set, since sorting children with none is nothing.
   */
  ordered?: boolean;
  /**
   * A box in a line of a block, which is as wide as its content: the width that came to, read
   * back with the percentages inside it set aside, and whether it has to be read again. See
   * `settleFits`.
   */
  fit?: { dirty: boolean; width?: number; room?: number; grown?: EngineNode[] };
  /**
   * The least width a box is held to because a fitted box in it overflows its room: a browser's
   * flex item is no narrower than its content, which Yoga's is. See `growAround`.
   */
  fitMin?: number;
  /** Set on a box inside one being fitted, while its percentage width and zero basis are off. */
  fitOff?: boolean;
  /**
   * The declarations of this node that are a percentage with a length added, `calc(100% - 2rem)`,
   * what each came to against the box the percentage is of, and that box's size then. See
   * `settleMixed`. Set on `mixedOff` while that box is measured with them set aside.
   */
  mixed?: MixedState;
  mixedOff?: boolean;
  /** The line box this node is the first box of, as it was last committed. See `inLines`. */
  line?: LineBox;
  /**
   * Set on an item in a row whose automatic minimum width is read from what it holds: whether
   * text in it has somewhere to wrap. Anything changing under it has it asked again.
   */
  autoMin?: boolean;
  /**
   * The narrowest an item that takes a share of its row goes, read from a commit of it at its
   * content's width with its words a line each, or nothing until it is read: see
   * `settleMinimums`. Set while `shareMin` says the item's minimum is to be measured.
   */
  shareMin?: { width?: number; share?: number };
  /** Set while that commit is made: the item is as wide as its content, with no share. */
  shareOff?: boolean;
  /** Whether this node's children were last laid out along a row. See `autoMinimum`. */
  row?: boolean;
  /** How this node lays its children out as a grid. Unset on every node that is not one. */
  grid?: GridState;
  /** The grid this node was last an item of. Its `grid` says whether it still is. */
  gridIn?: EngineNode;
  /** The block container whose flow this node was last in. Its `flow` says whether it still is. */
  flowIn?: EngineNode;
  /**
   * Whether this node had a height a percentage could be taken of, when a box beneath it with a
   * percentage height last asked, as `definiteHeight` says it. Compared on each reconcile so its
   * children are worked out again when it changes. Unset on every other node.
   */
  heightBasis?: boolean;
  /**
   * The height a box as tall as its content is committed at, so that a percentage height in it
   * is of that height, and the width it had then. See `settleHeld`.
   */
  heldAt?: { height: number; width: number; inner: number };
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
   * The props a native animated graph has set on the view with this tag, which no commit
   * changes again: see `Touched`. A view made again has another tag, and starts with none.
   */
  owned?: { readonly tag: number; readonly keys: Set<string> };
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
  /**
   * Set by whoever needs to know which props have been written: each `setProp` with a value adds
   * its key, even one equal to the value already there, and one with `undefined` or `null` takes
   * it out. The native stack outlet tells a page's own binding from a value it carried this way.
   */
  writes?: Set<string>;
  /** The child this node's background is painted on instead of itself. See `paintOn`. */
  paintsOn?: EngineNode;
  /** What this node's background colour is handed to instead of painted. See `takePaint`. */
  paintTaker?: (color: unknown) => void;
  /** The background colour `paintTaker` was last handed, or is about to be. */
  paintTaken?: unknown;
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
  committedUnder: EngineNode | LineBox | null;
  /** The hoisted views this node keeps committed for, by element name. See `HoistOptions`. */
  kept?: Map<string, KeptHoist>;
  /** On a text field, the row aligned by baseline that takes a baseline from it: `lineBaseline`. */
  onBaseline?: EngineNode;
  /** On such a row, the fields it has marked, which it unmarks when they are no longer its own. */
  baselineFields?: Set<EngineNode>;
  /** Commit this node again with its children so Fabric measures it again. `remeasureText`. */
  remeasure?: true;
  /** On a paragraph, whether its text was one word when it was last merged: `wholeWords`. */
  oneWord?: boolean;
  /** The z-index this view is drawn at for a box in it, where it has none: `Engine.raise`. */
  raised?: number;
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
 * Say that an element scrolls what overflows it, as a browser's does: with `overflow: auto` or
 * `scroll` it is committed as a scroll view, around one view that holds what it holds. For a
 * package that gives elements a browser's behaviour. Any other element keeps the view it is,
 * and its `overflow` is layout alone.
 */
export function scrollsOverflow(node: EngineNode): void {
  node.scrollsOverflow = true;
}

/** What a scrolling element lays out what it holds by, which its content view takes. */
const CONTENT_KEYS = new Set([
  ...['padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  ...['paddingHorizontal', 'paddingVertical', 'paddingStart', 'paddingEnd'],
  ...['paddingInline', 'paddingBlock', 'paddingInlineStart', 'paddingInlineEnd'],
  ...['paddingBlockStart', 'paddingBlockEnd'],
  ...['flexDirection', 'flexWrap', 'alignItems', 'alignContent', 'justifyContent'],
  ...['gap', 'rowGap', 'columnGap'],
]);

/** A scrolling element's props split between its two views: see `scrollerProps`. */
function splitScroller(props: Record<string, unknown>): {
  box: Record<string, unknown>;
  content: Record<string, unknown>;
} {
  const box: Record<string, unknown> = {};
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    (CONTENT_KEYS.has(key) ? content : box)[key] = value;
  }
  // A scroll view clips only as `scroll`: native reads `auto`, which an inline style can say, as
  // visible.
  if (box['overflow'] === 'auto') box['overflow'] = 'scroll';
  return { box, content };
}

/**
 * A scrolling element's props as its two views take them: the box it is, on the scroll view,
 * and how it lays out what it holds, on the content. The content is a view of its own whatever
 * is in it: a scroll view scrolls one child.
 */
function scrollerProps(props: Record<string, unknown>): {
  box: Record<string, unknown>;
  content: Record<string, unknown>;
} {
  const { box, content } = splitScroller(props);
  // Nested: on Android a scroll view inside another is passed over for the outer one unless it
  // asks, and a web element that scrolls is as often as not inside a page that does.
  return {
    box: { nestedScrollEnabled: true, ...box },
    content: { collapsable: false, ...content },
  };
}

/** The props of a payload, or null where there are none. */
const someProps = (props: Record<string, unknown>): Record<string, unknown> | null =>
  Object.keys(props).length ? props : null;

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
  // Its `baseHorizontal`, for the view a horizontal scroll view is on Android.
  AndroidHorizontalScrollView: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    overflow: 'scroll',
  },
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

/**
 * What an element that scrolls its overflow has of a scroll view's defaults: it clips, and lays
 * out in a column. Not the grow and shrink of `ScrollView.js`, which a CSS box has none of: an
 * element with `overflow: auto` and a height is as tall as it says, not as the room it is in.
 */
const OVERFLOW_SCROLLER = { flexDirection: 'column', overflow: 'scroll' };

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

/** Whether text written into a view of this name is drawn in a paragraph the engine makes. */
const holdsParagraphs = (viewName: string): boolean =>
  viewName !== PARAGRAPH && viewName !== VIRTUAL_TEXT && TEXT_CONTENT_PROPS[viewName] === undefined;

/**
 * The box Yoga takes a view's baseline from where the view has none of its own: its first child
 * that is laid out in its flow. Words written straight into the view are the paragraph the
 * engine makes around them, and a child that is not displayed has no view to ask.
 */
/**
 * A view with a transition is a native view for as long as it has one, as an `Animated.View` is.
 *
 * React Native gives a view a native view of its own for an opacity under 1, a transform or a
 * background, and takes it away when the last such reason goes. A wrapper that fades in was one
 * for the length of the fade and none after, and Fabric moved everything inside it to the view
 * above as the fade ended. Being moved takes a focused field out of the window for a moment, and
 * it lost its focus: a field focused as its container faded in blurred when the fade finished.
 *
 * A floor, as `keepNative` is: a `collapsable` written on the element is left alone. Not for
 * `transition: none`, which transitions nothing.
 */
function keepForTransition(
  node: EngineNode,
  props: Record<string, unknown>,
  spec: Readonly<Record<string, unknown>>,
): void {
  if (viewNameOf(node) !== DEFAULT_VIEW || props['collapsable'] !== undefined) return;
  if (Object.keys(spec).length > 0) props['collapsable'] = false;
}

function firstInFlow(node: EngineNode): EngineNode | undefined {
  for (const child of node.childList ?? []) {
    // Not the paragraph itself, which holds the words it was made around.
    if (child.nodeKind === 'text' && child.box) return child.box === node ? undefined : child.box;
    if (child.nodeKind !== 'element' || readStyle(child, 'display') === 'none') continue;
    if (!OUT_OF_FLOW.has(readStyle(child, 'position') as string)) return child;
  }
  return undefined;
}

/** A box and every box in it that is a grid, the outermost first. */
function gridsIn(box: EngineNode): EngineNode[] {
  const inside = box.childList.flatMap((child) =>
    child.nodeKind === 'element' ? gridsIn(child) : [],
  );
  return box.grid ? [box, ...inside] : inside;
}

const isNode = (node: EngineNode | undefined): node is EngineNode => node !== undefined;

/**
 * Whether a text field is one a row aligned by baseline takes its baseline from, and is still
 * under that row: a row taken away is not committed again to unmark it.
 */
function isOnBaseline(node: EngineNode, viewName: string): boolean {
  const row = node.onBaseline;
  return viewName === 'TextInput' && row !== undefined && isWithin(node, row);
}

/** Whether a row lays a child out among its others, and so can take its baseline from it. */
const inFlow = (child: EngineNode): boolean =>
  child.nodeKind === 'element' && ownLayout(child, 'position') !== 'absolute';

/** The text field a row's box takes its baseline from: itself, or the first in its flow down. */
function fieldOnBaseline(item: EngineNode): EngineNode | undefined {
  let at: EngineNode | undefined = item;
  while (at?.nodeKind === 'element' && !TEXT_INPUTS.has(viewNameOf(at))) at = firstInFlow(at);
  return at?.nodeKind === 'element' ? at : undefined;
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
 * is as tall as its text, which is one line before anything is typed. Taken off the props once
 * read: neither platform's native field has a prop of that name.
 */
function rowsTall(
  viewName: string,
  props: Record<string, unknown>,
  fontScale: number | undefined,
): void {
  if (!TEXT_INPUTS.has(viewName)) return;
  const rows = Number(props['rows']);
  delete props['rows'];
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

/** A field's padding and border on its left or right edge, as they are written. */
const inlineEdge = (
  props: Record<string, unknown>,
  side: 'Left' | 'Right',
  logical: 'Start' | 'End',
): unknown[] => [
  props[`padding${side}`] ??
    props[`padding${logical}`] ??
    props[`paddingInline${logical}`] ??
    props['paddingInline'] ??
    props['paddingHorizontal'] ??
    props['padding'] ??
    0,
  props[`border${side}Width`] ?? props[`border${logical}Width`] ?? props['borderWidth'] ?? 0,
];

/** The size a browser draws a field's text at where no stylesheet gives it one. */
const FIELD_FONT_SIZE = 13.3333;
/**
 * How wide a browser counts a character of a field as, against the font's size: what Chrome
 * makes of `size="20"`, 175 points of a 16 point font and 146 of a browser's own.
 */
const CHARACTER = 0.546;
/** And a column of a text area, which is counted wider: 183 points for twenty at 16. */
const COLUMN = 0.572;

/**
 * A field's `size` as its width, where it was given none: that many characters of its font,
 * inside its padding and border, as a browser sizes an `<input>`. A native field has no width
 * of its own.
 */
function columnsWide(props: Record<string, unknown>, size: unknown): void {
  const columns = Number(size);
  if (!(columns > 0) || (isSet(props['width']) && props['width'] !== 'auto')) return;
  const font = typeof props['fontSize'] === 'number' ? props['fontSize'] : FIELD_FONT_SIZE;
  // A content box's width is its characters alone: Yoga adds the padding and border itself.
  const edges =
    props['boxSizing'] === 'content-box'
      ? []
      : [...inlineEdge(props, 'Left', 'Start'), ...inlineEdge(props, 'Right', 'End')];
  if (!edges.every((part) => typeof part === 'number')) return;
  const characters = columns * (props['multiline'] === true ? COLUMN : CHARACTER) * font;
  props['width'] = edges.reduce<number>((sum, part) => sum + (part as number), characters);
}

/**
 * A text field's `size` as its width, and off what is sent: it is the field's own, and no prop
 * of the native one. Another view's `size` is that view's, and is left.
 */
function sizedField(viewName: string, props: Record<string, unknown>): void {
  if (!TEXT_INPUTS.has(viewName)) return;
  columnsWide(props, props[FIELD_SIZE]);
  delete props[FIELD_SIZE];
}

/** What a text field alone is styled with, asked of none of the views that are not one. */
function fieldStyled(
  viewName: string,
  props: Record<string, unknown>,
  fontScale: number | undefined,
): void {
  alignMultiline(viewName, props);
  rowsTall(viewName, props, fontScale);
  sizedField(viewName, props);
}

/** A field's own minimum height: none where it says `auto`, which a web element starts with. */
const ownMinimum = (minHeight: unknown): unknown => (minHeight === 'auto' ? 0 : (minHeight ?? 0));

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
 * ponytail: the font is taken to be as tall as the system's, `FONT_ASCENT` and `FONT_DESCENT` of
 * its size. Read from the font if a field in another face is seen a point off its prefix.
 */
function lineBaseline(
  props: Record<string, unknown>,
  line: number,
  [, top, , bottom]: readonly number[],
  fontScale: number | undefined,
): number {
  const size = props['fontSize'];
  if (typeof size !== 'number') return 0;
  const font = size * textScale(props, fontScale) * (FONT_ASCENT + FONT_DESCENT);
  const half = Math.max(0, (line - font) / 2);
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
 * alone, so on Android such a field is left as it was. Elsewhere Android sizes the field by the
 * line height and centres the text in it itself, and keeps it.
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
  // Android sizes the field by its line height, and centres the text in it, itself. A
  // percentage is a fixed height only where the parent's is definite, known at layout alone:
  // there too the line height is left out on iOS, and kept as the least the field is tall.
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
 * What a node's `@keyframes` animation sets this frame, less each property a rule it matches
 * declared `!important`: an important author declaration is above the animation in the cascade.
 * A transition is above both, so `transitioned` takes no such care.
 */
function playedOver(node: EngineNode): Readonly<Record<string, unknown>> {
  const values = node.playing?.values;
  const important = node.styleCache?.important;
  if (!values || !important) return values ?? NO_STYLE;
  const played = { ...values };
  for (const key of important) delete played[key];
  return played;
}

/**
 * The properties among an animation's tracks that a rule `node` matches declared `!important`,
 * which native is not handed: what native plays it sets on the view, over what the rule says.
 */
function pinnedIn(node: EngineNode, tracks: ReadonlyMap<string, unknown>): string[] {
  const important = node.styleCache?.important;
  return important ? [...tracks.keys()].filter((key) => important.has(key)) : [];
}

/** Whether native is playing an animation whose important properties are no longer the ones left out. */
function pinsChanged(node: EngineNode, running: RunningAnimation): boolean {
  if (!running.native) return false;
  return pinnedIn(node, running.tracks).join(' ') !== running.pinned?.join(' ');
}

/** `tracks` less the properties named. */
function unpinned<T>(
  tracks: ReadonlyMap<string, T>,
  pinned: readonly string[],
): ReadonlyMap<string, T> {
  if (!pinned.length) return tracks;
  const kept = new Map(tracks);
  for (const key of pinned) kept.delete(key);
  return kept;
}

/**
 * What a container's own style says for `key`, in the order `mergeProps` applies them: a
 * component's override, inline, a prop, its stylesheet, its default.
 */
function ownLayout(node: EngineNode, key: string): unknown {
  // With no rule marked `!important` on the node, its inline style stands whole, and `readStyle`
  // answers the same without flattening a style into a new object: this is asked of every child
  // a commit reconciles.
  if (node.styleCache?.important === undefined) return readStyle(node, key);
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
 * `display: contents` node is no container: its children are laid out in the one above it. With
 * no direction of its own, the axis is its view's default, as Android's horizontal scroll view
 * commits a row.
 */
function containerOf(node: EngineNode): string {
  if (ownLayout(node, 'display') === 'contents') return 'contents';
  const direction = String(
    ownLayout(node, 'flexDirection') ??
      DEFAULT_PROPS[viewNameOf(node)]?.['flexDirection'] ??
      'column',
  );
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
/** A percentage, or a `calc()` of one and a length: a share of the box it is of either way. */
const isShareOrSum = (value: unknown): boolean =>
  isPercent(value) || mixedParts(value) !== undefined;

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
  // A grid places its items, and reads no basis: see `gridItem`.
  if (gridOver(node)) return;
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
  if (!node.parent || node.nodeKind !== 'element' || viewNameOf(node) !== 'View') return true;
  const parent = layoutParent(node);
  if (!parent) return true;
  const height = ownLayout(node, 'height');
  if (isPercent(height)) return definiteHeight(parent);
  return sizesItself(node, height) || node.heldAt !== undefined || heightFromLayout(node, parent);
}

/**
 * Whether a box with no height of its own has one once flex layout has sized it (CSS Flexbox
 * 9.8): an item of a column whose height is definite, or one a row with a definite height
 * stretches. A box in a block's flow or a grid, or out of the flow, has none.
 */
function sizedByFlex(node: EngineNode): boolean {
  if (node.nodeKind !== 'element' || viewNameOf(node) !== 'View') return false;
  const position = ownLayout(node, 'position');
  if (position === 'absolute' || position === 'fixed') return false;
  const parent = layoutParent(node);
  if (!parent || parent.flow !== undefined || parent.grid !== undefined) return false;
  const [direction, align] = containerOf(parent).split(' ');
  const self = ownLayout(node, 'alignSelf') as string | undefined;
  if (direction === 'row' && !(STRETCHES.has(self) && align === 'stretch')) return false;
  return definiteHeight(parent) || sizedByFlex(parent);
}

/**
 * Whether a box holds one in the flow whose height is a percentage of it: a height, a least
 * height, or a basis down a column.
 */
function holdsShares(node: EngineNode): boolean {
  const column = !isRow(node);
  return node.childList.some(
    (child) =>
      child.nodeKind === 'element' &&
      ownLayout(child, 'position') !== 'absolute' &&
      (isShareOrSum(ownLayout(child, 'height')) ||
        isShareOrSum(ownLayout(child, 'minHeight')) ||
        (column && isShareOrSum(ownLayout(child, 'flexBasis')))),
  );
}

const NO_HEIGHT = new Set([undefined, null, 'auto', 'fit-content']);

/** Whether a box has a height from its own style: written, or placed, or kept in proportion. */
function sizesItself(node: EngineNode, height: unknown): boolean {
  if (!NO_HEIGHT.has(height as string)) return true;
  return ownLayout(node, 'position') === 'absolute' || ownLayout(node, 'aspectRatio') != null;
}

/**
 * Whether the container a box is in gives it a height: a row's, or a share of a column's, or a
 * grid's area that stretches it, which a browser takes a percentage of once the rows are sized.
 */
function heightFromLayout(node: EngineNode, parent: EngineNode): boolean {
  if (parent.grid !== undefined) {
    const margins = ['marginTop', 'marginBottom', 'marginVertical', 'margin'];
    return stretched(node, parent) && margins.every((key) => ownLayout(node, key) !== 'auto');
  }
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

const NO_INSETS = { Top: 0, Right: 0, Bottom: 0, Left: 0 };
const MARGIN_KEYS = [
  ...['margin', 'marginHorizontal', 'marginVertical'],
  ...['marginLeft', 'marginRight', 'marginTop', 'marginBottom'],
];

/** The two axes an out-of-flow box is resolved on, as the props and the box indexes of each. */
const ABSOLUTE_AXES = [
  { start: 'Left', end: 'Right', across: 'Horizontal', at: 0, size: 2 },
  { start: 'Top', end: 'Bottom', across: 'Vertical', at: 1, size: 3 },
] as const;

/**
 * What a removed prop travels as: null, which native resets the prop on, except `pointerEvents`,
 * which react-native-svg's Android root reads as a string and stops the app on a null. `auto` is
 * what no value means.
 */
const cleared = (key: string): unknown => (key === 'pointerEvents' ? 'auto' : null);

/** A length of a box, or a percentage of `whole`, or nothing where it is `auto` or unset. */
function resolveLength(value: unknown, whole: number): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !value.endsWith('%')) return undefined;
  return (Number.parseFloat(value) / 100) * whole;
}

/**
 * The `auto` margins of an out-of-flow box on one axis, as lengths (CSS 2.2, 10.3.7 and 10.6.4):
 * between two insets they take the room left over, shared when both are auto, and without both
 * insets they are nothing. `room` is the container's padding box on the axis and `size` the
 * box's own.
 */
const INSETS: ReadonlySet<string> = new Set(['top', 'right', 'bottom', 'left']);

/**
 * What a percentage is a share of a width for, and of a height: a size, its limits, an inset. A
 * margin is a share of the width on either axis (CSS 2.2, 8.3), where Yoga takes a margin down
 * an out-of-flow box of the height.
 */
const SHARED_SIZES = [
  ...(['width', 'minWidth', 'maxWidth', 'left', 'right'] as const).map((key) => [key, 2] as const),
  ...(['margin', 'marginVertical', 'marginTop', 'marginBottom'] as const).map(
    (key) => [key, 2] as const,
  ),
  ...(['height', 'minHeight', 'maxHeight', 'top', 'bottom'] as const).map(
    (key) => [key, 3] as const,
  ),
];

/** A box's layout styles with the sizes and insets set on the element itself over them. */
function withOwnSizes(node: EngineNode, style: Record<string, unknown>): Record<string, unknown> {
  const own: Record<string, unknown> = {};
  for (const [key] of SHARED_SIZES) if (node.props[key] != null) own[key] = node.props[key];
  return { ...style, ...own };
}

/**
 * Stretch the lines of a wrapping flex container that says nothing of `align-content`, as CSS
 * starts them (`normal`, which is `stretch` in a flex container). Yoga starts them at
 * `flex-start`, as tall as what is in them, where an item that stretches across its line has
 * no size. A container that does not wrap has one line, which Yoga stretches already.
 */
function wrappedLinesStretch(props: Record<string, unknown>): void {
  const wraps = props['flexWrap'] === 'wrap' || props['flexWrap'] === 'wrap-reverse';
  if (wraps && props['alignContent'] == null) props['alignContent'] = 'stretch';
}

/**
 * A flex item that stretches across its line, with its size across the line `auto`, as CSS has
 * it: as wide as a column, or as tall as a row, where Yoga takes the ratio over the stretch. In a
 * column, a height given leaves the ratio nothing to work out. In a row, the line is as tall as
 * the ratio makes the item from its width, at least, which is then the item's least height.
 *
 * ponytail: a width in points that does not grow, in a row, with any least or most height in
 * points. One that grows, or is a share, keeps the ratio, as Yoga has it. A plain view only: an image keeps its picture's proportions.
 */
function stretchedOverRatio(node: EngineNode, props: Record<string, unknown>): void {
  if (!isSet(props['aspectRatio']) || OUT_OF_FLOW.has(props['position'] as string)) return;
  if (viewNameOf(node) !== DEFAULT_VIEW) return;
  const parent = layoutParent(node);
  if (!parent || parent.flow !== undefined || parent.grid !== undefined) return;
  const container = containerOf(parent);
  // Remembered on the container, so the item is merged again when its direction changes.
  parent.fitContainer = container;
  const [direction, align] = container.split(' ');
  if (align !== 'stretch' || !stretchesAcross(props, direction === 'row')) return;
  if (direction === 'row') ratioAsLeast(props);
  else if (isSet(props['height']) && props['height'] !== 'auto') delete props['aspectRatio'];
}

/** Whether an item stretches across its line: its own size and margins across it are `auto`. */
function stretchesAcross(props: Record<string, unknown>, row: boolean): boolean {
  if (!STRETCHES.has(props['alignSelf'] as string)) return false;
  const size = row ? 'height' : 'width';
  if (isSet(props[size]) && props[size] !== 'auto') return false;
  const sides = row
    ? MARGINS_ACROSS_ROW
    : props['direction'] === 'rtl'
      ? MARGINS_ACROSS_COLUMN_RTL
      : MARGINS_ACROSS_COLUMN;
  return sides.every((keys) => keys.map((key) => props[key]).find(isSet) !== 'auto');
}

/** The margins across a line, a side each, as Yoga reads them: the first set wins. */
const MARGINS_ACROSS_ROW = [
  ['marginTop', 'marginVertical', 'margin'],
  ['marginBottom', 'marginVertical', 'margin'],
];
const MARGINS_ACROSS_COLUMN = [
  ['marginStart', 'marginLeft', 'marginHorizontal', 'margin'],
  ['marginEnd', 'marginRight', 'marginHorizontal', 'margin'],
];
/** Right to left, where the start is the right side. */
const MARGINS_ACROSS_COLUMN_RTL = [
  ['marginEnd', 'marginLeft', 'marginHorizontal', 'margin'],
  ['marginStart', 'marginRight', 'marginHorizontal', 'margin'],
];

/** In a row, the height a ratio gives a width in points, as the item's least height. */
function ratioAsLeast(props: Record<string, unknown>): void {
  const [width, ratio] = [props['width'], props['aspectRatio']];
  if (typeof width !== 'number' || typeof ratio !== 'number' || ratio <= 0) return;
  const [least, most] = [props['minHeight'], props['maxHeight']];
  const inPoints = (bound: unknown) => !isSet(bound) || typeof bound === 'number';
  if (props['boxSizing'] === 'content-box' || !inPoints(least) || !inPoints(most)) return;
  if (sizedAlong(props)) return;
  props['minHeight'] = heldTo(width / ratio, least, most);
  delete props['aspectRatio'];
}

/** Whether an item's width is not what it is along its line: it has a basis, or it grows. */
function sizedAlong(props: Record<string, unknown>): boolean {
  const basis = props['flexBasis'];
  return (isSet(basis) && basis !== 'auto') || Number(props['flexGrow'] ?? props['flex'] ?? 0) > 0;
}

/** A height held to the least and most given, which CSS keeps: the least wins over the most. */
function heldTo(height: number, least: unknown, most: unknown): number {
  const under = typeof most === 'number' ? Math.min(height, most) : height;
  return typeof least === 'number' ? Math.max(under, least) : under;
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

/** Whether a side of a border has a width and nothing that gives it a colour. */
function colourless(
  props: Record<string, unknown>,
  side: (typeof BORDER_SIDES)[number],
  flipped: boolean,
): boolean {
  const width = props[side.width] ?? props['borderWidth'];
  if (typeof width !== 'number' || width <= 0) return false;
  const given = [side.color, flipped ? side.flipped : side.logical, 'borderColor'];
  return given.every((key) => props[key] == null);
}

/**
 * Each side a border has: its width, its colour, and the logical colour React Native takes for
 * it too, read left to right and, `flipped`, right to left.
 */
const BORDER_DRAWN = /^border\w*(Width|Style)$/;
const BORDER_COLOUR = /^border\w*Color$/;

/**
 * Send a border's colours again with an update that gives it a width or a style: Android draws
 * the border black when that update does not carry its colour, though it was given one before.
 * A box made without a border and given one later, a file attachment that is done, has one.
 */
function borderColoursAgain(payload: Record<string, unknown>, props: Record<string, unknown>) {
  if (!Object.keys(payload).some((key) => BORDER_DRAWN.test(key))) return;
  for (const key in props)
    if (BORDER_COLOUR.test(key) && !(key in payload)) payload[key] = props[key];
}

const BORDER_SIDES = [
  ['Top', 'BlockStart', 'BlockStart'],
  ['Right', 'End', 'Start'],
  ['Bottom', 'BlockEnd', 'BlockEnd'],
  ['Left', 'Start', 'End'],
].map(([side, logical, flipped]) => ({
  width: `border${side}Width`,
  color: `border${side}Color`,
  logical: `border${logical}Color`,
  flipped: `border${flipped}Color`,
}));

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
 * A percentage size or inset of an out-of-flow box, as the length it is: a share of the
 * padding box of the box it is placed against (CSS 2.2, 10.2 and 10.5). Yoga takes it of what
 * is inside its parent's padding, which is a different box under a parent with padding and
 * another one altogether under a parent that is not positioned.
 *
 * ponytail: only for a box the engine places itself, in a block or under a parent that is not
 * positioned. One in a flex container with padding keeps Yoga's share; note it in `reabsolute`
 * if a stylesheet depends on the difference.
 */
function shareOfBlock(
  style: Record<string, unknown>,
  against: readonly number[],
  insets: boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, at] of SHARED_SIZES) {
    if (!insets && INSETS.has(key)) continue;
    const share = style[key];
    if (isPercent(share)) out[key] = (against[at]! * Number.parseFloat(String(share))) / 100;
  }
  return out;
}

function autoMargins(
  style: Record<string, unknown>,
  axis: (typeof ABSOLUTE_AXES)[number],
  room: number,
  size: number,
  width: number,
): Record<string, number | null> | null {
  const margin = (side: string) =>
    firstOf(style, [`margin${side}`, `margin${axis.across}`, 'margin']);
  // A share of a margin is of the width on either axis (CSS 2.2, 8.3), an inset's of the room.
  const points = (value: unknown) => resolveLength(value, width) ?? 0;
  const [before, after] = [margin(axis.start), margin(axis.end)];
  if (before !== 'auto' && after !== 'auto') return null;
  const start = resolveLength(style[axis.start.toLowerCase()], room);
  const end = resolveLength(style[axis.end.toLowerCase()], room);
  // Without both insets an auto margin is nothing, and a length written beside it stays.
  const written = { [`margin${axis.start}`]: points(before), [`margin${axis.end}`]: points(after) };
  if (start === undefined || end === undefined) return written;
  const left = room - start - end - points(before) - points(after);
  // An auto size between two insets is what they leave, clamped (CSS 2.2, 10.3.7 and 10.6.4):
  // unclamped, it stretches between both with no room for the margins to share.
  const own = clampedBetween(style, axis, left, room, width);
  if (own?.border === left) return written;
  const free = left - (own?.border ?? size);
  // Two auto margins centre the box, unless it overflows: then the start edge holds.
  const lead = before !== 'auto' ? points(before) : after === 'auto' ? Math.max(free / 2, 0) : free;
  return {
    ...written,
    [`margin${axis.start}`]: lead,
    // The start inset and the margin place it now, at its size, and both would stretch it.
    [axis.end.toLowerCase()]: null,
    ...(own ? { [AXIS_SIZES[axis.at]]: own.size } : null),
  };
}

const AXIS_SIZES = ['width', 'height'] as const;

/** Whether a box has a size on the axis: its own, or one an aspect ratio takes from the other. */
function hasSize(style: Record<string, unknown>, axis: (typeof ABSOLUTE_AXES)[number]): boolean {
  const set = (key: string) => style[key] != null && style[key] !== 'auto';
  return set(AXIS_SIZES[axis.at]) || (set('aspectRatio') && set(AXIS_SIZES[1 - axis.at]!));
}

/**
 * The size of an out-of-flow box with an auto size on the axis, between two insets, and none
 * for one with a size there: `left`, the room they and its margins leave, clamped by its min and
 * max sizes (shares of `room`) and no smaller than its padding and border. `border` is its border
 * box, `size` the size Yoga is given, which is without its padding and border for a content-box
 * one.
 */
function clampedBetween(
  style: Record<string, unknown>,
  axis: (typeof ABSOLUTE_AXES)[number],
  left: number,
  room: number,
  width: number,
): { border: number; size: number } | undefined {
  if (hasSize(style, axis)) return undefined;
  const key = AXIS_SIZES[axis.at];
  const caps = `${key[0]!.toUpperCase()}${key.slice(1)}`;
  const edges = insets(style, width);
  const frame = edges[axis.start] + edges[axis.end];
  const extra = style['boxSizing'] === 'content-box' ? frame : 0;
  const most = resolveLength(style[`max${caps}`], room);
  const least = resolveLength(style[`min${caps}`], room);
  let border = left;
  if (most !== undefined) border = Math.min(border, most + extra);
  if (least !== undefined) border = Math.max(border, least + extra);
  border = Math.max(border, frame);
  return { border, size: border - extra };
}

/**
 * A fixed box's insets and percentage sizes, which are of its page, as lengths against the box
 * Yoga positions it by: each inset moved by how far the two boxes' edges are apart. `by` and
 * `page` are those boxes inside their borders, in the window.
 */
function againstPage(
  style: Record<string, unknown>,
  by: readonly number[],
  page: readonly number[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const axis of ABSOLUTE_AXES) {
    const [start, end, size] = [axis.start.toLowerCase(), axis.end.toLowerCase(), axis.size];
    const room = page[size]!;
    const [near, far] = [resolveLength(style[start], room), resolveLength(style[end], room)];
    if (near !== undefined) out[start] = near + page[axis.at]! - by[axis.at]!;
    if (far !== undefined) out[end] = far + by[axis.at]! + by[size]! - page[axis.at]! - room;
    const key = axis.at === 0 ? 'width' : 'height';
    if (typeof style[key] === 'string') {
      const length = resolveLength(style[key], room);
      if (length !== undefined) out[key] = length;
    }
  }
  return out;
}

/** Keep what was read of a grid item at a width. */
function noteAt(
  all: Map<EngineNode, Map<number, number>>,
  member: EngineNode,
  width: number,
  value: number,
): void {
  const read = all.get(member) ?? new Map<number, number>();
  read.set(width, value);
  all.set(member, read);
}

const sameBase = (
  a: readonly [number, number | undefined],
  b: readonly [number, number | undefined] | undefined,
): boolean => a[0] === b?.[0] && a[1] === b?.[1];

/** The props an animation can move without moving any box: what a frame of it only paints. */
const PAINT_ONLY_KEYS = new Set([
  ...['transform', 'opacity', 'color', 'backgroundColor', 'tintColor', 'filter', 'boxShadow'],
  // A rotate, a translate or a scale of its own, folded into the transform it paints.
  ...['__translate', '__rotate', '__scale'],
  ...['borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'],
  ...['shadowColor', 'shadowOpacity', 'shadowRadius', 'shadowOffset', 'outlineColor'],
  ...['textDecorationColor', 'textShadowColor'],
]);

const LINE_KEYS = ['gridColumnStart', 'gridColumnEnd', 'gridRowStart', 'gridRowEnd'];
/**
 * Whether the props a node is cloned with change nothing about where any box is: none, or only
 * how it is painted and what a screen reader is told of it.
 */
function paintsOnly(payload: Record<string, unknown> | null): boolean {
  for (const key in payload) {
    if (!PAINT_ONLY_KEYS.has(key) && !key.startsWith('accessib') && !key.startsWith('aria-')) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a box is laid out at a size of its own whatever it holds: out of the flow, with a
 * width and a height in points. See `Engine.heldIn`.
 */
function holdsItsContent(node: EngineNode): boolean {
  const props = node.committed?.props;
  return (
    props?.['position'] === 'absolute' &&
    typeof props['width'] === 'number' &&
    typeof props['height'] === 'number'
  );
}

/** Whether a box's placement names a grid line on any side. */
const namesLines = (read: (key: string) => unknown): boolean =>
  LINE_KEYS.some((key) => read(key) != null && read(key) !== 'auto');

/**
 * Where an out-of-flow box with no inset on an axis sits in the grid area it is placed against,
 * as Chrome places it: at the area's start, or moved within it by its `justify-self` across and
 * its `align-self` down, or the grid's items' where its own is `auto`. `by` is the box Yoga
 * positions it by, and `box` its own as last laid out.
 */
function startOfArea(
  style: Record<string, unknown>,
  grid: Record<string, unknown>,
  boxes: { by: readonly number[]; area: readonly number[]; box: readonly number[] },
): Record<string, number> {
  const { by, area, box } = boxes;
  const out: Record<string, number> = {};
  for (const axis of ABSOLUTE_AXES) {
    const [start, end] = [axis.start.toLowerCase(), axis.end.toLowerCase()];
    if (style[start] != null || style[end] != null) continue;
    const [self, items] =
      axis.at === 0 ? ['justifySelf', 'justifyItems'] : ['alignSelf', 'alignItems'];
    const own = isAuto(style[self]) || style[self] === 'normal' ? grid[items] : style[self];
    // Its margins are added to the inset where it is placed, and take from the room left over.
    const margins = marginOf(style, axis.start) + marginOf(style, axis.end);
    const free = area[axis.size]! - box[axis.size]! - margins;
    out[start] = area[axis.at]! - by[axis.at]! + free * alignedAt(own);
  }
  return out;
}

/** A box's margin on one side, in points: nothing where it is a share or `auto`. */
function marginOf(style: Record<string, unknown>, side: (typeof SIDES)[number]): number {
  const value = firstOf(style, [`margin${side}`, `margin${AXIS[side]}`, 'margin']);
  return typeof value === 'number' ? value : 0;
}

/** How far into the room left over an alignment puts a box: none, half or all of it. */
function alignedAt(align: unknown): number {
  const word = typeof align === 'string' ? align.replace(/^(safe|unsafe)\s+/, '') : '';
  if (word === 'center') return 0.5;
  return ['end', 'flex-end', 'self-end'].includes(word) ? 1 : 0;
}

const sameResolved = (
  a: Readonly<Record<string, number | null>> | undefined,
  b: Readonly<Record<string, number | null>> | undefined,
): boolean => {
  const keys = Object.keys(a ?? {});
  return keys.length === Object.keys(b ?? {}).length && keys.every((key) => a![key] === b?.[key]);
};

/** A sticky box: the scroll offsets it moves between, and what moves it. */
interface StickyState {
  scroll: EngineNode;
  axis: ScrollAxis;
  /** The offset it starts moving at, and the one it stops at: the end of its parent. */
  start: number;
  stop: number;
  /** How far it is moved, as written on its transform. */
  shift: number;
  drive: ComposedDrive | null;
  /** Its own transform as a transition native plays has it, which the drive applies after it. */
  lent?: readonly FollowingTransform[];
}

/**
 * How long scrolling pauses before a natively moved box's shift is written to its transform, so
 * the shadow tree a touch is hit-tested against catches up. React Native's own sticky headers
 * wait as long.
 */
const STICKY_SETTLE_MS = 64;

/**
 * A grid container between the commit that changed it and the commit that places its items.
 *
 * Yoga has no grid, so its items are taken out of the flow and placed by the engine, from sizes
 * read back from Fabric. `measuring` commits each item with no size, to be read at the size its
 * content wants; `sizing` commits the items whose height at a column's width is wanted, at that
 * width; `placed` commits each where the grid puts it.
 */
interface GridState {
  phase: 'measuring' | 'words' | 'sizing' | 'placed';
  /** Laid out since it or anything in it last changed. */
  settled: boolean;
  members: readonly EngineNode[];
  /** Each item's size with its content as wide as it wants. */
  content: Map<EngineNode, { width: number; height: number }>;
  /**
   * Each item's width with its content as narrow as it goes, read where the layout asked: its
   * text is committed one word to a line, `words`, and the widest of them is that width.
   */
  narrow: Map<EngineNode, number>;
  /** Set by a layout that asked for a width `narrow` does not have yet. */
  wantsNarrow: boolean;
  /** Each item's height at a width, for the widths the layout asked about. */
  heights: Map<EngineNode, Map<number, number>>;
  /** The widths being asked about, while `sizing`. */
  widths: Map<EngineNode, number>;
  /** Where each item goes, against the container's padding box, once `placed`. */
  rects: Map<EngineNode, Rect>;
  /** The width of the box it was last laid out in, and the height it then came to, if its own. */
  width?: number;
  height?: number;
  /** The width its tracks came to, where nothing else gives it one. */
  ownWidth?: number;
  /**
   * How far down each item's baseline is at a width, read as Yoga lines items up in a row: see
   * `gridWithHeights`. Set on `inRow` while the items are committed that way to be read.
   */
  baselines: Map<EngineNode, Map<number, number>>;
  /** Each item whose baseline the last layout asked for, and the width it asked at. */
  asked: Map<EngineNode, number>;
  wantsBaseline?: boolean;
  inRow?: boolean;
  /** The grid lines a placement names, from the last layout: what an out-of-flow child is against. */
  area?: GridLayout['area'];
  stopListening?: () => void;
  /** Its style and each item's as it was last laid out, and what each item held: see `follows`. */
  styled?: string;
  styles?: Map<EngineNode, string>;
  shapes?: Map<EngineNode, string>;
  /**
   * The items changed in or beneath since it was laid out, with no cause yet to lay it out
   * again, and how far the content of each reached before the change.
   */
  followed?: Map<EngineNode, Reach>;
  /** How far each of those reached after the last such change, which is before the next. */
  reached?: Map<EngineNode, Reach>;
}

/** How far down an item's content reaches in it, and whether it reaches past its right edge. */
interface Reach {
  bottom: number;
  over: boolean;
}

/** A style as a grid is laid out from it: what is only paint moves nothing, and is left out. */
const asAKey = (style: Record<string, unknown>): string =>
  JSON.stringify(style, (key, value: unknown) => (PAINT_ONLY_KEYS.has(key) ? undefined : value));

/**
 * How much an item holds: its elements, and the letters of its text. Text as long as it was is
 * taken to be as wide, and a box neither added nor taken away to leave the others as they were.
 */
function shapeOf(node: EngineNode): string {
  let elements = 0;
  let letters = 0;
  const count = (each: EngineNode): void => {
    if (each.nodeKind === 'text') letters += each.nodeText.length;
    else if (each.nodeKind === 'element') elements++;
    for (const child of each.childList) count(child);
  };
  for (const child of node.childList) count(child);
  return `${elements}:${letters}`;
}

/** The props only the engine's grid layout reads. None of them is a React Native style. */
const GRID_KEYS = [
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridTemplateAreas',
  'gridAutoColumns',
  'gridAutoRows',
  'gridAutoFlow',
  'gridColumnStart',
  'gridColumnEnd',
  'gridRowStart',
  'gridRowEnd',
  'justifyItems',
  'justifySelf',
];
/** What places a box among its siblings, which the grid does for an item instead. */
const PLACING_KEYS = [
  ...['margin', 'marginVertical', 'marginHorizontal'],
  ...['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'marginStart', 'marginEnd'],
  ...['top', 'right', 'bottom', 'left', 'start', 'end'],
  ...['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf'],
];
const SIZE_LIMITS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'];

/** Every run of text under a node. */
function textsUnder(node: EngineNode): EngineNode[] {
  return node.childList.flatMap((child) =>
    child.nodeKind === 'text' ? [child] : textsUnder(child),
  );
}

/** Whether a `display` is a grid, in a line or not: what it holds is laid out the same. */
const isGrid = (display: unknown): boolean => display === 'grid' || display === 'inline-grid';

/** The grid a node is an item of, where it is still a child of that grid. */
function gridOver(node: EngineNode): GridState | undefined {
  const container = node.gridIn;
  return container && node.parent === container && container.grid?.members.includes(node)
    ? container.grid
    : undefined;
}

/**
 * A grid container and its items, as the views Yoga lays out: the container a plain box as tall
 * as its rows, and each item out of the flow, at the size the grid's current phase wants.
 */
function gridLayout(node: EngineNode, props: Record<string, unknown>): void {
  // Asked of every node, and read before it is deleted: most have none of these.
  for (const key of GRID_KEYS) if (props[key] !== undefined) delete props[key];
  if (isGrid(props['display'])) {
    props['display'] = 'flex';
    if (node.grid) gridContainer(node, node.grid, props);
    // Its items are placed out of the flow, and it is what they are placed in: a static box
    // would leave them to whatever further up is positioned.
    if (node.grid && props['position'] === 'static') props['position'] = 'relative';
  }
  const state = gridOver(node);
  if (state) gridItem(node, state, props);
}

/**
 * A grid container as a plain box. While it is measured it stacks its items at their content's
 * width, so a container nothing gives a width comes out as wide as its widest item, and one that
 * is given a width keeps it. Placed, it is the width and height its tracks came to where its own
 * were not set.
 */
function gridContainer(node: EngineNode, state: GridState, props: Record<string, unknown>): void {
  if (state.phase === 'measuring' || state.phase === 'words') {
    props['flexDirection'] = 'column';
    props['flexWrap'] = 'nowrap';
    return;
  }
  if (state.phase === 'sizing' && state.inRow) {
    // Yoga knows a baseline, and lines items up by theirs in a row: where each lands says it.
    Object.assign(props, { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'baseline' });
    return;
  }
  if (state.ownWidth !== undefined) props['width'] = state.ownWidth;
  if (state.height !== undefined) rowsHeight(node, state.height, props, state.width);
}

/**
 * A grid's rows' height, as the height of what it holds: its height down a column, which it
 * grows and shrinks from, and the least it is across a row, which stretches it taller. A basis
 * written as its height is its height, whatever its rows come to. With an aspect ratio, its
 * height is what the ratio gives its width, or its rows where they are taller.
 */
function rowsHeight(
  node: EngineNode,
  rows: number,
  props: Record<string, unknown>,
  width?: number,
): void {
  if (props['height'] != null && !NO_HEIGHT.has(props['height'] as string)) return;
  const ratio = props['aspectRatio'];
  const sized = typeof ratio === 'number' && ratio > 0 && width !== undefined;
  const height = sized ? Math.max(rows, width / ratio) : rows;
  if (sized) delete props['aspectRatio'];
  if (!node.parent || !isRow(node.parent)) {
    props['height'] = height;
    return;
  }
  const least = props['minHeight'];
  props['minHeight'] = typeof least === 'number' ? Math.max(least, height) : height;
}

/** A grid item, in the flow at its content's width while its grid is measured, and out of it after. */
function gridItem(node: EngineNode, state: GridState, props: Record<string, unknown>): void {
  const shift = relativeShift(props);
  for (const key of PLACING_KEYS) delete props[key];
  if (state.phase === 'placed') {
    props['position'] = 'absolute';
    for (const key of SIZE_LIMITS) delete props[key];
    const rect = state.rects.get(node);
    if (rect) Object.assign(props, asCommitted(rect, shift, props));
    return;
  }
  // A percentage is of the item's area, which is not known while it is measured.
  for (const key of ['width', 'height', ...SIZE_LIMITS]) {
    if (typeof props[key] === 'string') delete props[key];
  }
  if (state.phase === 'measuring' || state.phase === 'words') {
    props['position'] = 'relative';
    props['alignSelf'] = 'flex-start';
    return;
  }
  props['position'] = state.inRow ? 'relative' : 'absolute';
  const width = state.widths.get(node);
  if (width !== undefined) props['width'] = width - contentFrame(props).width;
}

/** How far an item's own offsets move it from its area, as a relative box. Static or sticky, nothing. */
function relativeShift(props: Record<string, unknown>): { x: number; y: number } {
  // A sticky box's offsets are where it sticks in its scroll view: see `Engine.settleSticky`.
  if (props['position'] === 'static' || props['position'] === 'sticky') return { x: 0, y: 0 };
  const at = (start: string, end: string) => {
    const [from, to] = [props[start], props[end]];
    if (typeof from === 'number') return from;
    return typeof to === 'number' ? -to : 0;
  };
  return { x: at('left', 'right'), y: at('top', 'bottom') };
}

/**
 * The padding and border a size written on a box leaves out: all of them where its
 * `box-sizing` is `content-box`, and none otherwise.
 */
function contentFrame(props: Record<string, unknown>): { width: number; height: number } {
  if (props['boxSizing'] !== 'content-box') return { width: 0, height: 0 };
  const edge = insets(props);
  return { width: edge.Left + edge.Right, height: edge.Top + edge.Bottom };
}

/** Where a grid puts an item's border box, as the props that put it there. */
function asCommitted(
  rect: Rect,
  shift: { x: number; y: number },
  props: Record<string, unknown>,
): Rect {
  const frame = contentFrame(props);
  return {
    left: rect.left + shift.x,
    top: rect.top + shift.y,
    width: Math.max(rect.width - frame.width, 0),
    height: Math.max(rect.height - frame.height, 0),
  };
}

/**
 * Whether a box out of the flow is as wide as what it holds: it has no width, and no inset on
 * each side to be stretched between. A browser shrinks it to fit, a panel in the body among
 * them, where Yoga takes a percentage inside it as one of the room.
 *
 * ponytail: the room it is fitted within is the box it is placed in, and not that less its
 * inset. Take the inset off if a panel placed far across the screen is ever too wide.
 */
function shrunkOutOfFlow(node: EngineNode): boolean {
  if (!OUT_OF_FLOW.has(readStyle(node, 'position') as string)) return false;
  if (readStyle(node, 'width') != null) return false;
  const set = (...keys: string[]) => keys.some((key) => readStyle(node, key) != null);
  return !(set('left', 'start') && set('right', 'end'));
}

/** Whether a column makes an item as wide as itself: by the item's own alignment, or its own. */
function stretched(node: EngineNode, column: EngineNode): boolean {
  const own = readStyle(node, 'alignSelf');
  const align = own == null || own === 'auto' ? readStyle(column, 'alignItems') : own;
  return align == null || align === 'stretch' || align === 'normal';
}

/** Whether a row's item is given its width by the row: it grows into it, or has a basis. */
function sharesRow(node: EngineNode): boolean {
  const [grow, flex, basis] = ['flexGrow', 'flex', 'flexBasis'].map((key) => readStyle(node, key));
  if ((typeof grow === 'number' && grow > 0) || typeof flex === 'number') return true;
  return basis != null && basis !== 'auto';
}

/**
 * Whether a box in the flow is as wide as a share of the box it is in: a percentage. One out of
 * the flow is a share of a box it has no part in the width of, a focus ring over a chip.
 */
function sharesWidth(node: EngineNode): boolean {
  if (!isShare(readStyle(node, 'width')) && !isShare(readStyle(node, 'minWidth'))) return false;
  return !OUT_OF_FLOW.has(readStyle(node, 'position') as string);
}

/** A percentage: of the box a node is in, for a width or the least it may be. */
const isShare = (value: unknown): boolean => typeof value === 'string' && value.endsWith('%');

/** The parts of a table, which stick within the table and not within the part they are in. */
const TABLE_PARTS = new Set(['thead', 'tbody', 'tfoot', 'tr', 'th', 'td']);

/**
 * The box a sticky box does not leave: its parent, or for a part of a table the table, since a
 * header row is no taller than the cells that stick in it. A web library's elements have these
 * names; an app's own views have none of them.
 */
function stickyBlock(node: EngineNode): EngineNode {
  let block = node.parent!;
  if (!TABLE_PARTS.has(node.tag)) return block;
  while (block.parent && TABLE_PARTS.has(block.tag)) block = block.parent;
  return block;
}

/**
 * A sticky box as Yoga lays it out: where it is written, since its insets say where it sticks
 * and not where it sits, moved by however far its scroll view has pushed it.
 */
function stickyLayout(node: EngineNode, props: Record<string, unknown>): void {
  props['position'] = 'relative';
  // Over what is written after it, as a browser paints a positioned box over the flow.
  props['zIndex'] ??= 1;
  // With no inset on the axis it moves along it sticks nowhere, whatever it moved by before.
  const state = node.sticky;
  const inset = props[state?.axis === 'x' ? 'left' : 'top'];
  for (const key of ['top', 'right', 'bottom', 'left', 'start', 'end']) {
    if (props[key] !== undefined) delete props[key];
  }
  if (!state?.shift || typeof inset !== 'number') return;
  moveBeforeOwn(props, { [state.axis === 'x' ? 'translateX' : 'translateY']: state.shift });
}

/** What a frame of an animation moved: its last gives back what it held, as a size may be. */
const frameKeys = (values: Readonly<Record<string, unknown>>, finished: boolean): string[] =>
  finished ? ['width'] : Object.keys(values);

/** The moves the engine writes before a box's own transform: see `moveBeforeOwn`. */
const ENGINE_MOVES = new WeakSet<object>();

/**
 * A move of the engine's written before a box's own transform, once: one already there, as on
 * a transform read back from what was committed, is taken off first.
 */
function moveBeforeOwn(props: Record<string, unknown>, move: Record<string, number>): void {
  ENGINE_MOVES.add(move);
  const own = ownTransform(props['transform']);
  props['transform'] = Array.isArray(own) ? [move, ...own] : [move];
}

/**
 * A transform as the box's styles wrote it, without the moves the engine put before it: what a
 * transition eases from, where it reads what was committed. Nothing where that was all it had.
 */
function ownTransform(value: unknown): unknown {
  if (!Array.isArray(value) || !ENGINE_MOVES.has(value[0] as object)) return value;
  const own = value.filter((entry) => !ENGINE_MOVES.has(entry as object));
  return own.length ? own : undefined;
}

/** The moves the engine put before a transform: see `moveBeforeOwn`. */
const engineMoves = (value: unknown): unknown[] =>
  Array.isArray(value) ? value.filter((entry) => ENGINE_MOVES.has(entry as object)) : [];

/** Whether two transform lists hold the same operations, one for one. */
const sameEntries = (a: unknown, b: readonly unknown[]): boolean =>
  a === b || (Array.isArray(a) && a.length === b.length && a.every((entry, i) => entry === b[i]));

/**
 * Take off what is read here and is no style of a native view: `order`, by the container in
 * `inOrder`, and `justify-self`, by the block a box is in.
 */
function notNative(props: Record<string, unknown>): void {
  if (props['order'] !== undefined) delete props['order'];
  if (props['justifySelf'] !== undefined) delete props['justifySelf'];
}

/**
 * What the engine lays out in Yoga's place, written on a node's props last of all: a box sized
 * from what was read back, and a relative box in a line moved by its offset.
 */
function engineLayout(node: EngineNode, props: Record<string, unknown>, asked: number): void {
  // Nothing of it is on a node until something asks, and an app of plain flex never does.
  if (asked !== 0) askedLayout(node, props, asked);
  // Asked of every node merged, so asked here first: nearly none has a most size.
  if (props['maxHeight'] !== undefined) leastWins(props, 'Height');
  if (props['maxWidth'] !== undefined) leastWins(props, 'Width');
  if (asked & CSS_LAYOUT) {
    notNative(props);
    if (node.resolved) resolvedOnto(node.resolved, props);
  }
  if (props['position'] !== undefined) positioned(node, props);
}

/** The part of `engineLayout` that a layout something asked for sets a node up for. */
function askedLayout(node: EngineNode, props: Record<string, unknown>, asked: number): void {
  const css = (asked & CSS_LAYOUT) !== 0;
  if (css) gridLayout(node, props);
  if (asked & MIXED_SIZES) {
    mixedLayout(node, props);
    // A basis a sum came to is a size too, as one written is: see `basisAsSize`.
    basisAsSize(node, props);
  }
  // Before the minimum: a cell with its share of a row set aside is sized by its content, and
  // does not shrink under it while the box it is in is measured.
  if (node.fitOff) setAsideToFit(node, props);
  if (css) {
    autoMinimum(node, props);
    shareMinimum(node, props);
  }
  if (node.fit !== undefined || node.fitMin !== undefined) fitted(node, props);
  heldHeight(node, props);
}

/**
 * A box as tall as its content, at what that came to: see `Engine.settleHeld`. That is read as
 * the box's border box, and a height of `content-box` is without its padding and border.
 */
function heldHeight(node: EngineNode, props: Record<string, unknown>): void {
  if (node.heldAt === undefined || !NO_HEIGHT.has(props['height'] as string)) return;
  const edge = props['boxSizing'] === 'content-box' ? insets(props) : NO_INSETS;
  const slack = wrapsDown(props) ? ROUNDING_SLACK : 0;
  props['height'] = Math.max(node.heldAt.height + slack - edge.Top - edge.Bottom, 0);
}

/**
 * How much taller than it was read a column that wraps is held. The height is read back rounded
 * to the screen's pixels, up to a pixel less than its content, and Yoga then breaks the column's
 * line where content that just fits overflows it, which a browser does not. A third of a point
 * is a pixel at three times the scale, and too little to keep content that does not fit on one
 * line. It is also too little to be seen, though a box that grows takes it up.
 *
 * ponytail: at a lower scale the height can still come out short by more than that.
 */
const ROUNDING_SLACK = 1 / 3;

/** Whether a flex container is a column that wraps. */
const wrapsDown = (props: Record<string, unknown>): boolean =>
  (props['flexWrap'] === 'wrap' || props['flexWrap'] === 'wrap-reverse') &&
  !String(props['flexDirection'] ?? 'column').startsWith('row');

/** A box with its share of a row set aside, while the box it is in is measured. */
function setAsideToFit(node: EngineNode, props: Record<string, unknown>): void {
  contentSized(props);
  pictureWide(node, props);
  // A field with its share set aside is as wide as its own size makes it, as its content.
  columnsWide(props, node.props[FIELD_SIZE]);
}

/** A box fitted to its content: the width that came to, and the least it may be. */
function fitted(node: EngineNode, props: Record<string, unknown>): void {
  if (node.fit?.width !== undefined) props['width'] = node.fit.width;
  if (node.fitMin === undefined) return;
  const own = typeof props['minWidth'] === 'number' ? props['minWidth'] : 0;
  props['minWidth'] = Math.max(own, node.fitMin);
}

/** What an out-of-flow box was resolved to, written on its props or taken off them. */
function resolvedOnto(
  resolved: NonNullable<EngineNode['resolved']>,
  props: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(resolved)) {
    if (value === null) delete props[key];
    else props[key] = value;
  }
}

/** What a box's `position` needs of the engine, where Yoga does not do what CSS means by it. */
function positioned(node: EngineNode, props: Record<string, unknown>): void {
  // Out of the flow is what fixed means, whether in place or committed under its page.
  if (props['position'] === 'fixed') props['position'] = 'absolute';
  if (props['position'] === 'sticky') stickyLayout(node, props);
  if (props['position'] === 'relative' && inWrappingRow(node)) offsetAcrossLines(props);
}

const OUT_OF_FLOW = new Set(['absolute', 'fixed']);
const INLINE_DISPLAYS = new Set(['inline-block', 'inline-flex', 'inline-grid']);

/** Whether a node is an element said to be always inline that is text in a browser: a span. */
const inlineText = (node: EngineNode): boolean =>
  node.inlineLevel === 'always' && TEXT_ELEMENTS.has(node.tag);

/** Whether a box sits in a line: by its display, or with none, as text or an inline element. */
function sitsInLine(node: EngineNode, display: unknown): boolean {
  if (INLINE_DISPLAYS.has(display as string)) return true;
  return display == null && (node.inlineLevel === 'always' || isTextElement(node));
}

/** Whether a box is laid out in a line of a block container's flow, as the plan for it has it. */
function inALine(node: EngineNode): boolean {
  const plan = flowOver(node)?.plan;
  return plan !== undefined && (plan.kind === 'lines' || plan.inline.has(node));
}

/** Whether a box is an item of a row that wraps: lines the engine lays out, or a row written so. */
function inWrappingRow(node: EngineNode): boolean {
  const flow = flowOver(node);
  if (flow?.plan.kind === 'lines' || flow?.lined.has(node)) return true;
  const parent = node.parent;
  if (!parent || readStyle(parent, 'flexWrap') !== 'wrap') return false;
  return String(readStyle(parent, 'flexDirection')).startsWith('row');
}

/**
 * A relative offset across the lines of a row that wraps, as a move of the box: Yoga places
 * each line's items again once the lines are sized, and leaves the offset out when it does. A
 * relative offset moves a box from where it was laid out and moves nothing else, which a
 * translate before its own transform does as well.
 *
 * ponytail: a length. A percentage is of the box it is in, which is not known here, and is left
 * to Yoga; read it back as the mixed sums are if a stylesheet offsets a line item by a share.
 */
function offsetAcrossLines(props: Record<string, unknown>): void {
  const [top, bottom] = [props['top'], props['bottom']];
  const by = typeof top === 'number' ? top : typeof bottom === 'number' ? -bottom : undefined;
  if (by === undefined) return;
  delete props['top'];
  delete props['bottom'];
  moveBeforeOwn(props, { translateY: by });
}

interface MixedState {
  /** Each declaration as its two parts: a percentage, and points added to it. */
  parts: Record<string, { percent: number; points: number }>;
  /** What each came to, or nothing before the box it is of has been read. */
  values?: Record<string, number>;
  /** The size of that box when they were worked out: a change in it works them out again. */
  base?: readonly [number, number | undefined];
  dirty: boolean;
}

/**
 * The props a percentage of the containing block's width is added to a length for, and those
 * where it is of its height. A margin and a padding are of the width on every side.
 */
const MIXED_OF_HEIGHT = new Set(['height', 'minHeight', 'maxHeight', 'top', 'bottom']);
const MIXED_KEYS = new Set([
  ...['width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight'],
  ...['top', 'right', 'bottom', 'left', 'start', 'end'],
  ...['margin', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd'],
  ...['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  ...['padding', 'paddingHorizontal', 'paddingVertical', 'paddingStart', 'paddingEnd'],
  ...['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  // What an item of a row or a column starts from: a share of whichever it is in.
  'flexBasis',
]);
const MIXED = /^calc\(\s*(-?[\d.]+)(%|px)\s*([+-])\s*(-?[\d.]+)(%|px)\s*\)$/;

/** `calc(100% - 32px)` or `calc(32px + 50%)` as a percentage and the points added to it. */
function mixedParts(value: unknown): { percent: number; points: number } | undefined {
  if (typeof value !== 'string' || !value.startsWith('calc(')) return undefined;
  const match = MIXED.exec(value);
  if (!match || match[2] === match[5]) return undefined;
  const second = Number(match[4]) * (match[3] === '-' ? -1 : 1);
  const [percent, points] =
    match[2] === '%' ? [Number(match[1]), second] : [second, Number(match[1])];
  return { percent, points };
}

/**
 * A percentage with a length added, which Yoga has no value for: committed as what it came to
 * against the box the percentage is of, and set aside until that box has been read, and while
 * it is measured. See `settleMixed`.
 */
function mixedLayout(node: EngineNode, props: Record<string, unknown>): void {
  const parts = takeMixed(node, props);
  if (!parts) node.mixed = undefined;
  else if (!node.mixed || !sameParts(node.mixed.parts, parts)) node.mixed = { parts, dirty: true };
}

/** Each such declaration of a node, written on its props as what it came to or taken off them. */
function takeMixed(
  node: EngineNode,
  props: Record<string, unknown>,
): MixedState['parts'] | undefined {
  let parts: MixedState['parts'] | undefined;
  // Set aside too while a box it is in is fitted to its content: see `settleFits`.
  const values = node.mixedOff || node.fitOff ? undefined : node.mixed?.values;
  // Asked of every node: its own props are fewer than the ones this could be written on.
  for (const key in props) {
    const value = props[key];
    // Told from the rest here, and not by a call for each: nearly none is a sum.
    if (typeof value !== 'string' || !value.startsWith('calc(')) continue;
    const read = mixedParts(value);
    if (!read) continue;
    // A token can carry the sum to a property with no box for its percentage: not committed.
    if (MIXED_KEYS.has(key)) (parts ??= {})[key] = read;
    writeMixed(props, key, ofNoHeight(node, props, key) ? withNoHeight(key, read) : values?.[key]);
  }
  return takeMixedTranslate(props, values, parts);
}

/** A sum as what it came to, or taken off the props until it is known. */
function writeMixed(props: Record<string, unknown>, key: string, to: number | undefined): void {
  if (to === undefined) delete props[key];
  else props[key] = to;
}

/**
 * Whether a sum is a share of a height the box it is in does not have: one as tall as its
 * content, which a column has not sized yet (see `Engine.settleHeld`). CSS takes its height
 * as `auto` then, and a basis down a column as its content.
 */
function ofNoHeight(node: EngineNode, props: Record<string, unknown>, key: string): boolean {
  const tall = key === 'height' || key === 'minHeight' || key === 'maxHeight';
  if (!tall && key !== 'flexBasis') return false;
  if (props['position'] === 'absolute' || props['position'] === 'fixed') return false;
  const parent = layoutParent(node);
  if (!parent || (key === 'flexBasis' && isRow(parent))) return false;
  return !definiteHeight(parent);
}

/** What a sum of a share of no height comes to: a least height is its length alone, as Chrome has it. */
const withNoHeight = (key: string, { points }: { points: number }): number | undefined =>
  key === 'minHeight' && points > 0 ? points : undefined;

/**
 * The same for a translate, whose percentage is of the element's own box. Until that has been
 * read the percentage alone is committed, which native takes, and is all but the length out.
 */
function takeMixedTranslate(
  props: Record<string, unknown>,
  values: Record<string, number> | undefined,
  parts: MixedState['parts'] | undefined,
): MixedState['parts'] | undefined {
  const transform = props['transform'];
  if (!Array.isArray(transform)) return parts;
  let found = parts;
  let changed = false;
  const resolved = (transform as Record<string, unknown>[]).map((entry) => {
    const [key, value] = Object.entries(entry)[0] ?? [];
    const read = key === 'translateX' || key === 'translateY' ? mixedParts(value) : undefined;
    if (!key || !read) return entry;
    (found ??= {})[key] = read;
    changed = true;
    return { [key]: values?.[key] ?? `${read.percent}%` };
  });
  if (changed) props['transform'] = resolved;
  return found;
}

function sameParts(a: MixedState['parts'], b: MixedState['parts']): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key]!.percent === b[key]?.percent && a[key]!.points === b[key]?.points)
  );
}

/** What each declaration comes to against a box of this width and height. */
function mixedValues(
  parts: MixedState['parts'],
  [width, height]: readonly [number, number | undefined],
  own: readonly number[] | undefined,
  inColumn = false,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, { percent, points }] of Object.entries(parts)) {
    // A translate is by a share of the element's own box.
    const self = key === 'translateX' ? own?.[2] : key === 'translateY' ? own?.[3] : null;
    // And a basis by a share of the box it is in, the way that box lays it out.
    const tall = key === 'flexBasis' ? inColumn : MIXED_OF_HEIGHT.has(key);
    const whole = self !== null ? self : tall ? height : width;
    // A percentage of a height nothing gave is of nothing: the declaration stays set aside.
    if (whole === undefined) continue;
    const value = (percent / 100) * whole + points;
    // Only an inset, a margin and a translate go below nothing.
    values[key] = /^(margin|top|right|bottom|left|start|end|translate)/.test(key)
      ? value
      : Math.max(value, 0);
  }
  return values;
}

/** The sizes CSS has keywords for, which a box is fitted to by the engine: `fit-content`. */
const SIZE_KEYS = new Set([
  ...['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flexBasis'],
]);
/**
 * What only the engine reads, whatever it is set to: no native view lays out by any of them, or
 * draws by `visibility` or a clip to nothing (`seenByCss`).
 */
const LAID_OUT_HERE = new Set([...GRID_KEYS, 'order', 'visibility', 'clipped']);
const POSITIONS_HERE = new Set(['static', 'fixed', 'sticky']);

/** What a declaration can ask of the engine that an app of plain flex does not: see `asks`. */
const CSS_LAYOUT = 1;
const MIXED_SIZES = 2;
const SHARED_WIDTHS = 4;
const TRANSITIONS = 8;
const SHARED_HEIGHTS = 16;
/** What the engine lays out in Yoga's place, of those. */
const LAYOUTS = CSS_LAYOUT | MIXED_SIZES | SHARED_WIDTHS | SHARED_HEIGHTS;
const EVERYTHING = LAYOUTS | TRANSITIONS;
/** What a value that may be a share or a sum, known only once a token is, asks for. */
const SHARES = MIXED_SIZES | SHARED_WIDTHS | SHARED_HEIGHTS;

/**
 * What a declaration asks for that the engine works out in Yoga's place, each a bit:
 *
 * - a layout CSS has and Yoga has not: a block or a grid, a box in a line, a position that is
 *   not a native view's, a size that is a keyword, an automatic minimum;
 * - a percentage with a length added, `calc(100% - 32px)`, which Yoga has no value for;
 * - a width that is a share of its box, which is fitted where that box is as wide as its
 *   content;
 * - a height that is a share of its box, which is held at its content's height where it is as
 *   tall as its content;
 * - a transition or an animation, which native lays out where nothing else in its commit
 *   moves, so the boxes a commit moves are noted.
 *
 * See `Engine.asked`: a node is asked nothing of what no declaration in the app has asked for.
 */
function asks(key: string, value: unknown): number {
  // A transition or an animation, as each of their declarations is kept: `$transition`.
  if (key.startsWith('$')) return TRANSITIONS;
  if (typeof value === 'string') return asksByText(key, value);
  if (LAID_OUT_HERE.has(key)) return CSS_LAYOUT;
  // A move by a share with a length added is inside a transform's own list of values, and
  // nothing else's: see `takeMixedTranslate`.
  if (key !== 'transform' || value === null || typeof value !== 'object') return 0;
  return JSON.stringify(value).includes('calc(') ? MIXED_SIZES : 0;
}

function asksByText(key: string, value: string): number {
  if (key === 'display') return value !== 'flex' && value !== 'none' ? CSS_LAYOUT : 0;
  if (key === 'position') return POSITIONS_HERE.has(value) ? CSS_LAYOUT : 0;
  if (LAID_OUT_HERE.has(key)) return CSS_LAYOUT;
  // A sum with a share of a height in it is held as a share of one is.
  if (value.startsWith('calc(')) return MIXED_SIZES | (value.includes('%') ? heightShare(key) : 0);
  return SIZE_KEYS.has(key) ? asksBySize(key, value) : 0;
}

/** What a share of its box asks for, by the size it is. */
const SHARES_OF: Record<string, number> = {
  width: SHARED_WIDTHS,
  minWidth: SHARED_WIDTHS,
  height: SHARED_HEIGHTS,
  minHeight: SHARED_HEIGHTS,
  flexBasis: SHARED_HEIGHTS,
};

const heightShare = (key: string): number =>
  SHARES_OF[key] === SHARED_HEIGHTS ? SHARED_HEIGHTS : 0;

/** What a size asks for: a share of its box, an automatic minimum, or a keyword of CSS's. */
function asksBySize(key: string, value: string): number {
  const least = key === 'minWidth' || key === 'minHeight';
  if (value.endsWith('%')) return SHARES_OF[key] ?? 0;
  if (value === 'auto') return least ? CSS_LAYOUT : 0;
  return value.includes('content') ? CSS_LAYOUT : 0;
}

/**
 * Whether a box out of the flow asks for one by what it is merged as: a margin that is `auto`,
 * which Yoga does not centre such a box by. Read off the node, as no one declaration says it.
 */
function asksOfPlaced(props: Record<string, unknown>): boolean {
  return props['position'] === 'absolute' && MARGIN_KEYS.some((key) => props[key] === 'auto');
}

/** What a node's own style would have the engine plan, of a layout of CSS's. */
function unaskedPlan(node: EngineNode): string[] {
  const missed: string[] = [];
  const [display, position] = [readStyle(node, 'display'), readStyle(node, 'position')];
  if (isBlockContainer(display) || isGrid(display)) missed.push(`display ${String(display)}`);
  if (position === 'static' || position === 'fixed' || position === 'sticky') {
    missed.push(`position ${position}`);
  }
  if (readStyle(node, 'order') != null) missed.push('order');
  return missed;
}

/**
 * How a test run has every engine take what is asked of it, to prove that asking changes
 * nothing but the work done: `all` asks for everything from the start, as every app was laid
 * out before anything was left unasked, and `check` throws where a node would be laid out by
 * something nothing asked for.
 */
const askMode = (): 'all' | 'check' | undefined =>
  (globalThis as { ɵngNativeLayoutAsks?: 'all' | 'check' }).ɵngNativeLayoutAsks;

/** Whether a key is a transition's or an animation's, as each of their declarations is kept. */
const easesBy = (key: string): boolean =>
  key.charCodeAt(0) === 36 && (key.startsWith('$transition') || key.startsWith('$animation'));

/** Whether a style, an object or a list of them, transitions or animates. Allocates nothing. */
function styleEases(style: unknown): boolean {
  if (!style || typeof style !== 'object') return false;
  if (Array.isArray(style)) return style.some(styleEases);
  for (const key in style) if (easesBy(key)) return true;
  return false;
}

/** What the declarations of a style ask for, together. */
function styleAsks(style: unknown): number {
  if (style === null || typeof style !== 'object') return 0;
  let asked = 0;
  if (Array.isArray(style)) {
    for (const each of style) asked |= styleAsks(each);
    return asked;
  }
  for (const key in style) {
    const value = (style as Record<string, unknown>)[key];
    // A number asks for nothing but by a key the engine alone reads, as in `Engine.setProp`: told
    // here without the call, as most declarations are numbers.
    if (typeof value !== 'number' || LAID_OUT_HERE.has(key)) asked |= asks(key, value);
  }
  return asked;
}

/**
 * What a declaration asks for whose value is not known until a token is. A layout of CSS's
 * where the property could be given one, whatever the token turns out to hold. A share or a
 * sum only where it is written into the declaration itself, `calc(100% - var(--gap))`: one
 * that is the token's value and nothing more is asked for by the token, in `tokenAsks`.
 */
function lateAsks(late: DeferredDeclaration): number {
  let asked = 0;
  for (const prop of late.props) {
    if (prop === 'display' || prop === 'position' || LAID_OUT_HERE.has(prop)) asked |= CSS_LAYOUT;
    if (prop.startsWith('$')) asked |= TRANSITIONS;
  }
  const text = JSON.stringify(late);
  if (text.includes('"percent"') || text.includes('%') || text.includes('calc(')) {
    asked |= SHARES;
  }
  return asked;
}

/** What a token asks for, by the value it holds: a share, a sum, or a keyword of a size. */
function tokenAsks(token: TokenValue): number {
  let asked = 0;
  if (typeof token.length === 'string') asked |= SHARES;
  const several = token.lengths ?? token.deferredLengths;
  if (several?.some((each) => typeof each !== 'number')) asked |= SHARES;
  const keyword = token.keyword;
  if (keyword !== undefined && (keyword === 'auto' || keyword.includes('content'))) {
    asked |= CSS_LAYOUT;
  }
  if (token.transform && JSON.stringify(token.transform).includes('calc(')) asked |= MIXED_SIZES;
  return asked;
}

function tokensAsk(tokens: Readonly<Record<string, TokenValue>> | undefined): number {
  let asked = 0;
  for (const name in tokens) asked |= tokenAsks(tokens[name]!);
  return asked;
}

/** What the rules of a sheet ask for, together: stopped once it is everything. */
function sheetAsks(sheet: StyleSheet): number {
  let asked = 0;
  for (const rule of sheet.rules) {
    asked |= styleAsks(rule.declarations) | styleAsks(rule.important);
    for (const late of rule.deferred ?? []) asked |= lateAsks(late);
    asked |= tokensAsk(rule.tokens);
    if (asked === EVERYTHING) return asked;
  }
  // A frame of an animation is a style too, for as long as it plays.
  for (const frames of Object.values(sheet.keyframes ?? {})) {
    for (const frame of frames) asked |= styleAsks(frame.declarations);
  }
  return asked;
}

/** The displays whose box lays out what it holds itself, as items. */
const LAYS_OUT_ITSELF = new Set(['flex', 'inline-flex', 'grid', 'inline-grid']);

/** Whether a node lays its children out along a row: a flex row, or a block's lines. */
function isRow(node: EngineNode): boolean {
  if (node.flow) return node.flow.plan.kind === 'lines';
  const direction = readStyle(node, 'flexDirection');
  return direction === 'row' || direction === 'row-reverse';
}

/**
 * Whether what a node holds has somewhere to wrap, which is what lets its content get narrower:
 * between two words of its text, or between two boxes of a line.
 */
const wraps = (node: EngineNode): boolean =>
  breaksBetweenBoxes(node) ||
  node.childList.some((child) =>
    child.nodeKind === 'text'
      ? /\S\s+\S/.test(child.nodeText)
      : child.nodeKind === 'element' && wraps(child),
  );

/** Whether a block holds a line of more than one box: all it holds, or a run among its blocks. */
function breaksBetweenBoxes(node: EngineNode): boolean {
  const flow = node.flow;
  if (!flow) return false;
  if (flow.plan.kind === 'lines') return flow.members.size > 1;
  for (const line of flow.plan.lines.values()) if (line.boxes.length > 1) return true;
  return false;
}

const isAuto = (value: unknown): boolean => value == null || value === 'auto';

/**
 * `min-width: auto` and `min-height: auto`, which a browser gives every flex item: one that
 * shrinks stops at its content. Yoga's minimum is nothing, so the item is kept from shrinking
 * where its content cannot get smaller: down a column, and along a row when no text in it has
 * anywhere to wrap. Not for an item that clips, whose minimum is nothing in a browser too.
 *
 * ponytail: an item holding text that wraps still shrinks under its longest word, and one with
 * a size or a basis of its own under its content. Both need the content measured: commit the
 * item's text a word to a line, as a grid's min-content is read, if either turns up.
 */
function autoMinimum(node: EngineNode, props: Record<string, unknown>): void {
  node.autoMin = undefined;
  const parent = node.parent;
  if (!parent || !staysInFlow(props)) return;
  const row = isRow(parent);
  if (props[row ? 'minWidth' : 'minHeight'] !== 'auto') return;
  if (!isAuto(props[row ? 'width' : 'height']) || !sizedByContent(props)) return;
  if (row) {
    node.autoMin = true;
    if (wraps(node)) return;
  }
  props['flexShrink'] = 0;
}

/**
 * The other half of `min-width: auto`: an item of a row with a share or a basis of its own,
 * `flex: 1`, which a browser stops at the narrowest its content goes. That has to be measured,
 * so the item is noted for `settleMinimums`, committed once as its content makes it, and given
 * the width that came to as its minimum from then on. Answers whether it is such an item.
 */
function shareMinimum(node: EngineNode, props: Record<string, unknown>): boolean {
  if (!sharesFromContent(node, props)) {
    node.shareMin = undefined;
    return false;
  }
  node.shareMin ??= {};
  if (node.shareOff) {
    contentSized(props);
    delete props['flexBasis'];
    props['flexShrink'] = 0;
  } else if (node.shareMin.width !== undefined) {
    props['minWidth'] = node.shareMin.width;
    sharedOut(props, node.shareMin.share);
  }
  return true;
}

/** Whether an item's minimum is its content's and it takes a share of a row: see `shareMinimum`. */
function sharesFromContent(node: EngineNode, props: Record<string, unknown>): boolean {
  const parent = node.parent;
  if (!parent || !staysInFlow(props) || !isRow(parent)) return false;
  if (props['minWidth'] !== 'auto' || !isAuto(props['width']) || sizedByContent(props))
    return false;
  return props['aspectRatio'] == null && (props['overflow'] ?? 'visible') === 'visible';
}

/**
 * Give an item the share of its line that `lineShares` worked out, as a width: Yoga hands out
 * what is left of a line after each item's minimum, where a browser hands out the whole line
 * and then holds an item to its minimum, so the two disagree wherever an item has one.
 */
function sharedOut(props: Record<string, unknown>, share: number | undefined): void {
  if (share === undefined) return;
  props['width'] = share;
  props['flexGrow'] = 0;
  delete props['flex'];
  delete props['flexBasis'];
}

/** What a row's item brings to its line: how it grows, and the least it can be. */
interface Sharer {
  readonly grow: number;
  readonly least: number;
  /** Its margins along the row, which are room no item is given. */
  readonly around: number;
}

/**
 * The widths of a row's items, each growing from nothing into a line of `room`, as CSS lays a
 * line out: the items a line holds are those whose least widths fit it, the line's room is
 * shared by how each grows, and an item that comes out under its least is held at it while the
 * rest share what is left.
 */
function lineShares(items: readonly Sharer[], room: number, gap: number, wraps: boolean): number[] {
  const widths: number[] = [];
  let line: Sharer[] = [];
  let taken = 0;
  const close = () => {
    widths.push(...sharedLine(line, room - gap * (line.length - 1)));
    line = [];
    taken = 0;
  };
  for (const item of items) {
    const needs = item.least + item.around;
    if (wraps && line.length && taken + gap + needs > room + 0.01) close();
    taken += (line.length ? gap : 0) + needs;
    line.push(item);
  }
  if (line.length) close();
  return widths;
}

function sharedLine(line: readonly Sharer[], room: number): number[] {
  const held = new Set<Sharer>();
  for (;;) {
    const free = line.filter((item) => !held.has(item));
    const left =
      room - line.reduce((sum, item) => sum + item.around + (held.has(item) ? item.least : 0), 0);
    const growth = free.reduce((sum, item) => sum + item.grow, 0);
    // Nothing left to grow: each is the least it can be.
    if (!growth) return line.map((item) => item.least);
    const under = free.filter((item) => (left * item.grow) / growth < item.least);
    if (!under.length) {
      return line.map((item) =>
        held.has(item) ? item.least : Math.max((left * item.grow) / growth, 0),
      );
    }
    for (const item of under) held.add(item);
  }
}

/** A node's margins along a row, in points: what a line has less of for it. */
function marginsAlong(node: EngineNode): number {
  const margin = (side: string) => {
    const value =
      readStyle(node, side) ?? readStyle(node, 'marginHorizontal') ?? readStyle(node, 'margin');
    return typeof value === 'number' ? value : 0;
  };
  return margin('marginLeft') + margin('marginRight');
}

const sameShare = (a: number | undefined, b: number | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && Math.abs(a - b) < 0.01);

const staysInFlow = (props: Record<string, unknown>): boolean =>
  props['position'] !== 'absolute' && props['position'] !== 'fixed';

/** No basis, share or proportion of its own, and nothing clipped: its content is its size. */
const sizedByContent = (props: Record<string, unknown>): boolean =>
  props['flex'] == null &&
  isAuto(props['flexBasis']) &&
  props['aspectRatio'] == null &&
  (props['overflow'] ?? 'visible') === 'visible';

/**
 * A box as its content makes it, while the box it is in is measured: a percentage width is of a
 * width not known yet, and a basis of nothing is what a share of that width starts from, so
 * neither says anything about how wide the content is. Nor does a share of the room left over,
 * which React Native's Yoga hands out of all the room a row could have.
 */
function contentSized(props: Record<string, unknown>): void {
  if (typeof props['width'] === 'string') delete props['width'];
  // The least it may be, as a share, is of a width not known yet either.
  if (isShare(props['minWidth'])) delete props['minWidth'];
  delete props['flex'];
  delete props['flexGrow'];
  if (isNoBasis(props['flexBasis'])) delete props['flexBasis'];
}

const isNoBasis = (value: unknown): boolean => value === 0 || value === '0%';

/** A picture with its share set aside is as wide as it is itself, as its content. */
function pictureWide(node: EngineNode, props: Record<string, unknown>): void {
  const own = node.props[INTRINSIC_SIZE] as IntrinsicSize | undefined;
  if (own && !isSet(props['width'])) props['width'] = own.width;
}

/** A length as the grid layout reads one: points with their unit, a percentage as written. */
/** A length as `layOutGrid` reads one: a sum of a share and points as `50% + -8px`. */
function cssLength(value: unknown): string | undefined {
  if (typeof value === 'number') return `${value}px`;
  if (typeof value !== 'string') return undefined;
  const sum = mixedParts(value);
  return sum ? `${sum.percent}% + ${sum.points}px` : value;
}

/** The first of these a style sets: a side, then the shorthands React Native reads it from. */
function firstOf(style: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) if (style[key] != null) return style[key];
  return undefined;
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
const AXIS = { Top: 'Vertical', Bottom: 'Vertical', Left: 'Horizontal', Right: 'Horizontal' };

/**
 * What the edges of a box take from its inside, on each side: its padding and its border, or
 * its padding alone. A padding written as a percentage is of `whole`, the width of the box it
 * is in, and nothing where that is not given.
 */
function insets(
  style: Record<string, unknown>,
  whole = 0,
  border = true,
): Record<(typeof SIDES)[number], number> {
  const points = (value: unknown) =>
    typeof value === 'number' ? value : (resolveLength(value, whole) ?? 0);
  const side = (name: (typeof SIDES)[number]) =>
    points(firstOf(style, [`padding${name}`, `padding${AXIS[name]}`, 'padding'])) +
    (border ? points(firstOf(style, [`border${name}Width`, 'borderWidth'])) : 0);
  return { Top: side('Top'), Right: side('Right'), Bottom: side('Bottom'), Left: side('Left') };
}

/** A grid container's style in the CSS terms `layOutGrid` reads. */
function gridContainerStyle(style: Record<string, unknown>): Record<string, string> {
  const css: Record<string, string | undefined> = {
    'grid-template-columns': style['gridTemplateColumns'] as string | undefined,
    'grid-template-rows': style['gridTemplateRows'] as string | undefined,
    'grid-template-areas': style['gridTemplateAreas'] as string | undefined,
    'grid-auto-columns': style['gridAutoColumns'] as string | undefined,
    'grid-auto-rows': style['gridAutoRows'] as string | undefined,
    'grid-auto-flow': style['gridAutoFlow'] as string | undefined,
    'column-gap': cssLength(style['columnGap'] ?? style['gap']),
    'row-gap': cssLength(style['rowGap'] ?? style['gap']),
    'justify-content': style['justifyContent'] as string | undefined,
    'align-content': style['alignContent'] as string | undefined,
    'justify-items': style['justifyItems'] as string | undefined,
    'align-items': style['alignItems'] as string | undefined,
    direction: style['direction'] as string | undefined,
  };
  return defined(css);
}

/** A grid item's style in the CSS terms `layOutGrid` reads. */
function gridItemStyle(style: Record<string, unknown>): Record<string, string> {
  const css: Record<string, string | undefined> = {
    'grid-column-start': style['gridColumnStart'] as string | undefined,
    'grid-column-end': style['gridColumnEnd'] as string | undefined,
    'grid-row-start': style['gridRowStart'] as string | undefined,
    'grid-row-end': style['gridRowEnd'] as string | undefined,
    'justify-self': style['justifySelf'] as string | undefined,
    'align-self': style['alignSelf'] as string | undefined,
    width: cssLength(style['width']),
    height: cssLength(style['height']),
    'min-width': cssLength(style['minWidth']),
    'max-width': cssLength(style['maxWidth']),
    'min-height': cssLength(style['minHeight']),
    'max-height': cssLength(style['maxHeight']),
    'aspect-ratio': style['aspectRatio'] == null ? undefined : String(style['aspectRatio']),
  };
  for (const side of SIDES) {
    css[`margin-${side.toLowerCase()}`] = cssLength(
      firstOf(style, [`margin${side}`, `margin${AXIS[side]}`, 'margin']),
    );
  }
  return defined(css);
}

/** A grid item as `layOutGrid` reads it: its style, and its padding and border on each axis. */
interface GridItemOf {
  style: Record<string, string>;
  frame: { width: number; height: number };
}

function gridItemOf(style: Record<string, unknown>): GridItemOf {
  const edge = insets(style);
  const css = gridItemStyle(style);
  if (style['boxSizing'] === 'content-box') css['box-sizing'] = 'content-box';
  return { style: css, frame: { width: edge.Left + edge.Right, height: edge.Top + edge.Bottom } };
}

/**
 * Whether a box in the flow is as wide as the column it is in, which stretches it: no auto
 * margin across, nothing aligning it to a side, and not in a line.
 */
function stretchedAcross(node: EngineNode, style: Record<string, unknown>): boolean {
  const parent = node.parent;
  if (!parent || OUT_OF_FLOW.has(style['position'] as string)) return false;
  if (style['display'] === 'inline-grid' || isRow(parent)) return false;
  if (style['marginLeft'] === 'auto' || style['marginRight'] === 'auto') return false;
  return parent.nodeKind !== 'element' || stretched(node, parent);
}

/** Whether an item of a grid is stretched down its area: aligned to nothing, with no auto margin. */
function stretchedDown(node: EngineNode, style: Record<string, unknown>): boolean {
  if (style['marginTop'] === 'auto' || style['marginBottom'] === 'auto') return false;
  return isAuto(style['height']) && stretched(node, node.parent!);
}

/**
 * A width a box is given by its style, in points. A share of the box it is in may be of a box
 * as wide as what it holds, which is then the grid's tracks: that is left to `gridWidth`.
 */
const ownsWidth = (width: unknown): boolean => typeof width === 'number';

/** The least and the most a box's content box may be, from the points its style writes. */
interface SizeLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

/** A box's limits as its content box's, `across` and `down` being its padding and border. */
function sizeLimits(style: Record<string, unknown>, across: number, down: number): SizeLimits {
  const off = (frame: number) => (style['boxSizing'] === 'content-box' ? 0 : frame);
  const points = (key: string, none: number, frame: number) => {
    const value = style[key];
    return typeof value === 'number' ? Math.max(value - off(frame), 0) : none;
  };
  return {
    minWidth: points('minWidth', 0, across),
    maxWidth: points('maxWidth', Infinity, across),
    minHeight: points('minHeight', 0, down),
    maxHeight: points('maxHeight', Infinity, down),
  };
}

function defined(css: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(css).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

/** A block container's plan, and the children it covers. */
interface Flow {
  readonly plan: FlowPlan<EngineNode>;
  readonly members: ReadonlySet<EngineNode>;
  /** The boxes in a line box among blocks, each named by the first box of its line. */
  readonly lined: ReadonlyMap<EngineNode, EngineNode>;
  /**
   * The room its lines need under the baseline, as `hang` works it out: of a block of lines, and
   * of each line among blocks by its first box.
   */
  under?: number;
  unders?: ReadonlyMap<EngineNode, number>;
  /** How far each box on a line sits over the bottom of it, as a margin: see `onBaseline`. */
  lifts?: ReadonlyMap<EngineNode, number>;
  /** How far each box of a known height is moved down its line, as a margin: see `liftLines`. */
  rises?: ReadonlyMap<EngineNode, number>;
  /** Whether a box of each line reaches as high as its strut, which then holds it no taller. */
  risen?: boolean;
}

/**
 * A line box as it was last committed, kept on the first box of its run. It is what its boxes
 * are committed under: a box whose line box is another view is made again, since native never
 * moves a view to another parent. No view yet, before the first commit of it.
 */
interface LineBox {
  handle: FabricNode | null;
  top: number;
  /** Where its boxes sit along it, by the `text-align` its container has: see `alongLine`. */
  along?: string;
  /** How tall its strut holds it, and the room in that under the baseline: see `lineStrut`. */
  strut?: LineStrut;
  handles: readonly FabricNode[];
  in: EngineNode;
}

/**
 * A line box: the view a run of inline-level boxes among blocks is committed in, which no node
 * of the app stands for. A row that wraps, with its boxes on the bottom of each line as empty
 * boxes sit on a baseline. It is static and takes no touch, so what is placed or pressed inside
 * it is placed against and reaches the same boxes as if it were not there.
 */
/** A line box's strut, as the props of the row it is: see `lineStrut`. */
interface LineStrut {
  minHeight: number;
  alignContent: string;
}

/**
 * The strut of a line among blocks, as `strutLine` has it for a block of lines: at least the
 * line's height, the room over the baseline and the room `under` it, which its boxes keep as
 * margins (see `hang`), on the bottom of the row the line is.
 */
function lineStrut(
  inherited: Record<string, unknown>,
  container: EngineNode,
  first: EngineNode,
  fontScale: number | undefined,
): LineStrut {
  if (risenLine(container, first)) return RISEN;
  const under = underLine(container, first);
  const above = strutOf(inherited).above * textScale(inherited, fontScale);
  return { minHeight: Math.round((above + under) * 1000) / 1000, alignContent: 'flex-end' };
}

/** Whether two plans of a block hang their lines the same: see `Engine.liftLines`. */
const sameHang = (a: Flow | undefined, b: Flow | undefined): boolean =>
  (a?.under ?? 0) === (b?.under ?? 0) &&
  sameLifts(a?.lifts, b?.lifts) &&
  sameLifts(a?.rises, b?.rises);

function sameLifts(
  a: ReadonlyMap<EngineNode, number> = NO_LIFTS,
  b: ReadonlyMap<EngineNode, number> = NO_LIFTS,
): boolean {
  if (a.size !== b.size) return false;
  for (const [box, lift] of a) if (b.get(box) !== lift) return false;
  return true;
}
const NO_LIFTS: ReadonlyMap<EngineNode, number> = new Map();

/**
 * The height of an empty box, where it is known before layout: in points, or a share of `whole`,
 * with its padding and border where those are outside it or are all it has.
 */
function knownHeight(
  style: Record<string, unknown>,
  whole: number | undefined,
): number | undefined {
  const edges = ['padding', 'paddingVertical', 'paddingTop', 'paddingBottom', 'borderWidth'];
  if (edges.some((key) => style[key] != null && typeof style[key] !== 'number')) return undefined;
  if (style['aspectRatio'] != null || style['minHeight'] != null || style['maxHeight'] != null)
    return undefined;
  const edge = insets(style);
  const frame = edge.Top + edge.Bottom;
  const height = style['height'];
  if (height == null || height === 'auto') return frame;
  const own =
    typeof height === 'number'
      ? height
      : isPercent(height) && whole !== undefined
        ? (Number.parseFloat(height as string) / 100) * whole
        : undefined;
  if (own === undefined) return undefined;
  return style['boxSizing'] === 'content-box' ? own + frame : Math.max(own, frame);
}

/** A line among blocks that a box on it holds as tall as its strut: see `Engine.riseLines`. */
const risenLine = (container: EngineNode, first: EngineNode): boolean =>
  container.flow?.plan.lines.get(first)?.boxes.some((box) => container.flow?.rises?.has(box)) ===
  true;
const RISEN: LineStrut = { minHeight: 0, alignContent: 'flex-start' };

/** The room under the baseline of a line among blocks, by its first box. */
const underLine = (container: EngineNode, first: EngineNode): number =>
  container.flow?.unders?.get(first) ?? 0;

const sameStrut = (a: LineStrut | undefined, b: LineStrut): boolean =>
  a?.minHeight === b.minHeight && a.alignContent === b.alignContent;

/**
 * Whether a fixed box is committed under its page wherever it is: on Android, whose screen and
 * root views clip each view in them to its bounds, where a fixed box draws past its own, as a
 * toaster of no height draws its toasts above itself. See `fixedHandles`.
 */
const clipsFixed = (position: unknown): boolean =>
  position === 'fixed' && nativePlatform() === 'android';

/** What the view a page's fixed boxes are committed in is: see `fixedHandles`. */
const FIXED_LAYER = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: 'box-none',
  // A view of layout alone is flattened into its parent, which is the view that clips.
  collapsable: false,
};

const LINE_BOX = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  alignContent: 'flex-start',
  position: 'static',
  pointerEvents: 'box-none',
};

/** What a flex container says about its children, which a block container does not. */
const FLEX_CONTAINER_KEYS = [
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignContent',
  'gap',
  'rowGap',
  'columnGap',
];
/** What a flex item says about itself, which a box in a block container's flow does not. */
const FLEX_ITEM_KEYS = ['flex', 'flexGrow', 'flexShrink', 'flexBasis'];

/** The shorthands React Native reads a side from when the side itself is not set. */
const FLOW_SOURCES: Readonly<Record<FlowKey, readonly string[]>> = {
  display: ['display'],
  position: ['position'],
  marginTop: ['marginTop', 'marginVertical', 'margin'],
  marginBottom: ['marginBottom', 'marginVertical', 'margin'],
  paddingTop: ['paddingTop', 'paddingVertical', 'padding'],
  paddingBottom: ['paddingBottom', 'paddingVertical', 'padding'],
  borderTopWidth: ['borderTopWidth', 'borderWidth'],
  borderBottomWidth: ['borderBottomWidth', 'borderWidth'],
  height: ['height'],
  minHeight: ['minHeight'],
  overflow: ['overflow'],
  aspectRatio: ['aspectRatio'],
};
const FLOW_PROPS = [...new Set(Object.values(FLOW_SOURCES).flat())];

/**
 * A block container and the boxes in its flow, as the flex column and items Yoga lays out.
 *
 * The container is committed as `flex`, without the flex properties a block has no use for, or
 * as a wrapping row where it holds lines of inline-blocks. A box in its flow loses the flex item
 * properties, and takes the margins the container's plan collapsed for it. See `flow.ts`.
 */
function flowLayout(
  node: EngineNode,
  props: Record<string, unknown>,
  fontScale: number | undefined,
): void {
  // Where it sits, in a line or as a block, is the plan's to say: what it holds is a flex box.
  if (props['display'] === 'inline-flex') props['display'] = 'flex';
  if (isBlockContainer(props['display'])) blockContainer(node, props, fontScale);
  const flow = flowOver(node);
  if (!flow) return;
  for (const key of FLEX_ITEM_KEYS) delete props[key];
  // A box in lines is in a line, whatever it is: an inline-block's `auto` margins are none.
  if (flow.plan.kind !== 'block') return placeInFlow(props, true, false);
  // A block fills the width, and a box in a line among blocks is as wide as its content, as an
  // item of the row its line box is. So is a block that is `fit-content`, which `fitContent` has
  // kept from stretching.
  if (!fitsWidth(node)) delete props['alignSelf'];
  // And its `auto` margins are of a browser's block, not of a flex item.
  placeInFlow(props, flow.plan.inline.has(node), fitsWidth(node));
  const margins = flow.plan.margins?.get(node);
  if (!margins) return;
  props['marginTop'] = margins.top;
  props['marginBottom'] = margins.bottom;
}

/** Where in its line a `vertical-align` sits a box, as the row the line is places an item. */
const LINE_ALIGNED: Readonly<Record<string, string>> = {
  center: 'center',
  top: 'flex-start',
  bottom: 'flex-end',
};

/**
 * `vertical-align: middle`, `top` or `bottom` on a box in a line: an arrow after a label's
 * words, which on the bottom of the line hangs under them. Text takes the keyword itself.
 *
 * ponytail: the middle of the line's height, where CSS means half an x-height over the
 * baseline. The two are a point or so apart in a line of one size of text.
 */
function alignedInLine(node: EngineNode, props: Record<string, unknown>): void {
  const where = LINE_ALIGNED[props['textAlignVertical'] as string];
  if (where === undefined || isTextElement(node)) return;
  const flow = flowOver(node);
  if (flow?.plan.kind === 'lines' || flow?.lined.has(node)) props['alignSelf'] = where;
}

/**
 * A block of a set height that clips, as the column Yoga does not squeeze the children of: it
 * measures a column's child to fit the column's height, so the words in a panel closed to no
 * height are none tall, where a block's content is as tall as it is and is clipped. A column
 * that scrolls is measured as CSS has it, and a view told it scrolls clips as one told it hides.
 *
 * ponytail: a clipped block only. One that shows its overflow squeezes its words still, and has
 * no overflow to tell Yoga of that would not clip them.
 */
function unsqueezed(props: Record<string, unknown>): void {
  if (props['overflow'] === 'hidden' && typeof props['height'] === 'number') {
    props['overflow'] = 'scroll';
  }
}

/**
 * Where `align-content` puts what a block holds along its height: a browser's button has its
 * label in the middle by it. It is the main axis of the column a block is, and of its lines
 * the cross axis of the rows they are, which is `align-content` there too.
 */
const ALONG_A_BLOCK: Readonly<Record<string, string>> = {
  center: 'center',
  end: 'flex-end',
  'flex-end': 'flex-end',
};

/** Where a `text-align` sets the boxes of a line, past its start. */
const ALONG_A_LINE: Readonly<Record<string, string>> = {
  center: 'center',
  end: 'flex-end',
  right: 'flex-end',
};

function blockContainer(
  node: EngineNode,
  props: Record<string, unknown>,
  fontScale: number | undefined,
): void {
  props['display'] = 'flex';
  const along = ALONG_A_BLOCK[props['alignContent'] as string];
  for (const key of FLEX_CONTAINER_KEYS) delete props[key];
  if (node.flow?.plan.kind !== 'lines') {
    if (along) props['justifyContent'] = along;
    return unsqueezed(props);
  }
  props['flexDirection'] = 'row';
  props['flexWrap'] = 'wrap';
  // An empty box sits on the line's baseline, which is its bottom edge.
  //
  // ponytail: and so does one with text, by its bottom edge where a browser has its text's
  // baseline. Yoga's own baseline alignment sizes a box in the line differently (a share of a
  // width inside one came to nothing), so it is not used; align by baseline if a line of text
  // beside boxes is ever seen a few points out.
  props['alignItems'] = 'flex-end';
  props['alignContent'] = along ?? 'flex-start';
  if (strutted(node, props)) strutLine(node, props, textScale(props, fontScale));
}

/**
 * A line of boxes as tall as its strut makes it: the room over the baseline and under it, the
 * one a line box is at least whatever is on it. The boxes sit on the bottom of the row, each
 * over it by the margin `hang` gives it, so the room under the baseline is inside the row's
 * content box, and the line's height is a `minHeight` of the row. Scaled as native scales a
 * line of text, by the system text size: see `lineTall`.
 */
function strutLine(node: EngineNode, props: Record<string, unknown>, scale: number): void {
  // Its boxes reach as high as the strut: see `Engine.riseLines`.
  if (node.flow?.risen) return;
  const strut = strutOf(props);
  const line = strut.above * scale + (node.flow?.under ?? strut.below * scale);
  const held = atLeastALine(props, line);
  // The line is the room its height leaves, so it is on the bottom of it, as a browser has the
  // baseline the room over it down. Not where the box is taller for another reason, as a row
  // stretches it, which a browser has the line at the top of.
  if (held && props['alignContent'] === 'flex-start' && contentTall(node, props)) {
    props['alignContent'] = 'flex-end';
  }
}

/**
 * Whether a box is as tall as what it holds, and no taller: in a column, of blocks or a flex
 * one, that does not grow it. A row stretches what is in it to its own height, and a grid to
 * its area's.
 *
 * ponytail: a row or a grid that does not stretch is counted as one that does, which leaves
 * its line at the top of the box where a browser has it a few points down.
 */
function contentTall(node: EngineNode, props: Record<string, unknown>): boolean {
  if (flowOver(node)) return true;
  if (!node.parent) return true;
  if (String(readStyle(node.parent, 'display')).includes('grid')) return false;
  const direction = readStyle(node.parent, 'flexDirection');
  if (direction === 'row' || direction === 'row-reverse') return false;
  const grow = props['flexGrow'] ?? props['flex'];
  return !(typeof grow === 'number' && grow > 0);
}

/**
 * Keep a row of boxes at least a line tall, with its padding and border, under the `max-height`
 * written and over the `min-height`, which wins over it as in CSS. Whether the line is what
 * holds it that tall, and not the `min-height`.
 *
 * ponytail: a `min-height` that is not a length is left as written, with no line under it.
 */
function atLeastALine(props: Record<string, unknown>, line: number): boolean {
  const min = props['minHeight'];
  if (min != null && min !== 'auto' && typeof min !== 'number') return false;
  const around = props['boxSizing'] === 'content-box' ? 0 : aroundALine(props);
  const max = props['maxHeight'];
  const capped = typeof max === 'number' ? Math.min(line + around, max) : line + around;
  const written = typeof min === 'number' ? min : 0;
  // To a thousandth of a point, as `lineTall` has it.
  props['minHeight'] = Math.round(Math.max(capped, written) * 1000) / 1000;
  return capped >= written;
}

/** How far under its line's baseline a style sets a box: a `vertical-align` of a length below none. */
const hungBy = (style: Readonly<Record<string, unknown>>): number => {
  const shift = style['baselineShift'];
  return typeof shift === 'number' && shift < 0 ? -shift : 0;
};

/**
 * A box on a line, over the bottom of the line by what `hang` worked out: the room under the
 * baseline, less what the box has under its own baseline, and less how far a `vertical-align`
 * length hangs it under the line's.
 *
 * ponytail: one room for a block of lines, the deepest of any of them. A line that wraps gives
 * every line the room of the deepest box: lay each line out by its own boxes if a stylesheet
 * hangs a box in a paragraph.
 */
function onBaseline(node: EngineNode, props: Record<string, unknown>): void {
  const flow = node.parent?.flow;
  const lift = flow?.lifts?.get(node) ?? 0;
  delete props['baselineShift'];
  riseOnLine(props, flow?.rises?.get(node) ?? 0);
  if (lift <= 0) return;
  const written = firstOf(props, ['marginBottom', 'marginVertical', 'margin']);
  // A share of the width has no sum with the room in Yoga: it is kept, and the room is not.
  if (typeof written === 'string' && written !== 'auto') return;
  props['marginBottom'] = (typeof written === 'number' ? written : 0) + lift;
}

/**
 * Whether a box on a line has its baseline at the bottom edge of its margin for clipping what it
 * holds: an inline-block does (CSS 2.2, 10.8.1). A flex or grid box keeps the baseline of what
 * it holds, and an element inline in a browser, a span, is no inline-block there whatever the
 * engine lays it out as: neither clips its baseline away.
 */
function clipsToEdge(
  box: EngineNode,
  style: Record<string, unknown>,
  rule: Readonly<Record<string, unknown>>,
): boolean {
  if (style['overflow'] !== 'hidden' && style['overflow'] !== 'scroll') return false;
  // Written so by a stylesheet or a binding: the engine's own default for an element inline in
  // a browser is no inline-block there.
  const own = style['display'] !== box.defaultStyle?.['display'] ? style['display'] : undefined;
  return (rule['display'] ?? own) === 'inline-block';
}

/** The boxes on a line that lay out as flex or grid, and have a baseline with nothing in them. */
const FLEX_ON_A_LINE = new Set(['inline-flex', 'inline-grid']);

/** A box's bottom margin in points, or none. */
const marginUnder = (style: Record<string, unknown>): number => {
  const margin = firstOf(style, ['marginBottom', 'marginVertical', 'margin']);
  return typeof margin === 'number' ? margin : 0;
};

/** A box of a known height moved down its line to reach as high as the strut: see `riseLines`. */
function riseOnLine(props: Record<string, unknown>, rise: number): void {
  if (rise <= 0) return;
  const top = firstOf(props, ['marginTop', 'marginVertical', 'margin']);
  props['marginTop'] = (typeof top === 'number' ? top : 0) + rise;
}

/** How far a Latin font rises over its baseline and falls under it, as a share of its size. */
const FONT_ASCENT = 0.95;
const FONT_DESCENT = 0.24;
/** The font size a view has where nothing gave it one, as React Native's text has. */
const DEFAULT_FONT_SIZE = 14;

/**
 * The room a line has over and under its baseline with no text on it to make it: a browser lays
 * a line out around a strut of the container's font, so a line of boxes that sit on the baseline
 * is the font's ascent over it and its descent under it, each with half of what its line height
 * adds. Together they are the line height, where that is a length.
 *
 * ponytail: the shares are those of the system fonts and of most Latin ones, not read from the
 * font, and the strut is around the one line, not each of several a row wraps into. Measured
 * from the font if a line of boxes is ever a point off in one that matters.
 */
function strutOf(props: Record<string, unknown>): { above: number; below: number } {
  const size = typeof props['fontSize'] === 'number' ? props['fontSize'] : DEFAULT_FONT_SIZE;
  const line = linePoints(props['lineHeight'], size);
  const leading = typeof line === 'number' ? line - (FONT_ASCENT + FONT_DESCENT) * size : 0;
  return {
    above: Math.max(leading / 2 + FONT_ASCENT * size, 0),
    below: Math.max(leading / 2 + FONT_DESCENT * size, 0),
  };
}

/**
 * A line height in points: a length, or a number under one times the font size, as an inherited
 * map hands a unitless one down (`{ multiple }`). Nothing for `normal`.
 *
 * ponytail: a number of one or more is read as `normal`. Material's table under Tailwind's
 * `line-height: 1.5` matched Chrome so and was ten boxes out read as points, which says a
 * line height Material writes in its own tokens is not reaching those boxes. Read every
 * number as points once that is found.
 */
function linePoints(line: unknown, size: number): number | undefined {
  if (typeof line === 'number') return line;
  const multiple = (line as { multiple?: unknown } | null)?.multiple;
  return typeof multiple === 'number' && multiple < 1 ? multiple * size : undefined;
}

const paddingUnder = (props: Record<string, unknown>): number => {
  const written = firstOf(props, ['paddingBottom', 'paddingVertical', 'padding']);
  return typeof written === 'number' ? written : 0;
};

/**
 * Whether a line's strut makes its box taller: where nothing else says how tall the box is, and
 * nothing on the line has text, whose own line is the same room. A height of its own says, and
 * so does an aspect ratio, which a block has its height from: its line is at the top of it.
 */
function strutted(node: EngineNode, props: Record<string, unknown>): boolean {
  const tall =
    (props['height'] != null && props['height'] !== 'auto') ||
    (isSet(props['aspectRatio']) && props['aspectRatio'] !== 'auto');
  // Between two insets an out-of-flow box is as tall as they leave it.
  const held =
    OUT_OF_FLOW.has(props['position'] as string) && isSet(props['top']) && isSet(props['bottom']);
  return !tall && !held && !holdsText(node);
}

/**
 * Whether a generated box has text for its content, a space included: nothing is seen of a
 * space, but a browser lays its line out as one with text on it, which has the room of its own
 * font.
 */
function writesText(node: EngineNode): boolean {
  if (!isGenerated(node.tag)) return false;
  const content = readStyle(node, 'content');
  return typeof content === 'string' && content !== '' && content !== 'none';
}

/** Whether there is text anywhere in what a node holds, typed into a field or written. */
function holdsText(node: EngineNode): boolean {
  return node.childList.some((child) => {
    if (child.nodeKind === 'text') return child.nodeText.trim() !== '';
    return MEASURED_VIEWS.has(viewNameOf(child)) || writesText(child) || holdsText(child);
  });
}

/**
 * The plan a node is laid out by: the one of the block container it was last in the flow of,
 * where it is still there. A container taken out of the tree is never planned again, so a node
 * moved out of one still names it, and is asked where it is now.
 */
function flowOver(node: EngineNode): Flow | undefined {
  const container = node.flowIn;
  if (!container?.flow?.members.has(node)) return undefined;
  let parent = node.parent;
  // No box of its own: its children are laid out in the node above it.
  while (parent && parent !== container && readStyle(parent, 'display') === 'contents') {
    parent = parent.parent;
  }
  return parent === container ? container.flow : undefined;
}

/** One key of a `[style]` value, an object or a list of them, without copying it. */
function styleKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (!Array.isArray(value)) return (value as Record<string, unknown>)[key];
  for (let i = value.length - 1; i >= 0; i--) {
    const found = styleKey(value[i], key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** What a node's own style says for `key`, as `ownLayout` answers it, without an allocation. */
function readStyle(node: EngineNode, key: string): unknown {
  const props = node.props;
  // Asked of most nodes more than once a commit, and most have neither of the first two.
  const over = props[STYLE_OVERRIDE];
  const inline = props['style'];
  // A style object, the usual inline style, is read here rather than through `styleKey`.
  const plain = inline !== null && typeof inline === 'object' && !Array.isArray(inline);
  return (
    (over === undefined ? undefined : styleKey(over, key)) ??
    (inline === undefined
      ? undefined
      : plain
        ? (inline as Record<string, unknown>)[key]
        : styleKey(inline, key)) ??
    props[key] ??
    node.styleCache?.style[key] ??
    node.defaultStyle?.[key]
  );
}

/** Whether a plan lays `child` out the same way in both: in the flow, with the same margins. */
function sameFlow(child: EngineNode, before: Flow, after: Flow): boolean {
  if (!before.members.has(child) || !after.members.has(child)) return false;
  if (before.lined.has(child) !== after.lined.has(child)) return false;
  const a = before.plan.margins?.get(child);
  const b = after.plan.margins?.get(child);
  return a?.top === b?.top && a?.bottom === b?.bottom;
}

/** Have merged again each child a container's new plan no longer covers. */
function leaveFlow(container: EngineNode, before: Flow | undefined, after: Flow | undefined): void {
  for (const child of before?.members ?? []) {
    if (after?.members.has(child)) continue;
    child.propsDirty = true;
    if (child.flowIn === container) child.flowIn = undefined;
  }
}

/** Have merged again each child a container's new plan covers differently, or for the first time. */
function joinFlow(container: EngineNode, before: Flow | undefined, after: Flow | undefined): void {
  if (!after) return;
  for (const child of after.members) {
    if (before && sameFlow(child, before, after)) continue;
    child.propsDirty = true;
    child.flowIn = container;
  }
}

/** The least alpha iOS sends a touch to a view at: under a hundredth it is passed over. */
const TOUCHED_ALPHA = 0.011;

/**
 * A view that takes a touch and has no opacity, committed with the least there is to be sent
 * one. A browser sends a press to an element at `opacity: 0`, which is how a see-through
 * backdrop hears a press outside a menu; iOS passes over a view it would not draw. A hundredth
 * of what the view draws is not seen.
 */
function stillTouched(props: Record<string, unknown>): Record<string, unknown> {
  // One told to take no touch is not to be sent one, seen or not.
  if (props['pointerEvents'] === 'none') return props;
  const opacity = props['opacity'];
  if (typeof opacity === 'number' && opacity < TOUCHED_ALPHA) props['opacity'] = TOUCHED_ALPHA;
  return props;
}

/** Every prop `setOwned` can set, as a payload that changes them all. */
const RESET_OWNED: Readonly<Record<string, unknown>> = { opacity: undefined, transform: undefined };

/** As Animated does: a view native sets values on is kept, or there is no view to set them on. */
function keptForNative(node: EngineNode, props: Record<string, unknown>): void {
  if (node.owned && props['collapsable'] === undefined) props['collapsable'] = false;
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

/**
 * `height: 50%` under a parent with no height to take it of, which CSS reads as `auto`. Yoga
 * takes it of the space on offer, the screen's or everything a scroll view holds, so no height
 * is sent. A `min-height: 50%` there is none either, where Yoga takes it of the screen too.
 */
function percentHeight(node: EngineNode, props: Record<string, unknown>): void {
  const height = isPercent(props['height']);
  const least = isPercent(props['minHeight']);
  if (!height && !least) return;
  // Out of the flow, it is of the box that holds it, which is laid out first and has a height.
  if (props['position'] === 'absolute') return;
  const parent = layoutParent(node);
  if (!parent) return;
  if (least && parent.heldAt) heldLeast(props, parent.heldAt.inner);
  // On a line among blocks, the line box Yoga takes it of is not the block it is a share of.
  if (height && onLineAmongBlocks(node)) return linedShare(parent, props);
  if (definiteHeight(parent)) return;
  if (height) delete props['height'];
  if (least) delete props['minHeight'];
}

const onLineAmongBlocks = (node: EngineNode): boolean => flowOver(node)?.lined.has(node) === true;

/**
 * A gap down a flex container that is a share of its height, as CSS has it: none where the
 * container has no height to share, as tall as its content, where Yoga takes it of the room on
 * offer. A grid works out its own gaps, and a block has none.
 */
function percentGap(node: EngineNode, props: Record<string, unknown>): void {
  if (!isPercent(props['rowGap']) || node.grid !== undefined || node.flow !== undefined) return;
  if (!definiteHeight(node)) props['rowGap'] = 0;
}

/**
 * A share of the height of a block, on a line among its blocks, as what it comes to: of the
 * block's content box, where the block is held at its content's height or has a height in
 * points of its own, and no height where it has none to share. See `Engine.settleHeld`.
 */
function linedShare(parent: EngineNode, props: Record<string, unknown>): void {
  const whole = blockContentHeight(parent);
  if (whole === undefined) delete props['height'];
  else props['height'] = (Number.parseFloat(props['height'] as string) / 100) * whole;
}

/** The height of a block's content box, where it is known before its layout: see `linedShare`. */
function blockContentHeight(node: EngineNode): number | undefined {
  if (node.heldAt) return node.heldAt.inner;
  const height = ownLayout(node, 'height');
  if (typeof height !== 'number') return undefined;
  if (readStyle(node, 'boxSizing') === 'content-box') return height;
  const edge = insets(node.committed?.props ?? {});
  return Math.max(height - edge.Top - edge.Bottom, 0);
}

/**
 * A least height that is a share of a box held at its content's height, as what it comes to:
 * Yoga takes one down a column as a share of the box above that one. See `Engine.settleHeld`.
 *
 * ponytail: under a held box. One under a box with a height of its own is left to Yoga, which
 * has the same error there; commit it so too if a stylesheet is seen to need it.
 */
function heldLeast(props: Record<string, unknown>, inner: number): void {
  props['minHeight'] = (Number.parseFloat(props['minHeight'] as string) / 100) * inner;
}

/** Whether a box's height is a percentage of a box that has no height of its own to share. */
function sharesNoHeight(node: EngineNode, style: Record<string, unknown>): boolean {
  if (!isPercent(style['height']) || style['position'] === 'absolute') return false;
  const parent = layoutParent(node);
  return parent != null && !definiteHeight(parent);
}

/** Whether a grid has a height of its own, and not its rows': written, and of something. */
const ownsHeight = (node: EngineNode, style: Record<string, unknown>): boolean =>
  !NO_HEIGHT.has(style['height'] as string) && !sharesNoHeight(node, style);

/**
 * What a grid was laid out from, to tell when it is to be laid out again: its own style, and
 * whether its height was a share of a box with none, which is no style of its own.
 */
const gridKey = (node: EngineNode, style: Record<string, unknown>): string =>
  asAKey(style) + (sharesNoHeight(node, style) ? ' of no height' : '');

const INLINE_ROWS = new Set(['inline-flex', 'inline-block', 'inline-grid']);

/**
 * `flex-basis: 50%` in a box that is as wide as its content, or in a column as tall as its
 * content, which CSS reads as the item's own content: there is no size yet to take a share of. Yoga takes it of nothing, so the item is
 * as narrow as it can be made, and a chip's words wrap. No basis is sent.
 *
 * ponytail: a box in a line with no width of its own, or a row that is `fit-content` or capped
 * at its content. One sized by its content some other way, a grid track say, is left to Yoga;
 * name it here if one comes up.
 */
function percentBasis(node: EngineNode, props: Record<string, unknown>): void {
  if (!isPercent(props['flexBasis'])) return;
  const parent = layoutParent(node);
  if (!parent) return;
  // Down a column as tall as what it holds, the share is of a height that is the content's own,
  // for a box with CSS's automatic minimum: an HTML element. A native view has none, and a
  // scroll view that shares a column with no height is no taller than nothing, as it was.
  if (!isRow(parent)) {
    if (props['minHeight'] === 'auto' && !definiteHeight(parent)) delete props['flexBasis'];
    return;
  }
  if (fitsWidth(parent)) delete props['flexBasis'];
  // Only where it sits in a line: an item of a flex container is as wide as that makes it.
  else if (INLINE_ROWS.has(readStyle(parent, 'display') as string) && inALine(parent)) {
    const width = readStyle(parent, 'width');
    if (width == null || width === 'auto') delete props['flexBasis'];
  }
}

/**
 * Whether a box is written to be as wide as its content: `width: fit-content`, or a cap at its
 * content on a width that would otherwise fill what holds it (`capAtContent`).
 */
function fitsWidth(node: EngineNode): boolean {
  const width = readStyle(node, 'width');
  if (width === 'fit-content') return true;
  if (readStyle(node, 'maxWidth') !== 'max-content') return false;
  return width == null || width === 'auto' || isPercent(width);
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

/** The props of a run of text that change how tall its line is drawn. */
const SIZES_A_RUN = new Set(['style', 'allowFontScaling', 'maxFontSizeMultiplier']);

/**
 * Keep a paragraph as tall as one of its lines, as a browser's line box is whatever holds it.
 * Yoga measures an item no taller than the room inside its container, and the text view cuts
 * its letters off there: a 24 point line in a row with 16 points between its paddings. The
 * line is the paragraph's own or a taller one of a run in it, `run`, which is scaled already. With it goes what is
 * around the text and inside the height Yoga gives a view, its padding and border above and
 * below, but for a content box. Only where a line height is a length, and nothing gives the
 * paragraph a height of its own.
 *
 * The line is as the system text size draws it: native scales a line height with the text, so
 * a line held to its points at a smaller size is shorter than its box and sits at the top of
 * it, over what a row centres it beside.
 */
function lineTall(
  props: Record<string, unknown>,
  run: number,
  fontScale: number | undefined,
): void {
  const own = props['lineHeight'];
  const line = Math.max(typeof own === 'number' ? own * textScale(props, fontScale) : 0, run);
  if (line <= 0) return;
  const unset = (value: unknown): boolean => value == null || value === 'auto';
  if (!unset(props['height']) || !unset(props['minHeight'])) return;
  const around = props['boxSizing'] === 'content-box' ? 0 : aroundALine(props);
  // To a thousandth of a point: a product of two fractions is rarely the number it reads as.
  props['minHeight'] = Math.round((line + around) * 1000) / 1000;
}

/** The points of padding and border above and below a view's content, where each is a length. */
function aroundALine(props: Record<string, unknown>): number {
  return around(props, 'Height');
}

/**
 * The props each side's padding and border are read from, across a height and across a width,
 * the first set winning, as React Native and then Yoga read them: an alias of React Native's over
 * Yoga's own, a logical side over the physical one, and the start on the left unless the box is
 * right to left. A block's start and end are under the top and bottom.
 */
function sides(props: Record<string, unknown>, size: 'Height' | 'Width'): string[][] {
  if (size === 'Height') {
    const block = ['paddingBlock', 'paddingVertical', 'padding'];
    return [
      ['paddingTop', 'paddingBlockStart', ...block],
      ['borderTopWidth', 'borderWidth'],
      ['paddingBottom', 'paddingBlockEnd', ...block],
      ['borderBottomWidth', 'borderWidth'],
    ];
  }
  const rtl = props['direction'] === 'rtl';
  const inline = ['paddingInline', 'paddingHorizontal', 'padding'];
  return (['Left', 'Right'] as const).flatMap((physical, at) => {
    const logical = (at === 0) !== rtl ? 'Start' : 'End';
    return [
      [`paddingInline${logical}`, `padding${logical}`, `padding${physical}`, ...inline],
      [`border${logical}Width`, `border${physical}Width`, 'borderWidth'],
    ];
  });
}

/** The points of padding and border across a view's height or width, where each is a length. */
function around(props: Record<string, unknown>, size: 'Height' | 'Width'): number {
  let total = 0;
  for (const keys of sides(props, size)) {
    const found = keys.map((key) => props[key]).find((value) => value != null);
    if (typeof found === 'number') total += found;
  }
  return total;
}

/** The most and the least of each size, by name: asked of every node merged. */
const MOST = { Height: 'maxHeight', Width: 'maxWidth' } as const;
const LEAST = { Height: 'minHeight', Width: 'minWidth' } as const;

/**
 * A most size under the least: under a `min-height`, or a border box's padding and border, which
 * CSS lets win (CSS 2.2, 10.7). React Native's Yoga holds the box to its most, and the box around
 * it to that, so the most is raised to the least. A most and a least in points: a share on either
 * side is left to Yoga.
 */
function leastWins(props: Record<string, unknown>, size: 'Height' | 'Width'): void {
  const most = props[MOST[size]];
  if (typeof most !== 'number') return;
  const written = props[LEAST[size]];
  let least = typeof written === 'number' ? written : 0;
  if (props['boxSizing'] !== 'content-box') least = Math.max(least, around(props, size));
  if (most < least) props[MOST[size]] = least;
}

/**
 * Where a line may break: at a space, after a hyphen, and anywhere in a script written without
 * spaces. A soft hyphen and a zero-width space are places to break that draw nothing.
 */
const BREAKS = /[\s\-\u00ad\u200b\u2010\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;

/** Whether a paragraph's text, all its runs together, is one word: something, with no break. */
function unbroken(node: EngineNode): boolean {
  let text = '';
  const collect = (from: EngineNode): void => {
    for (const child of from.childList) {
      if (child.nodeKind === 'text') text += child.nodeText;
      else if (isTextElement(child)) collect(child);
    }
  };
  collect(node);
  const words = trimEnds(text);
  return words !== '' && !BREAKS.test(words);
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
 * The views that hold a page: what `position: fixed` is pinned to, where a browser pins it to
 * the viewport. A screen of a native stack stays mounted under the one pushed over it, so a box
 * fixed to the root would stay on top of every screen after its own.
 */
/**
 * A screen's `gestureResponseDistance` that no touch is within: how far from each edge a swipe
 * back may start, with -1 for no limit, and none at all from the leading edge. It is what
 * `react-native-screens` reads as the swipe is about to begin; whether the swipe is enabled it
 * read when the finger came down, before anything here had heard of the touch.
 */
const NO_SWIPE = Object.freeze({ start: -1, end: 0, top: -1, bottom: -1 });

/**
 * What a box clipped to nothing is committed with: `clip: rect(0 0 0 0)`, how a library hides
 * what is for a screen reader alone. A view is clipped to no smaller than itself, its shadow is
 * drawn outside it and a minimum size is over the pixel it is given, so each of those is taken
 * away, as is a border or outline drawn around it. It keeps its opacity: a view with none is not
 * read out, which is all this one is for.
 */
const CLIPPED_AWAY = {
  boxShadow: [],
  backgroundColor: 'rgba(0, 0, 0, 0)',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  ...Object.fromEntries(
    ['', 'Top', 'Right', 'Bottom', 'Left', 'Start', 'End'].map((side) => [`border${side}Width`, 0]),
  ),
  outlineWidth: 0,
};

/** What a box that is `visibility: hidden` is committed with: there, and not seen or touched. */
const UNSEEN = Object.freeze({ opacity: 0, pointerEvents: 'none' });

/** What a box is seen as, of what only a sheet read as a browser reads it says. */
function seenByCss(merged: Record<string, unknown>): void {
  // `visibility`: a hidden box keeps its room and is not seen or touched, and nothing of a
  // native view is called visibility.
  if (merged['visibility'] !== undefined) {
    if (merged['visibility'] === 'hidden') Object.assign(merged, UNSEEN);
    delete merged['visibility'];
  }
  // A box such a sheet clips to nothing: see `CLIPPED_AWAY`.
  if (merged['clipped'] !== undefined) {
    delete merged['clipped'];
    Object.assign(merged, CLIPPED_AWAY);
  }
}

/** A screen of a native stack, which is what the swipe back is a gesture of. */
const STACK_SCREEN = 'RNSScreen';

const FIXED_BOUNDARIES = new Set([MODAL_HOST, STACK_SCREEN, 'RNSFullWindowOverlay']);

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
    const said = up.nodeKind === 'element' ? touchActionOf(up) : undefined;
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

interface ViewNameRegistration {
  readonly viewName: string | PlatformViewName;
  readonly yielding: boolean;
  /** What it says of the native view, said again when a later registration is taken away. */
  readonly defaultProps: Record<string, unknown> | undefined;
  readonly options: ViewNameOptions | undefined;
}

/**
 * What each element name was before it was first registered, and its registrations, oldest
 * first: two packages can register one name and be taken away in either order.
 */
const registrations = new Map<
  string,
  {
    original: { viewName?: string | PlatformViewName; yielding: boolean; text: boolean };
    stack: ViewNameRegistration[];
  }
>();

function nameView(elementName: string, { viewName, yielding }: ViewNameRegistration): void {
  VIEW_NAMES[elementName] = viewName;
  if (yielding) YIELDING.add(elementName);
  else YIELDING.delete(elementName);
  // A name the app registers is the app's: no longer decided by what the element holds.
  TEXT_ELEMENTS.delete(elementName);
}

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
): () => void {
  const entry = registrations.get(elementName) ?? {
    original: {
      viewName: VIEW_NAMES[elementName],
      yielding: YIELDING.has(elementName),
      text: TEXT_ELEMENTS.has(elementName),
    },
    stack: [],
  };
  const registration = {
    viewName,
    yielding: options?.yieldsToComponents === true,
    defaultProps,
    options,
  };
  entry.stack.push(registration);
  registrations.set(elementName, entry);
  nameView(elementName, registration);
  describeViews(elementName, registration);
  // Takes this registration away, for a package that registers a name for as long as an app that
  // asked for it is up. The newest one still there names the element and says again what it said
  // of the native view, which this one may have cleared, and what the element was before any
  // comes back after the last. The native view's own defaults and text prop stay after the last:
  // they are the view's, whichever element names it.
  return () => {
    const index = entry.stack.indexOf(registration);
    if (index === -1) return;
    entry.stack.splice(index, 1);
    const top = entry.stack.at(-1);
    if (top) {
      nameView(elementName, top);
      return describeViews(elementName, top);
    }
    registrations.delete(elementName);
    const { original } = entry;
    if (original.viewName === undefined) delete VIEW_NAMES[elementName];
    else VIEW_NAMES[elementName] = original.viewName;
    if (original.yielding) YIELDING.add(elementName);
    else YIELDING.delete(elementName);
    if (original.text) TEXT_ELEMENTS.add(elementName);
    SPACED_TEXT.delete(elementName);
  };
}

/** Note what a registration says of each native view it names, and of the element. */
function describeViews(
  elementName: string,
  { viewName, defaultProps, options }: ViewNameRegistration,
): void {
  for (const name of typeof viewName === 'string' ? [viewName] : [viewName.ios, viewName.android]) {
    describeView(name, defaultProps, options);
  }
  // The element's, not the view's: another element may name the same view without it.
  if (options?.spacedText) SPACED_TEXT.add(elementName);
  else SPACED_TEXT.delete(elementName);
}

/** Note what a registration says of a native view: see `ViewNameOptions`. */
function describeView(
  name: string,
  defaultProps: Record<string, unknown> | undefined,
  options: ViewNameOptions | undefined,
): void {
  if (defaultProps) DEFAULT_PROPS[name] = defaultProps;
  if (options?.textContent) TEXT_CONTENT_PROPS[name] = options.textContent;
  if (options?.looseText) LOOSE_TEXT[name] = options.looseText;
  else delete LOOSE_TEXT[name];
  if (options?.fontNames) FONT_NAMES[name] = options.fontNames;
  else delete FONT_NAMES[name];
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
  /**
   * The element a run of text written straight into the view is drawn by, where that is not a
   * paragraph: an SVG text draws its words by a span, which is no child a template wrote. The
   * element is the engine's own, as the paragraph a view is given for its loose text is.
   */
  readonly looseText?: string;
  /**
   * Whether the text content it takes as a prop keeps its spaces, as a span of an SVG text does:
   * a run of them is one space, dropped only before the first words of what it is in and after
   * the last, since the next span's words follow on the same line.
   */
  readonly spacedText?: boolean;
  /**
   * Where a view's own props name a font that must reach native by another name, as SwiftUI's
   * `font` modifier must name a face by its file's PostScript name: rewrites `props` in place,
   * given that name for each name the app's `@font-face` faces are registered under. Called on
   * every commit of the view, and again for each view when the faces change.
   */
  readonly fontNames?: (props: Record<string, unknown>, postScriptName: PostScriptNames) => void;
}

/** The PostScript name of the face a name is registered under, where the build read it. */
export type PostScriptNames = (name: string) => string | undefined;

/** How each view that names fonts in its own props rewrites them. See `ViewNameOptions`. */
const FONT_NAMES: Record<string, NonNullable<ViewNameOptions['fontNames']>> = {};

/** Rewrites the fonts a view's own props name, for a view that says how. See `ViewNameOptions`. */
function renameFonts(
  viewName: string,
  props: Record<string, unknown>,
  postScriptName: PostScriptNames,
): void {
  FONT_NAMES[viewName]?.(props, postScriptName);
}

/** The elements whose text content keeps its spaces. See `ViewNameOptions`. */
const SPACED_TEXT = new Set<string>();
/** Whether a view may hold spans that keep their spaces: one its loose words are drawn by. */
const SPACED_PARENT = (node: EngineNode): boolean =>
  SPACED_TEXT.has(node.tag) || LOOSE_TEXT[viewNameOf(node)] !== undefined;

/** The element loose text in a view is drawn by, for the views that say. See `ViewNameOptions`. */
const LOOSE_TEXT: Record<string, string> = {};

/** The registered names that give way to a component's own host. See `ViewNameOptions`. */
const YIELDING = new Set<string>();

/** The prop each view that takes its text content as a prop reads it from. See `ViewNameOptions`. */
const TEXT_CONTENT_PROPS: Record<string, string> = {};

/** Whether `node` takes its text content as a prop rather than as text children. */
function takesTextAsProp(node: EngineNode): boolean {
  return node.nodeKind === 'element' && TEXT_CONTENT_PROPS[viewNameOf(node)] !== undefined;
}

/** Sets a view's text prop from its content, unless the prop is set explicitly. */
function withTextContent(node: EngineNode, viewName: string, props: Record<string, unknown>): void {
  const prop = TEXT_CONTENT_PROPS[viewName];
  if (!prop || node.props[prop] !== undefined) return;
  const text = SPACED_TEXT.has(node.tag) ? spacedContent(node) : textContent(node);
  if (text) props[prop] = text;
}

/**
 * The text of a view that keeps its spaces: each run of them one space, and none before the
 * first words of what it is in or after the last.
 */
function spacedContent(node: EngineNode): string {
  const own = node.childList
    .map((child) => (child.nodeKind === 'text' ? child.nodeText : ''))
    .join('')
    .replace(/[ \t\n\r\f]+/g, ' ');
  // The box the engine draws loose words by is in their place, which is the words' own.
  const self = node.anonymous ? (node.childList[0] ?? node) : node;
  const siblings = self.parent?.childList ?? [];
  const at = siblings.indexOf(self);
  const worded = (each: EngineNode) =>
    each.nodeKind === 'element' || (each.nodeKind === 'text' && !!trimEnds(each.nodeText));
  const first = !siblings.slice(0, at).some(worded);
  const last = !siblings.slice(at + 1).some(worded);
  return (last ? trimEnd : (text: string) => text)(first ? trimStart(own) : own);
}

/**
 * The whitespace a paragraph drops at its ends is what CSS collapses: spaces, tabs and line
 * breaks. A no-break space is text, as in a browser, so `&nbsp;` is how a value keeps a space at
 * its end; `String.prototype.trim` would take that too.
 */
const trimStart = (text: string): string => text.replace(/^[ \t\n\r\f]+/, '');
const trimEnd = (text: string): string => text.replace(/[ \t\n\r\f]+$/, '');
const trimEnds = (text: string): string => trimEnd(trimStart(text));

const NO_BREAK_SPACE = '\u00a0';

/**
 * A run of text as the words of a line, each with the space after it: a no-break space, which a
 * paragraph draws at its end where it drops any other. The run's own first and last space are
 * kept where something on the line is before or after it.
 *
 * ponytail: the space is part of the word, so a word that ends its line is a space wider than a
 * browser has it, and wraps that much sooner.
 */
function wordsOf(run: string, leads: boolean, trails: boolean): string[] {
  const words = run.split(/[ \t\n\r\f]+/).filter((word) => word !== '');
  if (!words.length) return words;
  const last = words.length - 1;
  const spaced = words.map((word, at) => (at < last ? word + NO_BREAK_SPACE : word));
  if (leads && trimStart(run) !== run) spaced[0] = NO_BREAK_SPACE + spaced[0];
  if (trails && trimEnd(run) !== run) spaced[last] += NO_BREAK_SPACE;
  return spaced;
}

/**
 * How a paragraph is truncated, which native does by its props: one the engine made around a
 * view's own words is truncated as the view says, as a browser truncates a block's own text.
 */
const TRUNCATION = ['numberOfLines', 'ellipsizeMode'] as const;

/**
 * The truncation each paragraph made around a view's words was merged with, as the view said it.
 * Not what it was committed with, which has the paragraph's own defaults in it.
 */
const truncatedBy = new WeakMap<EngineNode, readonly unknown[]>();

/** What a view says of how its own words are truncated. */
const truncationOf = (parent: EngineNode): unknown[] =>
  TRUNCATION.map((key) => ownLayout(parent, key) ?? null);

/** Whether a paragraph made around a view's words is truncated other than the view now says. */
function truncationMoved(box: EngineNode, parent: EngineNode): boolean {
  const merged = truncatedBy.get(box);
  if (!merged) return false;
  return truncationOf(parent).some((said, at) => said !== merged[at]);
}

function truncatedAs(box: EngineNode, props: Record<string, unknown>): void {
  if (!box.anonymous || !box.parent) return;
  const said = truncationOf(box.parent);
  truncatedBy.set(box, said);
  TRUNCATION.forEach((key, at) => {
    if (said[at] !== null) props[key] = said[at];
  });
}

/**
 * Whether the words in a box are each placed on its line: a line of words and boxes, where a box
 * is an element. Beside only the boxes a rule generates, a library's struts, the words are the
 * one paragraph: nothing is placed after them, and a paragraph is one view for all of them.
 */
const wordedLine = (node: EngineNode): boolean =>
  node.flow?.plan.kind === 'lines' &&
  node.childList.some((child) => child.nodeKind === 'element' && !isGenerated(child.tag));

/** The paragraphs the engine made for a run of text written straight into a view. */
const paragraphsOf = (text: EngineNode): readonly EngineNode[] =>
  text.box ? [text.box] : (text.words ?? NO_WORDS);
const NO_WORDS: readonly EngineNode[] = [];

/**
 * The text written inside a view that takes it as a prop: every run joined, with the whitespace at
 * the two ends dropped as a paragraph drops it, and kept inside. A nested view is drawn after the
 * text, as SwiftUI's `Text` through `@expo/ui` draws a child `Text`, so the space before it stays.
 */
function textContent(node: EngineNode): string {
  let text = '';
  let nested = false;
  for (const child of node.childList) {
    if (child.nodeKind === 'text') text += child.nodeText;
    else if (child.nodeKind === 'element') nested = true;
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
export function registeredViewName(elementName: string): string | undefined {
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
  return node.childList.some((child) => namesFamily(child, families));
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

/**
 * Android's horizontal scroll view and the view that holds its content. RN's `ScrollView.js`
 * commits them in place of `ScrollView` and its plain content view when `horizontal` is set, and
 * the vertical view ignores `horizontal`. See `viewNameOf` and `committedViewName`.
 */
const HORIZONTAL_SCROLL = 'AndroidHorizontalScrollView';
const HORIZONTAL_CONTENT = 'AndroidHorizontalScrollContentView';

/** The views that scroll their content, which `focus` brings a field into view within. */
const SCROLL_VIEWS = new Set(['ScrollView', HORIZONTAL_SCROLL]);

/** Element name -> the element name of the ancestor it commits into. See `registerHoist`. */
const HOISTS: Record<string, string> = {};
/** The `ancestorName`s, so a commit asks only those nodes what to hoist into them. */
const HOIST_TARGETS = new Set<string>();
/** The `ancestorName`s that commit only what is hoisted into them. See `HoistOptions.only`. */
const HOIST_ONLY = new Set<string>();
/** Element name -> the ancestor names it never hoists past. See `HoistOptions.stopAt`. */
const HOIST_STOPS: Record<string, ReadonlySet<string>> = {};
/** Element name -> its registrations, the newest last, which is the one in effect. */
const HOIST_REGISTRATIONS = new Map<string, HoistRegistration[]>();

interface HoistRegistration {
  readonly ancestorName: string;
  readonly options: HoistOptions;
}

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
 *
 * Answers what takes the registration away again, for a package that can be taken out.
 */
export function registerHoist(
  elementName: string,
  ancestorName: string,
  options: HoistOptions = {},
): () => void {
  const registration = { ancestorName, options };
  const stack = HOIST_REGISTRATIONS.get(elementName) ?? [];
  stack.push(registration);
  HOIST_REGISTRATIONS.set(elementName, stack);
  hoistAs(elementName, registration);
  return () => {
    const index = stack.indexOf(registration);
    if (index === -1) return;
    stack.splice(index, 1);
    // Registered again since, the later registration stays the one that counts.
    if (index < stack.length) return;
    if (stack.length === 0) HOIST_REGISTRATIONS.delete(elementName);
    hoistAs(elementName, stack.at(-1));
  };
}

/** Hoist an element as a registration says, or not at all, and note again what each ancestor is. */
function hoistAs(elementName: string, registration: HoistRegistration | undefined): void {
  const { ancestorName, options } = registration ?? { ancestorName: undefined, options: {} };
  if (ancestorName === undefined) delete HOISTS[elementName];
  else HOISTS[elementName] = ancestorName;
  if (options.standIn) STAND_INS[elementName] = options.standIn;
  else delete STAND_INS[elementName];
  if (options.stopAt) HOIST_STOPS[elementName] = new Set(options.stopAt);
  else delete HOIST_STOPS[elementName];
  // An ancestor no registration in effect names any more is an ordinary view again.
  HOIST_TARGETS.clear();
  HOIST_ONLY.clear();
  for (const all of HOIST_REGISTRATIONS.values()) {
    const current = all.at(-1)!;
    HOIST_TARGETS.add(current.ancestorName);
    if (current.options.only) HOIST_ONLY.add(current.ancestorName);
  }
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
  /**
   * Have the ancestor commit the elements hoisted into it and nothing else, in the order they
   * were written.
   *
   * For a native component that takes children of one type only. `RNSScreenStackHeaderConfig`
   * takes `RNSScreenStackHeaderSubview`s: iOS logs an error and drops any other child, and Android
   * throws. A header item written inside a component of the header reached it inside that
   * component's host view.
   */
  only?: boolean;

  /**
   * Ancestor names the element never hoists past: met before the ancestor it commits into, it
   * commits where it is, as one with no such ancestor does.
   *
   * For an ancestor the target is not meant to reach through. A tab's page with no stack of its
   * own has no screen of its own, and the screen above its tab is the one that holds the whole
   * tab bar, so a header written in that page must not configure it.
   */
  stopAt?: readonly string[];
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
  if (root === null || !isTextElement(root))
    return node.box ? trimEnds(node.nodeText) : node.nodeText;
  // A text element a view stands in for, which places what it holds: no paragraph runs past it.
  const inParagraph = (above: EngineNode | null) =>
    isTextElement(above) && !aligningText(above as EngineNode);
  // The commonest paragraph by far: one run and nothing else, so it is both the first and last.
  if (root.childList.length === 1 && !inParagraph(root.parent)) return trimEnds(node.nodeText);
  while (inParagraph(root.parent)) root = root.parent!;
  const runs: EngineNode[] = [];
  const collect = (from: EngineNode) => {
    for (const child of from.childList) {
      if (child.nodeKind === 'text') {
        if (child.nodeText) runs.push(child);
      } else if (isTextElement(child)) collect(child);
    }
  };
  collect(root);
  let text = node.nodeText;
  if (runs[0] === node) text = trimStart(text);
  if (runs[runs.length - 1] === node) text = trimEnd(text);
  return text;
}

/** The part of a node `viewNameOf` reads: an engine node, or any host's mirror of one. */
export interface ViewNameNode {
  readonly nodeKind: string;
  readonly tag: string;
  readonly parent: ViewNameNode | null;
  /** Whether a component is mounted on it, and whether that component is the native view. */
  readonly componentHost?: boolean;
  readonly nativeView?: boolean;
  /** What it holds, which decides whether one of HTML's text elements is text or a view. */
  readonly childList?: readonly ViewNameNode[];
  /** Set on the paragraph the engine makes for a run of text written straight into a view. */
  readonly anonymous?: boolean;
  /** Set on a text element that lays out what it holds itself: see `Engine.settleBoxed`. */
  readonly boxed?: boolean;
  /** Its props, of which `horizontal` decides which scroll view a scroll view is on Android. */
  readonly props?: Readonly<Record<string, unknown>>;
}

/**
 * Whether an element is text: a `<text>`, or one of HTML's text elements that holds only text and
 * other such elements. Worked out each time, from the tree as it is, so nothing can go stale.
 */
function isTextElement(node: ViewNameNode | null): boolean {
  if (node === null || node.nodeKind !== 'element') return false;
  if (node.tag === 'text') return true;
  // One lookup settles nearly every other element, which is a view.
  if (registeredViewName(node.tag) !== PARAGRAPH || node.boxed) return false;
  return !TEXT_ELEMENTS.has(node.tag) || holdsOnlyText(node);
}

/** Whether a text element holds text and nothing else. One that holds nothing holds no text. */
function holdsOnlyText(node: ViewNameNode): boolean {
  const children = node.childList ?? [];
  for (const child of children) {
    if (child.nodeKind === 'element' && !isTextElement(child)) return false;
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
 * span, which is then the item placed. So is a column of text elements, each an item under the
 * last. A `<text>` is a paragraph whatever its style, and any other element holding more than
 * the one run is left as it was.
 */
function aligningText(node: EngineNode): boolean {
  if (node.nodeKind !== 'element' || node.tag === 'text' || !TEXT_ELEMENTS.has(node.tag)) {
    return false;
  }
  const stacked = stacksRuns(node);
  if (!stacked && (node.childList.length !== 1 || !oneRun(node.childList[0]!))) return false;
  // Under a text element it is a span of that paragraph, unless that one is a view placing it.
  if (isTextElement(node.parent) && !aligningText(node.parent as EngineNode)) return false;
  return placesByFlex(node, stacked);
}

/** Whether a flex container's own style places the run it holds, or stacks the runs it holds. */
function placesByFlex(node: EngineNode, stacked: boolean): boolean {
  const display = ownLayout(node, 'display');
  if (display !== 'flex' && display !== 'inline-flex') return false;
  // A column of them: each a line of its own, where one paragraph would run them on.
  if (stacked) return String(ownLayout(node, 'flexDirection') ?? 'column').startsWith('column');
  return (
    ALIGNS.has(ownLayout(node, 'alignItems') as string) ||
    ALIGNS.has(ownLayout(node, 'justifyContent') as string)
  );
}

/**
 * Whether a text element holds two or more text elements and nothing else but whitespace and
 * the anchors control flow leaves: a label around a name and a hint, which a flex column has one under the other.
 */
function stacksRuns(node: EngineNode): boolean {
  let runs = 0;
  for (const child of node.childList) {
    if (child.nodeKind === 'element' && TEXT_ELEMENTS.has(child.tag)) runs++;
    else if (child.nodeKind === 'text' ? trimEnds(child.nodeText) : child.nodeKind !== 'anchor')
      return false;
  }
  return runs > 1;
}

/** One run of text to place: text itself, or a text element around some, a label in a span. */
const oneRun = (child: EngineNode): boolean =>
  child.nodeKind === 'text' || (child.nodeKind === 'element' && TEXT_ELEMENTS.has(child.tag));

/**
 * The view a node is committed as: `viewNameOf`, but for a text element that aligns its text, and
 * for the content view of a horizontal scroll view on Android, which RN commits as a view of its
 * own. That one is a plain view in every other respect, so only the commit names it: a scroll
 * view changing axis is made again with everything in it (see `forgetRenamed`), and a view moved
 * into or out of one is too (see `reconcileUnder`), so the name cannot go stale on a clone.
 */
function committedViewName(node: EngineNode): string {
  if (node.scrollView) return registeredViewName('scroll-view') ?? 'ScrollView';
  if (aligningText(node)) return DEFAULT_VIEW;
  const name = viewNameOf(node);
  return name === DEFAULT_VIEW && platformOS === 'android' && holdsContentOf(node.parent)
    ? HORIZONTAL_CONTENT
    : name;
}

/**
 * The nearest scroll view a node is in that scrolls up and down: a sideways carousel on a page
 * is not what moves a field clear of the bottom of the screen.
 */
function scrollingDown(node: EngineNode): EngineNode | null {
  let scroll = node.parent;
  while (
    scroll &&
    !(SCROLL_VIEWS.has(committedViewName(scroll)) && scroll.props['horizontal'] !== true)
  ) {
    scroll = scroll.parent;
  }
  return scroll;
}

/** Whether a node is a horizontal scroll view, whose children hold its content. */
const holdsContentOf = (parent: EngineNode | null): boolean =>
  parent !== null && parent.nodeKind === 'element' && viewNameOf(parent) === HORIZONTAL_SCROLL;

/**
 * The native view a node commits as: `Paragraph` for a `<text>`, `VirtualText` for one nested in
 * another, `RawText` for a run of text, and `View` for anything unregistered, which is what an
 * Angular component's host element is.
 *
 * Exported for tools that show a template beside what it becomes, such as the X-ray in the
 * documentation's course, which labels `@ng-native/web`'s DOM with these names. It reads the same
 * table the commit does, so after `registerPlatformComponents('android')` it answers for Android.
 *
 * Exempt from the complexity limit as `mergeProps` is: asked of every element several times a
 * commit, where a call more for the name of a plain view measured slower in `pnpm bench`.
 */
// eslint-disable-next-line complexity
export function viewNameOf(node: ViewNameNode): string {
  if (node.nodeKind === 'text') return RAW_TEXT;
  // RN models nested text as a span inside a paragraph: `Paragraph > [RawText, Text > RawText]`.
  // Committing a nested `<text>` as another Paragraph gives a paragraph inside a paragraph,
  // which lays out as a separate block instead of flowing inline.
  // A component of the app's own under a name a view set registered: its host is a plain view.
  if (node.componentHost && !node.nativeView && YIELDING.has(node.tag)) return DEFAULT_VIEW;
  const registered = registeredViewName(node.tag);
  // Nearly every element: a view of some kind, by its name alone. A scroll view, the one name
  // that can mean two views, is told from the rest first.
  if (registered !== PARAGRAPH) {
    return registered === 'ScrollView' ? namedView(node, registered) : (registered ?? DEFAULT_VIEW);
  }
  // One of HTML's text elements that holds something other than text: a view.
  // Or one that lays out what it holds itself: see `Engine.settleBoxed`.
  if (node.tag !== 'text' && TEXT_ELEMENTS.has(node.tag) && !holdsOnlyText(node)) {
    return DEFAULT_VIEW;
  }
  if (node.boxed) return DEFAULT_VIEW;
  // The paragraph the engine makes for a view's loose text is under a view, whatever the name
  // of the element that view is.
  return nestedText(node) ? VIRTUAL_TEXT : PARAGRAPH;
}

/**
 * The view an element other than text is by its registered name: a plain view when it has none,
 * and on Android, where there is a scroll view for each axis, the horizontal one when RN would
 * pick it, `horizontal` set to true.
 */
const namedView = (node: ViewNameNode, registered: string | undefined): string =>
  registered === 'ScrollView' && platformOS === 'android' && node.props?.['horizontal'] === true
    ? HORIZONTAL_SCROLL
    : (registered ?? DEFAULT_VIEW);

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
  return !node.childList.some((child) => child !== moved && fills(child));
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
/**
 * What native eases a set of transitions on one clock by: a colour by its own channels, opacity
 * and a transform as an animation of them is. Nothing where any of them is no value native can
 * ease, which leaves them all to JavaScript.
 */
function easedChannels(
  tracks: ReadonlyMap<string, readonly TrackPoint[]>,
  spec: AnimationSpec,
  props: Record<string, unknown>,
): DrivenChannels | null {
  const tinted = new Map([...tracks].filter(([key]) => EASED_COLOURS.has(key)));
  const moved = new Map([...tracks].filter(([key]) => !EASED_COLOURS.has(key)));
  const colors = colourChannels(tinted, spec);
  const { channels, held } = clockChannels(moved, spec, props);
  if (!colors || held.length) return null;
  const any = channels.opacity || channels.transform.length || tinted.size;
  return any ? { ...channels, colors } : null;
}

/** The sides a length is written for, and the two it is written for at once. */
const EDGES = ['', 'Top', 'Right', 'Bottom', 'Left', 'Horizontal', 'Vertical'];
/**
 * The properties of a transition that resize or move a box, which native eases by laying the
 * view out where it ends: see `layEased`.
 */
const LAID_OUT = new Set([
  ...['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'],
  ...['top', 'right', 'bottom', 'left', 'flexBasis'],
  ...EDGES.map((edge) => `margin${edge}`),
]);
/** Every prop that can resize or move a box, a view's own or another's. */
const MOVES_BOXES = new Set([
  ...LAID_OUT,
  ...EDGES.map((edge) => `padding${edge}`),
  ...['borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'],
  ...['flex', 'flexGrow', 'flexShrink', 'flexDirection', 'flexWrap', 'alignItems', 'alignSelf'],
  ...['alignContent', 'justifyContent', 'gap', 'rowGap', 'columnGap', 'display', 'position'],
  ...['aspectRatio', 'fontSize', 'lineHeight', 'fontFamily', 'fontWeight', 'letterSpacing'],
  ...['numberOfLines', 'start', 'end'],
]);

/** Whether native is moving a view to a prop's value, by a transition or an animation it laid out. */
function laidByNative(node: EngineNode, key: string): boolean {
  const eased = node.transitions?.get(key);
  if (eased?.laid && !eased.done) return true;
  return node.playing?.laid === true && node.playing.tracks.has(key);
}

/** Whether an animation plays once through, forwards, with no wait before it. */
const playedOnce = (spec: AnimationSpec): boolean =>
  spec.delay === 0 && spec.duration > 0 && spec.iterations === 1 && !spec.direction;

/** Whether a track is two frames on one curve, the first of them where the view is drawn. */
function fromWhereDrawn(track: readonly TrackPoint[], drawn: unknown): boolean {
  const [first, last] = track;
  if (track.length !== 2 || first!.easing || last!.value == null) return false;
  // One that ends where it starts moves nothing: there is nothing for native to lay out.
  return Object.is(first!.value, drawn) && !Object.is(first!.value, last!.value);
}

/** The curves a layout animation has, as the timing function each is. */
const LAYOUT_CURVES: readonly (readonly [string, readonly number[]])[] = [
  ['linear', [0, 0, 1, 1]],
  ['easeIn', [0.42, 0, 1, 1]],
  ['easeOut', [0, 0, 0.58, 1]],
  ['easeInEaseOut', [0.42, 0, 0.58, 1]],
];

/** The curve of a layout animation nearest a timing function, by where each is along the way. */
function layoutCurve(easing: readonly number[]): string {
  const along = [0.2, 0.4, 0.6, 0.8];
  const apart = (curve: readonly number[]) =>
    along.reduce((sum, at) => sum + (bezier(curve, at) - bezier(easing, at)) ** 2, 0);
  let nearest = LAYOUT_CURVES[0]!;
  for (const curve of LAYOUT_CURVES) if (apart(curve[1]) < apart(nearest[1])) nearest = curve;
  return nearest[0];
}

/** The properties of a transition native can play: see `easeNatively`. */
const EASED_COLOURS = new Set([
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
]);
const NATIVELY_EASED = new Set(['opacity', 'transform', ...EASED_COLOURS]);

/** What a node that hands its background colour over has handed so far: nothing. */
const UNREPORTED = Symbol('unreported');

/** The style keys that are a view's background. */
const PAINT_KEYS = [
  'backgroundColor',
  'experimental_backgroundImage',
  'experimental_backgroundSize',
  'experimental_backgroundPosition',
  'experimental_backgroundRepeat',
];

/** Note a prop written on a node that keeps `writes`: see there. */
function noteWrite(node: EngineNode, key: string, value: unknown): void {
  if (!node.writes) return;
  if (value === undefined || value === null) node.writes.delete(key);
  else node.writes.add(key);
}

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
    else if (!ENGINES_OWN.has(key)) {
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
    return node.childList.some((child) => child.touchWithin);
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

const hasClasses = (node: EngineNode, names: readonly string[]): boolean =>
  names.every((name) => node.classes?.has(name));

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

/** A bound value the cascade works out from tokens: a `var()`, a `color-mix()`, a relative colour. */
const BOUND_TOKEN =
  /^[ \t\n\r\f]*(?:var|color-mix)\(|^[ \t\n\r\f]*[a-z]+\([ \t\n\r\f]*from[ \t\n\r\f]/i;

/**
 * A bound value kept as a declaration the cascade settles: a `var()`, a colour made of tokens, or
 * a relative length.
 */
/**
 * The text each bound declaration was read from, to know one bound again as it was: see
 * `Engine.setBoundStyle`.
 */
const BOUND_TEXT = new WeakMap<DeferredDeclaration, string>();

/** `boundFrom`, remembering the text it was read from. */
function boundRead(prop: string, text: string, on: string): DeferredDeclaration | null {
  const bound = boundFrom(prop, text, on);
  if (bound) BOUND_TEXT.set(bound, text);
  return bound;
}

function boundFrom(prop: string, text: string, on: string): DeferredDeclaration | null {
  return BOUND_TOKEN.test(text)
    ? boundDeclaration(prop, tokenFromValue(text), on)
    : boundRelativeLength(prop, text, on);
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
  nodeText = '';
  childList: EngineNode[] = [];
  parent: EngineNode | null = null;
  listeners: Map<string, Set<(event: unknown) => void>> | null = null;
  classes: Set<string> | null = null;
  templateSheet: StyleSheet | null = null;
  hostSheet: StyleSheet | null = null;
  customProperties: Record<string, TokenValue> | null = null;
  styleCache: StyleCache | null = null;
  styleDirty = true;
  ownDirty = false;
  styleCommitted: StyleCache | null = null;
  fitContainer: string | undefined = undefined;
  heightBasis: boolean | undefined = undefined;
  hasDirty = false;
  stateDirty = false;
  ownStyle: object | undefined = undefined;
  claimed: true | undefined = undefined;
  dormantHoists: EngineNode[] | null = null;
  committed: Committed | null = null;
  committedUnder: EngineNode | LineBox | null = null;
  kept: Map<string, KeptHoist> | undefined = undefined;
  remeasure: true | undefined = undefined;
  oneWord: boolean | undefined = undefined;
  raised: number | undefined = undefined;
  propsDirty = false;
  structureDirty = false;
  subtreeDirty = false;
  touchWithin: boolean | undefined = undefined;
  box: EngineNode | undefined = undefined;
  words: EngineNode[] | undefined = undefined;
  anonymous: true | undefined = undefined;
  styled: true | undefined = undefined;
  bornIn: number | undefined = undefined;
  truncates: true | undefined = undefined;
  // Written on nodes that never had one: a style set inline, and every node a commit forgets. A
  // field a node is not made with gives it another shape when it is written.
  inlineInherits: boolean | undefined = undefined;
  line: LineBox | undefined = undefined;
  inside: { handle: FabricNode; childHandles: FabricNode[] } | undefined = undefined;
  transitions?: Map<string, Transition>;
  playing?: RunningAnimation;
  scrolled?: ScrollAnimation;
  owned?: { readonly tag: number; readonly keys: Set<string> };

  readonly nodeKind: NodeKind;
  readonly tag: string;
  /** See `HostNode.engine`. */
  readonly engine: HostEngine;

  constructor(kind: NodeKind, tag: string, host: HostEngine) {
    this.nodeKind = kind;
    this.tag = tag;
    this.engine = host;
  }

  get tagName(): string {
    return this.tag;
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
    const siblings = mine[depth - 1]!.childList as unknown as RetainedNode[];
    return siblings.indexOf(theirs[depth]!) < siblings.indexOf(mine[depth]!) ? 2 : 4;
  }

  /**
   * What Signal Forms' `focusBoundControl()` calls on a field's element, and what a DOM element
   * would do: see `HostEngine.focus`.
   */
  focus(): void {
    this.engine.focus(this as unknown as EngineNode);
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
    if (type === 'mouseenter') reportHover(this.engine);
    const stops = events.map((event) =>
      this.engine.setEventListener(this as unknown as EngineNode, event, listener),
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
 * Every field the engine keeps on a node, including the ones it assigns only later, in a commit:
 * an extension may shadow none of them, or the engine's own write would go through the
 * extension's getter. Typed against `EngineNode`, so a field added there and not here fails the
 * typecheck.
 */
const ENGINE_NODE_FIELDS = {
  nodeKind: true,
  tag: true,
  tagName: true,
  typeName: true,
  namespace: true,
  props: true,
  nodeText: true,
  childList: true,
  parent: true,
  listeners: true,
  classes: true,
  templateSheet: true,
  hostSheet: true,
  customProperties: true,
  styleCache: true,
  styleDirty: true,
  ownDirty: true,
  hasDirty: true,
  stateDirty: true,
  heldFamily: true,
  inlineInherits: true,
  boundStyle: true,
  boundByProp: true,
  touchWithin: true,
  box: true,
  words: true,
  anonymous: true,
  styled: true,
  focused: true,
  active: true,
  ownStyle: true,
  styleCommitted: true,
  fitContainer: true,
  inlineLevel: true,
  scrollView: true,
  lined: true,
  boxed: true,
  flow: true,
  resolved: true,
  sticky: true,
  fixedTo: true,
  ordered: true,
  fit: true,
  fitMin: true,
  fitOff: true,
  mixed: true,
  mixedOff: true,
  line: true,
  autoMin: true,
  shareMin: true,
  shareOff: true,
  row: true,
  grid: true,
  gridIn: true,
  flowIn: true,
  heightBasis: true,
  heldAt: true,
  transitions: true,
  playing: true,
  scrolled: true,
  owned: true,
  composedTransform: true,
  bornIn: true,
  boundTransform: true,
  claimed: true,
  componentHost: true,
  nativeView: true,
  attributeOnly: true,
  writes: true,
  paintsOn: true,
  paintTaker: true,
  paintTaken: true,
  defaultStyle: true,
  dormantHoists: true,
  committed: true,
  committedUnder: true,
  kept: true,
  onBaseline: true,
  baselineFields: true,
  remeasure: true,
  oneWord: true,
  raised: true,
  presented: true,
  propsDirty: true,
  structureDirty: true,
  subtreeDirty: true,
  inside: true,
  scrollsOverflow: true,
  engine: true,
} satisfies Record<keyof EngineNode, true>;

/**
 * The fields an extension may not shadow: the engine's, and the one Angular assigns. A getter
 * the prototype only reads out, as `tagName` is for Angular, is a member like `classList`, which
 * an extension may replace: the engine never writes it.
 */
const NODE_FIELDS = new Set([
  ...Object.keys(ENGINE_NODE_FIELDS).filter((name) => {
    const own = Object.getOwnPropertyDescriptor(RetainedNode.prototype, name);
    return !(own?.get && !own.set);
  }),
  '__ngContext__',
]);

/**
 * Give every node members of a package's own, on the prototype they share: a getter, a method.
 * Returns what takes them away again.
 *
 * For a package that presents nodes to code written against another API, as a web-compatibility
 * layer answers `getAttribute` and `closest` from a node's name and props. A field the engine
 * keeps on a node (`nodeKind`, `props`, `childList`) is refused. A member a node already has on the
 * prototype (`classList`, `addEventListener`) is replaced, and put back when the extension is
 * taken away: what replaces it has to do what the original did for Angular.
 */
export function extendNodes(members: PropertyDescriptorMap & ThisType<EngineNode>): () => void {
  const names = Object.keys(members);
  for (const name of names) {
    if (NODE_FIELDS.has(name)) {
      throw new Error(`[angular-native] extendNodes: '${name}' is a field the engine keeps.`);
    }
  }
  const added: [string, PropertyDescriptor][] = [];
  const remove = () => {
    for (const [name, descriptor] of added.splice(0)) removeMember(name, descriptor);
  };
  try {
    for (const name of names) {
      // Configurable whatever the descriptor says, or it could not be taken away again.
      const descriptor = { ...members[name], configurable: true };
      addMember(name, descriptor);
      added.push([name, descriptor]);
    }
  } catch (error) {
    // A descriptor the runtime refuses: the ones before it do not stay behind.
    remove();
    throw error;
  }
  return remove;
}

/**
 * What each extended member was before any extension, and the extensions' own descriptors for it,
 * oldest first. Two extensions can give the same member, and be taken away in either order: the
 * newest still there is the one a node has, and the original comes back after the last.
 */
const extended = new Map<string, { original?: PropertyDescriptor; stack: PropertyDescriptor[] }>();

function addMember(name: string, descriptor: PropertyDescriptor): void {
  const prototype = RetainedNode.prototype;
  const entry = extended.get(name) ?? {
    original: Object.getOwnPropertyDescriptor(prototype, name),
    stack: [],
  };
  // First, so a descriptor the runtime refuses is never recorded.
  Object.defineProperty(prototype, name, descriptor);
  entry.stack.push(descriptor);
  extended.set(name, entry);
}

function removeMember(name: string, descriptor: PropertyDescriptor): void {
  const prototype = RetainedNode.prototype;
  const entry = extended.get(name);
  const index = entry?.stack.indexOf(descriptor) ?? -1;
  if (!entry || index === -1) return;
  entry.stack.splice(index, 1);
  const top = entry.stack.at(-1);
  if (top) return void Object.defineProperty(prototype, name, top);
  extended.delete(name);
  if (entry.original) Object.defineProperty(prototype, name, entry.original);
  else Reflect.deleteProperty(prototype, name);
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
   * `strict` lays the app out without Yoga's legacy errata, as a browser would: a percentage
   * inset or size of an out-of-flow box is of its container's padding box, and one with no inset
   * starts inside the padding. `compatibility` keeps the errata and is the default, as it is in
   * React Native, whose `experimental_LayoutConformance` takes the same two modes. Strict commits
   * the app inside that view, which has no box of its own.
   */
  layoutConformance?: 'strict' | 'compatibility';
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
/** The brush that paints a shape in the colour of the view it is in: `currentColor`. */
const CURRENT_BRUSH = { type: 2 };

/** The paint a stylesheet can give a shape, which native reads only where `propList` names it. */
const SHAPE_PAINT = ['fill', 'stroke', 'strokeWidth', 'strokeDasharray', 'strokeDashoffset'];

/**
 * Name in a shape's `propList` each paint its style gave it. react-native-svg takes a paint from
 * the shape only where the list says the shape set it, and from the group above otherwise, so
 * one a stylesheet set would be passed over. The list is kept from one commit to the next while
 * what it names is the same, as a prop that is a new array is a change to send.
 */
function namePaint(node: EngineNode, props: Record<string, unknown>): void {
  const written = (node.props['propList'] as readonly string[] | undefined) ?? [];
  const painted = SHAPE_PAINT.filter((key) => key in props && !written.includes(key));
  const before = node.committed?.props['propList'] as readonly string[] | undefined;
  if (!painted.length && !written.length) {
    if (before?.length) props['propList'] = before === NAMES_NO_PAINT ? before : NAMES_NO_PAINT;
    return;
  }
  if (!painted.length) return;
  const names = [...written, ...painted];
  const same = before?.length === names.length && names.every((name, i) => before[i] === name);
  props['propList'] = same ? before : names;
}

/**
 * The list of a shape that once named a paint and names none now. react-native-svg keeps the
 * list it had where it is sent none, on Android, or an empty one, on iOS: the shape would keep
 * the paint as its own, and draw in a colour no sheet gives it any more, or in none. This names
 * `vector-effect` instead, which SVG does not inherit, so naming it as the shape's own changes
 * nothing it draws.
 */
const NAMES_NO_PAINT: readonly string[] = ['vectorEffect'];

/**
 * What CSS draws and places as a box, which a shape in a drawing has none of: a browser draws no
 * background, border or shadow on one and gives it no padding or margin. Native would: a shape is
 * a view, whose background is drawn over the drawing it is in, and hides what is drawn after it.
 */
const BOX = /^(experimental_)?background|^(border|padding|margin|outline)|^boxShadow$/;

/** Take the box off a shape's style: see `BOX`. Not off the drawing, nor its HTML in it. */
function noBoxOnShape(viewName: string, props: Record<string, unknown>): void {
  if (viewName.startsWith('RNSVGSvgView') || viewName === 'RNSVGForeignObject') return;
  for (const key of Object.keys(props)) if (BOX.test(key)) delete props[key];
}

/** The views of a drawing that read a font: a group passes its own on to what is in it. */
const FONTED: ReadonlySet<string> = new Set([
  'RNSVGGroup',
  'RNSVGText',
  'RNSVGTSpan',
  'RNSVGTextPath',
]);

/** The parts of a font a view of a drawing is also sent alone, from its style. */
const FONT_PARTS = ['fontSize', 'fontWeight'] as const;

/** The font last sent to each view, kept while what it was made of is the same: see `fontInOne`. */
const oneFonts = new WeakMap<EngineNode, { from: readonly unknown[]; font: object }>();

/**
 * Send a view of a drawing its size and weight inside its `font`, not beside it. On Android,
 * react-native-svg sets the whole font from a `fontSize` or a `fontWeight` sent alone, in
 * whichever order the props come, so one sent beside a `font` with a weight in it could drop the
 * weight. What the font itself says is kept over the style's: an attribute on the shape over a
 * size inherited from the text it is in. The same object while its parts are, as a new one is a
 * change to send.
 */
function fontInOne(node: EngineNode, merged: Record<string, unknown>): void {
  const own = merged['font'] as Record<string, unknown> | undefined;
  const parts = FONT_PARTS.map((key) => merged[key]);
  if (parts.every((part) => part == null)) return;
  for (const key of FONT_PARTS) delete merged[key];
  const from = [own, ...parts];
  const kept = oneFonts.get(node);
  if (kept && kept.from.every((part, i) => part === from[i])) {
    merged['font'] = kept.font;
    return;
  }
  const font: Record<string, unknown> = {};
  FONT_PARTS.forEach((key, i) => {
    if (parts[i] != null) font[key] = parts[i];
  });
  Object.assign(font, own);
  oneFonts.set(node, { from, font });
  merged['font'] = font;
}

/**
 * A paint of `currentColor`, as a sheet read as a browser reads it keeps one: the brush of the
 * colour of the view it is in, which native follows as that changes.
 */
function currentPaint(merged: Record<string, unknown>): void {
  for (const key of BRUSH_PROPS) {
    const paint = merged[key];
    if (typeof paint === 'string' && paint.toLowerCase() === 'currentcolor') {
      merged[key] = CURRENT_BRUSH;
    }
  }
}

/**
 * What a view of a library's drawing is drawn with of its style: see the helpers above. Only a
 * drawing's (`EngineNode.namespace`): an icon's shapes commit their style as any view does.
 */
function drawnAsShape(node: EngineNode, viewName: string, merged: Record<string, unknown>): void {
  noBoxOnShape(viewName, merged);
  currentPaint(merged);
  namePaint(node, merged);
  if (platformOS === 'android' && FONTED.has(viewName)) fontInOne(node, merged);
}

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
/** Listed once, as `ANIMATION_ENTRIES` is. */
const TRANSITION_ENTRIES = Object.entries(TRANSITION_TIMING);

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
  for (const [key, part] of TRANSITION_ENTRIES) {
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
 * The prop a text field's width in characters is in, where it has no width of its own: HTML's
 * `size`. Read here for the width it comes to, see `columnsWide`, and not sent to a native
 * field, which has no such prop.
 */
const FIELD_SIZE = 'size';

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

/** The props that are the engine's to read, and no prop of any native view. */
const ENGINES_OWN: ReadonlySet<string> = new Set(['style', INTRINSIC_SIZE, STYLE_OVERRIDE]);

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

/** Whether two sets of the same classes hold them in the same order. */
function inOrder(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const other = b.values();
  for (const name of a) if (other.next().value !== name) return false;
  return true;
}

const BEFORE = '::before';
const AFTER = '::after';
type GeneratedBox = typeof BEFORE | typeof AFTER;

/**
 * Whether a rule for a generated box gives it `content`, which is what makes a box: a rule
 * without it, a reset for every `::before` there is, styles the ones other rules make and makes
 * none of its own.
 */
function givesContent(rule: StyleSheet['rules'][number]): boolean {
  const content = rule.important?.['content'] ?? rule.declarations['content'];
  return content !== undefined && content !== 'none';
}

/** The elements a sheet's rules give one generated box to: by class, id, name or attribute, or all. */
interface GeneratedFor {
  readonly classes: Set<string>;
  readonly names: Set<string>;
  /** The ids a rule names its element by, as a page names one element. */
  readonly ids: Set<string>;
  /** The attributes a rule names its element by alone, as a headless library's do. */
  readonly attributes: Set<string>;
  /** The sheets whose `:host` a rule names: a host of one, and no other element, has the box. */
  readonly hosts: Set<StyleSheet>;
  every: boolean;
}

/** What one or more sheets' rules give each generated box to. */
type Generated = Record<GeneratedBox, GeneratedFor>;

const generatedFor = (): GeneratedFor => ({
  classes: new Set(),
  names: new Set(),
  ids: new Set(),
  attributes: new Set(),
  hosts: new Set(),
  every: false,
});

const noGenerated = (): Generated => ({ [BEFORE]: generatedFor(), [AFTER]: generatedFor() });

/** What a sheet's `::before` and `::after` rules with a content give a box to, or null for none. */
function generatedIn(sheet: StyleSheet): Generated | null {
  if (!sheet.generated) return null;
  let boxes: Generated | null = null;
  for (const rule of sheet.rules) {
    const box = rule.compounds.at(-1)?.type;
    if ((box !== BEFORE && box !== AFTER) || !givesContent(rule)) continue;
    noteGenerated((boxes ??= noGenerated())[box], rule.compounds.at(-2), sheet);
  }
  return boxes;
}

/** What every sheet in `all` gives a box to together, or null where none gives one. */
function joinGenerated(all: Iterable<Generated | null>): Generated | null {
  let joined: Generated | null = null;
  for (const boxes of all) {
    if (!boxes) continue;
    joined ??= noGenerated();
    for (const box of [BEFORE, AFTER] as const) {
      const into = joined[box];
      const from = boxes[box];
      for (const key of ['classes', 'names', 'ids', 'attributes'] as const) {
        for (const each of from[key]) into[key].add(each);
      }
      for (const each of from.hosts) into.hosts.add(each);
      into.every ||= from.every;
    }
  }
  return joined;
}

/**
 * Note the element a rule draws a box in, by the compound its selector names it with: one of its
 * classes, or its name, either of which the element must have for the rule to match, or those
 * of each alternative of a `:is()` it is named in, or an attribute it must have. With none of
 * those any element could be the one.
 */
function noteGenerated(boxes: GeneratedFor, origin: Compound | undefined, sheet: StyleSheet): void {
  if (!origin) boxes.every = true;
  else if (origin.host !== undefined) boxes.hosts.add(sheet);
  else if (origin.classes[0] !== undefined) boxes.classes.add(origin.classes[0]);
  else if (origin.id !== undefined) boxes.ids.add(origin.id);
  else if (origin.type !== undefined) boxes.names.add(origin.type);
  else noteUnnamed(boxes, origin, sheet);
}

/** Note the element of a rule that names it by neither a class nor its name. */
function noteUnnamed(boxes: GeneratedFor, origin: Compound, sheet: StyleSheet): void {
  const alternatives = origin.is?.[0];
  // Named inside `:is()`, as Tailwind writes a state: each alternative is the element itself.
  if (alternatives?.length) for (const each of alternatives) noteGenerated(boxes, each, sheet);
  // By an attribute it has to have, where that is all that names it.
  else if (origin.attributes?.length) boxes.attributes.add(origin.attributes[0]!.name);
  else boxes.every = true;
}

/** Whether an element hosts a component whose `:host` a rule gives the box to. */
const hostsGenerated = (node: EngineNode, boxes: GeneratedFor): boolean =>
  node.hostSheet !== null && boxes.hosts.has(node.hostSheet);

function wantsGenerated(node: EngineNode, boxes: GeneratedFor): boolean {
  if (boxes.every || boxes.names.has(node.tag) || hostsGenerated(node, boxes)) return true;
  const id = node.props['nativeID'];
  if (typeof id === 'string' && boxes.ids.has(id)) return true;
  if (node.classes) for (const name of node.classes) if (boxes.classes.has(name)) return true;
  return hasGeneratedAttribute(node, boxes);
}

/** Whether an element has an attribute a rule gives the box to by that alone. */
function hasGeneratedAttribute(node: EngineNode, boxes: GeneratedFor): boolean {
  for (const name of boxes.attributes) {
    const value = node.props[name];
    if (value !== undefined && value !== null && value !== false) return true;
  }
  return false;
}

/** What a generated box has before any rule: a browser's is not positioned, where a view is. */
const GENERATED_STYLE = { position: 'static' };
const NOT_GENERATED = { display: 'none' };

/**
 * A generated box's style from its rules. `content` is what makes the box: with none, or with
 * `none`, there is no box, however much else is written for it.
 */
function generatedStyle(style: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { content, ...drawn } = style;
  return content === undefined || content === 'none' ? NOT_GENERATED : drawn;
}

/** Where a child put last goes: before the `::after` box, which stays last. */
function endOf(parent: EngineNode, child: EngineNode): number {
  const last = parent.childList.at(-1);
  return last?.tag === AFTER && child.tag !== AFTER
    ? parent.childList.length - 1
    : parent.childList.length;
}

/**
 * Whether a node could be the element a compound is written for, by its classes alone: its own,
 * and those of one alternative of each `:is()` on it, which is where Tailwind names a group or
 * a peer. A compound with no class in either could be any element.
 */
function couldBe(compound: Compound, node: EngineNode): boolean {
  if (!compound.classes.every((name) => node.classes?.has(name))) return false;
  return (compound.is ?? []).every((alternatives) =>
    alternatives.some((option) => couldBe(option, node)),
  );
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

/**
 * What one pass of `markUnderHas` has reached after the boxes it asked: each box's place in its
 * list, found once a list, and the elements reached for each rule's subjects. A list of a
 * thousand boxes asked is looked through once, not once a box.
 */
class MarkedAfter {
  private readonly lists = new Map<EngineNode, Map<EngineNode, number>>();
  private readonly bySubjects = new Map<Subjects, Set<EngineNode>>();

  place(node: EngineNode): number {
    const list = node.parent!;
    let places = this.lists.get(list);
    if (!places) {
      places = new Map(list.childList.map((child, at) => [child, at]));
      this.lists.set(list, places);
    }
    return places.get(node)!;
  }

  reached(subjects: Subjects): Set<EngineNode> {
    let reached = this.bySubjects.get(subjects);
    if (!reached) this.bySubjects.set(subjects, (reached = new Set()));
    return reached;
  }
}

/** How many boxes `node` is under. */
/**
 * How deep a node is, with the depth of every box on its way up kept in `known`: the boxes that
 * changed beneath are a node and its ancestors, so each is counted once, not once a box.
 */
function depthOf(node: EngineNode, known: Map<EngineNode, number>): number {
  const path: EngineNode[] = [];
  let depth = -1;
  for (let up: EngineNode | null = node; up; up = up.parent) {
    const found = known.get(up);
    if (found !== undefined) {
      depth = found;
      break;
    }
    path.push(up);
  }
  for (let i = path.length - 1; i >= 0; i--) known.set(path[i]!, ++depth);
  return depth;
}

/** A solid brush with no colour in it, which stops react-native-svg. */
const emptyBrush = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === 0 &&
  (value as { payload?: unknown }).payload == null;

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
  /** Whether the app is laid out without Yoga's errata. See `EngineOptions`. */
  private readonly strict: boolean;
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

  /**
   * Whether a subtree that left the tree has ever held a hoisted node of its own: until one has,
   * a node taken out has none to carry, and `carryHoists` does not walk up to look.
   */
  private hoistsHeld = false;
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
  private readonly placeElsewhere = new Set<PlaceReader>();
  /** The sheets `watchStructure` has read, which it is asked about once an element. */
  private readonly watchedStructure = new WeakSet<StyleSheet>();
  /**
   * The sheets in play that use `:has()`, each with whether it asks about what comes after a
   * node, `:has(+ .x)`: see `hasBeside`. A sheet taken away asks no more.
   */
  private readonly hasWatched = new Map<StyleSheet, boolean>();
  /** Whether any sheet in play uses `:has()`. See `markBeneath`. */
  private hasSheets = false;
  /** Whether any asks about what comes after a node. See `markBefore`. */
  private hasBesideSheets = false;
  private readonly resolveAssetSource: (value: unknown) => unknown;

  constructor(fabric: FabricUIManager, rootTag: number, options: EngineOptions = {}) {
    this.fabric = fabric;
    this.rootTag = rootTag;
    const conditions = options.conditions ?? { width: 0, height: 0, colorScheme: 'light' };
    this.lastConditions = options.conditions;
    this.styles = new StyleResolver(options.globalStyles ?? null, conditions);
    this.viewportSize = { width: conditions.width, height: conditions.height };
    this.fontScale = conditions.fontScale;
    if (options.tokens) this.styles.setRootTokens(options.tokens);
    this.want(tokensAsk(options.tokens));
    this.watchStructure(options.globalStyles);
    this.watchLayout(options.globalStyles);
    this.watchHas(options.globalStyles);
    this.watchActive(options.globalStyles);
    this.watchGenerated(options.globalStyles);
    this.dev = options.dev ?? (globalThis as { __DEV__?: boolean }).__DEV__ === true;
    this.strict = options.layoutConformance === 'strict';
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
      ? new NativeScrollDriver(options.nativeAnimated, (view, tag, keys) =>
          this.touchedNatively(view as EngineNode, tag, keys),
        )
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
    const set = (node: EngineNode) => {
      if (node.active === active) return;
      node.active = active;
      this.markActive(node);
      changed = true;
    };
    for (let node = from; node; node = node.parent) {
      set(node);
      if (active) this.activeNodes.add(node);
    }
    if (!active) {
      // Every node the press set, too: one the pressed node was moved or removed from mid-press
      // is no longer above it.
      for (const node of this.activeNodes) set(node);
      this.activeNodes.clear();
    }
    return changed;
  }

  /** The nodes a press has set `:active` on, to clear whatever happens to the tree meanwhile. */
  private readonly activeNodes = new Set<EngineNode>();

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
    if (!this.activeBySheet.delete(sheet)) return;
    this.countActive();
    this.trackMatched();
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
    this.watchLayout(sheet);
    this.watchHas(sheet);
    this.watchActive(sheet);
    this.watchGenerated(sheet);
    this.markPath(this.root);
    this.sheetsAdded.push(sheet);
    return true;
  }

  /**
   * The sheets added since the last commit, whose nodes are not yet marked: see `markAdded`.
   * Emptied by each commit. One taken away before it stays in the list, which only marks nodes
   * it could have matched: taking a sheet away styles everything again in any case.
   */
  private readonly sheetsAdded: StyleSheet[] = [];

  /**
   * Have styled again each node a sheet added since the last commit could match. The rest keep
   * the style they have, which the resolver lets stand for a node none of the sheets' rules is
   * written for, so a commit steps over them: the walk here is what finds the ones it must not
   * step over. One walk for all of them: a screen of a component library adds a sheet for each
   * component it renders for the first time.
   */
  private markAdded(): void {
    if (!this.sheetsAdded.length) return;
    const subjects = this.styles.subjectsOfAll(this.sheetsAdded.splice(0));
    this.markWrittenFor(subjects, this.root);
  }

  private markWrittenFor(subjects: Subjects, node: EngineNode): void {
    if (node.nodeKind === 'element' && this.styles.isFor(subjects, node)) {
      node.styleDirty = true;
      this.markPath(node);
    }
    for (const child of node.childList) this.markWrittenFor(subjects, child);
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
    this.want(tokensAsk(next));
    this.root.subtreeDirty = true;
    this.layoutStale = true;
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
      for (const child of node.childList) {
        // The paragraph of a run of text written straight into a view is kept on the text.
        if (child.nodeKind === 'text') {
          for (const box of paragraphsOf(child)) if (box.committed) again(box);
        }
        if (child.nodeKind !== 'element') continue;
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
    const release = (node: EngineNode | undefined): void => {
      if (node?.heldFamily === undefined || !families.has(node.heldFamily)) return;
      this.markProps(node, false);
      held = true;
    };
    const visit = (node: EngineNode): void => {
      for (const child of node.childList) {
        // The paragraph of a run of text written straight into a view is kept on the text.
        release(child.nodeKind === 'text' ? child.box : child);
        visit(child);
      }
    };
    visit(this.root);
    if (held) this.commit();
  }

  fontsRegistered(families: ReadonlySet<string>): void {
    /** Lay `node` out again where it is text naming one of the families, saying whether it was. */
    const refresh = (node: EngineNode): boolean => {
      // As it is drawn: a text element placing its text is a view, with the paragraph inside it.
      const viewName = committedViewName(node);
      const input = TEXT_INPUTS.has(viewName);
      const named = (viewName === PARAGRAPH || input) && namesFamily(node, families);
      if (!node.committed || !named) return false;
      this.fontRefreshes.set(node, (this.fontRefreshes.get(node) ?? 0) + 1);
      if (input) this.fontResends.add(node);
      this.fontsRefreshed = true;
      this.markProps(node, false);
      return true;
    };
    const visit = (node: EngineNode): void => {
      for (const child of node.childList) {
        // The paragraph of a run of text written straight into a view is kept on the text.
        if (child.nodeKind === 'text' && child.box) refresh(child.box);
        if (child.nodeKind === 'element' && !refresh(child)) visit(child);
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
    const scroll = scrollingDown(node);
    const content = scroll && this.contentOf(scroll);
    if (!scroll || !content) return;
    const margin = options.margin ?? 16;
    this.measure(scroll, (view) => {
      this.measureHandle(content, (inner) => {
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
   * The view a scroll view's content is in: an element that scrolls its overflow holds its
   * children in one of its own, and any other scroll view's first child is it.
   */
  private contentOf(scroll: EngineNode): FabricNode | undefined {
    return scroll.inside?.handle ?? this.visibleChildren(scroll)[0]?.committed?.handle;
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
    if (like && !this.ownSheets.has(node)) this.ownSheets.set(node, node.templateSheet);
    const sheet = like ? like.templateSheet : this.ownSheets.get(node);
    if (sheet === undefined || node.templateSheet === sheet) return;
    node.templateSheet = sheet;
    this.styles.noteSheet(sheet, true);
    this.watchStructure(sheet);
    this.watchLayout(sheet);
    this.watchHas(sheet);
    this.watchActive(sheet);
    this.watchGenerated(sheet);
    // Its generated boxes are matched against the sheet it now has, as it is.
    for (const child of node.childList) {
      if (isGenerated(child.tag) && child.templateSheet !== sheet) {
        child.templateSheet = sheet;
        this.markProps(child);
      }
    }
    if (this.generated !== null) this.generate(node);
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

  /**
   * The conditions given to the constructor or to `updateConditions` last, or undefined before
   * any, when the engine settles colours as light and has no size: what a package
   * answering a media query from a script, `matchMedia`, reads the colour scheme and the motion
   * preference from.
   */
  get conditions(): Conditions | undefined {
    return this.lastConditions;
  }

  private lastConditions: Conditions | undefined;

  updateConditions(next: Conditions): void {
    this.lastConditions = next;
    this.viewportSize = { width: next.width, height: next.height };
    this.fontScale = next.fontScale;
    this.styles.setConditions(next);
    this.root.subtreeDirty = true;
    this.layoutStale = true;
    // The window's size is the room everything is in: see `heldIn`.
    this.changesHeld = false;
    // Committed here rather than left to the next change-detection pass, because there may not
    // be one: no view is dirty, so a tick does no work and never reaches the renderer at all.
    this.commit();
    for (const watcher of this.viewportWatchers) watcher();
  }

  // --- mutation API -----------------------------------------------------

  createElement(name: string, sheet: StyleSheet | null = null): EngineNode {
    const node = new RetainedNode('element', name, this);
    node.templateSheet = sheet;
    this.styles.noteSheet(sheet, true);
    const html = HTML_ELEMENTS.get(name);
    if (html !== undefined) {
      if (html.role) node.props['accessibilityRole'] = html.role;
      node.styled = html.styled;
    }
    // Each watch is of a sheet, and most elements are made with none: told here, not five calls in.
    if (sheet !== null) {
      this.watchStructure(sheet);
      this.watchLayout(sheet);
      this.watchHas(sheet);
      this.watchActive(sheet);
      this.watchGenerated(sheet);
    }
    if (HOISTS[name]) this.hoisted.add(node);
    if (this.generated !== null) this.generate(node);
    return node;
  }

  addClass(node: EngineNode, name: string): void {
    const was = this.classAttribute(node);
    (node.classes ??= new Set()).add(name);
    this.markClasses(node, [name], was);
    if (this.generated !== null) this.generate(node);
  }

  removeClass(node: EngineNode, name: string): void {
    const was = this.classAttribute(node);
    node.classes?.delete(name);
    this.markClasses(node, [name], was);
    if (this.generated !== null) this.generate(node);
  }

  /**
   * A node's classes as its `class` attribute is written, where a sheet reads the attribute as a
   * whole: see `ClassChange`. Null where none does, and nothing is written.
   */
  private classAttribute(node: EngineNode): string | undefined | null {
    if (!this.styles.testsClassAttribute) return null;
    return node.classes?.size ? [...node.classes].join(' ') : undefined;
  }

  /**
   * Mark a node whose classes changed, by what the rules that name those classes can restyle.
   *
   * A class no selector names changes no style: a library's own marker, of an overlay that is
   * animating or a control that was touched. One a rule is for the element of, `.on`, has that
   * element matched again, and one named as what a rule's element is inside, `.animating .close`
   * or `.close:is(.animating *)`, the elements under the node that such rules are for. What is
   * under any of those is styled again from the rules it matched, for what it inherits: a `dark`
   * class on the root finds no rule again for an element no `dark` rule is for. One named in
   * `:has()`, or answering a test of the class attribute there, has the boxes above the node and
   * those before it asked again, and one named only in `:has(> )` the box right above it. Any
   * other class has the node and everything under it matched again, as any other change to it
   * does.
   *
   * A sheet that names a class later restyles what it is for as it arrives, and a node not yet
   * committed is styled when it is, with the class as it is then.
   */
  private markClasses(
    node: EngineNode,
    changed: Iterable<string>,
    was: string | undefined | null,
  ): void {
    // An element still being built, in no tree and never styled: nothing is styled by it yet,
    // and it is styled when it is committed, with the classes it has then. Every element of a
    // screen is given its classes this way, so what they reach is not asked for each.
    if (node.parent === null && node.styleCache === null) return this.markProps(node, false);
    const now = was === null ? null : this.classAttribute(node);
    const reach = this.styles.reachOf(
      changed,
      now === null ? undefined : { was: was as string | undefined, now },
    );
    if (reach === true) return this.markProps(node);
    this.markProps(node, false);
    if (!reach) return;
    if (reach.own) node.ownDirty = true;
    if (this.hasSheets) this.markHasAsking(node, reach);
    if (this.styles.reachesUnder(reach)) {
      this.classesAbove += 1;
      this.markUnder(node, reach);
    }
  }

  /** Mark the boxes whose `:has()` can ask of a node whose classes changed, by `reach`. */
  private markHasAsking(node: EngineNode, reach: Subjects): void {
    if (reach.beneath) this.markBeneath(node.parent, node);
    // `:has(> .on)`: only the box right above the node can answer it.
    else if (reach.parentHas) this.markAsked(node.parent, node.parent?.parent);
  }

  /**
   * How many class changes have restyled what is under an element. `markUnder` walks the tree as
   * it is, so an element out of it then is not reached: one that comes back after any is matched
   * again, with all that is under it.
   */
  private classesAbove = 0;
  /**
   * The count when each element went out of the tree, for the ones still out. `detach` sets it
   * for a node that only moves too, so `markReturned` runs after it and clears that.
   */
  private readonly outSince = new WeakMap<EngineNode, number>();

  /** Have matched again a node coming back into the tree that missed a class change above it. */
  private markReturned(child: EngineNode): void {
    const since = this.outSince.get(child);
    if (since === undefined) return;
    this.outSince.delete(child);
    if (since !== this.classesAbove) this.markAllUnder(child);
  }

  private markAllUnder(node: EngineNode): void {
    if (node.nodeKind !== 'element') return;
    node.ownDirty = true;
    this.markPath(node);
    for (const child of node.childList) this.markAllUnder(child);
  }

  /**
   * Have matched again each element under a node that one of `subjects`' rules could be for. One
   * under another is marked too: what is under an element marked this way keeps its rules.
   */
  private markUnder(node: EngineNode, subjects: Subjects): void {
    for (const child of node.childList) {
      if (child.nodeKind !== 'element') continue;
      if (this.styles.isFor(subjects, child)) {
        child.ownDirty = true;
        this.markPath(child);
      }
      this.markUnder(child, subjects);
    }
  }

  /** What the sheets in play give a generated box to, by the last thing their selectors name. */
  private generated: Generated | null = null;
  /** What each sheet in play gives a generated box to: `generated` is all of them together. */
  private readonly generatedBySheet = new Map<StyleSheet, Generated | null>();

  /**
   * Note the elements a sheet's `::before` and `::after` rules are written for, and give the
   * ones there already their boxes. Only a sheet compiled with them has any, which is a
   * library's the build names as a browser's; for every other this reads the sheet once.
   */
  private watchGenerated(sheet: StyleSheet | null | undefined): void {
    if (!sheet || this.generatedBySheet.has(sheet)) return;
    const boxes = generatedIn(sheet);
    this.generatedBySheet.set(sheet, boxes);
    if (!boxes) return;
    noteGeneratedBoxes();
    this.generated = joinGenerated([this.generated, boxes]);
    if (this.root) this.generateBeneath(this.root);
  }

  /**
   * A sheet has left play, by a hot swap or by being removed: the boxes only it gave go, from
   * every element in the tree.
   */
  private unwatchGenerated(sheet: StyleSheet): void {
    const boxes = this.generatedBySheet.get(sheet);
    if (!this.generatedBySheet.delete(sheet) || !boxes) return;
    const left = joinGenerated(this.generatedBySheet.values());
    // Asked for none, so each box there is goes; then none is asked for again.
    this.generated = left ?? noGenerated();
    if (this.root) this.generateBeneath(this.root);
    this.generated = left;
  }

  /** `next` in play where `sheet` was: noted first, so a box both give is kept, not made again. */
  private swapGenerated(sheet: StyleSheet, next: StyleSheet | null): void {
    this.watchGenerated(next);
    if (next !== sheet) this.unwatchGenerated(sheet);
  }

  /** An attribute or the id a rule gives a generated box by came or went on an element. */
  private generateFor(node: EngineNode, key: string): void {
    const boxes = this.generated;
    if (boxes === null) return;
    if (boxes[BEFORE].attributes.has(key) || boxes[AFTER].attributes.has(key)) {
      this.generate(node);
    } else if (key === 'nativeID' && (boxes[BEFORE].ids.size || boxes[AFTER].ids.size)) {
      this.generate(node);
    }
  }

  private generateBeneath(node: EngineNode): void {
    if (node.nodeKind !== 'element' || isGenerated(node.tag)) return;
    this.generate(node);
    for (const child of [...node.childList]) this.generateBeneath(child);
  }

  /** Keep a box first and last in an element a rule could draw one for, and nowhere else. */
  private generate(node: EngineNode): void {
    if (this.generated === null || node.nodeKind !== 'element' || isGenerated(node.tag)) return;
    this.keepGenerated(node, BEFORE, node.childList[0]);
    this.keepGenerated(node, AFTER, node.childList.at(-1));
  }

  private keepGenerated(node: EngineNode, box: GeneratedBox, at: EngineNode | undefined): void {
    const there = at?.tag === box ? at : undefined;
    if (wantsGenerated(node, this.generated![box]) === (there !== undefined)) return;
    if (there) return this.removeChild(node, there);
    const made = this.createElement(box, node.templateSheet);
    this.setDefaultStyle(made, GENERATED_STYLE);
    if (box === BEFORE) this.insertBefore(node, made, node.childList[0] ?? null);
    else this.appendChild(node, made);
  }

  /**
   * The sheet of the component `node` hosts, whose `:host` rules it matches. Set again when a hot
   * swap replaces the component's sheet, which recreates the views inside but not the host, so the
   * host is styled afresh here.
   */
  setHostSheet(node: EngineNode, sheet: StyleSheet | null): void {
    if (node.hostSheet === sheet) return;
    node.hostSheet = sheet;
    this.styles.noteSheet(sheet, true);
    this.watchStructure(sheet);
    this.watchHas(sheet);
    this.watchLayout(sheet);
    this.watchActive(sheet);
    this.watchGenerated(sheet);
    // A sheet seen before gives this host its box here: a second host of the component, say.
    if (this.generated !== null) this.generate(node);
    this.markProps(node);
  }

  /**
   * Style for `node` that any matched rule or inline style overrides, as a browser's own default
   * for an element is. `mount` gives the root component's host the surface's height this way, as
   * the web's mount point has, unless the app's `:host` sizes it otherwise.
   */
  setDefaultStyle(node: EngineNode, style: Readonly<Record<string, unknown>> | undefined): void {
    this.noteEasing(style);
    node.defaultStyle = style;
    if (this.asked !== EVERYTHING) this.want(this.defaultAsks(node, style));
    // Under what the cascade comes to, and read by no selector: nothing is matched again.
    this.markProps(node, false);
  }

  /**
   * What a default style asks for. The root component's host is given the surface's height as a
   * percentage of it, and the surface's height is native's, which nothing is held at: an app of
   * plain flex that `mount` gives that height is asked nothing for it. See `noteShare`.
   */
  private defaultAsks(node: EngineNode, style: unknown): number {
    const asked = styleAsks(style);
    return node.parent === this.root ? asked & ~SHARED_HEIGHTS : asked;
  }

  /**
   * Say that a browser lays an element out inline, for a package that gives elements a
   * browser's defaults. `unless-block` is an element with no display of its own, a custom
   * element: its default display is the engine's from here, an inline-block while it holds only
   * text and inline-level boxes and a block once it holds one, which cannot sit in a line.
   */
  setInline(node: EngineNode, how: 'always' | 'unless-block' | undefined): void {
    node.inlineLevel = how;
    this.inlines ||= how !== undefined;
    this.want(CSS_LAYOUT);
    this.markProps(node);
  }

  /**
   * `class="a b"` from a template. Replaces the set rather than adding to it. The same classes in
   * another order are a change too, to a selector that reads the class attribute, `[class^="a"]`.
   */
  setClasses(node: EngineNode, value: string): void {
    // By HTML's spaces, which are CSS's: a vertical tab or a no-break space is part of a name.
    const names = value.split(CSS_SPACE).filter(Boolean);
    const before = node.classes;
    const was = this.classAttribute(node);
    node.classes = names.length ? new Set(names) : null;
    // Each class that came or went: one in both changes nothing.
    const changed = [...names.filter((name) => !before?.has(name))];
    for (const name of before ?? []) if (!node.classes?.has(name)) changed.push(name);
    const reordered =
      !changed.length && !!before && !!node.classes && !inOrder(before, node.classes);
    this.markClasses(node, reordered ? node.classes! : changed, was);
    if (this.generated !== null) this.generate(node);
  }

  /** Angular's `@if`/`@for`/`ViewContainerRef` markers. Ordered, never committed. */
  createAnchor(): EngineNode {
    return new RetainedNode('anchor', '#anchor', this);
  }

  createText(value: string): EngineNode {
    const node = new RetainedNode('text', '#text', this);
    node.nodeText = value;
    return node;
  }

  appendChild(parent: EngineNode, child: EngineNode): void {
    this.markAdopted(child, parent);
    this.detach(child);
    this.markReturned(child);
    child.parent = parent;
    // Before a generated `::after`, once a sheet gives one: see `endOf`.
    if (this.generated === null) parent.childList.push(child);
    else parent.childList.splice(endOf(parent, child), 0, child);
    if (child.dormantHoists) this.wakeHoists(child);
    this.markStructure(parent, child, parent.childList.length - 1);
    this.markTextContent(parent, child);
  }

  insertBefore(parent: EngineNode, child: EngineNode, ref: EngineNode | null): void {
    this.markAdopted(child, parent);
    this.detach(child);
    this.markReturned(child);
    child.parent = parent;
    const at = ref ? parent.childList.indexOf(ref) : -1;
    if (at < 0 && this.generated === null) parent.childList.push(child);
    else parent.childList.splice(at < 0 ? endOf(parent, child) : at, 0, child);
    if (child.dormantHoists) this.wakeHoists(child);
    this.markStructure(parent, child, at < 0 ? parent.childList.length - 1 : at);
    this.markTextContent(parent, child);
  }

  /**
   * A node coming under a parent other than the one it is under, or under any once it has been
   * taken out: what is over it may be other than it was styled under. The resolver sees that for
   * itself by the parent's cache, except between two boxes that share one, where it is told here.
   * Moved within its own parent, a row of a list reordered, it is styled as it was.
   */
  private markAdopted(child: EngineNode, parent: EngineNode): void {
    if (child.parent !== parent && this.styles.styledUnderShared(child)) child.styleDirty = true;
  }

  removeChild(parent: EngineNode | null, child: EngineNode): void {
    const target = parent ?? child.parent;
    if (!target) return;
    const at = target.childList.indexOf(child);
    if (at < 0) return;
    this.carryHoists(child);
    target.childList.splice(at, 1);
    child.parent = null;
    this.outSince.set(child, this.classesAbove);
    this.removedSinceCommit.add(child);
    this.markStructure(target, child, at);
    this.markTextContent(target, child);
  }

  /**
   * A child came or went under a view that takes its text as a prop: that prop changed. A span
   * changes it too, by keeping or dropping the space before it.
   */
  private markTextContent(parent: EngineNode, child: EngineNode): void {
    if (child.nodeKind === 'anchor') return;
    if (takesTextAsProp(parent)) this.markProps(parent);
    else if (isTextElement(parent)) this.markWords(parent, child.nodeKind === 'element');
    // A span that keeps its spaces drops them only at the ends of what it is in: the ones
    // beside a span or words that came or went may be at an end now, or no longer. Only under
    // a view whose loose words a span draws, an SVG text and what is in one, and only once a
    // view keeps its spaces at all.
    if (!SPACED_TEXT.size || parent.nodeKind !== 'element') return;
    if (!SPACED_PARENT(parent)) return;
    const spaced = (node: EngineNode) => node.nodeKind === 'element' && SPACED_TEXT.has(node.tag);
    for (const each of parent.childList) {
      const drawn = each.nodeKind === 'text' ? each.box : each;
      if (drawn && spaced(drawn)) this.markProps(drawn);
    }
  }

  /**
   * Text came, went or changed in a paragraph: where it has become one word, or stopped being
   * one, the paragraph is merged again, since that is one line or as many as it takes. Asked
   * of the paragraph's outermost element, which is the view; any other change leaves it be.
   */
  private markWords(within: EngineNode, run = false): void {
    let root = within;
    while (isTextElement(root.parent)) root = root.parent!;
    // A run that came or went can be the tallest line of the paragraph: see `lineTall`.
    // ponytail: one restyled to another line height is not; mark its paragraph if seen cut.
    const words = root.oneWord !== undefined && unbroken(root) !== root.oneWord;
    if (run || words) this.markProps(root, false);
  }

  /**
   * A node taken out of a subtree that left the tree can take hoisted nodes of the subtree's with
   * it, as content projected inside an element of an `@if` moves into the element made again when
   * the block opens. All of the subtree's are woken, and the commit, which the removal makes
   * release, puts each back with the subtree it is in.
   */
  private carryHoists(child: EngineNode): void {
    if (!this.hoistsHeld) return;
    const top = this.topOf(child);
    if (top.dormantHoists) this.wakeHoists(top);
  }

  /** A subtree that went out of the tree is back in: its hoisted nodes commit again. */
  private wakeHoists(node: EngineNode): void {
    for (const hoisted of node.dormantHoists!) this.hoisted.add(hoisted);
    node.dormantHoists = null;
  }

  /**
   * Let go of what is placed from here, and of the pages fixed boxes are on, out of the tree: a
   * box that comes back is placed again from the start.
   */
  private releasePlacements(): void {
    for (const node of this.unplaced) {
      if (this.topOf(node) === this.root) continue;
      this.unplaced.delete(node);
      node.resolved = undefined;
    }
    for (const [page, fixed] of this.fixedIn) {
      if (page === this.root || this.topOf(page) === this.root) continue;
      for (const node of fixed) if (node.fixedTo === page) node.fixedTo = undefined;
      this.fixedIn.delete(page);
    }
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
    this.releasePlacements();
    for (const node of this.hoisted) {
      const top = this.topOf(node);
      if (top === this.root) continue;
      this.hoisted.delete(node);
      (top.dormantHoists ??= []).push(node);
      this.hoistsHeld = true;
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
    if (this.focusedNode && this.topOf(this.focusedNode) !== this.root) this.dropFocus();
    this.dropDetachedPress();
  }

  /** A pressed node out of the tree gets no release: native has no view to end the touch on. */
  private dropDetachedPress(): void {
    const pressed = this.currentResponder;
    if (!pressed || this.topOf(pressed) === this.root) return;
    this.setActiveChain(pressed, false);
    this.currentResponder = null;
  }

  /**
   * Forget the focused node, which has left the tree without a blur: off the node as well as the
   * engine, or a `:focus` rule styles it again when it is put back.
   */
  private dropFocus(): void {
    const node = this.focusedNode!;
    node.focused = false;
    this.markProps(node);
    this.focusedNode = null;
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
   * non-null. It is not always the end of the node: Angular calls it for the content an
   * `<ng-content>` at the top of the view projects too, which belongs to the declaring view, and
   * puts the same nodes back when the view is made again. So what is let go here comes back when
   * the node does, and its listeners stay: each goes when the view or directive that added it
   * tears it down, and Angular does not listen again for content it puts back.
   */
  destroyNode(node: EngineNode): void {
    // With what it holds: a node Angular destroys can be put back, as content projected into
    // an `@if` is, and its children's views would then be handed to the view it is made again
    // as. Native gives a view one parent for its life, and aborts on a second.
    if (node.committed) this.forgetCommitted(node);
    this.stopEased(node);
    node.transitions = undefined;
    if (node.playing) this.stopNative(node, node.playing);
    node.playing = undefined;
    this.stopScrolled(node);
    // And what follows it, where it is the scroll view: each starts again if it is put back.
    for (const follower of this.scrollTimelines.get(node) ?? []) {
      this.stopScrolled(follower);
      this.markProps(follower, false);
    }
    this.running.delete(node);
    this.playing.delete(node);
    // Held by the subtree it left, as `releaseDetached` holds it, and hoisted again if put back.
    const top = this.hoisted.has(node) ? this.topOf(node) : this.root;
    if (top !== this.root) {
      this.hoisted.delete(node);
      (top.dormantHoists ??= []).push(node);
      this.hoistsHeld = true;
    }
    node.kept = undefined;
    // A field popped with the keyboard up never sends its blur.
    if (this.focusedNode === node) this.dropFocus();
  }

  parentNode(node: EngineNode): EngineNode | null {
    return node.parent;
  }

  nextSibling(node: EngineNode): EngineNode | null {
    const siblings = node.parent?.childList;
    if (!siblings) return null;
    return siblings[siblings.indexOf(node) + 1] ?? null;
  }

  /**
   * Whether any declaration the engine was given transitions or animates: until one does, a
   * node's style is committed as it is, with nothing asked of what eases it. See `eased`.
   */
  private eases = false;

  private noteEasing(declarations: Readonly<Record<string, unknown>> | null | undefined): void {
    if (this.eases || !declarations) return;
    for (const key in declarations) {
      if (key.startsWith('$transition') || key.startsWith('$animation')) this.eases = true;
    }
  }

  /** A node's style as its transitions and animation have it: a declaration asks for one. */
  private eased(node: EngineNode, style: Record<string, unknown>): Record<string, unknown> {
    if (!this.eases) return style;
    return this.animated(node, this.transitioned(node, style));
  }

  /** Note a sheet any of whose rules transitions or animates: see `eases`. */
  private noteSheetEasing(sheet: StyleSheet): void {
    for (const rule of this.eases ? [] : sheet.rules) {
      this.noteEasing(rule.declarations);
      this.noteEasing(rule.important);
      // One a token holds: `animation: var(--motion)`.
      for (const deferred of rule.deferred ?? []) {
        this.noteEasing(Object.fromEntries(deferred.props.map((key) => [key, true])));
      }
    }
  }

  /**
   * Note a prop, or a style set as one, that transitions or animates: see `eases`. Asked of every
   * prop and declaration set until one does, so it reads the keys where they are, copying none.
   */
  private noteEasingProp(key: string, value: unknown): void {
    if (easesBy(key) || ((key === 'style' || key === STYLE_OVERRIDE) && styleEases(value))) {
      this.eases = true;
    }
  }

  /**
   * Exempt from the complexity limit deliberately, as `mergeProps` is: run for every prop Angular
   * writes, where a call more for what a value asks of the engine measured slower in `pnpm bench`.
   */
  // eslint-disable-next-line complexity
  setProp(node: EngineNode, key: string, value: unknown): void {
    if (!this.eases) this.noteEasingProp(key, value);
    noteWrite(node, key, value);
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
      // A number asks for nothing but by a key the engine alone reads: see `asks`.
      // `askedBy`, written out: this runs for every prop Angular writes.
      if ((typeof value !== 'number' || LAID_OUT_HERE.has(key)) && this.asked !== EVERYTHING) {
        const bits =
          key === 'style' || key === STYLE_OVERRIDE ? styleAsks(value) : asks(key, value);
        if (bits & ~this.asked) this.want(bits);
      }
    }
    // Inline style is applied after the cascade and inherited by nothing, so it cannot change
    // what any node matches or inherits. Every other prop can: `[disabled]` is a selector. An
    // inline `direction` is the exception, because the paragraphs below it align by it.
    // And a child that takes one of this node's own values, an `inherit`, follows it.
    const heirs = node.styleCache?.heirs === true;
    // And only a prop some selector names: `aria-valuenow` on every tick of a progress bar, a
    // field's text on every key, match nothing they did not.
    const read =
      key === 'style'
        ? this.inlineReachesStyle(node)
        : this.styles.reads(key) || (node.namespace !== undefined && handsDownPaint(key));
    if (this.generated !== null) this.generateFor(node, key);
    // And restyles the elements after it only where a rule asks the prop of an element before
    // another, `[data-on] ~ .x`: a point of a chart set as a finger moves leaves those after it.
    this.markProps(node, read || heirs, this.styles.readsBeside(key));
    if (SIZES_A_RUN.has(key)) this.markParagraph(node);
  }

  /**
   * Have the paragraph a run of text is in merged again: it is as tall as the tallest line of
   * its runs, by a line height or a text scaling set on one of them. See `lineTall`.
   */
  private markParagraph(run: EngineNode): void {
    let paragraph = run;
    while (paragraph.parent && isTextElement(paragraph.parent)) paragraph = paragraph.parent;
    if (paragraph !== run) this.markProps(paragraph, false);
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
   * Hand a node's background colour to `listener` instead of painting it: what its stylesheets,
   * tokens and inline style resolve `background-color` to, or undefined for none. Called after
   * each commit that changes it, the first one included. What a component needs whose colour is
   * drawn by a native view the node is not, from a prop of that view's, as a bottom sheet's is.
   * The function returned stops it, and the node paints its own background again.
   */
  takePaint(node: EngineNode, listener: (color: unknown) => void): () => void {
    node.paintTaker = listener;
    node.paintTaken = UNREPORTED;
    this.markProps(node, false);
    return () => {
      if (node.paintTaker !== listener) return;
      node.paintTaker = undefined;
      this.paintReports.delete(node);
      this.markProps(node, false);
    };
  }

  /** Nodes whose background colour is to be handed over once the commit running ends. */
  private readonly paintReports = new Set<EngineNode>();

  private reportPaint(): void {
    const nodes = [...this.paintReports];
    this.paintReports.clear();
    // One listener that throws stops neither the rest nor what the commit does after them.
    for (const node of nodes) {
      try {
        node.paintTaker?.(node.paintTaken);
      } catch (error) {
        this.reportEventError(error, 'paint');
      }
    }
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
    const inherits = setsInherited(node.props['style'], node.namespace !== undefined);
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

  /** Note what a prop just set asks for: a style, or one declaration of one. */
  private askedBy(key: string, value: unknown): void {
    const bits =
      key === 'style' || key === STYLE_OVERRIDE
        ? styleAsks(value)
        : value === undefined
          ? 0
          : asks(key, value);
    // Nearly always nothing new: what most props and declarations ask for is nothing.
    if (bits & ~this.asked) this.want(bits);
  }

  /**
   * The style object a node already holds has been changed in place.
   *
   * Angular's styling instructions set one property at a time, so a style of ten properties would
   * otherwise mean ten copies of a growing object per element. The adapter owns the object it put
   * there and may write into it; this is how it says so, since nothing about the object's identity
   * has changed for the props diff to notice.
   */
  styleChanged(node: EngineNode, key?: string): void {
    // The rest of the style was noted as it was set: only the declaration changed can be new.
    if (!this.eases) {
      if (key === undefined) this.noteEasingProp('style', node.props['style']);
      else if (easesBy(key)) this.eases = true;
    }
    if (this.asked !== EVERYTHING) {
      const style = node.props['style'] as Record<string, unknown> | undefined;
      const value = key === undefined ? style : style?.[key];
      // A number asks for nothing but by a key the engine alone reads: see `asks`.
      if (typeof value !== 'number' || LAID_OUT_HERE.has(key!)) this.askedBy(key ?? 'style', value);
    }
    // As `setProp` restyles for a new style object: a child that takes one of its values, an
    // `inherit`, follows the one changed in place too.
    this.markProps(node, this.inlineReachesStyle(node) || node.styleCache?.heirs === true);
    this.markParagraph(node);
  }

  /**
   * A bound declaration, `[style.color]`, whose value may be a `var()`, or a length in `em` or a
   * viewport unit. One that is, is kept as a declaration the cascade settles with the node's
   * tokens, font size and viewport, as a rule's is, and true is answered: the text is no value to
   * put in the node's style. A negative `line-height` is dropped, with a warning, and true is
   * answered too. Any other value forgets what was kept.
   */
  setBoundStyle(node: EngineNode, prop: string, value: unknown): boolean {
    const text = typeof value === 'string' ? value : undefined;
    const had = node.boundByProp?.get(prop);
    // Bound again as it is: a chart writes each of its points' paints again as a finger moves.
    // Asked here, without a call, as this runs for every declaration of every inline style.
    if (had !== undefined && text !== undefined && BOUND_TEXT.get(had) === text) return true;
    const refused = text !== undefined && this.refusedBound(node, prop, text);
    const bound = text === undefined || refused ? null : boundRead(prop, text, node.tag);
    if (bound || had) this.keepBound(node, prop, bound);
    return bound !== null || refused;
  }

  /** Keep a bound declaration for the cascade to settle, or forget the one kept, with `null`. */
  private keepBound(node: EngineNode, prop: string, bound: DeferredDeclaration | null): void {
    // A value not known until its token is: taken as asking, where the property could.
    if (bound) this.want(lateAsks(bound));
    const byProp = (node.boundByProp ??= new Map());
    if (bound) byProp.set(prop, bound);
    else byProp.delete(prop);
    node.boundStyle = byProp.size ? [...byProp.values()] : null;
    // Settled by the cascade as the node is styled, and asked about by no selector: nothing after
    // the node matches otherwise for it.
    this.markProps(node, true, false);
  }

  /** Whether a bound value is one CSS has none of, which is dropped with a warning. */
  private refusedBound(node: EngineNode, prop: string, text: string): boolean {
    if (!isNegativeLineHeight(prop, text)) return false;
    this.reportDroppedDeclaration('line-height', text, node.tag, 'it is negative');
    return true;
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
      if (this.asked !== EVERYTHING) this.want(tokenAsks(token));
    }
    // In scope for the node's own rules and for what is under it, and read by no selector: the
    // node is styled again, and those under it from the rules they matched.
    this.markProps(node, false);
    node.ownDirty = true;
  }

  setText(node: EngineNode, value: string): void {
    const filled = (node.nodeText === '') !== (value === '');
    node.nodeText = value;
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

  private markProps(node: EngineNode, affectsStyle = true, beside = true): void {
    node.propsDirty = true;
    // Classes, `nativeID` and anything else a selector can read live in props, so any of them
    // changing can change what this node matches, and through it what its whole subtree does.
    // Marking only when it can is what keeps an animated `[style]` from re-cascading everything
    // beneath it on every frame.
    if (affectsStyle) {
      node.styleDirty = true;
      // `.peer:focus ~ .label`: what a later sibling matches can hang on this node's classes and
      // state, though nothing about the sibling moved. Only sheets that ask about siblings pay.
      // Not for a change `beside` says no rule asks of an element before another.
      if (this.structuralSheets && beside) this.markLaterSiblings(node);
      if (this.hasSheets) this.markBeneath(node.parent, node);
    }
    // The root has no parent to carry the mark, so it carries its own: `.dark` on the root alone
    // restyles everything beneath it.
    this.markPath(node.parent ?? node);
  }

  /** Start matching ancestors again on a change, once a sheet that uses `:has()` is in play. */
  private watchHas(sheet: StyleSheet | null | undefined): void {
    if (!sheet?.has) return;
    if (!this.hasReaders.has(sheet)) this.hasReaders.set(sheet, hasAbove(sheet));
    if (this.hasWatched.has(sheet)) return;
    this.hasWatched.set(sheet, hasBeside(sheet));
    if (this.hasWatched.get(sheet)) this.hasBesideSheets = true;
    if (this.hasSheets) return;
    this.hasSheets = true;
    this.styles.tracksHas = true;
    // What is already resolved kept no record of the rules it matched: resolve it again. Nothing
    // is, when the sheet is the one the engine was made with.
    if (!this.root) return;
    this.root.styleDirty = true;
    this.markPath(this.root);
  }

  /** A sheet has left play: what it asked of `:has()` goes with it. */
  private unwatchHas(sheet: StyleSheet): void {
    this.hasReaders.delete(sheet);
    if (!this.hasWatched.delete(sheet)) return;
    this.hasSheets = this.hasWatched.size > 0;
    this.hasBesideSheets = [...this.hasWatched.values()].some(Boolean);
    this.trackMatched();
  }

  /**
   * Have caches keep the rules each node matched while a sheet in play compares with them, and
   * stop once none does. A sheet that asks about a place in a child list is never unset.
   */
  private trackMatched(): void {
    const { own, elsewhere } = this.activeUse;
    this.styles.tracksHas = this.hasSheets || this.structuralSheets || own || elsewhere.length > 0;
  }

  /**
   * Something at or beneath `from` changed: every node from there up may match a `:has()` rule
   * it did not, or stop matching one. They are matched again rather than marked for restyling,
   * which would restyle everything under them. Only sheets that use `:has()` pay. `changed` is
   * the child of `from` that changed, or `at` where in its list one came or went.
   */
  private markBeneath(from: EngineNode | null, changed?: EngineNode, at?: number): void {
    this.markAsked(from);
    if (this.hasBesideSheets && from) this.markBeside(from, changed, at);
  }

  /** The boxes from `from` up, to `upTo` and not it, to ask `:has()` again: see `markBeneath`. */
  private markAsked(from: EngineNode | null, upTo: EngineNode | null = null): void {
    forgetHasAnswers();
    this.layoutStale = true;
    const wasClean = !this.root.structureDirty && !this.root.subtreeDirty;
    for (let node = from; node && node !== upTo; node = node.parent) {
      node.hasDirty = true;
      // Each is reached by the commit, though a box on the way was marked and not committed
      // since: one with `display: none` keeps its mark, and `markPath` stops at a marked box.
      node.subtreeDirty = true;
      if (this.hasReaders.size) this.changedBeneath.add(node);
    }
    if (wasClean && this.root.subtreeDirty) this.dirtied();
  }

  /** `markBefore` for a change to `changed` in `parent`'s list, or one coming or going at `at`. */
  private markBeside(parent: EngineNode, changed?: EngineNode, at?: number): void {
    // One came or went at `at`: what is after it is not where it was marked.
    if (at !== undefined && at < (this.markedBefore.get(parent) ?? 0)) {
      this.markedBefore.set(parent, at);
    }
    this.markBefore(parent, at ?? (changed ? parent.childList.indexOf(changed) : 0));
  }

  /**
   * By child list, how many of its first children `markBefore` has marked since the last commit,
   * which marks no more of them again: a list that gains its items one at a time is not looked
   * through once for each. A child coming or going before that many brings it down to where.
   */
  private readonly markedBefore = new Map<EngineNode, number>();

  /**
   * By child list, how many of its first children `markRepositioned` has marked for their place
   * from the end since the last commit: a list that gains its items one at a time at its end is
   * not looked through once for each.
   */
  private readonly placesMarked = new Map<EngineNode, number>();
  /** By child list, the first of the children `markAllAfter` has marked with all after it. */
  private readonly placesMarkedAfter = new Map<EngineNode, number>();

  /**
   * `:has(+ .x)` and `:has(~ .x .y)`: a change in `parent`'s list at `at` can change what the
   * elements before it match, and so can one beneath a box for the elements before that box.
   * Each is matched again, as an ancestor is. Only sheets that ask about what comes after pay.
   */
  private markBefore(parent: EngineNode, at: number): void {
    let end = at;
    for (let list: EngineNode | null = parent; list;) {
      const marked = this.markedBefore.get(list) ?? 0;
      for (let i = marked; i < end; i++) {
        const before = list.childList[i]!;
        if (before.nodeKind !== 'element') continue;
        before.hasDirty = true;
        if (this.hasReaders.size) this.changedBeneath.add(before);
      }
      if (end > marked) this.markedBefore.set(list, end);
      const up: EngineNode | null = list.parent;
      if (up) end = up.childList.indexOf(list);
      list = up;
    }
  }

  /**
   * The boxes rules ask `:has()` of above the node they style, `.card:has(.x) .title`, by the
   * sheet that asks: a sheet replaced or taken away asks no more.
   */
  private readonly hasReaders = new Map<StyleSheet, readonly HasAbove[]>();
  /** The nodes something changed beneath since the last commit, where any sheet has such a rule. */
  private readonly changedBeneath = new Set<EngineNode>();

  /**
   * Have matched again what is under each box that changed beneath and that such a rule could
   * be asking: the nodes the rule is for, and no other. Once for a commit, however many changes
   * there were beneath the box: a table gains its rows one at a time.
   *
   * A rule asked of a box above is walked under the highest box that asks it, which reaches what
   * is under the boxes beneath that one as well: a rule `:has()` asks of any box is asked by every
   * box from the change up to the root, and walked once, from the root. The rules a box asks are
   * walked together, the tree beneath it once.
   */
  private markUnderHas(): void {
    if (!this.changedBeneath.size) return;
    const readers = [...this.hasReaders.values()].flat();
    const depths = new Map<EngineNode, number>();
    for (const node of this.changedBeneath) depthOf(node, depths);
    const boxes = [...this.changedBeneath].sort((a, b) => depths.get(a)! - depths.get(b)!);
    // By box walked, the rules walked under it and under every box above it.
    const walked = new Map<EngineNode, ReadonlySet<HasAbove>>();
    const after = new MarkedAfter();
    for (const node of boxes) {
      let above: ReadonlySet<HasAbove> | undefined;
      for (let up = node.parent; up && !above; up = up.parent) above = walked.get(up);
      const all = this.markUnderBox(node, readers, above, after);
      if (all) walked.set(node, all);
    }
    this.changedBeneath.clear();
  }

  /**
   * `markUnderHas` for one box: the rules it asks that no box above it was walked for, walked
   * together. What was walked under it and above it, which is `above` where it asks no more.
   */
  private markUnderBox(
    node: EngineNode,
    readers: readonly HasAbove[],
    above: ReadonlySet<HasAbove> | undefined,
    after: MarkedAfter,
  ): ReadonlySet<HasAbove> | undefined {
    const asked: HasAbove[] = [];
    for (const reader of readers) {
      if (above?.has(reader) || !couldAsk(reader, node)) continue;
      asked.push(reader);
    }
    if (!asked.length) return above;
    const subjects = asked.map((reader) => reader.subjects);
    this.markUnder(node, subjects.length === 1 ? subjects[0]! : joinSubjects(subjects));
    for (const reader of asked) if (reader.beside) this.markAfter(node, reader.subjects, after);
    return new Set([...(above ?? []), ...asked]);
  }

  /**
   * Have matched again each element after `node` that one of `subjects`' rules could be for, and
   * each under one of those: what `.card:has(.x) ~ .title` is for, where the card is `node`.
   * One already reached for `subjects` in this pass had all after it reached with it.
   */
  private markAfter(node: EngineNode, subjects: Subjects, after: MarkedAfter): void {
    // The root, or a box taken out since, has nothing after it.
    if (!node.parent) return;
    const siblings = node.parent.childList;
    const reached = after.reached(subjects);
    for (let i = after.place(node) + 1; i < siblings.length; i++) {
      const sibling = siblings[i]!;
      if (sibling.nodeKind !== 'element') continue;
      if (reached.has(sibling)) return;
      reached.add(sibling);
      if (this.styles.isFor(subjects, sibling)) {
        sibling.ownDirty = true;
        this.markPath(sibling);
      }
      this.markUnder(sibling, subjects);
    }
  }

  /**
   * What `node` matches changed, which the elements after it can read: as many of them as a rule
   * steps along from one, every one for a `~`, and none where no sheet steps at all.
   */
  private markLaterSiblings(node: EngineNode): void {
    let left = this.structuralAfter;
    const siblings = left > 0 ? node.parent?.childList : undefined;
    if (!siblings) return;
    // Each matched again, and left as it was with all under it where it matches what it did:
    // see `markPlace`.
    for (let i = siblings.indexOf(node) + 1; i < siblings.length && left > 0; i++) {
      const sibling = siblings[i]!;
      this.markPlace(sibling);
      if (sibling.nodeKind === 'element') left--;
    }
  }

  /** `node`'s child list changed: `moved` came into it at `at`, or went out of it from there. */
  private markStructure(node: EngineNode, moved: EngineNode, at: number): void {
    node.structureDirty = true;
    this.layoutStale = true;
    // An item whose least width is measured holds something else now: see `settleMinimums`.
    if (this.minimums.size) {
      for (let up: EngineNode | null = node; up; up = up.parent) {
        if (up.shareMin) up.shareMin.width = undefined;
      }
    }
    // A child list that moved changes what its members match, though nothing about them did:
    // the old last row is no longer the last. Only sheets that ask about position pay for this.
    if (this.structuralSheets) {
      moved.styleDirty = true;
      this.markRepositioned(node, at, moved);
      // What the node itself matches hangs on its child list only through `:empty`, which only
      // its first child arriving or its last one leaving changes: and then what a later sibling
      // matches can too, `.box:empty + .spacer`. Styled again for any other change, everything
      // under it would be resolved again with it.
      if (wasOrIsEmptyWithout(node, moved)) {
        node.styleDirty = true;
        this.markLaterSiblings(node);
      }
    }
    if (this.hasSheets) this.markBeneath(node, undefined, at);
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
  private markRepositioned(list: EngineNode, at: number, moved: EngineNode): void {
    const children = list.childList;
    const steps = this.structuralAfter;
    const pastFirst = steps === Infinity ? 0 : steps;
    for (const child of elementsAtEnd(children, 2 + pastFirst, false)) this.markPlace(child);
    for (const child of elementsAtEnd(children, 2, true)) this.markPlace(child);
    if (this.structuralBefore) {
      // Those before `at` are where they were: the ones of them marked already stay marked.
      for (let i = Math.min(this.placesMarked.get(list) ?? 0, at); i < at; i++) {
        this.markPlace(children[i]!);
      }
      this.placesMarked.set(list, at);
    }
    if (steps === Infinity) return this.markAllAfter(list, at, moved);
    // The elements after the change, not counting the one that came, which is marked already.
    let left = steps;
    for (let i = at; i < children.length && left > 0; i++) {
      const child = children[i]!;
      this.markPlace(child);
      if (child.nodeKind === 'element' && child !== moved) left--;
    }
  }

  /**
   * Mark every element after a change at `at`, where a sheet asks about any element before
   * (`~`). Those after the last change marked so since the commit are marked still, wherever they
   * moved to: a list losing its rows first to last is not looked through once for each.
   */
  private markAllAfter(list: EngineNode, at: number, moved: EngineNode): void {
    const children = list.childList;
    const from = this.placesMarkedAfter.get(list);
    const inserted = children[at] === moved;
    // The change is among the marked ones, which a row coming or going leaves marked.
    if (from !== undefined && (at > from || (at === from && !inserted))) return;
    // Those from `from` moved one along, on for a row put in and back for one taken out.
    const end = from === undefined ? children.length : inserted ? from + 1 : from - 1;
    for (let i = at; i < end; i++) this.markPlace(children[i]!);
    this.placesMarkedAfter.set(list, at);
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
    if (child.nodeKind !== 'element' || this.placeReadFromUnder(child)) child.styleDirty = true;
    else child.stateDirty = true;
  }

  /**
   * Whether a rule could read this element's place from another element. By its classes and its
   * element name, which every such compound it could be asks for: one with neither could be any.
   */
  private placeReadFromUnder(node: EngineNode): boolean {
    for (const { compound, above, child } of this.placeElsewhere) {
      // By its element name as well, `text:nth-child(odd) .label`, where the compound has one.
      if (compound.type !== undefined && compound.type !== (node.typeName ?? node.tag)) continue;
      if (!hasClasses(node, compound.classes)) continue;
      // And by what the rule has it in, which a compound with no class is told from.
      if (!above?.length) return true;
      for (let up = node.parent; up; up = child ? null : up.parent) {
        if (hasClasses(up, above)) return true;
      }
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
  /**
   * Whether anything has been marked since the last commit that could move layout: everything
   * is, but a frame of an animation that only paints. A commit of such frames alone plans no
   * layout and reads nothing back: a spinner turns on every frame for as long as its page is
   * open, and the page's layout is the same on each of them.
   */
  private layoutStale = true;
  /** Set while a frame of an animation marks a node whose animated props only paint. */
  private paintTick = false;
  /** Set for the length of a commit that nothing but such frames led to. */
  private paintOnly = false;

  /** Mark a node for a frame of its animation or transition, which moved these props. */
  private tick(node: EngineNode, keys: readonly string[]): void {
    this.paintTick = keys.every((key) => PAINT_ONLY_KEYS.has(key));
    try {
      this.markProps(node, false);
    } finally {
      this.paintTick = false;
    }
  }

  /** Tell the host the tree is dirty: what its listener changes is no frame that only paints. */
  private dirtied(): void {
    const paintTick = this.paintTick;
    this.paintTick = false;
    try {
      this.onDirty?.();
    } finally {
      this.paintTick = paintTick;
    }
  }

  private markPath(node: EngineNode | null): void {
    if (!this.paintTick) this.layoutStale = true;
    const wasClean = !this.root.structureDirty && !this.root.subtreeDirty;
    for (let current = node; current && !current.subtreeDirty; current = current.parent) {
      current.subtreeDirty = true;
    }
    // The tree has just gone from clean to dirty. Inside a change-detection pass that means
    // nothing, because the pass ends in a commit; outside one it means the change has no commit
    // coming, and the host has to arrange a frame.
    if (wasClean && this.root.subtreeDirty) this.dirtied();
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
    if (this.removedSinceCommit.size) {
      // A box that went can have made room for any other: see `heldIn`.
      this.changesHeld = false;
      this.releaseDetached();
    }
    // The root is never reconciled itself, so it has no `committed` record and `isClean` would
    // always say dirty. Ask the flags directly, or every change-detection pass ends in a
    // completeRoot that changes nothing: during a fling that is one wasted native commit per
    // frame, since any listener firing marks the view for refresh.
    this.settleCreated();
    this.markAdded();
    this.markUnderHas();
    // The marks are taken up by the commit from here: see `markedBefore` and `placesMarked`.
    this.markedBefore.clear();
    this.placesMarked.clear();
    this.placesMarkedAfter.clear();
    if (!this.root.structureDirty && !this.root.subtreeDirty) return false;

    const started = now();
    // Faces registered before the walk, the global sheet's among them, reach every node in it.
    this.facesAdded = false;
    this.paintOnly = !this.layoutStale;
    this.layoutStale = false;
    this.movedBoxes.clear();
    this.grownBoxes.clear();
    this.changed.clear();
    this.quietly.clear();
    this.loudly.clear();
    this.holders = undefined;
    this.commitAsAsked();
    // Each a layout of the engine's, which an app of plain flex has asked for none of.
    if (!this.paintOnly && this.asked & LAYOUTS) this.settleLayout();
    this.paintOnly = false;
    this.changesHeld = true;

    this.countCommit(now() - started);

    this.flushTransitionEvents();
    this.reportPaint();
    this.playSized();
    this.scrollDriver?.afterCommit();
    // Read first: the commit that settles keyframes starts by clearing it.
    const facesAdded = this.facesAdded;
    if (this.awaitingKeyframes.size) this.settleKeyframes();
    if (facesAdded) this.rematchFonts();
    this.blurHidden();
    return true;
  }

  /** Count a commit that reached native, and how long it took, in `stats`. */
  private countCommit(elapsed: number): void {
    this.stats.commits++;
    this.stats.lastCommitMs = elapsed;
    if (this.stats.commits === 1) {
      this.stats.firstCommitMs = elapsed;
    } else {
      if (elapsed > this.stats.worstCommitMs) this.stats.worstCommitMs = elapsed;
      if (elapsed > FRAME_BUDGET_MS) this.stats.slowCommits++;
    }
  }

  /** A field went out of view focused, in the commit running: see `undisplayed`. */
  private blurAfterCommit = false;

  private blurHidden(): void {
    if (!this.blurAfterCommit) return;
    this.blurAfterCommit = false;
    this.setFocused(null);
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
   * A commit for what changed after earlier commits, before a frame has drawn them. `since` is
   * how many commits there had been before the first of them (`stats.commits`).
   *
   * A view those commits created has not been seen in the style they gave it, so what this one
   * gives it is where it starts, and no transition runs toward it. That is what a browser does
   * with a class added to an element before the frame after it was inserted, and what
   * `animate.enter` is built on: Angular adds the enter class after the render pass that created
   * the element, and takes it off a frame later, which is the one change the transition is for.
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
    return this.composedDrive(view, source, feed, property, range, statics, shift);
  }

  /** See `driveByEvent`: a drive whose transform after its move can change. */
  private composedDrive(
    view: EngineNode,
    source: EngineNode,
    feed: EventFeed,
    property: DrivenProperty,
    range: ScrollRange,
    statics: readonly StaticTransform[] = [],
    shift: number | null = null,
  ): ComposedDrive | null {
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

  /** Everything the engine lays out in Yoga's place, from the commit just made. */
  private settleLayout(): void {
    this.moveFixed();
    this.settleMinimums();
    this.settleGrids();
    this.settleFits();
    this.settleHeld();
    // A sum can size a grid or move what is in a held box: each again, and the sums of it after.
    if (this.settleMixed()) {
      this.settleGrids();
      this.settleHeld();
      this.settleMixed();
    }
    this.settleAbsolute();
    this.settleSticky();
  }

  /** Note a node that is settled after layout: by a sum of a share and a length, or its least. */
  private noteSettled(node: EngineNode, props: Record<string, unknown>): void {
    if (node.mixed) this.mixeds.add(node);
    if (node.shareMin) this.minimums.add(node);
    // While an item is read at its narrowest: a box in it that is no wider than what it is in,
    // `max-width: 100%`, gets as narrow as that, and holds the item to nothing. A picture.
    const shrinks = typeof props['maxWidth'] === 'string' && props['maxWidth'].endsWith('%');
    if (shrinks && this.narrowed && this.inWords(node)) props['width'] = 0;
  }

  /** The items whose minimum width is measured: see `shareMinimum`. */
  private readonly minimums = new Set<EngineNode>();
  /** Those whose text is committed a word to a line, while how narrow they go is read. */
  private narrowed: ReadonlySet<EngineNode> | null = null;

  private inWords(node: EngineNode): boolean {
    // While a grid's words are read: see `readNarrow`.
    if (this.wordsOf !== null && isWithin(node, this.wordsOf)) return true;
    if (!this.narrowed) return false;
    for (let up = node.parent; up; up = up.parent) if (this.narrowed.has(up)) return true;
    return false;
  }

  /**
   * Read how narrow each item that takes a share of its row goes, where that is not known or
   * something in the item changed: all of them committed as wide as their content with their
   * words a line each, read, and committed again with that as their minimum. Two commits for
   * all of them together, and none where nothing in any of them moved.
   */
  private settleMinimums(): void {
    if (!this.minimums.size || !this.fabric.getBoundingClientRect) return;
    const stale = [...this.minimums].filter((node) => this.minimumIsStale(node));
    if (!stale.length) return this.reshare();
    const texts = stale.flatMap(textsUnder);
    this.settling = true;
    try {
      for (const node of stale) node.shareOff = true;
      this.narrowed = new Set(stale);
      const narrow = stale.flatMap((node) => this.noWiderThanRoom(node));
      this.touch([...stale, ...texts, ...narrow]);
      this.commitTree();
      for (const node of stale) {
        if (node.shareMin) node.shareMin.width = this.boxOf(node)?.[2];
        node.shareOff = undefined;
      }
      this.narrowed = null;
      this.touch([...stale, ...texts, ...narrow, ...this.sharedAgain()]);
      this.commitTree();
    } finally {
      this.narrowed = null;
      this.settling = false;
    }
  }

  /** The boxes under a node whose width is capped at a share of what they are in. */
  private noWiderThanRoom(node: EngineNode): EngineNode[] {
    const found: EngineNode[] = [];
    for (const child of node.childList) {
      if (child.nodeKind !== 'element') continue;
      const cap = readStyle(child, 'maxWidth');
      if (typeof cap === 'string' && cap.endsWith('%')) found.push(child);
      found.push(...this.noWiderThanRoom(child));
    }
    return found;
  }

  /** Share each row out again where its room or its items changed, with no minimum to read. */
  private reshare(): void {
    const changed = this.sharedAgain();
    if (!changed.length) return;
    this.settling = true;
    try {
      this.touch(changed);
      this.commitTree();
    } finally {
      this.settling = false;
    }
  }

  /**
   * Work out each item's share of its line again, for every row whose items all grow into it
   * from nothing, and answer the items whose share is another than it was. A row with any other
   * item in it, one with a width or as wide as its content, is left to Yoga with its items'
   * minimums: what such an item takes of a line is not known until the line is laid out.
   */
  private sharedAgain(): EngineNode[] {
    const changed: EngineNode[] = [];
    const rows = new Set<EngineNode>();
    for (const node of this.minimums) {
      // A row in no room that can have changed, and whose items did not, shares out as it did.
      if (node.parent && this.mayHaveMoved(node.parent)) rows.add(node.parent);
    }
    for (const row of rows) {
      const items = row.childList.filter(
        (child) => child.nodeKind === 'element' && this.inFlowOfRow(child),
      );
      const sharers = items.map((item) => this.sharerOf(item));
      const all = sharers.every((each) => each !== undefined);
      const room = all ? this.roomIn(row) : Infinity;
      const widths = Number.isFinite(room)
        ? lineShares(sharers as Sharer[], room, this.gapOf(row), this.wrapsRow(row))
        : [];
      items.forEach((item, at) => {
        const share = widths[at];
        if (!item.shareMin || sameShare(item.shareMin.share, share)) return;
        item.shareMin.share = share;
        changed.push(item);
      });
    }
    return changed;
  }

  /** An item of a row that is laid out in it: displayed, and not out of the flow. */
  private inFlowOfRow(node: EngineNode): boolean {
    if (readStyle(node, 'display') === 'none') return false;
    return !OUT_OF_FLOW.has(readStyle(node, 'position') as string);
  }

  /** An item as `lineShares` takes one, or nothing for one that does not grow from nothing. */
  private sharerOf(node: EngineNode): Sharer | undefined {
    if (!node.shareMin) return this.unsharing(node);
    const least = node.shareMin?.width;
    const basis = readStyle(node, 'flexBasis');
    const flex = readStyle(node, 'flex');
    const grow = typeof flex === 'number' ? flex : readStyle(node, 'flexGrow');
    const fromNothing = typeof flex === 'number' || basis === 0 || basis === '0%';
    // One that does not grow is held at its least: `flex: 0`.
    const grows = typeof grow === 'number' ? grow : 0;
    if (least === undefined || !fromNothing) return undefined;
    return { grow: grows, least, around: marginsAlong(node) };
  }

  /**
   * An item that takes no share of its row, as what it takes of a line: the width it was laid
   * out at. Nothing for one that grows from its content, whose width is the line's to give.
   */
  private unsharing(node: EngineNode): Sharer | undefined {
    const grow = readStyle(node, 'flexGrow');
    if (typeof readStyle(node, 'flex') === 'number' || (typeof grow === 'number' && grow > 0)) {
      return undefined;
    }
    const box = this.boxOf(node);
    return box ? { grow: 0, least: box[2]!, around: marginsAlong(node) } : undefined;
  }

  private gapOf(row: EngineNode): number {
    const gap = readStyle(row, 'columnGap') ?? readStyle(row, 'gap');
    return typeof gap === 'number' ? gap : 0;
  }

  private wrapsRow(row: EngineNode): boolean {
    const wrap = readStyle(row, 'flexWrap');
    return wrap === 'wrap' || wrap === 'wrap-reverse';
  }

  /** Whether an item's minimum is to be read: it never was, or something in it moved or grew. */
  private minimumIsStale(node: EngineNode): boolean {
    if (!node.shareMin || this.topOf(node) !== this.root) {
      this.minimums.delete(node);
      return false;
    }
    if (node.shareMin.width === undefined) return true;
    for (const box of this.movedBoxes) if (box !== node && isWithin(box, node)) return true;
    for (const box of this.grownBoxes) if (isWithin(box, node)) return true;
    return false;
  }

  /** Reconcile what is dirty and hand the tree to Fabric, which lays it out before returning. */
  private commitTree(): void {
    // A commit of its own, such as a grid's once native has measured it, styles what a sheet
    // added since the last `commit` matches as well.
    this.markAdded();
    // What `:has()` answers is kept for the commit, where a sheet asks it: see `keepHasAnswers`.
    keepHasAnswers(this.hasSheets);
    try {
      this.commitWhole();
    } finally {
      keepHasAnswers(false);
      this.markedBefore.clear();
      this.placesMarked.clear();
      this.placesMarkedAfter.clear();
    }
  }

  private commitWhole(): void {
    // One epoch per commit. Node props do not change while a commit runs, so every node can be
    // resolved once and shared with each of its descendants for the length of this walk.
    this.styleEpoch++;
    const set = this.fabric.createChildSet(this.rootTag);
    let handles = this.rootHandles();
    // Again, where transitions it laid out where they end are to be eased from JavaScript.
    if (this.layOut()) {
      handles = this.rootHandles();
      // What that found resized is the transitions themselves, at the frame they are eased to.
      this.movesOthers = false;
    }
    for (const handle of handles) this.fabric.appendChildToSet(set, handle);
    this.clearFlags(this.root);
    this.announceCommit();
    this.fabric.completeRoot(this.rootTag, set);
  }

  /** The fixed boxes each page, or the root, is committed with. */
  private readonly fixedIn = new Map<EngineNode, Set<EngineNode>>();
  /** Boxes found to be fixed while they were being committed under their parent. */
  private readonly fixedLate = new Set<EngineNode>();

  /** What a finger is on, while one is down. */
  private fingerOn: EngineNode | null = null;
  /** Boxes that became fixed or absolute with the finger on them, left under their parents. */
  private readonly fixedUnderFinger = new Set<EngineNode>();

  /** Note what a finger comes down on, and once the last has lifted move what waited for it. */
  private trackFinger(target: EngineNode | null, type: string, nativeEvent: unknown): void {
    const fingers = (nativeEvent as { touches?: readonly unknown[] } | null)?.touches?.length ?? 0;
    // The first finger down is a new touch, whether or not the last one's end was heard.
    if (type === TOUCH_START && fingers <= 1) this.fingerOn = target;
    if ((type !== 'topTouchEnd' && type !== 'topTouchCancel') || fingers > 0) return;
    this.fingerOn = null;
    for (const node of this.fixedUnderFinger) {
      if (!isWithin(node, this.root)) continue;
      this.refix(node, readStyle(node, 'position'));
      this.markProps(node, false);
    }
    this.fixedUnderFinger.clear();
  }

  /** The page a box is on: the nearest view that holds one, or the root. */
  private pageOf(node: EngineNode): EngineNode | null {
    let page = node.parent;
    while (page?.parent && !FIXED_BOUNDARIES.has(viewNameOf(page))) {
      page = page.parent;
    }
    return page;
  }

  /** Whether anything between a box and its page scrolls or clips what is inside it. */
  private scrollsOrClips(node: EngineNode, page: EngineNode): boolean {
    for (let up = node.parent; up && up !== page; up = up.parent) {
      if (up.nodeKind !== 'element') continue;
      if (SCROLL_VIEWS.has(viewNameOf(up))) return true;
      if ((readStyle(up, 'overflow') ?? 'visible') !== 'visible') return true;
    }
    return false;
  }

  /**
   * Note a node that has become `position: fixed` inside something that scrolls or clips, which
   * a fixed box does neither with: it is committed under its page in place of its parent. It is
   * being reconciled under its parent as this is asked, so it is committed there once more and
   * moved straight after: see `moveFixed`. Anywhere else a fixed box stays where it is, and is
   * placed against its page by `settleAbsolute`.
   */
  private refix(node: EngineNode, position: unknown): void {
    if (node.fixedTo !== undefined) return;
    // A view that is moved loses its touch: one a finger is on is moved when the finger lifts.
    if (isWithin(this.fingerOn, node)) return void this.fixedUnderFinger.add(node);
    const page = position === 'fixed' ? this.pageOf(node) : this.placedAbove(node);
    if (!page || !(this.scrollsOrClips(node, page) || clipsFixed(position))) return;
    node.fixedTo = page;
    const held = this.fixedIn.get(page) ?? new Set();
    this.fixedIn.set(page, held.add(node));
    this.fixedLate.add(node);
  }

  /**
   * The box an absolute box is placed against, where that is further up than its parent: one
   * under a parent that is not positioned. A browser clips such a box by nothing between the
   * two, where a native view is clipped by every view it is in, so where one of them clips it is
   * committed under the box it is placed against, as a fixed box is under its page.
   */
  private placedAbove(node: EngineNode): EngineNode | null {
    const block = this.containingBlock(node);
    return block === node.parent ? null : block;
  }

  /**
   * Whether a child is committed under its page, and not under its parent. On Android a fixed box
   * is taken there before its parent commits it, so that it is never moved: Android mounts a
   * view moved out of boxes of layout alone wrongly. See `clipsFixed`.
   */
  private onPage(child: EngineNode, context: object | undefined): boolean {
    // A fixed box asks for a layout of CSS's: an app that has none reads no child's position.
    if (
      child.fixedTo === undefined &&
      this.asked & CSS_LAYOUT &&
      child.nodeKind === 'element' &&
      nativePlatform() === 'android'
    ) {
      this.styles.resolve(child, this.styleEpoch);
      const position = readStyle(child, 'position');
      if (clipsFixed(position)) this.refix(child, position);
    }
    return child.fixedTo !== undefined && this.staysFixed(child, context);
  }

  /** Whether a box committed under another still is to be: asked in place of committing it under its parent. */
  private staysFixed(child: EngineNode, context: object | undefined): boolean {
    if (this.stillCommitted(child, context)) return true;
    this.styles.resolve(child, this.styleEpoch);
    const position = readStyle(child, 'position');
    if (position === 'fixed') return true;
    // An absolute one, for as long as it is placed against the same box and still clipped.
    const above = position === 'absolute' ? this.placedAbove(child) : null;
    if (above === child.fixedTo && above && this.scrollsOrClips(child, above)) return true;
    this.fixedIn.get(child.fixedTo!)?.delete(child);
    child.fixedTo = undefined;
    return false;
  }

  /** The view each page's fixed boxes are committed in, and what it was last committed with. */
  private readonly fixedLayers = new WeakMap<
    EngineNode,
    { handle: FabricNode; handles: FabricNode[] }
  >();

  /**
   * The fixed boxes pinned to `page`, committed after its own children so they draw over them,
   * in a view over the whole page: Android's screen view clips each view in it to that view's
   * bounds, and a fixed box draws past its own, as a toaster of no height draws its toasts.
   */
  private fixedHandles(page: EngineNode, into: FabricNode[]): void {
    const fixed: FabricNode[] = [];
    this.fixedBoxes(page, fixed);
    if (fixed.length) into.push(this.fixedLayer(page, fixed));
  }

  /** The view `fixedHandles` puts a page's fixed boxes in: the same view each commit. */
  private fixedLayer(page: EngineNode, handles: FabricNode[]): FabricNode {
    const was = this.fixedLayers.get(page);
    if (
      was &&
      was.handles.length === handles.length &&
      handles.every((h, i) => h === was.handles[i])
    )
      return was.handle;
    const handle = was
      ? this.clone(was.handle, null, [...handles])
      : this.fabric.createNode(nextTag(), 'View', this.rootTag, { ...FIXED_LAYER }, page);
    if (!was) for (const child of handles) this.fabric.appendChild(handle, child);
    this.fixedLayers.set(page, { handle, handles });
    return handle;
  }

  /** The fixed boxes pinned to `page`, as they are committed. */
  private fixedBoxes(page: EngineNode, into: FabricNode[]): void {
    const held = this.fixedIn.get(page);
    if (!held) return;
    for (const node of held) {
      if (node.fixedTo !== page || !isWithin(node, page)) {
        held.delete(node);
        if (node.fixedTo === page) node.fixedTo = undefined;
        continue;
      }
      // Inside something that is not displayed, it is not either: nothing of it is committed.
      if (this.hiddenBelow(node, page)) continue;
      const parent = node.parent!;
      const context =
        parent.nodeKind === 'element'
          ? this.styles.resolve(parent, this.styleEpoch).context
          : undefined;
      into.push(this.reconcileUnder(page, node, context));
    }
  }

  /** Whether anything between a node and `page` is `display: none`. */
  private hiddenBelow(node: EngineNode, page: EngineNode): boolean {
    for (let up = node.parent; up && up !== page; up = up.parent) {
      if (up.nodeKind !== 'element') continue;
      this.styles.resolve(up, this.styleEpoch);
      if (readStyle(up, 'display') === 'none') return true;
    }
    return false;
  }

  /** Commit again with each box that has just become fixed under its page, in the same task. */
  private moveFixed(): void {
    if (!this.fixedLate.size) return;
    this.touch(this.fixedLate);
    this.fixedLate.clear();
    this.commitTree();
  }

  /**
   * What the engine lays out in Yoga's place, for a node being reconciled: a block's flow, a
   * grid, and a fixed, sticky or out-of-flow box. Its display and position are read once here,
   * since this is asked of every node reconciled and most are none of these.
   */
  private relayout(node: EngineNode): void {
    // A frame that only paints moved no box: see `layoutStale`.
    if (node.nodeKind !== 'element' || this.paintOnly) return;
    // A box given other styles may give what is in it other room: see `settleFits`.
    if (node.propsDirty && this.fits.size && !this.settling) this.restyled.add(node);
    if (!(this.asked & CSS_LAYOUT)) {
      // Asked here, and not by a call: most apps have neither a share nor a sum.
      if (this.asked & LAYOUTS && !this.settling) this.replanPlain(node);
      return;
    }
    if (this.inlines) this.settleInlines(node);
    this.replan(node);
  }

  /**
   * `replan` for an app nothing in which has asked for a layout of CSS's: what a box of plain
   * flex can still need of the engine, a share of a box as wide as its content and a
   * percentage with a length added. See `asked`.
   */
  private replanPlain(node: EngineNode): void {
    if (node.mixed) node.mixed.dirty = true;
    if (this.asked & SHARED_WIDTHS) this.noteFits(node);
  }

  /**
   * What has been asked for that the engine works out in Yoga's place, as the bits of `asks`:
   * by a sheet, a style or a package that gives elements a browser's defaults. Until something
   * asks, a node is asked none of what that takes, which is most of what is asked of one: an
   * app of native views and flex is laid out by Yoga alone. Nothing is taken back, as a sheet
   * is never forgotten.
   */
  private asked = askMode() === 'all' ? EVERYTHING : 0;
  private readonly checksAsks = askMode() === 'check';
  /** The boxes that asked for a layout of CSS's as they were merged: see `laidOut`. */
  private readonly askedLate = new Set<EngineNode>();

  private want(bits: number): void {
    // A layout asked for in a commit has none of what changed before it noted: see `heldIn`.
    if (bits & LAYOUTS & ~this.asked) {
      this.changesHeld = false;
      this.holders = undefined;
    }
    this.asked |= bits;
    this.notesMoves = this.asked !== 0;
  }

  /** The sheets whose asks are in `asked` already: read once each, as a sheet does not change. */
  private readonly askingSheets = new WeakSet<StyleSheet>();

  private watchLayout(sheet: StyleSheet | null | undefined): void {
    // Asked for every element a component's sheet is given to.
    if (!sheet || this.asked === EVERYTHING || this.askingSheets.has(sheet)) return;
    this.askingSheets.add(sheet);
    this.want(sheetAsks(sheet));
  }

  /**
   * Commit the tree, and again where a box asked for a layout of CSS's as it was merged, by
   * what it came to and no one declaration: it had been planned as a box of plain flex by
   * then, so it is planned and merged again, now that it is asked what it was not.
   */
  private commitAsAsked(): void {
    this.commitTree();
    if (!this.askedLate.size) return;
    this.touch([...this.askedLate]);
    this.askedLate.clear();
    this.paintOnly = false;
    this.commitTree();
  }

  /**
   * A test run's check that nothing was left unasked: throw where a node being merged would
   * be laid out by what no declaration has asked for, which a sheet or a style is not read for.
   */
  private checkAsked(node: EngineNode, merged: Record<string, unknown>): void {
    const missed = this.asked & CSS_LAYOUT ? [] : this.unaskedLayout(node, merged);
    if (!(this.asked & MIXED_SIZES) && takeMixed(node, { ...merged })) missed.push('a sum');
    if (!(this.asked & SHARED_WIDTHS) && sharesWidth(node)) missed.push('a share');
    if (missed.length) throw new Error(`Laid out by what nothing asked for: ${missed.join(', ')}`);
  }

  /** What a layout of CSS's would make of a node that no declaration asked for one of. */
  private unaskedLayout(node: EngineNode, merged: Record<string, unknown>): string[] {
    const copy = { ...merged };
    const [autoMin, shareMin] = [node.autoMin, node.shareMin];
    this.flowed(node, copy);
    gridLayout(node, copy);
    autoMinimum(node, copy);
    shareMinimum(node, copy);
    notNative(copy);
    const missed = node.autoMin || node.shareMin ? ['a minimum'] : [];
    [node.autoMin, node.shareMin] = [autoMin, shareMin];
    for (const key of new Set([...Object.keys(copy), ...Object.keys(merged)])) {
      if (!Object.is(copy[key], merged[key])) missed.push(key);
    }
    return [...missed, ...unaskedPlan(node)];
  }

  /** Whether any element has been said to be inline: only then is any looked for. */
  private inlines = false;

  /**
   * Settle the display of a box that is inline in a browser, and of each such box it holds:
   * those first, since the plan about to be made for this one reads them, and each is reconciled
   * after it.
   */
  private settleInlines(node: EngineNode): void {
    for (const child of node.childList) {
      if (child.inlineLevel === 'unless-block') this.settleInline(child);
      else if (child.inlineLevel === 'always') this.settleLine(child);
    }
    if (node.inlineLevel === 'unless-block') this.settleInline(node);
    else if (node.inlineLevel === 'always') this.settleLine(node);
  }

  /**
   * Give an element that is text in a browser, a span or a label, a line to lay out what it
   * holds in, once it holds a box: a label's words and the arrow after them are one line in a
   * browser, and a view's children are a column. Nothing where it holds only text, which a text
   * element lays out itself, or where it has a display of its own.
   *
   * ponytail: the elements that are text and nothing else. A button or a link with no display
   * is inline too, and is left the flex box it has been: one as wide as an item that is as wide
   * as its content, `width: 100%`, is as wide as the room where it sits in a line. Fit the item
   * to its content first if a library leaves a button's display to the browser.
   */
  private settleLine(node: EngineNode): void {
    this.settleBoxed(node);
    const holds =
      inlineText(node) &&
      !isTextElement(node) &&
      node.childList.some((child) => child.nodeKind === 'element');
    if (holds === (node.lined === true)) return;
    const { display, ...rest } = node.defaultStyle ?? {};
    if (holds && display != null) return;
    node.lined = holds || undefined;
    node.defaultStyle = holds ? { ...rest, display: 'inline-block' } : rest;
    node.propsDirty = true;
  }

  /**
   * A span that is a flex box or a grid by its own style is a view, and each span in it an item
   * of it with a paragraph of its own: a toolbar's count, title and description, with a gap
   * between them. Text all the way down is one paragraph otherwise, whatever its display.
   */
  private settleBoxed(node: EngineNode): void {
    const boxed = LAYS_OUT_ITSELF.has(readStyle(node, 'display') as string) || undefined;
    if (boxed === node.boxed) return;
    node.boxed = boxed;
    node.propsDirty = true;
  }

  /** Give an element that is inline in a browser the display it has for what it holds now. */
  private settleInline(node: EngineNode): void {
    this.flowStyles.clear();
    const display = this.holdsBlock(node) ? 'block' : 'inline-block';
    this.flowStyles.clear();
    if (node.defaultStyle?.['display'] === display) return;
    node.defaultStyle = { ...node.defaultStyle, display };
    node.propsDirty = true;
  }

  /** Whether a box holds a block-level box in its flow, through any box that is only inline. */
  private holdsBlock(node: EngineNode): boolean {
    for (const child of node.childList) {
      if (child.nodeKind !== 'element' || this.committedElsewhere(child)) continue;
      const style = this.flowStyle(child);
      const display = style['display'];
      if (display === 'none' || OUT_OF_FLOW.has(style['position'] as string)) continue;
      // By what it holds, where its own display is the engine's or it has no box at all.
      const through = display === 'contents' || this.inlineByDefault(child, style);
      if (through ? this.holdsBlock(child) : !sitsInLine(child, display)) return true;
    }
    return false;
  }

  /** Whether a box's display is the one the engine gave it for being inline in a browser. */
  private inlineByDefault(node: EngineNode, style: Record<string, unknown>): boolean {
    return (
      node.inlineLevel === 'unless-block' && style['display'] === node.defaultStyle?.['display']
    );
  }

  private replan(node: EngineNode): void {
    const display = readStyle(node, 'display');
    const position = readStyle(node, 'position');
    if (node.parent && readStyle(node, 'order') != null) node.parent.ordered = true;
    this.reflow(node, display);
    this.regrid(node, display);
    this.reminimum(node);
    // Something in it changed, which can change the box its percentages are of.
    if (node.mixed && !this.settling) node.mixed.dirty = true;
    if (position === 'fixed' || position === 'absolute') this.refix(node, position);
    else if (position === 'sticky') this.stickies.add(node);
    if (position === 'absolute' || position === 'fixed') this.reabsolute(node, position);
    if (!this.settling) this.noteFits(node);
  }

  /** Have a box fitted to its content again, and the item of a row it is a share of. */
  private noteFits(node: EngineNode): void {
    if (this.sitsInLine(node) || (this.fits.has(node) && this.fitsContent(node))) {
      this.refitted(node);
    }
    if (!sharesWidth(node)) return;
    // The box it is a share of, or one further up that this one is as wide as: each box between
    // has no width of its own, and is as wide as the one it is in.
    for (let around = node.parent; around?.nodeKind === 'element'; around = around.parent) {
      if (this.fitsContent(around)) return this.refitted(around);
      if (!this.wideAsItsBox(around)) return;
    }
  }

  /** Whether a box is as wide as what it holds: an item of a row, or out of the flow. */
  private fitsContent(node: EngineNode): boolean {
    return this.itemOfRow(node) || shrunkOutOfFlow(node);
  }

  /**
   * Whether a box with no width of its own is as wide as the box it is in: a block in the flow,
   * or an item a column stretches. A share of it is then a share of that box.
   */
  private wideAsItsBox(node: EngineNode): boolean {
    const around = node.parent;
    if (around?.nodeKind !== 'element' || readStyle(node, 'width') != null) return false;
    if (readStyle(node, 'display') === 'contents') return false;
    if (OUT_OF_FLOW.has(readStyle(node, 'position') as string)) return false;
    if (around.flow) return !this.sitsInLine(node);
    return !isRow(around) && stretched(node, around);
  }

  private refitted(node: EngineNode): void {
    this.fits.add(node);
    node.fit = { ...node.fit, dirty: true };
  }

  /**
   * Whether a box is an item of a flex row with no width, share or basis of its own, which is
   * as wide as its content: a dialog's pane, in a wrapper that centres it. A box in it that is
   * `width: 100%` is as wide as the item, where to Yoga it is as wide as the room.
   */
  private itemOfRow(node: EngineNode): boolean {
    const row = node.parent;
    if (!row || row.nodeKind !== 'element' || row.flow) return false;
    // One that is `display: contents` is no box, and its children are the row's items.
    if (readStyle(node, 'width') != null || readStyle(node, 'display') === 'contents') return false;
    if (OUT_OF_FLOW.has(readStyle(node, 'position') as string)) return false;
    // An item of a column is as wide as its content too, where the column does not stretch it.
    if (!isRow(row)) return !stretched(node, row);
    return !sharesRow(node) || this.growsFromField(node);
  }

  /**
   * Whether an item grows into its row from the width of what it holds, `flex: 1 1 auto`, and
   * holds a text field as wide as it is. A browser starts it at the field's own width, its
   * characters, and wraps the row on that; a native field holds nothing to be measured by, so
   * the item is fitted as one with no share is, and grows from the width it comes to.
   */
  private growsFromField(node: EngineNode): boolean {
    const basis = readStyle(node, 'flexBasis');
    if (typeof readStyle(node, 'flex') === 'number' || (basis != null && basis !== 'auto')) {
      return false;
    }
    return this.sizedByRoom(node).some((each) => each.props[FIELD_SIZE] != null);
  }

  /**
   * Ask an automatic minimum again: of this node when something under it changed, and of its
   * children when it turns between a row and a column. See `autoMinimum`.
   */
  private reminimum(node: EngineNode): void {
    if (node.autoMin) node.propsDirty = true;
    const row = isRow(node);
    if (node.row !== undefined && node.row !== row) {
      this.touch(node.childList.filter((child) => child.nodeKind === 'element'));
    }
    node.row = row;
  }

  /** The boxes that sit in a line of a block, and so are as wide as their content. */
  private readonly fits = new Set<EngineNode>();

  /** Whether a box is an inline-level one in a block's flow: on a line, at its content's width. */
  private sitsInLine(node: EngineNode): boolean {
    return inALine(node);
  }

  /**
   * Size each box that sits in a line from its content, where Yoga would size it from the room
   * on offer: a box holding a row with a percentage width, or cells that share a row from a
   * basis of nothing. The box is committed with those set aside, its width is read back, and it
   * is committed at that width, which the percentages and the shares are then of.
   */
  private settleFits(): void {
    if (!this.fits.size || !this.fabric.getBoundingClientRect) return;
    this.refitUnderRestyled();
    this.standFitted();
    this.settling = true;
    try {
      // One that is not to be fitted again, and in no room that can have changed, is left.
      let waiting = [...this.fits].filter(
        (node) => (node.fit?.dirty || this.mayHaveMoved(node)) && this.toFit(node),
      );
      // From the innermost: a box is fitted to what it holds, a fitted box among it.
      while (waiting.length) {
        const around = waiting.filter((node) =>
          waiting.some((other) => other !== node && isWithin(other, node)),
        );
        this.fitTogether(waiting.filter((node) => !around.includes(node)));
        waiting = around.filter((node) => this.toFit(node));
      }
    } finally {
      this.settling = false;
    }
  }

  /** The boxes the commit being settled resized or moved, or moved others by: see `noteMoved`. */
  private readonly movedBoxes = new Set<EngineNode>();
  /** Those that only came to hold more: words added to, a child more than there was. */
  private readonly grownBoxes = new Set<EngineNode>();

  /** The nodes the commit being settled changed: their props, their style or their children. */
  private readonly changed = new Set<EngineNode>();
  /**
   * Those of them cloned with nothing that lays a box out: a colour, or what a screen reader
   * is told, as a progress bar's value is each time it ticks. And those cloned with more.
   */
  private readonly quietly = new Set<EngineNode>();
  private readonly loudly = new Set<EngineNode>();
  /** Unset where a box went or the conditions changed, which can move any box: see `heldIn`. */
  private changesHeld = true;
  /** What `heldIn` answered, until something more is changed. */
  private holders: readonly EngineNode[] | null | undefined;

  /** Asked only where a layout of the engine's reads it: see `want` for one asked in a commit. */
  private noteChanged(node: EngineNode): void {
    this.changed.add(node);
    this.holders = undefined;
  }

  /**
   * The boxes every change of the commit being settled is inside, where each is out of the flow
   * with a width and a height of its own, or nothing where any change is not inside one. Yoga
   * lays such a box out at the size it is given, so nothing in it moves a box outside it: a
   * progress bar's indicator, in a track of a set size, can tick on a timer without anything
   * else on the page being read back to see whether it has to be laid out again.
   */
  private heldIn(): readonly EngineNode[] | null {
    if (this.holders !== undefined) return this.holders;
    if (!this.changesHeld) return (this.holders = null);
    const holders = new Set<EngineNode>();
    for (const node of this.changed) {
      if (!this.movedItself(node)) continue;
      const holder = this.holderOf(node);
      if (!holder) return (this.holders = null);
      holders.add(holder);
    }
    return (this.holders = [...holders]);
  }

  /** The nearest box above a node that holds what changes in it, unchanged itself. */
  private holderOf(node: EngineNode): EngineNode | null {
    for (let up = node.parent; up && up !== this.root; up = up.parent) {
      if (!this.movedItself(up) && holdsItsContent(up)) return up;
      // One committed under another view than its parent is laid out in that one.
      if (this.committedElsewhere(up) || this.fixedLate.has(up) || this.isFixedIn(up)) return null;
    }
    return null;
  }

  /** Note whether a node is cloned with more than how it is painted: see `heldIn`. */
  private noteHow(node: EngineNode, payload: Record<string, unknown> | null): void {
    const loud = node.structureDirty || node.remeasure === true || !paintsOnly(payload);
    (loud ? this.loudly : this.quietly).add(node);
    this.holders = undefined;
  }

  /** Whether a node was changed in the commit being settled by more than how it is painted. */
  private movedItself(node: EngineNode): boolean {
    return this.changed.has(node) && (this.loudly.has(node) || !this.quietly.has(node));
  }

  private isFixedIn(node: EngineNode): boolean {
    for (const fixed of this.fixedIn.values()) if (fixed.has(node)) return true;
    return false;
  }

  /**
   * Whether a box can have moved in the commit being settled: see `heldIn`. One asked to be
   * merged again is asked, too: a box read back at a new width is marked for nothing else.
   */
  private mayHaveMoved(node: EngineNode): boolean {
    if (this.changed.has(node)) return true;
    const holders = this.heldIn();
    return holders === null || holders.some((holder) => isWithin(node, holder));
  }

  /**
   * Leave each box that is fitted already as it is, where nothing in it or above it moved: a
   * button pressed and painted another colour leaves the box around it the width it has. One
   * as wide as its room is left as what it holds grows, too: an answer written a letter at a
   * time wraps, and is no wider.
   *
   * ponytail: a word added that cannot wrap, and is wider than the room, is not reached past
   * the room for until the box is next fitted. Read how far the content reaches if one is seen.
   */
  private standFitted(): void {
    const moved = [...this.movedBoxes];
    const grown = [...this.grownBoxes];
    for (const node of this.fits) {
      const fit = node.fit;
      if (!fit?.dirty || fit.width === undefined) continue;
      if (moved.some((box) => isWithin(box, node) || isWithin(node, box))) continue;
      const fuller = grown.some((box) => isWithin(box, node));
      // As it is laid out: one whose content is all a share of it is fitted to nothing.
      const width = Math.max(fit.width, this.boxOf(node)?.[2] ?? 0);
      if (!fuller || width + 0.5 >= this.roomOf(node)) fit.dirty = false;
    }
  }

  /** The boxes whose own styles changed in this commit, while any box is fitted. */
  private readonly restyled = new Set<EngineNode>();

  /**
   * Have each fitted box under a box that was restyled fitted again. The room a box is in can
   * come from far above it, through boxes that are each as wide as what they hold: an overlay's
   * outer box is given the screen, and nothing between it and a calendar says so. The room
   * read from the box's own parent is then the box's own width, and never changes.
   */
  private refitUnderRestyled(): void {
    if (!this.restyled.size) return;
    for (const node of this.fits) {
      if (!node.fit || node.fit.dirty) continue;
      for (let up = node.parent; up; up = up.parent) {
        if (!this.restyled.has(up)) continue;
        node.fit.dirty = true;
        break;
      }
    }
    this.restyled.clear();
  }

  /**
   * Whether a box is to be fitted to its content again. One that is no longer fitted at all, or
   * holds nothing sized by the room, is let go here, and one that stands as it is is left.
   */
  private toFit(node: EngineNode): boolean {
    const fit = node.fit;
    const fitted =
      this.topOf(node) === this.root && (this.sitsInLine(node) || this.fitsContent(node));
    if (!fit || !fitted || readStyle(node, 'width') != null) {
      this.unfit(node);
      return false;
    }
    if (this.fitStands(node, fit)) return false;
    if (this.sizedByRoom(node).length) return true;
    fit.dirty = false;
    this.unfit(node, true);
    return false;
  }

  /**
   * Fit boxes with nothing of each other in them: all committed with what is sized by the room
   * set aside, read, and committed at the widths they came to. Two commits for all of them,
   * where one at a time is two commits of the whole screen for each.
   */
  private fitTogether(nodes: readonly EngineNode[]): void {
    if (!nodes.length) return;
    const boxes = nodes.map((node) => ({ node, fit: node.fit!, inside: this.sizedByRoom(node) }));
    for (const { node, fit, inside } of boxes) {
      fit.dirty = false;
      fit.width = undefined;
      for (const each of inside) each.fitOff = true;
      // One that grows into its row is measured without its share, as what is in it is.
      if (sharesRow(node)) node.fitOff = true;
      this.touch([node, ...inside, ...this.ungrow(fit)]);
    }
    this.commitTree();
    for (const { node } of boxes) this.gridsAgain(node);
    for (const { node, fit, inside } of boxes) {
      const { width, grown } = this.fittedWidth(node);
      for (const each of [node, ...inside]) each.fitOff = undefined;
      fit.width = width;
      fit.grown = grown;
      this.touch([node, ...inside, ...grown]);
    }
    this.commitTree();
    for (const { node, fit } of boxes) {
      this.gridsAgain(node);
      fit.room = this.roomOf(node);
    }
  }

  /**
   * Lay out again each grid in a box whose content's share of the room was just set aside or
   * given back. A grid keeps the width its tracks came to, which was worked out in whatever
   * width it had then: a share of a pane not yet fitted is a share of nothing, and its columns
   * are as narrow as a word.
   */
  private gridsAgain(box: EngineNode): void {
    const grids = gridsIn(box);
    if (!grids.length) return;
    // All started over at once, so that one inside another is measured with nothing around it
    // sized yet, and then laid out from the innermost: a grid is sized from what it holds.
    for (const grid of grids) this.restartGrid(grid, grid.grid!.members);
    this.touch(grids.flatMap((grid) => [grid, ...grid.grid!.members]));
    this.commitTree();
    for (const grid of grids.reverse()) this.settleGrid(grid);
  }

  /**
   * The width a box comes to from the commit just made of it, with what is sized by the room
   * set aside. No wider than the room, and no narrower than what in it cannot get narrower:
   * text wraps to the room, and a row of cells with a least width does not, so it reaches past
   * the box's edge. A browser's box is that wide, and overflows the room it is in.
   */
  private fittedWidth(node: EngineNode): { width: number; grown: EngineNode[] } {
    this.flowStyles.clear();
    const box = this.boxOf(node);
    const within = Math.min(box?.[2] ?? 0, this.roomIn(node.parent));
    // An item of a row is as wide as it was laid out with its shares set aside, and no wider
    // than the row: what reaches past it, a drawer waiting off to one side, is no part of it.
    if (!this.sitsInLine(node)) return { width: within, grown: [] };
    // Its content's reach, and its own padding and border after that.
    const edge = insets(this.flowStyle(node)).Right;
    const width = box ? Math.max(within, this.reachOf(node, box[0]) - box[0] + edge) : within;
    const grown = width > within ? this.growAround(node, width) : [];
    this.flowStyles.clear();
    return { width, grown };
  }

  /**
   * Hold the boxes around a fitted box that overflows its room to its width: each one that is
   * as wide as its content, out to the first with a width of its own or with room enough. A
   * popover's panel around a calendar wider than the room the panel was given: in a browser a
   * flex item is no narrower than its content, and the panel is drawn under all of the calendar.
   */
  private growAround(node: EngineNode, width: number): EngineNode[] {
    const around: { box: EngineNode; needed: number }[] = [];
    // How many of them are in a box sized by what it holds: the ones past the last such box
    // are as wide as their room, a page and the screen it is on, and are left so.
    let held = 0;
    let needed = width;
    for (
      let up = node.parent;
      up && up !== this.root && up.nodeKind === 'element';
      up = up.parent
    ) {
      const style = this.flowStyle(up);
      if (style['width'] != null && style['width'] !== 'auto') break;
      const edge = insets(style);
      needed += edge.Left + edge.Right;
      if ((this.boxOf(up)?.[2] ?? Infinity) >= needed) break;
      around.push({ box: up, needed });
      if (this.sizedByWhatItHolds(up, style)) held = around.length;
    }
    const grown = around.slice(0, held);
    for (const each of grown) each.box.fitMin = each.needed;
    return grown.map((each) => each.box);
  }

  /**
   * Whether a box is as wide as its content and not as its room: out of the flow, on a line, an
   * item of a row, or kept from stretching across a column. A block, and an item stretched
   * across a column, is as wide as the room whatever it holds.
   */
  private sizedByWhatItHolds(node: EngineNode, style: Record<string, unknown>): boolean {
    if (OUT_OF_FLOW.has(style['position'] as string) || this.sitsInLine(node)) return true;
    const parent = node.parent;
    if (!parent || parent.nodeKind !== 'element' || parent.flow) return false;
    if (isRow(parent)) return true;
    const align = style['alignSelf'] ?? readStyle(parent, 'alignItems');
    return align != null && !STRETCHES.has(align as string);
  }

  /** Let go of the boxes a fit was holding wider, and answer them, to be committed again. */
  private ungrow(fit: NonNullable<EngineNode['fit']>): EngineNode[] {
    const grown = fit.grown ?? [];
    for (const each of grown) each.fitMin = undefined;
    fit.grown = undefined;
    return grown;
  }

  /**
   * Whether a box's fit still holds: nothing about it changed, and it was fitted in the room
   * it is in now. A box is no wider than its room, so it is fitted again when that grows or
   * shrinks, though nothing about the box did.
   */
  private fitStands(node: EngineNode, fit: NonNullable<EngineNode['fit']>): boolean {
    if (fit.dirty) return false;
    return fit.width === undefined || this.roomOf(node) === fit.room;
  }

  /** How far right the boxes in a node reach, in the window: past its own edge where they overflow. */
  private reachOf(node: EngineNode, least: number): number {
    let reach = least;
    for (const child of node.childList) {
      if (child.nodeKind !== 'element' || !child.committed) continue;
      const box = this.boxOf(child);
      if (box) reach = Math.max(reach, box[0] + box[2]);
      reach = Math.max(reach, this.reachOf(child, reach));
    }
    return reach;
  }

  /** The room a fitted box is in now, as its parent was last laid out. */
  private roomOf(node: EngineNode): number {
    this.flowStyles.clear();
    const room = this.roomIn(node.parent);
    this.flowStyles.clear();
    return room;
  }

  /** Stop fitting a box, and commit it again as written where it had been given a width. */
  private unfit(node: EngineNode, keep = false): void {
    const had = node.fit?.width !== undefined;
    const grown = node.fit ? this.ungrow(node.fit) : [];
    if (keep) node.fit = { dirty: false };
    else {
      node.fit = undefined;
      this.fits.delete(node);
    }
    if (!had && !grown.length) return;
    this.touch([node, ...grown]);
    this.commitTree();
  }

  /**
   * The boxes inside `node` that Yoga sizes from the room on offer and not from their content:
   * one with a percentage width, and one that takes a share of a row from a basis of nothing.
   * Nothing under a box with a width of its own in points is looked at: that width is its
   * content's room whatever it holds.
   */
  private sizedByRoom(node: EngineNode): EngineNode[] {
    const found: EngineNode[] = [];
    for (const child of node.childList) {
      if (child.nodeKind !== 'element') continue;
      const width = readStyle(child, 'width');
      const shares =
        typeof readStyle(child, 'flex') === 'number' || isNoBasis(readStyle(child, 'flexBasis'));
      if (typeof width === 'string' || shares || isShare(readStyle(child, 'minWidth'))) {
        found.push(child);
      }
      if (typeof width !== 'number') found.push(...this.sizedByRoom(child));
    }
    return found;
  }

  /** The boxes a percentage height in them is of, or may be: see `settleHeld`. */
  private readonly holds = new Set<EngineNode>();

  /** Note the box a node's percentage height or basis is of, which may be held for it. */
  private noteShare(node: EngineNode, style: Record<string, unknown>): void {
    const shares = ['height', 'minHeight', 'flexBasis'].some((key) => isShareOrSum(style[key]));
    const parent = shares ? layoutParent(node) : null;
    // The surface is as tall as native makes it, and never held.
    if (parent?.nodeKind === 'element' && parent !== this.root) this.holds.add(parent);
  }

  /**
   * Hold each box that a percentage height in it is of, and that is as tall as its content, at
   * the height that came to: once the column it is in has sized it, a browser takes the
   * percentage of that height (CSS Flexbox 9.8), where Yoga takes it of the space on offer. The
   * box is read from a commit with each percentage in it set aside, as a browser sizes it, and
   * committed at that height, which a percentage in it is then of and adds nothing to. It is read
   * again when anything in it or beside it moves, and when its width changes.
   */
  private settleHeld(): void {
    if (!this.holds.size || !this.fabric.getBoundingClientRect) return;
    const stale = [...this.holds].filter((node) => this.heldIsStale(node));
    if (!stale.length) return;
    this.settling = true;
    try {
      // Let go first: the commit just made had a box not held as tall as its content already.
      const held = stale.filter((node) => node.heldAt !== undefined);
      for (const node of held) node.heldAt = undefined;
      this.commitTouched(held);
      const holding = stale.filter((node) => {
        const holds = this.holdsHeight(node);
        if (!holds) this.holds.delete(node);
        return holds;
      });
      for (const node of holding) node.heldAt = this.heldBox(node);
      this.commitTouched(holding);
    } finally {
      this.settling = false;
    }
  }

  /** A box's height as it was just committed, and the height of its content box then. */
  private heldBox(node: EngineNode): EngineNode['heldAt'] {
    const box = this.boxOf(node);
    if (!box) return undefined;
    const edge = insets(node.committed?.props ?? {});
    return { width: box[2], height: box[3], inner: Math.max(box[3] - edge.Top - edge.Bottom, 0) };
  }

  /** Whether a box is to be read again: not held yet, moved, or with something in it moved. */
  private heldIsStale(node: EngineNode): boolean {
    if (this.topOf(node) !== this.root) {
      this.holds.delete(node);
      // Merged again if it comes back, without the height it had here.
      if (node.heldAt) node.propsDirty = true;
      node.heldAt = undefined;
      return false;
    }
    if (!node.heldAt) return true;
    if (this.boxOf(node)?.[2] !== node.heldAt.width) return true;
    // Beside it too: across a row, a box beside it can make the row taller.
    const around = node.parent ?? node;
    for (const box of this.movedBoxes) if (isWithin(box, around)) return true;
    for (const box of this.grownBoxes) if (isWithin(box, around)) return true;
    return false;
  }

  /** Whether a box is held: as tall as its content, sized by flex, and a percentage is of it. */
  private holdsHeight(node: EngineNode): boolean {
    if (definiteHeight(node) || !NO_HEIGHT.has(ownLayout(node, 'height') as string)) return false;
    return sizedByFlex(node) && holdsShares(node);
  }

  /** The boxes with a declaration that is a percentage and a length: see `settleMixed`. */
  private readonly mixeds = new Set<EngineNode>();

  /**
   * Finish each `calc()` of a percentage and a length from the commit just made: read the box
   * the percentage is of, and commit the box at what the sum comes to. A box in the flow is
   * committed first with those declarations set aside, since the box it is in may be as wide as
   * its content, and in a browser the percentage is of that width without them. It is worked out
   * again when the box or anything in it changes, and when the box it is of changes size.
   * Whether any was worked out.
   */
  private settleMixed(): boolean {
    if (!this.mixeds.size || !this.fabric.getBoundingClientRect) return false;
    this.settling = true;
    try {
      let waiting = [...this.mixeds].filter((node) => this.mixedIsStale(node));
      const settled = waiting.length > 0;
      // From the outermost: a share of a box is of the size that box is finished at.
      while (waiting.length) {
        const inside = waiting.filter((node) =>
          waiting.some((other) => other !== node && isWithin(node, other)),
        );
        this.settleMixedTogether(waiting.filter((node) => !inside.includes(node)));
        waiting = inside.filter((node) => this.mixedIsStale(node, true));
      }
      return settled;
    } finally {
      this.settling = false;
    }
  }

  /** Whether a box is to be worked out: it changed, or the box it is a share of did. */
  private mixedIsStale(node: EngineNode, waited = false): boolean {
    const mixed = node.mixed;
    if (!mixed || this.topOf(node) !== this.root) {
      this.mixeds.delete(node);
      return false;
    }
    const base = this.mixedBase(node);
    return base !== undefined && (waited || mixed.dirty || !sameBase(base, mixed.base));
  }

  /**
   * Work out boxes that are not in one another with two commits between them: one with each
   * set aside, to read what it is a share of, and one with each at what it comes to. A grid and
   * a fitted box are sized from their content in commits of their own.
   */
  private settleMixedTogether(nodes: readonly EngineNode[]): void {
    const alone = (node: EngineNode) => node.grid !== undefined || node.fit !== undefined;
    for (const node of nodes) node.mixed!.dirty = false;
    const measured = nodes.filter((node) => !this.mixedOnlyMoves(node) && this.mixedInFlow(node));
    const plain = measured.filter((node) => !alone(node));
    for (const node of plain) node.mixedOff = true;
    this.commitTouched(plain);
    for (const node of plain) node.mixedOff = undefined;
    const bases = new Map(plain.map((node) => [node, this.mixedBase(node)]));
    for (const node of measured.filter(alone)) bases.set(node, this.measuredBase(node));
    for (const node of nodes) this.workOutMixed(node, bases.get(node));
    this.commitTouched(nodes.filter((node) => !alone(node)));
    for (const node of nodes.filter(alone)) this.commitMixed(node);
    // A grid laid out again may have been merged with no sum left: a size of its tracks'.
    for (const node of nodes) if (node.mixed) node.mixed.base = this.mixedBase(node);
  }

  /** What a node's sums come to against the box they are of, read now where none was given. */
  private workOutMixed(node: EngineNode, base: readonly [number, number | undefined] | undefined) {
    const against = base ?? this.mixedBase(node);
    if (!against || !node.mixed) return;
    const inColumn = node.parent !== null && !isRow(node.parent);
    node.mixed.values = mixedValues(node.mixed.parts, against, this.boxOf(node), inColumn);
  }

  private commitTouched(nodes: readonly EngineNode[]): void {
    if (!nodes.length) return;
    this.touch(nodes);
    this.commitTree();
  }

  /** A translate moves nothing but the box itself: nothing is measured again for one. */
  private mixedOnlyMoves(node: EngineNode): boolean {
    return Object.keys(node.mixed!.parts).every((key) => key.startsWith('translate'));
  }

  private mixedInFlow(node: EngineNode): boolean {
    const position = readStyle(node, 'position');
    return position !== 'absolute' && position !== 'fixed';
  }

  /**
   * Commit a node whose mixed declarations were set aside or worked out. A grid, and a box in
   * a line, is sized from its content and keeps the width that came to, so it is sized again
   * from the start: left as it was, it would be measured at the width its last limit gave it.
   */
  private commitMixed(node: EngineNode): void {
    if (node.grid) return this.settleGrid(node);
    this.touch([node]);
    this.commitTree();
    if (!node.fit) return;
    node.fit.dirty = true;
    if (this.toFit(node)) this.fitTogether([node]);
  }

  /**
   * The box a node's percentages are of, with its mixed declarations set aside: a box in the
   * flow can be what makes its container as wide as it is. One out of the flow makes nothing
   * wider, so the box it is placed in is read as it stands.
   */
  private measuredBase(node: EngineNode): readonly [number, number | undefined] | undefined {
    node.mixedOff = true;
    this.commitMixed(node);
    node.mixedOff = undefined;
    return this.mixedBase(node);
  }

  /**
   * The width and height a node's percentages are of: the padding box of what an out-of-flow
   * box is placed in, and the content box of its parent for any other. The height is nothing
   * where the parent was given none, as a percentage of an `auto` height is in a browser.
   */
  private mixedBase(node: EngineNode): readonly [number, number | undefined] | undefined {
    const position = readStyle(node, 'position');
    if (position === 'absolute' || position === 'fixed') {
      const box = this.paddingBox(node.fixedTo ?? this.containingBlock(node));
      return box && [box[2], box[3]];
    }
    const parent = node.parent;
    if (!parent || parent === this.root)
      return this.paddingBox(this.root)?.slice(2) as [number, number];
    const box = this.boxOf(parent);
    if (!box) return undefined;
    this.flowStyles.clear();
    const style = this.flowStyle(parent);
    const edge = insets(style);
    this.flowStyles.clear();
    // Written, or given by the layout around it, or held at its content's: see `settleHeld`.
    const given = (style['height'] != null && style['height'] !== 'auto') || definiteHeight(parent);
    return [box[2] - edge.Left - edge.Right, given ? box[3] - edge.Top - edge.Bottom : undefined];
  }

  /** The out-of-flow boxes Yoga does not place as CSS does: see `settleAbsolute`. */
  private readonly unplaced = new Set<EngineNode>();

  /**
   * Note a fixed box, an out-of-flow one with an `auto` margin or no inset in a block, and one
   * in a grid.
   */
  private reabsolute(node: EngineNode, position: unknown): void {
    if (this.settling) return;
    // Styled again itself: its own insets, margins or lines may be others. See `concernedBy`.
    if (node.propsDirty) this.restyledPlaced.add(node);
    // A fixed box is placed against its page, wherever in the page it is written.
    const auto = () => MARGIN_KEYS.some((key) => readStyle(node, key) === 'auto');
    // In a grid: placed against the lines it names, or aligned in the grid's padding box.
    const inGrid = () => node.parent?.grid !== undefined;
    // Under a box that is not positioned, it is placed against one further up, and a share of
    // a size is a share of that one's.
    const through = () => node.parent != null && readStyle(node.parent, 'position') === 'static';
    // In a block, or in a line of one: a container the engine lays out as a browser's flow.
    const block = node.parent?.flow !== undefined;
    if (position === 'fixed' || block || auto() || inGrid() || through()) this.unplaced.add(node);
  }

  /**
   * Resolve from the commit just made what Yoga leaves undone for an out-of-flow box, and commit
   * again where anything changed: `auto` margins between two insets, which centre it, and the
   * place in a block's flow it has with no inset. Both need its size and its container's.
   */
  private settleAbsolute(): void {
    // Emptied whatever comes of it: a screen that has gone is not kept by what was styled in it.
    const restyled = new Set(this.restyledPlaced);
    this.restyledPlaced.clear();
    if (!this.unplaced.size || !this.fabric.getBoundingClientRect) return;
    const concerns = this.concernedBy(restyled);
    const moved: EngineNode[] = [];
    for (const node of this.unplaced) {
      const placed = node.resolved !== undefined || this.placedAsWritten.has(node);
      if (placed && !concerns(node)) continue;
      const resolved = this.resolveAbsolute(node);
      if (resolved === undefined && !node.resolved) {
        this.unplaced.delete(node);
        this.placedAsWritten.add(node);
      }
      if (sameResolved(resolved, node.resolved)) continue;
      node.resolved = resolved;
      moved.push(node);
    }
    if (!moved.length) return;
    this.settling = true;
    try {
      this.touch(moved);
      this.commitTree();
    } finally {
      this.settling = false;
    }
  }

  /**
   * Whether the commit being settled can have changed where an out-of-flow box is placed: it
   * resized or moved something in the box it is placed against, or that box or one above it.
   * A box is placed from its own size, its container's and what comes before it there, each
   * read back from native, and a screen of buttons has one in each: read on every commit, a
   * few hundred reads for a colour that changed somewhere else.
   *
   * A fixed box is asked every time: it is placed against its page, wherever it is written.
   * So is one styled again itself, whose insets, margins or lines may be others while what it
   * is committed with is the same.
   */
  /**
   * The out-of-flow boxes found to need nothing resolved, placed as written: noted again each
   * time one is reconciled, and placed again only for what concerns it, as one resolved is.
   */
  private readonly placedAsWritten = new WeakSet<EngineNode>();

  /** The out-of-flow boxes whose own styles changed since they were last placed. */
  private readonly restyledPlaced = new Set<EngineNode>();

  private concernedBy(restyled: ReadonlySet<EngineNode>): (node: EngineNode) => boolean {
    const boxes = new Set([...this.movedBoxes, ...this.grownBoxes]);
    // Every box with one of them in it, itself among them.
    const around = new Set<EngineNode>();
    for (const box of boxes) {
      for (let up: EngineNode | null = box; up && !around.has(up); up = up.parent) around.add(up);
    }
    // Each change held in a box of a size of its own, which moves nothing outside it, the box
    // itself included: see `heldIn`.
    const holders = this.heldIn();
    return (node) => {
      // Not in one of those boxes: a holder restyled was so in how it is painted alone, or held
      // nothing, since a change that moves it is not held.
      if (holders?.length && !holders.some((holder) => holder !== node && isWithin(node, holder))) {
        return false;
      }
      if (restyled.has(node)) return true;
      if (node.fixedTo || readStyle(node, 'position') === 'fixed') return true;
      const block = this.containingBlock(node);
      if (around.has(block)) return true;
      for (let up: EngineNode | null = block; up; up = up.parent) if (boxes.has(up)) return true;
      return false;
    };
  }

  private resolveAbsolute(node: EngineNode): Record<string, number | null> | undefined {
    if (this.topOf(node) !== this.root) return undefined;
    this.flowStyles.clear();
    const style = this.flowStyle(node);
    const boxes = this.boxesFor(node, style['position']);
    this.flowStyles.clear();
    if (!boxes) return undefined;
    const { box, by, against } = boxes;
    const resolved: Record<string, number | null> = {};
    if (by !== against) Object.assign(resolved, againstPage(style, by, against));
    if (boxes.inArea) {
      const grid = this.flowStyle(node.parent!);
      Object.assign(resolved, startOfArea(style, grid, { by, area: against, box }));
    }
    // Its sizes always; its insets where it is placed by the box it is placed against, which a
    // fixed box is not: those are worked out against its page above.
    const sized = withOwnSizes(node, style);
    Object.assign(resolved, shareOfBlock(sized, against, by === against));
    for (const axis of ABSOLUTE_AXES) {
      const [room, size, width] = [against[axis.size]!, box[axis.size]!, against[2]!];
      Object.assign(resolved, autoMargins(sized, axis, room, size, width));
    }
    const top = this.flowPlace(node, style, by[1]);
    if (top !== undefined) resolved['top'] = top;
    return Object.keys(resolved).length ? resolved : undefined;
  }

  /**
   * An out-of-flow box, the box Yoga positions it by and the box CSS positions it against, each
   * of the last two inside its border. They are one box unless it is fixed in place, where CSS
   * means its page.
   */
  /** The area of a grid an out-of-flow item is placed in: none for a fixed one, on its page. */
  private areaFor(node: EngineNode, block: EngineNode, page: EngineNode, by: readonly number[]) {
    return block === node.parent && page === block ? this.gridArea(node, by) : undefined;
  }

  private boxesFor(node: EngineNode, position: unknown) {
    if (position !== 'absolute' && position !== 'fixed') return null;
    const block = node.fixedTo ?? this.containingBlock(node);
    const page = position === 'fixed' ? (this.pageOf(node) ?? block) : block;
    const [box, by] = [this.boxOf(node), this.paddingBox(block)];
    if (!box || !by) return null;
    const area = this.areaFor(node, block, page, by);
    const against = area ?? (page === block ? by : this.paddingBox(page));
    return against ? { box, by, against, inArea: area !== undefined } : null;
  }

  /**
   * What an out-of-flow child of a grid is placed against: the area between the lines its
   * placement names, in the window. A side it names no line for, or one the grid has not got,
   * is the grid's padding edge. `by` is the grid's box inside its border.
   */
  private gridArea(node: EngineNode, by: readonly number[]): number[] | undefined {
    const grid = node.parent!;
    const style = this.flowStyle(node);
    if (!grid.grid?.area) return undefined;
    // Placed against no lines, its area is the grid's padding box.
    if (!namesLines((key) => style[key])) return [...by];
    const at = grid.grid.area(gridItemStyle(style));
    const box = this.boxOf(grid)!;
    const edge = insets(this.flowStyle(grid));
    const [left, top] = [box[0] + edge.Left, box[1] + edge.Top];
    const x = at.left === undefined ? by[0]! : left + at.left;
    const y = at.top === undefined ? by[1]! : top + at.top;
    const right = at.right === undefined ? by[0]! + by[2]! : left + at.right;
    const bottom = at.bottom === undefined ? by[1]! + by[3]! : top + at.bottom;
    return [x, y, Math.max(right - x, 0), Math.max(bottom - y, 0)];
  }

  /** The box Yoga positions an out-of-flow node by: the nearest ancestor that is not static. */
  private containingBlock(node: EngineNode): EngineNode {
    for (let up = node.parent; up; up = up.parent) {
      if (up.nodeKind !== 'element' || readStyle(up, 'position') !== 'static') return up;
    }
    return this.root;
  }

  /** A box inside its border, which insets are measured from. The root's is the window. */
  private paddingBox(node: EngineNode): readonly [number, number, number, number] | undefined {
    if (node === this.root) {
      const { width, height } = this.viewportSize;
      return width > 0 && height > 0 ? [0, 0, width, height] : undefined;
    }
    const box = this.boxOf(node);
    if (!box) return undefined;
    const edge = this.borderInsets(node);
    const [width, height] = [box[2] - edge.Left - edge.Right, box[3] - edge.Top - edge.Bottom];
    return [box[0] + edge.Left, box[1] + edge.Top, width, height];
  }

  /** A container's borders alone: an inset is measured from inside the border. */
  private borderInsets(container: EngineNode) {
    if (container.nodeKind !== 'element') return NO_INSETS;
    const style = this.flowStyle(container);
    return insets(
      Object.fromEntries(Object.entries(style).filter(([key]) => key.startsWith('border'))),
    );
  }

  /**
   * Where a box with no vertical inset would have been in its block's flow: under the in-flow
   * sibling before it and that sibling's bottom margin, which an out-of-flow box does not
   * collapse with: Chrome has it under the margin, and its own margin under that. `origin` is the
   * top of the container's padding box.
   *
   * ponytail: the sibling's own bottom margin, of points and over none. One its last child's
   * margin collapses into, or a negative one, is a few points out; read the plan's margins if a
   * box under a card's last paragraph is ever seen out.
   */
  private flowPlace(
    node: EngineNode,
    style: Record<string, unknown>,
    origin: number,
  ): number | undefined {
    const flow = node.parent?.flow;
    if (flow?.plan.kind !== 'block' || style['top'] != null || style['bottom'] != null) {
      return undefined;
    }
    const siblings = node.parent!.childList;
    for (let i = siblings.indexOf(node) - 1; i >= 0; i--) {
      const sibling = siblings[i]!;
      const first = flow.lined.get(sibling);
      // A box on a line is in its line box, which the box is under.
      if (first) return this.lineBottom(node.parent!, first, origin);
      const box = flow.members.has(sibling) ? this.boxOf(sibling) : undefined;
      if (box) return box[1] + box[3] + this.marginUnder(sibling) - origin;
    }
    return undefined;
  }

  /** The bottom of the line box `first` starts in `container`, from `origin`, once it is laid out. */
  private lineBottom(container: EngineNode, first: EngineNode, origin: number): number | undefined {
    const handle = first.line?.in === container ? first.line.handle : null;
    const box = handle ? this.fabric.getBoundingClientRect?.(handle, false) : undefined;
    return box ? box[1] + box[3] - origin : undefined;
  }

  /** A box's own bottom margin, where it is points over none. */
  private marginUnder(node: EngineNode): number {
    const margin = this.flowTree.style(node, 'marginBottom');
    return typeof margin === 'number' && margin > 0 ? margin : 0;
  }

  /** Every `position: sticky` box in the tree. */
  private readonly stickies = new Set<EngineNode>();
  /** Each scroll view with a sticky box in it: its offset, and what stops listening for it. */
  private readonly stickyScrolls = new Map<
    EngineNode,
    { x: number; y: number; timer?: ReturnType<typeof setTimeout>; stop: () => void }
  >();

  /**
   * Work out where each sticky box sticks from the commit just made: its place in its scroll
   * view, and the end of its parent, which it does not leave. Native moves it between the two
   * where it can. A host with no layout to read leaves it where it is written.
   */
  private settleSticky(): void {
    if (!this.stickies.size || !this.fabric.getBoundingClientRect) return;
    for (const node of this.stickies) {
      const scroll = this.stickyScroll(node);
      if (scroll) this.stick(node, scroll);
      else this.unstick(node);
    }
    // A scroll view nothing sticks in any more is no longer listened to, or kept.
    for (const [scroll, offset] of this.stickyScrolls) {
      if ([...this.stickies].some((node) => node.sticky?.scroll === scroll)) continue;
      clearTimeout(offset.timer);
      offset.stop();
      this.stickyScrolls.delete(scroll);
    }
  }

  /** The scroll view a box sticks in, or nothing once it is no longer sticky or in the tree. */
  private stickyScroll(node: EngineNode): EngineNode | null {
    if (this.topOf(node) !== this.root || readStyle(node, 'position') !== 'sticky') return null;
    return this.scrollSourceOf(node);
  }

  private stick(node: EngineNode, scroll: EngineNode): void {
    const span = this.stickySpan(node, scroll);
    if (!span) {
      // With no inset it sticks nowhere, as a relative box: its move goes, and it is still asked
      // again, for an inset that comes back. A layout not read yet leaves it as it is.
      const inset = ['top', 'left'].some((key) => typeof readStyle(node, key) === 'number');
      if (!inset && node.sticky) this.loosen(node);
      return;
    }
    // No span yet, so the first one read is a change, and starts the drive.
    const state = (node.sticky ??= {
      scroll,
      axis: span.axis,
      start: NaN,
      stop: NaN,
      shift: 0,
      drive: null,
    });
    this.followScroll(scroll);
    const turned = state.axis !== span.axis;
    this.redrive(node, state, span, scroll);
    this.composeSticky(node);
    this.shiftSticky(node);
    // A move along the other axis, though it may be by as much: committed as the other move.
    if (turned) this.markProps(node, false);
  }

  /** Have native move a sticky box between these offsets, of this scroll view on this axis. */
  private redrive(
    node: EngineNode,
    state: StickyState,
    span: { axis: ScrollAxis; start: number; stop: number },
    scroll: EngineNode,
  ): void {
    const fed = state.scroll === scroll && state.axis === span.axis;
    if (fed && state.start === span.start && state.stop === span.stop) return;
    // Moved to another scroll view, or to stick along the other axis: the drive is fed by the
    // offset it was made for.
    if (!fed) {
      state.drive?.stop();
      state.drive = null;
    }
    Object.assign(state, span, { scroll });
    const range = pinnedRange(span.start, span.stop);
    if (state.drive) state.drive.update(range);
    else {
      const property = span.axis === 'x' ? 'translateX' : 'translateY';
      state.drive = this.composedDrive(node, scroll, scrollFeed(span.axis), property, range);
    }
  }

  /**
   * The scroll offsets a sticky box moves between, read from where the last commit laid it out:
   * from its place in the scroll view less its inset, to the end of its parent.
   */
  private stickySpan(node: EngineNode, scroll: EngineNode) {
    const top = readStyle(node, 'top');
    const axis: ScrollAxis = typeof top === 'number' ? 'y' : 'x';
    const inset = axis === 'y' ? top : readStyle(node, 'left');
    const [box, within, around] = [node, scroll, stickyBlock(node)].map((each) => this.boxOf(each));
    if (typeof inset !== 'number' || !box || !within || !around) return null;
    const [at, size] = axis === 'y' ? [1, 3] : [0, 2];
    const start = box[at]! - within[at]! - inset;
    const end = around[at]! + around[size]! - within[at]! - box[size]! - inset;
    return { axis, start, stop: Math.max(start, end) };
  }

  private unstick(node: EngineNode): void {
    this.stickies.delete(node);
    this.loosen(node);
  }

  /**
   * Have native apply a sticky box's own transform after the move it drives: as a transition
   * native plays has it while one does, and as it is committed otherwise.
   */
  private composeSticky(node: EngineNode, transform = node.committed?.props['transform']): void {
    const state = node.sticky;
    if (!state?.drive) return;
    const own = ownTransform(transform);
    const held = heldTransform(own, () => this.boxSize(node), platformOS !== 'android');
    state.drive.follow(state.lent ?? held ?? []);
  }

  /**
   * Let a sticky box's move go: native stops driving it, and it is committed where it is. A
   * transition of its transform native was easing in the drive is eased on from here.
   */
  private loosen(node: EngineNode): void {
    const state = node.sticky;
    const lent = state?.lent && node.transitions?.get('transform')?.native;
    if (lent) this.backToScriptEased(node, lent, this.now());
    state?.drive?.stop();
    if (state?.shift) this.markProps(node, false);
    node.sticky = undefined;
    if (state?.drive) this.undriven(node, state.shift);
  }

  /**
   * Native goes on drawing what a drive set last once it is gone, which no commit changes (see
   * `Touched`): a box's own transform is set there where it has one or the drive had moved it.
   */
  private undriven(node: EngineNode, moved: number): void {
    const own = ownTransform(node.committed?.props['transform']);
    if ((moved || own !== undefined) && node.owned) {
      this.setOwned(node, { transform: own }, { transform: own });
    }
  }

  /** Write how far a sticky box is moved at its scroll view's offset, where that has changed. */
  private shiftSticky(node: EngineNode): void {
    const state = node.sticky;
    const offset = state && this.stickyScrolls.get(state.scroll);
    if (!state || !offset) return;
    const past = offset[state.axis] - state.start;
    const shift = Math.min(Math.max(0, past), state.stop - state.start);
    if (shift === state.shift) return;
    state.shift = shift;
    this.markProps(node, false);
  }

  /** Keep a scroll view's offset, and move its sticky boxes as it changes. */
  private followScroll(scroll: EngineNode): void {
    if (this.stickyScrolls.has(scroll)) return;
    const offset = { x: 0, y: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    const apply = () => {
      for (const node of this.stickies) if (node.sticky?.scroll === scroll) this.shiftSticky(node);
    };
    const stop = this.setEventListener(scroll, 'topScroll', (event) => {
      const at = (event as { nativeEvent?: { contentOffset?: { x?: number; y?: number } } })
        .nativeEvent?.contentOffset;
      offset.x = at?.x ?? 0;
      offset.y = at?.y ?? 0;
      // Native is moving them already: the transform is written once the scroll pauses.
      if (!this.drivesScroll) return apply();
      clearTimeout(offset.timer);
      offset.timer = setTimeout(apply, STICKY_SETTLE_MS);
    });
    this.stickyScrolls.set(scroll, Object.assign(offset, { stop }));
  }

  /** Every grid container in the tree, or once in it. */
  private readonly grids = new Set<EngineNode>();
  /** Set while grids are laid out, when a node is reconciled for a phase and not for a change. */
  private settling = false;

  /** The children a grid places: elements in its flow, committed under it. */
  private gridMembers(node: EngineNode): EngineNode[] {
    const members = node.childList.filter((child) => {
      if (child.nodeKind !== 'element' || this.committedElsewhere(child)) return false;
      const style = this.flowStyle(child);
      const position = style['position'];
      return style['display'] !== 'none' && position !== 'absolute' && position !== 'fixed';
    });
    // Placed in the order their `order` gives, as written among equals (CSS Grid 8.5).
    const order = (member: EngineNode) => Number(this.flowStyle(member)['order'] ?? 0) || 0;
    return members.some((member) => order(member) !== 0)
      ? members
          .map((member, i) => ({ member, i }))
          .sort((a, b) => order(a.member) - order(b.member) || a.i - b.i)
          .map(({ member }) => member)
      : members;
  }

  /**
   * Note a grid container reconciled for a change, in it or beneath it: its items are committed
   * unsized in this commit, to be read and placed straight after it. Nothing is noted on a host
   * with no layout to read back, where a grid stays the column it would otherwise be.
   */
  private regrid(node: EngineNode, display: unknown): void {
    if (this.settling) return;
    const grid = isGrid(display) && !!this.fabric.getBoundingClientRect;
    if (!grid && !node.grid) return;
    this.flowStyles.clear();
    const members = grid ? this.gridMembers(node) : [];
    const follows = this.follows(node, members);
    this.flowStyles.clear();
    if (follows) return;
    // Every item is merged again, and so is one that has just stopped being an item.
    for (const child of new Set([...(node.grid?.members ?? []), ...members])) {
      child.propsDirty = true;
    }
    for (const child of members) child.gridIn = node;
    node.propsDirty = true;
    if (grid) this.restartGrid(node, members);
    else this.ungrid(node);
  }

  /**
   * Whether a grid laid out already stays as it is for this commit: its own style and each
   * item's are what it was laid out from, and its items are the same ones. What changed is then
   * in an item or beneath one, and is committed as any change is; whether the grid has to be
   * laid out again for it is asked once it has been, of what the change did: see `outgrown`.
   *
   * Laying a grid out is three commits, and most of what changes in one changes nothing it is
   * sized from: a colour, a state, a bar a share of its track wide, a number as long as the last.
   *
   * ponytail: content that comes to want another width with no other sign of it (text of the
   * same length in wider letters, a box beneath given a width) keeps the track it had until the
   * grid is next laid out. Read each item's content width where a track is sized by it if a
   * grid is seen a few points out.
   */
  private follows(node: EngineNode, members: readonly EngineNode[]): boolean {
    const state = node.grid;
    if (!state?.settled || state.phase !== 'placed' || !this.asLaidOut(node, state, members)) {
      return false;
    }
    const followed = (state.followed ??= new Map<EngineNode, Reach>());
    // Read now, of the layout before this commit: after it is what it is compared with.
    for (const member of members) {
      if (this.isClean(member) || followed.has(member)) continue;
      // As it was last read, where nothing has been laid out again since: one read a commit.
      followed.set(member, state.reached?.get(member) ?? this.reach(member));
    }
    return true;
  }

  /** Whether a grid's style and its items, and each item's style, are what it was laid out from. */
  private asLaidOut(node: EngineNode, state: GridState, members: readonly EngineNode[]): boolean {
    const styles = state.styles;
    if (!styles || members.length !== state.members.length) return false;
    if (state.styled !== gridKey(node, this.flowStyle(node))) return false;
    return members.every(
      (member, at) =>
        member === state.members[at] && styles.get(member) === asAKey(this.flowStyle(member)),
    );
  }

  /** How far the content of a grid's item reaches, as it is laid out now. */
  private reach(member: EngineNode): Reach {
    const own = this.boxOf(member);
    let bottom = 0;
    let right = 0;
    const note = (box: EngineNode): void => {
      const [left, top, width, height] = this.boxOf(box) ?? [0, 0, 0, 0];
      bottom = Math.max(bottom, top + height);
      right = Math.max(right, left + width);
    };
    for (const child of member.childList) {
      if (child.nodeKind === 'text') paragraphsOf(child).forEach(note);
      else if (
        child.nodeKind === 'element' &&
        !OUT_OF_FLOW.has(readStyle(child, 'position') as string)
      ) {
        note(child);
      }
    }
    if (!own) return { bottom: 0, over: false };
    return { bottom: Math.round(bottom - own[1]), over: right > own[0] + own[2] + 0.5 };
  }

  /**
   * Whether a change a grid was not laid out again for turns out to need it: an item holds
   * more or less than it did, or its content reaches further down, or past its edge.
   */
  private outgrown(state: GridState): boolean {
    const followed = state.followed;
    if (!followed) return false;
    state.followed = undefined;
    for (const [member, before] of followed) {
      if (state.shapes?.get(member) !== shapeOf(member)) return true;
      const now = this.reach(member);
      if (now.bottom !== before.bottom || now.over !== before.over) return true;
      (state.reached ??= new Map()).set(member, now);
    }
    return false;
  }

  /** Start a grid over: its items unsized, and nothing known about them. */
  private restartGrid(node: EngineNode, members: readonly EngineNode[]): void {
    const state = (node.grid ??= this.newGrid(node));
    state.followed = undefined;
    state.reached = undefined;
    Object.assign(state, { phase: 'measuring', settled: false, members });
    Object.assign(state, { height: undefined, ownWidth: undefined });
    state.content.clear();
    state.narrow.clear();
    state.heights.clear();
    state.baselines.clear();
  }

  private ungrid(node: EngineNode): void {
    node.grid?.stopListening?.();
    node.grid = undefined;
    this.grids.delete(node);
  }

  private newGrid(node: EngineNode): GridState {
    this.grids.add(node);
    return {
      phase: 'measuring',
      settled: false,
      members: [],
      content: new Map(),
      narrow: new Map(),
      wantsNarrow: false,
      heights: new Map(),
      baselines: new Map(),
      asked: new Map(),
      widths: new Map(),
      rects: new Map(),
      // A width native gives it later, on a rotation say, lays it out again.
      stopListening: this.setEventListener(node, 'topLayout', () => this.regridIfResized(node)),
    };
  }

  private regridIfResized(node: EngineNode): void {
    const state = node.grid;
    if (!state?.settled || !this.gridResized(node, state)) return;
    this.markProps(node, false);
  }

  private boxOf(node: EngineNode): readonly [number, number, number, number] | undefined {
    const handle = node.committed?.handle;
    return handle ? this.fabric.getBoundingClientRect?.(handle, false) : undefined;
  }

  /** Have these nodes merged again in the next commit, without asking the host for one. */
  private touch(nodes: Iterable<EngineNode>): void {
    for (const node of nodes) {
      node.propsDirty = true;
      for (let up = node.parent; up && !up.subtreeDirty; up = up.parent) up.subtreeDirty = true;
    }
  }

  /**
   * Lay out every grid that changed, or whose box did: read sizes from the commit just made,
   * and commit again with each item placed. An inner grid is laid out once the outer one has
   * given it a width, and the outer one again once the inner one has a height, so this repeats
   * until nothing moves. All of it is in one task, so only the last commit is drawn.
   */
  private settleGrids(): void {
    if (!this.grids.size) return;
    this.settling = true;
    try {
      for (let pass = 0; pass < 4; pass++) {
        const stale = [...this.grids].filter((node) => this.gridIsStale(node));
        if (!stale.length) return;
        // One in another is laid out in the box the other gives it, so after a commit of that.
        const nested = this.gridsNested(stale);
        const apart = stale.filter((node) => !nested.has(node));
        this.measureGrids(apart);
        for (const node of apart) this.settleGrid(node, false);
        if (apart.length) this.commitTree();
        for (const node of nested) this.settleGrid(node);
      }
    } finally {
      this.settling = false;
    }
  }

  private gridIsStale(node: EngineNode): boolean {
    if (this.topOf(node) !== this.root) {
      // All of it goes: a grid put back is laid out from the start, as a new one is.
      this.ungrid(node);
      return false;
    }
    const state = node.grid!;
    if (node.committed !== null && this.outgrown(state)) state.settled = false;
    if (node.committed === null) return false;
    return !state.settled || (this.mayHaveMoved(node) && this.gridResized(node, state));
  }

  /**
   * Whether a grid is another width than it was laid out at. Native answers in floats, and a
   * box at a third of a point across is a hair off the width it was given.
   */
  private gridResized(node: EngineNode, state: GridState): boolean {
    const width = this.boxOf(node)?.[2];
    return width === undefined || state.width === undefined || Math.abs(width - state.width) > 0.5;
  }

  /** Those of some grids that are in another of them, or have another of them inside. */
  private gridsNested(grids: readonly EngineNode[]): Set<EngineNode> {
    const all = new Set(grids);
    const nested = new Set<EngineNode>();
    for (const node of grids) {
      for (let up = node.parent; up; up = up.parent) {
        if (all.has(up)) nested.add(up).add(node);
      }
    }
    return nested;
  }

  /** Commit grids as stacks of their items, to read what each item holds: one commit for all. */
  private measureGrids(grids: readonly EngineNode[]): void {
    const placed = grids.filter((node) => node.grid!.phase !== 'measuring');
    for (const node of placed) {
      this.restartGrid(node, node.grid!.members);
      this.touch([node, ...node.grid!.members]);
    }
    if (placed.length) this.commitTree();
  }

  private settleGrid(node: EngineNode, commit = true): void {
    const state = node.grid!;
    const before = { width: state.ownWidth, height: state.height };
    this.measureGrids([node]);
    const box = this.boxOf(node);
    if (!box) return;
    for (const member of state.members) {
      const [, , width, height] = this.boxOf(member) ?? [0, 0, 0, 0];
      state.content.set(member, { width, height });
    }
    const run = this.gridRun(node, state, box);
    const layout = this.gridRows(node, state, run);
    const height = this.placeGrid(state, run, layout);
    this.touch([node, ...state.members]);
    if (commit) this.commitTree();
    // A grid this one is in sized a row by the height it had, and a column by its width. One
    // it is an item of placed it, at a height that is not its rows' where it stretched it.
    const resized = run.item ? state.height !== before.height : height !== box[3];
    if (resized || state.ownWidth !== before.width) this.unsettleAbove(node);
  }

  /** Note where a grid's layout puts it and its items, and answer how tall it came to. */
  private placeGrid(
    state: GridState,
    run: ReturnType<Engine['gridRun']>,
    layout: GridLayout,
  ): number {
    const height = run.ownHeight ? run.box[3]! : run.rows + run.down;
    // Committed as its style writes a size: of its content box, where that is what it sizes.
    const content = run.style['boxSizing'] === 'content-box';
    state.phase = 'placed';
    state.settled = true;
    state.ownWidth = run.inner === undefined ? undefined : run.inner + (content ? 0 : run.across);
    state.width = run.available.width + run.across;
    state.height = run.ownHeight ? undefined : height - (content ? run.down : 0);
    state.area = layout.area;
    // Yoga places an item out of the flow inside the grid's border: its padding is added here.
    const { Left, Top } = run.padding;
    state.rects = new Map(
      state.members.map((member, i) => {
        const rect = layout.items[i]!;
        return [member, { ...rect, left: rect.left + Left, top: rect.top + Top }];
      }),
    );
    return height;
  }

  /** What a grid is laid out from, read from its style and from the commit that measured it. */
  private gridRun(node: EngineNode, state: GridState, box: readonly number[]) {
    this.flowStyles.clear();
    const style = this.flowStyle(node);
    // The width of the box the grid is in, which a padding written as a share is of: the
    // window's, at the top.
    const within = this.roomIn(node.parent);
    const room = Number.isFinite(within) ? within : this.viewportSize.width || Infinity;
    const whole = Number.isFinite(room) ? room : 0;
    const edge = insets(style, whole);
    const container = gridContainerStyle(style);
    const items = state.members.map((member) => gridItemOf(this.flowStyle(member)));
    state.styled = gridKey(node, style);
    state.styles = new Map(state.members.map((each) => [each, asAKey(this.flowStyle(each))]));
    state.shapes = new Map(state.members.map((each) => [each, shapeOf(each)]));
    this.flowStyles.clear();

    const across = edge.Left + edge.Right;
    const down = edge.Top + edge.Bottom;
    const given = box[2]! - across;
    const limits = sizeLimits(style, across, down);
    // An item of another grid is placed at the width that one gives it, which it measured from
    // the width its tracks come to: worked out whatever width it was given last.
    const item = gridOver(node) !== undefined;
    const stretched = !item && stretchedAcross(node, style);
    const inner =
      !item && ownsWidth(style['width'])
        ? undefined
        : this.gridWidth(
            state,
            {
              measured: item ? 0 : given,
              room: room - across,
              stretched,
              shared: isShare(style['width']),
            },
            {
              container,
              items,
              limits,
            },
          );
    // `fit-content` is its rows' height too: no height of its own. Nor is a share of a box
    // with no height to take it of, which is `auto`: see `percentHeight`.
    const ownHeight = ownsHeight(node, style);
    const available = {
      width: item ? given : (inner ?? given),
      height: ownHeight ? box[3]! - down : undefined,
    };
    const padding = insets(style, whole, false);
    return {
      style,
      container,
      items,
      item,
      inner,
      ownHeight,
      available,
      limits,
      padding,
      across,
      down,
      box,
      rows: 0,
    };
  }

  /**
   * A grid laid out in the width it has: its rows as tall as they come to, or held to its own
   * least and most, or laid out in the row of the grid it is in where that stretches it. `rows`
   * is set to what they came to, before any stretch.
   */
  private gridRows(node: EngineNode, state: GridState, run: ReturnType<Engine['gridRun']>) {
    const { container, items, available, limits, down } = run;
    let layout = this.gridWithHeights(node, state, container, items, available);
    run.rows = Math.max(Math.min(layout.height, limits.maxHeight), limits.minHeight);
    if (run.ownHeight) return layout;
    if (run.rows !== layout.height) {
      // Held to a minimum or a maximum, its rows are laid out in that height, as one it has.
      available.height = run.rows;
      layout = this.gridWithHeights(node, state, container, items, available);
    }
    const stretch = run.box[3]! - down;
    if (run.item && stretchedDown(node, run.style) && stretch !== run.rows) {
      // Stretched down the row of the grid it is in, it is as tall as that row: its own rows
      // are laid out in that, and what it measures at is still what they come to.
      available.height = stretch;
      layout = this.gridWithHeights(node, state, container, items, available);
    }
    return layout;
  }

  /**
   * The width a grid gives itself, or nothing where something else gives it one. It was
   * measured as a stack of its items at their content's width: wider than the widest of them,
   * something gave it that width, and it is kept. As wide as the widest and no wider, nothing
   * did, and it is as wide as its tracks come to, up to the width of what holds it, and within
   * its own least and most.
   */
  private gridWidth(
    state: GridState,
    given: { measured: number; room: number; stretched: boolean; shared: boolean },
    from: { container: Record<string, string>; items: readonly GridItemOf[]; limits: SizeLimits },
  ): number | undefined {
    const { measured, room, stretched } = given;
    const { container, items, limits } = from;
    const widest = Math.max(0, ...state.members.map((member) => state.content.get(member)!.width));
    if (measured > widest + 0.5) return undefined;
    // Narrower than the box it is stretched across, or a share narrower than its items: its
    // own limit or its own width made it so.
    if (stretched && measured < room - 0.5) return undefined;
    if (given.shared && measured < widest - 0.5) return undefined;
    const wanted = this.layOutGrid(state, container, items, {
      width: undefined,
      height: undefined,
    });
    // Stretched, it is no wider than the box it is in: what is in that box may be as wide as
    // the grid is. Otherwise it goes no narrower than its tracks do, with no room to grow.
    const least = stretched
      ? measured
      : this.layOutGrid(state, container, items, { width: 0, height: undefined }).usedWidth;
    state.widths = new Map();
    const width = Math.min(wanted.width, Math.max(least, room));
    return Math.max(Math.min(width, limits.maxWidth), limits.minWidth);
  }

  /** The width inside a box's padding and border, which is the most a child of it is given. */
  private roomIn(node: EngineNode | null): number {
    const box = node && this.boxOf(node);
    if (!node || !box) return Infinity;
    const edge = node.nodeKind === 'element' ? insets(this.flowStyle(node)) : NO_INSETS;
    return box[2] - edge.Left - edge.Right;
  }

  private unsettleAbove(node: EngineNode): void {
    for (let up = node.parent; up; up = up.parent) if (up.grid) up.grid.settled = false;
  }

  /**
   * The grid laid out, with each height it asks for read from a commit of those items at that
   * width: a row is as tall as its items are at their columns' widths, which only laying them
   * out there says.
   */
  private gridWithHeights(
    node: EngineNode,
    state: GridState,
    container: Record<string, string>,
    items: readonly GridItemOf[],
    available: { width: number; height: number | undefined },
  ) {
    let layout = this.layOutGrid(state, container, items, available);
    if (state.wantsNarrow) {
      this.readNarrow(node, state);
      layout = this.layOutGrid(state, container, items, available);
    }
    for (let round = 0; state.widths.size && round < 3; round++) {
      state.phase = 'sizing';
      this.readSizes(node, state);
      layout = this.layOutGrid(state, container, items, available);
    }
    state.inRow = false;
    return layout;
  }

  /**
   * Commit the items a layout asked the height of, each at the width it asked at, and read them.
   * Baselines are read from a row of every item, lined up by them: see `gridContainer`. Each is
   * counted from that row's baseline, so all that were asked for are read from the one row, and
   * none is kept from a row before it.
   */
  private readSizes(node: EngineNode, state: GridState): void {
    state.inRow = state.wantsBaseline;
    if (state.inRow) {
      for (const [member, width] of state.asked) state.widths.set(member, width);
      state.baselines.clear();
    }
    this.touch(state.inRow ? [node, ...state.members] : state.widths.keys());
    this.commitTree();
    for (const [member, width] of state.widths) {
      const box = this.boxOf(member);
      noteAt(state.heights, member, width, box?.[3] ?? 0);
      if (state.inRow && state.asked.has(member)) {
        noteAt(state.baselines, member, width, -(box?.[1] ?? 0));
      }
    }
  }

  /** The grid whose items' text is committed one word to a line, while their words are read. */
  private wordsOf: EngineNode | null = null;

  /**
   * Read how narrow each item's content goes, which Yoga has no way to say: commit the grid's
   * text one word to a line, with each item at its content's width, and the widest line is the
   * longest word. A box inside that has a width of its own keeps it, as it would in a browser.
   */
  private readNarrow(node: EngineNode, state: GridState): void {
    const texts = state.members.flatMap(textsUnder);
    state.phase = 'words';
    this.wordsOf = node;
    this.touch([node, ...state.members, ...texts]);
    this.commitTree();
    for (const member of state.members) state.narrow.set(member, this.boxOf(member)?.[2] ?? 0);
    // Written back as they were by the next commit, which is the one that sizes or places them.
    this.wordsOf = null;
    this.touch(texts);
  }

  /** One run of the grid layout, noting in `widths` each height it wanted and nothing has read. */
  private layOutGrid(
    state: GridState,
    container: Record<string, string>,
    styles: readonly GridItemOf[],
    available: { width: number | undefined; height: number | undefined },
  ) {
    state.widths = new Map();
    state.wantsNarrow = false;
    state.wantsBaseline = false;
    state.asked = new Map();
    const items: GridItem[] = state.members.map((member, i) => ({
      ...styles[i]!,
      measure: (width) => {
        // Not something Yoga answers: asked for, and read from a commit of its words. See
        // `readNarrow`.
        if (width === 'min') {
          const narrow = state.narrow.get(member);
          if (narrow === undefined) state.wantsNarrow = true;
          return { width: narrow ?? 0, height: 0 };
        }
        if (width === 'max') return state.content.get(member)!;
        const height = state.heights.get(member)?.get(width);
        if (height === undefined) state.widths.set(member, width);
        return { width, height: height ?? 0 };
      },
      baseline: (width) => {
        state.asked.set(member, width);
        const baseline = state.baselines.get(member)?.get(width);
        if (baseline === undefined) {
          state.widths.set(member, width);
          state.wantsBaseline = true;
        }
        return baseline ?? 0;
      },
    }));
    return layOutGrid(container, items, available);
  }

  /** What the root is committed with: the app's top views, or the strict view around them. */
  private rootHandles(): FabricNode[] {
    const handles: FabricNode[] = [];
    for (const child of this.visibleChildren(this.root)) {
      if (this.onPage(child, undefined)) continue;
      if (!this.withheld(child)) handles.push(this.reconcileUnder(this.root, child));
    }
    this.fixedHandles(this.root, handles);
    return this.strict ? [this.inStrictView(handles)] : handles;
  }

  /** The `LayoutConformance` view the app is committed in. See `EngineOptions`. */
  private strictView: FabricNode | null = null;
  private strictChildren: FabricNode[] | null = null;

  /** The app's top views inside the strict view: the same view each commit, with these in it. */
  private inStrictView(children: FabricNode[]): FabricNode {
    if (this.strictView && this.strictChildren && sameHandles(children, this.strictChildren)) {
      return this.strictView;
    }
    this.strictChildren = children;
    this.strictView = this.strictView
      ? this.fabric.cloneNodeWithNewChildren(this.strictView)
      : this.fabric.createNode(
          nextTag(),
          'LayoutConformance',
          this.rootTag,
          { mode: 'strict', display: 'contents' },
          this.root,
        );
    for (const child of children) this.fabric.appendChild(this.strictView, child);
    return this.strictView;
  }

  /** Anchors take part in sibling ordering but never reach Fabric. */
  private visibleChildren(node: EngineNode): EngineNode[] {
    // A view that takes its text as a prop has no text children to commit. See `ViewNameOptions`.
    const textAsProp = takesTextAsProp(node);
    return node.childList.filter(
      (child) => child.nodeKind !== 'anchor' && !(textAsProp && child.nodeKind === 'text'),
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

  /**
   * Exempt from the complexity limit deliberately, as `matchesCompound` is: a flat sequence of
   * steps, each guarded by what it reads, run for every node merged. Moving the guards into calls
   * of their own measured slower in `pnpm bench` and `pnpm bench:tailwind`.
   */
  // eslint-disable-next-line complexity
  private mergeProps(node: EngineNode, viewName: string): Record<string, unknown> {
    if (node.nodeKind === 'text') {
      // Asked first, without a call: no grid's words are being read in nearly every commit.
      if (this.wordsOf === null && this.narrowed === null) return { text: paragraphText(node) };
      return this.textProps(node);
    }
    if (this.dev) this.checkProps(node);
    this.registerSheet(node.templateSheet);
    this.registerSheet(node.hostSheet);
    const defaults = node.scrollView ? OVERFLOW_SCROLLER : DEFAULT_PROPS[viewName];
    const props: Record<string, unknown> = { ...defaults, ...node.defaultStyle };
    // A generated box's style is told from the rest only once a sheet gives one: see `ruleStyle`.
    Object.assign(
      props,
      this.generated === null
        ? this.styles.resolve(node, this.styleEpoch).style
        : this.ruleStyle(node),
    );
    const resolved = props['pointerEvents'];
    writeOwnProps(node.props, props, node.attributeOnly);
    withTextContent(node, viewName, props);
    truncatedAs(node, props);
    const cascaded = props['transform'];
    const inline = inlineOf(node);
    const style = boundTransform(node, Object.assign(props, inline), cascaded);
    // What an element sets itself, inline or bound from a token, over the cascade's other forms of
    // it: the logical or physical side (`overOtherForms`) and the sides a shorthand covers
    // (`underOwnShorthands`). Asked here, not in a method of its own: it is asked of every node.
    if (inline !== NO_STYLE) this.styles.overOtherForms(inline, style);
    if (inline !== NO_STYLE || node.boundByProp?.size) {
      underOwnShorthands(style, inline, node.boundByProp, node.styleCache?.important);
    }
    nativePointerEvents(node, style, resolved);
    // Before an image's own size: `fit-content` is no size, so the image's is what it gets.
    fitContent(node, style);
    if (this.asked & SHARED_HEIGHTS) this.noteShare(node, style);
    // Each asked of the key it reads first: it is asked of every node merged.
    if (style['height'] !== undefined || style['minHeight'] !== undefined) {
      percentHeight(node, style);
    }
    if (style['rowGap'] !== undefined) percentGap(node, style);
    if (this.asked & CSS_LAYOUT) this.flowed(node, style);
    placeholderFaded(style);
    const intrinsic = node.props[INTRINSIC_SIZE] as IntrinsicSize | undefined;
    if (intrinsic) applyIntrinsicSize(style, intrinsic);
    flattenStyle(node.props[STYLE_OVERRIDE], style);
    this.fontFaces.apply(style);
    holdLoadingFamily(node, style);
    // Once the face is matched: a family a view's own font names is the face its weight chose.
    renameFonts(viewName, style, this.postScriptName);
    // What a paragraph alone is styled with: how its text is aligned, cut off and held tall.
    if (viewName === PARAGRAPH) {
      alignText(style, this.directionOf(node, style));
      this.wholeWords(node, style);
      lineTall(style, this.tallestRun(node, style, 0), this.fontScale);
    }
    if (this.fontsRefreshed) this.capForFonts(node, style);
    const field = TEXT_INPUTS.has(viewName);
    if (field) fieldStyled(viewName, style, this.fontScale);
    const merged = composeTransform(node, this.eased(node, style));
    // On iOS: Android's field says the baseline of the line it is sized and centred by.
    if (field) centreSingleLine(viewName, merged, this.fontScale, isOnBaseline(node, viewName));
    // After a transition, which eases the basis as the basis it was written as.
    basisAsSize(node, merged);
    // Each asked of the key it reads first, here and in `engineLayout`: it is asked of every node
    // merged. After the basis, which is a size given where it is committed as one.
    if (merged['aspectRatio'] != null) {
      ratioForAutoSize(merged);
      stretchedOverRatio(node, merged);
    }
    if (merged['flexWrap'] !== undefined) wrappedLinesStretch(merged);
    noOutline(merged);
    this.borderInText(node, merged);
    // Last, on what is committed: an override or an animation can hide a box, or place it.
    hiddenOutOfFlow(merged);
    delete merged['touchAction'];
    if (this.responders.has(node)) stillTouched(merged);
    // Each read here, so asked for as a layout of CSS's is: see `LAID_OUT_HERE`.
    if (this.asked & CSS_LAYOUT) seenByCss(merged);
    this.heldFor(node, merged);
    this.movePaint(node, merged);
    // Asked of the namespace first: it is asked of every node merged.
    if (node.namespace !== undefined && viewName.startsWith('RNSVG')) {
      drawnAsShape(node, viewName, merged);
    }
    if (node.raised !== undefined) merged['zIndex'] ??= node.raised;
    keptForNative(node, merged);
    // What `laidOut` does for a box nothing asked a layout of, unplaced, told here without its
    // two calls: this is asked of every node merged, and an app of plain flex asks nothing.
    if (this.asked !== 0 || this.checksAsks || merged['position'] !== undefined) {
      this.laidOut(node, merged);
    } else {
      if (merged['maxHeight'] !== undefined) leastWins(merged, 'Height');
      if (merged['maxWidth'] !== undefined) leastWins(merged, 'Width');
    }
    return merged;
  }

  /** A run of text as it is committed: a word to a line while how narrow it goes is read. */
  private textProps(node: EngineNode): Record<string, unknown> {
    const text = paragraphText(node);
    // While a grid's words are read: see `readNarrow`.
    const words = (this.wordsOf !== null || this.narrowed !== null) && this.inWords(node);
    return { text: words ? text.trim().replace(/\s+/g, '\n') : text };
  }

  /** A node's part in a block's flow, where a layout of CSS's has been asked for. */
  private flowed(node: EngineNode, style: Record<string, unknown>): void {
    percentBasis(node, style);
    flowLayout(node, style, this.fontScale);
    this.alignLine(node, style);
    onBaseline(node, style);
    alignedInLine(node, style);
  }

  /** What the engine lays out in Yoga's place, of what has been asked for: see `asked`. */
  private laidOut(node: EngineNode, merged: Record<string, unknown>): void {
    const asked = this.asked;
    if (this.checksAsks) this.checkAsked(node, merged);
    engineLayout(node, merged, asked);
    const placed = merged['position'] === 'absolute';
    if (placed && !(asked & CSS_LAYOUT) && asksOfPlaced(merged)) {
      this.want(CSS_LAYOUT);
      this.askedLate.add(node);
    }
    if (asked & LAYOUTS) this.noteSettled(node, merged);
  }

  /** What a node's rules give it: for a generated box with no content, nothing but `display: none`. */
  private ruleStyle(node: EngineNode): Readonly<Record<string, unknown>> {
    const { style } = this.styles.resolve(node, this.styleEpoch);
    // Asked of every node a commit: told from a generated box here, without a call.
    return this.generated !== null && isGenerated(node.tag) ? generatedStyle(style) : style;
  }

  /** Each node's layout styles while one container is planned, so each is merged once. */
  private readonly flowStyles = new Map<EngineNode, Record<string, unknown>>();

  /** A node's own layout styles, in the order `mergeProps` applies them. */
  private flowStyle(node: EngineNode): Record<string, unknown> {
    let style = this.flowStyles.get(node);
    if (style) return style;
    style = { ...node.defaultStyle, ...this.ruleStyle(node) };
    for (const key of FLOW_PROPS) {
      if (node.props[key] !== undefined) style[key] = node.props[key];
    }
    flattenStyle(node.props['style'], style);
    flattenStyle(node.props[STYLE_OVERRIDE], style);
    this.flowStyles.set(node, style);
    return style;
  }

  /** The engine's nodes as `planFlow` reads them. A run of text is a box with no style. */
  private readonly flowTree: FlowTree<EngineNode> = {
    children: (node) => {
      const boxes: EngineNode[] = [];
      for (const child of node.childList) {
        if (child.nodeKind === 'text' && child.nodeText.trim() !== '') boxes.push(child);
        // An element committed somewhere else, an overlay say, is laid out there.
        if (child.nodeKind !== 'element' || this.committedElsewhere(child)) continue;
        const display = this.flowStyle(child)['display'];
        if (display === 'none') continue;
        // No box of its own: its children are laid out here.
        if (display === 'contents') boxes.push(...this.flowTree.children(child));
        else boxes.push(child);
      }
      return boxes;
    },
    style: (node, key) => {
      if (node.nodeKind !== 'element') return undefined;
      const style = this.flowStyle(node);
      // Fixed is out of the flow as absolute is.
      if (key === 'position' && style['position'] === 'fixed') return 'absolute';
      for (const source of FLOW_SOURCES[key]) {
        if (style[source] != null) return style[source];
      }
      // An element said to be always inline, a span, with no display given: a box in a line.
      if (key === 'display' && inlineText(node)) return 'inline-block';
      return undefined;
    },
    hasText: (node) =>
      isTextElement(node) && node.childList.some((child) => child.nodeKind === 'text'),
    isText: (node) => node.nodeKind === 'text',
  };

  /**
   * Whether a node is a block container, or was one when it was last planned. A text element
   * lays out text, not boxes: it has no flow to plan, whatever its display.
   */
  private flows(node: EngineNode, display: unknown): boolean {
    if (node.flow !== undefined) return true;
    return isBlockContainer(display) && !isTextElement(node);
  }

  /**
   * Plan a block container's flow again, and have merged again each child the plan lays out
   * differently: one whose collapsed margins moved, one that joined the flow or left it. A child
   * is planned from its siblings, so nothing about it need have changed for this to change.
   */
  private reflow(node: EngineNode, display: unknown): void {
    if (!this.flows(node, display)) return;
    this.flowStyles.clear();
    const before = node.flow;
    const after = isTextElement(node) ? undefined : this.planFlow(node);
    this.flowStyles.clear();
    if (!before && !after) return;
    node.flow = after;
    if (before?.plan.kind !== after?.plan.kind) node.propsDirty = true;
    leaveFlow(node, before, after);
    joinFlow(node, before, after);
    this.hang(node, before, after);
  }

  /**
   * Work out the room each line needs under its baseline, and how far over the bottom of it
   * each box on it sits, and have merged again the container and each box where that changed:
   * every one of them is placed by it. See `liftLines`.
   */
  private hang(node: EngineNode, before: Flow | undefined, after: Flow | undefined): void {
    if (after) this.liftLines(node, after);
    if (sameHang(before, after)) return;
    node.propsDirty = true;
    for (const child of node.childList) {
      if (child.nodeKind !== 'text') child.propsDirty = true;
      else for (const box of paragraphsOf(child)) box.propsDirty = true;
    }
  }

  /**
   * A browser sits each box on a line by its baseline, and the line has its strut's room under
   * the baseline at least. The engine sits the boxes on the bottom of a row instead, so each is
   * given a margin under it: the room under the line's baseline, the most any box or the strut
   * needs, less the room under the box's own. An empty box's baseline is its bottom edge, and a
   * box of text or of lines has its last line's under it, with its padding and border.
   *
   * ponytail: read from the sheets and the props, where a library's struts are. A shift bound on
   * an element is not seen here until the inline form compiles to one.
   */
  private liftLines(node: EngineNode, flow: Flow): void {
    const runs =
      flow.plan.kind === 'lines'
        ? [this.onLines(node)]
        : [...flow.plan.lines.values()].map((line) => line.boxes);
    if (!runs.some((boxes) => boxes.length)) return;
    const below = this.strutBelow(node);
    const lifts = new Map<EngineNode, number>();
    const unders = new Map<EngineNode, number>();
    const rises = this.riseLines(node, runs);
    for (const boxes of runs) {
      // A box a keyword aligns to the top, middle or bottom of its line is not on its baseline.
      const aligned = boxes.map((box) => this.alignedOnLine(box));
      const depths = boxes.map((box, i) => (aligned[i] ? 0 : this.depthOnLine(box, below)));
      const under = Math.max(below, ...depths);
      boxes.forEach((box, i) => {
        const lift = aligned[i] ? 0 : Math.round((under - depths[i]!) * 1000) / 1000;
        // A run of text is placed as its paragraphs.
        for (const placed of box.nodeKind === 'text' ? paragraphsOf(box) : [box])
          lifts.set(placed, lift);
      });
      if (boxes[0]) unders.set(boxes[0], under);
    }
    flow.lifts = lifts;
    flow.unders = unders;
    flow.rises = rises;
    flow.risen = runs.every((boxes) => boxes.some((box) => rises.has(box)));
    if (flow.plan.kind === 'lines') flow.under = Math.max(below, ...unders.values());
  }

  /**
   * The room over a line's baseline, as its boxes keep it: a box whose height is known is moved
   * down by a top margin to reach as high as the strut does, so the line is as tall over its
   * baseline as a browser has it without a least height of the row it is in. That holds a line
   * in a box with a height of its own, which the row's least height cannot, and lets a line
   * taller than the box it is in reach down out of it, where the row's lines on its bottom
   * would reach up.
   */
  private riseLines(
    node: EngineNode,
    runs: readonly (readonly EngineNode[])[],
  ): Map<EngineNode, number> {
    const inherited = this.styles.resolve(node, this.styleEpoch).inherited;
    const above = strutOf(inherited).above * textScale(inherited, this.fontScale);
    const rises = new Map<EngineNode, number>();
    for (const box of runs.flat()) {
      const reach = this.knownAbove(box, node);
      if (reach !== undefined) rises.set(box, Math.round(Math.max(above - reach, 0) * 1000) / 1000);
    }
    return rises;
  }

  /**
   * How high over the baseline an empty box on a line reaches, with its margins, where that
   * is known before layout: a height in points, or a share of a box of lines held at its
   * content's height, and its padding and border. Nothing for a box aligned another way.
   */
  private knownAbove(box: EngineNode, container: EngineNode): number | undefined {
    if (box.nodeKind !== 'element' || isTextElement(box) || MEASURED_VIEWS.has(viewNameOf(box)))
      return undefined;
    const rule = this.ruleStyle(box);
    if (hungBy(rule) || rule['textAlignVertical'] !== undefined || this.onLines(box).length)
      return undefined;
    const style = this.flowStyle(box);
    // An empty inline-block's baseline is the bottom edge of its margin: both margins are over
    // it. An empty flex or grid box's is the bottom of its border box: see `depthOnLine`.
    const margins = [
      firstOf(style, ['marginTop', 'marginVertical', 'margin']),
      this.emptyFlexOnALine(box, style)
        ? 0
        : firstOf(style, ['marginBottom', 'marginVertical', 'margin']),
    ].map((margin) => (margin == null || margin === 'auto' ? 0 : margin));
    if (margins.some((margin) => typeof margin !== 'number')) return undefined;
    const height = knownHeight(style, blockContentHeight(container));
    return height === undefined
      ? undefined
      : height + (margins[0] as number) + (margins[1] as number);
  }

  /** Whether `vertical-align` sets a box to the top, the middle or the bottom of its line. */
  private alignedOnLine(box: EngineNode): boolean {
    return (
      box.nodeKind === 'element' &&
      LINE_ALIGNED[this.ruleStyle(box)['textAlignVertical'] as string] !== undefined
    );
  }

  /** The boxes in a block's lines: those in its flow, a run of text among them. */
  private onLines(node: EngineNode): EngineNode[] {
    return this.flowTree
      .children(node)
      .filter(
        (child) =>
          child.nodeKind === 'text' ||
          !OUT_OF_FLOW.has(this.flowStyle(child)['position'] as string),
      );
  }

  /**
   * How far under a line's baseline a box on it reaches: a run of text, of the line's font, as
   * far as the strut's room, `below`. See `liftLines`.
   */
  private depthOnLine(box: EngineNode, below: number): number {
    if (box.nodeKind === 'text') return below;
    if (isTextElement(box) || MEASURED_VIEWS.has(viewNameOf(box))) return this.strutBelow(box);
    const style = this.flowStyle(box);
    const own = this.ownUnder(box, style);
    // An empty flex or grid box sits on the baseline by the bottom of its border box, with its
    // bottom margin under it; an empty inline-block, by the bottom of that margin.
    //
    // ponytail: the margin under a box of text or of lines is not counted, which Chrome counts.
    // Count it once a box's lines are told from the blocks in it.
    const margin = this.emptyFlexOnALine(box, style) ? marginUnder(style) : 0;
    return hungBy(this.ruleStyle(box)) + own + margin;
  }

  /** An inline-flex or inline-grid box with nothing in it: its baseline is its border box's bottom. */
  private emptyFlexOnALine(box: EngineNode, style: Record<string, unknown>): boolean {
    return FLEX_ON_A_LINE.has(style['display'] as string) && this.onLines(box).length === 0;
  }

  /**
   * The room under a box's own baseline, inside its margin: none where it has no line in it,
   * or clips what it holds, and its last line's room and its padding and border where it has.
   *
   * ponytail: a box of blocks with text in them is taken to end on a line of its own font.
   */
  private ownUnder(box: EngineNode, style: Record<string, unknown>): number {
    if (clipsToEdge(box, style, this.ruleStyle(box))) return 0;
    const lines = isBlockContainer(style['display']) && this.holdsLines(box);
    const room = lines ? this.lineUnder(box) : holdsText(box) ? this.strutBelow(box) : 0;
    if (room === 0) return 0;
    // A height of its own: its one line is at the top of it, and so is its baseline.
    const tall = this.belowFirstLine(box, style);
    if (tall !== undefined) return tall;
    const border = firstOf(style, ['borderBottomWidth', 'borderWidth']);
    return room + paddingUnder(style) + (typeof border === 'number' ? border : 0);
  }

  /**
   * How far under the baseline of its first line a box with a height in points reaches.
   *
   * ponytail: one line of its own font, as an input or a badge has. A box of a set height with
   * lines of words in it ends lower; count the lines if one is seen.
   */
  private belowFirstLine(box: EngineNode, style: Record<string, unknown>): number | undefined {
    const height = style['height'];
    if (typeof height !== 'number') return undefined;
    const edge = insets(style);
    const border = style['boxSizing'] === 'content-box' ? height + edge.Top + edge.Bottom : height;
    const inherited = this.styles.resolve(box, this.styleEpoch).inherited;
    const above = strutOf(inherited).above * textScale(inherited, this.fontScale);
    return Math.max(border - edge.Top - above, 0);
  }

  /** Whether a block container holds lines: something in its flow, and nothing a block. */
  private holdsLines(box: EngineNode): boolean {
    return this.onLines(box).length > 0 && !this.holdsBlock(box);
  }

  /** The room under the baseline of a box's lines, as `liftLines` works it out for it. */
  private lineUnder(box: EngineNode): number {
    const below = this.strutBelow(box);
    return Math.max(below, ...this.onLines(box).map((child) => this.depthOnLine(child, below)));
  }

  /** The room under the baseline of a node's strut, as native scales its text. */
  private strutBelow(node: EngineNode): number {
    const inherited = this.styles.resolve(node, this.styleEpoch).inherited;
    const below = strutOf(inherited).below * textScale(inherited, this.fontScale);
    return Math.round(below * 1000) / 1000;
  }

  private planFlow(node: EngineNode): Flow | undefined {
    const inBlock = flowOver(node)?.plan.kind === 'block';
    const plan = planFlow(this.flowTree, node, inBlock);
    if (!plan) return undefined;
    const members = new Set(
      this.flowTree
        .children(node)
        .filter((child) => this.flowTree.style(child, 'position') !== 'absolute'),
    );
    const lined = new Map<EngineNode, EngineNode>();
    for (const [first, line] of plan.lines) for (const box of line.boxes) lined.set(box, first);
    return { plan, members, lined };
  }

  /**
   * The z-index a view is drawn at for the boxes in it: the highest of theirs. A browser draws a
   * box with a z-index over what follows the boxes it is in, and a native view is ordered among
   * the views beside it and no further, so each view the box is in is raised as far. Read from
   * what its children committed, which for a raised child is what raised it. A child with a
   * z-index of its own answers with that and nothing from inside it, as the stacking context it
   * is. Only a plain view is raised: a scroll view clips what is in it, and a screen is ordered
   * by its stack.
   *
   * ponytail: a z-index is the one thing read as making a stacking context. Opacity and a
   * transform make one in a browser too; read them here if a box is ever raised past one.
   */
  private raisedBy(node: EngineNode, viewName: string): number | undefined {
    if (viewName !== DEFAULT_VIEW && viewName !== HORIZONTAL_CONTENT) return undefined;
    let over = 0;
    for (const child of node.childList) {
      const z = child.committed?.props['zIndex'];
      if (typeof z !== 'number' || z <= over) continue;
      if (!this.committedElsewhere(child) && !this.withheld(child)) over = z;
    }
    return over || undefined;
  }

  /** Read how far a view is raised, once its children are committed: its props are, if it moved. */
  private raise(node: EngineNode, viewName: string): void {
    const raised = this.raisedBy(node, viewName);
    if (raised === node.raised) return;
    node.raised = raised;
    node.propsDirty = true;
  }

  /**
   * Draw a border that has a width and no colour in the colour of the text, as a browser does:
   * `border-color` starts as `currentColor`, and native starts it as black. Each side with a
   * width, where nothing gave that side a colour. Left to native where there is no text colour
   * to take, which is black in a browser too.
   */
  private borderInText(node: EngineNode, props: Record<string, unknown>): void {
    let text: unknown;
    // The side a logical colour is for is the other one where text is read right to left.
    const flipped =
      (props['borderStartColor'] != null || props['borderEndColor'] != null) &&
      this.styles.readsRightToLeft(props);
    for (const side of BORDER_SIDES) {
      if (!colourless(props, side, flipped)) continue;
      text ??= props['color'] ?? this.styles.resolve(node, this.styleEpoch).inherited['color'];
      if (text == null) return;
      props[side.color] = text;
    }
  }

  /**
   * The tallest line, as the system text size draws it, of the runs of text in a paragraph:
   * none is 0. A run scales as what it is in does, `within`, but for what it says of that
   * itself: one that does not scale, or stops at a size, beside text that does.
   */
  private tallestRun(node: EngineNode, within: Record<string, unknown>, tallest: number): number {
    for (const child of node.childList) {
      if (!isTextElement(child)) continue;
      const scaling = {
        allowFontScaling: child.props['allowFontScaling'] ?? within['allowFontScaling'],
        maxFontSizeMultiplier:
          child.props['maxFontSizeMultiplier'] ?? within['maxFontSizeMultiplier'],
      };
      const line =
        inlineOf(child)['lineHeight'] ??
        this.styles.resolve(child, this.styleEpoch).style['lineHeight'];
      const drawn = typeof line === 'number' ? line * textScale(scaling, this.fontScale) : 0;
      tallest = this.tallestRun(child, scaling, Math.max(tallest, drawn));
    }
    return tallest;
  }

  /**
   * Keep a paragraph whose text has nowhere to wrap on one line, as a browser does: a word is
   * not broken inside, and what does not fit is past the edge. Native breaks a word wider than
   * its line between any two letters. Cut at the edge, where no rule says how it ends.
   */
  private wholeWords(node: EngineNode, props: Record<string, unknown>): void {
    // Remembered, for its text changing to be told from its text changing what this answers.
    node.oneWord = props['numberOfLines'] == null ? unbroken(node) : undefined;
    if (!node.oneWord) return;
    props['numberOfLines'] = 1;
    const ended = [
      this.styles.resolve(node, this.styleEpoch).style,
      node.props,
      inlineOf(node),
      flattenStyle(node.props[STYLE_OVERRIDE], {}),
    ];
    if (ended.every((from) => from['ellipsizeMode'] == null)) props['ellipsizeMode'] = 'clip';
  }

  /**
   * Leave a node's background out of what it commits when a child paints it, and give that child
   * its parent's: the cascade's, and over it the parent's inline style.
   */
  private movePaint(node: EngineNode, merged: Record<string, unknown>): void {
    if (node.paintTaker) {
      // Only the colour is handed over: a background image stays painted on the node.
      this.takenPaint(node, merged['backgroundColor']);
      delete merged['backgroundColor'];
    }
    if (node.paintsOn) for (const key of PAINT_KEYS) delete merged[key];
    const from = node.parent?.paintsOn === node ? node.parent : null;
    if (!from) return;
    const paint = { ...this.styles.resolve(from, this.styleEpoch).style, ...inlineOf(from) };
    for (const key of PAINT_KEYS) if (paint[key] !== undefined) merged[key] = paint[key];
  }

  /** Note the background colour a node that hands it over resolves to, where it changed. */
  private takenPaint(node: EngineNode, color: unknown): void {
    if (color === node.paintTaken) return;
    node.paintTaken = color;
    this.paintReports.add(node);
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
    for (const child of container.childList) {
      if (child.nodeKind !== 'element') continue;
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
    this.noteSheetEasing(sheet);
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
    this.unwatchHas(sheet);
    this.watchHas(next);
    this.watchLayout(next);
    this.unwatchActive(sheet);
    this.watchActive(next);
    this.swapGenerated(sheet, next);
    const at = this.sheetOrder.indexOf(sheet);
    if (at === -1) {
      this.registerSheet(next);
      return;
    }
    this.knownSheets.delete(sheet);
    if (next && !this.knownSheets.has(next)) {
      this.knownSheets.add(next);
      this.noteSheetEasing(next);
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
    for (const child of node.childList) {
      if (child.playing || child.scrolled) this.markProps(child, false);
      this.markAnimated(child);
    }
  }

  /** Every `@font-face` seen, global as on the web: a face declared in one sheet serves all. */
  private readonly fontFaces = new FontFaces();
  private readonly postScriptName: PostScriptNames = (name) => this.fontFaces.postScriptName(name);
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
    for (const child of node.childList) {
      // The paragraph of a run of text written straight into a view is kept on the text.
      if (child.nodeKind === 'text') named(child.box);
      if (child.nodeKind !== 'element') continue;
      if (child.committed && FONT_NAMES[child.committed.viewName]) this.markProps(child, false);
      else named(child);
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

    const written = this.keyframesOf(node, spec.name);
    const frames = written && this.framesFor(node, written);
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
    return Object.assign(props, playedOver(node));
  }

  /**
   * The keyframes a node's animation names: those of its own component's sheet where it has
   * some by that name, as Angular scopes a component's keyframes in a browser, and otherwise
   * whichever sheet has them, since any other is global.
   *
   * ponytail: a host is asked of the sheet it is written in before its own component's, so
   * a `:host` animation is played by its parent's frames where both have the name.
   */
  private keyframesOf(node: EngineNode, name: string): readonly Keyframe[] | undefined {
    const own = node.templateSheet?.keyframes?.[name] ?? node.hostSheet?.keyframes?.[name];
    return own ?? this.keyframes.get(name);
  }

  /** Each node's frames as they settle on it, kept for as long as they settle the same. */
  private readonly settledFrames = new WeakMap<
    EngineNode,
    { of: readonly Keyframe[]; styled: unknown; key: string; frames: readonly Keyframe[] }
  >();

  /**
   * An animation's frames for the node playing it: those with a value that waits for the node,
   * a `var()` it sets, settled against it. The same frames are answered while they settle the
   * same, and others once a variable changes, which is what an animation under way is played
   * on from: see `reframe`.
   */
  private framesFor(node: EngineNode, frames: readonly Keyframe[]): readonly Keyframe[] {
    if (!frames.some((frame) => frame.deferred)) return frames;
    const kept = this.settledFrames.get(node);
    // Styled as it was, it settles as it did: a commit a frame asks, and most change nothing.
    const styled = node.styleCache;
    if (kept?.of === frames && kept.styled === styled) return kept.frames;
    const settled = frames.map(
      (frame) => frame.deferred && this.styles.settleFor(node, frame.deferred, this.styleEpoch),
    );
    const key = JSON.stringify(settled);
    if (kept?.of === frames && kept.key === key) {
      kept.styled = styled;
      return kept.frames;
    }
    const made = frames.map((frame, at) => {
      const values = Object.entries(settled[at] ?? {}).filter(([, value]) => value !== undefined);
      return values.length
        ? { ...frame, declarations: { ...frame.declarations, ...Object.fromEntries(values) } }
        : frame;
    });
    this.settledFrames.set(node, { of: frames, styled, key, frames: made });
    return made;
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

  /** Stop on native each animation and transition whose view has left the tree. */
  private releasePlayedNatively(): void {
    for (const node of [...this.playedNatively]) {
      if (this.topOf(node) === this.root) continue;
      this.stopNative(node, node.playing!);
      node.playing = undefined;
      this.markProps(node, false);
    }
    for (const node of [...this.easedNatively]) {
      if (this.topOf(node) !== this.root) this.stopEased(node);
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
    const pinned = pinnedIn(node, sized.tracks);
    const tracks = unpinned(sized.tracks, pinned);
    const { channels, held, span } = clockChannels(tracks, spec, sized.resting);
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
    running.pinned = pinned;
    // As Animated does: Fabric flattens a view that only lays out, and then there is no native
    // view for the animation to move.
    running.values = { ...running.values, collapsable: false };
    this.playedNatively.add(node);
    return true;
  }

  /**
   * Native reached the end of an animation it was playing. The frame it ends at, or the resting
   * style where it does not fill, is committed, and set on native where the animation set the
   * prop (see `setOwned`). The view is let go first, which puts nothing back on Fabric: it is
   * drawn where the animation left it until then.
   */
  private endedNatively(node: EngineNode, running: RunningAnimation): void {
    if (node.playing !== running || !running.native) return;
    const { native, spec } = running;
    running.native = undefined;
    this.playedNatively.delete(node);
    const end = running.start + spec.duration * (spec.iterations ?? 1);
    native.stop();
    this.advancePlayer(node, Math.max(this.now(), end));
    this.commit();
    // The commit sets only what it changed, and the style the view rests at can be the frame it
    // was committed with as it played: native has drawn it elsewhere since.
    const committed = node.committed;
    if (node.owned && committed) this.setOwned(node, RESET_OWNED, committed.props);
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
      else this.playSomewhere(node, started, props);
      this.emitTransition(node, 'topAnimationstart', spec.name);
      return;
    }
    // A view made again is another view: the one native was moving is gone. And one whose
    // important declarations changed is moving what it now must not, or not what it now may.
    if (node.committed === null || pinsChanged(node, current)) this.backToScript(node, current);
    if (this.playedFrames.get(current) !== frames || inherited !== current.inherited) {
      this.backToScript(node, current);
      this.reframe(node, current, frames, props, inherited);
    }
    this.playOrPause(node, node.playing!, spec);
  }

  /** Play an animation that has just started: by native's layout, by native's driver, or here. */
  private playSomewhere(
    node: EngineNode,
    started: RunningAnimation,
    props: Record<string, unknown>,
  ): void {
    if (this.layPlayed(node, started)) this.laidPlayed.push({ node, running: started });
    else if (!this.playNatively(node, started, props)) this.playing.add(node);
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
    // One native was laying out goes on from JavaScript, by the clock it started on.
    const reframed: RunningAnimation = { ...current, tracks, inherited, laid: undefined };
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
  private readonly scrollExtents = new WeakMap<EngineNode, { x: number; y: number }>();

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
    const same = current?.frames === frames && sameAnimation(current.spec, spec);
    if (same && pinnedIn(node, current.tracks).join(' ') === current.pinned.join(' ')) {
      return Object.assign(props, this.rescrolled(node, current, frames, props, inherited));
    }
    this.stopScrolled(node);
    this.handOverToScroll(node, spec);

    const tracks = tracksOf(frames, props, inherited);
    const pinned = pinnedIn(node, tracks);
    const played = unpinned(tracks, pinned);
    const source = this.scrollSourceOf(node);
    const extent = source ? (this.scrollExtents.get(source)?.[spec.timeline!] ?? null) : null;
    const range = rangeOf(spec, extent);
    const first: Record<string, unknown> = firstFrame(played, spec, range);
    const resting = { ...props };
    if (!source && this.dev) this.reportUnscrolled(spec.name);
    const drive = source ? this.driveScrolled(node, source, spec, played, resting, range) : null;
    // As Animated does: Fabric flattens a view that only lays out, and then there is no native
    // view for the animation to move. Committed with the first frame, so it stays put.
    if (drive) first['collapsable'] = false;
    node.scrolled = { spec, frames, tracks, pinned, resting, first, source, drive, inherited };
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
      // As it is committed: an element that scrolls its overflow is a scroll view too.
      if (SCROLL_VIEWS.has(committedViewName(up))) return up;
    }
    return null;
  }

  private stopScrolled(node: EngineNode): void {
    const scrolled = node.scrolled;
    if (!scrolled) return;
    node.scrolled = undefined;
    scrolled.drive?.stop();
    const playing = scrolled.source && this.scrollTimelines.get(scrolled.source);
    if (!playing) return;
    playing.delete(node);
    // The last to follow this scroll view: a key left here keeps it, and all it is linked to.
    if (!playing.size) this.scrollTimelines.delete(scrolled.source!);
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
        scrollChannels(
          unpinned(scrolled.tracks, scrolled.pinned),
          scrolled.spec,
          scrolled.resting,
          range,
        ).channels,
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
    this.unseenTransitions(node);
    const spec = transitionSpec(props);
    if (!spec && !node.transitions) return props;
    if (spec) keepForTransition(node, props, spec);

    const state = (node.transitions ??= new Map());
    const now = this.now();
    this.takeBackEased(node, state, props, spec, now);
    this.takeBackLaid(state, props, spec, now);
    const started: string[] = [];
    const before = spec && this.paintedBefore(node);

    for (const key of steppedKeys(props, spec, state)) {
      if (step(state, key, props, spec?.[key] ?? spec?.['all'], now, before)) {
        this.running.add(node);
        started.push(key);
        this.emitTransition(node, 'topTransitionstart', key);
      }
    }
    this.easeNatively(node, state, started, props, now);

    if (state.size === 0) node.transitions = undefined;
    return props;
  }

  /**
   * What a view was last painted with, by property, for a transition that arrives with the change
   * it eases: CSS takes the transition from the style after the change and eases from the value
   * before it. Nothing for a view nobody has seen yet, which starts where it is. The individual
   * transforms are read back from the parts the painted transform was put together from.
   */
  private paintedBefore(node: EngineNode): ((key: string) => unknown) | undefined {
    const painted = node.committed?.props;
    // A view that paints its background on a child does not commit it as its own.
    if (!painted || node.paintsOn) return undefined;
    if (node.bornIn !== undefined && node.bornIn >= this.unseen) return undefined;
    // What the styles wrote: a move the engine made before it is no part of what was eased.
    const own = ownTransform(painted['transform']);
    const read = (key: string) => (key === 'transform' ? own : painted[key]);
    const composed = node.composedTransform;
    if (!composed || !sameEntries(own, composed.value)) return read;
    return (key) => {
      if (key === 'transform') return composed.parts[3];
      const part = (INDIVIDUAL_TRANSFORMS as readonly string[]).indexOf(key);
      return part === -1 ? painted[key] : composed.parts[part];
    };
  }

  /** Nobody saw what the last commit gave a view it created, so this is where the view starts. */
  private unseenTransitions(node: EngineNode): void {
    // One with no commit it was born in has been seen, whatever was committed since.
    if (node.bornIn === undefined || node.bornIn < this.unseen) return;
    this.stopEased(node);
    node.transitions = undefined;
  }

  /** The elements native is playing a transition of. */
  private readonly easedNatively = new Set<EngineNode>();

  /**
   * Hand to native each transition that just started and that it can play: opacity and
   * transforms, with no wait before they start. Those that start together, take as long and ease
   * alike share a clock. Nothing of them runs in JavaScript until native says they have ended:
   * a press that fades or slides something is a commit to start it and a commit to end it.
   *
   * ponytail: a colour is eased from JavaScript still, a commit a frame, and so is anything
   * that waits. Native has a colour node for the first; give the driver a channel for it.
   */
  private easeNatively(
    node: EngineNode,
    state: Map<string, Transition>,
    started: readonly string[],
    props: Record<string, unknown>,
    now: number,
  ): void {
    if (started.length) this.startEased(node, state, started, props, now);
    this.layEased(node, state, started, props, now);
    const inScript = [...state.values()].some(
      (eased) => !eased.done && !eased.native && !eased.laid,
    );
    if (!inScript) this.running.delete(node);
    // As Animated does: Fabric flattens a view that only lays out, and then there is no native
    // view for a transition to move.
    if (this.easedNatively.has(node)) props['collapsable'] = false;
  }

  /** When each size in transition was last started, and how many starts in a row came soon. */
  private readonly laidStarts = new WeakMap<
    EngineNode,
    Map<string, { at: number; soon: number }>
  >();

  /**
   * Whether a transition of a size is one sent on again and again, each before the last had
   * ended: a progress bar that steps every 50ms and eases each step over 150. Native moves the
   * view, and lays the screen out, every frame while a layout animation runs, and JavaScript
   * commits every frame while it eases one, so one started at every step is one that never
   * stops. The first, and one sent back before it ends, are played; from the second sent on in
   * a row, each is committed where it ends, and the steps are the motion. Played again once the
   * size has been left alone for as long as it lasts.
   */
  private sentOnAgain(node: EngineNode, key: string, eased: Transition, now: number): boolean {
    const starts = this.laidStarts.get(node) ?? this.laidStarts.set(node, new Map()).get(node)!;
    const last = starts.get(key);
    const soon = last && now - last.at < eased.duration ? last.soon + 1 : 0;
    starts.set(key, { at: now, soon });
    return soon >= 2;
  }

  /** The animations this commit lays out at their last frame, for native to move the views to. */
  private laidPlayed: { node: EngineNode; running: RunningAnimation }[] = [];

  /**
   * Whether an animation that has just started is one native can play by laying the view out
   * at its last frame: two frames of sizes or places, played once from where the view is drawn
   * now, which is where native moves it from. It is then committed at that frame; see `layOut`.
   */
  private layPlayed(node: EngineNode, running: RunningAnimation): boolean {
    const drawn = node.committed?.props;
    const { spec, tracks } = running;
    if (!this.fabric.configureNextLayoutAnimation || !drawn || !tracks.size) return false;
    if (!playedOnce(spec)) return false;
    for (const [key, track] of tracks) {
      if (!LAID_OUT.has(key) || !fromWhereDrawn(track, drawn[key])) return false;
    }
    running.laid = true;
    running.values = Object.fromEntries([...tracks].map(([key, track]) => [key, track[1]!.value]));
    return true;
  }

  /** Go on from JavaScript with an animation native was to lay out, by the clock it started on. */
  private playLaidHere(node: EngineNode, running: RunningAnimation): void {
    running.laid = undefined;
    running.values = sample(running, this.now()).values;
    this.playing.add(node);
  }

  /** An animation native laid out has had its time: it is at its last frame, and says so. */
  private endLaidPlayed(node: EngineNode, running: RunningAnimation): void {
    if (!running.laid || running.done || node.playing !== running) return;
    Object.assign(running, { done: true, laid: undefined });
    if (!this.keeps(node, running)) {
      running.values = {};
      this.markProps(node, false);
    }
    this.emitTransition(node, 'topAnimationend', running.spec.name);
    this.flushTransitionEvents();
    if (this.pending) this.commit();
  }

  /** The transitions this commit lays out where they end, for native to move the views to. */
  private laying: { node: EngineNode; key: string; eased: Transition }[] = [];
  /** Whether this commit resizes or moves a box that is in no such transition. */
  private movesOthers = false;
  /**
   * Whether the boxes a commit moves or resizes are noted: for what the engine lays out in
   * Yoga's place, which is laid out again around them, and for a transition native lays out,
   * which is eased from JavaScript where anything else moves. An app with neither has no use
   * for the note. Kept by `want`, as what is asked grows.
   */
  private notesMoves = this.asked !== 0;

  /**
   * Commit where it ends each transition of a size or a place that just started, for native to
   * move the view there: a layout animation, which the commit asks for once it is known that
   * nothing else in it moves. One still on its way is committed where it ends too. On a host
   * with no layout animation they are eased from JavaScript, but for one sent on again and again.
   *
   * A width eased from JavaScript is a commit a frame, and a commit lays the whole screen out.
   */
  private layEased(
    node: EngineNode,
    state: Map<string, Transition>,
    started: readonly string[],
    props: Record<string, unknown>,
    now: number,
  ): void {
    const native = this.fabric.configureNextLayoutAnimation !== undefined;
    for (const key of started) {
      const eased = state.get(key)!;
      if (!LAID_OUT.has(key) || eased.start > now || eased.duration <= 0) continue;
      if (this.sentOnAgain(node, key, eased, now)) {
        // Where it ends, at once: see `sentOnAgain`.
        Object.assign(eased, { current: eased.to, done: true });
        this.emitTransition(node, 'topTransitionend', key);
        props[key] = eased.to;
        continue;
      }
      if (!native) continue;
      eased.laid = true;
      this.laying.push({ node, key, eased });
    }
    for (const [key, eased] of state) if (eased.laid && !eased.done) props[key] = eased.to;
  }

  /**
   * Before a commit is handed over: ask native to move what it lays out, and take back to
   * ease from JavaScript whatever it cannot: all of it where the commit moves anything else,
   * and otherwise what would not take as long as the longest. Answers whether the tree has to
   * be reconciled again.
   */
  private layOut(): boolean {
    const laying = this.laying;
    const played = this.laidPlayed.filter(({ node, running }) => node.playing === running);
    const others = this.movesOthers;
    this.laying = [];
    this.laidPlayed = [];
    this.movesOthers = false;
    if (!laying.length && !played.length) return false;
    // Native takes one length of time for a commit: the longest asked of it, and whatever
    // would take another is eased from JavaScript. None of it, where anything else moves.
    const longest = Math.max(
      ...laying.map(({ eased }) => eased.duration),
      ...played.map(({ running }) => running.spec.duration),
    );
    const kept = (duration: number) => !others && duration === longest;
    const back: EngineNode[] = [];
    for (const { node, eased } of laying) {
      if (kept(eased.duration)) continue;
      eased.laid = undefined;
      this.running.add(node);
      back.push(node);
    }
    for (const { node, running } of played) {
      if (kept(running.spec.duration)) continue;
      this.playLaidHere(node, running);
      back.push(node);
    }
    for (const node of back) this.markProps(node, false);
    if (!others) this.askLayout(laying, played, longest);
    return back.length > 0;
  }

  /** Ask native to move what the commit lays out over `duration`, and end each when it is up. */
  private askLayout(
    laying: readonly { node: EngineNode; key: string; eased: Transition }[],
    played: readonly { node: EngineNode; running: RunningAnimation }[],
    duration: number,
  ): void {
    const easing =
      laying.find(({ eased }) => eased.laid)?.eased.easing ??
      played.find(({ running }) => running.laid)!.running.spec.easing;
    const nothing = () => undefined;
    this.fabric.configureNextLayoutAnimation!(
      { duration, update: { type: layoutCurve(easing) } },
      nothing,
      nothing,
    );
    for (const { node, key, eased } of laying) {
      if (eased.laid) setTimeout(() => this.endLaid(node, key, eased), duration);
    }
    for (const { node, running } of played) {
      if (running.laid) setTimeout(() => this.endLaidPlayed(node, running), duration);
    }
  }

  /** A transition native laid out has had its time: it is where it ends, and says so. */
  private endLaid(node: EngineNode, key: string, eased: Transition): void {
    if (!eased.laid || eased.done || node.transitions?.get(key) !== eased) return;
    Object.assign(eased, { current: eased.to, done: true, laid: undefined });
    this.emitTransition(node, 'topTransitionend', key);
    // No commit comes of it, which is what tells listeners otherwise: it is where it ends.
    this.flushTransitionEvents();
    // And what a listener did, taking away an element that has left, is committed.
    if (this.pending) this.commit();
  }

  /**
   * Bring a transition native laid out to where its clock has got to, where it is sent another
   * way or its rule has gone: that is where it goes on from.
   */
  private takeBackLaid(
    state: Map<string, Transition>,
    props: Record<string, unknown>,
    spec: Record<string, TransitionSpec> | undefined,
    now: number,
  ): void {
    for (const [key, eased] of state) {
      if (!eased.laid || eased.done) continue;
      const kept = spec?.[key] ?? spec?.['all'];
      if (kept && !aimsElsewhere(eased, key, props)) continue;
      const progress = Math.min(1, Math.max(0, (now - eased.start) / eased.duration));
      eased.current = interpolate(eased.from, eased.to, bezier(eased.easing, progress));
      eased.laid = undefined;
    }
  }

  private startEased(
    node: EngineNode,
    state: Map<string, Transition>,
    started: readonly string[],
    props: Record<string, unknown>,
    now: number,
  ): void {
    if (!this.scrollDriver) return;
    const clocks = new Map<string, string[]>();
    for (const key of started) {
      const eased = state.get(key)!;
      if (!NATIVELY_EASED.has(key) || eased.start > now || eased.duration <= 0) continue;
      const clock = `${eased.duration} ${eased.easing.join()}`;
      clocks.set(clock, [...(clocks.get(clock) ?? []), key]);
    }
    for (const keys of clocks.values()) this.playEased(node, state, keys, props);
  }

  private playEased(
    node: EngineNode,
    state: Map<string, Transition>,
    keys: readonly string[],
    props: Record<string, unknown>,
  ): void {
    const first = state.get(keys[0]!)!;
    // Where the view is committed: one that takes a touch stops short of no opacity.
    const touched = this.responders.has(node);
    // A sticky box's drive moves it, and applies the transform eased here after the move.
    const sticky = keys.includes('transform') ? node.sticky : undefined;
    const lend = sticky?.drive
      ? (entries: readonly FollowingTransform[] | null) => {
          if (node.sticky !== sticky) return;
          sticky.lent = entries ?? undefined;
          this.composeSticky(node);
        }
      : undefined;
    // The moves the engine put before the transform: native paints the transform it eases whole.
    const moves = lend ? [] : engineMoves(node.committed?.props['transform']);
    const seen = (key: string, value: unknown) => {
      if (key === 'transform' && moves.length)
        return [...moves, ...(Array.isArray(value) ? value : [])];
      return touched && key === 'opacity'
        ? stillTouched({ ...props, opacity: value })['opacity']
        : value;
    };
    const tracks = new Map(
      keys.map((key) => {
        const { current, to, easing } = state.get(key)!;
        return [
          key,
          [
            { offset: 0, value: seen(key, current), easing },
            { offset: 1, value: seen(key, to) },
          ],
        ] as const;
      }),
    );
    const spec: AnimationSpec = {
      name: '',
      duration: first.duration,
      delay: 0,
      easing: first.easing,
      iterations: 1,
      fill: 'both',
    };
    const channels = easedChannels(tracks, spec, props);
    if (!channels) return;
    const length = Math.max(2, Math.round(first.duration / NATIVE_FRAME) + 1);
    const frames = Array.from({ length }, (_, i) => i / (length - 1));
    const clock: { keys: readonly string[]; stop(): void } = { keys, stop: () => undefined };
    const native = this.scrollDriver!.play(
      node,
      channels,
      { frames, toValue: 1, iterations: 1 },
      (view) => this.tagOf(view as EngineNode),
      () => this.endedEased(node, clock),
      lend,
    );
    if (!native) return;
    clock.stop = () => native.stop();
    for (const key of keys) state.get(key)!.native = clock;
    this.easedNatively.add(node);
  }

  /**
   * Native reached the end of the transitions on one clock. Where they end is committed before
   * the view is let go, so nothing shows of where they started, which is what it was committed
   * with.
   */
  private endedEased(node: EngineNode, clock: EasedNatively): void {
    const state = node.transitions;
    const keys = clock.keys.filter((key) => state?.get(key)?.native === clock);
    for (const key of keys) {
      const eased = state!.get(key)!;
      Object.assign(eased, { current: eased.to, done: true, native: undefined });
      this.emitTransition(node, 'topTransitionend', key);
      this.markProps(node, false);
    }
    this.forgetEased(node);
    if (keys.length) this.commit();
    clock.stop();
  }

  /** No longer one native is easing, once none of its transitions is native's. */
  private forgetEased(node: EngineNode): void {
    for (const eased of node.transitions?.values() ?? []) if (eased.native) return;
    this.easedNatively.delete(node);
  }

  /**
   * Take back from native each transition it can no longer play as it was started: one sent
   * another way, one whose rule has gone, any of a view that was made again. Each is brought to
   * where its clock has got to, which is where it goes on from, here or on native again.
   */
  private takeBackEased(
    node: EngineNode,
    state: Map<string, Transition>,
    props: Record<string, unknown>,
    spec: Record<string, TransitionSpec> | undefined,
    now: number,
  ): void {
    if (!this.easedNatively.has(node)) return;
    const remade = node.committed === null;
    for (const [key, eased] of state) {
      if (!eased.native) continue;
      const kept = spec?.[key] ?? spec?.['all'];
      if (remade || !kept || aimsElsewhere(eased, key, props)) {
        this.backToScriptEased(node, eased.native, now);
      }
    }
  }

  /** Stop a clock native runs, and go on from JavaScript with each transition it was playing. */
  private backToScriptEased(node: EngineNode, clock: EasedNatively, now: number): void {
    for (const key of clock.keys) {
      const eased = node.transitions?.get(key);
      if (eased?.native !== clock) continue;
      eased.native = undefined;
      const progress = Math.min(1, Math.max(0, (now - eased.start) / eased.duration));
      eased.current = interpolate(eased.from, eased.to, bezier(eased.easing, progress));
      this.running.add(node);
    }
    clock.stop();
    this.forgetEased(node);
  }

  /** A graph of native's was connected to a view: see `Touched`. */
  private touchedNatively(node: EngineNode, tag: number, keys: readonly string[]): void {
    const taken = keys.filter((key) => key === 'opacity' || key === 'transform');
    if (!taken.length) return;
    if (node.owned?.tag !== tag) node.owned = { tag, keys: new Set() };
    for (const key of taken) node.owned.keys.add(key);
  }

  /**
   * Set on native a change of a prop a graph of native's has set on the view before, while no
   * graph of its holds it: the commit cannot change it (see `Touched`). The payload is committed
   * as well, so the shadow node is as the view is drawn. A transform native cannot take as
   * numbers, a matrix in depth, is left committed alone.
   */
  private setOwned(
    node: EngineNode,
    payload: Readonly<Record<string, unknown>>,
    props: Record<string, unknown>,
  ): void {
    const owned = node.owned!;
    const tag = node.committed?.tag;
    if (tag === undefined || owned.tag !== tag || !this.scrollDriver) return;
    const held = this.scrollDriver.held(node);
    const free = (key: string) => key in payload && owned.keys.has(key) && !held.has(key);
    const values: SetValues = {};
    if (free('opacity')) {
      const opacity = props['opacity'];
      values.opacity = typeof opacity === 'number' ? opacity : 1;
    }
    if (free('transform')) {
      const transform = heldTransform(
        props['transform'],
        () => this.boxSize(node),
        platformOS !== 'android',
      );
      if (transform) values.transform = transform;
    }
    if (values.opacity !== undefined || values.transform) {
      this.scrollDriver.set(node, tag, values);
    }
  }

  /** The size a view is laid out at, where it has been. */
  private boxSize(node: EngineNode): { width: number; height: number } | undefined {
    let size: { width: number; height: number } | undefined;
    this.measure(node, (frame) => (size = frame));
    return size;
  }

  /** Forget the props native set on a node's view, which is gone or made again. */
  private disown(node: EngineNode): void {
    node.owned = undefined;
    this.scrollDriver?.forget(node);
  }

  /** Let go of what native is easing on an element that is going, or gone. */
  private stopEased(node: EngineNode): void {
    if (!this.easedNatively.delete(node)) return;
    const clocks = new Set<EasedNatively>();
    for (const eased of node.transitions?.values() ?? []) {
      if (eased.native) clocks.add(eased.native);
      eased.native = undefined;
    }
    for (const clock of clocks) clock.stop();
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

  /** Whether a node, or an element it is in, is `display: none`. */
  private boxless(node: EngineNode): boolean {
    for (let at: EngineNode | null = node; at; at = at.parent) {
      if (at.nodeKind !== 'element') continue;
      this.styles.resolve(at, this.styleEpoch);
      if (ownLayout(at, 'display') === 'none') return true;
    }
    return false;
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
    // One with no box, or in a box with none, paints nothing, and an endless one would keep the
    // frame loop going for good. It is cancelled, as a browser cancels it, and starts again when
    // the node is shown, as it is made again.
    if (this.boxless(node)) {
      this.cancelPlaying(node);
      this.playing.delete(node);
      node.playing = undefined;
      // A commit, for its `animationcancel` to be sent after, and to drop its last frame.
      this.markProps(node, false);
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
    // Its end is still a commit: that is what its `animationend` is sent after. Its last frame
    // gives back what it held, which may be a size: a frame of layout.
    if (!idle || finished) this.tick(node, frameKeys(values, finished));

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
        this.tick(node, [key]);
      }
      if (!live) this.running.delete(node);
    }
    return this.animating;
  }

  /**
   * The host's conversions, applied to a copy. A removed prop travels as `cleared` says, null for
   * nearly every one. On an update a colour dropped as unreadable is null too: JSI leaves out an
   * undefined key, and Fabric keeps what a clone leaves out.
   */
  private processed(props: Record<string, unknown>, update: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === null) out[key] = cleared(key);
      else if (value === undefined) out[key] = value;
      else if (isColorProp(key)) out[key] = this.colourProp(key, value, update);
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
    const aligned = readStyle(row, 'alignItems') === 'baseline';
    const before = row.baselineFields;
    if (!aligned && !before) return;
    const now = new Set(
      aligned ? row.childList.filter(inFlow).map(fieldOnBaseline).filter(isNode) : [],
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
    for (const item of row.childList) {
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
    if ((node.propsDirty || node.structureDirty) && this.asked & LAYOUTS) this.noteChanged(node);
    node.propsDirty = false;
    node.structureDirty = false;
    node.subtreeDirty = false;
  }

  // Exempt from the complexity limit as `mergeProps` is: run for every node a commit restyles,
  // where the clone in a function of its own was a call more a node in `pnpm bench:tailwind`.
  // eslint-disable-next-line complexity
  private reconcile(node: EngineNode): FabricNode {
    // A clean node can still need re-rendering: if an ancestor's class changed, what this node
    // inherits changed with it, and nothing marked this node dirty. The resolver hands back the
    // very same cache object when nothing has changed, so one reference comparison settles it,
    // and a subtree whose inherited context is unmoved is skipped exactly as before.
    const style = node.nodeKind === 'element' ? this.styles.resolve(node, this.styleEpoch) : null;
    const styleChanged = node.styleCommitted !== style;
    if (this.isClean(node) && !styleChanged) return node.committed!.handle;
    // What a commit changed is noted, and a box planned again, for a layout of the engine's.
    const layouts = this.asked & LAYOUTS;
    if (layouts !== 0 && styleChanged) this.noteChanged(node);
    node.styleCommitted = style;
    repaint(node);
    this.refitChildren(node);
    if (layouts !== 0) this.relayout(node);
    const scroller = node.scrollsOverflow === true && this.settleScrolling(node);
    const viewName = committedViewName(node);
    this.forgetRenamed(node, viewName);
    this.noteBaselineFields(node);
    this.freshBaselines(node);
    const childHandles = this.reconcileChildren(node, viewName, style);
    if (this.fixedIn.size) this.fixedHandles(node, childHandles);
    this.raise(node, viewName);
    noteTouches(node, style);
    if (scroller) return this.reconcileScroller(node, viewName, childHandles, styleChanged);
    const previous = node.committed;
    this.notePresented(node, viewName);
    if (!previous)
      return this.create(node, viewName, this.mergeProps(node, viewName), childHandles);
    // A node that is committed, cloned for what changed of it: its props, its children.
    // `propsDirty` is precise: Angular only calls setProperty when a binding actually changed.
    // It is not sufficient on its own, though. A node whose ancestor's class changed inherits
    // something new without any binding of its own having moved, so it is not propsDirty and
    // would never re-clone. `styleChanged` is the other half of that question. An ancestor that
    // is here only because something beneath it moved has the props it had.
    const propsMoved = node.propsDirty || styleChanged;
    const props = propsMoved ? this.mergeProps(node, viewName) : previous.props;
    const propsPayload = propsMoved ? this.propsPayload(node, previous.props, props) : null;
    if (this.asked & LAYOUTS) this.noteHow(node, propsPayload);
    const childrenChanged = this.childrenMoved(node, childHandles, previous.childHandles);
    if (this.notesMoves)
      this.noteClone(node, propsPayload, childrenChanged, childHandles, previous);
    let handle = previous.handle;
    if (childrenChanged || propsPayload) {
      handle = this.clone(
        previous.handle,
        propsPayload && this.processed(propsPayload, true),
        childrenChanged ? childHandles : null,
      );
      // A clone is the same view, so it keeps the tag it was created with, not the newest tag
      // handed out, which is some other node's.
      node.committed = { handle, tag: previous.tag, props, childHandles, viewName };
    }
    this.clearFlags(node);
    return handle;
  }

  /**
   * Note a commit that resizes or moves a box in no transition native lays out: a prop of one
   * that moves boxes, children that came or went, text longer or shorter than it was.
   */
  private noteMoved(
    node: EngineNode,
    payload: Record<string, unknown> | null,
    children: number,
    words: unknown,
  ): void {
    if (children) this.movesOthers = !!this.movedOrGrown(children).add(node);
    for (const key in payload) {
      // Text as long as it was is taken to be as wide, as a grid takes it: see `shapeOf`.
      const change = key === 'text' ? String(payload[key]).length - String(words).length : 0;
      if (!MOVES_BOXES.has(key) && !change) continue;
      this.movedOrGrown(change).add(node);
      if (!laidByNative(node, key)) this.movesOthers = true;
    }
  }

  /** Note a clone that moves or resizes a box, where moves are noted: see `notesMoves`. */
  private noteClone(
    node: EngineNode,
    payload: Record<string, unknown> | null,
    childrenChanged: boolean,
    childHandles: readonly FabricNode[],
    previous: NonNullable<EngineNode['committed']>,
  ): void {
    if (!this.laying.length && !payload && !childrenChanged) return;
    const by = childHandles.length - previous.childHandles.length;
    this.noteMoved(node, payload, by, previous.props['text']);
  }

  /** Where a box is noted that holds this many more children or letters: none is another change. */
  private movedOrGrown(more: number): Set<EngineNode> {
    return more > 0 ? this.grownBoxes : this.movedBoxes;
  }

  /**
   * Whether an element said to scroll its overflow is to: its style says `auto` or `scroll`. Noted
   * on the node, for the view it is committed as, and answered.
   */
  private settleScrolling(node: EngineNode): boolean {
    // A sheet's `auto` is compiled to `scroll`; an inline style's is not.
    const overflow = readStyle(node, 'overflow');
    if (overflow === 'scroll' || overflow === 'auto') node.scrollView = true;
    else node.scrollView = undefined;
    return node.scrollView === true;
  }

  /**
   * `reconcile` for an element that scrolls its overflow: a scroll view, and in it the one view
   * its children are in. Each is created once and cloned for what changed of its own: the
   * content for the children and for how they are laid out, the scroll view for its box and
   * for a content that was cloned.
   */
  private reconcileScroller(
    node: EngineNode,
    viewName: string,
    childHandles: FabricNode[],
    styleChanged: boolean,
  ): FabricNode {
    const previous = node.committed;
    const held = node.inside;
    if (!previous || !held) return this.createScroller(node, viewName, childHandles);
    const propsMoved = node.propsDirty || styleChanged;
    const props = propsMoved ? this.mergeProps(node, viewName) : previous.props;
    const payload = propsMoved ? this.propsPayload(node, previous.props, props) : null;
    if (this.asked & LAYOUTS) this.noteHow(node, payload);
    const moved = this.childrenMoved(node, childHandles, held.childHandles);
    const { box, content } = splitScroller(payload ?? {});
    // All of it: the content's padding moves what it holds, and can resize the element.
    if (this.notesMoves) this.noteClone(node, payload, moved, childHandles, previous);
    const inside = this.clonedFor(held.handle, someProps(content), moved ? childHandles : null);
    const handle = this.clonedFor(
      previous.handle,
      someProps(box),
      inside === held.handle ? null : [inside],
    );
    node.committed = { handle, tag: previous.tag, props, childHandles, viewName };
    node.inside = { handle: inside, childHandles };
    this.clearFlags(node);
    return handle;
  }

  /** A view cloned for the props and the children that changed, or itself where neither did. */
  private clonedFor(
    handle: FabricNode,
    props: Record<string, unknown> | null,
    children: FabricNode[] | null,
  ): FabricNode {
    if (!props && !children) return handle;
    return this.clone(handle, props && this.processed(props, true), children);
  }

  private createScroller(
    node: EngineNode,
    viewName: string,
    childHandles: FabricNode[],
  ): FabricNode {
    const props = this.mergeProps(node, viewName);
    const { box, content } = scrollerProps(props);
    // The element is what a touch on its content lands on.
    const inside = this.fabric.createNode(
      nextTag(),
      DEFAULT_VIEW,
      this.rootTag,
      this.processed(content, false),
      node,
    );
    this.stats.createdNodes++;
    for (const child of childHandles) this.fabric.appendChild(inside, child);
    const handle = this.create(node, viewName, box, [inside]);
    node.committed = { ...node.committed!, props, childHandles };
    node.inside = { handle: inside, childHandles };
    return handle;
  }

  /** What a clone sends: the props that changed, and a text input's font once it registered. */
  private propsPayload(
    node: EngineNode,
    previous: Record<string, unknown>,
    props: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const payload = diffProps(previous, props);
    if (payload) borderColoursAgain(payload, props);
    if (payload && node.owned) this.setOwned(node, payload, props);
    // A frame of a transform is committed with no layout settled after it: see `composeSticky`.
    if (payload && node.sticky?.drive && 'transform' in payload) {
      this.composeSticky(node, props['transform']);
    }
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
  // Exempt from the complexity limit as `mergeProps` is: run for every node with children, where
  // the loop in a function of its own was a call more a node in `pnpm bench`.
  // eslint-disable-next-line complexity
  private reconcileChildren(
    node: EngineNode,
    viewName: string,
    style: StyleCache | null,
  ): FabricNode[] {
    const context = style?.context;
    if (HOIST_ONLY.has(node.tag)) return this.reconcileOnlyHoisted(node);
    if (HOIST_TARGETS.has(node.tag)) return this.reconcileHoistTarget(node, context);
    if (node.flow !== undefined) return this.reconcileInFlow(node, node.flow, viewName, context);
    // A node with no flow of its own holds nothing in a line: each child is its own view under it.
    const handles: FabricNode[] = [];
    for (const child of node.childList) {
      const clean = this.cleanUnder(node, child, context);
      if (clean) {
        handles.push(clean);
        continue;
      }
      if (
        child.nodeKind === 'anchor' ||
        this.committedElsewhere(child) ||
        this.withheld(child) ||
        // Committed under its page: see `fixedHandles`. Only a layout of CSS's fixes a box.
        (this.asked & CSS_LAYOUT && this.onPage(child, context))
      ) {
        continue;
      }
      const handle =
        child.nodeKind === 'text'
          ? this.reconcileText(node, child, viewName, context)
          : this.reconcileUnder(node, child, context);
      if (handle) handles.push(handle);
    }
    return node.ordered ? this.inOrder(node, handles) : handles;
  }

  /** `reconcileChildren` for a block: its children, with each run of boxes in its line box. */
  private reconcileInFlow(
    node: EngineNode,
    flow: Flow,
    viewName: string,
    context: object | undefined,
  ): FabricNode[] {
    const handles: FabricNode[] = [];
    // The node each handle is of, kept only where some of them are to share a line box.
    const lines = flow.plan.lines.size ? flow : undefined;
    const owners: EngineNode[] = [];
    // Asked once of the node, and not of each child: most hold no words beside a box.
    const worded = wordedLine(node) && holdsParagraphs(viewName);
    for (const child of node.childList) {
      // A clean child is stepped over here as it is under a box with no flow: a block of
      // examples one of which ticks is most of a commit otherwise. See `cleanUnder`.
      const handle =
        this.cleanUnder(node, child, context) ??
        (worded && child.nodeKind === 'text'
          ? this.reconcileWordsInto(node, child, context, handles)
          : this.reconcileChild(node, child, viewName, context));
      if (!handle) continue;
      handles.push(handle);
      if (lines) owners.push(child);
    }
    if (lines) return this.inLines(node, lines, handles, owners);
    return node.ordered ? this.inOrder(node, handles) : handles;
  }

  /**
   * A run of text beside a box in a line: its words are each a view, which are added to
   * `handles` here, and it has no one view to answer with.
   */
  private reconcileWordsInto(
    node: EngineNode,
    child: EngineNode,
    context: object | undefined,
    handles: FabricNode[],
  ): undefined {
    handles.push(...this.reconcileWords(node, child, context));
    return undefined;
  }

  /** One child's view under `node`, or nothing for a child that has none there. */
  private reconcileChild(
    node: EngineNode,
    child: EngineNode,
    viewName: string,
    context: object | undefined,
  ): FabricNode | null | undefined {
    if (child.nodeKind === 'anchor' || this.committedElsewhere(child) || this.withheld(child)) {
      return undefined;
    }
    // Committed under its page: see `fixedHandles`.
    if (this.onPage(child, context)) return undefined;
    if (child.nodeKind === 'text') return this.reconcileText(node, child, viewName, context);
    // A box in a line box is under that view, which is named by the line's first box: one that
    // joins a line, leaves it, or changes lines is made again, as native never moves one.
    const first = node.flow?.lined.get(child);
    return this.reconcileUnder(first ? this.lineOf(node, first) : node, child, context);
  }

  /**
   * A block's children with each run of inline-level boxes in its line box: the view is where
   * the first box of the run was, and holds the run. The same view is committed while its boxes
   * and the margin over it are the same, so a commit that changes neither sends nothing for it.
   */
  private inLines(
    container: EngineNode,
    flow: Flow,
    handles: readonly FabricNode[],
    owners: readonly EngineNode[],
  ): FabricNode[] {
    const boxes = new Map<EngineNode, FabricNode[]>();
    const out: (FabricNode | EngineNode)[] = [];
    handles.forEach((handle, i) => {
      const first = flow.lined.get(owners[i]!);
      if (!first) {
        out.push(handle);
        return;
      }
      const inside = boxes.get(first);
      if (inside) inside.push(handle);
      else {
        out.push(first);
        boxes.set(first, [handle]);
      }
    });
    return out.map((each) => {
      const inside = boxes.get(each as EngineNode);
      if (!inside) return each as FabricNode;
      const first = each as EngineNode;
      return this.lineBox(container, first, flow.plan.lines.get(first)!, inside);
    });
  }

  private lineBox(
    container: EngineNode,
    first: EngineNode,
    { top }: { top: number },
    handles: readonly FabricNode[],
  ): FabricNode {
    const line = this.lineOf(container, first);
    const was = line.handle;
    const along = this.alongLine(container);
    const inherited = this.styles.resolve(container, this.styleEpoch).inherited;
    const strut = lineStrut(inherited, container, first, this.fontScale);
    const placed = line.top === top && line.along === along && sameStrut(line.strut, strut);
    const same =
      placed &&
      line.handles.length === handles.length &&
      handles.every((handle, i) => handle === line.handles[i]);
    if (was && same) return was;
    const where = { marginTop: top, justifyContent: along ?? 'flex-start', ...strut };
    const handle = was
      ? this.clone(was, placed ? null : where, [...handles])
      : this.fabric.createNode(
          nextTag(),
          'View',
          this.rootTag,
          { ...LINE_BOX, ...where },
          container,
        );
    if (!was) for (const child of handles) this.fabric.appendChild(handle, child);
    Object.assign(line, { handle, top, along, strut, handles });
    return handle;
  }

  /**
   * Where `text-align` puts the boxes of a line in `container`, as the row the line is places
   * its items: a browser sets inline-level boxes where it would set the line's words. Nothing
   * at the start, which is where a row has them.
   *
   * ponytail: `end` and `right` are both the row's end, which is the left in a right-to-left
   * layout: right for `end` and wrong for `right`. Read the direction if that is ever seen.
   */
  private alongLine(container: EngineNode): string | undefined {
    const align = this.styles.resolve(container, this.styleEpoch).inherited['textAlign'];
    return ALONG_A_LINE[align as string];
  }

  /**
   * A box's part in that: the container of lines and nothing else is the row itself. A line
   * among blocks is a line box, which `lineBox` sets its boxes along.
   */
  private alignLine(node: EngineNode, props: Record<string, unknown>): void {
    if (node.flow?.plan.kind !== 'lines') return;
    const along = this.alongLine(node);
    if (along) props['justifyContent'] = along;
  }

  /**
   * The line box `first` starts in `container`: the one it has, or a new one with no view yet.
   * A line box is a view of its container's, so in another container it is another one, and so
   * is the one of a first box that has been made again.
   */
  private lineOf(container: EngineNode, first: EngineNode): LineBox {
    if (first.line?.in !== container) {
      first.line = { handle: null, top: 0, handles: [], in: container };
    }
    return first.line;
  }

  /**
   * A flex container's children in the order their `order` gives, as written among equals. A
   * block lays its children out as written whatever they say, and text in the container has no
   * order of its own.
   */
  private inOrder(node: EngineNode, handles: FabricNode[]): FabricNode[] {
    if (!node.ordered || isBlockContainer(readStyle(node, 'display'))) return handles;
    const orders = new Map<FabricNode, number>();
    for (const child of node.childList) {
      const order = child.committed && Number(readStyle(child, 'order') ?? 0);
      if (order) orders.set(child.committed!.handle, order);
    }
    if (!orders.size) return handles;
    return handles
      .map((handle, i) => ({ handle, order: orders.get(handle) ?? 0, i }))
      .sort((a, b) => a.order - b.order || a.i - b.i)
      .map((each) => each.handle);
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
    const box = this.looseText(parent, text, LOOSE_TEXT[viewName]);
    return box ? this.reconcileUnder(parent, box, context) : null;
  }

  /**
   * A run of text beside a box in a line, as the paragraphs of its words: a browser breaks the
   * line between any two of them, and what follows the run is where its last word ends. One
   * paragraph is a box as wide as its longest line, with the next box under all of it.
   */
  private reconcileWords(parent: EngineNode, text: EngineNode, context?: object): FabricNode[] {
    if (text.box?.committed) this.forgetCommitted(text.box);
    text.box = undefined;
    return this.wordBoxes(parent, text).map((box) => this.reconcileUnder(parent, box, context));
  }

  /** The paragraph of each word of a run, kept for the word in its place while there is one. */
  private wordBoxes(parent: EngineNode, text: EngineNode): EngineNode[] {
    const at = parent.childList.indexOf(text);
    const words = wordsOf(text.nodeText, at > 0, at < parent.childList.length - 1);
    const boxes = (text.words ??= []);
    for (const gone of boxes.splice(words.length)) if (gone.committed) this.forgetCommitted(gone);
    words.forEach((word, i) => {
      const box = (boxes[i] ??= this.wordBox());
      box.parent = parent;
      if (truncationMoved(box, parent)) box.propsDirty = true;
      const run = box.childList[0]!;
      if (run.nodeText !== word) this.setText(run, word);
    });
    this.clearFlags(text);
    return boxes;
  }

  private wordBox(): EngineNode {
    const box = new RetainedNode('element', 'text', this);
    box.anonymous = true;
    const run = new RetainedNode('text', '', this);
    run.parent = box;
    box.childList = [run];
    return box;
  }

  /** The box a run of loose text is drawn by: the one it has, or one made for the element. */
  private boxFor(text: EngineNode, drawnBy: string): EngineNode {
    // One made for another element, before the view was registered again, is done with.
    if (text.box && text.box.tag !== drawnBy) {
      if (text.box.committed) this.forgetCommitted(text.box);
      text.box = undefined;
    }
    if (text.box) return text.box;
    const box = new RetainedNode('element', drawnBy, this);
    box.anonymous = true;
    box.childList = [text];
    text.box = box;
    return box;
  }

  private looseText(parent: EngineNode, text: EngineNode, drawnBy = 'text'): EngineNode | null {
    for (const word of text.words ?? []) if (word.committed) this.forgetCommitted(word);
    text.words = undefined;
    if (!trimEnds(text.nodeText)) return null;
    const box = this.boxFor(text, drawnBy);
    box.parent = parent;
    // Merged before the view is, so the view's truncation is read here: see `truncatedAs`.
    if (truncationMoved(box, parent)) box.propsDirty = true;
    // The text is not under the box in the tree, so a change to it never marked the box.
    if (!this.isClean(text)) {
      box.subtreeDirty = true;
      // An element that says its words as a prop is merged again for them.
      if (drawnBy !== 'text') box.propsDirty = true;
      // Nor had it merged again where the text became one word, or stopped being one.
      if (box.oneWord !== undefined && unbroken(box) !== box.oneWord) box.propsDirty = true;
    }
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
    // A box drawn and then hidden is `display: none`, as any element is.
    if (this.generated !== null && isGenerated(child.tag)) {
      return this.undrawn(child) || this.undisplayed(child);
    }
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
    if (child.nodeKind !== 'element') return false;
    this.styles.resolve(child, this.styleEpoch);
    if (ownLayout(child, 'display') !== 'none') return false;
    if (child.committed) {
      this.forgetCommitted(child);
      // A field in it has no view to send its blur from. Blurred once this commit is done: a
      // `:focus` rule that hid it then no longer holds, and the commit that follows shows it.
      if (isWithin(this.focusedNode, child)) this.blurAfterCommit = true;
    }
    settlePaths(child);
    return true;
  }

  /**
   * Whether a generated box is one no rule draws, which has no view. A view that is not
   * displayed would do for what is seen, but Yoga marks one as laid out each time it measures
   * what holds it, as `undisplayed` says. An element holds two of these for every rule that could
   * draw it one.
   */
  private undrawn(box: EngineNode): boolean {
    if (this.ruleStyle(box) !== NOT_GENERATED) {
      this.writeContent(box);
      return false;
    }
    if (box.committed) this.forgetCommitted(box);
    return true;
  }

  /**
   * The words a generated box's `content` writes, as the text the box holds: a label a library
   * hangs on an element by its `::before`. Read as the box is about to be committed, which is
   * when its rules are known, and before what it holds is.
   */
  private writeContent(box: EngineNode): void {
    const content = this.styles.resolve(box, this.styleEpoch).style['content'];
    const words = typeof content === 'string' ? content : '';
    const text = box.childList[0];
    if ((text?.nodeText ?? '') === words) return;
    if (!text) this.appendChild(box, this.createText(words));
    else if (words) this.setText(text, words);
    else this.removeChild(box, text);
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
    for (const child of node.childList) {
      const taken = this.takenByTarget(node, child, context);
      if (taken === null) continue;
      if (taken === 'direct') direct.push(child);
      else handles.push(taken);
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
   * What a hoist target takes of a child written in it: the child's handle, `direct` for one
   * hoisted into it, which goes after its siblings, or null for none.
   */
  private takenByTarget(
    node: EngineNode,
    child: EngineNode,
    context: object | undefined,
  ): FabricNode | 'direct' | null {
    if (this.hoisted.has(child)) {
      if (this.committedElsewhere(child) || this.withheld(child)) return null;
      return 'direct';
    }
    const clean = this.cleanUnder(node, child, context);
    if (clean) return clean;
    if (child.nodeKind === 'anchor' || this.withheld(child)) return null;
    return this.reconcileUnder(node, child, context);
  }

  /**
   * `reconcileHoistTarget` for a node that commits only what is hoisted into it
   * (`HoistOptions.only`): those nodes, in the order they were written, and none of its own.
   */
  private reconcileOnlyHoisted(node: EngineNode): FabricNode[] {
    const handles: FabricNode[] = [];
    const hoisted = this.hoistedInto(node);
    const landed = new Set<string>();
    for (const child of node.childList) {
      if (child.nodeKind === 'anchor' || this.committedElsewhere(child) || this.withheld(child)) {
        continue;
      }
      if (this.hoisted.has(child)) {
        handles.push(this.land(node, child, landed));
        continue;
      }
      for (const written of hoisted?.get(child) ?? []) {
        if (!this.undisplayedUnder(node, written)) handles.push(this.land(node, written, landed));
      }
      // Not committed, so the marks a change left on the way down to it are cleared here.
      settlePaths(child);
    }
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
  private reconcileUnder(
    parent: EngineNode | LineBox,
    child: EngineNode,
    context?: object,
  ): FabricNode {
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
    // Another view, with another tag, which no graph has set anything on.
    if (node.owned) this.disown(node);
    node.styleCommitted = null;
    node.kept = undefined;
    // Its content view goes with the scroll view: made again, the two are made together.
    node.inside = undefined;
    // A scroll-driven animation is bound to native views by their tags: its own, and its scroll
    // view's. Made again, each has another, so what drives it starts again with the new ones.
    if (node.scrolled?.drive) this.stopScrolled(node);
    for (const follower of this.scrollTimelines.get(node) ?? []) {
      this.stopScrolled(follower);
      this.markProps(follower, false);
    }
    if (node.box || node.words) this.forgetParagraphs(node);
    for (const child of node.childList) {
      // A line box is a view of this node's, which it is losing: the box that starts one starts
      // another. A box made again on its own keeps the line box it is in.
      child.line = undefined;
      if (child.committed || child.box || child.words) this.forgetCommitted(child);
    }
  }

  /** The paragraphs a run of text is drawn in, let go with it: see `paragraphsOf`. */
  private forgetParagraphs(text: EngineNode): void {
    if (text.box?.committed) this.forgetCommitted(text.box);
    for (const word of text.words ?? NO_WORDS) if (word.committed) this.forgetCommitted(word);
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
    if (!STAND_INS[child.tag]) return this.reconcileUnder(target, child);
    const kept = target.kept?.get(child.tag);
    if (kept && kept.node !== child && child.committed === null && !isWithin(kept.node, target)) {
      // A node taken out without being destroyed would otherwise come back holding this tag too.
      if (kept.node) kept.node.committed = null;
      child.committed = kept.committed;
      child.propsDirty = true;
    }
    const handle = this.reconcile(child);
    child.committedUnder = target;
    (target.kept ??= new Map()).set(child.tag, { node: child, committed: child.committed! });
    landed.add(child.tag);
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
        const handle = this.clone(
          kept.committed.handle,
          payload && this.processed(payload, true),
          [],
        );
        kept.committed = { ...kept.committed, handle, props, childHandles: [] };
        kept.node = null;
      }
      handles.push(kept.committed.handle);
    }
  }

  /**
   * A clean child's handle under `parent`, before anything else is asked of it: one committed
   * there and unchanged since was displayed, in its place, and is still. The siblings of what
   * changed are most of what a commit steps over: a page of examples one of which ticks.
   */
  private cleanUnder(
    parent: EngineNode,
    child: EngineNode,
    context: object | undefined,
  ): FabricNode | null {
    if (child.nodeKind !== 'element' || child.committedUnder !== parent) return null;
    if (child.fixedTo !== undefined) return null;
    return this.stillCommitted(child, context);
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
    if (child.nodeKind === 'text') return committed.handle;
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
      if (candidate.parent === node || HOISTS[candidate.tag] !== node.tag) continue;
      let written: EngineNode = candidate;
      let above = candidate.parent;
      while (above && above !== node && above.tag !== node.tag) {
        if (HOIST_STOPS[candidate.tag]?.has(above.tag)) break;
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
    const target = HOISTS[node.tag];
    if (node.parent?.tag === target) return false;
    for (let above = node.parent; above; above = above.parent) {
      if (above.tag === target) return true;
      if (HOIST_STOPS[node.tag]?.has(above.tag)) return false;
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
    if (this.notesMoves)
      (node.nodeKind === 'element' ? this.movedBoxes : this.grownBoxes).add(node);
    this.stats.createdNodes++;
    // instanceHandle is the retained node itself: it is what Fabric hands back on events.
    const handle = this.fabric.createNode(
      tag,
      viewName,
      this.rootTag,
      this.processed(props, false),
      node,
    );
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
    if (node.nodeKind !== 'element' || node.claimed || node.anonymous) return;
    if (!PRIMITIVE_NAMES.has(node.tag)) return;
    if (this.reported.has(node.tag)) return;
    this.reported.add(node.tag);
    console.error(
      `[angular-native] <${node.tag}> is used in a template that does not import ` +
        `${className(node.tag)}. Add it to the component's \`imports\` from ` +
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

  private readonly droppedDeclarations = new Set<string>();

  /**
   * A declaration in a style, written or bound, that is no value its property takes, so it is
   * dropped as a browser drops it. Said once per element name and declaration, in development.
   */
  reportDroppedDeclaration(prop: string, value: string, on: string, why: string): void {
    const report = `${on} ${prop}: ${value}`;
    if (!this.dev || this.droppedDeclarations.has(report)) return;
    this.droppedDeclarations.add(report);
    console.warn(
      `[angular-native] ${prop}: ${value}, in a style on <${on}>, is no value ${prop} takes:` +
        ` ${why}. The declaration is dropped, as a browser drops it.`,
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
    if (!node.claimed || !PRIMITIVE_NAMES.has(node.tag)) return;
    const declared = DECLARED_PROPS.get(node.tag);
    if (!declared) return;
    for (const key of Object.keys(node.props)) {
      if (this.isDeclared(declared, key, node.props[key])) continue;
      const report = `${node.tag} ${key}`;
      if (this.reported.has(report)) continue;
      this.reported.add(report);
      const meant = [...declared].find((name) => name.toLowerCase() === key.toLowerCase());
      console.warn(
        `[angular-native] <${node.tag}> has no prop '${key}', so native ignores it.` +
          (meant ? ` Did you mean '${meant}'?` : '') +
          ` Check the spelling against the ${className(node.tag)} page, or declare it with` +
          ` declareNativeProps('${node.tag}', ['${key}']) if the native view does read it.`,
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
    if (node.nodeKind !== 'element' || node.componentHost || node.tag in VIEW_NAMES) return;
    if (this.declaredElements.has(node.tag) || this.reported.has(node.tag)) return;
    // A generated box is the engine's own, for a rule: nobody misspelt it.
    if (isGenerated(node.tag)) return;
    this.reported.add(node.tag);
    console.error(
      `[angular-native] <${node.tag}> is not a known element: no component, directive or ` +
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
    // A fade native is playing was given to it as a view that takes no touch fades: to
    // nothing. From here it is eased to where the view is committed.
    const fade = node.transitions?.get('opacity')?.native;
    if (fade) this.backToScriptEased(node, fade, this.now());
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
  /**
   * A node's box as it is laid out, with no transform on it or above it: nothing where it has
   * not been committed, or on a host that cannot say. `measure` answers where it is drawn,
   * which is smaller for a panel scaling in.
   */
  layoutOf(node: EngineNode): WindowFrame | undefined {
    const box = this.boxOf(node);
    return box && { x: box[0], y: box[1], width: box[2], height: box[3] };
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
    if (handle) this.measureHandle(handle, into);
  }

  /** `measure` for a committed view by its handle, which a node's own may not be. */
  private measureHandle(handle: FabricNode, into: (frame: WindowFrame) => void): void {
    this.fabric.measureInWindow?.(handle, (x, y, width, height) => into({ x, y, width, height }));
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
    if (this.focusedNode && !this.isAttached(this.focusedNode)) this.dropFocus();
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

  /** A colour prop as `processed` sends it: one dropped as unreadable is null on an update. */
  private colourProp(key: string, value: unknown, update: boolean): unknown {
    const painted = this.painted(key, value);
    return painted === undefined && update ? null : painted;
  }

  /**
   * A colour prop as native takes it. A shape's `fill` or `stroke` the cascade settled from a
   * token is the solid brush react-native-svg takes, `none` no paint at all, and one the host
   * reads no colour in no paint of the shape's own.
   */
  private painted(key: string, value: unknown): unknown {
    if (!BRUSH_PROPS.has(key)) return this.color(value);
    // Already a brush, as the icon wrote it: only one the cascade settled is still text. An
    // icon's solid brush holds whatever the host read, which is nothing for an unreadable colour.
    if (typeof value !== 'string') return emptyBrush(value) ? undefined : value;
    if (value === 'none') return null;
    // A colour the host cannot read is dropped, as a browser drops it: a solid brush with no
    // colour in it stops the app.
    const payload = this.color(value);
    return payload == null ? undefined : { type: 0, payload };
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
    // Before the handler is told: what it does is for the render pass after it to commit
    // whole, and not to be drawn part made with the view no longer pressed.
    if (changed) this.commit();
    if (terminated) handlers?.onResponderTerminate?.(event);
    else handlers?.onResponderRelease?.(event);
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
    const target = this.guardedTarget(
      instanceHandle as EngineNode | null,
      topLevelType,
      nativeEvent,
    );
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
      this.trackFinger(target, topLevelType, nativeEvent);
      this.trackFocus(target, topLevelType);
      if (target) this.cancelPressForScroll(target, topLevelType, event as ResponderEvent);
      if (target) this.runResponder(target, topLevelType, event as ResponderEvent);
    } catch (error) {
      this.reportEventError(error, topLevelType);
    }
    this.propagate(target, topLevelType, event);
  }

  /**
   * Where a touch is taken to be, by a package that finds it better than native's hit test: a
   * drawing's shape a browser finds by its box, where native finds none. Asked as a touch
   * starts, and kept for each finger until it lifts, as a touch stays on what it started on.
   */
  private retarget: ((target: EngineNode, nativeEvent: unknown) => EngineNode) | null = null;
  private readonly fingersOn = new Map<unknown, EngineNode>();

  /**
   * The target a touch is dispatched to, where a package's retarget runs: nothing it throws may
   * reach native, so a throw is reported and the touch goes to native's own target.
   */
  private guardedTarget(
    hit: EngineNode | null,
    topLevelType: string,
    nativeEvent: unknown,
  ): EngineNode | null {
    try {
      return this.touchTarget(hit, topLevelType, nativeEvent);
    } catch (error) {
      this.reportEventError(error, topLevelType);
      return hit;
    }
  }

  /** Say where a touch that starts on a node is taken to be, or nothing to leave it to native. */
  setTouchTarget(
    retarget: ((target: EngineNode, nativeEvent: unknown) => EngineNode) | null,
  ): void {
    this.retarget = retarget;
    this.fingersOn.clear();
  }

  private touchTarget(
    target: EngineNode | null,
    type: string,
    nativeEvent: unknown,
  ): EngineNode | null {
    if (!this.retarget || !target || !type.startsWith('topTouch')) return target;
    const finger = (nativeEvent as { identifier?: unknown } | null)?.identifier;
    if (type === TOUCH_START) {
      const taken = this.retarget(target, nativeEvent);
      if (taken === target) this.fingersOn.delete(finger);
      else this.fingersOn.set(finger, taken);
      return taken;
    }
    const taken = this.fingersOn.get(finger) ?? target;
    if (type === 'topTouchEnd' || type === 'topTouchCancel') this.fingersOn.delete(finger);
    return taken;
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
      if (up.nodeKind !== 'element' || !SCROLL_VIEWS.has(committedViewName(up))) continue;
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
      if (up.nodeKind === 'element' && viewNameOf(up) === STACK_SCREEN) return up;
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
    console.log('[event]', topLevelType, target?.tag ?? '(no handle)', matched);
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
   * Otherwise the clone is handed its children in the one call, as an array: a call into native
   * for each of them is most of what cloning a box of hundreds costs, and each box over a change
   * is cloned on every commit. React Native's binding (`UIManagerBinding.cpp`, the one on iOS
   * and Android) reads an array there in every version the packages support, and takes it as the
   * second argument of three where there are props as well.
   */
  private clone(
    previous: FabricNode,
    props: Record<string, unknown> | null,
    children: FabricNode[] | null,
  ): FabricNode {
    this.stats.clonedNodes++;

    if (children === null) return this.fabric.cloneNodeWithNewProps(previous, props!);

    return props
      ? this.fabric.cloneNodeWithNewChildrenAndProps(previous, children, props)
      : this.fabric.cloneNodeWithNewChildren(previous, children);
  }

  private detach(child: EngineNode): void {
    if (child.parent) this.removeChild(child.parent, child);
  }
}

/**
 * Clear the marks that lead a commit down to a change, under a node no commit goes into: one with
 * no box. Left set, a later change under it stops climbing at them, as it stops at any mark already
 * there, and never reaches the root: nothing is committed, and an ancestor's `:has()` reading into
 * it is not asked again. What is under it has no views, so it is reconciled whole when it is shown.
 */
function settlePaths(node: EngineNode): void {
  if (!node.subtreeDirty) return;
  node.subtreeDirty = false;
  for (const child of node.childList) settlePaths(child);
}
