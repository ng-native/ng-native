---
title: Fabric
summary: The retained tree, native view mapping and CSS engine underneath every rendered screen.
---

# Fabric

`@ng-native/fabric` is the framework-agnostic engine everything else is built on. Nothing in
it imports `@angular/core` - that boundary is enforced by a lint rule, not just a comment - so it
is a retained tree of nodes, a commit step that turns changes into one call into Fabric, and a CSS
engine with a real cascade, running with no DOM anywhere near it.

You will not usually import from this package directly. [`@ng-native/platform`'s
`Renderer2`](/packages/platform/renderer) drives it, and `@ng-native/components` builds
elements on top of it. The exceptions are `nativePlatform()`, for a component that needs to answer
differently per platform, and `registerViewName()`, for wiring up a third-party Fabric component
that ships no Angular bindings of its own.

## From an element to a native view

Every element your template writes - `<view>`, `<text>`, `<scroll-view>`, `<pressable>` - is a node
in a retained tree, and an internal lookup decides what native component it commits as. A small
table maps the primitives `@ng-native/components` ships to Fabric's own component names:
`view` to `View`, `text` to `Paragraph`, `scroll-view` to `ScrollView`, `switch` to `Switch`, and so
on. `pressable` and `touchable-opacity` have no native component of their own and commit as a plain
`View`, since press handling is JavaScript on top either way.

An element name your app has not registered still renders, as a plain view: an Angular component
host element always exists in the tree - Angular creates one for `<x-card>` whether or not you
import anything - so an unmapped name cannot fail the way a missing DOM element would. The cost is
that a typo'd element name, or a Fabric primitive used without importing its component from
`@ng-native/components`, renders as an empty box instead of an error; in a dev build it logs a
console warning naming it. Element names must also be lowercase - a capitalized tag such as `<View>`
matches no component's selector, so it would be an unmapped name too.
[Metro](/packages/metro/configuration) catches that at build time and fails loudly instead.

A third-party Fabric component - `react-native-screens`, for instance - is added with
`registerViewName('rns-screen', 'RNSScreen')`, optionally with `defaultProps` for a native view
whose React wrapper normally supplies a base style in JavaScript (`ScrollView` and `Modal` both need
this, and it is already applied for you). A fourth argument says what else the engine needs to
know about the view: `textContent` names the prop a view reads its text from where it takes no
children, and `looseText` names the element that draws text written straight into the view where
that is not a paragraph, as an SVG text draws its words by a span.
`registerPlatformComponents(Platform.OS)` swaps in the
handful of Android-specific names (`Switch` to `AndroidSwitch`, `TextInput` to `AndroidTextInput`,
and so on) and is one of the lines [`mount()`'s own
example](/packages/platform/bootstrapping) calls before mounting.

## Commits

A commit clones the tree that changed and hands Fabric one `completeRoot` call; an unchanged
subtree is passed through by reference rather than rebuilt.
[`@ng-native/platform`](/packages/platform/renderer) calls `engine.commit()` exactly once per
change-detection pass, so under normal use you never call it yourself. `engine.stats` tracks commit
counts and timings, which is useful when a screen feels janky and you want to know whether the time
went into the renderer or into change detection around it.

## The CSS engine

Angular's `styles` and `styleUrl` are real CSS here, not dropped in silence the way they are
without `platform-browser`. The work splits across two very different halves: component
stylesheets are compiled to a rule set at build time, and matched against the tree at runtime by a
resolver with a real cascade - selectors, specificity, inheritance, custom properties and media
queries. [The CSS engine](/packages/fabric/css-engine) covers how that split works and what a node
actually gets matched against; [what CSS reaches a device](/packages/fabric/supported-css) is the
scannable reference for what selectors, properties and values compile and which do not;
[animation](/packages/fabric/animation) covers transitions, `animate.enter`/`animate.leave` and
`@keyframes`.
