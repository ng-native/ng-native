---
title: Color scheme
summary: Light or dark mode, as the user set it, for the decisions CSS cannot make.
---

# Color scheme

`ColorScheme` reports whether the user has the system in light or dark mode.

```ts
import { Component, computed, inject } from '@angular/core';
import { Image } from '@ng-native/components';
import { ColorScheme } from '@ng-native/device';

@Component({ selector: 'app-logo', imports: [Image], template: `<image [source]="logo()" />` })
export class Logo {
  private readonly scheme = inject(ColorScheme);
  protected readonly logo = computed(() =>
    this.scheme.current() === 'dark' ? require('./logo-dark.png') : require('./logo-light.png'),
  );
}
```

Styling should almost never touch this directly: `@media (prefers-color-scheme: dark)` and
Tailwind's `dark:` variant are resolved by the engine without anything being injected, and they are
the right tool for "this text is a different color in dark mode." `ColorScheme` is for the
decisions a stylesheet cannot make - which image asset to load, which of two distinct native
components to render, which status bar style to request.

## Overriding the system

`set()` puts the whole app in one scheme, whatever the system says. It is the call behind an in-app
theme switch: pass `'light'` or `'dark'` to force one, or `null` to follow the system again.

```ts
import { Component, inject, signal } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { ColorScheme, type Scheme } from '@ng-native/device';

@Component({
  selector: 'app-theme-toggle',
  imports: [Pressable, Text],
  template: `
    <pressable (press)="choose('light')"><text>Light</text></pressable>
    <pressable (press)="choose('dark')"><text>Dark</text></pressable>
    <pressable (press)="choose(null)"><text>System</text></pressable>
    <text>Showing {{ scheme.current() }}, chosen: {{ choice() ?? 'system' }}</text>
  `,
})
export class ThemeToggle {
  protected readonly scheme = inject(ColorScheme);
  protected readonly choice = signal<Scheme | null>(null);

  protected choose(scheme: Scheme | null): void {
    this.choice.set(scheme);
    this.scheme.set(scheme);
  }
}
```

On a device this calls React Native's `Appearance.setColorScheme`, with `null` sent as
`'unspecified'`. That changes the window's own appearance rather than a class on the root, so the
native chrome follows along with the app's CSS: `@media (prefers-color-scheme: dark)`,
`light-dark()` and the root's `dark` class from `watchConditions` all switch, and so does
`current()`.

A few things to know:

- `set()` does not write `current()` itself. `current()` changes when `Appearance` reports the new
  scheme, the same path a system change takes, so read it afterwards rather than assuming it
  updated synchronously.
- `current()` reports what the app is showing, not what the user chose. Once the app is forced
  into a scheme it no longer tells you what the system is set to, and it cannot tell "forced dark"
  from "following a dark system." Keep the choice in a signal of your own, as `choice` does above.
- Nothing is saved. The next launch follows the system until the app calls `set()` again, so store
  the choice (for example with [Storage](/packages/expo/storage)) and apply it at startup.
- If the installed React Native has no `Appearance.setColorScheme`, `set()` does nothing.

## Off a device and on the web

Off a device `current()` reports `light` and never changes, because there is no `Appearance` module
underneath it to ask - a platform's absence of a preference is treated as light, which is the same
rule React Native's own `null` result follows. On the web the engine answers
`prefers-color-scheme` itself, so an app rarely needs to inject `ColorScheme` there at all.

`set()` does nothing in either place: neither the off-device source nor the browser one can change
the scheme, so a web build's theme switch needs a class on the root instead, as
[theming](/guide/theming) describes.

## Reference

<!-- api: ColorScheme -->
