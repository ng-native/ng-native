---
title: Supported API
summary: The DOM members web-compat gives the engine's nodes, area by area, and the gaps in each.
---

# Supported API

Every member here is on the engine's nodes, the global `document` and `window` once
`provideWebCompat()` is provided. Each area ends with the gaps the package knows of. What is not
listed is not there.

## The DOM tree

- Node names and kinds, namespaces and prefixes, attributes (as `Attr` nodes and in a namespace)
  and classes, `classList`, `dataset`, `textContent` and `innerText`.
- Listeners: `addEventListener`, `removeEventListener` and `dispatchEvent`, on nodes and on the
  `window`.
- The tree: live `childNodes` and `children`, the nodes around one, `appendChild`,
  `insertBefore`, `removeChild`, `replaceChild`, `append`, `prepend`, `replaceChildren`, `before`,
  `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `cloneNode`, `getRootNode`,
  `compareDocumentPosition`, `isEqualNode` and `normalize`, each checked as a browser checks an
  insertion. Texts and comments have `data` and the rest of `CharacterData`.
- Live `getElementsByTagName`, `getElementsByClassName` and `getElementsByName`.
- `MutationObserver`, with `childList`, `attributes`, `characterData`, `subtree` and old values.
- A `document` that creates engine nodes and fragments, with a `body` that draws over the screen
  for overlays, a doctype, `createElementNS`, `createTreeWalker` and `createNodeIterator`, and a
  `document.implementation` that makes HTML and XML documents.
- The `window` globals a library reads: `Event`, `CustomEvent`, `HTMLElement`, `Node`, `Text`,
  `Comment`, `DocumentFragment`, `NodeList`, `HTMLCollection`, `DOMParser`, `XMLSerializer`,
  `Document`, `Attr`, `CSS`, `MediaList`, the window's size, and an element with an id as a global
  of that name.

Gaps: a document `document.implementation` makes is never drawn, has no events of its own, no
`defaultView` and no `styleSheets`, and measures zero. An XML document is made as an HTML one is.

## HTML

- Markup: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTML` and its kin, and a
  `<template>`'s `content`, parsed as a browser parses HTML.
- The properties HTML reflects attributes as: `hidden`, `title`, `dir`, `tabIndex`, `type`, the
  ARIA properties and the rest.
- A table's rows and cells.
- The element interfaces, `HTMLInputElement` and the rest, for `instanceof`.
- The HTML elements a library writes that the engine has no view for, a `<button>` or a
  `<table>`, are views. A `<button>` and an `<a>` have their roles.

Gaps: the element interfaces answer `instanceof` only. They have no prototype a member can be
added to, and no `new`. A comment before or after an HTML document's `<html>` is left out.

## Selectors

- `querySelector` and `querySelectorAll` on an element, a fragment and a document, `matches` and
  `closest`, read as Selectors Level 4 has them, with a `SyntaxError` for a selector that cannot
  be read.
- The pseudo-classes of a form control's state (`:checked`, `:valid` and the rest, under
  [Forms](#forms)), of focus (`:focus`, under [Events](#events)) and of the address (`:target`,
  under [Iframes and the page address](#iframes-and-the-page-address)).

Gaps: a state nothing here reads matches nothing, as it does in a browser where it is not the
case: `:hover`, `:visited` and a media element playing. A button or a link a pointer is over is
marked `data-hover` instead, which the Tailwind preset's `hover:` reads.

## CSSOM

- `document.styleSheets`, a `<style>`'s `sheet`, and `CSSStyleSheet`, made by a script too, with
  `replace`, `replaceSync` and `adoptedStyleSheets`.
- A sheet's rules, with `insertRule` and `deleteRule`, and the rest of the CSSOM's rule classes.
- A `<style>` a library makes while the app runs is read and applied: the layout properties,
  colours, custom properties and transitions it declares, `@media` by the window's width and
  height, which way up it is and the colour scheme and motion the user asked for, and `@supports`.
- `element.style` as a `CSSStyleDeclaration`: `cssText`, `setProperty`, `getPropertyValue`,
  `removeProperty` and each property by name, shorthands as their longhands, and the `style`
  attribute as its text. A style a library binds is set as what a native view reads.
- `getComputedStyle`, a `hidden` element drawn as `display: none`, and `CSS.escape` and
  `CSS.supports`.

Gaps:

- A rule in a sheet made while the app runs is passed over where its selector has a namespace,
  `:nth-child(... of S)` or a pseudo-class the engine does not track, `:hover` among them.
- A rule for a pseudo-element other than `::before` and `::after` (`::first-line`, `::selection`)
  is passed over, as is a `content` other than a string or `none` (a counter or `attr()`, say), and
  a value the engine drops, `display: table` among them.
- An `@import` loads nothing, so the sheet it makes is empty.
- `element.style` checks a value against what the property takes for the properties a script
  commonly sets, and drops one that does not match; any other longhand takes any value. A colour
  is written in lower case, and another keyword keeps the case it was written in:
  `display: BLOCK` stays `BLOCK`. The shorthands it splits into longhands are those of
  sides, of pairs, and `border`, `border-radius`, `flex`, `font`, `list-style`,
  `background-position` and `all`; `background`, `transition` and the rest are declared as
  themselves.
- `getComputedStyle` answers a percentage as written, reads no vertical writing mode, and answers
  a transform other than a move or a scale as written.

## Geometry and observers

- `getBoundingClientRect` and `getClientRects` as `DOMRect`s, `offsetParent`, and the `offset`,
  `client` and `scroll` sizes and positions, each read from where native last laid the element
  out, with what is pending committed first.
- `getComputedStyle` answers a `width` or `height` an element has none of its own of as it is
  drawn.
- Scrolling: an element whose style says `overflow: auto` or `scroll` scrolls what overflows it,
  with `scrollTop` and `scrollLeft` to read and write, `scroll`, `scrollTo`, `scrollBy` and
  `scrollIntoView`. `document.scrollingElement` is the root.
- The window: `screen`, `visualViewport`, and `matchMedia` with a `change` listener.
- `ResizeObserver`, and `IntersectionObserver` with a root, a margin and thresholds. An app that
  observes nothing pays nothing for them.

Gaps: `ResizeObserver` has no `device-pixel-content-box`, and `scrollIntoView` reads no
`scroll-margin` or `scroll-padding`. Elements have no browser default styles of their own: a `<div>`
is laid out as the engine lays out a view, and sized by its border box. The window does not scroll.
An inline element over two lines is one box around both, where a browser has two.
`IntersectionObserver` takes `trackVisibility` but its `isVisible` is never true, since nothing
tells it whether something is drawn over an element.

## Events

- `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `FocusEvent`, `TouchEvent`, `Touch` and the
  other kinds, with the members their init dictionaries give, and `document.createEvent` with
  each kind's `init*Event`.
- `window.event`, the event a listener is being told.
- Handler properties, `onclick` to `onwheel`.
- A press reaches a listener as a `PointerEvent`, a touch is the mouse going down and up as a
  phone's browser tells it, and a finger held still is a `contextmenu`.
- What a click does, from a press, a script or `element.click()`: a checkbox or a radio is checked
  and says `input` and `change`, a button submits or resets its form, and a label clicks or
  focuses its control.
- `focus()` and `blur()` take effect at once, on a button, a link or what has a `tabindex` as on a
  text field, with `document.activeElement`, `:focus`, and `focusin` and `focusout` heard on the
  document.
- A `<button>` and an `<a>` take a press with no listener, are `:active` while held and marked
  `data-hover` while a pointer is over them, and are announced as disabled while they are.

Gaps: `DragEvent`, `ClipboardEvent` and the other kinds not named here are not there. A handler
written as an attribute's text is not compiled, and the window and the document have no handler
properties. A field native refuses the focus to, a read-only one, is taken to have it until the
next focus or blur.

## Forms

- An `<input>` and a `<textarea>` are the platform's text field, as wide as a browser's, with
  `value` read as it is typed and `defaultValue` as written, `input` as it is typed and `change`
  once the edit ends, and each key as a `keydown` and `keyup` with its `key` and `keyCode`.
- Its `type`, `inputmode`, `autocomplete` and `maxlength` are the keyboard and entry native has for
  them, and `readOnly`, `disabled` or a disabled `<fieldset>` around it make it a field that cannot
  be typed into.
- A `<select>` shows its chosen `<option>`, has `value`, `selectedIndex`, `options` and `add()`,
  and opens a list of its options when it or its label is pressed.
- `checked` is the state a click, a script or a binding sets, and a radio checked unchecks the rest
  of its group.
- A control has `validity`, `willValidate`, `validationMessage`, `checkValidity()`,
  `reportValidity()` and `setCustomValidity()`, and `:valid`, `:invalid`, `:in-range`,
  `:out-of-range`, `:placeholder-shown`, `:checked`, `:indeterminate` and `:default` match.
- A field has `selectionStart`, `selectionEnd`, `setSelectionRange()` and `select()`, and a
  `<textarea>` says how tall its text is as `scrollHeight`.
- A file input's `click()` opens the system's file picker through `expo-document-picker`, which
  the app installs, or through a picker provided as `FILE_PICKER`.
- A form has `elements`, `requestSubmit()` and `reset()`, is submitted only once its controls pass
  their constraints, and `document.forms` lists the forms.

A plain app's `<text-input>` is unchanged.

Gaps: a `<select>` has one option chosen at a time, with no `multiple`, and no keyboard. A
submitted form goes nowhere, there being no page to leave, and its `submit` event has no
`submitter`. `form.submit()` does nothing. A key's `keyCode` is there for letters, digits, a comma
and the named keys, not for other punctuation.

## SVG

- An `<svg>` a template writes, markup builds or a script makes with `createElementNS` is drawn by
  react-native-svg's native views, the ones `@ng-native/icons` draws with: shapes, groups, texts
  and their spans, a text along a path, gradients and their stops, clips, masks, markers, patterns,
  a drop shadow and HTML in a `foreignObject`.
- Its elements have SVG's names and namespace, `className` as an object with `baseVal`,
  `getBBox`, `getComputedTextLength`, `ownerSVGElement` and `createSVGRect`.
- A style a script sets on a shape is its paint or its font, a paint that names a token is that
  token's colour, and a `light-dark()` paint is the side for the app's colour scheme, drawn again
  as the scheme changes.

Gaps: without react-native-svg's native views a drawing shows nothing, as an icon does. A
stylesheet's attribute selector does not match a drawing's attributes: `svg[width="16"]` matches
nothing. A marker is drawn from the `marker-start`, `marker-mid` and `marker-end` attributes, not
from a style. A filter draws its drop shadow and its blur; each other step passes on what it
is given. A paint written as `var()` is not followed to its token. `getBBox` does not follow a
rotation or a skew, and a curve's box includes its handles.

## Canvas

- A `<canvas>`'s 2D context draws with the same native views as an `<svg>`: paths, rectangles,
  arcs and rounded corners, strokes with their caps, joins and dashes, text, gradients, patterns,
  clips, transforms and `globalAlpha`.
- A canvas's `width` and `height` set the grid it draws on. A canvas drawn again each frame moves
  the shapes it has rather than making new ones.
- What is drawn reads back with `getImageData`, is put with `putImageData`, draws on another
  canvas with `drawImage`, and is written as a PNG by `toDataURL` and `toBlob`.
- `isPointInPath`, `isPointInStroke`, `measureText` and `globalCompositeOperation`, and
  `ImageData`, `CanvasRenderingContext2D`, `CanvasGradient` and `CanvasPattern` where the runtime
  has none.

Gaps:

- There is no bitmap. A clear of part of a canvas, and the ways of laying a drawing over what is
  there other than `source-over` (and `copy` where nothing clips it), change only the pixels read
  back.
- Drawing an `<img>` on a canvas draws nothing.
- Every shape drawn since the canvas was last cleared is a view, which suits a chart of some tens
  of shapes redrawn each frame and not one of thousands.
- `isPointInPath` takes no `Path2D` of its own.
- The `hue`, `saturation`, `color` and `luminosity` ways of laying a drawing over what is there are
  laid as `source-over`.
- What a script writes inside a canvas, its fallback in a browser, is not hidden.
- On a device `toBlob` hands its callback `null`, since React Native's `Blob` is not made of
  bytes. `toDataURL` answers there.

## Iframes and the page address

- The page has an address: the app's own URL with the route it is on, in `document.URL`,
  `documentURI`, `baseURI` and `window.location`. A `<base href>` in the head changes what it
  resolves against.
- A relative link, an image's `src`, a form's `action` and the other URLs an element's attributes
  say resolve against it. An `<a>` and an `<area>` have the parts of their URL (`protocol`, `host`,
  `pathname`, `search`, `hash` and the rest), and `:target` matches the element the address's
  fragment names.
- `location.assign()`, `replace()` and setting `href` or a part of it go to a page of the app
  through the router, and open any other URL with `Linking`.
- An `<iframe>` is a native web view, or a document of its own, with `contentWindow`,
  `postMessage` both ways, and `window.frames`.

Gaps: `location.reload()` does nothing. A frame's `loading` and the parts of `sandbox` other than
`allow-scripts` are left out, and development says so. An emulated frame is not drawn and runs no
script. [The page's address and frames](/packages/web-compat/address-and-frames) covers both in
full.
