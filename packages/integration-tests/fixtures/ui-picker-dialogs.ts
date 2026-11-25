import { Component, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import {
  type UiDateRange,
  UiDatePickerDialog,
  UiDateRangePickerDialog,
  UiHost,
  UiTimePickerDialog,
} from '../../expo/src/expo-ui-components.ts';

/** The two ends of a time range, each a field picked through Compose's dialogs. */
@Component({
  selector: 'x-ui-picker-dialogs',
  imports: [FormField, UiDatePickerDialog, UiDateRangePickerDialog, UiHost, UiTimePickerDialog],
  template: `
    <ui-host>
      @if (open() === 'date') {
        <ui-date-picker-dialog
          nativeID="date"
          variant="input"
          confirmButtonLabel="Set"
          dismissButtonLabel="Back"
          color="#ff0000"
          [showVariantToggle]="false"
          [showTitle]="false"
          [showHeadline]="false"
          [elementColors]="{ selectedDayContainerColor: '#00ff00' }"
          [initialDate]="opensOn()"
          [selectableDates]="range()"
          [formField]="f.start"
          (dateSelected)="open.set(null)"
          (dismissRequest)="open.set(null)"
        />
      }
      @if (open() === 'time') {
        <ui-time-picker-dialog
          nativeID="time"
          [is24Hour]="false"
          [elementColors]="{ clockDialColor: '#0000ff' }"
          [initialDate]="opensOn()"
          [formField]="f.end"
          (dateSelected)="open.set(null)"
          (dismissRequest)="open.set(null)"
        />
      }
      @if (open() === 'range') {
        <ui-date-range-picker-dialog
          nativeID="range"
          [showTitle]="false"
          [selectableDates]="range()"
          [formField]="f.stay"
          (dateRangeSelected)="open.set(null)"
          (dismissRequest)="open.set(null)"
        />
      }
    </ui-host>
  `,
})
export class UiPickerDialogs {
  readonly opensOn = signal<string | undefined>(undefined);
  readonly range = signal<{ start: string } | undefined>({ start: '2026-01-01T00:00:00.000Z' });
  readonly open = signal<'date' | 'time' | 'range' | null>('date');
  readonly data = signal<{ start: Date | null; end: Date | null; stay: UiDateRange | null }>({
    start: new Date('2026-10-01T00:00:00.000Z'),
    end: null,
    stay: {
      start: new Date('2026-12-20T00:00:00.000Z'),
      end: new Date('2026-12-27T00:00:00.000Z'),
    },
  });
  readonly f = form(this.data);
}
