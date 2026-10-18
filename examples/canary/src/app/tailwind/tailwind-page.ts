import { Component } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { page } from '../screen-styles.ts';

/**
 * Tailwind utilities that make one value out of several classes, drawn: the cases a stylesheet
 * test can only read as props. Rings beside shadows, colour classes on text and drop shadows, the
 * spacing and dividers that skip the last child, and a side overriding a pair.
 *
 * The iOS flow compares this screen with a screenshot of it, and the Android release smoke opens
 * it, which is enough to catch a value the native side refuses: the colour of a drop shadow once
 * reached Android as a string and took the whole surface down. Nothing here animates, so the
 * screenshot is the same every time. The Android-only filters draw nothing on iOS.
 *
 * Tailwind reads every word in this file as a class it might generate, and the canary's other
 * screens have classes of their own: keep the utility names out of the prose.
 */ @Component({
  selector: 'x-tailwind',
  imports: [NativeHeader, ScrollView, Text, View],
  template: `
    <native-header title="Tailwind" />
    <scroll-view class="screen" [contentContainerStyle]="page.content">
      <view class="flex-row flex-wrap items-center gap-5 p-2">
        <view class="size-10 rounded-md bg-white ring-2 ring-blue-500"></view>
        <view class="size-10 rounded-md bg-white text-green-600 ring-4"></view>
        <view class="bg-zinc-800 p-2">
          <view
            class="size-8 rounded-md bg-zinc-800 ring-2 ring-blue-500 ring-offset-4 ring-offset-white"
          ></view>
        </view>
        <view class="size-10 rounded-md bg-white ring-4 ring-rose-500 ring-inset"></view>
        <view class="size-10 rounded-md bg-white shadow-lg ring-2 ring-blue-500"></view>
        <view class="size-10 rounded-md bg-white shadow-lg shadow-red-500"></view>
      </view>
      <text class="hint">Rings: a colour, the text colour, an offset, inset, beside a shadow.</text>

      <view class="flex-row items-center gap-4">
        <view class="h-12 w-20 border border-zinc-400">
          <view class="size-6 translate-x-6 translate-y-3 bg-blue-500"></view>
        </view>
        <view class="h-8 w-24 border border-zinc-400">
          <view class="h-8 w-12 translate-x-1/2 bg-green-500"></view>
        </view>
        <view class="size-10 rotate-x-45 ios:skew-x-12 bg-purple-500"></view>
        <view class="size-10 scale-x-50 scale-y-75 bg-amber-500"></view>
      </view>
      <text class="hint"
        >Translate on two axes, by half its width, 3D rotation and iOS skew, scale.</text
      >

      <view class="flex-row flex-wrap items-start gap-4">
        <view class="flex-row space-x-3 border border-zinc-400">
          <view class="size-6 bg-sky-500"></view>
          <view class="size-6 bg-sky-500"></view>
          <view class="size-6 bg-sky-500"></view>
        </view>
        <view class="flex-row-reverse space-x-3 space-x-reverse border border-zinc-400">
          <view class="size-6 bg-teal-400"></view>
          <view class="size-6 bg-teal-600"></view>
          <view class="size-6 bg-teal-800"></view>
        </view>
        <view class="w-20 divide-y-2 divide-dashed divide-red-500 border border-zinc-400">
          <view class="h-5"></view>
          <view class="h-5"></view>
          <view class="h-5"></view>
        </view>
        <view class="flex-row divide-x-4 divide-blue-500 border border-zinc-400">
          <view class="size-6 bg-amber-200"></view>
          <view class="size-6 bg-amber-200"></view>
        </view>
      </view>
      <text class="hint">Space and dividers between children, none after the last.</text>

      <view class="flex-row items-center gap-5">
        <view
          class="size-10 border-x-4 border-l-2 border-red-500 border-l-blue-500 bg-white"
        ></view>
        <view class="size-10 border-4 border-hidden border-x bg-amber-200"></view>
        <view class="text-shadow-xs text-shadow-red-500">
          <text class="text-2xl font-bold">Shadow</text>
        </view>
        <text class="text-lg tabular-nums oldstyle-nums">1234567890</text>
      </view>
      <text class="hint">A side over a pair, no border, an inherited text shadow, figures.</text>

      <view class="flex-row flex-wrap items-center gap-5 p-2">
        <view class="size-10 bg-blue-500 brightness-50"></view>
        <view class="size-10 bg-blue-500 android:grayscale"></view>
        <view class="size-10 bg-blue-500 android:blur-sm"></view>
        <view class="size-10 bg-white android:drop-shadow-lg android:drop-shadow-red-500"></view>
        <view class="h-10 w-24 bg-linear-to-r from-red-500 via-blue-500 to-green-500"></view>
      </view>
      <text class="hint">Filters, three of them on Android only, and a gradient.</text>
    </scroll-view>
  `,
})
export class TailwindPage {
  protected readonly page = page;
}
