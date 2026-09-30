import {
  Component,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
} from '@angular/core';
import { Keyboard, LayoutAnimation, type LayoutEasing } from '@ng-native/device';
import type { NativeSyntheticEvent } from '@ng-native/fabric';
import type { Rect } from './events.ts';
import { ContentContainer } from './content-container.ts';
import { View } from './view.ts';
import { ViewBase } from './view-base.ts';

export type KeyboardAvoidingBehavior = 'padding' | 'height' | 'position';

/**
 * The names `LayoutEasing` knows. `'keyboard'` is among them: iOS reports its keyboard's own
 * curve by that name, and RN's KeyboardAvoidingView animates on it.
 */
const LAYOUT_EASINGS: ReadonlySet<string> = new Set([
  'linear',
  'easeInEaseOut',
  'easeIn',
  'easeOut',
  'spring',
  'keyboard',
]);

/** A keyboard event's `easing`, narrowed to what `LayoutAnimation` accepts, or left to its default. */
function layoutEasingOf(easing: string | undefined): LayoutEasing | undefined {
  return easing !== undefined && LAYOUT_EASINGS.has(easing) ? (easing as LayoutEasing) : undefined;
}

/**
 * Moves its content clear of the keyboard.
 *
 * RN's KeyboardAvoidingView is a JS composite: there is no native component, only a view whose
 * padding, height or position tracks the keyboard. Off a device the `Keyboard` service reports
 * nothing, so this renders as a plain view and does nothing, which is also the right behaviour on
 * a platform with no soft keyboard.
 *
 * The overlap is the view's own frame against the keyboard's top edge, so a view that does not
 * reach the bottom of the screen moves only as far as it must. Unlike RN, the frame's top is
 * measured in the window, which is what the keyboard's `screenY` is in: `(layout)` reports it in
 * the parent's coordinates, and on a screen under a navigation bar those start a bar's height
 * down. RN leaves that to `keyboardVerticalOffset`, and a view that was not told came up short by
 * exactly that much, its bottom edge still behind the keyboard. The overlap never exceeds the
 * view's own height either: padding a view by more than it has pushes its content out of it.
 * When the keyboard source reports no `screenY`, the keyboard's height stands in.
 *
 * The adjustment itself animates with the keyboard's own motion, the way RN's own
 * KeyboardAvoidingView does: a keyboard event's `duration` and `easing` configure the next
 * layout animation before the style change that moves this view, so the two run together rather
 * than the padding, height or position jumping to its resting place in one step.
 */
@Component({
  selector: 'keyboard-avoiding-view',
  imports: [ContentContainer, View],
  template: `
    @if (behavior() === 'position') {
      <view
        [contentContainerOf]="node"
        [contentContainerClass]="contentContainerClass()"
        [style]="positioned()"
        ><ng-content
      /></view>
    } @else {
      <ng-content />
    }
  `,
  host: {
    '[styleOverride]': 'avoidance()',
    '(layout)': 'onLayout($event)',
  },
})
export class KeyboardAvoidingView extends ViewBase {
  /**
   * How to make room: pad the bottom, shrink the height, or shift the content up. RN leaves this
   * unset and does nothing; `padding` is the default here because that is what a form wants.
   */
  readonly behavior = input<KeyboardAvoidingBehavior>('padding');
  /** Styles for the inner view that `position` moves. */
  readonly contentContainerStyle = input<Record<string, unknown>>();
  /**
   * Classes for the inner view that `position` moves, matched as if it were written in the
   * template this view is. See `ContentContainer`.
   */
  readonly contentContainerClass = input<string>();
  /** Set to false to stop avoiding without removing the view. */
  readonly enabled = input(true, { transform: booleanAttribute });
  /**
   * Extra room to leave above the keyboard, in points. RN's name, and in RN the place to put a
   * header's height; here the view is measured in the window, so a navigation bar needs none.
   */
  readonly keyboardVerticalOffset = input(0, { transform: numberAttribute });

  private readonly keyboard = inject(Keyboard).metrics;
  private readonly layoutAnimation = inject(LayoutAnimation);
  private readonly frame = signal<Rect | null>(null);
  /** The height before any adjustment, which `height` mode shrinks from. */
  private initialHeight: number | null = null;

  /** How far the keyboard intrudes into this view, in points. */
  protected readonly overlap = computed(() => {
    if (!this.enabled()) return 0;
    const { height, screenY } = this.keyboard();
    if (height === 0) return 0;
    const frame = this.frame();
    const offset = this.keyboardVerticalOffset();
    if (!frame) return Math.max(0, height - offset);
    // In `height` mode the frame is the one this view already shrank, so measure the height it
    // had before, as RN adds its current adjustment back; otherwise the room it made reads as no
    // overlap and the height springs back under the keyboard.
    const extent =
      this.behavior() === 'height' ? (this.initialHeight ?? frame.height) : frame.height;
    const overlap = screenY === undefined ? height - offset : frame.y + extent - (screenY - offset);
    return Math.min(extent, Math.max(0, overlap));
  });

  /**
   * The adjustment, or nothing to adjust. Bound as the engine's style override rather than as
   * host style, because Angular ranks a host style binding under the template's: a caller's
   * `[style]="{flex: 1}"` would otherwise keep its flex in height mode and the view would not
   * shrink at all. RN composes the adjustment after the caller's style, so it wins there too.
   */
  protected readonly avoidance = computed(() => {
    const overlap = this.overlap();
    const behavior = this.behavior();
    if (overlap === 0 || behavior === 'position') return undefined;
    if (behavior === 'height') {
      const base = this.initialHeight ?? this.frame()?.height;
      return base === undefined ? undefined : { height: base - overlap, flex: 0 };
    }
    return { paddingBottom: overlap };
  });

  protected readonly positioned = computed(() => ({
    ...this.contentContainerStyle(),
    bottom: this.overlap(),
  }));

  constructor() {
    super();
    // A duration of zero is Android's own keyboard event, which animates itself; there is
    // nothing to configure alongside it. `appear`/`leave` are turned off because this is an
    // update to a view already on screen, not one appearing or leaving - RN's own bare
    // `LayoutAnimation.configureNext({duration, update})` animates nothing else either.
    effect(() => {
      const { duration, easing } = this.keyboard();
      if (!this.enabled() || !duration) return;
      void this.layoutAnimation.animate(() => {}, {
        duration,
        easing: layoutEasingOf(easing),
        appear: 'none',
        leave: 'none',
      });
    });
  }

  protected onLayout(event: NativeSyntheticEvent<{ layout?: Rect }>): void {
    const layout = event.nativeEvent?.layout;
    if (!layout) return;
    this.frame.set({ ...layout, y: this.windowTop(layout.y) });
    // Only a layout that the keyboard did not cause counts as the natural height.
    if (this.overlap() === 0) this.initialHeight = layout.height;
  }

  /**
   * Where this view's top edge is in the window, or `fallback` where the platform cannot say.
   * Synchronous on the new architecture, so it answers for the layout being reported.
   */
  private windowTop(fallback: number): number {
    let top = fallback;
    this.engine.measure(this.node, (frame) => (top = frame.y));
    return top;
  }
}
