import { Component, signal } from '@angular/core';
import { UiHost, UiText, UiToggle, type UiModifier } from '../../expo/src/expo-ui-components.ts';

const DISABLED: readonly UiModifier[] = [{ $type: 'disabled', disabled: true }];

/**
 * `@expo/ui` switches as an app writes them: one bound to `isOn`, one left to switch itself, and
 * one SwiftUI's `disabled` modifier turns off.
 */
@Component({
  selector: 'x-testing-expo-ui-toggle',
  imports: [UiHost, UiText, UiToggle],
  template: `
    <ui-host [matchContents]="true">
      <ui-toggle
        testID="wifi"
        label="Wi-Fi"
        [isOn]="wifi()"
        (isOnChange)="wifi.set($event.nativeEvent.isOn)"
      />
      <ui-toggle testID="free" label="Free" (isOnChange)="free.push($event.nativeEvent.isOn)" />
      <ui-toggle
        testID="locked"
        label="Locked"
        [isOn]="true"
        [modifiers]="disabled"
        (isOnChange)="locked.push($event.nativeEvent.isOn)"
      />
      <ui-text testID="caption" text="Networks" (isOnChange)="stray.push($event)" />
    </ui-host>
  `,
})
export class TestingExpoUiToggleFixture {
  protected readonly disabled = DISABLED;
  readonly wifi = signal(true);
  /** What each flip of the switch left to itself said it is now. */
  readonly free: boolean[] = [];
  readonly locked: boolean[] = [];
  /** A switch's event heard on a view that is not one. */
  readonly stray: unknown[] = [];
}
