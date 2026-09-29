---
title: Known limitations
summary: What the alpha does not do yet, and the workaround for each.
---

# Known limitations

Angular Native is an alpha. These known gaps have workarounds where available. See
[Angular Native compared](/guide/comparison#maturity) for the distinction between implemented and
verified features.

## There is no DOM

Native apps have no browser DOM: `document`, `window` and DOM APIs do not work.
`ElementRef.nativeElement` is a retained engine node, not an `HTMLElement`, also exposed by `NativeRef` in
`@ng-native/components` for native commands. `DomSanitizer` and `NgOptimizedImage` are unavailable;
use `<image>` from `@ng-native/components`, which loads assets through `resolveAssetSource`.
`mount()` provides a `DOCUMENT` stub only to prevent `TransferState` errors when creating a
`resource()`; see [Bootstrapping](/packages/platform/bootstrapping#what-is-in-the-injector). Do not
use it as a document. Element-based `@defer` triggers (`on interaction`, `on hover`, `on viewport`)
have native equivalents; see [The renderer](/packages/platform/renderer#defer-triggers).

**Workaround:** use `@ng-native/components` for elements, `Engine`/`HostEngine` for imperative
native commands, and `@ng-native/device` for capabilities browsers expose through `window` or
`navigator`.

## No `@angular/animations`

Angular's DI-based animation module has no native renderer. `animate.enter` and `animate.leave`
work through `Renderer2` and a shim defining `document`, `Node`, `AnimationEvent` and
`getComputedStyle` before `@angular/core` loads. For other animations, see
[Animation](/packages/components/animation) for `AnimatedStyle` and Reanimated worklets.

**Workaround:** `animate.enter`/`animate.leave` for mount/unmount transitions, `AnimatedStyle` or
Reanimated worklets (`WorkletStyle`, `WorkletScroll`) for anything driven by a gesture or computed
every frame. Both need the Metro preset's polyfills, which `withAngularNative` installs
automatically - see [Metro](/packages/metro).

## i18n is partial

Angular i18n translates at runtime using template `i18n`, TypeScript `$localize`,
`localize-extract` over the Metro bundle, and `loadTranslations()` before mount. See
[Localization](/guide/localization). The Metro preset's template compiler has two gaps:

- **Plurals and selects** (`{count, plural, =1 {one item} other {...}}`) throw
  `Unable to parse ICU expression` when the component first renders. The compiler drops the ICU's
  placeholders.
- **`i18n-` attributes** (`i18n-accessibilityLabel`) lose their source text: in the source language
  the attribute is empty, and so is the extracted message.

Loading a language after rendering does not update existing templates; switching language requires
an app reload. Metro has no build-time translation (`localize-translate`), and `ng extract-i18n`
cannot build native apps.

**Workaround:** the `i18nPlural` pipe with a `$localize` string per form for a plural, `@switch`
with an `i18n` message per case for a select, and a bound `$localize` string
(`[accessibilityLabel]="closeLabel"`) for an attribute. Install `@babel/core@^7` next to
`@angular/localize`, which depends on Babel 8: without it React Native's unranged Babel peer can
resolve to 8, and a worklets bundle then fails.

## Angular DevTools does not attach

Angular DevTools requires a browser DOM component tree, so it cannot attach on a device. Use
Hermes, React Native's debugger and the renderer's committed tree.

## No SSR or hydration

Neither native nor web supports server rendering or hydration. Native `mount()` targets a device's
Fabric UI manager; `@ng-native/web`'s `mount()` targets a real `document`. For prerendered pages,
build prose statically and mount live examples on the client.

## `HttpClient` needs `provideNativeHttpClient()`

Plain `provideHttpClient()` silently returns null bodies on a device. Angular 22's default
`fetch` backend reads only `response.body` streams, but React Native's `fetch` uses `whatwg-fetch`
over XHR, whose `Response` has no `body`. Use `provideNativeHttpClient()` from
`@ng-native/platform/http`: it configures `HttpClient` with `withXhr()` to use React Native's
complete native `XMLHttpRequest`, including upload progress. See
[HTTP requests](/packages/platform#http-requests) for the signature and an interceptor example.

**Workaround:** `provideNativeHttpClient(...features)` in `mount()`'s `providers`, never
`provideHttpClient()` on its own.

## Errors raised outside the engine's event dispatch

`Engine` claims Fabric's single event-handler slot in its constructor. React's event plugins never
receive Angular Native view events, so handler errors cannot crash a screen push. The engine
catches errors from Angular listeners, responder handlers and direct `Engine` listeners, passes
them to the app's `ErrorHandler`, and continues bubbling. Two cases remain outside this protection:
requiring `ReactFabric` after `mount()` lets React reclaim the slot, and native errors are not
JavaScript errors.

**Workaround:** if a crash report shows a native stack with no JavaScript frames, check whether
anything required `react-native/Libraries/Renderer` after mount.

## Section lists have no section separators

`<virtual-list>` supports separators (`<ng-template virtualListSeparator>`), sticky rows and a
sticky header. `<section-list>` covers `SectionList` but lacks `SectionSeparatorComponent`,
horizontal and inverted layouts, and viewability events. Separators lack `highlighted` state. A
`<section-list>`'s row heights are fixed and include separators, as with
`getItemLayout`; a `<virtual-list>`'s can be measured instead. A virtual list holds its position with
a `scrollTo` after the commit rather than inside the native mount, so a correction made mid-fling
lands where the last scroll event said the list was.

On Android, `<refresh-control>` becomes the scroll view's parent, as in React Native. The scroll
view's inline layout style moves with it; class-based layout stays on the inner scroll view.

**Workaround:** draw a section separator as part of the section's header or footer template.

## Hot reload has a few full-reload cases

Hot reload preserves state when replacing inline templates, `templateUrl`, inline styles or
`styleUrl`. Other component `.ts` changes (selectors, inputs, methods, imports) require a full
reload. External templates and stylesheets hot-swap in every component using them within the same
project, including `../` paths. Cross-package monorepo edits appear only after the component's own
file changes.

## No method shorthand inside decorator metadata

ES2015 method shorthand in decorator metadata, such as
`providers: [{ provide: X, useValue: { attach() {} } }]` or an equivalent `host` object, fails to
build. An `@oxc-angular/vite` bug, confirmed through 0.0.39, drops the implied
`function`/`async`/`get` keyword when re-emitting the object. The compiler reports no error, but
Angular Native catches the invalid JavaScript and reports the property and file, preventing a later
unexplained `SyntaxError`.

**Workaround:** write `useValue: { attach: function ()
{} } }` instead of `useValue: { attach() {} } }`. An arrow (`attach: () => {}`) also works if it
does not need its own `this`.

## No template arrow function that reads its own parameter

A template arrow that reads its parameter, such as `(press)="open.update((was) => !was)"`, compiles
as though the parameter were a component property and reads `undefined`. The compiler reports no
error. This `@oxc-angular/vite` bug is confirmed through 0.0.39; Angular Native catches it at build
time and names the file and parameter. Parameterless arrows such as `() => !open()` work.

**Workaround:** move the logic into a component method, such as `toggle()`, and call that from the
template.

## A malformed control-flow block is caught by a second parse

`@oxc-angular/vite` (0.0.38) silently drops the rest of a template after an unclosed control-flow
parameter list such as `@if (on() {`, or a `@let` without a closing semicolon. Angular Native
parses every template again with Angular's parser and fails with its message, line and column.
Errors point to the component file for inline templates or the template file for `templateUrl`.
The check runs in tests, production builds and hot reload, which preserves the previous template
on the device.
