---
title: Theming and Tailwind
summary: Tailwind and your own CSS on native views, through a real cascade, no className interop.
---

# Theming and Tailwind

Angular Native's cascade supports selectors, specificity, inheritance, media queries and custom
properties, so `<view class="flex-1 bg-blue-500 p-4">` matches through `class`, with no interop
layer or `className` prop.

## The build step

[`@ng-native/tailwind`](/packages/tailwind#setup) compiles Tailwind's output to the subset native
can express, and warns, naming the rule's selector, for what it drops; see [What the build step
does](/packages/tailwind#what-the-build-step-does). A theme variable the app sets itself stays a
`var()` (see [Tokens cross component boundaries](#tokens-cross-component-boundaries)).

## The preset

`@ng-native/tailwind` contains three files: `shared.css` for platform-independent styles, plus
`native.css` and `web.css`, which import it. They define the platform variants (`ios:`,
`android:`, `macos:`, `linux:`, `desktop:`, `web:`, `native:`) and what `hover:`, `press:`,
`focus-visible:` and `disabled:` match on each OS; [Variants](/packages/tailwind/variants) covers
each one.

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

A bound declaration reads a token too, where its whole value is the `var()`:
`[style.background-color]="'var(--color-brand)'"`, with a fallback if it needs one. It follows the
token as a stylesheet declaration does. A `var()` inside a longer value, a `calc()` included, is
not read from a binding: set a custom property and read that in the stylesheet.

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

## Reading a token from TypeScript

Some places take a colour as a value rather than as a style: a prop on a native view, a colour
passed to a library, a drawing that paints each series its own colour. `injectToken` from
`@ng-native/device` reads a custom property's value for them, so the stylesheet stays the one
place the palette is defined.

```ts
import { Component, signal } from '@angular/core';
import { Switch } from '@ng-native/components';
import { injectToken } from '@ng-native/device';

@Component({
  selector: 'app-setting',
  imports: [Switch],
  template: `<switch [(checked)]="on" [trackColor]="{ true: accent() }" />`,
})
export class Setting {
  protected readonly on = signal(false);
  protected readonly accent = injectToken('--accent');
}
```

It returns a signal of the value as text, `rgb(255, 0, 0)` or `12px`, with aliases, `color-mix()`
and fallbacks worked out as the stylesheet works them out. On iOS and Android it updates when the
colour scheme, another media condition or a stylesheet changes the token. A token holding
`platform-color()` reads as that text. The signal is `undefined` where nothing defines the token,
and where the token holds a value with no text form here: a shadow, a gradient or other background
layers, a filter, a transform, or bare colour channels such as `13, 110, 253`.

Without options it reads the token at the root, the scope of `:root` rules, and has a value from
the start. To read it where a class lower in the tree sets it again, pass a node:
`injectToken('--accent', { at: inject(ElementRef).nativeElement })`. On iOS and Android that value
arrives once the node has been committed, so the signal is `undefined` until then.

On the web it reads the browser's computed value, at the mount point or at the node, which keeps a
`color-mix()` as written. It updates when a class or inline style changes under the mount point or
a node is put in or taken out. The `dark` class `mount` keeps in step with the system is one such
class, so a `prefers-color-scheme` query is followed while `mount` keeps it. Other media queries,
and stylesheets added later, are not followed on the web.

An icon's own markup can take a colour from a token. In `<ng-icon [svg]="markup">`, where `markup`
holds `<path d="M0 0L5 5" fill="var(--series-1)"/>` or the same in `style`, the shape's `fill` or
`stroke` is resolved against the tokens in scope at the icon, as the same declaration in a
stylesheet is, with a `var()` fallback used when the token is unset.

## Unsupported values and font fallbacks

A unitless `line-height` value such as `calc(1.75 / 1.125)` inside a custom property leaves
`text-lg` empty until build-time substitution resolves it. Unsupported values produce line-numbered
diagnostics.

Font stacks are a silent exception. `--font-sans` is a list, but native `fontFamily` accepts one
name: `font-family: Inter, Helvetica, sans-serif` becomes `Inter`, discarding the rest without a
warning. Native has no fallback stack. If the first font is unavailable, text silently uses the
system font. `ui-monospace` and `monospace` are the platform's monospaced face, and `system-ui` its
system font.
Name and verify a bundled font.
