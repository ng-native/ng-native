---
title: Image
summary: <image>, sources at several scales, and alt text as the accessibility label.
art: image
---

# Image

`<image>` renders as a native image view - `RCTImageView` on both platforms. It accepts a
`source` object the way React Native does (a `require()`d asset, a `{ uri }` object, or several
for native to pick the best one) alongside the web spellings: `src` for a bare URI, `srcSet` for a
set of them at different scales.

```html
<image [src]="user.avatarUrl" [alt]="user.name" resizeMode="cover" class="h-12 w-12 rounded-full" />
```

## alt text

`alt` does two jobs: it is the accessibility label, and it is what makes the image an
accessibility element at all. An `<image>` with no `alt` is treated as decorative and left out of
the accessibility tree, the same as leaving `alt` off an `<img>` on the web.

## Sources and sizing

`source` takes a `require()`d asset (resolved at commit time), a `{ uri, width?, height?, scale?,
headers?, ... }` object, or a list of objects for native to choose from. `src` and `srcSet` are
parsed into the same source list - `srcSet="a.png 1x, a@2x.png 2x"` reads exactly as the HTML
attribute does. `crossOrigin` and `referrerPolicy` become request headers rather than native
props of their own. A `tintColor` set through `[style]` reaches native the same way an explicit
`tintColor` input does, because the engine flattens style into props.

A single source that knows its own width and height, a `require()`d asset or a `{ uri }` object
that gives both, sizes the image the way an `<img>`'s intrinsic size does: as the box it takes
only when nothing else sizes it. Any class, component stylesheet rule or `[style]` binding that
sets a width or height wins, so `class="size-11"` renders at 44 by 44 whatever the asset's pixel
size. Set only one dimension and the other follows the picture's proportions, through
`aspectRatio`, unless you set an `aspect-ratio` of your own. A list of sources, `src` or `srcSet`
gives no intrinsic size, and the image is sized by layout alone.

```html
<!-- 44 by 44, not the asset's 600 by 600 -->
<image [source]="art" class="size-11 rounded-md" />
<!-- 120 wide, and as tall as the picture's proportions make it -->
<image [source]="art" [style.width.px]="120" />
```

Insets do not size such an image. Placed with `position: absolute` and `top`, `right`, `bottom` and
`left` all 0, it keeps the picture's own size, drawn from the box's top-left corner, as an `<img>`
does in a browser and React Native's `Image` does with `StyleSheet.absoluteFill`. A picture larger
than the box spills past it, and one whose top-left corner is transparent can look as if nothing
drew. To fill the box, give the image a width and height of `100%` as well.

```css
.picture {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
```

`defaultSource` shows until `source` loads. Android also reads `loadingIndicatorSource`, an image
shown in place of the loading indicator, `resizeMethod` (how a large image is scaled down while
decoding) and `resizeMultiplier`. iOS reads `capInsets`, the edges of a stretchable image that
must not stretch. `resizeMode` (defaults to `cover`), `blurRadius` and `fadeDuration` (Android,
default 300ms) apply on both.

## Events

Events are element events, not outputs: `(load)`, `(error)`, `(loadStart)`, `(loadEnd)`,
`(progress)`.

<!-- api: Image -->

## Image background

`<image-background>` lays an image behind projected content. There is no native component for
this - it is a `<view>` with an absolutely positioned `<image>` filling it, which is what this
component builds, copying the outer style's width and height onto the image the way React Native's
own `ImageBackground` does. `imageStyle` styles the image itself, separately from the outer view
that `[style]` and projected content share.

```html
<image-background [source]="banner" resizeMode="cover" class="h-40 w-full">
  <text class="text-white">Featured</text>
</image-background>
```

<!-- api: ImageBackground -->
