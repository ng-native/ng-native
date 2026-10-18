import { Component, computed, inject } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { Palette } from '../palette.ts';
import { page } from '../screen-styles.ts';

/** Nested text must be a span (VirtualText), not a nested paragraph, or it renders raised. */
@Component({
  selector: 'x-text-nesting',
  imports: [NativeHeader, ScrollView, Text, View],
  template: `
    <native-header title="Text nesting" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <view class="probe">
        <text>1 no styles: AAA <text>BBB</text></text>
        <text [style]="s16()">2 outer only: AAA <text>BBB</text></text>
        <text [style]="s16()">3 both same: AAA <text [style]="s16()">BBB</text></text>
        <text [style]="s16()">4 control single run: AAA BBB</text>
        <text [style]="s16()">5 child bold: AAA <text [style]="s16bold()">BBB</text></text>
        <text [style]="s16()">6 child smaller: AAA <text [style]="s12()">BBB</text></text>
      </view>
      <text class="hint">
        Every BBB must sit on the same baseline as its AAA and inherit its size unless overridden.
      </text>
    </scroll-view>
  `,
  styles: `
    .probe {
      background-color: var(--card-inset);
      padding: 12px;
      border-radius: 8px;
      gap: 6px;
    }
  `,
})
export class TextNesting {
  protected readonly page = page;
  private readonly palette = inject(Palette);
  // Inline rather than classes, because inline style on a nested span is what this checks. The
  // colours come from the palette so the probe reads in either appearance.
  protected readonly s16 = computed(() => ({
    color: this.palette.current().textStrong,
    fontSize: 16,
  }));
  protected readonly s16bold = computed(() => ({
    color: this.palette.current().success,
    fontSize: 16,
    fontWeight: '700',
  }));
  protected readonly s12 = computed(() => ({
    color: this.palette.current().success,
    fontSize: 12,
  }));
}
