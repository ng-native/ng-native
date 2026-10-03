/**
 * `<date-time-picker>` with its props and its `change` event typed.
 *
 * The element is `NATIVE_VIEWS`' name for `@react-native-community/datetimepicker`, and it is the
 * library's native view rather than its React component, so what it takes is the view's own: the
 * date is `date` in milliseconds where the component's is `value` as a `Date`, the style is
 * `displayIOS`, and a pick is a `change` event carrying a `timestamp`. This claims the element so
 * strict templates know that, and takes a `Date` wherever the view takes milliseconds.
 *
 * iOS only. On Android the library has no view, only a module that opens a dialog, and the element
 * commits as nothing.
 */
import { Component, input, output } from '@angular/core';
import type { NativeSyntheticEvent } from '@ng-native/fabric';
import { optionalBoolean, optionalNumber } from './transforms.ts';

/** What the picker sends when the user picks: the moment in milliseconds, and its UTC offset. */
export type DateTimePickerChangeEvent = NativeSyntheticEvent<{
  readonly timestamp: number;
  readonly utcOffset: number;
}>;

/** A moment as the view takes it, in milliseconds, from a `Date` or from milliseconds. */
function milliseconds(value: Date | number | null | undefined): number | undefined {
  if (value == null) return undefined;
  return typeof value === 'number' ? value : value.getTime();
}

@Component({
  selector: 'date-time-picker',
  template: '',
  host: {
    '[date]': 'date()',
    '[mode]': 'mode()',
    '[displayIOS]': 'displayIOS()',
    '[minimumDate]': 'minimumDate()',
    '[maximumDate]': 'maximumDate()',
    '[minuteInterval]': 'minuteInterval()',
    '[locale]': 'locale()',
    '[timeZoneName]': 'timeZoneName()',
    '[timeZoneOffsetInMinutes]': 'timeZoneOffsetInMinutes()',
    '[accentColor]': 'accentColor()',
    '[textColor]': 'textColor()',
    '[themeVariant]': 'themeVariant()',
    '[enabled]': 'enabled()',
  },
})
export class DateTimePicker {
  /** The moment shown, as a `Date` or in milliseconds. */
  readonly date = input(undefined, { transform: milliseconds });
  readonly mode = input<'date' | 'time' | 'datetime' | 'countdown'>();
  /** How the picker is drawn: wheels, a compact field that opens a popover, or a calendar. */
  readonly displayIOS = input<'default' | 'spinner' | 'compact' | 'inline'>();
  readonly minimumDate = input(undefined, { transform: milliseconds });
  readonly maximumDate = input(undefined, { transform: milliseconds });
  /** The step between the minutes offered. One that divides sixty. */
  readonly minuteInterval = input<number>(undefined, { transform: optionalNumber });
  /** A locale identifier, `en_GB`, for the picker's own text and order. The device's by default. */
  readonly locale = input<string>();
  /** An IANA time zone, `Europe/London`, the picker shows the moment in. */
  readonly timeZoneName = input<string>();
  readonly timeZoneOffsetInMinutes = input<number>(undefined, { transform: optionalNumber });
  readonly accentColor = input<string>();
  /** The wheels' text colour, for `displayIOS="spinner"`. */
  readonly textColor = input<string>();
  readonly themeVariant = input<'dark' | 'light' | 'unspecified'>();
  readonly enabled = input<boolean>(undefined, { transform: optionalBoolean });
  readonly change = output<DateTimePickerChangeEvent>();
  /** The compact picker's popover closed. */
  readonly pickerDismiss = output<NativeSyntheticEvent<null>>();
}
