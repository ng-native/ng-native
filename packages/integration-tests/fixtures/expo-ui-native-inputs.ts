import { Component, signal } from '@angular/core';
import {
  UiButton,
  UiDatePicker,
  UiGauge,
  UiHost,
  UiImage,
  UiLabel,
  UiMenu,
  UiSlot,
  UiText,
  UiToggle,
  UiViewHost,
} from '../../expo/src/expo-ui-components.ts';

/** Inputs `@expo/ui`'s native views read as modifiers or slots rather than as props. */
@Component({
  selector: 'expo-ui-native-inputs',
  imports: [
    UiButton,
    UiDatePicker,
    UiGauge,
    UiHost,
    UiImage,
    UiLabel,
    UiMenu,
    UiSlot,
    UiText,
    UiToggle,
    UiViewHost,
  ],
  template: `
    <ui-host ignoreSafeArea="all">
      <ui-image systemName="star" [size]="30" color="red" />
      <ui-image systemName="star" [size]="30" [modifiers]="[{ $type: 'font', size: 12 }]" />
      <ui-image systemName="star" color="blue" [modifiers]="[{ $type: 'opacity', value: 0.5 }]" />
      <ui-image systemName="star" />
      <ui-gauge
        [value]="0.7"
        type="circular"
        currentValueLabel="0.70"
        minimumValueLabel="0"
        maximumValueLabel="1"
        [modifiers]="[{ $type: 'opacity', value: 0.5 }]"
      />
      <ui-gauge [value]="0.2" />
      <ui-label title="Starred" systemImage="star" color="orange" />
      <ui-label title="Plain" systemImage="star" />
      <ui-date-picker
        accessibilityLabel="Arrival"
        title="When"
        [range]="{ start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' }"
        disabled
      />
      <ui-date-picker />
      <ui-menu label="More" accessibilityLabel="More actions"><ui-button label="Copy" /></ui-menu>
      <ui-button label="Undo" target="undo" systemImage="arrow.uturn.backward" role="destructive" />
      <ui-toggle label="Wi-Fi" />
      <ui-slot name="actions" [extraProps]="{ edge: 'trailing' }"><ui-text text="slot" /></ui-slot>
      <ui-view-host [modifiers]="[{ $type: 'opacity', value: 0.5 }]"
        ><ui-text text="row"
      /></ui-view-host>
    </ui-host>
  `,
})
export class ExpoUiNativeInputsFixture {}

/** The same inputs set, then changed and taken away. */
@Component({
  selector: 'expo-ui-native-inputs-changing',
  imports: [UiGauge, UiHost, UiImage, UiLabel],
  template: `
    <ui-host>
      <ui-image systemName="star" [size]="size()" [color]="color()" />
      <ui-gauge [value]="0.5" [type]="type()" [currentValueLabel]="label()" />
      <ui-label title="Starred" systemImage="star" [color]="color()" />
    </ui-host>
  `,
})
export class ExpoUiNativeInputsChangingFixture {
  readonly size = signal<number | undefined>(30);
  readonly color = signal<string | undefined>('red');
  readonly type = signal<string | undefined>('circular');
  readonly label = signal<string | undefined>('0.50');
}
