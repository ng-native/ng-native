import {
  type AfterViewChecked,
  Directive,
  DestroyRef,
  afterEveryRender,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { Engine, type EngineNode, nativePlatform } from '@ng-native/fabric';
import { SwipeRefreshLayout } from './swipe-refresh-layout.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';
import { ViewBase } from './view-base.ts';

/**
 * Pull to refresh, as a child of a scroll view. Commits as `PullToRefreshView` on iOS and
 * `AndroidSwipeRefreshLayout` on Android.
 *
 * `refreshing` is a model: the pull fires `(refresh)`, the app sets `refreshing` to true while
 * it works and back to false when done. Native shows the spinner the instant the user pulls,
 * before the app has said anything, so the two can disagree. RN's wrapper reconciles them with
 * `setNativeRefreshing`; so does this. If the app never sets `refreshing` after a pull, the
 * spinner is stopped again, which is what RN's documentation warns about.
 *
 * On Android the swipe layout has to be the scroll view's *parent*, as RN's `ScrollView.js` makes
 * it, with the layout half of the scroll view's style moved onto it. It is written as a child all
 * the same, like on iOS, and moved into place after each pass; see `SwipeRefreshLayout`.
 */
@Directive({
  selector: 'refresh-control',
  host: {
    '[refreshing]': 'refreshing()',
    '[progressViewOffset]': 'progressViewOffset()',
    '[tintColor]': 'tintColor()',
    '[title]': 'title()',
    '[titleColor]': 'titleColor()',
    '[colors]': 'colors()',
    '[enabled]': 'enabled()',
    '[progressBackgroundColor]': 'progressBackgroundColor()',
    '[size]': 'size()',
    '(refresh)': 'onNativeRefresh()',
  },
})
export class RefreshControl extends ViewBase implements AfterViewChecked {
  /**
   * Whether the spinner shows. Only the app changes it: a pull fires `(refresh)` and leaves this
   * alone, so `[(refreshing)]` and `[refreshing]` behave the same.
   */
  readonly refreshing = model(false);
  /** How far from the top the spinner sits. */
  readonly progressViewOffset = input(undefined, { transform: optionalNumber });
  /** iOS: the spinner's colour. */
  readonly tintColor = input<string>();
  /** iOS: a label under the spinner. */
  readonly title = input<string>();
  /** iOS: the label's colour. */
  readonly titleColor = input<string>();
  /** Android: the colours the spinner cycles through. */
  readonly colors = input<readonly string[]>();
  /** Android: whether pulling does anything. Defaults to true. */
  readonly enabled = input(undefined, { transform: optionalBoolean });
  /** Android: the spinner's background. */
  readonly progressBackgroundColor = input<string>();
  /** Android: the spinner's size. */
  readonly size = input<'default' | 'large'>();

  private readonly nativeRefreshing = signal<boolean | null>(null);

  /** Android only: what moves this control's node to wrap the scroll view. */
  private readonly wrap =
    nativePlatform() === 'android'
      ? new SwipeRefreshLayout(inject(Engine), this.node as EngineNode)
      : null;

  constructor() {
    super();
    const wrap = this.wrap;
    if (wrap) {
      // After every render as well as after this control's own pass: Angular moving the scroll
      // view happens in some other component's pass, and this one's hooks would not see it.
      afterEveryRender(() => wrap.sync());
      inject(DestroyRef).onDestroy(() => wrap.unwrap());
    }
    effect(() => {
      const desired = this.refreshing();
      const native = this.nativeRefreshing();
      if (native !== null && native !== desired) {
        this.nativeRefreshing.set(desired);
        this.engine.dispatchCommand(this.node, 'setNativeRefreshing', [desired]);
      }
    });
  }

  /**
   * The scroll view's style is written in the pass that declared this control, so splitting it
   * here reaches native in the same commit.
   */
  ngAfterViewChecked(): void {
    this.wrap?.sync();
  }

  /** Native has already started spinning; the app is told and expected to set `refreshing`. */
  protected onNativeRefresh(): void {
    this.nativeRefreshing.set(true);
  }
}
