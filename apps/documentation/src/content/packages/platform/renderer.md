---
title: The renderer
summary: What NativeRendererFactory and NativeRenderer do with a component once it exists.
---

# The renderer

`NativeRendererFactory` hands Angular a `Renderer2` per component type, bound to that component's
compiled stylesheet, so a component's elements match only its own rules (a component with
`ViewEncapsulation.None` adds its sheet as a global one). See [Fabric's CSS
engine](/packages/fabric/css-engine) for how rules match.

## Styles and events

- **Style bindings work as on the web.** `[style.font-size]`, `[style.width.px]` and a static
  `style="flex: 1"` attribute all reach the native view. A `flex` of several values, a keyword or a
  basis (`flex: 1 1 auto`, `flex: none`, `flex: 30%`) is committed as `flexGrow`, `flexShrink` and
  `flexBasis`; one number, `flex: 1`, stays React Native's own `flex`.
- **Events map by name.** `(touchEnd)` binds Fabric's `topTouchEnd`. `(press)` is not a native
  event: on a `<pressable>` it binds the `Pressable` directive's `output()`.

## Change detection

Change detection is zoneless. The tree is committed to native once at the end of each render pass,
and also for changes Angular's scheduler does not see: `:focus` and `:active`, a CSS transition
frame (see [Animation](/packages/fabric/animation)), `animate.enter` / `animate.leave` classes and
an `[animatedStyle]` frame.

A component that calls `inject(ChangeDetectorRef).detach()` in its constructor still gets working
host primitives before its first `detectChanges()`: static inputs such as `(press)`, `testID`, the
accessibility props and `numberOfLines` are on the native view. Bound values and interpolated text
wait for the first `detectChanges()`.

## `@defer` triggers

Every `@defer` trigger works. `on idle`, `on immediate`, `on timer`, `when` and `prefetch` behave as
they do in a browser. The three triggers Angular registers on an element rather than through
`Renderer2` mean the following here:

| Trigger                    | Fires when                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `on interaction` / `(ref)` | A touch lifts on the trigger or anything inside it, or the trigger takes focus (a keyboard or a screen reader reaching it).                      |
| `on hover` / `(ref)`       | A pointer enters the trigger, which takes [pointer events](#pointer-events) and a trackpad, a mouse or a pencil, or the trigger takes focus.     |
| `on viewport` / `(ref)`    | Any part of the trigger is inside the window and inside every scroll view around it, checked as it is laid out and as those scroll views scroll. |

Without a pointer `on hover` waits for focus alone, and a finger does not count as one; in
development the first `on hover` in an app logs a warning saying so. Pair it with another trigger,
such as `on hover; on interaction`. `on viewport` honors a `threshold` option; `rootMargin` is not
applied, and the root is always the window.

### Pointer events

React Native's W3C pointer events are off by default on iOS and Android, so `Pressable.hovered` and
`@defer (on hover)` hear nothing from a trackpad, a mouse or a pencil until an app turns them on
with the config plugin in `@ng-native/expo`:

```json
{
  "expo": {
    "plugins": [["@ng-native/expo", { "pointerEvents": true }]]
  }
}
```

The option is read as the app launches, so it takes `npx expo prebuild` and a new development build,
and has no effect in Expo Go. It also sets `UIApplicationSupportsIndirectInputEvents` in Info.plist,
without which iOS 16 presents a trackpad or a mouse as a finger, and takes that key away with the
option if it added it. It turns on the whole of React
Native's pointer handling for the app: every touch goes through it too. A finger's pointer events
do not set `hovered` or fire `on hover`.

```html
<pressable #more><text>Show reviews</text></pressable>
@defer (on interaction(more)) {
<app-reviews />
} @placeholder {
<text>Reviews</text>
}
```

## Extending the renderer

`extendRenderer(extension)` from `@ng-native/platform`, and `extendNodes(members)` and
`registerViewName()` from `@ng-native/fabric`, let a package change how templates render for every
app in the process. They exist for compatibility layers such as
[`@ng-native/web-compat`](/packages/web-compat); an app does not need them. An extension can answer
for an element name in a namespace (`named`), take over a listener (`listen`), an attribute
(`set`) or a bound style (`style`), and hear of nodes created, inserted and removed. Each function
returns a function that takes the extension away again.

## Reading commit stats

`engine.stats` tracks commit counts and timings - worst commit, worst render span, slow-commit
count against an 8ms frame budget - which is useful when a screen feels janky and you want to know
whether the time went into the renderer or into change detection around it. Grab it off the
`engine` `mount()` returns, or by injecting `Engine` in a component.
