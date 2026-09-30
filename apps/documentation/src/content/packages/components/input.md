---
title: Text input
summary: <text-input>, keyboards, and the props a browser has no name for.
art: input
---

# Text input

`<text-input>` is built to work with Signal Forms with no adapter code at all. Signal Forms'
`FormField` directive looks for a `value` model on a value control, and `<text-input>`'s `value` is
a `model()`, so `<text-input [formField]="f.name" />` is the entire integration. It also works as a
plain two-way binding without a form at all: `[(value)]`.

```html
<text-input placeholder="Name" [formField]="profile.name" />
```

## The Signal Forms contract

`<text-input>` carries the whole control contract `FormField` writes to, not just `value`:
`disabled` and `readonly` both turn `editable` off (`disabled` also wins the announced
accessibility state); `invalid` and `touched` are published as the `data-invalid` and
`data-touched` attributes, since nothing native reads them - they exist for a stylesheet; and
`touch` fires from the native blur event, because there is no DOM blur for Signal Forms to listen
to instead.

```css
text-input {
  border-width: 1px;
  border-color: #3a3a42;
}
text-input[data-invalid][data-touched] {
  border-color: #ff6b6b;
}
```

The point of writing `data-invalid`/`data-touched` only once both are true is the usual one: a
field an app has not touched yet should not look broken before anyone has had a chance to fill it
in.

## Controlled, as in React Native

Bind `value` and the field shows what your state says. A keystroke emits `valueChange` and
`changeText`; whatever your state holds once the handler has run is what the field ends up
showing. Take the text as typed, refuse it, or rewrite it:

```html
<!-- Digits only: anything else leaves the field as it was. -->
<text-input [value]="pin()" (changeText)="isDigits($event) && pin.set($event)" />

<!-- Shows what is typed in capitals, as it is typed. -->
<text-input [value]="code()" (changeText)="code.set($event.toUpperCase())" />
```

When your state takes the text as typed, native already shows it and nothing is sent back. When
it refuses or rewrites it, native is showing text your state does not hold, and a refused
keystroke leaves your binding where it was, so there is no prop change to carry the correction.
Once the change detection pass the keystroke started has finished, `<text-input>` compares
`value` with the text native reported and, if they differ, sends React Native's
`setTextAndSelection` command. A value set from code after the user has typed goes the same way.

Any binding makes the field controlled, one-way `[value]` included, so a field bound one way with
nothing handling the change cannot be typed into, as in React Native. Decide in the handler, and
do it synchronously: the comparison runs once the pass has finished, so a value that arrives later
is compared as a refusal and then applied when it arrives. Leave `value` unbound and the field
keeps what is typed. `[formField]` counts as a binding, and since a form takes every value the
control gives it, typing into a form field sends nothing back.

That command carries the same counter as the rest of the typing protocol, the one React Native
uses to keep fast typing safe: native reports each change with a counter, the component sends the
latest one back, and native ignores anything older than what it already has. Without it, typing
fast into a controlled field drops characters. None of this is something an app manages; it is
what makes binding `[(value)]` straight to a signal safe. `<switch>`, on the
[switch page](/packages/components/switch), is controlled the same way.

## Keyboards and behavior

`keyboardType` picks the keyboard (`'email-address'`, `'number-pad'`, `'phone-pad'` and the rest);
`returnKeyType` labels the return key, and `submitBehavior` decides what pressing it does
(`'submit'`, `'blurAndSubmit'`, or `'newline'` - the default on a multiline field). `multiline`
allows more than one line, `secureTextEntry` hides what is typed, `autoCapitalize` and
`autoCorrect` control the usual typing assists, and `maxLength` is enforced natively so nothing
flickers past the limit before being trimmed back.

`<text-input>` exposes `focus()`, `blur()`, `clear()`, `setSelection(start, end?)` and
`isFocused()` as methods, reachable through a template reference or `nativeRef`. `(changeText)`
carries just the new string, matching React Native's `onChangeText`; `(change)`, `(focus)`,
`(blur)`, `(submitEditing)`, `(endEditing)`, `(selectionChange)`, `(keyPress)` and
`(contentSizeChange)` are the raw element events.

<!-- api: TextInput -->

## Line height

A single-line field's `line-height` sets its height, as it sets an `<input>`'s in a browser: line
height, padding and border, with the text centred in it. That holds on iOS as on Android, and a
Tailwind font-size utility, which brings a line height with it, sizes a field the same way on both.
An explicit `height`, or a larger `min-height`, still wins. In a `multiline` field the line height
spaces the lines, as in a `<textarea>`.

## Props a browser has no name for

Several inputs exist only because a native keyboard is a different object than an `<input>`:
`textContentType` and `autoComplete` hint at autofill (a password manager, a one-time code) the
way `autocomplete` does on the web, but with platform-specific values. `passwordRules` (iOS)
constrains what a generated password looks like. On iOS, `dataDetectorTypes` makes recognized
links and phone numbers tappable when `multiline` is true and `editable` is false.
`keyboardAppearance` (iOS) sets
the keyboard's own light or dark look independent of the app's theme, and `showSoftInputOnFocus`
lets a field take focus (for a caret and a custom picker) without the system keyboard appearing at
all.

## Input accessory view

`<input-accessory-view>` docks a bar above the keyboard on iOS. Pair it with a `<text-input>` by
giving the view a `nativeID` and the input the same string as `inputAccessoryViewID`. Android has
no native counterpart to this and the element commits as a plain view, so content placed inside it
simply sits inert rather than floating above the keyboard.

<!-- api: InputAccessoryView -->
