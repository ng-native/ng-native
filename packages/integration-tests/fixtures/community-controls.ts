import { Component } from '@angular/core';
import { DateTimePicker } from '../../expo/src/date-time-picker.ts';
import { SegmentedControl } from '../../expo/src/segmented-control.ts';

/** The typed community controls, used as an app uses them: imported, never registered by hand. */
@Component({
  selector: 'x-community-controls',
  imports: [DateTimePicker, SegmentedControl],
  template: `
    <segmented-control nativeID="segments" [values]="['A', 'B']" [selectedIndex]="0" />
    <date-time-picker nativeID="date" mode="date" [date]="0" />
    <segmented-control nativeID="more" [values]="['C']" />
  `,
})
export class CommunityControls {}
