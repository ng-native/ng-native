import { Component, Directive, input } from '@angular/core';
import { Pressable } from '../../components/src/pressable.ts';
import { Switch } from '../../components/src/switch.ts';
import { Text } from '../../components/src/text.ts';
import { TextInput } from '../../components/src/text-input.ts';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-misspelt-props',
  imports: [Switch, Text, View],
  template: `
    <text [numberofLines]="2">long</text>
    <text [numberofLines]="3">longer</text>
    <view [backgroundcolor]="'red'"></view>
    <switch iosBackgroundColor="red" />
  `,
})
export class MisspeltProps {}

/** An app directive with an input, written as a static attribute on a primitive. */
@Directive({ selector: '[appTooltip]' })
export class Tooltip {
  readonly appTooltip = input('');
}

@Component({
  selector: 'x-declared-props',
  imports: [Pressable, Switch, Text, TextInput, Tooltip, View],
  template: `
    <view
      class="card"
      style="padding: 4px"
      [style.opacity]="0.5"
      testID="card"
      nativeID="card"
      accessibilityLabel="Card"
      aria-label="Card"
      role="button"
      pointerEvents="box-none"
      appTooltip="Hello"
      data-kind="primary"
      (layout)="noop()"
    >
      <text numberOfLines="2" ellipsizeMode="tail" selectable listHeader>words</text>
      <pressable [disabled]="true" hitSlop="4" (press)="noop()" (longPress)="noop()">
        <text>press</text>
      </pressable>
      <switch [checked]="true" thumbColor="#fff" ios_backgroundColor="#eee" />
      <text-input placeholder="Name" keyboardType="email-address" [maxLength]="20" />
      <text-input multiline rows="3" />
    </view>
  `,
})
export class DeclaredProps {
  noop(): void {}
}
