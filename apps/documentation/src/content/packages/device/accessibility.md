---
title: Accessibility
summary: The screen reader, reduced motion, bold text and font scale `Accessibility` reports.
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
would miss.

Text itself follows a change of the system text size while the app runs, with nothing injected:
`watchConditions(app.engine)`, which the app template calls at bootstrap, measures every `<text>`
and `<text-input>` again at the new size the moment the system reports it, so each one grows to
fit rather than keeping the box it was first measured in. An app that does not call
`watchConditions` can call `app.engine.remeasureText()` itself.

Every value here starts at its neutral setting (nothing on, a font scale of one) and is corrected
once the platform answers, because React Native reports all three asynchronously - a first paint
never assumes a setting is on that has not actually been confirmed.

## Off a device and on the web

Off a device every setting stays at its neutral default forever and `announce()` does nothing,
because there is no `AccessibilityInfo` underneath it to ask. On the web the browser's own
accessibility tree and `prefers-reduced-motion` cover most of the same ground; `Accessibility` is
still the one place `boldText` and `fontScale` come from on native.

## Reference

<!-- api: Accessibility -->
