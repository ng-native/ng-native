import { Component } from '@angular/core';
import { ActivityIndicator } from '../../components/src/activity-indicator.ts';
import { NativeButton } from '../../components/src/native-button.ts';
import { Switch } from '../../components/src/switch.ts';
import { DateTimePicker } from '../../expo/src/date-time-picker.ts';
import { SearchField } from '../../expo/src/search-field.ts';
import { SegmentedControl } from '../../expo/src/segmented-control.ts';

@Component({
  selector: 'x-control-size',
  imports: [ActivityIndicator, DateTimePicker, NativeButton, SearchField, SegmentedControl, Switch],
  template: `
    <native-button testID="native-button" controlSize="mini">Go</native-button>
    <switch testID="switch" controlSize="mini" />
    <activity-indicator testID="activity-indicator" controlSize="mini" />
    <segmented-control testID="segmented-control" [values]="['a', 'b']" controlSize="mini" />
    <date-time-picker testID="date-time-picker" [date]="0" controlSize="mini" />
    <search-field testID="search-field" controlSize="mini" />
    <switch testID="unsized" />
  `,
})
export class ControlSizeFixture {}
