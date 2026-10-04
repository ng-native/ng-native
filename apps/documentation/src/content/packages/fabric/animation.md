---
title: Animation and transitions
summary: How transitions, animate.enter/leave and @keyframes actually run with no DOM.
---

# Animation and transitions

React Native has no CSS transition or animation engine of its own, so three different mechanisms
cover what CSS animation does on the web: `transition`, Angular's own `animate.enter`/
`animate.leave` template bindings (built on top of transitions), and `@keyframes`/`animation`,
which the engine plays independently of the other two.

## Transitions

React Native has no CSS transition of its own, so a `transition` property compiles to a spec the
engine drives in JavaScript: it notices a transitioning value change between two commits, holds the
old value, and interpolates toward the new one on a `requestAnimationFrame` loop, committing a
frame at a time until nothing is left running. Numbers interpolate directly; colors interpolate
channel by channel; a length or an angle interpolates as long as both ends share the same unit
(`translateY(10%)` to `translateY(100%)` works, `10%` to `20px` does not, because converting between
them would be a guess). A named color (`'red'`) interpolates as well: the compiler emits `rgb()` for
one in a stylesheet, and one bound straight into a style is looked up by name.

A duration, a delay or a curve can be a token in the longhands: `transition-property: opacity`
with `transition-duration: var(--duration-fast)`. The `transition` shorthand does not take one:
`transition: opacity var(--duration-fast) ease-out` is dropped whole, with a build warning, and the
element has no transition.

## `animate.enter` and `animate.leave`

They add and remove a class, and wait for what the class starts, using `getAnimations()` on the
element to know how long to wait.

An entering element starts in the style its enter class gives it. Angular adds the class in the
turn that creates the element and takes it off a frame later, and that is the one change a
`transition` on the element's resting style runs for: `.panel { opacity: 1; transition: opacity
200ms }` with `.panel.entering { opacity: 0 }` fades in once. A class added to any element in the
turn that created it is its starting style in the same way, as in a browser.

The engine only emits `transitionstart`/`transitionend` for a value the cascade recomputed. A
`@keyframes` animation on the enter or leave class plays, and Angular reads how long it lasts from
`getAnimations()`.

In development, [`mount()`](/packages/platform/bootstrapping) checks that Angular was built with
support for these enabled - that depends on a polyfill [Metro](/packages/metro/configuration)
installs - and logs a console error naming the fix if not.

## `@keyframes` and `animation`

A `@keyframes` block and an `animation` are supported on their own terms, independent of
`animate.enter`/`animate.leave`: write `animation: spin 1s linear infinite` on any element and the
engine plays it, tracked separately from the transitions above.

The longhands work too: `animation-name`, `animation-duration`, `animation-timing-function`,
`animation-delay`, `animation-iteration-count`, `animation-direction`, `animation-fill-mode` and
`animation-play-state`. Within a rule they apply in the order written, as in CSS, so a longhand
after the shorthand changes only its own part and a shorthand after a longhand resets it:

```css
.spinner {
  animation: spin 1s linear infinite;
  animation-duration: 2s; /* still spin, linear and infinite, now over 2s */
}
```

Each longhand also cascades on its own, as in a browser: a rule that sets only `animation-name`
keeps the duration, easing and iteration count a weaker rule's shorthand gave, and a rule that sets
only `animation-duration` changes the animation another rule names.

```css
.icon {
  animation: swap 3.6s ease-in-out infinite;
}
.icon.open {
  animation-name: swap-open; /* swap-open, over 3.6s, forever */
}
```

A duration or delay can be a token, or `calc()` with tokens in it, which is how a list staggers
its rows: `animation-delay: calc(var(--i) * 60ms)` with `[style.--i]="$index"` on each. A token of
time is read in milliseconds whatever unit it was written in.

An `animation-timing-function` written inside a keyframe eases from that keyframe to the next, as in
CSS, over the animation's own: Tailwind's `animate-bounce` falls on one curve and rises on another.
A keyframe that sets `transform: none` eases to the identity of the translate, scale, rotate and
skew functions beside it, so a translate in percent eases back to `0%`; a `perspective()` has no
identity here, and is kept rather than eased away.

`animation-direction` plays every iteration forwards (`normal`), backwards (`reverse`), or there
and back (`alternate`, and `alternate-reverse` starting backwards); with a fill, the frame held at
the end is the one the last iteration finished on.

`animation-play-state: paused` holds an animation at the frame it has reached, and `running`
carries it on from there; neither starts it over. It can be written in a rule of its own, as a
class that pauses whatever animation the element has, which is how a story or a carousel holds
while a finger is down: `.held { animation-play-state: paused }`. An animation that starts
paused shows its first frame.

An animation whose keyframes set only `opacity` and transforms is played by native: the
keyframes are handed to React Native's animated module when it starts, and nothing runs in
JavaScript until it ends. A spinner or a pulsing placeholder, which never ends, costs the
JavaScript thread nothing while its screen is open. Any other animation is played from
JavaScript, a commit on every frame: one that sets a color or a size, one with an
`animation-delay`, one that repeats a fractional number of times, and every animation where the
animated module is absent. An animation native is playing is handed back to JavaScript, at the
frame it has reached, when it is paused or its keyframes change.

`animation-name: none` (or `animation: none`) stops an animation a weaker rule started, and a rule
with durations but no name plays nothing on its own, as in a browser. A few real constraints come
with it, whichever spelling you use:

- Only one animation per rule, so `animation-name` takes one name and the shorthand one entry. Two
  would need two players and a rule for what happens when they touch the same property, which
  nothing here implements. The other longhands may be lists; the first entry is the one that pairs
  with the name.

Anything outside those limits is dropped with a build warning, never silently ignored. Only the
offending declaration goes, so the rest of the rule's animation still plays.

The `transition-*` longhands follow the same order rule. `transition-property`,
`transition-duration`, `transition-timing-function` and `transition-delay` pair up by position,
with a shorter list repeating, and a longhand after `transition` overrides that part, including
setting it back to `0s`.

A timing longhand also cascades on its own, as in a browser: a rule that sets only
`transition-duration`, `transition-timing-function` or `transition-delay` applies to the
transition another rule names, so Tailwind's `transition duration-300 ease-linear` runs for
300ms. Such a rule takes a single value, since the property list that would size a longer one is
in another rule.

## Scroll-driven animations

`animation-timeline: scroll()` plays a `@keyframes` animation by the nearest scroll view's offset
instead of the clock, and native plays it: the keyframes are laid along the offset and handed to
React Native's animated module, which moves the view on every frame the scroll view moves, with no
JavaScript in between. A header that collapses as the page scrolls follows the finger exactly.

```css
@keyframes collapse {
  to {
    opacity: 0;
    transform: translateY(-40px) scale(0.9);
  }
}
.hero {
  animation: collapse linear both;
  animation-timeline: scroll();
  animation-range: 0 160px;
}
```

- `scroll()` and `scroll(nearest)` follow the block axis, which is vertical on native;
  `scroll(inline)` or `scroll(x)` follows a horizontal scroll view. `scroll(root)`,
  `scroll(self)`, `view()` and named timelines are dropped with a warning.
- `animation-range` (and `animation-range-start` and `animation-range-end`) takes points or a
  percentage of how far the view scrolls. Left out, the animation plays over the whole scroll. How
  far that is comes from the scroll view's own scroll events, so until it first scrolls, a
  percentage or a missing end has nothing to be a share of, and the animation sits at its start.
  The named ranges (`entry`, `cover`) belong to `view()` and are dropped.
- The offset is the scroll view's content offset. With `contentInsetAdjustmentBehavior` set to
  `automatic` under a translucent header, the view rests at a negative offset, so a range from 0
  starts once the content has moved past the inset.
- The timing function eases each segment between keyframes, as it does on the clock. `linear` is
  what a scroll-driven animation usually wants.
- `animation-fill-mode` works as in CSS: without a backwards fill the element shows its resting
  style before the range, and without a forwards fill, after it. `reverse` plays the range
  backwards. The duration, delay and iteration count are for the clock and are not used.
- Native animates `opacity` and the transforms (`transform`, `translate`, `rotate`, `scale`) this
  way; a translate in percentages, or any other property, holds its first frame, with a warning in
  development.

## Where a commit for this comes from

Neither a transition frame nor an `animate.enter`/`animate.leave` class change is a signal or
binding Angular's change-detection scheduler knows about, so both need a commit scheduled outside
the normal render pass. See [the renderer](/packages/platform/renderer) for how
`NativeRendererFactory` drives that `requestAnimationFrame` loop and reacts to the engine going
dirty between passes.
