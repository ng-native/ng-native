---
title: Components
summary: The React Native element set as Angular components, one per native view.
---

# Components

`@ng-native/components` is the element set: `<view>`, `<text>`, `<scroll-view>`,
`<text-input>` and the rest, each an Angular component that commits as a real native view through
React Native's Fabric renderer. There is no DOM underneath any of them and no React in the render
path. A `<view>` is a `UIView` on iOS and an Android `View`; a `<text>` is a native text layer; a
`<switch>` is the platform's own switch control. Reach for this package for anything that ends up
on screen; styling comes from `[style]` bindings and a component's own `styles`, compiled into a
native stylesheet at build time - see the theming guide, not this one.

Every element is a separate Angular component, and Angular's own import rules apply to it like
anything else: a template that writes `<scroll-view>` must have `ScrollView` in its `imports`
array. Miss the import and the template still compiles, but the element renders as a plain,
unstyled view instead, with nothing but a development-mode console message to say so. When an
element does not behave as documented, check the import list first.

## One name, two layers

`<view>` is two things with one name. The engine keeps a table of element names and the native view
each commits as - `view` is `View`, `scroll-view` is `ScrollView`, `text` is `Paragraph` - so a bare
`<view>` reaches native even with nothing imported. The component in this package takes the element
name as its selector (`View` is `selector: 'view'`), so importing it does not change the tag. It
attaches to the same element and adds what the table cannot: typed inputs, React Native's default
props, accessibility, events, and for `<text>` the text layer itself. There is no second, prefixed
set of wrappers to reach for; `<view>` with `View` imported is the wrapper.

That is also what the console message is about. On the first commit of a known element that no
component has claimed, development builds log:

```text
[angular-native] <text> is used in a template that does not import Text. Add it to the
component's `imports` from '@ng-native/components'; without it the element renders as a plain view.
```

A name that nothing accounts for at all - not in the table, not the host of a component, and not
an element selector of any directive a template imports - is almost always a typo, and gets a
message of its own, once per name:

```text
[angular-native] <veiw> is not a known element: no component, directive or registered native
view claims it, so it renders as an empty view. Check the spelling, or import the component that
owns it.
```

Your own components' hosts (`<app-card>`) never trigger it, whatever their selector, and neither
do names registered with `registerViewName` or `registerExpoView`.

A misspelled input or attribute on an element is caught the same way. `[numberofLines]` on a
`<text>` binds no input, so Angular hands it on as a property and native ignores it. Development
builds compare each element's props with what its component declares, its inputs and the native
props it writes, and log the rest once per element and name:

```text
[angular-native] <text> has no prop 'numberofLines', so native ignores it. Did you mean
'numberOfLines'? Check the spelling against the Text page, or declare it with
declareNativeProps('text', ['numberofLines']) if the native view does read it.
```

Styles, events, the accessibility and identity props, `data-*` and `aria-*` attributes, a bare
marker attribute such as `listHeader`, and any attribute a directive in the template selects on or
takes as an input never trigger it. A prop the native view does read but the component has no input
for is declared once with `declareNativeProps` from `@ng-native/fabric`. Release builds skip the
check.

The names carry no prefix on purpose. They are React Native's own names in kebab case, so
React Native's documentation for `ScrollView` is the documentation for `<scroll-view>`. And `ng-`,
the obvious prefix, is Angular's: `ng-container` and `ng-template` are framework constructs, and
an `<ng-view>` would read as one. On the web, where `text`, `image` and `switch` are also SVG
element names, `@ng-native/web` creates every one of them in the HTML namespace, never as SVG: a
`<text>` is its own HTML element styled by the reset stylesheet, and a `<switch>` is a real
checkbox.

Most elements come from the package's main entry point:

```ts
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Image,
  Switch,
  ActivityIndicator,
  Modal,
  VirtualList,
  SafeAreaProvider,
  SafeAreaView,
} from '@ng-native/components';
```

Gestures, `Animated` and Reanimated's worklets are the exception: each reaches into React
Native's own uncompiled source, which Node cannot parse, so the test suite that runs this
package's own code under Node would break if the main entry point tried to load it. Import these
from their own files - `@ng-native/components/gestures`,
`@ng-native/components/animations`, `@ng-native/components/reanimated` - covered
on the gestures and animation pages.

The smallest thing that works:

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

## Shared props

`<view>`, `<text>` and every other element extend one abstract base that carries the props every
native view accepts: accessibility (`accessibilityLabel`/`aria-label`, `accessibilityRole`/`role`,
`accessibilityState` and its `aria-*` aliases), identity and hit testing (`nativeID`/`id`,
`testID`, `hitSlop`, `pointerEvents`). None of these show up in a specific element's own table
below; they are all here instead.

<!-- api: ViewBase -->

## Events

Most element events are not Angular outputs. They are bound like DOM events,
`(name)="handler($event)"`, and routed by the renderer to the matching Fabric event name -
`(layout)` to `topLayout`, `(touchStart)` to `topTouchStart`. Binding an event is what tells
native to start sending it; an `@Output()` would opt every instance into layout and touch events
whether or not anything was listening. Payload types - `LayoutEvent`, `TouchEvent`, `ScrollEvent`
and the rest - live in `@ng-native/components`, typed by what native actually sends, so a
handler can be written against a real interface instead of a cast.

A directive built on top of the renderer's own events can still expose a real Angular output where
that is a better fit: `Pressable`'s `press`, `pressIn`, `pressOut` and `longPress` are `output()`s,
resolved from the raw touch-responder negotiation rather than passed through unchanged. Use
`(press)` the way any other output is used; it is the renderer events underneath it, `(layout)` and
the rest, that are the exception to Angular's usual output binding, not the other way round.

Events bubble from the view they happened on to the root, as React Native's do, except the ones
React Native delivers to the target alone (`layout`, `scroll` and the other scroll events, `load`,
`error`). Every handler receives a `NativeSyntheticEvent`, with the payload on `nativeEvent` and
React Native's `stopPropagation()` and `isPropagationStopped()`. Calling `stopPropagation()` ends
the bubble after the current view; other handlers on that same view still run:

```html
<view (touchEnd)="dismiss()">
  <view (touchEnd)="$event.stopPropagation(); keep()"></view>
</view>
```

An error thrown by anything in the dispatch that is not an Angular listener - a responder handler,
a listener registered on the `Engine` directly - is caught and handed to the app's `ErrorHandler`
rather than thrown back into the native code that delivered the event.

## Where each element lives

The [layout](/packages/components/layout) page covers `<view>` and Yoga's flexbox defaults, and
[safe area](/packages/components/safe-area) covers keeping content clear of the notch. The
[text](/packages/components/text) page covers `<text>`, why nothing renders without one, and fonts.
The [input](/packages/components/input) page covers `<text-input>`, keyboards and the props Signal
Forms binds to. The [pressable](/packages/components/pressable) page covers `<pressable>` and
`<touchable-opacity>`, and the responder negotiation behind press events; the
[gestures](/packages/components/gestures) page covers `react-native-gesture-handler`. The [scroll
view](/packages/components/scroll-view) page covers `<scroll-view>` and pull-to-refresh, and the
[lists](/packages/components/lists) page covers `<virtual-list>` and `<section-list>`. The
[keyboard-avoiding view](/packages/components/keyboard-avoiding-view) page covers moving content
clear of the on-screen keyboard. The [image](/packages/components/image) page covers `<image>` and
`<image-background>`; the [activity indicator](/packages/components/activity-indicator) and
[switch](/packages/components/switch) pages cover those elements on their own; the
[modal](/packages/components/modal) page covers presenting content over everything else. The
[animation](/packages/components/animation) page covers plain CSS transitions, `AnimatedStyle` and
Reanimated worklets.

## Every page

**Layout** - [layout](/packages/components/layout),
[safe area](/packages/components/safe-area),
[scroll view](/packages/components/scroll-view),
[keyboard-avoiding view](/packages/components/keyboard-avoiding-view),
[lists](/packages/components/lists)

**Content** - [text](/packages/components/text), [image](/packages/components/image),
[activity indicator](/packages/components/activity-indicator)

**Input** - [input](/packages/components/input), [switch](/packages/components/switch),
[pressable](/packages/components/pressable), [gestures](/packages/components/gestures)

**Presentation** - [modal](/packages/components/modal), [animation](/packages/components/animation)
