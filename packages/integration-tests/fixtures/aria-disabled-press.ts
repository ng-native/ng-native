import { Component, signal } from '@angular/core';
import { Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { TouchableOpacity } from '../../components/src/touchable-opacity.ts';
import { View } from '../../components/src/view.ts';

/**
 * Controls told they are disabled by `aria-disabled` or `accessibilityState` rather than by
 * `disabled`, each logging its presses under its test ID.
 */
@Component({
  selector: 'x-aria-disabled-press',
  imports: [Pressable, Text, TouchableOpacity, View],
  template: `
    <view>
      <touchable-opacity testID="fade-aria" [aria-disabled]="off()" (press)="log('fade-aria')" />
      <touchable-opacity
        testID="fade-state"
        [accessibilityState]="{ disabled: off() }"
        (press)="log('fade-state')"
      />
      <touchable-opacity
        testID="fade-own-false"
        [disabled]="false"
        [aria-disabled]="off()"
        (press)="log('fade-own-false')"
      />
      <text testID="text-aria" pressable [aria-disabled]="off()" (press)="log('text-aria')"
        >Aria</text
      >
      <text
        testID="text-state"
        pressable
        [accessibilityState]="{ disabled: off() }"
        (press)="log('text-state')"
        >State</text
      >
      <text
        testID="text-own-false"
        pressable
        [disabled]="false"
        [aria-disabled]="off()"
        (press)="log('text-own-false')"
        >Own</text
      >
      <pressable testID="pressable-aria" [aria-disabled]="off()" (press)="log('pressable-aria')" />
      <pressable
        testID="pressable-state"
        [accessibilityState]="{ disabled: off() }"
        (press)="log('pressable-state')"
      />
    </view>
  `,
})
export class AriaDisabledPress {
  readonly off = signal(true);
  readonly pressed: string[] = [];

  log(id: string): void {
    this.pressed.push(id);
  }
}
