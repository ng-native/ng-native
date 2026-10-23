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
and `:not()`, of compounds or of any selector, `:is(.a + .b)` and `:not(.list > *)` among them,
each as specific as in a browser. `:is()` and `:where()` read three forms Tailwind writes as a test
of one compound: `<compound> *`, the ancestor test its `group-*` variants compile to,
`<compound> > *`, the parent test its `*:` variant compiles to, and `<compound> ~ *` or
`<compound> + *`, the sibling test its `peer-*` variants compile to, which is read as the sibling
combinator it means. `:host`
and `:host(<compound>)`. `:host-context(<compound>)`. `:first-child`, `:last-child`, `:only-child`,
`:nth-child()` and `:nth-last-child()` (the `of <selector>` form is not supported).
`:first-of-type`, `:last-of-type`, `:only-of-type`, `:nth-of-type()` and `:nth-last-of-type()`,
which count the siblings with the element's own name. `:empty`.
`:root`. `:disabled` (answered from the element's own `disabled` prop). `:focus` and `:active`,
which the engine tracks itself from native focus, blur and press events. Every combinator CSS has
works too: descendant (` `), child (`>`), next-sibling (`+`) and later-sibling (`~`).

`::ng-deep` is read where something is written before it: `:host ::ng-deep .inner` and
`.panel ::ng-deep .inner` style `.inner` anywhere under that host, or under that element of the
component, in the views of the components it holds as well. Written first, with nothing before
it, it is a rule for the whole app in a component's sheet, and is dropped with a warning: put
such a rule in the global sheet.

`html` means the top of the tree, exactly as `:root` does: there is no element called `html` on
native, and a stylesheet written for the web puts its tokens there.

## Selectors that are dropped

A rule with one of these selectors is dropped with a warning.

In an app's own sheet, `::before`, `::after` and every other pseudo-element are unsupported, not a
"not yet". Rendering one would mean synthesizing a node no template declared, which would make the
style engine responsible for view hierarchy a template never wrote - so the fix, when a design
wants one, is to write the element. A
[sheet read as a browser reads it](#a-sheet-read-as-a-browser-reads-it), for components written for
one, is the exception for `::before` and `::after`.

`::placeholder` is the exception, because it needs no node: a text input draws its own placeholder,
and its `placeholderTextColor` is the colour. `.field::placeholder { color: #8b8b96 }`, or
Tailwind's `placeholder:text-gray-400`, sets that colour on a `<text-input>`, a token in it
included, and on an element named `input` or `textarea` where an app or a package has registered one
as a text field. An `opacity` in the rule fades that colour, since native has no opacity for a
placeholder: `opacity: 0` hides it and `opacity: 1` leaves the colour as it is. With no colour in
the rule the placeholder is the platform's default, and with `platform-color()` it is the platform's
to work out: `opacity: 0` hides either and any other value leaves it alone. A placeholder takes only
a colour and an opacity, so anything else in the rule is dropped with a warning, and the rule
matches those three elements only, as a browser's matches an input.

`:hover` and `:focus-visible` are also unsupported, because there is no hover or focus cascade to
answer them from: a phone has no pointer to hover with, and focus arriving from a keyboard or an
assistive technology looks identical to focus arriving any other way. Use `:active` and `:focus`,
which the engine does track, or drive the state with a bound attribute such as `[attr.data-hover]`.
The `hover:` and `focus-visible:` variants in [`@ng-native/tailwind`](/packages/tailwind/variants)
already point at them for you.

`:checked`, `:indeterminate`, `:valid`, `:invalid`, `:placeholder-shown` and the other form-state
pseudo-classes are unsupported too: a native control keeps that state in its component's inputs,
where no selector can see it. Bind an attribute from the same signal (`[attr.data-checked]`) and
select on that. A [sheet read as a browser reads it](#a-sheet-read-as-a-browser-reads-it) reads
`:checked`, `:indeterminate` and `:enabled` from the element's own props.

`:has()` styles a node by what is beneath it, or after it. Its argument is any relative
selector: a descendant (`.card:has(.action)`), a child (`.card:has(> img)`), a longer selector
(`.card:has(.row > .badge)`), or what follows the node (`.label:has(+ .input)`,
`.item:has(~ .panel .mark)`), and a list of any of these. It is read on the node the rule styles,
on a box that node is in, and on one before either: `.card:has(.action) .title` styles the titles
in a card that has an action, `.field:has(.input:focus) > .label` a field's own label, and
`.card:has(.action) + .title` the title after such a card. A `:has()` inside another
(`:has(.a:has(.b))`) is dropped with a warning, as a browser drops it as invalid. Tailwind's
`has-[...]`, `has-data-[...]`, `group-has-*` and `peer-has-*` variants are supported.

A sheet that uses `:has()` has the engine match a changed node's ancestors again on each change,
and restyle one only where the rules it matches came out different. Where a rule asks it of a box
the styled node is in, the nodes under that box that such a rule is for are matched again too,
once for a commit, and where it asks what follows a node, the elements before a change are
matched again too. A sheet that does not use it costs nothing.

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
can be a token too (`at var(--x) 30%`), with a fallback after its name. `background-image` takes
gradients only - a `url()` in `background-image` is dropped, because there is no image loader
behind that prop; put an image in an `<image>` element instead.

The `background` shorthand takes the same gradients, one or several, with a position, size,
repeat and color beside them: `background: linear-gradient(red, blue) center / cover no-repeat`.
What it leaves out is back at its initial value, as in a browser: `background: red` takes away a
gradient an earlier rule gave, and `background: linear-gradient(red, blue)` a color. A shorthand
that is a token, `background: var(--surface)`, is the exception described below.

`background-clip: text` is not a value any native view takes. It marks its rule as one for
[`<gradient-text>`](/packages/components/text#gradient-text), the element that draws a background
through its letters: the rule applies to that element alone, and one written for another element
is dropped with a warning. The other values of `background-clip` are dropped.

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
a list. `none` switches either off, over a weaker rule's shadow or, for a `text-shadow`, an
inherited one. On iOS a `text-shadow` is drawn inside the text's own box, so a blur or offset that
reaches past it is cut off square; give the text padding as deep as the shadow. A `box-shadow` can
have tokens in it as design systems write them: a color that is a `var()`, a `color-mix()`, a
relative color, `rgba(var(--channels), 0.25)` or an `hsl()` of tokens; a length that is a `var()` or
`calc()` around one (`0 0 0 var(--ring-width)`); and a whole shadow that is a token, in a list with
others, with the shadows after its name as the fallback. A shadow whose lengths are all one token is
the exception, since a token is read in one form: write its lengths out, or put the whole shadow in
the token. A shadow token can have a token in its color too, `--ring: 0 0 0 2px var(--ring-color,
currentcolor)`, filled in where it is used. `currentcolor` as the fallback of a shadow's color is
the element's `color`, or the one it inherits, or black. A `text-shadow` takes tokens the same way,
in its color and its lengths.

Truncation is a paragraph's props on native, not a style, and CSS's three ways of asking for it
compile to them: `white-space: nowrap` to `numberOfLines: 1`, `line-clamp` or `-webkit-line-clamp`
to that many lines, and `text-overflow` to `ellipsizeMode` (`ellipsis` is `tail`, the default, and
`clip` is drawn on iOS only). `line-clamp: none`, `unset` and `white-space: normal` clear the limit.
Text that is one word, with no space or hyphen to break at, is one line whatever its box, cut at
the edge where no `text-overflow` says otherwise: a browser does not break a word inside, and
native breaks one between any two letters. A `line-clamp` or a `[numberOfLines]` of its own wins.
They apply to the `<text>` the rule matches, where the props are read: on a `<view>` around the
text they do nothing, so put the class on the text itself. `display: -webkit-box` is read as the
flex box native already is, laid out along the axis `-webkit-box-orient` names, so the whole
line-clamp idiom compiles; `-webkit-box-orient` without it is ignored, as a browser ignores it. A
`[numberOfLines]` bound on the element wins over the stylesheet. The other `white-space` values,
which keep spaces and line breaks, are dropped. `font-variant-numeric` takes `tabular-nums`,
`proportional-nums`, `lining-nums` and `oldstyle-nums`, as `fontVariant`.

`display` takes `flex`, `none`, `contents`, the block containers `block`, `flow-root` and
`inline-block`, `inline-flex`, and `grid` and `inline-grid`. An element that is `display: none` has
no native view, nor has anything inside it: its views are made when it is displayed and go when it
is not, so what a view holds of its own, a scroll offset, is not kept across a spell of `display:
none`. To keep a view while it is out of sight, take it out of the flow and give it no opacity. Yoga
lays out flex boxes and nothing else, so a block container is committed as a flex column, which
stacks its children as a block does, and the engine settles what a column does differently before
layout:

- Adjoining vertical margins collapse, as CSS has them: between two children of a block, through
  an empty block, and between a block and its first or last child where the block is itself a
  child of a block and no padding or border separates them. A margin of `20px` above one of
  `10px` leaves 20, where a flex column leaves 30.
- The flex properties on a block container (`flex-direction`, `justify-content`, `align-items`,
  `gap`) and on the boxes in its flow (`flex`, `flex-grow`, `flex-shrink`, `flex-basis`,
  `align-self`) are ignored, as a browser ignores them. `justify-self` places a block of a set
  width along its line, and `margin: 0 auto` centres one.
- An `inline-block`, `inline-flex` or `inline-grid` box sits in a line. Where a block container
  holds nothing else in its flow, they are laid out in lines, a row that wraps, each on the baseline
  of its line. Among blocks, each run of them shares a line of its own, wrapping when it is full:
  each box as wide as its content, with margins that do not collapse. The engine commits a view
  around a run of two or more, which no element of the template stands for; a box that joins such a
  run or leaves it is created again natively, so a scroll position or a focus inside it is lost.
  `vertical-align` takes `top`, `middle` and `bottom` for a box on a line, and a length, how far
  over the baseline it sits.

A box in a line is as wide as its content, and that includes content Yoga would size from the
room on offer: a row with a percentage width, as a `w-full` header is, and cells that share a row
from a basis of nothing, as `flex-1` cells do. The engine commits such a box with those set aside,
reads its width back, and commits it at that width, which the percentage and the shares are then
of. It costs the box two more commits when something in it changes.

Only margins in points collapse. Beside a percentage margin in the same container every margin stays
as written, because a percentage is of a width nothing knows before layout. In a flex container or a
grid an inline-level box is an item like any other, as a browser has it. `.d-none` followed by
`.d-md-block` shows an element again at a breakpoint. `inline` is read as `flex`, because every
native view is a box, and a browser lays out a flex container's inline children as blocks.
`contents` is Yoga's own: the element draws no box of its own (no background, border or padding) and
its children are laid out as if they were its parent's. The table values are dropped. `display:
var(--d)` reads the token on device the same way, in a stylesheet or set on the element, and reads
the two-keyword form, `inline flex` or `block flow`, as the one-word value it stands for. A token of
any other value, such as a table value, unsets `display`, and the element is laid out as a flex
column. In development the engine logs a warning naming the token and its value, since the compiler
only sees the token's name. A written fallback is read the same way, `var(--d, inline flex)`
included. One native has no layout for, such as `var(--d, table)`, is dropped with a build warning,
and the token is still read where it is set.

### Grid

`display: grid` is laid out by the engine, since Yoga has no grid, and so is what an `inline-grid`
holds. It follows CSS Grid Level 1:

- `grid-template-columns` and `grid-template-rows` take lengths, percentages, `fr`, `auto`,
  `min-content`, `max-content`, `minmax()`, `fit-content()` and `repeat()`, with `auto-fill` and
  `auto-fit`, which repeat only tracks with a length on one side at least, as in a browser, and
  each a point wide at the least. `grid-auto-columns`, `grid-auto-rows` and `grid-auto-flow` size
  and fill the tracks the template does not name.
- `grid-column`, `grid-row`, their `-start` and `-end`, and `grid-area` place an item by line
  number, by `span`, or by name. An item with no placement takes the next free cell.
- A `position: absolute` child of a grid that is itself positioned is placed against the lines
  its `grid-column` and `grid-row` name: its insets are from the edges of that area and its
  percentages are of it. A side with no line, or `auto`, is the grid's padding edge. With no
  inset on an axis it sits at the start of the area, moved along it by its `justify-self` or
  `align-self`, or by the grid's `justify-items` or `align-items` where its own is `auto`.
- `grid-template-areas` names areas, which `grid-area: head` places an item in, and whose edges
  are the lines `head-start` and `head-end`. A track list names its own lines,
  `[content-start] 1fr [content-end]`, and `grid-column: content` is the two of them. A name
  given to several lines is counted: `col 2`.
- `gap`, `justify-content`, `align-content`, `justify-items`, `align-items`, `justify-self`,
  `align-self`, `place-items` and `place-self` space and align, `safe` included.

A grid needs to read sizes back from native to place its items: its own width, the width each
item's content wants, and each item's height at its column's width. It commits, reads, and
commits again, in the one task, so only the placed grid is drawn. That costs a few times what a
flex container costs, and a grid changed inside is laid out again. Some limits follow from it:

- A grid with no width of its own, and none from its container, is as wide as its tracks come
  to, up to the room it is in: a centred dialog whose content is a grid. Its items are measured
  at the width that room allows.
- The narrowest an item's content can be is read where a track asks for it, a `min-content` or
  `fit-content()` track or an item that is not stretched: its text is committed one word to a
  line, and the widest is that width. A script that breaks anywhere, or a hyphenated word, is
  measured as the whole word.
- Text written straight into a grid is not an item. Put it in a `<text>`.
- `subgrid`, the `grid` and `grid-template` shorthands, and a span counted in named lines,
  `span col 2`, are dropped with a warning.
- `align-items: baseline` and `align-self: baseline` line up the items that start in one row by
  their first baselines, read from native. `last baseline` is read as `start`, and an item that
  is itself a grid has its bottom edge for a baseline.
- An item with an `aspect-ratio` and no height is as tall as its width makes it, where an item
  without one is stretched over its row.

On a host with no layout to read, such as a test's fake Fabric, a grid is a flex column.

### Order

`order` moves a child of a flex container among its siblings, as in a browser: Tailwind's
`order-first`, `order-last` and `order-2`. Yoga has no such property, so the engine commits the
children in that order. A block lays its children out as written, whatever their `order`.

### Position

`position` takes `relative`, `absolute` and `static`, which Yoga lays out, and `fixed` and
`sticky`, which the engine does.

A `position: fixed` box is positioned against the page it is on: the screen of a native stack or
a modal it is inside, and otherwise the whole app. Its insets and percentage sizes are of the page,
wherever in the page it is written. It stays where it is written in every other way, so it draws
in the order it is written in and takes an ancestor's `opacity`, as in a browser. The engine reads
the page's place back from native to work its insets out, as it does a grid's sizes.

Where something between a fixed box and its page scrolls or clips, a scroll view or an
`overflow: hidden` box, the fixed box is committed under the page instead, so it neither scrolls
nor is clipped. There it draws over the page's other content, and an ancestor's `opacity` or
`transform` no longer reaches it; it is still styled by rules that match through its parent, its
events still bubble to its parent, and it is not shown while anything it is inside is
`display: none`. A transformed ancestor does not become what a fixed box is fixed to, as one does
in a browser.

Two things Yoga leaves undone for a `position: absolute` or `fixed` box are put right from its
laid-out size, read back from native as a grid's sizes are. `margin: auto` between two insets
takes the room left over, so `inset: 0; margin: auto` centres a box of a set size in its
container, and one `auto` margin pushes it to the far side. And a box with no `top` or `bottom` in
a block container sits under the sibling before it, where it would have been in the flow. In a
flex container such a box is placed by the container's alignment, as Yoga and a browser both do.

A `position: sticky` box is laid out where it is written, and moves with its scroll view once the
scroll passes it: `top` is how far from the scroll view's top edge it sticks, and it goes no
further than the end of its parent. In a horizontal scroll view `left` does the same. It sticks
at any depth inside the scroll view, and native moves it on each frame the scroll view moves.
Sticking to the bottom or the right edge is not supported, and neither is a box with a
`transform` of its own that also sticks, whose transform the engine writes. It needs layout read
back from native, so on a host with none it stays where it is written.

`width: fit-content` and `height: fit-content` keep a box at the size of its content. Along its
container's main axis a box is that size already. Across it, where a box stretches, it stops
stretching and sits at the start, as in a browser, unless the container's `align-items` or its own
`align-self` already places it. `max-content` is read as `fit-content` on a width or a height,
and on `max-width` or `max-height` caps a box that would fill its container at its content.
`min-content` is dropped with a warning, as is `fit-content` on `min-width`, `max-width`,
`min-height` and `max-height`.

`min-width: auto` and `min-height: auto` keep a flex item that shrinks from shrinking under its
content, as a browser keeps every flex item: Tailwind's `min-w-auto` and `min-h-auto`. Yoga's
minimum is nothing, so the engine stops the item shrinking where its content cannot get smaller:
down a column, and along a row when no text in it has a space to wrap at. An item holding text
that wraps still shrinks, under its longest word if the row is that crowded, and so does one with
a `width`, a `flex-basis`, a `flex` or an `aspect-ratio` of its own. An item with `overflow` other
than `visible` shrinks as it does in a browser. A native view has no minimum unless it is given
one, so nothing changes for an item that does not say `auto`.

`overflow` is one value for both axes - Yoga has no separate `overflow-x`/`overflow-y` - so a rule
that gives them different values is dropped with a warning rather than silently picking one, and
so is `overflow-x` or `overflow-y` on its own, outside a
[sheet read as a browser reads it](#a-sheet-read-as-a-browser-reads-it).
`overflow: auto` is read as `scroll`, which is how Yoga lays out a scroll container, and `clip` as
`hidden`. `cursor` takes `auto` and `pointer`, the two a pointer on an iPad draws, with `default`
read as `auto`; any other cursor is dropped with a warning. So is a `mix-blend-mode` native does not
draw, `plus-darker`, and a `text-decoration-line` of `overline`, which native has no line for. A
text decoration is drawn under the text inside the element that declares it, in that element's
`text-decoration-color` or its text colour, as on the web. Android draws every line in the colour
of the text it underlines, because its text has no decoration colour.

`pointer-events` is inherited, as on the web, and `none` is about the element alone: it and whatever
inherits the value take no touches, and a descendant that sets `pointer-events: auto` takes them
again. An element with such a descendant is committed as React Native's `box-none`, and one with
none as `none`. React Native's own `box-none` and `box-only` are taken as written and are not
inherited. `pointer-events: inherit` and `unset` are the parent's value. The `pointerEvents` prop
keeps React Native's meaning, where `none` is the whole subtree. On Android, text and images take no
`pointerEvents` of their own, so text written directly inside a `box-none` element still takes
touches there; put it in a view to keep them off.

`touch-action` is read for a touch that starts on an element whose `touch-action` keeps a sideways
drag for itself (`none`, or `pan-y` with no `pan-x`), or on anything inside one. Until the finger
lifts it holds the screen's swipe back off, on iOS 26 and later, and keeps the drag from a
`<scroll-view>` the element is in: every drag with `none`, and one that sets off sideways with
`pan-y`. See [Screens](/packages/router/screens). No view is given it, and it does not decide which
view takes a touch. A keyword that stands alone (`auto`, `none`, `manipulation`) written beside
another is dropped with a warning. Tailwind's `touch-none`, `touch-auto` and `touch-manipulation`
are read; `touch-pan-x` and the other utilities Tailwind composes from tokens are dropped with a
warning.

The logical properties all work: `inset-inline`, `inset-block`, `margin-inline`, `margin-block`,
`padding-inline` and `padding-block`, with their `-start` and `-end` longhands, and the border
shorthands `border-inline`, `border-block` and their `-start` and `-end` sides, so Tailwind's
`inset-x-*`, `inset-y-*`, `mx-*`, `ps-*`, `start-*` and the rest do what they say. The block axis is
always top to bottom, since native has one writing mode. The inline axis follows the layout
direction: `-start` and `-end` are Yoga's start and end edges, which swap in a right-to-left
layout, and a pair written with one value (`inset-inline: 0`) is simply both sides. They compile
to the edges every native view reads, not to React Native's own `insetInlineStart` and
`marginBlock` spellings: those are aliases that some views, `<safe-area-view>` among them, never
apply, so a class on one did nothing. Where a start or end edge meets the physical one it lands on
(`inset-inline-start` and `left` on the same element, left to right), the later or stronger
declaration wins, as in a browser.

React Native's own axis shorthands, which a binding sets as `[style.paddingHorizontal]`, have a
spelling here too: `padding-horizontal`, `padding-vertical`, `margin-horizontal` and
`margin-vertical`. Each takes one value, and compiles exactly as `padding-inline`, `padding-block`,
`margin-inline` or `margin-block` with that value does: to both edges of its axis. So the cascade
settles it against the edges as it settles any shorthand, where React Native would always prefer
the edge: a later or stronger `padding-left` or `padding-inline-start` overrides it on that edge,
and it overrides an earlier or weaker one. A second value is dropped with a warning; write
`padding-inline` for a different value on each side. A browser has none of these properties, so
the [web host](/packages/web) ignores them: a sheet that also runs there writes `padding-inline`
and the rest.

`border-style` is likewise one value for all four sides: a native border has one style, so the sides
that are drawn are all drawn in it, and a second drawn style on one side is not one native can give
it. Which sides are drawn at all is per side: `none` on one side is supported. `border-top` and the
other per-side shorthands set that side's width and color, and take `solid` (native's default) or
`none` as their style. Any other style there, as in `border-top: 1px dashed red`, is drawn solid
with its width and color, and the build says so. A side styled `none`, by its shorthand or by
`border-right-style` and the other three, has no width whatever width another rule gives it, as CSS
computes it, until a rule styles that side again. A border with no color is drawn in the element's
text color, its own or inherited, as on the web: `border: 2px solid`, a `border-width` with no
`border-color`, and a side with a width that no rule gave a color. So is a border color of
`currentColor`, which is what Tailwind's `border-current` writes. Where no text color is set
either, the border is black. An outline with no
color, an `outline-color`, a `background-color` and a `text-decoration-color` of `currentColor`, a
`var()` that falls back to `currentColor` and a custom property that holds it take the text color
the same way, where they are used. `color: currentColor` and `color: inherit` are the color the
element inherits, as on the web, in a rule or in a `@keyframes` frame. All of them follow the text
color when it changes. A border shorthand's width may be a `calc()` of one token, as in Bootstrap's
`border-top: calc(var(--bs-border-width) * 2) solid`, and its color a `color-mix()` of a token, as
in `border: 1px solid color-mix(in srgb, var(--tint) 35%, transparent)`; with the token unset there
is no border, as on the web. `currentColor` as a side of such a mix, written or held by a token, is
the text color where the mix is used. A `border-width` with no color anywhere is drawn black,
native's default, and the web host draws it black too.

A custom property can hold a platform colour, `--accent: platform-color(link, "?attr/colorAccent")`,
or a system colour such as `LinkText`, in any sheet, in a `@media` rule such as
`prefers-color-scheme: dark`, or bound with `[style.--accent]`. `var(--accent)` in a colour
property (`color`, `background-color`, a border color, `outline-color`, `text-decoration-color`,
`tint-color`, `shadow-color` or a `text-shadow`'s color) commits what the colour written there
commits, and so does a `var()` that falls back to one. The platform resolves such a colour by name,
so it has no channels: a `color-mix()`, a relative colour, a gradient or a `box-shadow` worked out
of the token, or a fade of it such as Tailwind's `bg-accent/50`, is dropped. The build says so where
the sheet that sets the token also does that, and in development the engine says so on the device,
naming the token, wherever it is set.

A custom property can hold a font stack (read as its first family, as `font-family` is), a unitless
line-height, a ratio for `aspect-ratio`, a whole `box-shadow` list, or bare color channels for
`rgba(var(--channels), <alpha>)`, which is how Bootstrap writes its color utilities. A shorthand may
mix `var()`s and written values: `padding: var(--y) var(--x)`,
`border: var(--width) solid var(--colour)`. A token of two to four lengths gives a shorthand of
four sides or corners a value each, as a component library's design tokens do:
`padding: var(--list-padding)` of `--list-padding: 0.25rem 0.5rem`, and the same for `margin`,
`border-width` and `border-radius`. A part of such a token can be a token itself,
`--content-padding: 0 var(--modal-padding) var(--modal-padding)`, but not a `calc()`. Any other
length property is unset by such a token, `gap` and `padding-inline` among them.
`background: var(--surface)` is read as
`background-color`, the one part of that shorthand native has, and so are
`rgba(var(--channels), <alpha>)`, `color-mix()`, `light-dark()` and a relative colour of a token
written there. A token is read as one value, so one that is no colour unsets it: an unset token, a
length, `none`, and also a gradient, a `url()`, or a colour beside an image, `rgb(1 2 3) none`,
where a browser reads the token as the whole shorthand and paints the colour and the image. With
anything written beside the token, `background: var(--surface) none`, the shorthand is refused.
`flex: var(--grow)` is `flex: <number>`: it grows by the token, shrinks by 1, and starts from a
basis of 0, once the token is set. With no token it is `flex`'s initial value, `0 1 auto`, whatever
a weaker rule set, as on the web, where a `var()` that cannot be substituted gives the property its
initial value; `flex-grow`, `flex-shrink` and `flex-basis` take theirs the same way. Yoga's own
shrink is 0, so this is the one place an unset token writes something rather than nothing.

A `flex-basis` that is a length or a percentage is committed as the size it is along its
container's main axis: a `width` in a row and a `height` in a column, over one written for that
axis. React Native reads a `flexBasis` once for a view and not again when it changes, where a size
is read on every layout, and the two come to the same box. A basis of `0`, which `flex: 1` sets,
is committed as a basis, and so is `auto`.

A length needs a unit, as in a browser: `margin-top: 3` is dropped with a warning, and so is a
token holding a bare number where a length is read. `0` needs none, a bare number is a factor
inside `calc()`, and `line-height` takes a ratio, in the longhand, the `font` shorthand or a token,
which a descendant multiplies its own font size by, as on the web. An `opacity` outside 0 to 1 is
clamped into it, and a `font-weight` outside 1 to 1000 is dropped.

`calc()` may add one viewport or font-relative length to absolute ones
(`calc(1.375rem + 1.5vw)`), which is settled on device. `min()`, `max()` and `clamp()` fold when
every argument is absolute. A `calc()` may have any number of tokens in it, with numbers and
absolute lengths, `+ - * /` and brackets: `calc((var(--end) - var(--start)) * 1px)` is worked
out on device, where a token that is a length counts in points and a bare number multiplies. A
percentage, an em or a viewport unit beside a token is dropped, since it needs layout the device
does not do there, except a percentage added to a token for the properties below.

`calc()` may also add a length to a percentage, `calc(100% - 2rem)`, for a box's `width` and
`height`, their minimums and maximums, its insets, its margins and its padding: Tailwind's
`max-w-[calc(100%-2rem)]`. And for `translate`, where the percentage is of the box's own size:
`translate-x-[calc(100%-2px)]`, which is how a switch's thumb slides over. The length is in
points or rem, or a token, `calc(100% - var(--handle))`, which is settled where the box is and
follows the token changing. Yoga takes a number or a percentage
and not their sum, so the engine commits the box with the declaration set aside, reads the box
the percentage is of, and commits it at what the sum comes to, all in the one task. That is two
more commits when the box or anything in it changes, and one read on every commit after. A
percentage of a height is of a parent that was given a height; under an `auto` height the
declaration is set aside, as a browser sets it aside. In a grid item the percentage is of the
item's area. On a host with no layout to read the declaration is set aside too. Anywhere else,
`font-size` or `gap` say, the sum is dropped with a warning.

The keywords that switch a property off - `max-width: none`, `z-index: auto`,
`letter-spacing: normal`, `filter: none`, `box-shadow: none` - clear it back to native's default.
The CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`, `revert-layer`) are dropped, and
the warning says so, with two exceptions. `color: inherit` and `color: unset` are the color the
element inherits. And `inherit` is the parent's value for `border-radius` and its corners,
`width`, `height` and their minimums and maximums, `font` and the font properties,
`letter-spacing`, `text-align`, `text-transform`, `background-color` and `opacity`: the element
has none where its parent has none.

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

A box with a `z-index` above 0 is drawn over what follows the boxes it is in, as in a browser: a
menu written in one card opens over the next card. A native view is ordered among the views
beside it only, so each view the box is in is given its `z-index`, up to a view with a `z-index`
of its own or one that is not a plain view, a scroll view say. Two differences follow. A view
raised this way is drawn whole over what follows it, its background too, where a browser raises
the box alone. And `opacity` and `transform` do not stop a box being raised past them.

Transitions, `animate.enter`/`animate.leave`, `@keyframes` and `animation` are their own page: see
[Animation](/packages/fabric/animation).

`tint-color` is native's own, with no counterpart on the web: the color an image is drawn in, and
the color of an SF Symbol. It takes the values `color` takes: a token, `platform-color()`, a
relative color or a `color-mix()`, `light-dark()`, and `currentColor`, which is the element's text
color. `shadow-color` takes the same.

## A sheet read as a browser reads it

A sheet compiled for components written for a browser, as the Tailwind sheet is when its
[`browser` option](/packages/tailwind) is set, reads a few things an app's own sheet is told to
write another way:

- `::before` and `::after` are boxes of their own, as in a browser: the engine keeps a view first
  in the element for `::before` and last for `::after`, styled by the rules written for it,
  wherever a rule gives it a `content`. A string `content` is the text the box holds, and
  `content: ""` an empty box; `none`, no `content`, or an `attr()` or counter draws no box. The box
  is no child to a selector that counts children, `:first-child` or `:empty`. Any other
  pseudo-element is dropped with a warning, as in an app's own sheet.

- `visibility: hidden` (and `collapse`) draws the box with no opacity and takes no touch, and the
  box keeps its room. `visible` from a later rule shows it again. Unlike in a browser, a hidden box
  hides all that is in it: a box inside it with `visibility: visible` is not seen either, as the
  opacity of a view is the opacity of everything in it.
- `clip: rect()` with nothing in it, and `clip-path: inset(50%)`, draw nothing of the box over
  any rule that draws it - no background, shadow, border, outline or minimum size - and leave it
  there for a screen reader.
- `clip-path: polygon(a 0, b 0, b 100%, a 100%)`, a band of the box from side to side with `a` and
  `b` percentages, is kept for [`@ng-native/web-compat`](/packages/web-compat), which draws an
  `<img>` through the band: one picture over another, cut where a before-and-after slider is. No
  native view is sent it, and without that package nothing is drawn of it. A band with an edge
  that is a length or a token, and any other polygon, is dropped with a warning.
- Any other clip is dropped with a warning, as everywhere.
- `overflow-x` or `overflow-y` of `hidden` or `clip` clips both axes, since a view clips on both or
  on neither. `overflow-y: auto` or `scroll` is `overflow: scroll`, which also clips both axes: the
  box scrolls only where the element is a `<scroll-view>`, and a plain view does not. Any other
  value on one axis is no clip.
- `:checked` and `:indeterminate` match an element whose prop of that name is set, and `:enabled`
  one with no `disabled` prop.

## What has nothing to map onto

These are dropped with a warning that says so, not declarations that quietly do nothing:

- `float`
- `subgrid`, and the `grid` and `grid-template` shorthands
- `list-style`
- Table layout: `table-layout`, `border-collapse`, `caption-side`, `empty-cells`. A library's
  sheet read as a browser's keeps `table-layout`, for `@ng-native/web-compat`'s tables
- Multi-column layout
- `will-change`
- `contain`
- CSS counters
- `clip-path`, other than the shapes a sheet read as a browser reads it keeps, above

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
