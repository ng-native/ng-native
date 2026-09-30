import { Component, Directive, input, signal } from '@angular/core';
import {
  PressBehavior,
  Text,
  View,
  contributeAccessibility,
  type AccessibilityContribution,
} from '../../components/src/index.ts';

/**
 * What a toggle button is to a screen reader, contributed from a directive of its own the way a
 * headless behaviour library would: a role, and state that follows a signal.
 */
@Directive({ selector: '[xToggleRole]' })
export class ToggleRole implements AccessibilityContribution {
  readonly on = input(false, { alias: 'xToggleRole' });
  readonly role = 'togglebutton' as const;
  private readonly contribution = contributeAccessibility(this);

  accessibilityState() {
    return { checked: this.on() };
  }
}

/**
 * A control composed onto its own host rather than wrapped around a `<pressable>`: the press
 * machine from `PressBehavior`, with `disabled` and `(press)` exposed, and a role contributed.
 */
@Component({
  selector: 'x-toggle',
  template: `<ng-content />`,
  hostDirectives: [
    { directive: PressBehavior, inputs: ['disabled'], outputs: ['press'] },
    { directive: ToggleRole, inputs: ['xToggleRole: on'] },
  ],
})
export class Toggle {}

@Component({
  selector: 'x-composing',
  imports: [Text, Toggle, ToggleRole, View],
  template: `
    <view>
      <x-toggle accessibilityLabel="Wi-Fi" [on]="on()" [disabled]="locked()" (press)="on.set(!on())"
        ><text>Wi-Fi</text></x-toggle
      >
      <text pressable xToggleRole>Bluetooth</text>
    </view>
  `,
})
export class Composing {
  readonly on = signal(false);
  readonly locked = signal(false);
}
