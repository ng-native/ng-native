---
title: What CSS reaches a device
summary: A scannable reference for what compiles to native and what is dropped with a build warning.
---

# What CSS reaches a device

The rule of thumb throughout the whole compiler: if React Native's style API can express it, CSS
has a spelling for it here; if it cannot, the declaration or rule is dropped with a build warning
that names the file, the line and the reason, rather than shipping a screen that is silently
missing a style. A dropped declaration leaves the rest of its rule in place. CSS that does not
parse fails the build.

## Selectors that work

Type, class and id selectors. Attribute selectors: `[name]`, `[name="value"]`, `[name^="value"]`,
`[name$="value"]`, `[name*="value"]`, `[name~="value"]` and `[name|="value"]`. `:is()`, `:where()`
and `:not()` (each compound argument only - a combinator inside one of these is dropped,
other than two forms Tailwind writes: `<compound> *`, the ancestor test its `group-*` variants
compile to, and `<compound> ~ *` or `<compound> + *`, the sibling test its `peer-*` variants
compile to, which is read as the sibling combinator it means). `:host`
and `:host(<compound>)`. `:host-context(<compound>)`. `:first-child`, `:last-child`, `:only-child`,
`:nth-child()` and `:nth-last-child()` (the `of <selector>` form is not supported). `:empty`.
`:root`. `:disabled` (answered from the element's own `disabled` prop). `:focus` and `:active`,
which the engine tracks itself from native focus, blur and press events. Every combinator CSS has
works too: descendant (` `), child (`>`), next-sibling (`+`) and later-sibling (`~`).

`html` means the top of the tree, exactly as `:root` does: there is no element called `html` on
native, and a stylesheet written for the web puts its tokens there.

## Selectors that are dropped

A rule with one of these selectors is dropped with a warning.

`::before`, `::after` and every other pseudo-element are permanently unsupported, not a "not yet".
Rendering one would mean synthesizing a node no template declared, which would make the style
engine responsible for view hierarchy a template never wrote - so the fix, when a design wants one,
is to write the element.

`::placeholder` is the exception, because it needs no node: a text input draws its own placeholder,
and its `placeholderTextColor` is the colour. `.field::placeholder { color: #8b8b96 }`, or
Tailwind's `placeholder:text-gray-400`, sets that colour on a `<text-input>`, a token in it
included. A placeholder takes only a colour, so anything else in the rule is dropped with a
warning, and the rule matches a `<text-input>` only, as a browser's matches an input.

`:hover` and `:focus-visible` are also unsupported, because there is no hover or focus cascade to
answer them from: a phone has no pointer to hover with, and focus arriving from a keyboard or an
assistive technology looks identical to focus arriving any other way. Use `:active` and `:focus`,
which the engine does track, or drive the state with a bound attribute such as `[attr.data-hover]`.
The `hover:` and `focus-visible:` variants in [`@ng-native/tailwind`](/packages/tailwind/variants)
already point at them for you.

`:checked`, `:indeterminate`, `:valid`, `:invalid`, `:placeholder-shown` and the other form-state
pseudo-classes are unsupported too: a native control keeps that state in its component's inputs,
where no selector can see it. Bind an attribute from the same signal (`[attr.data-checked]`) and
select on that. `:has()` is unsupported, because a style that depends on what is beneath a node
would have to be matched again whenever anything beneath it changed.

## Everything else CSS can paint

Colors can be written as a named color, hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`,
`oklab()` or `oklch()`, with or without an alpha, and a `color-mix()` of two such colors in any of
those spaces. Native paints sRGB only, so each is converted to `rgb()` at build time with CSS Color
4's formulas; a color outside sRGB is brought inside by CSS Color 4's gamut mapping, which reduces
its chroma rather than clipping each channel, so the hue holds. `color()` with a named space, such
as `display-p3`, is dropped. A `color-mix()` with a `var()` in it is worked out on device once
the token is known, in the space it names (`srgb`, `oklab`, `oklch`, `lab`, `lch`, `hsl` or `hwb`)
with CSS Color 4's arithmetic: premultiplied alpha, a hue the shorter way round unless a hue
method says otherwise, an achromatic color's hue taken from the other color, and the result
brought inside sRGB by the same gamut mapping. That is what themes a list row by a bound custom
property: `[style.--cover]="track.colour"` on the row, and `color-mix(in oklch, var(--cover) 70%,
white)` for its lighter shade.

A relative color from a token, such as `oklch(from var(--brand) l c h / 0.2)` or
`hsl(from var(--brand) h s calc(l - 20))`, is worked out on device too, in `rgb()`, `hsl()`,
`hwb()`, `lab()`, `lch()`, `oklab()` or `oklch()`. Each channel keyword is the origin's number in
that space, on CSS Color 5's scale (`r g b` 0 to 255, the `s l w b` of `hsl()` and `hwb()` 0 to
100), and a channel is a keyword, a number, or `calc()` of them. A percentage or an angle stands
alone as a channel, since CSS does not add one to a keyword. A hue a gray does not have is 0.

`light-dark(<light>, <dark>)` picks by the app's color scheme, the one `prefers-color-scheme`
reads; native has no per-element `color-scheme`. It works anywhere a color does: a declaration, a
token (`--surface: light-dark(white, black)`), a gradient stop, a shadow, inside a `color-mix()`,
with tokens on either side.

Gradients (`background-image: linear-gradient(...)` or `radial-gradient(...)`, compiled to the
structure Fabric's `experimental_backgroundImage` prop reads) support linear and radial only, not
conic. A stop can be a `var()`, a `color-mix()` with one in it, or a literal color beside them;
a stop that is a lone `var()` nobody defines is dropped, which is what makes an optional middle
color optional. A radial gradient with tokens in its stops takes its shape, size and center as
keywords and positions (`circle closest-side at 50% 18%`), not an explicit radius; a position
can be a token too (`at var(--x) 30%`), with a fallback after its name. `background-image` takes gradients only - a `url()` in `background-image` is dropped, because there is no
image loader behind that prop; put an image in an `<image>` element instead.

`filter` compiles to the list of functions React Native's `filter` prop takes, and which of them a
device draws depends on the platform:

| Function                                                                         | iOS | Android                       |
| -------------------------------------------------------------------------------- | --- | ----------------------------- |
| `brightness()`, `opacity()`                                                      | yes | yes                           |
| `contrast()`, `grayscale()`, `hue-rotate()`, `invert()`, `saturate()`, `sepia()` | no  | yes                           |
| `blur()`, `drop-shadow()`                                                        | no  | Android 12 (API 31) and later |

On Android a list with `blur()` or `drop-shadow()` in it is drawn from Android 12 on and ignored
whole before that; the others are drawn on every version. A function iOS does not draw is dropped
with a warning naming the function in any rule that can apply on iOS: scope the rule to Android
with a `.platform-android` ancestor, the class `mount` puts on the root (Tailwind's `android:`
variant compiles to exactly that), and it is kept.

```css
.platform-android .photo-disabled {
  filter: grayscale(1);
}
```

A component's stylesheet is compiled for the platform Metro is bundling, so an unscoped rule keeps
its filter in the Android build and drops it with a warning in the iOS build; a sheet compiled with
no platform, such as a component under a test, has to suit both. A Tailwind sheet serves both
platforms too, so `grayscale` there is dropped with a warning, while `android:grayscale` is kept.
A filter inside `@keyframes` is checked against the platform alone, since a keyframe has no
selector to scope it.

A `filter` can also be a list of tokens, each holding one function or nothing: `filter:
var(--blur,) var(--grayscale,)` draws whichever of them are set on the element, from whichever
rules set them. Each token is checked against the platforms of the rule that sets it, so
`--grayscale: grayscale(1)` in a rule that can apply on iOS is dropped with the same warning.

`transform` takes the translate, scale, rotate, skew and perspective functions. The individual
properties `translate`, `rotate` and `scale`, which are what Tailwind 4 writes, are properties of
their own, as on the web: `.rotate-45.translate-x-4` both turns and moves, and each can be
transitioned (`transition: rotate 200ms`) or animated in `@keyframes` separately. They apply in the
order CSS gives them, translate, then rotate, then scale, then `transform`. `transition: transform`
does not animate them, because they are not `transform`; name them, as Tailwind's
`transition-transform` does. `rotate` turns about x, y or z; any other axis is dropped.
Any of them can take tokens, `translate: var(--tw-translate-x) var(--tw-translate-y)` and
`transform: translateY(var(--y)) rotate(var(--r))` alike, with `calc()` around them; an angle
token is read in degrees whatever unit it was written in, so `--r: 0.25turn` turns 90. With a
token in it, `transform` takes the translate, scale, rotate and skew functions.

In a `[style]` binding, write a transform as a string, `{ transform: 'rotate(45deg)' }`. React
Native's array form, `{ transform: [{ rotate: '45deg' }] }`, renders the same, but Angular's dev
mode checks each style value and logs NG0318 for one that is not a string or a number, every time
the binding changes. For a transform that follows a signal frame by frame, that is a warning a
frame.

`skewX()` and `skewY()` are drawn on iOS only. React Native on Android breaks a transform down into
the rotation, scale and translation an Android view has, and a view has no skew, so `skewX()` is
left out and `skewY()` comes out as a rotation. A skew is refused the way a filter iOS does not draw
is, with the platforms the other way round: it is dropped with a warning in any rule that can apply
on Android, and kept in a rule scoped with a `.platform-ios` ancestor (Tailwind's `ios:` variant),
in an iOS build, and in a keyframe of one. A skew of 0 is kept everywhere, since it draws the same
on Android.

`box-shadow` and `text-shadow` both work, though native has room for exactly one `text-shadow`, not
a list. On iOS a `text-shadow` is drawn inside the text's own box, so a blur or offset that
reaches past it is cut off square; give the text padding as deep as the shadow. A `box-shadow` can
have tokens in it as design systems write them: a color that is a `var()`, a `color-mix()`, a
relative color, `rgba(var(--channels), 0.25)` or an `hsl()` of tokens; a length that is
a `var()` or `calc()` around one (`0 0 0 var(--ring-width)`); and a whole shadow that is a token,
in a list with others, with the shadows after its name as the fallback. A shadow whose lengths are
all one token is the exception, since a token is read in one form: write its lengths out, or put
the whole shadow in the token. A shadow token can have a token in its color too, `--ring: 0 0 0
2px var(--ring-color, currentcolor)`, filled in where it is used. `currentcolor` as the fallback
of a shadow's color is the element's `color`, or the one it inherits, or black. A `text-shadow`
takes tokens the same way, in its color and its lengths.

Truncation is a paragraph's props on native, not a style, and CSS's three ways of asking for it
compile to them: `white-space: nowrap` to `numberOfLines: 1`, `line-clamp` or `-webkit-line-clamp`
to that many lines, and `text-overflow` to `ellipsizeMode` (`ellipsis` is `tail`, the default, and
`clip` is drawn on iOS only). `line-clamp: none`, `unset` and `white-space: normal` clear the limit.
They apply to the `<text>` the rule matches, where the props are read: on a `<view>` around the
text they do nothing, so put the class on the text itself. `display: -webkit-box` is read as the
flex box native already is, laid out along the axis `-webkit-box-orient` names, so the whole
line-clamp idiom compiles; `-webkit-box-orient` without it is ignored, as a browser ignores it. A
`[numberOfLines]` bound on the element wins over the stylesheet. The other `white-space` values,
which keep spaces and line breaks, are dropped. `font-variant-numeric` takes `tabular-nums`,
`proportional-nums`, `lining-nums` and `oldstyle-nums`, as `fontVariant`.

`display` takes `flex`, `none`, `block` and `contents`. Every native view is already a flex
container stacking its children in a column, which is what a block does with its own, so `block`
is read as `flex`: that is what lets `.d-none` followed by `.d-md-block` show an element again at a
breakpoint. `inline-flex` is read as `flex` for the same reason. `inline` and `inline-block` are
read as `flex` too, because every native view sits in a flex container, and a browser lays out a
flex container's inline children as blocks. `contents` is Yoga's own: the element draws no box of
its own (no background, border or padding) and its children are laid out as if they were its
parent's. `grid` and the table values are dropped, because a column of flex children cannot pretend
to lay them out in a grid.

`overflow` is one value for both axes - Yoga has no separate `overflow-x`/`overflow-y` - so a rule
that gives them different values is dropped with a warning rather than silently picking one.
`overflow: auto` is read as `scroll`, which is how Yoga lays out a scroll container, and `clip` as
`hidden`. `cursor` takes `auto` and `pointer`, the two a pointer on an iPad draws, with `default`
read as `auto`; any other cursor is dropped with a warning. So is a `mix-blend-mode` native does not
draw, `plus-darker`, and a `text-decoration-line` of `overline`, which native has no line for.
`align-content: baseline` is the start it comes to in both engines. `border-style: none` and
`hidden` draw no border whichever rule set the width, as on the web, so `border-hidden border-x`
draws no side.

The logical properties all work: `inset-inline`, `inset-block`, `margin-inline`, `margin-block`,
`padding-inline` and `padding-block`, with their `-start` and `-end` longhands, and the border
shorthands `border-inline`, `border-block` and their `-start` and `-end` sides, so Tailwind's
`inset-x-*`, `inset-y-*`, `mx-*`, `ps-*`, `start-*` and the rest do what they say. The block axis is
always top to bottom, since native has one writing mode. The inline axis follows the layout
direction: `-start` and `-end` are Yoga's start and end edges, which swap in a right-to-left
layout, and a pair written with one value (`inset-inline: 0`) is simply both sides. They compile
to the edges every native view reads, not to React Native's own `insetInlineStart` and
`marginBlock` spellings: those are aliases that some views, `<safe-area-view>` among them, never
apply, so a class on one did nothing. One difference from the browser: where a start or end edge
meets a physical one (`inset-inline-start` and `left` on the same element), the start or end
edge wins, whichever was written last.

`border-style` is likewise one value for all four sides: a native border has one style, and a
per-side style that disagrees with the others is dropped for the same reason. `border-top` and
the other per-side shorthands set that side's width and color, and take `solid` (native's
default) or `none` as their style. A border shorthand with no color, such as `border: 2px solid`,
is drawn in the element's text color, its own or inherited, as on the web, and so is a border color
of `currentColor`, which is what Tailwind's `border-current` writes. Both follow the text color
when it changes. A `border-width` with no color anywhere is drawn black, native's default, and the
web host draws it black too.

A custom property can hold a font stack (read as its first family, as `font-family` is), a
unitless line-height, a ratio for `aspect-ratio`, a whole `box-shadow` list, or bare color
channels for `rgba(var(--channels), <alpha>)`, which is how Bootstrap writes its color utilities.
A shorthand may mix `var()`s and written values: `padding: var(--y) var(--x)`,
`border: var(--width) solid var(--colour)`. `flex: var(--grow)` is `flex: <number>`: it grows by
the token, shrinks by 1, and starts from a basis of 0, once the token is set. With no token it is
`flex`'s initial value, `0 1 auto`, whatever a weaker rule set, as on the web, where a `var()` that
cannot be substituted gives the property its initial value; `flex-grow`, `flex-shrink` and
`flex-basis` take theirs the same way. Yoga's own shrink is 0, so this is the one place an unset
token writes something rather than nothing.

A length needs a unit, as in a browser: `margin-top: 3` is dropped with a warning, and so is a
token holding a bare number where a length is read. `0` needs none, a bare number is a factor
inside `calc()`, and `line-height` takes a ratio. An `opacity` outside 0 to 1 is clamped into it,
and a `font-weight` outside 1 to 1000 is dropped.

`calc()` may add one viewport or font-relative length to absolute ones
(`calc(1.375rem + 1.5vw)`), which is settled on device. `min()`, `max()` and `clamp()` fold when
every argument is absolute. A `calc()` may have any number of tokens in it, with numbers and
absolute lengths, `+ - * /` and brackets: `calc((var(--end) - var(--start)) * 1px)` is worked
out on device, where a token that is a length counts in points and a bare number multiplies. A
percentage, an em or a viewport unit beside a token is dropped, since it needs layout the device
does not do there.

The keywords that switch a property off - `max-width: none`, `z-index: auto`,
`letter-spacing: normal`, `filter: none`, `box-shadow: none` - clear it back to native's default.
The CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`, `revert-layer`) are dropped, and
the warning says so.

Layout is Yoga's, which follows CSS flexbox with a few differences worth knowing. An absolutely
positioned child's percentage size is taken from the width its parent was offered, not the width
the parent shrinks to. A child at `width: 84%` inside a parent sized by `align-self: flex-start` is
84% of the space around the parent. Give a parent like that an explicit size, as a star rating's
row of fixed-width stars has.

Three more:

- A box whose margins are larger than its container is 0 high in Yoga, with its children
  overflowing it. A browser keeps the box as tall as its content.
- A percentage `min-height` is measured against the height of the box two levels up rather than the
  parent's: `min-height: 50%` in a 40-point box inside an 80-point one is 40 points, not 20.
- A percentage `gap` in a box with no fixed size along that axis grows the box by the gap. A
  browser resolves the percentage against the size the box ends up with.

Transitions, `animate.enter`/`animate.leave`, `@keyframes` and `animation` are their own page: see
[Animation](/packages/fabric/animation).

## What has nothing to map onto

These are dropped with a warning that says so, not declarations that quietly do nothing:

- `float`
- `grid` and its whole family
- `list-style`
- Table layout: `table-layout`, `border-collapse`, `caption-side`, `empty-cells`
- Multi-column layout
- `will-change`
- `contain`
- CSS counters
- `clip-path`

## What a warning says

Each warning names the file and line, the component, what was dropped and why, and the native
alternative where there is one:

```text
[angular-native] src/app/card.ts:12 (Card): dropped 'float': 'float' has no React Native equivalent: no style prop of a native view does what it does. Lay the row out with flexbox: flex-direction: row on the parent.
```

The rest of the rule still applies. A rule whose selector native cannot match is dropped whole,
with a warning that says `dropped a rule` and why.

A stylesheet lifted from a design system builds as it is, with a warning for each web-only
declaration in it. See [Metro](/packages/metro/configuration).
