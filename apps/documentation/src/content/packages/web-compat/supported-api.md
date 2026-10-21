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
- The properties HTML reflects attributes as: `hidden`, `title`, `dir`, `tabIndex`, `draggable`,
  `type`, the ARIA properties and the rest. `isContentEditable` is read from `contenteditable` on
  the element or the nearest element above it with a value other than `inherit` or one HTML does
  not define, and a text field answers `false`.
- A table's rows and cells, laid out in columns: a cell is as wide as the columns it is across
  (`colspan`), one down several rows (`rowspan`) is drawn over them, and the columns share the
  table's width by what their cells hold or by the widths the cells say. `table-layout: fixed`
  gives them one width.
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

Gaps: `:hover`, `:visited` and the state of a playing media element match nothing, as they do in
a browser where the state is not the case. A button or a link a pointer is over is marked
`data-hover` instead, which the Tailwind preset's `hover:` reads.

## CSSOM

- `document.styleSheets`, a `<style>`'s `sheet`, and `CSSStyleSheet`, made by a script too, with
  `replace`, `replaceSync` and `adoptedStyleSheets`.
- A sheet's rules, with `insertRule` and `deleteRule`, and the rest of the CSSOM's rule classes.
- A `<style>` a library makes while the app runs is read and applied: the layout properties,
  colours, borders, outlines, corners, custom properties and transitions it declares, `@media` by
  the window's width and height, which way up it is and the colour scheme and motion the user
  asked for, and `@supports`.
- `element.style` as a `CSSStyleDeclaration`: `cssText`, `setProperty`, `getPropertyValue`,
  `removeProperty` and each property by name, shorthands as their longhands, and the `style`
  attribute as its text. A style a library binds is set as what a native view reads.
- `getComputedStyle`, a `hidden` element drawn as `display: none`, and `CSS.escape` and
  `CSS.supports`.

Gaps:

- A rule in a sheet made while the app runs is passed over where its selector has a namespace,
  `:nth-child(... of S)` or a pseudo-class the engine does not track, `:hover` among them.
- A selector for a pseudo-element other than `::before` and `::after` (`::first-line`,
  `::selection`) is passed over, and the rule applies to the rest of its list. So is a `content`
  other than a string or `none` (a counter or `attr()`, say), and a value the engine drops,
  `display: table` among them.
- In a sheet made while the app runs, `border-inline`, `border-block` and their sides and
  longhands are passed over, as are a corner of two radii, a `calc()` or a second `var()` in a
  border or outline with a token in it, a `color-mix()` in `border`, `outline` or a side's
  shorthand, and an outline of `auto`.
- An `@import` loads nothing, so the sheet it makes is empty.
- `element.style` checks a value against what the property takes for the properties a script
  commonly sets, and drops one that does not match; any other longhand takes any value. A colour
  is written in lower case, and another keyword keeps the case it was written in:
  `display: BLOCK` stays `BLOCK`. The shorthands it splits into longhands are those of
  sides, of pairs, and `border`, `border-radius`, `flex`, `font`, `list-style`, `background`,
  `background-position` and `all`; `transition` and the rest are declared as themselves.
- `getComputedStyle` answers a percentage as written, reads no vertical writing mode, and answers
  a transform other than a move or a scale as written.

## Geometry and observers

- `getBoundingClientRect` and `getClientRects` as `DOMRect`s, `offsetParent`, and the `offset`,
  `client` and `scroll` sizes and positions, each read from where native last laid the element
  out, with what is pending committed first.
- `getComputedStyle` answers a `width` or `height` an element has none of its own of as it is
  drawn.
- An HTML element starts as a browser's own stylesheet has it, under every style an app or a
  library writes: sized `content-box`, so its padding and border add to its width and height, and
  a block where HTML has one (`div`, `p`, `section`, `ul`, `li`, a heading and the rest). A
  `<button>`, a `<select>` and a `<table>` are sized `border-box`. A `<view>`, a drawing's
  elements, and every element of an app that did not ask for the package keep the engine's own
  layout.
- Scrolling: an element whose style says `overflow: auto` or `scroll` scrolls what overflows it,
  with `scrollTop` and `scrollLeft` to read and write, `scroll`, `scrollTo`, `scrollBy` and
  `scrollIntoView`. `document.scrollingElement` is the root.
- The window: `screen`, `visualViewport`, `devicePixelRatio` as the screen's pixels in a point,
  and `matchMedia` with a `change` listener.
- `ResizeObserver`, and `IntersectionObserver` with a root, a margin and thresholds. An app that
  observes nothing pays nothing for them.
- `navigator.userAgent` names a phone of the platform the app runs on (an iPhone on iOS, an Android
  phone on Android) and `navigator.maxTouchPoints` is 5, so a library that picks touch handling
  from them does. A user agent that already names a browser, and a touch count the runtime has, are
  left alone.
- Stand-ins for what a library asks of the window: `localStorage` and `sessionStorage` held in
  memory for as long as the app is up and empty at the start of the next, `getSelection()` on the
  window and the document with nothing selected, `open()` returning `null`, and a `ShadowRoot`
  that nothing is an instance of. A global the runtime already has is left alone.

Gaps: `ResizeObserver` has no `device-pixel-content-box`, `matchMedia` does not read
`resolution` or `-webkit-device-pixel-ratio`, and `scrollIntoView` reads no `scroll-margin` or
`scroll-padding`. An element's browser defaults are its box sizing and whether it is a block,
with no margins and no heading sizes. A table's columns are worked out again when a row or a
cell is put in or taken out or a span changes, and not when what a cell holds changes;
`border-collapse`, `border-spacing` and `caption-side` are not read. The window does not
scroll. Nothing kept in `localStorage` outlives the app, and nothing can be selected.
An inline element over two lines is one box around both, where a browser has two.
A table's `clientTop` and `clientLeft` are its border's width with `border-collapse: collapse`
too, where Chrome answers half of it. A table whose overflow is `scroll` or `auto` scrolls, where
Chrome draws it as `visible`; an `IntersectionObserver` sees it as Chrome does.
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
- A `touchmove` listener that is not passive and calls `preventDefault()` stops the scroll view
  the finger is over from scrolling until the touch ends or is canceled, as a slider or a carousel
  asks a browser to. A `touchstart`, `touchmove` or `wheel` listener on the window, the document
  or the body is passive unless it says `passive: false`, as in a browser. Preventing a
  `pointermove`'s default does not, as in a browser: `touch-action` keeps a pointer's drag from
  the page.

Gaps: `DragEvent`, `ClipboardEvent` and the other kinds not named here are not there. A handler
written as an attribute's text is not compiled, and the window and the document have no handler
properties. A field native refuses the focus to, a read-only one, is taken to have it until the
next focus or blur. A move whose default is prevented after the page has started to scroll
stops the scroll where it is, where a browser lets it go on: native has the touch a frame or so
before a listener hears of it.

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
- `document.execCommand('copy')` puts the text selected in the field last given `select()` (the
  range selected, or all of it where none is) on the clipboard through `expo-clipboard`, which the
  app installs. It answers `false` with no such field, without the module, and for any other
  command.
- A file input's `click()` opens the system's file picker through `expo-document-picker`, which
  the app installs.
- A `<fieldset>`'s `<legend>` sits on the fieldset's top border, the border running through the
  middle of the legend's height, as the legend's measured height is known. A fieldset with no
  border leaves it where it is written.
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
  canvas with `drawImage`, and is written as a PNG by `toDataURL` and `toBlob`. Text is not in
  those pixels, so it is not read back or drawn onto another canvas.
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
`allow-scripts` and `allow-same-origin` are left out, and development says so. An emulated frame is
not drawn and runs no script. [The page's address and
frames](/packages/web-compat/address-and-frames) covers both in full.
