import { Component, Directive, inject, input, signal, viewChild } from '@angular/core';
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

/** State with no role, contributed the way a form library marks a field it has locked. */
@Directive({ selector: '[xLocked]' })
export class Locked implements AccessibilityContribution {
  private readonly contribution = contributeAccessibility(this);

  accessibilityState() {
    return { disabled: true };
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

/** A checkbox that is itself the pressable, toggling on its own press through a host listener. */
@Component({
  selector: 'x-checkbox',
  template: `<ng-content />`,
  hostDirectives: [{ directive: PressBehavior, inputs: ['disabled'], outputs: ['press'] }],
  host: { '(press)': 'toggle()' },
})
export class Checkbox {
  readonly checked = signal(false);

  toggle(): void {
    this.checked.update((checked) => !checked);
  }
}

/** The same, with `press` left unforwarded: the host listener hears nothing. */
@Component({
  selector: 'x-unforwarded-checkbox',
  template: `<ng-content />`,
  hostDirectives: [PressBehavior],
  host: { '(press)': 'toggle()' },
})
export class UnforwardedCheckbox {
  readonly checked = signal(false);

  toggle(): void {
    this.checked.update((checked) => !checked);
  }
}

/** The same through the injected behaviour, which needs nothing forwarded. */
@Component({
  selector: 'x-injected-checkbox',
  template: `<ng-content />`,
  hostDirectives: [PressBehavior],
})
export class InjectedCheckbox {
  readonly checked = signal(false);

  constructor() {
    inject(PressBehavior).press.subscribe(() => this.checked.update((checked) => !checked));
  }
}

@Component({
  selector: 'x-composing',
  imports: [
    Checkbox,
    InjectedCheckbox,
    Locked,
    Text,
    Toggle,
    ToggleRole,
    UnforwardedCheckbox,
    View,
  ],
  template: `
    <view>
      <x-toggle accessibilityLabel="Wi-Fi" [on]="on()" [disabled]="locked()" (press)="on.set(!on())"
        ><text>Wi-Fi</text></x-toggle
      >
      <text pressable xToggleRole>Bluetooth</text>
      <text testID="locked" pressable xLocked>Locked</text>
      <x-checkbox testID="checkbox" #checkbox (press)="presses.set(presses() + 1)" />
      <x-unforwarded-checkbox testID="unforwarded" #unforwarded />
      <x-injected-checkbox testID="injected" #injected />
    </view>
  `,
})
export class Composing {
  readonly on = signal(false);
  readonly locked = signal(false);
  readonly presses = signal(0);
  readonly checkbox = viewChild.required<Checkbox>('checkbox');
  readonly unforwarded = viewChild.required<UnforwardedCheckbox>('unforwarded');
  readonly injected = viewChild.required<InjectedCheckbox>('injected');
}
