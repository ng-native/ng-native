---
title: Scroll view
summary: <scroll-view>, its content container, sticky headers, and pull-to-refresh.
art: scroll-view
---

# Scroll view

`<scroll-view>` wraps its content in an internal container the way React Native's own
`ScrollView.js` does, because native scroll views have no equivalent to `contentContainerStyle` of
their own. `contentContainerStyle` styles that inner container - padding and gaps on the
scrollable content go there, not on `[style]`, which styles the scroll view's own frame.

```html
<scroll-view #list [contentContainerStyle]="{ padding: 16, gap: 12 }">
  @for (item of items(); track item.id) {
  <text>{{ item.label }}</text>
  }
</scroll-view>
```

`contentContainerClass` gives the same container classes instead, as NativeWind's
`contentContainerClassName` does. The container is matched as if it were written in your own
template, so Tailwind utilities and your component's own styles both reach it.
`contentContainerStyle` wins over a class, as an inline style does. Without a class the container
is the scroll view's own again, and your styles no longer reach it.

```html
<scroll-view contentContainerClass="gap-3 p-4">
  @for (item of items(); track item.id) {
  <text>{{ item.label }}</text>
  }
</scroll-view>
```

## Horizontal scrolling

`horizontal` changes the scroll axis, and it changes two things to do it: the scroll view's own
flex direction and the content container's. Setting only one leaves the content stretched to the
scroll view's width with nothing to scroll to, which looks exactly like a horizontal scroll view
that simply does not have enough in it to scroll - `horizontal` handles both, so this only matters
if something is overriding the content container's own layout.

## Keyboard taps

`keyboardShouldPersistTaps` controls what a tap elsewhere in the scroll view does while a
`<text-input>` has focus: `'never'` (the default) dismisses the keyboard immediately and nothing
else happens with the tap, `'handled'` lets whatever was tapped handle it first and only dismisses
if nothing did, and `'always'` never dismisses at all.

## Sticky headers

`stickyHeaderIndices` pins children of the content to the top while the rest scroll under them,
each until the next sticky child pushes it off. React Native does this in JavaScript rather than
natively, by translating the child against the scroll offset, and so does this. As in RN, the
translation runs on the native animation driver, so a pinned header keeps up with a fast fling; the
translate is written as a prop only once scrolling pauses.

## Methods

`scrollTo({ x, y, animated })`, `scrollToEnd({ animated })`, `flashScrollIndicators()` and, on iOS,
`zoomToRect(rect, animated)` are available as methods through a template reference.

## A scroll handler and change detection

A `(scroll)` handler runs change detection for its component on every scroll event, and Angular
checks every row an `@for` in that component's template has rendered, whatever the handler
changed. A header that fades as the page scrolls, over a thousand rows in the same template,
re-checks all thousand rows every frame. Put the list in a component of its own and the same event
checks one input instead: with a thousand rows, a scroll event costs about 0.05ms of JavaScript
rather than about 2ms.

```html
<scroll-view (scroll)="fadeHeader($event)">
  <view [style]="{ opacity: headerOpacity() }"><text>Inbox</text></view>
  <app-message-rows [messages]="messages()" />
</scroll-view>
```

<!-- api: ScrollView -->

## Refresh control

`<refresh-control>` is a pull-to-refresh spinner, used as a direct child of a `<scroll-view>` or
`<virtual-list>`. `refreshing` is a two-way model: native shows the spinner the instant the user
pulls, before the app has said anything, and the app is expected to set `refreshing` to `true` when
the `(refresh)` output fires and back to `false` once the work is done. If an app never clears it,
the spinner keeps spinning indefinitely - there is no timeout.

```html
<scroll-view>
  <refresh-control [(refreshing)]="loading" (refresh)="reload()" />
  @for (item of items(); track item.id) {
  <text>{{ item.label }}</text>
  }
</scroll-view>
```

iOS also reads `tintColor`, `title` and `titleColor` for a label under the spinner. Android reads
`colors` (the colors the spinner cycles through), `progressBackgroundColor`, `size`
(`'default'` or `'large'`) and `enabled` (whether pulling does anything at all, default true).
`progressViewOffset` sets how far from the top the spinner sits, on both platforms.

On Android the native swipe layout has to be the scroll view's _parent_, not its child, or a pull
does nothing. It is still written as a child, as on iOS, and moved into place: the committed tree
has `AndroidSwipeRefreshLayout` where the scroll view was, with the scroll view inside it. The
layout half of the scroll view's inline style (size, margins, flex, position, transform) moves to
the swipe layout, the way React Native's `ScrollView.js` splits it, and the scroll view keeps the
rest. Layout that comes from a class stays on the scroll view.

<!-- api: RefreshControl -->
