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
      <touchable-opacity testID="fade" class="p" [disabled]="true"></touchable-opacity>
      <switch testID="switch" class="p" [disabled]="true" />
    </view>
  `,
})
export class DisabledControl {
  readonly off = signal(true);
}
