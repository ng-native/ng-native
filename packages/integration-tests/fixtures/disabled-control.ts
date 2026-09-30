import { Component, signal } from '@angular/core';
import { Pressable } from '../../components/src/pressable.ts';
import { Switch } from '../../components/src/switch.ts';
import { Text } from '../../components/src/text.ts';
import { TouchableOpacity } from '../../components/src/touchable-opacity.ts';
import { View } from '../../components/src/view.ts';

/** A disabled control in every way a template can say so, and one that changes at runtime. */
@Component({
  selector: 'x-disabled-control',
  imports: [Pressable, Switch, Text, TouchableOpacity, View],
  template: `
    <view>
      <pressable testID="bound" accessibilityRole="button" class="p" [disabled]="true">
        <text class="label">Bound</text>
      </pressable>
      <pressable testID="attribute" accessibilityRole="button" class="p" disabled>
        <text>Attribute</text>
      </pressable>
      <pressable testID="toggling" accessibilityRole="button" class="p" [disabled]="off()">
        <text>Save</text>
      </pressable>
      <pressable testID="enabled" accessibilityRole="button" class="p"><text>Go</text></pressable>
      <pressable testID="tailwind" class="group disabled:bg-gray-300" [disabled]="off()">
        <text testID="tailwind-label" class="group-disabled:text-red-500">Tailwind</text>
      </pressable>
      <view testID="reference" class="bg-gray-300">
        <text testID="reference-label" class="text-red-500">Reference</text>
      </view>
      <touchable-opacity testID="fade" class="p" [disabled]="true"></touchable-opacity>
      <switch testID="switch" class="p" [disabled]="true" />
      <text testID="text" class="p disabled:bg-gray-300" [disabled]="off()">Off</text>
      <text testID="pressable-text" class="p" pressable [disabled]="off()">Link</text>
      <text accessibilityRole="link" pressable [disabled]="off()">Terms</text>
      <text testID="static-text" disabled>Static</text>
      <text
        testID="text-with-state"
        pressable
        [accessibilityState]="{ selected: true }"
        [disabled]="off()"
      >
        Chosen
      </text>
      <text testID="text-both" pressable [disabled]="off()" [aria-disabled]="off()">Both</text>
      <text>Read the <text testID="nested-text" pressable [disabled]="off()">notes</text></text>
      <pressable testID="aria" class="a group aria-disabled:bg-gray-300" [aria-disabled]="off()">
        <text testID="aria-label" class="a-label group-aria-disabled:text-red-500">Aria</text>
      </pressable>
      <text testID="aria-text" class="a aria-disabled:bg-gray-300" [aria-disabled]="off()">
        Aria text
      </text>
      <view testID="aria-static" class="a aria-disabled:bg-gray-300" aria-disabled="true"></view>
      <view testID="aria-false" class="a aria-disabled:bg-gray-300" aria-disabled="false"></view>
      <pressable testID="both" class="a p" [disabled]="off()" [aria-disabled]="off()"></pressable>
      <view
        testID="aria-states"
        class="s"
        aria-busy="true"
        aria-checked="mixed"
        aria-expanded="true"
        aria-selected="true"
        aria-hidden="true"
      ></view>
    </view>
  `,
})
export class DisabledControl {
  readonly off = signal(true);
}
