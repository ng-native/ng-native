import { Directive, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ScrollView } from '@ng-native/components';

/**
 * `?scroll=<points>` in a page's link scrolls its screen there, with no animation: how the
 * screenshot flows reach the lower part of a page exactly, where a swipe lands a few points apart
 * from one run to the next. Applied again as the content grows, so an image that loads late does
 * not leave it short.
 */
@Directive({
  selector: 'scroll-view.screen',
  host: { '(contentSizeChange)': 'apply()' },
})
export class ScreenScroll {
  private readonly view = inject(ScrollView);
  private readonly y = signal(0);

  constructor() {
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((params) => this.y.set(Number(params.get('scroll')) || 0));
    effect(() => this.apply());
  }

  protected apply(): void {
    const y = this.y();
    if (y) this.view.scrollTo({ y, animated: false });
  }
}
