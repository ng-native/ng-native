---
title: Switch
summary: <switch>, a native toggle wired for Signal Forms, controlled the way React Native's is.
art: switch
---

# Switch

`<switch>` is a native toggle - `Switch` on iOS, `AndroidSwitch` on Android.

```html
<switch [(checked)]="notificationsEnabled" />
```

## Signal Forms

`<switch>` is wired as a checkbox-shaped control: its `checked` model is what `FormField` looks
for on a checkbox-shaped control, so `<switch [formField]="f.enabled" />` needs no adapter code.
`[(checked)]` works the same way without a form.

A form marks the field touched when the user flips the switch: a switch has no blur, so the flip is
the moment the user has dealt with it, and a form that shows its errors once a field is touched
shows them then. The field's `invalid` and `touched` come out as `data-invalid` and `data-touched`,
as on [`<text-input>`](/packages/components/input#the-signal-forms-contract), for a stylesheet to
match:

```css
switch[data-invalid][data-touched] {
  opacity: 0.6;
}
```

## Colors on both platforms at once

The two platforms spell the same props differently - iOS reads `onTintColor`, `tintColor` and
`thumbTintColor`; Android reads `trackColorForTrue`, `trackColorForFalse`, `trackTintColor` and
`thumbTintColor` (plus `on` for the value itself). `<switch>` sends both spellings at once, so
`thumbColor` and `trackColor` (a `{ false?, true? }` pair) work the same way regardless of which
platform is running, with no app code needing to know which is which. `ios_backgroundColor` sets
the color behind the track on iOS when off, seen where the track itself is transparent.

## Controlled, as in React Native

Bind `checked` and the switch shows what your state says, whatever the user did to it. Flipping it
emits `checkedChange`; if your state takes the new value, nothing more happens. If it keeps the old
one, the switch flips back:

```html
<!-- Always ends up off: the handler refuses every flip. -->
<switch [(checked)]="enabled" (checkedChange)="enabled.set(false)" />

<!-- Takes a flip only while unlocked. -->
<switch [checked]="enabled()" (checkedChange)="unlocked() && enabled.set($event)" />
```

This is the case a prop diff cannot handle on its own. Native has already moved, but your binding
writes back the same value it wrote last time, so there is no prop change to send. Once the change
detection pass the flip started has finished, `<switch>` compares `checked` with what native
reported and, if they differ, sends the command React Native's own `Switch` sends: `setValue` on
iOS, `setNativeValue` on Android. When your state takes the flip, or you set `checked` from code,
no command is sent; the prop carries it.

Any binding makes the switch controlled, one-way `[checked]` included, so a switch bound one way
with nothing handling `checkedChange` cannot be flipped, as in React Native. Decide in the
handler, and do it synchronously: the comparison runs once the pass the flip started has finished,
so a value that arrives later is compared as a refusal and then applied when it arrives. Leave
`checked` unbound and the switch keeps its own state, with `checkedChange` reporting each flip.

`[formField]` counts as a binding. A form takes every value the control gives it, so the switch
reports each flip to the form and sends native nothing back.

`disabled` ignores touches, grays the control out, and changes the state a screen reader
announces.

<!-- api: @ng-native/components#Switch -->
