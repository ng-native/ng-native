---
title: Expo UI
summary: Real SwiftUI and Jetpack Compose controls as elements, inside a <ui-host>.
---

# Expo UI

`@expo/ui` is the closest thing in the ecosystem to what this project is for: every one of its
views is a real platform control - a real `Picker`, a real `BottomSheet`, a real `Gauge` - rather
than something drawn to look like one. It reaches them through `requireNativeView('ExpoUI', ...)`,
the same derivation `registerExpoView` already mirrors, so the whole surface is available here for
the price of a table of names.

## Install

```sh
npx expo install @expo/ui
```

```ts
import { registerExpoUiViews } from '@ng-native/expo';
import { UiHost, UiMenu, UiButton } from '@ng-native/expo/expo-ui-components';
```

## The smallest thing that works

```ts
import { Platform } from 'react-native';
import { registerExpoUiViews } from '@ng-native/expo';

registerExpoUiViews(Platform.OS); // once, before the app mounts
```

```html
<ui-host style="height: 44">
  <ui-slider [value]="volume()" (valueChanged)="volume.set($event.nativeEvent.value)" />
</ui-host>
```

## Registering the views

**`registerExpoUiViews(platform)`** registers every `@expo/ui` view the current platform has, all
at once - unlike the other `register*` functions in this package, because these are all one
module: an app with `@expo/ui` installed has all of them, and an app without it has none. Call it
once at startup with `Platform.OS`.

Element names are platform-neutral where both platforms have the control, so a template writes
`<ui-vstack>` once and gets Compose's `Column` on Android. Where only one platform has a control - a
`Gauge` is SwiftUI's, a `SearchBar` is Compose's - the element exists only there; registering for
the wrong platform is an element that commits as nothing, which `registerExpoUiViews` avoids by
reading the platform you pass it.

## `<ui-host>` is required

**SwiftUI and Compose lay out their own subtrees.** `<ui-host>` is the bridge from Yoga's layout to
theirs; every other `ui-*` element must sit inside one, or the control has no size and does not
appear - which looks exactly like a module that failed to install. `UiHost`'s `matchContents` input
sizes the host to the SwiftUI content instead of the other way round; `ignoreSafeArea` and
`useViewportSizeMeasurement` are the other two host-level controls.

## Names, and the typed components

Most `@expo/ui` views are, deliberately, names rather than components: there are ninety-odd of
them, each with its own props and its own modifier system, and a component per view, prop for
prop, would be a second place for every one of them to be wrong. The element plus the module's own
documentation covers the common case:

```html
<ui-gauge [value]="0.4" [modifiers]="[{ $type: 'frame', width: 80, height: 80 }]" />
```

The exception is strict templates, where an unknown element - and every prop on it - is a type
error. `expo-ui-components.ts` has thin typed components for the views an app reaches for most:

- **`UiHost`** - the bridge above.
- **`UiMenu`** - a SwiftUI `Menu`. Its trigger is the `label` input or a `<ui-slot name="label">`;
  its items are children.
- **`UiButton`** - a SwiftUI `Button`, as a menu item or on its own. `role` is `'default'`,
  `'cancel'` or `'destructive'`.
- **`UiDivider`** - a separator between groups of menu items.
- **`UiSlot`** - content for a named slot of its parent view, such as a menu's `label`.
  `extraProps` is what the slot tells its parent about itself, such as a swipe group's `edge`.
- **`UiList`** - a SwiftUI `List`.
- **`UiSwipeActions`** - the system's swipe actions on a list row, iOS only. The first child is
  the row, and each edge's actions are `ui-button`s in a
  `<ui-slot name="actions" [extraProps]="{ edge: 'trailing', allowsFullSwipe: true }">`. A row in
  a scroll view that also scrolls sideways loses its swipes to that scroll view.
- **`UiVStack`** and **`UiHStack`** - SwiftUI's stacks, with `alignment` and `spacing`, and
  **`UiSpacer`** for the room left over in one.
- **`UiZStack`** - SwiftUI's `ZStack`: its children drawn over one another, the first at the back,
  placed by `alignment`.
- **`UiRectangle`**, **`UiRoundedRectangle`**, **`UiUnevenRoundedRectangle`**, **`UiCapsule`**,
  **`UiCircle`** and **`UiEllipse`** - SwiftUI's shapes, iOS only, coloured with the
  `foregroundStyle` modifier. **`UiAccessoryWidgetBackground`** is the system's backdrop for a lock
  screen widget.
- **`UiLabel`** - a `title` beside an SF Symbol, iOS only. **`UiLink`** opens its `destination`
  URL when tapped, showing its `label` or the views written inside it, iOS only.
- **`UiSlider`**, **`UiStepper`** and **`UiToggle`** - with `valueChanged`, `valueChange` and
  `isOnChange` for what the user did.
- **`UiTextField`** - its `text` is a `nativeState('')`, which the field writes to on the UI
  thread; `textChange` reports each change.
- **`UiColorPicker`**, **`UiGauge`** and **`UiProgress`**.
- **`UiForm`**, **`UiSection`** and **`UiLabeledContent`** - settings-style grouped rows.
- **`UiImage`** - an SF Symbol by `systemName`, or a picture by `uiImage` URL.
- **`UiText`** - a SwiftUI `Text`. Its text is what is written inside it,
  `<ui-text>Us {{ score() }}</ui-text>`, as `<text>` takes its own; `text` sets it too, and wins.
  A `ui-text` nested inside one is a span with its own modifiers, drawn after the text: put text
  that comes after a span in a `ui-text` of its own.
- **`UiDatePicker`** - SwiftUI's `DatePicker` on iOS, Compose's on Android, and a Signal Forms
  field: its `value` model is a `Date` or null, whichever way each platform takes and reports one.
  A pick is when it emits `touch`. SwiftUI's picker always shows a date, today when the field is
  empty, and the report it makes as it appears is not taken as the user's choice, so an optional
  date is best asked for behind a button that shows the picker. Without a form, `selection` still
  takes ISO text on iOS.
- **`UiPicker`** - a SwiftUI `Picker`, iOS only, and a Signal Forms field. `options` draws the
  choices; see [Choices: `UiPicker`](#choices-uipicker) below.

Each input goes straight through to the node as a prop, `modifiers` included -
`UiModifier` is one SwiftUI modifier, shaped exactly as `@expo/ui`'s own modifier functions build
them (`{ $type: 'frame', ... }`). Events are declared as outputs purely for their type: `$event` in
a template binding is typed as the native payload, but the output itself is never emitted. Angular
binds a template's `(dateChange)` to the element's own native event directly, so that is the only
place it arrives - a programmatic subscription to the output from code never receives anything.
Subscribe in the template, not to the output in code.

### On Android

One template draws both platforms for `UiHost`, `UiVStack`, `UiHStack`, `UiZStack`, `UiText`,
`UiSpacer`, `UiToggle`, `UiSlider`, `UiButton`, `UiDivider`, `UiProgress` and `UiSlot`. Compose
names some props and events differently, and each of these components sends its inputs under the
name the platform reads and delivers Compose's events through the same outputs, with the same
`$event` shape: a toggle's `isOn` reaches Compose's switch as `value`, and its `checkedChange`
arrives as `(isOnChange)` with `nativeEvent.isOn`. A button's `label` is drawn as text inside it,
since Compose's button has no label of its own. A toggle's `label` is SwiftUI's alone: Compose's
switch draws none, and the switch is the element, so on Android put a `<ui-text>` beside it in a
`<ui-hstack>`. A button's `systemImage` and `role` are SwiftUI's alone too. A slider's `steps` is
the number of steps on both, rounded to a whole number, with one exception: Compose has no slider
that stops only at its two ends, so `steps="1"` slides freely there.

A toggle without `isOn` switches itself on both, and one bound to `isOn` shows what `isOn` says, so
write the new value back from `(isOnChange)`. A stack without an `alignment` is centred on both; a
`UiZStack` is Compose's `Box` on Android.
Without a `spacing`, SwiftUI puts its own default spacing between a stack's children and Compose
puts none, so give a stack a `spacing` where the gap matters.

`modifiers` go to both platforms as they are written, and the two read different ones. Compose skips
a modifier it does not know, silently, and knows few of SwiftUI's: `frame`, `font` and
`foregroundStyle` do nothing on Android. Even a name both know can read different fields: SwiftUI's
`padding` takes `leading`, `trailing`, `horizontal`, `vertical` and `all`, while Compose's reads
only `start`, `top`, `end` and `bottom`. Choose the modifiers by platform, with `nativePlatform()`
from `@ng-native/fabric`, where a view needs them on both.

`UiDatePicker` already takes both platforms, as described above. The rest of the typed components
are SwiftUI's. On Android a text field, a menu and an image are different controls rather than
renamed ones, and `UiPicker`, `UiList`, `UiForm`, `UiSection` and the others have no Compose view
at all; use Compose's own names for those.

Still call `registerExpoUiViews` alongside importing these. The component supplies the types; the
registration is what makes the element commit as the SwiftUI or Compose view. Add a component here
when a template wants one of the other views typed, from `@expo/ui`'s own props for it - the rest
stay names.

## Text field state: `nativeState`

`TextFieldView` and `SecureFieldView` declare their `text` prop as an `ObservableState` rather
than a plain string, and what actually travels over the prop is the shared object's id, a number.
Binding the string itself is the obvious thing to write, and it fails silently as
`FieldInvalidTypeException`, logged rather than thrown - the field renders and simply ignores
everything the app sets, which looks like it works because both fields manage their own text when
the prop is absent, and only _setting_ the value from Angular does nothing.

**`nativeState(initial)`** builds one of these shared objects and returns a `NativeState<T>`:

```ts
protected readonly name = nativeState('');
```

```html
<ui-text-field [text]="name" (textChange)="typed.set($event.nativeEvent.value)" />
```

The typed `UiTextField` takes the state itself and sends its id down the prop. An element with no
typed component, such as `<secure-field>`, takes the id directly: bind `[text]="name?.id"` there,
not `name`. The state lives on the native side and both sides hold a reference,
so writing to it moves the caret in a field that is already on screen, where a signal and a
re-render would not - that is the whole reason the prop is shaped this way. `get()` reads the
current value (a write is scheduled onto the UI thread, so it is not readable back until that has
run - `@expo/ui`'s own accessors behave the same way), `set()` writes it, and `release()` detaches
from the native object; worth calling from `DestroyRef` for a field inside a list that comes and
goes, since a state that lives as long as the app does not need one.

`nativeState()` returns **null** off a device, where there is no native module to hold the state -
either binding then leaves the prop absent, which is the field's own unmanaged behavior rather
than a crash.

## Choices: `UiPicker`

**`UiPicker`** is a SwiftUI `Picker`: one choice out of a short, fixed list, drawn as a menu, a
segmented control, a wheel or inline rows. It is a Signal Forms field as it stands, through its
`value` model, so `[formField]` binds it like any other control:

```ts
import { Component, signal } from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';
import { UiHost, UiPicker, type UiPickerOption } from '@ng-native/expo/expo-ui-components';

@Component({
  selector: 'app-booking',
  imports: [FormField, UiHost, UiPicker],
  template: `
    <ui-host [matchContents]="true">
      <ui-picker label="Room" pickerStyle="menu" [options]="rooms" [formField]="f.room" />
    </ui-host>
  `,
})
export class Booking {
  protected readonly rooms: readonly UiPickerOption[] = [
    { value: 'single', label: 'Single' },
    { value: 'double', label: 'Double' },
    { value: 'suite', label: 'Suite' },
  ];
  private readonly booking = signal({ room: 'double' });
  protected readonly f = form(this.booking, (path) => required(path.room));
}
```

`options` is a list of `UiPickerOption`s, each a `value` (a string or a number) and the `label`
the user reads. The picker draws one `ui-text` per option in its `content` slot, tagged with the
option's value: the slot and the `tag` modifiers `@expo/ui` otherwise wants written out by hand.
What the field holds is the chosen option's `value`, never its position in the list, and values
should be distinct, since the value is what tells one option from another. Children still work
alongside or instead of `options`, for anything richer than a label.

- **`value`** - the chosen option's value, or null: what `[formField]` binds. Outside a form,
  `[(value)]` binds it to a signal.
- **`label`** and **`systemImage`** - the picker's own title, and an SF Symbol name beside it.
- **`pickerStyle`** - SwiftUI's picker style: `'automatic'`, `'menu'`, `'segmented'`, `'wheel'`,
  `'inline'` or `'palette'`. It becomes a `pickerStyle` modifier ahead of any in `modifiers`.
- **`disabled`** - adds SwiftUI's `disabled` modifier. A form's `disabled()` rule sets it, and so
  does a bare `disabled` attribute outside a form.
- **`touch`** - the user picked. A picker has no blur, so a pick is when the field counts as
  touched and a form shows its errors.
- **`selectionChange`** - the native event, typed as `{ selection }`. Like every event here, it
  arrives through a template binding only: `(selectionChange)="$event.nativeEvent.selection"`.

A pick writes the new value into the model, and so into the form, before `touch`; a report
whose `selection` is neither a string nor a number is ignored.

**The picker is iOS only.** `registerExpoUiViews('android')` registers no `ui-picker`, because
`@expo/ui` has no Compose picker of that shape, so on Android the element commits as nothing. An
app that runs on both needs another control for the choice there. Like every `ui-*` view, it
sits inside a `<ui-host>`.

## Without the module

An element registered for `@expo/ui` when it is not installed commits as nothing
(`UnimplementedNativeView`). `nativeState()` returns null.

## Reference

<!-- api: UiHost -->
<!-- api: UiMenu -->
<!-- api: UiButton -->
<!-- api: UiDivider -->
<!-- api: UiSlot -->
<!-- api: UiList -->
<!-- api: UiSwipeActions -->
<!-- api: UiVStack -->
<!-- api: UiHStack -->
<!-- api: UiSpacer -->
<!-- api: UiZStack -->
<!-- api: UiRectangle -->
<!-- api: UiRoundedRectangle -->
<!-- api: UiUnevenRoundedRectangle -->
<!-- api: UiCapsule -->
<!-- api: UiCircle -->
<!-- api: UiEllipse -->
<!-- api: UiAccessoryWidgetBackground -->
<!-- api: UiLabel -->
<!-- api: UiLink -->
<!-- api: UiSlider -->
<!-- api: UiStepper -->
<!-- api: UiToggle -->
<!-- api: UiTextField -->
<!-- api: UiColorPicker -->
<!-- api: UiGauge -->
<!-- api: UiProgress -->
<!-- api: UiForm -->
<!-- api: UiSection -->
<!-- api: UiLabeledContent -->
<!-- api: UiImage -->
<!-- api: UiText -->
<!-- api: UiDatePicker -->
<!-- api: UiPicker -->
