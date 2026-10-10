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

@Component({
  selector: 'expo-ui-platform-defaults',
  imports: [UiHStack, UiHost, UiSlider, UiToggle, UiVStack],
  template: `
    <ui-host>
      <ui-vstack (checkedChange)="bubbled.set(bubbled() + 1)">
        <ui-toggle [isOn]="true" (isOnChange)="$event.stopPropagation()" />
        <ui-toggle (isOnChange)="on.set($event.nativeEvent.isOn)" />
        <ui-hstack>
          <ui-slider [min]="0.5" [steps]="2" />
          <ui-slider [steps]="2.6" />
        </ui-hstack>
      </ui-vstack>
    </ui-host>
  `,
})
export class ExpoUiPlatformDefaultsFixture {
  readonly bubbled = signal(0);
  readonly on = signal(false);
}

@Component({
  selector: 'expo-ui-text-content',
  imports: [UiHost, UiText],
  template: `
    <ui-host>
      <ui-text>Us {{ us() }} - {{ them() }} Them</ui-text>
      <ui-text text="bound" />
    </ui-host>
  `,
})
export class ExpoUiTextContentFixture {
  readonly us = signal('15');
  readonly them = signal('0');
}

@Component({
  selector: 'expo-ui-time',
  imports: [UiHost, UiProgress, UiText],
  template: `
    <ui-host>
      <ui-text [date]="started" dateStyle="relative" />
      <ui-text [timerInterval]="{ lower: started, upper: 60000 }" countsDown="false" />
      <ui-progress [timerInterval]="{ lower: started, upper: 60000 }" countsDown="false" />
      <ui-text date="soon" [timerInterval]="{ lower: started, upper: 'later' }">Soon</ui-text>
    </ui-host>
  `,
})
export class ExpoUiTimeFixture {
  readonly started = new Date(1000);
}

/** An app's own component, under a selector `@expo/ui` has a view for. */
@Component({
  selector: 'ui-button',
  template: `<text>{{ label() }}</text>`,
})
export class AppButton {
  readonly label = signal('Mine');
}

@Component({
  selector: 'expo-ui-own-button',
  imports: [AppButton, UiHost],
  template: `
    <ui-button testID="own" />
    <ui-host><ui-gauge testID="raw" /></ui-host>
  `,
})
export class ExpoUiOwnButtonFixture {}
