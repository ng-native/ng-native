import { Component, signal } from '@angular/core';
import {
  UiButton,
  UiColorPicker,
  UiDatePicker,
  UiDropdownMenuItem,
  UiHost,
  UiPicker,
  UiSegmentedButton,
  UiSlider,
  UiStepper,
  UiTextField,
  UiToggle,
} from '../../expo/src/expo-ui-components.ts';

/** Each `@expo/ui` control that reports a tap, logging its own outputs, for the interaction observers. */
@Component({
  selector: 'x-expo-ui-interactions',
  imports: [
    UiButton,
    UiColorPicker,
    UiDatePicker,
    UiDropdownMenuItem,
    UiHost,
    UiPicker,
    UiSegmentedButton,
    UiSlider,
    UiStepper,
    UiTextField,
    UiToggle,
  ],
  template: `
    <ui-host>
      <ui-button testID="save" label="Save" role="destructive" (buttonPress)="log('save')" />
      <ui-toggle testID="wifi" label="Wi-Fi" (isOnChange)="log('wifi')" />
      <ui-slider testID="volume" [value]="0.5" (valueChanged)="log('volume')" />
      <ui-stepper testID="guests" [value]="2" (valueChange)="log('guests')" />
      <ui-color-picker testID="tint" selection="#ff0000" (selectionChange)="log('tint')" />
      <ui-date-picker testID="when" [(value)]="when" (touch)="log('when')" />
      <ui-picker
        testID="room"
        [options]="rooms"
        [pickerStyle]="pickerStyle()"
        [(value)]="room"
        [disabled]="locked()"
        (touch)="log('room')"
        (selectionChange)="log('room selection')"
      />
      <ui-segmented-button testID="segment" (press)="log('segment')" />
      <ui-dropdown-menu-item testID="item" (press)="log('item')" />
      <ui-text-field testID="name" />
    </ui-host>
  `,
})
export class ExpoUiInteractionsFixture {
  readonly events: string[] = [];
  readonly rooms = [
    { value: 'kitchen', label: 'Kitchen' },
    { value: 'hall', label: 'Hall' },
  ];
  readonly room = signal<string | number | null>(null);
  readonly when = signal<Date | null>(new Date(0));
  readonly locked = signal(false);
  readonly pickerStyle = signal<'segmented' | 'menu'>('segmented');

  log(event: string): void {
    this.events.push(event);
  }
}
