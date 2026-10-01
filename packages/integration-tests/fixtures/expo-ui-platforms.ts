import { Component, signal } from '@angular/core';
import {
  UiButton,
  UiDivider,
  UiHStack,
  UiHost,
  UiProgress,
  UiSlider,
  UiSlot,
  UiText,
  UiToggle,
  UiVStack,
} from '../../expo/src/expo-ui-components.ts';

@Component({
  selector: 'expo-ui-platforms',
  imports: [
    UiButton,
    UiDivider,
    UiHStack,
    UiHost,
    UiProgress,
    UiSlider,
    UiSlot,
    UiText,
    UiToggle,
    UiVStack,
  ],
  template: `
    <ui-host>
      <ui-vstack alignment="leading" [spacing]="8">
        <ui-toggle label="Wi-Fi" [isOn]="on()" (isOnChange)="on.set($event.nativeEvent.isOn)" />
        <ui-slider [value]="0.5" [steps]="4" (valueChanged)="level.set($event.nativeEvent.value)" />
        <ui-button label="Save" (buttonPress)="presses.set(presses() + 1)" />
        <ui-divider />
        <ui-progress [value]="0.4" />
        <ui-hstack alignment="top" [spacing]="4"
          ><ui-slot name="label"><ui-text text="a" /></ui-slot
        ></ui-hstack>
      </ui-vstack>
    </ui-host>
  `,
})
export class ExpoUiPlatformsFixture {
  readonly on = signal(true);
  readonly level = signal(0);
  readonly presses = signal(0);
}
