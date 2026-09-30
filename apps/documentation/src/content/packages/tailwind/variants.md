---
title: Variants
summary: Platform, dark-mode, hover and focus-visible variants, and what they mean on native.
---

# Variants

`@ng-native/tailwind` ships three stylesheets. `shared.css` holds the parts that do not depend
on the platform; `native.css` and `web.css` each import it and add their own answers for the
variants where a touchscreen and a browser genuinely disagree. Import `native.css` in an Expo app
and `web.css` in a browser build.

## Platform, disabled and dark variants

Tailwind cannot infer what platform it is running on, so the variants match a class on the root:
`platform-ios`, `platform-android` or `platform-web`. `mount` puts it there itself - on a phone
from `nativePlatform()`, and `platform-web` from `@ng-native/web`'s `mount` - so `ios:`,
`android:`, `web:` and `native:` (either native platform) work with nothing to set up. A variant
whose class is never present simply never matches rather than erroring - `ios:pt-2` in a shared
class string is not a mistake on a web page, it is just not an iPhone.

Variants stack: `android:dark:bg-zinc-950` applies on Android in dark mode, whether the two classes
sit on one ancestor, as they do on the root, or on two.

`disabled:` matches `[data-disabled]` as well as `:disabled`, because a control's `disabled` input
is consumed by the behavior composed onto it and never left as a prop `:disabled` could read;
`data-disabled` is what that behavior publishes instead.

`dark:` matches a `.dark` class. `watchConditions(app.engine)` - which the template's
`src/main.ts` already calls - keeps `dark` on the root in step with the system scheme, so `dark:`
follows the device with nothing to set up. An app with its own theme switch passes
`{ darkClass: false }` and puts `dark` on its own root view instead:

```ts
watchConditions(app.engine, { darkClass: false });
```

```html
<view [class]="theme()" style="flex: 1"></view>
```

The classes are the same with a Tailwind `prefix`: `platform-ios`, `platform-android`,
`platform-web` and `dark`, never `tw-dark`. Tailwind 4's `prefix()` leaves a variant's selector as
the preset wrote it. Tailwind 3 prefixes every class in one, and the build takes the prefix back off
these four, so `ios:tw-pt-2` and `dark:tw-bg-black` match the classes `mount` and `watchConditions`
set. An app that sets its own dark class sets `dark`.

Tailwind's own `dark:` is `@media (prefers-color-scheme: dark)`, which [the CSS
engine](/packages/fabric/css-engine) already answers and keeps in sync with the system. A class is
one step further: it lets a theme switcher disagree with the OS, which `prefers-color-scheme` on
its own cannot do.

This is also why a palette defined as custom properties keeps working. The build step inlines a
`var()` wherever it can, since there is no CSS parser on the device to resolve one later. A custom
property declared more than once with different values - `--primary` under `:root` and again under
`.dark`, which is exactly how a theme is written - is the exception: which declaration wins is a
question only the runtime cascade can answer, so those survive the build untouched and are resolved
per node. Define your tokens that way and the switch reaches them.

## `hover:` and `press:`

On native, `hover:` means the pressed state: `:hover` is dropped with a build warning there and
always will be - there is no pointer cascade to answer it - but a hover style and a press style ask
the same design question. The native preset points the variant at `:active` (set by the engine while a touch is
down) and also `data-hover`, for the one native device with a real pointer - an
iPad with a trackpad, which React Native's pointer events do report. `press:` and `hovered:` name
one half each, for a component that wants to be precise rather than portable.

On the web, `hover:` keeps the real `:hover` as well as `:active` and `data-hover`, so a class string written once
behaves the same on a desktop browser, a touchscreen laptop, and a phone browser without the
component knowing which it is on.

```css
/* native.css */
@custom-variant hover (&:active, &[data-hover]);

/* web.css */
@custom-variant hover (&:hover, &:active, &[data-hover]);
```

## `focus-visible:` and `focus:`

On native, `focus-visible:` is aliased straight to `focus:`, because the distinction it exists for
on the web - keeping a ring off a control someone clicked - has no case on a phone: focus only ever
arrives from a keyboard, a remote or an assistive technology, exactly the situations a ring is for.
`:focus-visible` is dropped with a build warning on native for the same reason `:hover` is. Both
platforms also match `[data-focus]`, because focus lands on the control itself while the border and padding that
form the ring usually sit on a wrapper around it, which can only know it is focused because the
behavior composed onto the control told it.

## `peer-*` and `group-*`

`group-*` variants match an ancestor with the `group` class, and `peer-*` variants match an earlier
sibling with the `peer` class, exactly as on the web. The state a variant reads has to be one the
engine can see on the peer: `peer-focus:` (focus, or `data-focus`), `peer-active:` and `peer-hover:`
(a press), `peer-disabled:` (a `disabled` prop, or the `data-disabled` a text input publishes),
`peer-data-[...]:`, `peer-aria-[...]:` on an attribute the peer really carries, and the arbitrary
`peer-[.is-on]:`. A class or a state arriving on the peer restyles the siblings after it.

```html
<text-input class="peer border-b-hairline" placeholder="Email" />
<text class="text-gray-500 peer-focus:text-green-600">We never share it</text>
```

`peer-checked:` and `group-checked:` are dropped at build time with a warning that says why: a
switch keeps whether it is checked in its component's `checked` input, where no selector can read
it. Publish it as an attribute and use the data variant instead:

```html
<switch class="peer" [(checked)]="on" [attr.data-checked]="on() ? '' : null" />
<text class="peer-data-checked:text-green-600">On</text>
```

## `font-mono`

Tailwind's `--font-mono` is a browser font stack starting `ui-monospace`, and native's `fontFamily`
takes a single name, not a fallback list - the compiler keeps only the first family from any stack,
silently. `ui-monospace` exists on neither iOS nor Android, so `font-mono` would silently fall back
to the system font everywhere without help. `native.css` gives `font-mono` `Courier New` (a real
font on both, so it means something even with no platform class on the root) and then upgrades it
per platform - Menlo on iOS, the `monospace` alias (Roboto Mono) on Android - once
`.platform-ios`/`.platform-android` is present. `web.css` does not need this: it does not import it,
and a browser resolves `ui-monospace` on its own.

An app's own monospace font replaces all of that, on every platform: `@theme { --font-mono:
'JetBrains Mono'; }` after the preset's import on Tailwind 4, or `fontFamily.mono` in the config or
a preset on Tailwind 3. The Tailwind 3 preset upgrades `font-mono` only while it is still
Tailwind's own `ui-monospace` stack.

The same silent first-family-only rule applies to any font stack you write yourself, Tailwind's or
not: give native a single, real family, the way `native.css` does for `font-mono`.
