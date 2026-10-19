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
- The properties HTML reflects attributes as (`hidden`, `title`, `dir`, `tabIndex`, `type`,
  ARIA's and the rest), a table's rows and cells, and the element interfaces, `HTMLInputElement`
  and the rest, for `instanceof`.
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
  element out with what is pending committed first.
- Scrolling: an element whose style says `overflow: auto` or `scroll` scrolls what overflows it,
  with `scrollTop` and `scrollLeft` to read and write, `scroll`, `scrollTo`, `scrollBy` and
  `scrollIntoView`. The window does not scroll, and `document.scrollingElement` is its root.
- The window: `screen`, `visualViewport`, `matchMedia` with a `change` listener, and
  `ResizeObserver` and `IntersectionObserver`, with a root, a margin and thresholds. An app that
  observes nothing pays nothing for them.
- `MutationObserver`, with `childList`, `attributes`, `characterData`, `subtree` and old values.
- A `document` that creates engine nodes and fragments, with a `body` that draws over the screen
  for overlays, a doctype, `createElementNS`, `createTreeWalker` and `createNodeIterator`, and a
  `document.implementation` that makes HTML and XML documents that are never drawn.
- Events: `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `FocusEvent`, `TouchEvent` and the
  other kinds, `document.createEvent` with each kind's `init*Event`, `window.event`, and handler
  properties, `onclick` to `onload`. A press is a `PointerEvent`, and a touch is the mouse going
  down and up as a phone's browser has it. A held finger is a `contextmenu`.
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
  markers, patterns, a drop shadow and HTML in a `foreignObject`. Its elements have SVG's names
  and namespace, `className` as an object with `baseVal`, `getBBox`, `getComputedTextLength`,
  `ownerSVGElement` and `createSVGRect`, and a paint that names a token is the token's colour.
  `@ng-native/icons` is a peer dependency for this. The app installs `react-native-svg` for the
  native views; none of its JavaScript is imported, and without it a drawing shows nothing, as
  an icon does.
- Canvas: a `<canvas>`'s 2D context draws with the same native views, its `width` and `height`
  are the grid it draws on, and what is drawn reads back by `getImageData`, draws on another
  canvas by `drawImage` and is written as a PNG by `toDataURL` and `toBlob`. There is no bitmap:
  a clear of part of it, and a way of laying a drawing over what is there other than
  `source-over`, change only the pixels read back. An `<img>` drawn on one draws nothing.
- A `<button>` and an `<a>` with their roles, each taking a press with no listener (`:active`
  while held) and marked `data-hover` while a pointer is over it, a disabled one announced as
  disabled, and a table's and a form's elements as views.
- A `click` listener that hears a press.
- Forms: an `<input>` and a `<textarea>` are the platform's text field, with `value` and
  `defaultValue`, its keys, `change` once an edit ends, the keyboard its `type` and `inputmode`
  ask for, and `readOnly` and `disabled` making it one that cannot be typed into. A `<select>`
  shows its chosen `<option>` and opens a list of them when it or its label is pressed. A control
  has `checked`, `validity` with `checkValidity()`, `reportValidity()` and `setCustomValidity()`,
  `selectionStart` and `setSelectionRange()`, and its `form`, which has `elements`,
  `requestSubmit()` and `reset()`. A disabled `<fieldset>` disables what is in it, a file input's
  `click()` opens the system's file picker through `expo-document-picker`, and `:valid`, `:checked`,
  `:placeholder-shown` and the rest match.

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
