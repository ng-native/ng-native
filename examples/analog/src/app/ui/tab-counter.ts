import { Component, input, signal } from '@angular/core';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { FeatureNote } from './feature-note.ts';

/**
 * A tab's page: the file that made it, and a count kept in the page itself, which survives a
 * switch to the other tab and back because the tab's screen stays mounted.
 */
@Component({
  selector: 'app-tab-counter',
  imports: [FeatureNote, Pressable, ScrollView, Text, View],
  template: `
    <scroll-view class="scroll" contentInsetAdjustmentBehavior="automatic">
      <view class="content">
        <app-feature-note [file]="file()" [explanation]="explanation()" />
        <view class="card result-row">
          <text class="result-label">{{ label() }}</text>
          <text class="result">{{ count() }}</text>
        </view>
        <pressable
          accessibilityRole="button"
          [accessibilityLabel]="'Add to ' + label()"
          class="primary"
          (press)="add()"
        >
          <text class="primary-text">Add one</text>
        </pressable>
      </view>
    </scroll-view>
  `,
  styleUrl: './page.css',
})
export class TabCounter {
  readonly file = input.required<string>();
  readonly explanation = input.required<string>();
  readonly label = input.required<string>();

  protected readonly count = signal(0);

  protected add(): void {
    this.count.update((count) => count + 1);
  }
}
