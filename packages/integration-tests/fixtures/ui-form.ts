import { Component, signal } from '@angular/core';
import { FormField, disabled, form, required } from '@angular/forms/signals';
import {
  UiDatePicker,
  UiHost,
  UiHStack,
  UiPicker,
  UiProgress,
  UiSlider,
  UiStepper,
  UiToggle,
  UiVStack,
} from '../../expo/src/expo-ui-components.ts';

/** A booking form: a date and a choice, both Signal Forms fields on SwiftUI controls. */
@Component({
  selector: 'x-ui-form',
  imports: [FormField, UiDatePicker, UiHost, UiPicker],
  template: `
    <ui-host>
      <ui-date-picker
        nativeID="date"
        title="Arrival"
        [displayedComponents]="['date', 'hourAndMinute']"
        [formField]="f.arrival"
      />
      <ui-picker
        nativeID="room"
        label="Room"
        pickerStyle="menu"
        [options]="rooms"
        [formField]="f.room"
      />
      <ui-picker
        nativeID="board"
        label="Board"
        pickerStyle="segmented"
        [options]="boards"
        [formField]="f.board"
      />
    </ui-host>
  `,
})
export class UiForm {
  readonly data = signal({
    arrival: new Date('2026-10-01T09:00:00.000Z'),
    room: 'double',
    board: 'breakfast',
  });
  readonly locked = signal(false);
  readonly f = form(this.data, (path) => {
    required(path.room);
    disabled(path.arrival, () => this.locked());
  });
  readonly rooms = [
    { value: 'single', label: 'Single' },
    { value: 'double', label: 'Double' },
    { value: 'suite', label: 'Suite' },
  ];
  readonly boards = [
    { value: 'none', label: 'Room only' },
    { value: 'breakfast', label: 'Breakfast' },
  ];
}

/** Pickers disabled outside a form, by a bare attribute. */
@Component({
  selector: 'x-ui-disabled',
  imports: [UiDatePicker, UiHost, UiPicker],
  template: `
    <ui-host>
      <ui-date-picker nativeID="bare-date" disabled />
      <ui-picker nativeID="bare-room" disabled [options]="rooms" />
    </ui-host>
  `,
})
export class UiDisabled {
  readonly rooms = [{ value: 'single', label: 'Single' }];
}

/** Numbers and switches written as static attributes, which arrive as strings. */
@Component({
  selector: 'x-ui-static',
  imports: [UiHost, UiHStack, UiProgress, UiSlider, UiStepper, UiToggle, UiVStack],
  template: `
    <ui-host>
      <ui-vstack nativeID="column" spacing="8">
        <ui-slider nativeID="slider" value="2" min="0" max="10" steps="5" />
        <ui-stepper nativeID="stepper" value="1" min="0" max="9" step="2" />
        <ui-toggle nativeID="toggle" isOn label="Wi-Fi" />
        <ui-progress nativeID="progress" value="0.5" />
        <ui-hstack nativeID="row" spacing="4" />
      </ui-vstack>
    </ui-host>
  `,
})
export class UiStatic {}

/** Hosts sized to their SwiftUI content, both ways and one way. */
@Component({
  selector: 'x-ui-hosts',
  imports: [UiHost],
  template: `
    <ui-host nativeID="both" [matchContents]="true" />
    <ui-host nativeID="tall" [matchContents]="{ vertical: true }" />
  `,
})
export class UiHosts {}

/** Date pickers showing a date, a time, both, and nothing. */
@Component({
  selector: 'x-ui-components',
  imports: [UiDatePicker, UiHost],
  template: `
    <ui-host>
      <ui-date-picker nativeID="only-date" [displayedComponents]="['date']" />
      <ui-date-picker nativeID="only-time" [displayedComponents]="['hourAndMinute']" />
      <ui-date-picker nativeID="both" [displayedComponents]="['date', 'hourAndMinute']" />
      <ui-date-picker nativeID="none" [displayedComponents]="[]" />
    </ui-host>
  `,
})
export class UiComponents {}
