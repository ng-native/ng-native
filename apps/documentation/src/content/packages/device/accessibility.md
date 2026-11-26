---
title: Accessibility
summary: The screen reader, reduced motion, bold text and font scale that `Accessibility` reports.
---

# Accessibility

`Accessibility` reports what the user has turned on in the system's accessibility settings: whether
a screen reader is running, whether they asked for reduced motion, whether bold text is on, and
their text-size multiplier.

```ts
import { Component, inject, signal } from '@angular/core';
import { Text } from '@ng-native/components';
import { Accessibility } from '@ng-native/device';

@Component({
  selector: 'app-search-results',
  imports: [Text],
  template: `<text>{{ resultsLabel() }}</text>`,
})
export class SearchResults {
  private readonly accessibility = inject(Accessibility);
  // A signal, so the text follows it: nothing re-renders for a plain field in a zoneless app.
  protected readonly resultsLabel = signal('');

  showResults(count: number): void {
    this.resultsLabel.set(`${count} results`);
    this.accessibility.announce(this.resultsLabel());
  }
}
```

The components already apply React Native's own accessibility defaults - roles, labels, whether a
view is even exposed as an element - without any of this being injected. This service is for what
those defaults cannot decide: skipping an animation because `reduceMotion()` is true, giving way in
a layout because `fontScale()` is past what a single line can hold, or telling a screen reader about
something that changed off screen with `announce()`.

`screenReader` is whether VoiceOver or TalkBack is running. `reduceMotion` is the same setting
`@media (prefers-reduced-motion: reduce)` reads, and is the better answer wherever the motion is
styling rather than logic. `boldText` means the system font is heavier, so a hand-tuned weight may
need to give way. `fontScale` is a multiplier of the default text size, one being the default and
the largest accessibility sizes past three - it is not an event, because changing it means leaving
for Settings, so it is read at startup and again when the app comes back rather than watched.
`announce(message)` says something to a screen reader that no focus change would have said: a list
that reordered, a search that returned nothing - changes a sighted user sees and a screen reader
would miss. `accessibilityLiveRegion` and `aria-live` on a view do this on Android only, as in React
Native, and do nothing on iOS, so content that must be announced on both platforms calls
`announce()` on iOS.

Text itself follows a change of the system text size while the app runs, with nothing injected:
`watchConditions(app.engine)`, which the app template calls at bootstrap, measures every `<text>`
and `<text-input>` again at the new size the moment the system reports it, so each one grows to
fit rather than keeping the box it was first measured in. An app that does not call
`watchConditions` can call `app.engine.remeasureText()` itself.

Every value here starts at its neutral setting (nothing on, a font scale of one) and is corrected
once the platform answers, because React Native reports all three asynchronously - a first paint
never assumes a setting is on that has not actually been confirmed.

## On macOS

VoiceOver reads a view's role, label, hint and value, and its checked, selected and disabled
state, from the same accessibility inputs as on iOS. A role AppKit has no counterpart for, such as
a heading, is a group that speaks the role's name.

Tab and Shift-Tab move the keyboard focus in the order views appear in the tree, positive
`tabIndex` first. With the Mac's default keyboard navigation Tab reaches text inputs only, and
Option-Tab reaches every focusable view, as in other Mac apps. A focus moved by a key draws
AppKit's focus ring, unless the view styles `outline`.

A sheet, an in-window cover or a popover keeps Tab inside it. The focus moves into it as it opens
and goes back to the view that had it when it closes.

A view with the `tablist`, `radiogroup`, `menu`, `menubar`, `listbox` or `grid` role is one Tab
stop, as WAI-ARIA describes. Inside it the arrow keys, Home and End move the focus between its
`tab`, `radio`, `menuitem`, `option` or cell views. A tablist, radio group, menu or menu bar wraps
round; a listbox and a grid stop at their ends. In a grid, Control-Home and Control-End go to the
first and last cell. A `tabIndex` of -1 keeps an item out of Tab order while the arrows still reach
it. The host only moves the focus: select a tab or check a radio from its `(focus)` handler.

On macOS the desktop host reads the system's settings: `screenReader` is VoiceOver running and
`reduceMotion` follows System Settings. macOS has no bold text setting an app can read, so
`boldText` stays false. `announce()` hands a message that is not empty to VoiceOver. `fontScale`
is one, since nothing resizes a Mac app.

On Linux `fontScale` is the desktop's text scaling, which GNOME's Large Text and text scaling
factor set, and the app's text is laid out at it. A change while the app runs updates
`Dimensions` and `PixelRatio.getFontScale()`, and the host lays out the text on screen again at
once. The engine builds its next commit from the text it committed before, so call
`watchConditions(app.engine)` to keep every text at the new size: it hands the engine the new
scale, which its line boxes read, and measures every text again. `Accessibility.fontScale`
keeps the value read when the app started, because the GTK host never reports the app becoming
active again, which is what refreshes it elsewhere.

## Off a device and on the web

Off a device every setting stays at its neutral default forever and `announce()` does nothing. On
the web, the browser's accessibility tree and `prefers-reduced-motion` cover most of the same
ground.

## Reference

<!-- api: Accessibility -->
