import { DestroyRef, Directive, computed, inject, input } from '@angular/core';
import type { NativeSyntheticEvent } from '@ng-native/fabric';
import type { Insets } from './events.ts';
import {
  INTERACTION_OBSERVERS,
  SWIPE_VELOCITY,
  describeElement,
  notifyInteraction,
  type InteractionDirection,
  type InteractionObserver,
} from './interaction-observer.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';
import { ViewBase } from './view-base.ts';

type DragEvent = NativeSyntheticEvent<{
  contentOffset?: { x: number; y: number };
  velocity?: { x: number; y: number };
}>;

/** Which way the content moved, by the axis it moved further along, or null if it did not move. */
function dragDirection(
  from: { x: number; y: number },
  to: { x: number; y: number },
): InteractionDirection | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** RN's `processDecelerationRate`: the named rates, as UIKit and Android define them. */
const DECELERATION: Record<string, number> = { normal: 0.998, fast: 0.99 };

/**
 * The native scroll view's own props, as typed inputs, for everything that commits as one:
 * `<scroll-view>` and `<virtual-list>`, as `FlatList` takes every `ScrollView` prop.
 *
 * Only the props that mean the same on both are here. `horizontal`, `contentOffset`,
 * `maintainVisibleContentPosition`, `nestedScrollEnabled` and the scroll event throttle each
 * mean something more to a windowed list, which declares its own.
 */
@Directive({
  host: {
    '[scrollEnabled]': 'scrollEnabled()',
    '[showsHorizontalScrollIndicator]': 'showsHorizontalScrollIndicator()',
    '[showsVerticalScrollIndicator]': 'showsVerticalScrollIndicator()',
    '[pagingEnabled]': 'pagingEnabled()',
    '[decelerationRate]': 'resolvedDecelerationRate()',
    '[snapToInterval]': 'snapToInterval()',
    '[snapToOffsets]': 'snapToOffsets()',
    '[snapToAlignment]': 'snapToAlignment()',
    '[snapToStart]': 'snapToStart()',
    '[snapToEnd]': 'snapToEnd()',
    '[disableIntervalMomentum]': 'disableIntervalMomentum()',
    '[sendMomentumEvents]': 'true',
    '[contentInset]': 'contentInset()',
    '[scrollIndicatorInsets]': 'scrollIndicatorInsets()',
    '[bounces]': 'bounces()',
    '[alwaysBounceHorizontal]': 'resolvedAlwaysBounceHorizontal()',
    '[alwaysBounceVertical]': 'resolvedAlwaysBounceVertical()',
    '[bouncesZoom]': 'bouncesZoom()',
    '[directionalLockEnabled]': 'directionalLockEnabled()',
    '[canCancelContentTouches]': 'canCancelContentTouches()',
    '[centerContent]': 'centerContent()',
    '[automaticallyAdjustContentInsets]': 'automaticallyAdjustContentInsets()',
    '[automaticallyAdjustKeyboardInsets]': 'automaticallyAdjustKeyboardInsets()',
    '[automaticallyAdjustsScrollIndicatorInsets]': 'automaticallyAdjustsScrollIndicatorInsets()',
    '[contentInsetAdjustmentBehavior]': 'contentInsetAdjustmentBehavior()',
    '[pinchGestureEnabled]': 'pinchGestureEnabled()',
    '[maximumZoomScale]': 'maximumZoomScale()',
    '[minimumZoomScale]': 'minimumZoomScale()',
    '[zoomScale]': 'zoomScale()',
    '[indicatorStyle]': 'indicatorStyle()',
    '[scrollsToTop]': 'scrollsToTop()',
    '[scrollToOverflowEnabled]': 'scrollToOverflowEnabled()',
    '[keyboardDismissMode]': 'keyboardDismissMode()',
    '[overScrollMode]': 'overScrollMode()',
    '[persistentScrollbar]': 'persistentScrollbar()',
    '[fadingEdgeLength]': 'fadingEdgeLength()',
    '[endFillColor]': 'endFillColor()',
  },
})
export abstract class ScrollViewProps extends ViewBase {
  /** Whether the content scrolls along x, which decides the axis the defaults bounce on. */
  abstract readonly horizontal: () => boolean | undefined;

  /** Set to false to freeze the scroll position. */
  readonly scrollEnabled = input(undefined, { transform: optionalBoolean });
  readonly showsHorizontalScrollIndicator = input(undefined, { transform: optionalBoolean });
  readonly showsVerticalScrollIndicator = input(undefined, { transform: optionalBoolean });
  /** Stop at multiples of the scroll view's own size. */
  readonly pagingEnabled = input(undefined, { transform: optionalBoolean });
  /** How quickly a fling slows: `normal`, `fast`, or a factor below 1. */
  readonly decelerationRate = input<'normal' | 'fast' | number>();
  /** Stop at multiples of this many points. */
  readonly snapToInterval = input(undefined, { transform: optionalNumber });
  /** Stop only at these offsets. */
  readonly snapToOffsets = input<readonly number[]>();
  /** Where a snap point sits in the viewport. */
  readonly snapToAlignment = input<'start' | 'center' | 'end'>();
  /** Whether the start of the content is a snap point. Defaults to true. */
  readonly snapToStart = input(undefined, { transform: optionalBoolean });
  /** Whether the end of the content is a snap point. Defaults to true. */
  readonly snapToEnd = input(undefined, { transform: optionalBoolean });
  /** With snapping, stop at the next snap point rather than flinging past several. */
  readonly disableIntervalMomentum = input(undefined, { transform: optionalBoolean });
  /** Milliseconds between `(scroll)` events; 16 or less means every frame. */
  readonly scrollEventThrottle = input(undefined, { transform: optionalNumber });
  /** iOS: padding inside the scroll view that the content can scroll into. */
  readonly contentInset = input<Insets>();
  /** iOS: insets for the scroll indicators. */
  readonly scrollIndicatorInsets = input<Insets>();
  /** iOS: rubber-band at the ends. Defaults to true. */
  readonly bounces = input(undefined, { transform: optionalBoolean });
  /** iOS: bounce sideways even when the content fits. */
  readonly alwaysBounceHorizontal = input(undefined, { transform: optionalBoolean });
  /** iOS: bounce vertically even when the content fits. */
  readonly alwaysBounceVertical = input(undefined, { transform: optionalBoolean });
  // Match React Native ScrollView's axis defaults. Passing neither prop through leaves UIKit's
  // false default in place, which makes short vertical pages feel fixed instead of rubber-banding.
  protected readonly resolvedAlwaysBounceHorizontal = computed(
    () => this.alwaysBounceHorizontal() ?? !!this.horizontal(),
  );
  protected readonly resolvedAlwaysBounceVertical = computed(
    () => this.alwaysBounceVertical() ?? !this.horizontal(),
  );
  /** iOS: rubber-band past the zoom limits. */
  readonly bouncesZoom = input(undefined, { transform: optionalBoolean });
  /** iOS: once a drag starts on one axis, ignore the other. */
  readonly directionalLockEnabled = input(undefined, { transform: optionalBoolean });
  /** iOS: whether a drag that started on a child can become a scroll. Defaults to true. */
  readonly canCancelContentTouches = input(undefined, { transform: optionalBoolean });
  /** iOS: centre content smaller than the viewport. */
  readonly centerContent = input(undefined, { transform: optionalBoolean });
  /** iOS: adjust the insets for the navigation bar and status bar automatically. */
  readonly automaticallyAdjustContentInsets = input(undefined, { transform: optionalBoolean });
  /** iOS: add a bottom inset while the keyboard is up. */
  readonly automaticallyAdjustKeyboardInsets = input(undefined, { transform: optionalBoolean });
  /** iOS: keep the indicator insets in step with the content insets. Defaults to true. */
  readonly automaticallyAdjustsScrollIndicatorInsets = input(undefined, {
    transform: optionalBoolean,
  });
  /** iOS: how the safe area affects the content insets. */
  readonly contentInsetAdjustmentBehavior = input<
    'automatic' | 'scrollableAxes' | 'never' | 'always'
  >();
  /** iOS: allow pinch-to-zoom. Defaults to true. */
  readonly pinchGestureEnabled = input(undefined, { transform: optionalBoolean });
  readonly maximumZoomScale = input(undefined, { transform: optionalNumber });
  readonly minimumZoomScale = input(undefined, { transform: optionalNumber });
  readonly zoomScale = input(undefined, { transform: optionalNumber });
  /** iOS: the scroll indicator's colour. */
  readonly indicatorStyle = input<'default' | 'black' | 'white'>();
  /** iOS: tapping the status bar scrolls to the top. Defaults to true. */
  readonly scrollsToTop = input(undefined, { transform: optionalBoolean });
  /** iOS: allow scrolling past the content programmatically. */
  readonly scrollToOverflowEnabled = input(undefined, { transform: optionalBoolean });
  /** Dismiss the keyboard when a drag starts, or interactively as the drag moves. */
  readonly keyboardDismissMode = input<'none' | 'on-drag' | 'interactive'>();
  /** Android: the over-scroll glow. */
  readonly overScrollMode = input<'auto' | 'always' | 'never'>();
  /** Android: keep the scrollbar visible. */
  readonly persistentScrollbar = input(undefined, { transform: optionalBoolean });
  /** Android: fade the content at the edges over this many points. */
  readonly fadingEdgeLength = input(undefined, { transform: optionalNumber });
  /** Android: the colour drawn past the end of short content. */
  readonly endFillColor = input<string>();

  protected readonly resolvedDecelerationRate = computed(() => {
    const rate = this.decelerationRate();
    return typeof rate === 'string' ? DECELERATION[rate] : rate;
  });

  constructor() {
    super();
    // Scroll views are few, so unlike a press this looks once, and listens only for an app that
    // asked.
    const observers = inject(INTERACTION_OBSERVERS, { optional: true });
    if (observers?.length) this.reportDrags(observers);
  }

  /**
   * One `scroll` or `swipe` per drag the user makes, as the finger lifts. A scroll made by code,
   * `scrollTo` or a tap on the status bar, has no drag, so reports nothing.
   */
  private reportDrags(observers: readonly InteractionObserver[]): void {
    let start: { x: number; y: number } | null = null;
    const begin = this.engine.setEventListener(this.node, 'topScrollBeginDrag', (event) => {
      start = (event as DragEvent).nativeEvent?.contentOffset ?? null;
    });
    const end = this.engine.setEventListener(this.node, 'topScrollEndDrag', (event) => {
      const { contentOffset, velocity } = (event as DragEvent).nativeEvent ?? {};
      const from = start;
      start = null;
      if (!from || !contentOffset) return;
      const direction = dragDirection(from, contentOffset);
      if (!direction) return;
      const speed = velocity ? Math.hypot(velocity.x, velocity.y) : 0;
      notifyInteraction(observers, {
        type: speed >= SWIPE_VELOCITY ? 'swipe' : 'scroll',
        ...describeElement(this.engine, this.node),
        direction,
        source: 'touch',
        timestamp: Date.now(),
      });
    });
    inject(DestroyRef).onDestroy(() => {
      begin();
      end();
    });
  }
}
