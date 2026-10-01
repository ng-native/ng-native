---
title: Islands
summary: Angular Native components inside an existing Angular web app, or as separate apps on one page.
---

# Islands

An island is an Angular Native component rendered into one element of a web page. There are two
kinds, and the difference is who owns it:

- **Inside an existing Angular app.** The island is part of the app around it: it uses the same
  services, the same change detection and the same error handling, and it renders into a region
  of that app's own templates. This is how you add Angular Native components to a web app you
  already have.
- **An app of its own.** The island has its own injector and change detection, and shares nothing
  with the page. This is what a plain `mount(element, App)` does, and how every live example on
  this site is built.

Either way, the page builds with Vite and `ngNativeWeb()` from `@ng-native/web/vite`, as
[Setting up a browser app](/packages/web#setting-up-a-browser-app) describes. For an existing
Angular app that is its build: `ngNativeWeb()` compiles the app's own components, with
`bootstrapApplication` from `@angular/platform-browser`, as well as the islands inside them.

## In a template: `<ng-native-island>`

`<view>`, `<text>` and `<pressable>` cannot be written straight into a web app's templates. An
Angular app has one renderer, and a web app's is the DOM's, which has no idea what a `<view>` is.
`<ng-native-island>` is the boundary: put it in any template, give it a component, and that
component renders through Angular Native inside it.

```ts
import { Component, signal } from '@angular/core';
import { NgNativeIsland } from '@ng-native/web';
import { Wallet } from './wallet.ts';

@Component({
  selector: 'account-page',
  imports: [NgNativeIsland],
  template: `
    <h1>Your account</h1>
    <ng-native-island
      [component]="wallet"
      [inputs]="{ accountId: accountId() }"
      [outputs]="{ paid: onPaid }"
    />
  `,
})
export class AccountPage {
  protected readonly wallet = Wallet;
  protected readonly accountId = signal('acc_42');

  protected readonly onPaid = (amount: number) => {
    // Runs in this app, like any other handler.
  };
}
```

- **`component`** is the Angular Native component to mount. Change it and the old one is destroyed
  and the new one mounted in its place.
- **`inputs`** sets the component's inputs, by their public names. They are set before the first
  render, so an `input.required()` works. A changed value is set on the mounted component rather
  than remounting it, so the component keeps its state.
- **`outputs`** maps the component's outputs, by public name, to handlers. A name the component
  has no output for is an error that lists the outputs it does have, rather than a handler that
  silently never fires.
- **Teardown is automatic.** The island is destroyed with the element: an `@if` turning false, a
  route changing, the page being destroyed.

## From code: `mount()` with an `injector`

`<ng-native-island>` is a thin wrapper around `mount`. Call it directly when you are placing the
island yourself - into an element you created, or from a service. Pass an injector from the app,
and the island joins it:

```ts
import { Component, ElementRef, Injector, inject, viewChild } from '@angular/core';
import { mount, type MountResult } from '@ng-native/web';
import { Wallet } from './wallet.ts';

@Component({
  selector: 'account-panel',
  template: `<div #slot></div>`,
})
export class AccountPanel {
  private readonly injector = inject(Injector);
  private readonly slot = viewChild.required<ElementRef<HTMLElement>>('slot');
  private island?: MountResult;

  ngAfterViewInit(): void {
    this.island = mount(this.slot().nativeElement, Wallet, {
      injector: this.injector,
      inputs: { accountId: 'acc_42' },
    });
  }

  ngOnDestroy(): void {
    this.island?.destroy();
  }
}
```

`mount` returns `{ componentRef, applicationRef, destroy, factory, engine }`. Change an input
later with `componentRef.setInput(name, value)`, and subscribe to an output through
`componentRef.instance`. Tear the island down with `destroy()`, not `applicationRef.destroy()`:
with an `injector`, `applicationRef` is the host app's, and destroying it would take the whole app
with it.

`destroy()` empties the element the island was mounted into and leaves the element itself where it
was, since it belongs to your template, not to the island.

## What an island shares, and what it keeps

An island inside an app uses the app's injector as its parent, without a root scope of its own.
Anything it does not provide itself comes from the app, once, for both:

| Shared with the host app                                                           | The island's own                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Every `providedIn: 'root'` service, including your own                             | The renderer and engine that turn `<view>` into a `<div>`            |
| Anything `bootstrapApplication` provides, such as `provideHttpClient()` or a store | `Screen`, `ColorScheme`, `Direction`, `HardwareBack` and `StatusBar` |
| Anything a component above the island provides                                     | Anything you pass in `providers`                                     |
| Change detection: the app checks the island as one of its own views                |                                                                      |
| The app's `ErrorHandler`                                                           |                                                                      |

The five device services on the right read the browser - the window's size, `prefers-color-scheme`,
`document.dir` - rather than a phone, so each island builds its own against those sources.
Everything else from `@ng-native/device` is shared like any other root service.

Because change detection is the app's, a signal the island reads updates it when the app changes
it, and an event in the island - a press, a text change - is noticed by the app's scheduler like
one of its own. That is tested with zoneless apps, Angular's default since v21. An app still on
zone.js goes through the same scheduler, but that combination is not yet covered by a test.

## Styles

An island inside an app injects a smaller reset than a standalone app does. The full `reset.css`
gives `html` and `body` a height and a font, which is right for a page Angular Native owns and wrong
for a page it is a guest on. The island reset leaves both alone and puts the font on the island's
root instead, so the host page looks exactly as it did.

Tailwind classes and global stylesheets style an island as they would anything else. A component's
own `styles:` apply too, scoped to that component by Angular's emulated encapsulation, as they are
on a device. The browser is more forgiving than the native compiler, though: a declaration a
native build drops with a warning, such as `grid-template-columns`, still works here, so check a
stylesheet on a device before relying on it.

## What cannot cross

- **No `<view>` in the host's own templates.** Every Angular Native element has to be inside an
  island, because that is where Angular Native's renderer is.
- **No native-only packages.** `@ng-native/router`, worklet animation and gesture handling have no
  web build, inside an app or out; see [What does not carry over](/packages/web/limits).
- **One component per island.** Nest as much as you like inside it, but an island's own inputs and
  outputs are the component's, so put a small wrapper component around several if they need to
  share a region.

## An app of its own

Without an `injector`, `mount` builds a complete app of its own - its own environment injector, its
own change detection, no services shared with the page. Call it as many times as you like; each
call is independent of the others.

```ts
import { Component, ElementRef, viewChild } from '@angular/core';
import { mount, type MountResult } from '@ng-native/web';
import { MyButtonDemo } from './my-button-demo.ts';

@Component({
  selector: 'button-example',
  template: `<div #host></div>`,
})
export class ButtonExample {
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private mounted?: MountResult;

  ngAfterViewInit(): void {
    this.mounted = mount(this.host().nativeElement, MyButtonDemo, { injectReset: false });
  }

  ngOnDestroy(): void {
    this.mounted?.destroy();
  }
}
```

That is exactly how this documentation site works: the page around an example is an ordinary
Angular application, and each live example is a separate `mount` into its own empty `<div>`. The
examples need nothing from the page, so they share nothing with it.

Each island is as tall as its own content by default, because `reset.css` gives the mounted root
`height: 100%`, and `100%` of an element with no explicit height resolves against the box it is
actually in - a full-screen app on native, an auto-height `<div>` here.

`injectReset: false` above skips having `mount` inject `reset.css` as a bare `<style>` tag; pass it
when your own build already imports `reset.css` through a bundler (into a Tailwind layer, say),
because an unlayered rule beats a layered one regardless of specificity, and a bare injected copy
would then win against the very utility class meant to override it. Every node from this framework
carries a `[data-rn]` attribute, which is what `reset.css` targets rather than the tag name - two
elements (`<text-input>`, `<switch>`) commit as a real `<input>` (a `<textarea>` for a multiline
`<text-input>`), so matching by tag would miss them. `<text>` is deliberately excluded from the flex reset, since React Native's
`Text` lays its content out as wrapping text rather than as a flex container; a `<text>` that needs
an explicit size on the web needs `class="block"` from its caller, the one place a native layout
and its web rendering can visibly diverge.
