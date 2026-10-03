---
title: Layout and views
summary: <view>, Yoga's flexbox defaults, and safe area insets.
art: layout
---

# Layout and views

`<view>` is the plain box: flexbox layout, and whatever background, border and shadow its style
gives it. It has no props beyond the shared ones on every element - all of its behavior comes from
`[style]`, `class`, and the component's own CSS.

```html
<view class="rounded-lg border p-4" [style.backgroundColor]="tint()">
  <text>Card content</text>
</view>
```

<!-- api: View -->

## Yoga, not CSS

Every element lays out with Yoga, React Native's flexbox implementation, and only with Yoga:
there is no `display: block`, no inline formatting context, and no way to opt out of flex layout
for a `<view>`. The default is not the one CSS in a browser uses. Yoga starts every node at
`display: flex; flex-direction: column; align-items: stretch; flex-shrink: 0`, so two `<view>`s
with nothing set stack vertically and stretch to their parent's width - a browser's defaults would
lay the same markup out as a shrink-to-fit row. Write `flex-direction: row` explicitly wherever a
layout needs one; there is no ambient row behavior to fall back on.

`<text>` is the one element Yoga does not treat as a flex container, because its content lays out
as text - wrapping, breaking, nested runs sitting on a shared baseline - rather than as boxes. A
`<text>` still participates in its parent's flex layout as a child; it just cannot itself arrange
children with `flex-direction`.

## A component's host is a flex item

A component used in another template, such as `<app-case-list />`, has a host element, and the
host commits as a plain view. It is a flex item in its parent like any `<view>`, and starts with
no `flex`, so it is as tall as its content. Its own elements sit inside it, so a `flex: 1` on
them fills the host, not the space around it. A `<scroll-view class="flex-1">` in a host with no
`flex` gets a height of zero, and the list renders nothing. In development, a `<scroll-view>` or
`<virtual-list>` with content that is still at zero size a second after it lays out logs a warning
that names it and links here. A release build doesn't check.

A component that fills the space it is given needs `flex: 1` on its host. Set it with the `host`
object in its decorator:

```ts
import { Component } from '@angular/core';
import { ScrollView, Text, View } from '@ng-native/components';

@Component({
  selector: 'app-case-list',
  imports: [ScrollView, Text],
  host: { style: 'flex: 1' },
  template: `
    <scroll-view class="list">
      <text>First case</text>
    </scroll-view>
  `,
  styles: `
    .list {
      flex: 1;
    }
  `,
})
export class CaseList {}

@Component({
  selector: 'app-cases',
  imports: [CaseList, Text, View],
  template: `
    <view class="screen">
      <text>Cases</text>
      <app-case-list />
    </view>
  `,
  styles: `
    .screen {
      flex: 1;
    }
  `,
})
export class Cases {}
```

`:host { flex: 1; }` in the component's `styles` does the same. With Tailwind, write
`host: { class: 'flex-1' }`. A class set on the host is matched against the global sheet and the
parent's styles, not the component's own, so a class only works on the host when it comes from
there, as Tailwind's utilities do.

The root component's host is a view too, but it fills the screen by default, as the web's mount
point does, so its elements fill the screen with `flex: 1` alone. Its `:host` styles it like any
other host: a background or padding there reaches that view, and a `height` there replaces the
default.

## Safe area

Keeping content clear of the notch, the status bar and the home indicator is the job of
`<safe-area-provider>` and `<safe-area-view>`; see [Safe area](/packages/components/safe-area).

## Measuring a view

`(layout)` reports a view's frame in its parent's coordinates. Where a view is in the window, which
is what a popover placing itself by its trigger needs, comes from the engine:

```ts
import { ElementRef, inject } from '@angular/core';
import { HostEngine, type WindowFrame } from '@ng-native/fabric';

private readonly engine = inject(HostEngine);
private readonly host = inject(ElementRef).nativeElement;

protected placeBy(): void {
  this.engine.measure(this.host, (frame: WindowFrame) => {
    // frame.x and frame.y are in the window; frame.width and frame.height the view's size.
  });
}
```

The node is a component's own host, or `.node` of a `[nativeRef]` on any element. The callback is
not called at all for a view that has not been committed yet, so measure in or after
`afterNextRender`, and again after anything that moves the view: a rotation, a scroll, the
keyboard. A frame is where the view was when asked, not a subscription.

In a test nothing is laid out, so a frame is what the test says it is. `fabric.frames` is a map
from a `nativeID`, or a view name, to the frame `measure` answers for that view:

```ts
const { fabric } = await render(Menu);
fabric.frames.set('trigger', { x: 16, y: 120, width: 44, height: 44 });
```

## Escape hatches

`[nativeRef]` reads the retained native node a primitive sits on, for the rare case an app needs
to reach past the component's own API - issuing a native command directly, say. `#ref="nativeRef"`
on a template reference gives access to `.node`.

<!-- api: NativeRef -->
