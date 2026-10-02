---
title: DOM components
summary: An Angular component in a web view inside a native screen, with inputs and outputs bound.
---

# DOM components

A DOM component is an Angular component that renders to the DOM, run by a browser engine in a web
view that sits inside a native screen. Everything around it stays native. You bind its inputs and
outputs from the screen's template, much as you would any other component's, and the values cross
between the two.

It is how a native app uses something that only exists for the web: a `<canvas>` signature pad, a
charting or rich-text library, a Markdown or HTML renderer, a component from an Angular web app you
already have. Don't reach for it for anything native does well. Each one is a whole browser view,
running its own JavaScript, so it suits one editor or chart on a screen, not the rows of a list.

Two things it is not:

- **Not the Web Components standard.** Nothing here is a custom element or uses shadow DOM. The
  name is Expo's: "DOM component" is what Expo calls a component rendered with the DOM rather than
  with native views.
- **Not how Angular Native renders.** Every other component in Angular Native is a real native
  view. A DOM component is the deliberate exception, a web page embedded in one.

Expo has the same feature for React, [DOM components](https://docs.expo.dev/guides/dom-components/),
and this is the Angular version of it, using the same machinery: Expo's web view, the same
`'use dom'` directive, Expo's dev server route and Expo's release export. The two can live in one
app.

## Setup

The web view is `@expo/dom-webview`, which `expo` already installs. The DOM component itself needs
Angular's browser platform and the small runtime from `@ng-native/web`:

```sh
npx expo install @angular/platform-browser @angular/common @ng-native/web
```

## Writing one

A DOM component is a file of its own. It starts with `'use dom'`, and its default export is
`mountInWebView(...)`. That call is also what marks it as Angular's rather than one of Expo's React
DOM components, which start with the same directive:

```ts
// web/signature.ts
'use dom';
import { Component, ElementRef, input, output, viewChild } from '@angular/core';
import { mountInWebView } from '@ng-native/web/web-view';

@Component({
  selector: 'app-signature',
  styles: [
    `
      canvas {
        display: block;
        width: 100%;
        height: 180px;
        touch-action: none;
        border: 1px solid #d1d1d6;
        border-radius: 12px;
      }
    `,
  ],
  template: `
    <canvas
      #pad
      (pointerdown)="start($event)"
      (pointermove)="draw($event)"
      (pointerup)="finish()"
    ></canvas>
    <p>Sign as {{ name() }}</p>
  `,
})
export class Signature {
  readonly name = input('');
  readonly strokes = output<number>();
  // ...drawing code, as in any web app
}

export default mountInWebView(Signature);
```

Everything in that file is ordinary Angular for the browser. `styles` and `styleUrl` are real CSS
applied by the web view, so a property native has no equivalent for (`resize`, `grid`,
`touch-action`) is fine here, where in a native component it would be dropped with a build
warning. The component
mounts into a root of its own, the page's body has no margin, and its background is transparent, so
whatever is behind the web view shows through anything the component does not paint.

## Using one

Import the file from native code and hand it to `<dom-component [src]>`:

```ts
import { Component, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { DomComponent } from '@ng-native/expo/dom-component';
import signature from './web/signature.ts';

@Component({
  selector: 'app-sign',
  imports: [Text, View, DomComponent],
  template: `
    <view class="flex-1 p-4">
      <dom-component
        class="h-60"
        [src]="signature"
        [inputs]="{ name: name() }"
        [outputs]="{ strokes: onStrokes }"
      />
      <text>{{ strokes() }} strokes</text>
    </view>
  `,
})
export class Sign {
  protected readonly signature = signature;
  protected readonly name = signal('Ada Lovelace');
  protected readonly strokes = signal(0);
  protected readonly onStrokes = (count: number) => this.strokes.set(count);
}
```

In native code the import is not the component. The build replaces the whole file with a reference
to its page, so none of the web code, and nothing it imports, ends up in the native bundle. The
element registers itself: importing `DomComponent` is all the setup there is.

`<dom-component>` is a native view like any other, so size it like one - a height, or `flex-1` in a
container that has one. It does not grow to fit what the page draws.

## Inputs

`inputs` sets the component's inputs by their public names.

- **Before the page loads**, the values go in with the page itself, so `input.required()` works and
  the first render already has them.
- **When a value changes**, it is sent to the running page and set on the same component instance.
  The page is not reloaded, so the component keeps its state (a half-drawn signature stays drawn).
- **While the page is still loading**, a change is held and sent once the page says it is ready.

## Outputs

`outputs` maps the component's outputs, by public name, to handlers in the native app. Each emit
calls the handler with the emitted value.

A handler for an output the component does not have is an error, and the message lists the outputs
it does have, rather than a handler that silently never fires. The check runs when the page is
ready, since that is when the native side learns the component's outputs.

A `model()` is an input plus an output named `...Change`, so two-way binding is both:

```html
<dom-component [src]="editor" [inputs]="{ text: draft() }" [outputs]="{ textChange: onText }" />
```

## What can cross

The page is a separate JavaScript runtime from the app, so inputs and output values cross as JSON:

- Strings, numbers, booleans, `null`, arrays and plain objects arrive as they left.
- A `Date` arrives as its ISO string, `undefined` properties are dropped, and a class instance
  arrives as a plain object without its methods.
- Functions, signals, observables and injected services cannot cross at all. The component cannot
  inject the app's services; it has an injector of its own, in its own runtime.

## What the app listens to

The app acts only on messages from the page it loaded: the dev server's in development, the
component's own file in a release build. If a link in the content takes the web view to another
page, that page's messages are ignored, so it cannot fire an output or ask to be sent changed
inputs. A message that is not JSON is dropped, and an output name is only looked up among the
handlers you passed.

In development the page is told apart by where it is served from, so any page from the same dev
server is heard. In either case a message names the page the web view is showing, not the frame
that sent it, so an `<iframe>` inside the component's own page is heard as the page.

The inputs the page reads as it loads are the web view's to give, though, and it gives them to any
page it shows, so keep secrets out of them.

## Errors and debugging

An error in the DOM component reaches the app's `ErrorHandler`, prefixed with the file it came
from, so in development it shows in the terminal and on the red screen like any other. That covers
errors from the component once Angular is running, and anything thrown before that: an import that
fails, or a module that throws as it loads.

For anything else, the page is a real web page. In a development build the web view is
inspectable: open Safari, then **Develop**, then the simulator or device, and pick the page to get
the DOM, the console and the debugger. On Android, `chrome://inspect` does the same.

Edits to a DOM component show up the next time its screen is opened. There is no hot reload inside
the web view.

## How it ships

- **In development**, the page is served by Expo's dev server, from the same route Expo uses for
  its DOM components (`/_expo/@dom/...`), and built by the app's own Metro for the web platform.
- **In a release build**, the native build's bundling step (`expo export:embed`) finds every web
  component the app imports and writes each page into the app: `www.bundle` in the iOS app, the
  assets folder on Android. The web view loads it from there, with no server.
- **With `eas update`**, the pages go wherever Expo puts DOM components' pages, and the web view
  looks for them where Expo would. This path has not been tested yet.

Two pieces make this work, both in `@ng-native/metro`'s transformer. Imported from native code, a
`'use dom'` file becomes the reference to its page and carries the same marker Expo's `'use dom'`
plugin records, which is how the export finds it. Built for the web, the page's entry loads the
file directly instead of mounting a React component, and the file mounts itself.

## Limits

- **Only JSON crosses.** No shared services, signals or state; see
  [What can cross](#what-can-cross).
- **One browser view per instance.** Tens of megabytes and a few hundred milliseconds to start.
  Fine for a screen's centerpiece, wrong for a list.
- **No children.** Native content cannot be projected into a DOM component.
- **Sized from outside.** The web view does not size itself to its content.
- **Checked on iOS.** Android uses the same Expo web view and the same pages, but has not been run.

## Reference

`mountInWebView(component, options?)` (from `@ng-native/web/web-view`) mounts the component in
the page and returns the value the file exports. `options.providers` adds providers to the web
component's own application, for example `provideHttpClient()`.

<!-- api: DomComponent -->
