import { Component, signal } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { heroAcademicCap, heroBolt, heroHeart } from '@ng-icons/heroicons/outline';
import { heroFireSolid, heroStarSolid } from '@ng-icons/heroicons/solid';
import { lucideCompass, lucideTarget, lucideWaves } from '@ng-icons/lucide';
import { NgIcon } from '@ng-native/icons';
import { Pressable, ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

/**
 * ng-icons, rendered as native shapes.
 *
 * The imports above are the ones a web app writes, and `provideIcons` is ng-icons' own. What is
 * different is underneath: the markup is parsed and committed as react-native-svg views rather
 * than inserted as HTML, and the two things ng-icons expresses in CSS - `currentColor` and the
 * stroke-width custom property - are inputs.
 */
@Component({
  selector: 'x-icons',
  imports: [NgIcon, NativeHeader, Pressable, ScrollView, Text, View],
  providers: [
    provideIcons({
      heroAcademicCap,
      heroBolt,
      heroHeart,
      heroFireSolid,
      heroStarSolid,
      lucideCompass,
      lucideTarget,
      lucideWaves,
    }),
  ],
  template: `
    <native-header title="Icons" [largeTitle]="true" />
    <scroll-view
      class="screen"
      contentInsetAdjustmentBehavior="automatic"
      [contentContainerStyle]="page.content"
    >
      <text class="hint">
        The same @ng-icons packages a web app uses, drawn as react-native-svg shapes. Nothing here
        is an image: every stroke is a native path.
      </text>

      <text class="heading">Outline, stroked</text>
      <view [style]="row">
        @for (name of outline; track name) {
          <ng-icon [name]="name" [size]="size()" [color]="color()" [strokeWidth]="weight()" />
        }
      </view>

      <text class="heading">Solid, filled</text>
      <view [style]="row">
        @for (name of solid; track name) {
          <ng-icon [name]="name" [size]="size()" [color]="color()" />
        }
      </view>

      <text class="heading">Another set, same component</text>
      <view [style]="row">
        @for (name of mixed; track name) {
          <ng-icon [name]="name" [size]="size()" [color]="color()" [strokeWidth]="weight()" />
        }
      </view>

      <text class="heading">Bound, not baked</text>
      <text class="body"> {{ size() }}pt, stroke {{ weight() }}, {{ color() }} </text>
      <view [style]="page.row">
        <pressable class="card" [style]="grow" (press)="bigger()">
          <text class="button-label">Size</text>
        </pressable>
        <pressable class="card" [style]="grow" (press)="heavier()">
          <text class="button-label">Weight</text>
        </pressable>
        <pressable class="card" [style]="grow" (press)="recolour()">
          <text class="button-label">Colour</text>
        </pressable>
      </view>
      <text class="hint">
        Colour changes without re-parsing anything: currentColor is a brush native resolves from the
        view, so the icon keeps the shapes it already committed.
      </text>
    </scroll-view>
  `,
})
export class IconsPage {
  protected readonly page = page;
  protected readonly row = { flexDirection: 'row', gap: 16, alignItems: 'center' };
  protected readonly grow = { flex: 1 };

  protected readonly outline = ['heroAcademicCap', 'heroBolt', 'heroHeart'];
  protected readonly solid = ['heroFireSolid', 'heroStarSolid'];
  protected readonly mixed = ['lucideCompass', 'lucideTarget', 'lucideWaves'];

  protected readonly size = signal(32);
  protected readonly weight = signal(1.5);
  protected readonly color = signal('#ff9f0a');

  private readonly colours = ['#ff9f0a', '#32d74b', '#0a84ff', '#8a5cf6'];

  protected bigger(): void {
    this.size.update((value) => (value >= 56 ? 24 : value + 8));
  }

  protected heavier(): void {
    this.weight.update((value) => (value >= 3 ? 1 : value + 0.5));
  }

  protected recolour(): void {
    this.color.update((value) => this.colours[(this.colours.indexOf(value) + 1) % 4]!);
  }
}
