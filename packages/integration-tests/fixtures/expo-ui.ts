import { Component, signal } from '@angular/core';
import { SegmentedControl } from '../../expo/src/segmented-control.ts';
import { ExpoImage } from '../../expo/src/expo-image.ts';
import {
  UiButton,
  UiColorPicker,
  UiForm,
  UiChart,
  UiGauge,
  UiHStack,
  UiLabeledContent,
  UiProgress,
  UiSection,
  UiSpacer,
  UiStepper,
  UiTextField,
  UiToggle,
  UiDatePicker,
  UiDivider,
  UiHost,
  UiImage,
  UiList,
  UiMenu,
  UiSlider,
  UiSlot,
  UiSwipeActions,
  UiText,
  UiVStack,
} from '../../expo/src/expo-ui-components.ts';

@Component({
  selector: 'expo-ui-fixture',
  imports: [
    SegmentedControl,
    UiButton,
    UiDatePicker,
    UiDivider,
    UiHost,
    UiImage,
    UiMenu,
    UiSlot,
    UiText,
  ],
  template: `
    <ui-host ignoreSafeArea="container" [matchContents]="true">
      <ui-menu accessibilityLabel="More" [modifiers]="[{ $type: 'opacity', value: 0.5 }]">
        <ui-slot name="label"><ui-text text="More" /></ui-slot>
        <ui-button label="Delete" role="destructive" (buttonPress)="presses.set(presses() + 1)" />
        <ui-divider />
      </ui-menu>
      <ui-date-picker
        selection="2026-01-02T00:00:00Z"
        [displayedComponents]="['date']"
        (dateChange)="date.set($event.nativeEvent.date)"
      />
      <ui-image systemName="star" [size]="24" color="#ff0000" />
    </ui-host>
    <segmented-control
      [values]="['A', 'B']"
      [selectedIndex]="0"
      (change)="index.set($event.nativeEvent.selectedSegmentIndex)"
    />
  `,
})
export class ExpoUiFixture {
  readonly presses = signal(0);
  readonly date = signal('');
  readonly index = signal(-1);
}

/** A SwiftUI list of rows that swipe, as a mail client's inbox does on iOS. */
@Component({
  selector: 'expo-ui-list-fixture',
  imports: [UiButton, UiHost, UiList, UiSlider, UiSlot, UiSwipeActions, UiText, UiVStack],
  template: `
    <ui-host [style]="{ flex: 1 }">
      <ui-list [modifiers]="[{ $type: 'listStyle', style: 'plain' }]">
        <ui-swipe-actions>
          <ui-button (buttonPress)="opened.set(opened() + 1)">
            <ui-vstack alignment="leading" [spacing]="2">
              <ui-text text="Sam" />
              <ui-text text="Lunch?" />
            </ui-vstack>
          </ui-button>
          <ui-slot name="actions" [extraProps]="{ edge: 'trailing', allowsFullSwipe: true }">
            <ui-button label="Delete" role="destructive" />
          </ui-slot>
        </ui-swipe-actions>
      </ui-list>
      <ui-slider
        [value]="0.25"
        [min]="0"
        [max]="1"
        (valueChanged)="level.set($event.nativeEvent.value)"
      />
    </ui-host>
  `,
})
export class ExpoUiListFixture {
  readonly opened = signal(0);
  readonly level = signal(0);
}

/** The rest of the typed SwiftUI controls, and `expo-image`, as a settings screen uses them. */
@Component({
  selector: 'expo-ui-controls-fixture',
  imports: [
    ExpoImage,
    UiChart,
    UiColorPicker,
    UiForm,
    UiGauge,
    UiHStack,
    UiHost,
    UiLabeledContent,
    UiProgress,
    UiSection,
    UiSpacer,
    UiStepper,
    UiText,
    UiTextField,
    UiToggle,
  ],
  template: `
    <ui-host [style]="{ flex: 1 }">
      <ui-form>
        <ui-section title="Network">
          <ui-toggle label="Wi-Fi" [isOn]="true" (isOnChange)="on.set($event.nativeEvent.isOn)" />
          <ui-stepper label="Guests" [value]="2" [min]="1" [max]="8" [step]="1" />
          <ui-text-field placeholder="Name" />
          <ui-color-picker label="Tint" selection="#ff0000" [supportsOpacity]="false" />
          <ui-labeled-content label="Version"><ui-text text="1.0" /></ui-labeled-content>
          <ui-hstack [spacing]="4"><ui-text text="a" /><ui-spacer /><ui-text text="b" /></ui-hstack>
          <ui-gauge [value]="0.4" [min]="0" [max]="1" currentValueLabel="40%" />
          <ui-progress [value]="0.5" />
          <ui-chart
            type="pie"
            [showGrid]="true"
            [data]="[
              { x: 'Won', y: 3 },
              { x: 'Lost', y: 1, color: '#ff0000' },
            ]"
            [pieStyle]="{ innerRadius: 0.5 }"
          />
        </ui-section>
      </ui-form>
    </ui-host>
    <expo-image [source]="[{ uri: 'a.png' }]" [transition]="300" />
  `,
})
export class ExpoUiControlsFixture {
  readonly on = signal(false);
}
