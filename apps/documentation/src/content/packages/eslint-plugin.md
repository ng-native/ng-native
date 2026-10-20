---
title: ESLint
summary: Report the DOM events, HTML controls and browser APIs that do nothing on a device.
---

# ESLint

Angular's compiler checks a template against a browser's DOM, so some things compile and then do
nothing on a device. `(click)` on a `<pressable>` is never sent, a `<button>` draws as a plain view
that cannot be pressed, and `document` is undefined. `@ng-native/eslint-plugin` reports each one
and names what to write instead.

It runs on [angular-eslint](https://github.com/angular-eslint/angular-eslint)'s template parser,
which reads both `.html` templates and the inline templates in `.ts` files.

## Setup

The plugin runs on ESLint 9 or 10, with angular-eslint 22 and typescript-eslint 8.

### An app from the template

Install the packages:

```sh
npm install --save-dev eslint typescript-eslint angular-eslint @ng-native/eslint-plugin
```

Add `eslint.config.mjs` beside `package.json`:

```js
import ngNative from '@ng-native/eslint-plugin';

export default [
  { ignores: ['.expo/', 'ios/', 'android/', 'dist/'] },
  ...ngNative.configs.recommended,
];
```

Then add a `lint` script to `package.json`, and run it with `npm run lint`:

```json
{
  "scripts": {
    "lint": "eslint ."
  }
}
```

### An Nx workspace

Generate the app with `--linter=eslint`:

```sh
nx g @ng-native/nx:app apps/mobile --linter=eslint
```

The app gets the `eslint.config.mjs` above, the four packages and a `lint` target, run with
`nx lint mobile`. A workspace already on ESLint 9 keeps it. For an app generated without the
option, install the packages and add the config as for the template, and give the project a
`lint` target that runs `eslint .` in its directory.

### An Angular CLI workspace

Add the app with `--linter=eslint`:

```sh
ng add @ng-native/schematics --linter=eslint
```

`ng generate @ng-native/schematics:application` takes the option too. The project gets the
`eslint.config.mjs` above, the four packages and a `lint` target on angular-eslint's builder, run
with `ng lint native`. The target names the project's own config, so the rules apply to the native
app and not to the workspace's web apps.

### Beside an existing config

`recommended` is two flat-config entries, one for `**/*.ts` and one for `**/*.html`. An app that
already has an angular-eslint config can spread them into its own, or register the plugin as
`@ng-native` and turn on the rules below one by one.

A file that starts with `'use dom'` is an Expo DOM component, which runs in a web view with a real
DOM, so the rules skip it. An external `templateUrl` of such a component is linted as any other
template, since the `.html` file does not say whose it is.

Code rendered through [Web compatibility](/packages/web-compat) is written for a browser, and that
package gives `(click)`, HTML's controls, an element's DOM members and globals such as `document`
and `matchMedia` their behaviour. Turn `no-dom-events`, `no-html-controls`, `no-dom-node-access`
and `no-browser-apis` off for those files:

```js
export default [
  ...ngNative.configs.recommended,
  {
    files: ['src/app/library/**'],
    rules: {
      '@ng-native/no-dom-events': 'off',
      '@ng-native/no-html-controls': 'off',
      '@ng-native/no-dom-node-access': 'off',
      '@ng-native/no-browser-apis': 'off',
    },
  },
];
```

## Rules

### no-dom-events

Reports a DOM event that no native view sends, with the event to listen for instead:

| Written                                        | Use                                                   |
| ---------------------------------------------- | ----------------------------------------------------- |
| `(click)`, `(dblclick)`                        | `(press)` on a `<pressable>`, or `<text pressable>`   |
| `(contextmenu)`                                | `(longPress)` on a `<pressable>`                      |
| `(mousedown)`, `(mouseup)`                     | `(pressIn)`, `(pressOut)` on a `<pressable>`          |
| `(input)`, `(beforeinput)`                     | `(changeText)` or `[(value)]` on a `<text-input>`     |
| `(keydown)`, `(keyup)`, `(keypress)`           | `(keyPress)` or `(submitEditing)` on a `<text-input>` |
| `(submit)`                                     | `(submitEditing)` on a `<text-input>`                 |
| `(wheel)`                                      | `(scroll)` on a `<scroll-view>`                       |
| the mouse, drag and clipboard events           | a `[gesture]`, or `(changeText)` for a paste          |
| `(window:...)`, `(document:...)`, `(body:...)` | `@ng-native/device`, for app-wide events              |

A key filter is the same event: `(keydown.enter)` is reported as `(keydown)`. The rule only reads
these names on HTML elements and on the elements from `@ng-native/components`. A component of
your own can declare an output called `drag` or `drop`, so its events are left alone. A
`window:`, `document:` or `body:` listener is reported on any element.

A listener in a decorator's `host` object, such as `'(click)': 'select()'`, and one declared
with `@HostListener('click')`, are reported too. They listen on the host's own view, which never
sends a DOM event whatever its selector.

Angular's `routerLink`, written or bound, is reported too: it listens for a DOM click, so it never
navigates. Use `nativeRouterLink` from `@ng-native/router` on a `<pressable>`.

`(change)`, `(load)`, `(error)`, `(focus)` and `(blur)` are not reported, since an element here
sends them too.

`eslint --fix` renames `(click)` to `(press)` on a `<pressable>`, a `<touchable-opacity>` and a
`<text pressable>`, unless the handler reads `$event`: that is a mouse event in a browser and a
native one here. On a `<text-input>`, `(input)` is offered as `(changeText)` in the editor rather
than fixed, since its `$event` becomes the text.

### no-html-controls

Reports an HTML element that draws as a plain view or text without the behaviour it has in a
browser: `<button>` (use `<pressable>`), `<a>`, `<input>`, `<textarea>`, `<select>`, `<option>`,
`<form>`, `<img>` and `<picture>`. It also reports `<video>`, `<audio>`, `<iframe>`, `<canvas>`,
`<embed>` and `<object>`, which nothing in Angular Native draws.

HTML's text and layout elements, such as `<p>`, `<span>`, `<strong>`, `<div>` and `<section>`,
are not reported. They draw as text and views, as [Elements](/packages/components) describes.

### lowercase-elements

Reports an element written with a capital, such as `<View>` or `<ScrollView>`. It matches no
component, and the Metro transform fails the build on it; this says so in the editor first.
`eslint --fix` writes the lowercase name, `<view>` or `<scroll-view>`, in both tags.

### no-dom-node-access

Reports a DOM member read off an element's `nativeElement`, which here is the engine's node rather
than an `HTMLElement`:

| Written                                                         | Use                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `focus()`, `blur()`                                             | the same on the `TextInput`, from `viewChild(TextInput)` |
| `getBoundingClientRect()`, `offsetWidth` and the other sizes    | `(layout)` on the element                                |
| `scrollTo()`, `scrollIntoView()`, `scrollTop`                   | `scrollTo()` on the `ScrollView`, from `viewChild`       |
| `addEventListener()`, `dispatchEvent()`                         | an event binding in the template                         |
| `classList`, `style`, `setAttribute()`, `innerHTML` and the DOM | a binding: `[class.name]`, `[style.name]` or an input    |

It reads `ref.nativeElement.focus()` written out. A node kept in a variable first, then used, is
not followed.

### no-browser-apis

Reports, in TypeScript:

- An import from `@angular/platform-browser`, `@angular/platform-browser-dynamic` or
  `@angular/animations`, including their subpaths, or from `zone.js`.
- `provideZoneChangeDetection` from `@angular/core`: an app here is zoneless.
- `provideHttpClient` from `@angular/common/http`, which returns null bodies on a device. The
  editor offers `provideNativeHttpClient()` from `@ng-native/platform/http` in its place, import
  and calls, which takes the same features.
- A read of `document`, `localStorage`, `sessionStorage`, `indexedDB`, `location`, `history`,
  `matchMedia` or `getComputedStyle` that the file does not declare itself. A config that declares
  the browser's globals, with `globals.browser`, does not hide them.
- The same names read through `window` or `globalThis`, and the members of a browser's `window`
  that React Native's does not have: `addEventListener`, `innerWidth` and the other sizes,
  `scrollTo` and the scroll positions, `open` and `print`.

`window` itself is not reported. React Native defines it as the global object, so
`window.setTimeout` works.
