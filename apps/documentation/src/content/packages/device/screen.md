---
title: Screen
summary: The window `Screen` tracks, the physical display, orientation and the `compact` breakpoint.
---

# Screen

`Screen` tracks the window your app can draw in, the physical display (larger than the window on
Android, where the system bars are separate), and the orientation, and it updates on rotation.

```ts
import { Component, inject } from '@angular/core';
import { Screen } from '@ng-native/device';

@Component({ selector: 'app-frame', template: `<text>{{ screen.window().width }}pt wide</text>` })
export class Frame {
  protected readonly screen = inject(Screen);
}
```

`window` is measured by the safe-area provider's own frame rather than read from `Dimensions`,
because on Android 15 an app draws edge to edge - behind the status bar and the navigation bar - and
`Dimensions` reports only the area between them. On a 1080x2400 phone it reports 838.5pt against a
drawable height of 914.3pt, so anything sizing itself from `Dimensions` is short by the bars.
`Dimensions` is only the fallback, for the one frame between the app mounting and
`<safe-area-provider>` laying out and calling `SafeArea.report()`; an app with no provider never
gets past that fallback, so it always gets what `Dimensions` reports. See the
[safe area](/packages/device/safe-area) page for `SafeArea` itself.

`display` is the physical screen, which on Android is larger than `window` because the system bars
are drawn outside it. `orientation` is derived from `window`, not `display`, so it follows the area
your app can actually draw in.

## The `compact` breakpoint

`compact` is whether the window is narrow enough to want the phone tree rather than the tablet one:

```ts
import { Component, inject } from '@angular/core';
import { Screen } from '@ng-native/device';

@Component({
  selector: 'app-shell',
  template: `
    @if (screen.compact()) {
      <app-tab-bar-layout />
    } @else {
      <app-sidebar-layout />
    }
  `,
})
export class Shell {
  protected readonly screen = inject(Screen);
}
```

`compact` is a decision about which _components_ to build, not which classes to apply, which is why
it is a signal rather than left to the cascade: a sidebar that is a permanent rail on an iPad and a
sheet on a phone is two different trees, and no amount of `md:` in a stylesheet can choose between
them. Where the difference really is only styling - a wider gutter, a bigger font - write `md:` and
let the engine's own media-query support answer it instead. `COMPACT_WIDTH` (768, Tailwind's `md`)
is exactly the number the cascade uses for that breakpoint, so the two agree. It sits close to, but
not exactly on, iOS's own compact/regular width class - an iPad mini in portrait is 744pt, which
Apple calls regular and `compact` calls compact - close enough to be the right default, and named so
an app that disagrees can say so.

## Off a device and on the web

Off a device `window` and `display` both report a zero-sized window, `orientation` reports
`portrait`, and `compact` reports `true` - nothing throws, and nothing waits on a platform that is
not going to answer. On the web the engine resolves `(orientation: landscape)`, `(min-width: …)`
and viewport units from the same values without anything being injected; reach for `Screen` only for
the decisions a stylesheet cannot make, such as which component tree to build.

## Reference

<!-- api: Screen -->
