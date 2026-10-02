---
title: Theming and Tailwind
summary: Tailwind and your own CSS on native views, through a real cascade, no className interop.
---

# Theming and Tailwind

React Native has no CSS engine: NativeWind compiles Tailwind into style objects, attaches them
through `cssInterop` and provides a variant runtime because native views do not understand
`className`. Angular Native's cascade already supports selectors, specificity, inheritance, media
queries and custom properties. `<view class="flex-1 bg-blue-500 p-4">` matches through `class`,
without an interop layer or `className` prop.

A build step converts web CSS to the native subset; a preset adds native-specific vocabulary.

## The build step

```css
@import 'tailwindcss/theme.css';
@import 'tailwindcss/utilities.css';
@import '@ng-native/tailwind/native.css';
```

Import `theme.css` and `utilities.css` instead of `tailwindcss` to exclude preflight's browser
reset (`html`, `::before`, `-webkit-*`). This documentation site imports preflight explicitly,
since its own chrome is a real document even though the components in it are not.

The compiler unwraps `@layer` and `@supports`, drops `@property`, substitutes static theme
variables, and folds `calc()` through lightningcss. A theme variable the app sets itself stays a
`var()` instead (see [Tokens cross component boundaries](#tokens-cross-component-boundaries)). For
example, `calc(var(--spacing) * 4)` is constant but cannot resolve on a device. The compiler
converts `oklch()` to sRGB as in component stylesheets.

Then the utilities compile:

```
p-4              -> { paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 }
gap-2            -> { gap: 8 }
h-16             -> { height: 64 }
rounded-lg       -> { borderTopLeftRadius: 8, ... }
bg-blue-500      -> { backgroundColor: 'rgb(43, 127, 255)' }
```

Unsupported styles produce diagnostics that name the rule's selector, which is what to search the
app for:

```
[angular-native] .appearance-none (Tailwind): dropped 'appearance': 'appearance' has no React Native equivalent: no style prop of a native view does what it does.
```

Diagnostics prevent unsupported styles from silently doing nothing.

## The preset

`@ng-native/tailwind` contains three files: `shared.css` for platform-independent styles, plus
`native.css` and `web.css`, which import it and define four platform-dependent variants.

### `hover:` is the pressed state

`:hover` is permanently unsupported by the native matcher and dropped with a build warning. The
`hover:` variant instead matches `:active`, which the engine sets on touched views and their
ancestors, letting hover classes express touch engagement.

`data-hover` supports iPad trackpads through React Native's W3C pointer events. Components must
listen for these events and set the attribute themselves. Phones never send them, so the variant
remains a press state.

```css
/* native.css */
@custom-variant hover (&:active, &[data-hover]);

/* web.css */
@custom-variant hover (&:hover, &:active, &[data-hover]);
```

The browser variant includes `:active` for touchscreen laptops and phone browsers, where `:hover`
may never fire or may stick after a tap. Use `press:` and `hovered:` to distinguish the states.

### `focus-visible:` is `focus:` on native

The web distinguishes keyboard focus from clicks to avoid unnecessary rings. On phones, focus
comes from keyboards, remotes or assistive technology, where rings are useful. Since
`:focus-visible` is also dropped with a build warning, the native variant aliases it to focus.

Both platforms also match `data-focus` so a wrapper can show its control's focus ring. The native
text field receives focus, while its wrapper owns the border, radius and padding; the control's
composed behavior informs the wrapper.

### `ios:`, `android:`, `web:`, `native:`

`mount` adds `platform-ios`, `platform-android` or `platform-web` to the root, enabling Tailwind's
platform variants. Variants for absent classes compile but never match, so shared classes such as
`ios:pt-2` are harmless on the web.

### `dark:` follows a class

Tailwind's default `dark:` uses `@media (prefers-color-scheme: dark)`, which the engine tracks.
A class also supports palettes such as `.dark { --background: ... }` and in-app overrides of the OS
theme.

`watchConditions(app.engine)` keeps the root's `dark` class in sync with the system. For an app
switcher, call `watchConditions(app.engine, { darkClass: false })` and control the class yourself;
otherwise a system-dark root overrides the switcher's light choice.

```html
<view [class]="theme.className()" style="flex: 1">…</view>
```

```ts
import { computed, inject, signal, Service } from '@angular/core';
import { ColorScheme } from '@ng-native/device';

type Preference = 'light' | 'dark' | 'system';

@Service()
export class Theme {
  private readonly system = inject(ColorScheme);
  private readonly preference = signal<Preference>('system');

  readonly className = computed(() => {
    const chosen = this.preference() === 'system' ? this.system.current() : this.preference();
    return chosen === 'dark' ? 'dark' : '';
  });

  choose(preference: Preference): void {
    this.preference.set(preference);
  }
}
```

The switcher calls `choose('light')`, `choose('dark')` or `choose('system')`.

To preserve the preference across launches, save and restore it through the app's settings storage.
The example does not persist it.

A class retheme covers the app's own CSS only. To switch everything, the native chrome too (headers,
switches, sheets, the keyboard), set the scheme on the window with `ColorScheme.set`:

```ts
inject(ColorScheme).set('dark'); // the whole app is dark, whatever the system says
inject(ColorScheme).set(null); // back to the system's
```

`prefers-color-scheme`, `light-dark()` and `ColorScheme.current` all follow it, so nothing
else has to know.

## Tokens cross component boundaries

CSS custom properties cascade down the node tree into child components. Ordinary rules match only
their component's nodes because sheets attach to component classes, providing emulated encapsulation
without per-element markers.

A parent can retheme child internals through `--primary`, but cannot select them directly.

This includes Tailwind's theme. An element that sets `--color-brand` or `--spacing` recolours or
respaces every utility inside it that reads that token, as on the web, however the token is set:
in a component stylesheet, a `style` attribute, a `[style.--color-brand]` binding or from code.

```html
<view [style.--color-brand]="accent()">
  <view class="bg-brand p-4"></view>
</view>
```

Every theme token is resolved on device, where it is read: colours, including the `color-mix()`
behind shadow colours and opacity modifiers, bare channels such as `--primary: 0 100% 50%` read
through `hsl(var(--primary))`, lengths and the spacing scale's `calc()`s and `max()`s, transition
durations and curves, `animate-*` animations, and the `blur-*` and `drop-shadow-*` filters. Where a
utility reads one in a form native cannot resolve on device, that declaration takes the theme
value at build time instead, and Metro prints a warning naming it.

A theme token defined as another, `--color-primary: var(--color-blue-500)`, is worked out where the
theme defines it, as on the web: setting `--color-blue-500` on an element does not change
`bg-primary` inside it. Set `--color-primary` itself to do that.

Resolving tokens on device costs little. Nodes that match the same rules under the same parent share
one resolved style, so a list of identical rows resolves its tokens once.

## Unsupported values and font fallbacks

A unitless `line-height` value such as `calc(1.75 / 1.125)` inside a custom property leaves
`text-lg` empty until build-time substitution resolves it. Unsupported values produce line-numbered
diagnostics.

Font stacks are a silent exception. `--font-sans` is a list, but native `fontFamily` accepts one
name: `font-family: Inter, Helvetica, sans-serif` becomes `Inter`, discarding the rest without a
warning. Native has no fallback stack. If the first font is unavailable or a CSS generic such as
`ui-monospace`, text silently uses the system font. Name and verify a bundled font.
