/**
 * Fixture for `browser/tailwind-3.test.ts`: classes for the Tailwind 3 web preset, built with a
 * `tw-` prefix so the Tailwind 4 sheet the rest of the browser suite loads makes nothing of them.
 */
import { Component, inject } from '@angular/core';
import { ColorScheme } from '@ng-native/device';
import { Pressable, Text } from '@ng-native/components';

/** Every class the fixture wears, for Tailwind 3's `content`. */
export const TAILWIND_3_CLASSES =
  'hover:tw-bg-red-500 focus-visible:tw-bg-blue-500 tw-font-mono tw-h-hairline tw-pt-safe ' +
  'dark:tw-bg-black web:tw-pt-2 ios:tw-pt-4 native:tw-pt-6 tw-group group-hover:tw-text-red-500';

@Component({
  selector: 'app-root',
  imports: [Pressable, Text],
  template: `
    <pressable id="button" class="tw-group hover:tw-bg-red-500 focus-visible:tw-bg-blue-500">
      <text id="label" class="group-hover:tw-text-red-500">Go</text>
    </pressable>
    <text id="mono" class="tw-font-mono">code</text>
    <view id="hairline" class="tw-h-hairline" style="display: block"></view>
    <view id="safe" class="tw-pt-safe"></view>
    <view id="themed" class="dark:tw-bg-black"></view>
    <view id="web" class="web:tw-pt-2"></view>
    <view id="ios" class="ios:tw-pt-4 native:tw-pt-6"></view>
  `,
})
export class Tailwind3App {
  readonly scheme = inject(ColorScheme);
}
