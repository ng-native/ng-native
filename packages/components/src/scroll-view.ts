import {
  Component,
  DestroyRef,
  ElementRef,
  afterEveryRender,
  computed,
  contentChild,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { type HostNode, type NativeSyntheticEvent, nativePlatform } from '@ng-native/fabric';
import type { Point, Rect, Size } from './events.ts';
import { type KeyboardShouldPersistTaps, dismissKeyboardOnTap } from './keyboard-taps.ts';
import { ContentContainer } from './content-container.ts';
import { RefreshControl } from './refresh-control.ts';
import { StickyHeaders } from './sticky-headers.ts';
import { optionalBoolean } from './transforms.ts';
import { ScrollViewProps } from './scroll-view-props.ts';
import { View } from './view.ts';

/**
 * A scrolling container. Commits as `RCTScrollView`, with the children inside a content view.
 *
 * The native scroll view has no `contentContainerStyle`: RN's `ScrollView.js` wraps children in
 * a content view and applies it there, which is done here. The engine gives the host RN's base
 * style (`overflow: 'scroll'` and the flex defaults); without it the content spills out of the
 * scroll view's bounds.
 *
 * `horizontal` changes two things rather than one, and both are needed. RN swaps its whole base
 * style for `baseHorizontal` - the same defaults but `flexDirection: 'row'` - and puts
 * `contentContainerHorizontal` on the content view. With the host left as a column the content
 * view is stretched to the scroll view's width instead of growing past it, so there is nothing to
 * scroll to and a sideways drag does nothing at all. It looks like a scroll view that simply has
 * too little in it.
 *
 * Keyboard policy is the other half of what `ScrollView.js` does in JavaScript. With a text
 * input focused, a tap elsewhere in the scroll view dismisses the keyboard and goes no further
 * (`keyboardShouldPersistTaps: 'never'`, the default), reaches the child first and dismisses only
 * if nothing handled it (`'handled'`), or never dismisses (`'always'`).
 *
 * `stickyHeaderIndices` pins those children of the content to the leading edge, each until the
 * next pushes it off. It is JavaScript in RN as well; see `StickyHeaders`.
 *
 * Events are element events: `(scroll)`, `(scrollBeginDrag)`, `(scrollEndDrag)`,
 * `(momentumScrollBegin)`, `(momentumScrollEnd)`, `(scrollToTop)`. `(contentSizeChange)` is an
 * output, measured from the content view's layout as RN does.
 */
@Component({
  selector: 'scroll-view',
  exportAs: 'scrollView',
  imports: [ContentContainer, View],
  // `collapsable: false` is load-bearing, not a hint. Fabric flattens views whose props are
  // layout-only, and a content container with just padding qualifies: it gets no UIView at all.
  // Touches in its empty areas then land on the scroll view itself, which does not scroll from a
  // direct hit, so dragging anywhere the children do not cover silently does nothing. RN sets the
  // same flag on its content container for the same reason.
  //
  // A refresh control is the scroll view's own child, before the content view, as RN's
  // ScrollView.js commits it. On iOS it finds its scroll view once, when it is inserted, and
  // Fabric mounts bottom-up: inside the content view it would look before that view was in the
  // scroll view, and never attach.
  template: `
    <ng-content select="refresh-control" />
    <view
      #content
      [contentContainerOf]="node"
      [contentContainerClass]="contentContainerClass()"
      [style]="contentStyle()"
      collapsable="false"
      (layout)="onContentLayout($event)"
    >
      <ng-content />
    </view>
  `,
  host: {
    // The base style's direction, which `horizontal` decides. A top-level prop rather than a
    // host `[style]`, so the caller's own `[style]` still applies over it as it does in RN.
    '[flexDirection]': "horizontal() ? 'row' : 'column'",
    '[horizontal]': 'horizontal()',
    '[contentOffset]': 'contentOffset()',
    '[maintainVisibleContentPosition]': 'maintainVisibleContentPosition()',
    '[scrollEventThrottle]': 'resolvedThrottle()',
    '[nestedScrollEnabled]': 'resolvedNestedScroll()',
  },
})
export class ScrollView extends ScrollViewProps {
  /** Styles for the view that holds the children, e.g. padding and gap. */
  readonly contentContainerStyle = input<Record<string, unknown>>();
  /**
   * Classes for the view that holds the children, matched as if the view were written in the
   * template the scroll view is. See `ContentContainer`. `contentContainerStyle` wins over it, as
   * an inline style does over a class.
   */
  readonly contentContainerClass = input<string>();

  /**
   * The content view's style, with the row direction a horizontal scroll view needs.
   *
   * RN's `contentContainerHorizontal`, and in the same order: the caller's own style is applied
   * over it, so a horizontal scroll view whose content really should stack in a column can still
   * say so.
   */
  protected readonly contentStyle = computed(() =>
    this.horizontal()
      ? { flexDirection: 'row', ...this.contentContainerStyle() }
      : this.contentContainerStyle(),
  );
  /** Lay children out in a row and scroll sideways. */
  readonly horizontal = input(undefined, { transform: optionalBoolean });
  /** Where the content starts, before the user scrolls. */
  readonly contentOffset = input<Point>();
  /** Keep what is on screen still when content is added above it. */
  readonly maintainVisibleContentPosition = input<{
    readonly minIndexForVisible: number;
    readonly autoscrollToTopThreshold?: number;
  }>();
  /** What a tap does with the keyboard up. See the class note. Defaults to `never`. */
  readonly keyboardShouldPersistTaps = input<KeyboardShouldPersistTaps>('never');
  /** Android: cooperate with a scrolling ancestor. */
  readonly nestedScrollEnabled = input(undefined, { transform: optionalBoolean });

  /** Children of the content, by position, that stick to the leading edge while it scrolls. */
  readonly stickyHeaderIndices = input<readonly number[]>([]);

  /** The content view's size changed; the value is its new width and height. */
  readonly contentSizeChange = output<Size>();

  private readonly refreshControl = contentChild(RefreshControl);
  private readonly content = viewChild.required('content', { read: ElementRef });
  private readonly sticky = new StickyHeaders(this.engine, this.node, () => !!this.horizontal());

  /** RN asks for every scroll event while anything is sticky, which is what keeps it pinned. */
  protected readonly resolvedThrottle = computed(() =>
    this.stickyHeaderIndices().length > 0 ? 1 : this.scrollEventThrottle(),
  );

  /**
   * RN's `nestedScrollEnabled ?? true` for a scroll view inside Android's swipe layout: the scroll
   * view has to see a drag before the layout wrapped around it does, or every drag is a pull.
   */
  protected readonly resolvedNestedScroll = computed(
    () =>
      this.nestedScrollEnabled() ??
      (nativePlatform() === 'android' && this.refreshControl() ? true : undefined),
  );

  constructor() {
    super();
    const stop = dismissKeyboardOnTap(this.engine, this.node, () =>
      this.keyboardShouldPersistTaps(),
    );
    inject(DestroyRef).onDestroy(stop);
    this.trackStickyHeaders();
  }

  /**
   * Sticky children are found again after each pass, because a pass can add or move them, and the
   * scroll offset is listened for only while there are any.
   */
  private trackStickyHeaders(): void {
    let stopScroll: (() => void) | null = null;
    afterEveryRender(() => {
      const indices = this.stickyHeaderIndices();
      if (indices.length === 0 && !stopScroll) return;
      this.sticky.track(this.content().nativeElement as HostNode, indices);
      if (indices.length > 0 && !stopScroll) {
        stopScroll = this.engine.setEventListener(this.node, 'topScroll', (event) => {
          const offset = (event as NativeSyntheticEvent<{ contentOffset?: Point }>).nativeEvent
            ?.contentOffset;
          this.sticky.scrolled((this.horizontal() ? offset?.x : offset?.y) ?? 0);
        });
      } else if (indices.length === 0 && stopScroll) {
        stopScroll();
        stopScroll = null;
      }
    });
    inject(DestroyRef).onDestroy(() => {
      stopScroll?.();
      this.sticky.destroy();
    });
  }

  /** Scroll to a position. */
  scrollTo(options: { x?: number; y?: number; animated?: boolean }): void {
    const { x = 0, y = 0, animated = true } = options;
    this.engine.dispatchCommand(this.node, 'scrollTo', [x, y, animated]);
  }

  scrollToEnd(options: { animated?: boolean } = {}): void {
    this.engine.dispatchCommand(this.node, 'scrollToEnd', [options.animated ?? true]);
  }

  /** Briefly show the scroll indicators, to hint that there is more. */
  flashScrollIndicators(): void {
    this.engine.dispatchCommand(this.node, 'flashScrollIndicators');
  }

  /** iOS: zoom so that a rectangle of the content fills the viewport. */
  zoomToRect(rect: Rect, animated = true): void {
    this.engine.dispatchCommand(this.node, 'zoomToRect', [rect, animated]);
  }

  protected onContentLayout(event: NativeSyntheticEvent<{ layout?: Size }>): void {
    const layout = event.nativeEvent?.layout;
    if (layout) this.contentSizeChange.emit({ width: layout.width, height: layout.height });
  }
}
