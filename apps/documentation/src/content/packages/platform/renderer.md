---
title: The renderer
summary: What NativeRendererFactory and NativeRenderer do with a component once it exists.
---

# The renderer

## From a component definition to a stylesheet

`NativeRendererFactory` implements `RendererFactory2`. Angular calls `createRenderer(host, type)`
once per component type, and the factory looks up that component's compiled stylesheet
(`styleSheetOf(type.type)`, reading the `ɵnativeStyles` the Metro transform attached to the class)
and hands back a `Renderer2` bound to it. That binding is what makes emulated encapsulation work
here: a component's elements are matched only against its own compiled rules, because the renderer
that created them is the one holding that stylesheet. A component with
`ViewEncapsulation.None` is the exception: its sheet is registered with the engine as a global one
the first time it renders, and its elements get none. See [Fabric's CSS
engine](/packages/fabric/css-engine) for what those rules are matched against.

## What `Renderer2` calls become

`NativeRenderer` maps every `Renderer2` method onto the equivalent `Engine` call -
`createElement`, `appendChild`, `setProp`, `addClass`, and so on - with two translations worth
knowing about, because both fail silently if you write around them instead of through them:

- **Style values compiled for the DOM are converted back.** `[style.font-size]` arrives dash-cased
  and `[style.width.px]` arrives as the string `'10px'`; the renderer camel-cases the first and
  parses numeric strings back into numbers for the second, because Fabric wants `fontSize` and a
  plain `10`. A _static_ `style="flex: 1"` attribute - not a binding - arrives as one whole string
  through `setAttribute`, and gets the same treatment: without it, a static `style` attribute would
  hand Fabric a string where it expects an object, and it drops the whole thing.
- **Events map by name.** `(touchEnd)` becomes Fabric's `topTouchEnd`. There is no alias for
  `(press)`: `onPress` is not a native event, React Native's own `Pressable` synthesizes it from the
  touch responder system in JavaScript. `Pressable` in `@ng-native/components` does the same
  and exposes it as a directive `output()`, so `(press)` on a `<pressable>` binds to that output
  rather than an event on the renderer.

## Change detection is zoneless, and a commit has one point it happens at

There is no zone.js patching timers or touch events to know when to check the tree; Angular's
zoneless scheduler decides when to run change detection, and `NativeRendererFactory.end()` is the
one point tied to that schedule where the engine's retained tree is diffed and sent to Fabric in one
`completeRoot` call. `Engine` also commits on its own outside a render pass for state Angular's
scheduler has no way to know about - `:focus` and `:active` changing from a native event, or a
`[animatedStyle]`-bound element receiving a new JavaScript-driven animation frame from React
Native's own `Animated` graph - because none of those start as a change in a signal or a binding
that would make change detection run again on its own.

Two more things exist to reach frames outside a render pass, because plenty of real work happens
outside change detection on this platform:

- **CSS transitions** are not a binding - nothing in Angular's own state changes while one runs -
  so `end()` schedules a `requestAnimationFrame` loop (`pump`) for as long as the engine reports a
  transition or a pending removal, and each frame is its own commit. See
  [Animation](/packages/fabric/animation).
- **`animate.enter` / `animate.leave`** add and remove classes from Angular's own animation queue,
  which runs after a render pass. Without a commit scheduled for that, the class would sit on the
  node and never reach native. The engine reports the moment it goes from clean to dirty
  (`onDirty`), and the factory's `commitSoon` schedules a frame for exactly that case.

### A view detached before its first check

A component that calls `inject(ChangeDetectorRef).detach()` in its constructor, to drive its own
change detection, has its template's elements created but no update pass run in it until it calls
`detectChanges()`. A host primitive in it still works from creation, as a DOM element with a
listener and static attributes does on the web: before the commit that first mounts the element,
the host writes what its static inputs say, so `(press)` and the other press events fire, a text
can be pressed, and `testID`, `nativeID`, the role, the label and the rest of the accessibility
props, and a `<text>`'s own props such as `numberOfLines`, are all on the native view. A press
handler can then call `detectChanges()` to render the view.

What waits for that first `detectChanges()` is what any binding in the view waits for: bound
values, interpolated text, and the props a primitive publishes through its host bindings, such as a
`<text-input>`'s `placeholder` or a `<switch>`'s colors.

## `@defer` triggers

Every `@defer` trigger works. `on idle`, `on immediate`, `on timer`, `when` and `prefetch` behave as
they do in a browser. The three triggers Angular registers on an element rather than through
`Renderer2` mean the following here:

| Trigger                    | Fires when                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `on interaction` / `(ref)` | A touch lifts on the trigger or anything inside it, or the trigger takes focus (a keyboard or a screen reader reaching it).                      |
| `on hover` / `(ref)`       | A pointer enters the trigger, which takes a trackpad or a mouse on an iPad or an Android device, or the trigger takes focus.                     |
| `on viewport` / `(ref)`    | Any part of the trigger is inside the window and inside every scroll view around it, checked as it is laid out and as those scroll views scroll. |

A phone has no pointer, so there `on hover` waits for focus alone; in development the first
`on hover` in an app logs a warning saying so. Pair it with another trigger, such as
`on hover; on interaction`. `on viewport` honors a `threshold` option; `rootMargin` is not applied,
and the root is always the window.

```html
<pressable #more><text>Show reviews</text></pressable>
@defer (on interaction(more)) {
<app-reviews />
} @placeholder {
<text>Reviews</text>
}
```

## Extending the renderer

Three functions let a package other than `@ng-native/platform` and `@ng-native/fabric` change how a
template is rendered, for every app in the process. A compatibility layer for templates written for
another host is built on them, and none of them puts that host's API in the engine or the renderer.

**`extendRenderer(extension)`**, from `@ng-native/platform`, adds hooks the renderer calls. Each
is optional, and the extensions are asked in the order they were added:

- `named(name, namespace, engine)` answers the element a name stands for in a namespace: another
  name, or its own to keep it. Angular creates what is written inside an `<svg>` in the `svg`
  namespace, where a `<text>` is the drawing's text, not the app's. An element an extension
  answers for is a drawing to the engine, whose react-native-svg shapes are painted by a
  stylesheet as a browser paints them, and a type selector still matches it by the name it was
  written as. Answering nothing leaves the element the app's own. The engine is the one the
  element is created in, so an extension answers only for the apps that asked for it and leaves
  another app in the process alone. An icon's shapes are created by name alone, and render as
  they always have.
- `listen(target, eventName, callback, engine)` takes a listener over: it answers what removes the
  listener, or nothing to leave it to the renderer. The target is a node, or the name Angular gives
  a global one: `'window'`, `'document'` or `'body'`.
- `created(node, engine)` is told of each element a template creates, before it has attributes
  or children.
- `inserted(node, parent, engine)` is told each time a node is put under a parent, and
  `removed(node, engine)` each time the renderer takes one out.
- `set(node, name, value, engine)` takes an attribute or a property over, `null` for one being
  removed, and answers `true` once it has set the props the view reads.
- `style(node, name, value, engine)` takes a bound style over and answers the declarations it is
  set as, by the keys the view reads, each `null` to remove it.

An app with no extension added pays one length check for each of these calls.

**`extendNodes(members)`**, from `@ng-native/fabric`, gives every node the property descriptors
it is passed, a getter or a method, on the prototype the nodes share. The engine reads none of
them. A field the engine keeps on a node, such as `nodeKind` or `props`, is refused. A member a
node already has on that prototype, such as `classList`, is replaced and put back when the
extension is taken away, so what replaces it has to keep doing what Angular relied on. Two
extensions of the same member can be taken away in either order.

**`registerViewName()`** returns a function that takes the registration away again, so a package
can register names only for as long as it is in use. Two registrations of one name can be taken
away in either order: the newest still there names the element, and the original comes back after
the last.

Each returns a function that takes the extension away again, which is what a test calls when it
is done.

## Reading commit stats

`engine.stats` tracks commit counts and timings - worst commit, worst render span, slow-commit
count against an 8ms frame budget - which is useful when a screen feels janky and you want to know
whether the time went into the renderer or into change detection around it. Grab it off the
`engine` `mount()` returns, or by injecting `Engine` in a component.
