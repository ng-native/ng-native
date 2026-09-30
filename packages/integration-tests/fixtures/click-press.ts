import { Component, signal } from '@angular/core';
import { PressBehavior, Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { TouchableOpacity } from '../../components/src/touchable-opacity.ts';
import { View } from '../../components/src/view.ts';

/** A button composed onto its own host, as the Pressable page describes. */
@Component({
  selector: 'x-click-button',
  template: `<ng-content />`,
  hostDirectives: [{ directive: PressBehavior, inputs: ['disabled'], outputs: ['press'] }],
})
export class ClickButton {}

/** Every kind of touchable, logging each event under its test ID. */
@Component({
  selector: 'x-click-press',
  imports: [ClickButton, Pressable, Text, TouchableOpacity, View],
  template: `
    <view testID="outer" (click)="log('outer click')">
      <pressable
        testID="pressable"
        (pressIn)="log('pressable in')"
        (press)="log('pressable')"
        (pressOut)="log('pressable out')"
      />
      <touchable-opacity testID="fade" (press)="log('fade')" />
      <text testID="text" pressable (press)="log('text')">Link</text>
      <x-click-button testID="composed" (press)="log('composed')" />
      <pressable testID="off" [disabled]="off()" (press)="log('off')" />
      <touchable-opacity testID="fade-aria" [aria-disabled]="off()" (press)="log('fade-aria')" />
      <text testID="text-toggle" [pressable]="!off()" (press)="log('text-toggle')">Toggle</text>
      <pressable testID="row" (press)="log('row')">
        <pressable testID="button" (press)="log('button')" />
      </pressable>
    </view>
  `,
})
export class ClickPress {
  readonly off = signal(true);
  readonly events: string[] = [];

  log(event: string): void {
    this.events.push(event);
  }
}
