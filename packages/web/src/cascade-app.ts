/**
 * Fixture for `browser/cascade.test.ts`: one of each thing a real browser has to resolve for a
 * style to look right, and jsdom cannot - layout, a transform, paint, a pressed or hovered state,
 * a colour scheme, and two components' scoped sheets side by side. Everything sits in one wrapping
 * row so the whole page fits the suite's viewport, and each test measures relative to its own
 * elements rather than to where the row happened to put them.
 */
import { Component, inject } from '@angular/core';
import { ActivityIndicator, Image, Pressable, Text, View } from '@ng-native/components';
import { Animated, AnimatedStyle, Easing } from '@ng-native/components/animations';
import { ColorScheme } from '@ng-native/device';

/** Two components that both style a `.label`, each in its own colour. */
@Component({
  selector: 'cascade-card',
  imports: [Text],
  template: '<text id="card-label" class="label">card</text>',
  styles: '.label { color: rgb(0, 128, 0); }',
})
export class CascadeCard {}

@Component({
  selector: 'cascade-badge',
  imports: [Text],
  template: '<text id="badge-label" class="label">badge</text>',
  styles: '.label { color: rgb(0, 0, 255); }',
})
export class CascadeBadge {}

@Component({
  selector: 'app-root',
  imports: [
    ActivityIndicator,
    AnimatedStyle,
    CascadeBadge,
    CascadeCard,
    Image,
    Pressable,
    Text,
    View,
  ],
  template: `
    <view class="flex-row flex-wrap items-start gap-2">
      <view id="column" class="w-40 gap-4">
        <view id="c1" class="h-10"></view>
        <view id="c2" class="h-10"></view>
      </view>
      <view id="row" [style]="row">
        <view id="r1" class="h-10 w-10"></view>
        <view id="r2" class="h-10 w-10"></view>
      </view>
      <view id="stage" class="h-40 w-40">
        <view id="popover" [style]="popover"></view>
      </view>
      <view id="moved" class="h-10 w-10" [style]="moved"></view>
      <view id="animated" class="h-10 w-10" [style]="tint" [animatedStyle]="motion"></view>

      <view id="gradient" class="h-10 w-20 bg-linear-to-r from-[#ff0000] to-[#0000ff]"></view>
      <view id="shadow" class="h-10 w-20" [style]="shadow"></view>
      <view id="framed" class="h-10 w-10" [style]="framed"></view>
      <view id="tinted-frame" class="h-10 w-10 border-2 border-[#ff0000]"></view>
      <activity-indicator id="spinner" color="rgb(255, 0, 0)" />
      <activity-indicator id="stopped" [animating]="false" />
      <image id="blurred" class="h-10 w-10" [source]="picture" [blurRadius]="4" />

      <pressable id="held" class="h-10 w-20"><text>Hold</text></pressable>
      <pressable id="pressed" class="h-10 w-20 bg-[#101010] press:bg-[#202020]">
        <text>Press</text>
      </pressable>
      <view id="hovered" class="h-10 w-20 bg-[#303030] hover:bg-[#404040]"></view>

      <cascade-card />
      <cascade-badge />
      <text id="plain" class="label">plain</text>

      <view [class]="scheme.current()">
        <view id="themed" class="h-10 w-10 bg-[#ffffff] dark:bg-[#000000]"></view>
      </view>
      <view id="rooted" class="h-10 w-10 bg-[#ffffff] dark:bg-[#000000]"></view>
      <view id="notched" class="pt-safe" style="--safe-area-inset-top: 30px"></view>
      <view id="unnotched" class="pt-safe"></view>
    </view>
  `,
  styles: `
    #held {
      background-color: rgb(1, 1, 1);
    }
    #held:active {
      background-color: rgb(2, 2, 2);
    }
  `,
})
export class CascadeApp {
  protected readonly scheme = inject(ColorScheme);

  protected readonly row = { flexDirection: 'row', gap: 12 };
  /** Where an anchored overlay puts its card: numbers, in points, as `anchor.ts` computes them. */
  protected readonly popover = { position: 'absolute', top: 96, left: 40, width: 60, height: 20 };
  protected readonly moved = { transform: [{ translateX: 30 }, { translateY: 10 }] };
  protected readonly framed = { borderWidth: 2 };
  protected readonly shadow = {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
  };
  /** A fade on a timing curve and a slide on a spring, together, as an app would write them. */
  private readonly fade = new Animated.Value(1);
  private readonly slide = new Animated.Value(0);
  protected readonly tint = { backgroundColor: 'rgb(3, 2, 1)' };
  protected readonly motion = { opacity: this.fade, transform: [{ translateX: this.slide }] };

  play(done: (finished: boolean) => void): void {
    Animated.parallel([
      Animated.timing(this.fade, {
        toValue: 0.2,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(this.slide, { toValue: 40, useNativeDriver: true }),
    ]).start(({ finished }) => done(finished));
  }

  protected readonly picture = {
    uri: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/%3E",
  };
}
