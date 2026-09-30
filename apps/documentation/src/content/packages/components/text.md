---
title: Text
summary: <text>, why text cannot be bare, and how fonts and truncation work.
art: text
---

# Text

A native view has no concept of a bare text node. There is no `<p>` and no way to imply one: any
character an app wants on screen has to sit inside a `<text>` element, imported from this package.
Writing `<view>Hello</view>` compiles, and renders nothing.

```ts
import { Component, input } from '@angular/core';
import { View, Text } from '@ng-native/components';

@Component({
  selector: 'app-greeting',
  imports: [View, Text],
  template: `
    <view>
      <text>Hello, {{ name() }}</text>
    </view>
  `,
})
export class Greeting {
  readonly name = input('there');
}
```

A `<text>` nested inside another `<text>` renders as an inline run sharing the parent's font and
baseline, which is how to mix styles within one paragraph: `<text>Plain <text class="bold">and
bold</text></text>`. Text styling - `color`, `font-size`, weight - inherits down through the CSS
cascade exactly as it does on the web. It does not inherit from an inline `[style]` set on an
ancestor `<view>`, which is easy to assume works like a cascading `color` and does not: put text
styles in a stylesheet rule or on the `<text>` itself.

## Presses

React Native only makes a piece of text pressable when a press handler is actually attached to it,
and an Angular template gives no way to ask "is `(press)` bound to this element" from inside the
component. So `<text>` needs an explicit `pressable` input before `(press)`, `(pressIn)`,
`(pressOut)` or `(longPress)` will fire on it - binding the events alone does nothing.

```html
<text pressable (press)="onSelect()">Select</text>
```

A `pressable` text is announced as a link, as React Native's `Text` is, unless it has a `role` or
`accessibilityRole` of its own or is disabled.

`disabled` stops the presses and tells VoiceOver and TalkBack the text is disabled, as React
Native's `Text` does. A disabled text says so whether or not it is `pressable`. When `disabled` and
`aria-disabled` disagree, `disabled` decides what is announced, on a text and on every control.

## Fonts

A font is styled the same way as on the web: `font-family`, `font-weight`, `font-size` in a
stylesheet or `[style]`, resolved to native's single-name `fontFamily` at build time. A custom
font still has to be registered with the platform before it can be requested this way - see
[Load custom fonts](/packages/expo/fonts) for `loadFonts()`, which has to run before the app mounts
so the first frame is not painted in the fallback face.

## Truncation, selection and font scaling

`numberOfLines` truncates after that many lines, with `ellipsizeMode` choosing where the ellipsis
goes (`clip` is iOS only). `selectable` lets the user copy the text. `allowFontScaling` (on by
default) and `maxFontSizeMultiplier` control how far the system's text-size setting is allowed to
grow it. `adjustsFontSizeToFit` and `minimumFontScale` (iOS) shrink the font instead of truncating,
down to a floor. `dynamicTypeRamp` (iOS) follows a Dynamic Type style rather than a fixed size, and
`dataDetectorType` (Android) turns phone numbers, links, addresses and emails into tappable text.

<!-- api: Text -->
