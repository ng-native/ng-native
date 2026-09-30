---
title: Tailwind
summary: A Tailwind v4 preset for native, plus the variants a touch device needs.
---

# Tailwind

`@ng-native/tailwind` lets you write `<view class="flex-1 bg-blue-500 p-4">` and have it work,
because [Fabric](/packages/fabric/css-engine) already has a real cascade - selectors, specificity,
inheritance, media queries, custom properties - and `class` already matches against it. Nothing
here is an interop layer translating `className` into style objects the way it would have to be on
plain React Native: Tailwind's generated CSS goes through the same build-time CSS compiler your own
component styles do, and the utility classes it produces are cascade rules like any other.

What this package adds is a build step that turns Tailwind's browser-flavored output into the
subset native can express, and a preset supplying the vocabulary Tailwind has no reason to ship on
its own: platform variants, safe-area and hairline utilities, and touch-appropriate meanings for
`hover:` and `focus-visible:`.

## Setup

```sh
npm install @ng-native/tailwind tailwindcss @tailwindcss/cli
```

```css
/* src/styles.css */
@import 'tailwindcss/theme.css';
@import 'tailwindcss/utilities.css';
@import '@ng-native/tailwind/native.css';
```

Import `theme.css` and `utilities.css` rather than the plain `tailwindcss` entry point, which would
also pull in preflight - a browser reset written in terms of `html`, `::before` and `-webkit-*`,
none of which means anything on a phone.

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withTailwind } = require('@ng-native/tailwind/config.cjs');

module.exports = withTailwind(withAngularNative(getDefaultConfig(__dirname)), {
  input: './src/styles.css',
});
```

`withTailwind` runs `@tailwindcss/cli` against `input` once, synchronously, so the generated module
exists before Metro resolves the first import. For a dev server it then leaves the CLI running in
watch mode, so a class written in a template appears without restarting the server. For a one-off
build (`expo export`, `expo export:embed`, `react-native bundle`, `expo prebuild`) and whenever the
`CI` environment variable is set, it does not watch, and nothing it starts keeps the process from
exiting when the build is done. `watch: true` or `watch: false` decides it either way. The
`output` option - `.angular-native/app.tailwind.js` by default - is a `.js`/`.cjs`/`.mjs` module
rather than CSS, because Expo's own transform worker claims every `.css` file before this package's
transform is asked and hands back an empty module on any platform but web. A `.d.ts` beside it
types the default export as the `StyleSheet` `globalStyles` takes. Both are rebuilt on every start,
so `.angular-native/` belongs in `.gitignore` - an app from the template ignores it already.

A fresh clone, or a CI job, has neither file until something loads the Metro config, so a
typecheck run first fails with `Cannot find module '../.angular-native/app.tailwind.js'`. Loading
the config builds them once and exits, without watching, so a typecheck script that does it first
always has them:

```json
"typecheck": "node metro.config.js && ngc -p tsconfig.json --noEmit"
```

```ts
// src/main.ts
import tailwind from '../.angular-native/app.tailwind.js';
import { mount } from '@ng-native/platform';

const app = mount(rootTag, App, fabric, { globalStyles: tailwind });
```

Pass the generated module as `globalStyles`, the one stylesheet Fabric matches against every node
regardless of which component created it - which is what a utility class needs, since a
`class="p-4"` can land on any element in the app.

## What the build step does

Tailwind 4 emits CSS aimed at a browser: cascade layers, `@property` declarations, `oklch()`
colors, and a spacing scale expressed with `calc()`. None of that is a cascade question - it never
depends on what element it lands on - so it is all resolved once at build time, before the result
ever reaches the same CSS compiler your own component styles go through. Whatever is left that
native genuinely cannot express is reported on the line it was found:

```
[angular-native] app.tailwind.css:153: dropped 'appearance': 'appearance' is not mapped yet.
```

That is deliberate, not a rough edge - see [what CSS reaches a
device](/packages/fabric/supported-css) for the full shape of what this compiles to and what it
drops.

Tailwind's `truncate`, `line-clamp-*`, `line-clamp-none`, `whitespace-nowrap` and `text-ellipsis`
become a text's `numberOfLines` and `ellipsizeMode`, which is how native truncates, so put them on
the `<text>` rather than on a view around it. `tabular-nums` and the other numeric variants become
`fontVariant`.

The filter utilities follow the platform table on that page: `brightness-*` works on both platforms,
and `blur-*`, `grayscale`, `hue-rotate-*`, `drop-shadow-*` and the rest are drawn on Android only,
so unscoped they are dropped with a warning. Write them as `android:grayscale` to keep them for
Android. `skew-x-*` and `skew-y-*` are the other way round: React Native on Android leaves `skewX()`
out and turns `skewY()` into a rotation, so unscoped they are dropped with a warning too. Write them
as `ios:skew-x-3` to keep them for iOS.

Utilities that build one value out of several classes combine on an element as they do on the web:
`translate-x-2 translate-y-4` moves along both axes, `shadow-lg ring-2 ring-blue-500` draws the ring
beside the shadow, `shadow-red-500` colors the shadow, and `brightness-50 android:grayscale` draws
both filters on Android. `text-shadow-red-500` and `android:drop-shadow-red-500` color a text shadow
and a drop shadow the same way, and `tabular-nums oldstyle-nums` keeps both numeric variants. A ring
with no color class is drawn in the element's text color, as `currentcolor` is on the web;
`ring-inset` insets it, and `ring-offset-2 ring-offset-white` draws the offset in its color with the
ring beyond it.

`space-x-*`, `space-y-*` and `divide-*` style every child but the last, with the same zero
specificity as on the web, so a child's own `me-*` or `border-*` class wins over them.
`space-x-reverse` and `divide-x-reverse` swap the side, for a `flex-row-reverse` parent. One
exception: a child's `mx-*` or `ml-*` does not win over `space-x-*`, because native lets a start or
end margin beat a left or right one whatever the cascade says (see [what CSS reaches a
device](/packages/fabric/supported-css)). Use `ms-*` and `me-*` on those children. `divide-double`
is dropped with a warning, as a native border has no double style.

Variants and utilities that style a pseudo-element, `placeholder:`, `before:`, `file:` and the rest,
style nothing: native has no element for a pseudo-element to be. A rule that is only for one is
refused with a build warning; where a pseudo-element shares a selector list with real elements, as
in Tailwind's own resets, it is taken out of the list and the rest of the rule is kept.

A unitless `line-height`, the ratio form CSS defines and the one Tailwind's `leading-*` utilities
write, works with or without a `font-size` beside it. When the rule also sets a `font-size`, as
every type-scale utility does, the build multiplies the two. Otherwise it is settled on device
against the font size the element ends up with, the way an `em` is. One difference from the web: a
descendant with a font size of its own inherits the resulting number of points, where a browser
would apply the ratio to the descendant's size, so set `leading-*` on the text it is for.

[Variants](/packages/tailwind/variants) covers the platform, dark-mode, `hover:` and
`focus-visible:` variants the preset adds and why native gives them different meanings than the
web. [Safe area and hairlines](/packages/tailwind/utilities) covers the two utility families this
package adds that Tailwind has no reason to ship on its own.

## Tailwind 3

An app on Tailwind 3.4.1 or later uses the same package on native. Tailwind 3 takes its preset
from `tailwind.config.js` rather than from a stylesheet, so the preset is `preset.cjs`:

```sh
npm install @ng-native/tailwind tailwindcss@3
```

```js
// tailwind.config.js
module.exports = {
  presets: [require('@ng-native/tailwind/preset.cjs')],
  content: ['./src/**/*.{ts,html}'],
};
```

```css
/* src/styles.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

A `tailwind.config.ts` imports the preset the same way, as
`import nativePreset from '@ng-native/tailwind/preset.cjs'`: the package ships its type
declarations.

`metro.config.js` and `main.ts` are the same as above. `withTailwind` reads the app's
`tailwindcss` version and runs Tailwind 3's own CLI, which ships inside `tailwindcss`, so there is
no `@tailwindcss/cli` to install.

The preset turns preflight off, so `@tailwind base` brings only the reset that gives each `--tw-*`
property its default on every element. That reset is what lets utilities combine: `transform
rotate-45 translate-x-2`, `shadow ring-2 ring-offset-2`, `bg-blue-500 bg-opacity-50`,
`android:blur android:grayscale` and `bg-gradient-to-r from-rose-500 via-white to-blue-500` are
settled per element on the device, the way a browser settles them, rather than once for the whole
sheet at build time. It supplies the same variants and utilities as `native.css`: the platform
variants, `dark:` following a `.dark` class, the touch meanings of `hover:` and `focus-visible:`
(for `group-*:` and `peer-*:` as well), and the safe-area and hairline utilities.

Every Tailwind 3 utility is held to the same sweep as Tailwind 4's, and what it draws is compared
with Chrome. Each one takes effect or is refused with a build warning, except a few that only set a
value another utility reads, where that utility is the one refused: `snap-mandatory` and
`snap-proximity`, read by `snap-x` and `snap-y`, and `placeholder-opacity-*`, read by a
`placeholder-*` colour. Those do nothing, as the utility they feed does nothing.

The web host is Tailwind 4 only.
