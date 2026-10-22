# @ng-native/web-compat

Opt-in DOM compatibility for Angular Native. A component library written for the browser reaches
for the DOM on the elements it renders: `getAttribute`, `classList`, `addEventListener`. This
package gives the engine's nodes those members, each going through the engine's own mutation API,
so such a library can render as native views.

Experimental and partial. It has:

- Node names and kinds, namespaces and prefixes, attributes (in a browser's case, as `Attr`
  nodes and in a namespace) and classes, `dataset`, `textContent`, `innerText`, and listeners
  with `dispatchEvent`.
- Markup: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTML` and its kin, and a
  `<template>`'s `content`, parsed as a browser parses HTML.
- The properties HTML reflects attributes as (`hidden`, `title`, `dir`, `tabIndex`, `draggable`,
  `type`, ARIA's and the rest), `isContentEditable` from `contenteditable`, a
  table's rows and cells, and the element interfaces, `HTMLInputElement` and the rest, for
  `instanceof`.
- The tree: live `childNodes` and `children`, the nodes around one, `appendChild`,
  `insertBefore`, `removeChild`, `replaceChild`, `append`, `prepend`, `replaceChildren`,
  `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `cloneNode`,
  `getRootNode`, `compareDocumentPosition`, `isEqualNode` and `normalize`, each checked as a
  browser checks an insertion. Texts and comments have `data` and the rest of `CharacterData`.
- Live `getElementsByTagName`, `getElementsByClassName` and `getElementsByName`.
- Selectors: `querySelector` and `querySelectorAll` on an element, a fragment and a document,
  `matches`, `closest`, read as Selectors Level 4 has them, with a `SyntaxError` for one that
  cannot be read. A state nothing here reads, `:hover` or `:checked`, matches nothing.
- Stylesheets: `document.styleSheets`, a `<style>`'s `sheet`, `CSSStyleSheet` (made by a script
  too, with `replace`, `replaceSync` and `adoptedStyleSheets`), its rules with `insertRule` and
  `deleteRule`, and the rest of the CSSOM's rule classes. A `<style>` a library makes while the
  app runs is read and applied, for the layout properties, colours, custom properties and
  transitions it declares, `@media` by the window's width and height, which way up it is and the
  colour scheme and motion the user asked for, and `@supports`.
- `element.style` as a `CSSStyleDeclaration`: `cssText`, `setProperty`, `getPropertyValue`,
  `removeProperty` and each property by name, shorthands as their longhands, and the `style`
  attribute as its text. A style a library binds is set as what a native view reads.
- `getComputedStyle`, with a `width` or `height` an element has none of its own of as it is
  drawn, a `hidden` element drawn as `display: none`, and `CSS.escape` and `CSS.supports`.
- Geometry: `getBoundingClientRect` and `getClientRects` as `DOMRect`s, `offsetParent` and the
  `offset`, `client` and `scroll` sizes and positions, each read from where native last laid the
  element out with what is pending committed first. `document.elementFromPoint` and
  `elementsFromPoint` answer the element drawn at a point, passing over `pointer-events: none`,
  `display: none` and what a box that clips its overflow does not draw.
- Scrolling: an element whose style says `overflow: auto` or `scroll` scrolls what overflows it,
  with `scrollTop` and `scrollLeft` to read and write, `scroll`, `scrollTo`, `scrollBy` and
  `scrollIntoView`. The window does not scroll, and `document.scrollingElement` is its root.
- The window: `screen`, `visualViewport`, `matchMedia` with a `change` listener, and
  `ResizeObserver` and `IntersectionObserver`, with a root, a margin and thresholds. An app that
  observes nothing pays nothing for them.
- `navigator.userAgent` naming a phone of the platform the app runs on, and `maxTouchPoints`, where
  the runtime's own `navigator` says no browser: a library picks touch handling from them.
- Stand-ins for what a library asks of the window: `localStorage` and `sessionStorage` held in
  memory for as long as the app is up, `getSelection()` with nothing selected, `open()` returning
  `null`, and a `ShadowRoot` that nothing is an instance of.
- The window starts under the navigation header of the screen in sight and ends at the top of the
  keyboard while it is up, as a browser on a phone ends its window there: `innerHeight`,
  `visualViewport` and where an element or a touch is are read from there, `resize` is sent as
  either moves, and `document.body`, where an overlay goes, covers just that part of the screen,
  with what is `fixed` in it fixed to it. On Android, which draws an app under its system bars,
  the window is as tall as the app is drawn. `screen` and `matchMedia` read the whole screen.
- `MutationObserver`, with `childList`, `attributes`, `characterData`, `subtree` and old values.
- A `document` that creates engine nodes and fragments, with a `body` that draws over the screen
  for overlays, a doctype, `createElementNS`, `createTreeWalker` and `createNodeIterator`, and a
  `document.implementation` that makes HTML and XML documents that are never drawn.
- Events: `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `FocusEvent`, `TouchEvent` and the
  other kinds, `document.createEvent` with each kind's `init*Event`, `window.event`, and handler
  properties, `onclick` to `onload`. A press is a `PointerEvent`, and a touch is the mouse going
  down and up as a phone's browser has it. A held finger is a `contextmenu`. An element moved to
  another parent, or taken out, while a finger is on it is moved in the document at once and
  stays where native has it until the finger lifts, so the touch goes on, as a drag that puts its
  element on the body as it begins needs.
- What a click does: a checkbox or a radio is checked and says `input` and `change`, a button
  submits or resets its form, and a label clicks or focuses its control, for a press, a click a
  script sends and `element.click()`.
- `focus()` and `blur()` as a browser has them: at once, on a button, a link or what has a
  `tabindex` as on a text field, with `document.activeElement`, `:focus` and `focusin` and
  `focusout` on the document.
- The basic `window` globals: its listeners, `Event`, `CustomEvent`, `HTMLElement`, `Node`,
  `Text`, `Comment`, `DocumentFragment`, `NodeList`, `HTMLCollection`, `DOMParser`,
  `XMLSerializer`, `Document`, `Attr`, `CSS`, `MediaList`, the window's size, and an element
  with an id as a global by it.
- SVG: an `<svg>` a template writes, markup builds or a script makes with `createElementNS` is
  drawn by react-native-svg's native views, the ones `@ng-native/icons` draws with: shapes,
  groups, texts and their spans, a text along a path, gradients and their stops, clips, masks,
  markers, patterns, a drop shadow and HTML in a `foreignObject`, the whole drawing where it gives
  no area. Its elements have SVG's names
  and namespace, `className` as an object with `baseVal`, `getBBox`, `getComputedTextLength`,
  `ownerSVGElement` and `createSVGRect`, and a paint that names a token is the token's colour.
  A shape with a listener for a touch, or in a group or a drawing with one, takes the touch; a
  touch native finds no shape for, as between the letters of a text, is on the text, rectangle,
  circle or ellipse whose box is under the finger; and a touch on a shape sends `mouseover` and
  `mouseenter`, and `mouseout` and `mouseleave` for the shape before, as a phone's browser does,
  so a chart shows a series' tooltip. `@ng-native/icons` is a peer dependency for this. The app
  installs `react-native-svg` for the
  native views; none of its JavaScript is imported, and without it a drawing shows nothing, as
  an icon does. A `<path>` of thousands of straight segments that go one way across, a chart's
  line series, is drawn thinned to the lowest and highest point of each point-wide column, as
  react-native-svg on iOS takes seconds over a stroke that long; `getAttribute('d')` and
  `getBBox` read the whole path, and a canvas's long line is thinned too. A curve, a relative
  command, a path that turns back so often that no run is long, or one under a rotation is drawn
  as written.
- Canvas: a `<canvas>`'s 2D context draws with the same native views, so it too shows nothing
  where the app has not installed `react-native-svg`. Its `width` and `height` are the grid it
  draws on, and the shapes drawn, not its text, read back by `getImageData`, draw on another
  canvas by `drawImage` and are written as a PNG by `toDataURL` and `toBlob`. On React Native,
  `toBlob` hands its callback null, as its `Blob` holds no bytes; `toDataURL` has the PNG there.
  There is no bitmap: a clear of part of it, and a way of laying a drawing over what is there
  other than `source-over` (and `copy` where nothing clips it), change only the pixels read
  back. An `<img>` draws on one once its picture has loaded, and is not in the pixels read back.
- `<img>` as the platform's image view, from its `src` resolved against the page's address, with
  its `alt` said to a screen reader, its `width` and `height` as its size, the size of its
  picture where nothing else sizes it, `naturalWidth`, `naturalHeight`, `complete`, `load` and
  `error`, and `object-fit` as how the picture fits its box. A picture that is an SVG is fetched
  and drawn as an `<svg>` of its shapes alone.
- A `<button>` and an `<a>` with their roles, each taking a press with no listener (`:active`
  while held) and marked `data-hover` while a pointer is over it, a disabled one announced as
  disabled, and a table's and a form's elements as views.
- A table laid out in columns: a cell as wide as the columns it is across (`colspan`), one down
  several rows (`rowspan`), the columns sharing the table's width by what their cells hold or
  the widths the cells say, and `table-layout: fixed` giving them one width.
- The page's address: `document.URL`, `baseURI` and `<base href>`, `window.location`, a link's
  `href` and the parts of its URL, the other URLs an element's attributes say, resolved against
  it, and `:target`.
- `<iframe>`, as a native web view or as a document of its own, with `contentWindow`,
  `postMessage` both ways, and `window.frames`.
- A `click` listener that hears a press.
- Forms: an `<input>` and a `<textarea>` are the platform's text field, with `value` and
  `defaultValue`, its keys, `change` once an edit ends, the keyboard its `type` and `inputmode` ask
  for, twenty characters wide until its `size` says otherwise, a `caret-color` in its `style` as its
  selection colour (`transparent` hides the caret), and `readOnly` and `disabled` making it one that
  cannot be typed into. An `<input type="range">` keeps its value within its `min` and `max` on its
  `step`, has `valueAsNumber`, `stepUp()` and `stepDown()`, and moves under a finger dragged across
  it, saying `input` as it moves and `change` as the finger lifts. A `<select>` shows its chosen
  `<option>` and opens a list of them when it or its label is pressed. A control has `checked`,
  `validity` with `checkValidity()`, `reportValidity()` and `setCustomValidity()`, `selectionStart`
  and `setSelectionRange()`, `select()` followed by `document.execCommand('copy')` writing the text
  to the clipboard through `expo-clipboard`, and its `form`, which has `elements`, `requestSubmit()`
  and `reset()`. A disabled `<fieldset>` disables what is in it, its `<legend>` sits on its top
  border, a file input's `click()` opens the system's file picker through `expo-document-picker`,
  and `:valid`, `:checked`, `:placeholder-shown` and the rest match. An app opens a picker of its
  own instead by providing `FILE_PICKER`, an object with the `getDocumentAsync()` of
  `expo-document-picker` (its type is `FilePicker`).

The rest of the DOM is not part of it yet.

Nothing in an app changes until it adds the provider, and everything the provider adds is taken
away again when the app is destroyed.

## Install

```sh
npm install @ng-native/web-compat
```

## Use

```ts
import { provideWebCompat } from '@ng-native/web-compat';

export const appConfig = {
  providers: [provideWebCompat()],
};
```

It gives Angular's `Location` a platform to stand on in an app with no router. In an app with the
native router, `Location` is the router's, in whichever order the two are listed.

## Name what is written for a browser

A library's stylesheets are read as a browser reads them only for the packages the build is
given: a flex container is a row. Wrap the Metro config last:

```js
const { withWebCompat } = require('@ng-native/web-compat/metro');

module.exports = withWebCompat(config, {
  libraries: ['@angular/cdk', '@angular/material'],
  // Components a library's CLI copies into the app, as Spartan UI's styled layer is.
  sources: ['./src/app/ui'],
});
```

`libraries` are npm packages. `sources` are directories of the app's own sources, relative to the
project. Every other component in the app stays the native view it is.

`withWebCompat` also gives the window its `addEventListener`, `removeEventListener` and
`dispatchEvent` before any module runs, for a library that adds a listener as it loads, as the
CDK does to learn whether one can be passive. What they are given is handed to the window once an
app is up, so such a library can be imported anywhere in the app, not only on a lazy route.

## A library that asks whether it is in a browser

Angular's `PLATFORM_ID` is `native` on a device, and some libraries open an overlay or measure
only where it is `browser`. Give the component or the route of such a library's page a browser's
id. The rest of the app keeps reading `native`.

```ts
import { provideBrowserPlatformId } from '@ng-native/web-compat';

@Component({
  providers: [provideBrowserPlatformId()],
})
export class SettingsPage {}
```

## The page's address

The page is at the app's own URL, with the route the app is on: `document.URL`,
`document.baseURI` and `window.location` say it, and a relative link, an image's `src` and the
other URLs an element's attributes say resolve against it, as a browser resolves them against
the address of the page it shows. A `<base href>` in the head changes what they resolve against.

The app's URL is the one Expo opens the app with: `exp://127.0.0.1:8081/--/` in Expo Go, and the
app config's `scheme` in a build, so `canary://` is a page at `canary:///settings`. An app with
neither is at `app://`. Give it one that wins over both:

```ts
provideWebCompat({ url: 'https://shop.example/' });
```

`location.assign()`, `replace()` and setting `href` or a part of it go to a page of the app the
way a link to it does, through the router, and open any other URL with `Linking`. In an app
without the native router, a page of the app goes nowhere. `reload()` does nothing.

## Frames

An `<iframe>` is a native web view, from `react-native-webview`, which shows the page in it as a
browser does, its scripts included. Install it in an app that has a frame:

```sh
npx expo install react-native-webview
```

`src` resolves against the page's address, and `srcdoc` is shown with the page's address as its
base where that is an `http`, `https` or `file` address and no `sandbox` takes the frame's origin
away. A frame is 300 by 150 points, as in a browser, under its
`width` and `height` and any stylesheet, and hears `load` as its page finishes loading.

The app has the frame as a browser has a frame of another origin: `contentDocument` is `null`,
and the two talk with `postMessage`. `iframe.contentWindow.postMessage(data, origin)` is a
`message` event in the page, from the app's origin, whose `source` the page answers through. The
page's `window.parent.postMessage(data, origin)`, and `window.ReactNativeWebView.postMessage`,
are a `message` event on the app's `window`, whose `source` is the frame's `contentWindow`.
The `postMessage` methods cross as JSON; what `ReactNativeWebView.postMessage` sends arrives as
the string it is.

The page is sent as the frame's `Referer`, as `referrerpolicy` says, where its address is a web
address: a video embed that asks who embeds it needs `provideWebCompat({ url })` to be one in
Expo Go, whose `exp://` address is not. `sandbox` without `allow-scripts` runs no script, and
`allow` turns on autoplay, fullscreen and picture in picture where it lists them. `loading` and
the rest of `sandbox` are left out, and development says so.

`sandbox` without `allow-same-origin` gives the frame the origin `null` in the messages the app
sends and hears, and shows `srcdoc` with no base. A native web view cannot give a page no origin,
so a `src` page in such a sandbox still loads at its own origin, with its storage and cookies,
and development says so. The sandbox says who the app talks to; it does not isolate the page.

Where `react-native-webview` is not installed, and in Node, a frame is an emulated document
instead: a document of the app's own, from `about:blank`, `srcdoc` or what `src` names, which a
script reads and writes as one of its own origin. It is not drawn and no script in it runs. Ask
for it in an app that measures or prints in a frame, and in a test that reads a frame's document:

```ts
provideWebCompat({ frames: 'emulated' });
```

`loadFrame` reads what an emulated frame's `src` names, with `fetch` where it is not given.
