import { Component, computed, inject } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { Foldable } from '@ng-native/expo/foldable';

const CHAPTERS = [
  { title: 'A view is a view', page: 3 },
  { title: 'Signals all the way down', page: 19 },
  { title: 'No browser required', page: 42 },
  { title: 'Reading the hinge', page: 67 },
  { title: 'Two pages, one app', page: 88 },
];

/** The chapter the book is open at. */
const CURRENT = CHAPTERS[3]!;

@Component({
  imports: [Text, View],
  selector: 'app-root',
  template: `
    <view class="desk">
      @if (split(); as fold) {
        <view class="spread">
          <view class="page left" [style.width.px]="fold.bounds.x">
            <text class="kicker">Angular Native</text>
            <text class="book">The Folding Book</text>
            <view class="rule"></view>
            @for (chapter of chapters; track chapter.page; let i = $index) {
              <view class="toc-row" [class.current]="chapter === current">
                <text class="toc-number">{{ i + 1 }}</text>
                <text class="toc-title">{{ chapter.title }}</text>
                <text class="toc-page">{{ chapter.page }}</text>
              </view>
            }
            <view class="spacer"></view>
            <view class="hinge">
              <text class="hinge-angle">{{ angle() }}</text>
              <text class="hinge-label">{{ status() }}</text>
            </view>
          </view>
          <view class="gutter" [style.width.px]="fold.bounds.width"></view>
          <view class="page right">
            <text class="chapter-number">Chapter four</text>
            <text class="chapter-title">{{ current.title }}</text>
            <text class="prose">
              The phone is open like a book, and this app knows it. Angular reads the hinge as
              signals: how far it is open, and exactly where the fold crosses the screen.
            </text>
            <text class="prose">
              So the contents sit on one page and the chapter on the other, and nothing lands in the
              fold. Close the phone a little and the angle on the left page follows your hand.
            </text>
            <view class="spacer"></view>
            <text class="folio">{{ current.page }}</text>
          </view>
        </view>
      } @else if (closed()) {
        <view class="cover">
          <text class="kicker light">Angular Native</text>
          <text class="cover-title">The Folding Book</text>
          <view class="cover-rule"></view>
          <text class="cover-hint">Open the phone to read</text>
        </view>
      } @else {
        <view class="page wide">
          <view class="wide-column">
            <text class="chapter-number">Chapter four</text>
            <text class="chapter-title">{{ current.title }}</text>
            <text class="prose">
              Flat, the phone is one wide screen, so the chapter takes all of it. Angular reads the
              hinge as signals, and the fold only splits the page when it really splits the screen.
            </text>
            <text class="prose">
              Fold the phone a little and the book opens into two pages, the contents on one side
              and the chapter on the other.
            </text>
            <view class="spacer"></view>
            <view class="hinge">
              <text class="hinge-angle">{{ angle() }}</text>
              <text class="hinge-label">{{ status() }}</text>
            </view>
          </view>
        </view>
      }
    </view>
  `,
  styles: `
    .desk {
      flex: 1;
      background-color: #1d1a17;
    }
    .spread {
      flex: 1;
      flex-direction: row;
    }
    .page {
      background-color: #f6f0e4;
      padding: 72px 36px 36px;
    }
    .left {
      padding-right: 16px;
    }
    .right {
      flex: 1;
      padding-left: 16px;
    }
    .wide {
      flex: 1;
      align-items: center;
    }
    .wide-column {
      flex: 1;
      width: 100%;
      max-width: 640px;
    }
    .gutter {
      background-color: #f6f0e4;
    }
    .kicker {
      color: #a0522d;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1.5px;
    }
    .kicker.light {
      color: #e3b27a;
    }
    .book {
      margin-top: 8px;
      color: #2b2118;
      font-family: Georgia;
      font-size: 32px;
      font-weight: 700;
    }
    .rule {
      height: 2px;
      width: 48px;
      margin: 22px 0 18px;
      background-color: #a0522d;
    }
    .toc-row {
      flex-direction: row;
      align-items: baseline;
      gap: 14px;
      padding: 11px 12px;
      border-radius: 10px;
    }
    .toc-row.current {
      background-color: #ecdcc2;
    }
    .toc-number {
      width: 16px;
      color: #a0522d;
      font-family: Georgia;
      font-size: 16px;
    }
    .toc-title {
      flex: 1;
      color: #3a2e24;
      font-family: Georgia;
      font-size: 18px;
    }
    .toc-page {
      color: #8c7b6b;
      font-family: Georgia;
      font-size: 15px;
    }
    .spacer {
      flex: 1;
    }
    .hinge {
      flex-direction: row;
      align-items: baseline;
      gap: 12px;
    }
    .hinge-angle {
      color: #a0522d;
      font-size: 44px;
      font-weight: 800;
    }
    .hinge-label {
      color: #8c7b6b;
      font-size: 15px;
      font-weight: 600;
    }
    .chapter-number {
      color: #a0522d;
      font-family: Georgia;
      font-size: 17px;
      font-style: italic;
    }
    .chapter-title {
      margin: 6px 0 24px;
      color: #2b2118;
      font-family: Georgia;
      font-size: 34px;
      font-weight: 700;
    }
    .prose {
      margin-bottom: 16px;
      color: #3a2e24;
      font-family: Georgia;
      font-size: 19px;
      line-height: 31px;
    }
    .folio {
      align-self: center;
      color: #8c7b6b;
      font-family: Georgia;
      font-size: 15px;
    }
    .cover {
      flex: 1;
      justify-content: center;
      align-items: center;
      gap: 12px;
      background-color: #3b2a1e;
    }
    .cover-title {
      color: #f6f0e4;
      font-family: Georgia;
      font-size: 36px;
      font-weight: 700;
    }
    .cover-rule {
      height: 2px;
      width: 48px;
      margin: 8px 0;
      background-color: #e3b27a;
    }
    .cover-hint {
      color: #cdb79c;
      font-size: 16px;
    }
  `,
})
export class App {
  private readonly foldable = inject(Foldable);
  protected readonly chapters = CHAPTERS;
  protected readonly current = CURRENT;

  protected readonly split = computed(() => {
    const fold = this.foldable.fold();
    return this.foldable.separating() && fold?.orientation === 'vertical' ? fold : null;
  });

  protected readonly closed = computed(() => this.foldable.posture() === 'closed');

  protected readonly angle = computed(() => {
    const angle = this.foldable.angle();
    return angle === null ? '' : `${Math.round(angle)}°`;
  });

  protected readonly status = computed(() => {
    if (!this.foldable.available()) return '';
    if (this.foldable.book()) return 'open like a book';
    if (this.foldable.posture() === 'fully-open') return 'open flat';
    return this.foldable.posture();
  });
}
