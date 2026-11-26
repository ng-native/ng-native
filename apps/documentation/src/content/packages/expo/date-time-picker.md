---
title: Date and time picker
summary: The platform's date and time picker as a typed component, with a Date in and a pick out.
---

# Date and time picker

`<date-time-picker>` is the native date and time picker, typed for strict templates. It draws on
iOS and macOS: UIKit's `UIDatePicker`, and AppKit's date picker on the desktop host with no library
installed. On Android the library has no view, only a module that opens a dialog, so the element
commits as nothing there; open the library's `DateTimePickerAndroid.open()` from a press instead.

## Install

On iOS it needs `@react-native-community/datetimepicker`:

```sh
npx expo install @react-native-community/datetimepicker
```

## The smallest useful example

```ts
import { Component, signal } from '@angular/core';
import { DateTimePicker } from '@ng-native/expo/date-time-picker';

@Component({
  selector: 'app-due-date',
  imports: [DateTimePicker],
  template: `
    <date-time-picker
      mode="date"
      displayIOS="compact"
      [date]="due()"
      (change)="due.set(asDate($event.nativeEvent.timestamp))"
    />
  `,
})
export class DueDate {
  protected readonly due = signal(new Date());

  protected asDate(timestamp: number): Date {
    return new Date(timestamp);
  }
}
```

The component is also exported from `@ng-native/expo`. It registers the element the first time one
is made, so no `registerNativeViews` call is needed.

## Inputs and events

The inputs are the native view's, not the library's React component's: the moment is `date`, not
`value`, and the style is `displayIOS`.

- **`date`**, **`minimumDate`**, **`maximumDate`** - a `Date` or milliseconds.
- **`mode`** - `'date'`, `'time'`, `'datetime'` or `'countdown'`.
- **`displayIOS`** - `'default'`, `'spinner'`, `'compact'` or `'inline'`: wheels, a compact field
  that opens a popover, or a calendar.
- **`minuteInterval`** - the step between the minutes offered; one that divides sixty.
- **`locale`** and **`timeZoneName`** - a locale identifier such as `en_GB`, and an IANA time zone
  such as `Europe/London`. `timeZoneOffsetInMinutes` gives the zone as an offset.
- **`controlSize`** - `'mini'`, `'small'`, `'regular'` or `'large'`: AppKit's control size on macOS,
  and UIKit's on iOS 26 and later.
- **`accentColor`**, **`textColor`** (the wheels', for `displayIOS="spinner"`) and
  **`themeVariant`** - `'dark'`, `'light'` or `'unspecified'`.
- **`enabled`** - `false` refuses input.
- **`change`** - the user picked a moment. `$event.nativeEvent.timestamp` is the moment in
  milliseconds, and `utcOffset` its UTC offset.
- **`pickerDismiss`** - the compact picker's popover closed.

The [native views](/packages/expo/native-views) page covers the other community views.

## Reference

<!-- api: DateTimePicker -->
