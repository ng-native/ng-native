import { Component, signal } from '@angular/core';
import { Image } from '../../components/src/image.ts';
import { Pressable } from '../../components/src/pressable.ts';
import { Switch } from '../../components/src/switch.ts';
import { Text } from '../../components/src/text.ts';
import { TouchableOpacity } from '../../components/src/touchable-opacity.ts';
import { View } from '../../components/src/view.ts';

/** Every case the defaults have to get right, on one screen. */
@Component({
  selector: 'x-a11y',
  imports: [Image, Pressable, Switch, Text, TouchableOpacity, View],
  template: `
    <view testID="plain"></view>

    <pressable testID="button"><text>Save</text></pressable>
    <pressable testID="opted-out" accessible="false" focusable="false"></pressable>
    <pressable testID="off" [disabled]="true"></pressable>
    <pressable testID="toggling" [disabled]="off()"></pressable>
    <pressable testID="labelled" accessibilityRole="link" aria-label="Open the docs"></pressable>

    <touchable-opacity testID="fade"></touchable-opacity>

    <text testID="prose">Just words</text>
    <text testID="tappable" [pressable]="true">Tap me</text>

    <switch testID="toggle" />
    <switch testID="checkbox" accessibilityRole="checkbox" />
    <switch testID="unavailable" [disabled]="true" />
    <switch testID="switched-on" [checked]="true" />
    <switch testID="said-off" [checked]="true" aria-checked="false" />

    <image testID="pic" alt="A cat asleep on a keyboard" />
    <image testID="decoration" />

    <view testID="busy" [pointerEvents]="busy() ? 'none' : undefined"></view>
  `,
})
export class Accessible {
  readonly off = signal(false);
  readonly busy = signal(true);
}
