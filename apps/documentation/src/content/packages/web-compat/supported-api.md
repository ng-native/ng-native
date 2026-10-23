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
  for overlays (what a library puts in it is first seen in the frame after, by when it has been
  measured and styled, as a browser first paints it, and stays a view native does not flatten
  away), a doctype, `createElementNS`, `createTreeWalker` and `createNodeIterator`, and a
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
- `document.elementFromPoint` and `elementsFromPoint` answer the element drawn at a point of the
  window, the deepest and the last of those beside each other first. They pass over an element
  with `pointer-events: none` (but not what inside it takes touches again) or `display: none`,
  and what a box that clips its overflow does not draw, and read no `z-index`.
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
- The window starts under the navigation header of the screen in sight and ends at the top of the
  keyboard while it is up, as a browser on a phone ends its window there: `innerHeight`,
  `visualViewport` and where an element or a touch is are read from there, `resize` is sent as
  either moves, and `document.body`, where an overlay goes, covers just that part of the screen,
  with what is `fixed` in it fixed to it. On Android, which draws an app under its system bars,
  the window is as tall as the app is drawn. `screen` and `matchMedia` read the whole screen.
- On Android, where `react-native-screens` measures a view in a screen from under its navigation
  header, an element in a screen is placed where it is drawn and touched, so a library that
  compares a finger with what it measured finds the element under the finger. A touch says
  whether native measures short, and until one does an element in a screen is taken to be.
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
The window starts under the header of the newest screen in the tree, which is the one in sight
in a stack: with two stacks side by side it is the header of whichever pushed a screen last.

## Animations

- `getAnimations()` on an element, and with `{ subtree: true }` on what it holds as well, gives
  each `@keyframes` animation and transition the engine runs there as a Web Animations
  `Animation`, the same one each time it is asked, with its `animationName` or
  `transitionProperty`, its `playState` and its `effect`'s `target`. A `@keyframes` animation
  that has finished and still shows its last frame, by its own fill or one `updateTiming` asked
  for, is still there, `finished`.
- `finished` resolves with the animation when the engine ends it, and rejects with an
  `AbortError` when it stops first: the element no longer asks for it, it is taken away, or its
  app goes. A library waits on it before it takes a leaving element away.
- `effect.getComputedTiming()` says how far it has got: `progress`, `currentIteration`,
  `localTime`, `activeDuration` and `endTime`, with its `delay`, the `duration` of one iteration,
  `iterations`, `fill` and `direction`. `effect.getTiming()` is what Angular's `animate.leave`
  reads, and its `duration` is the whole run, every iteration.
- `effect.updateTiming({ fill: 'forwards' })` holds an `@keyframes` animation at its last frame
  once it ends, as `animation-fill-mode: forwards` does, and `fill: 'none'` lets it go again.
- `finish()` resolves `finished` at once, and throws an `InvalidStateError` for an animation that
  never ends; `cancel()` rejects it.

Gaps: `finish()` and `cancel()` settle `finished` and `playState` and leave the frames to the
engine, which plays on until the element is taken away or no longer asks for the animation.
`updateTiming` reads only `fill`, and does nothing to a transition. There is no `play()`,
`pause()`, `reverse()`, `playbackRate`, `ready`, `element.animate()` or
`document.getAnimations()`. A transition's delay is in its start, so its `delay` reads 0.

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
  document. What is not a text field is scrolled into sight only where `focus()` answers a touch,
  as a form sends its user to a field to put right, and never with `{ preventScroll: true }`.
- A `<button>` and an `<a>` take a press with no listener, are `:active` while held and marked
  `data-hover` while a pointer is over them, and are announced as disabled while they are.
- A `touchmove` listener that is not passive and calls `preventDefault()` stops the scroll view
  the finger is over from scrolling until the touch ends or is canceled, as a slider or a carousel
  asks a browser to. A `touchstart`, `touchmove` or `wheel` listener on the window, the document
  or the body is passive unless it says `passive: false`, as in a browser. Preventing a
  `pointermove`'s default does not, as in a browser: `touch-action` keeps a pointer's drag from
  the page.
- An element moved to another parent, or taken out, while a finger is on it or on something in it
  keeps the touch, as in a browser: a native view moved to another parent loses it. The document
  has the element where it was put at once, and native is told when the last finger lifts or the
  touch is canceled; until then it is drawn where it was, as it is styled while it is still in
  the page and as it was last drawn once it is taken out. Where the parent it was in leaves the
  page first, it is drawn where it is from then on. CDK's drag and drop puts the element it drags
  on the body as the drag begins.

Gaps: `DragEvent`, `ClipboardEvent` and the other kinds not named here are not there. A handler
written as an attribute's text is not compiled, and the window and the document have no handler
properties. A field native refuses the focus to, a read-only one, is taken to have it until the
next focus or blur. A move whose default is prevented after the page has started to scroll
stops the scroll where it is, where a browser lets it go on: native has the touch a frame or so
before a listener hears of it. An element moved with a finger on it is drawn where it was until
the finger lifts, so a library that moves one in sight while a finger is on it, and not out of
sight as a drag does, shows the move late. One in a line of inline boxes moves at once.

## Forms

- An `<input>` and a `<textarea>` are the platform's text field, as wide as a browser's, with
  `value` read as it is typed and `defaultValue` as written, `input` as it is typed and `change`
  once the edit ends, and each key as a `keydown` and `keyup` with its `key` and `keyCode`.
- A field is twenty characters wide until its `size` (a text area's `cols`) says otherwise, and a
  `size` or `cols` of zero or less says nothing. A `caret-color` set on a field in `style` is its
  `selectionColor`, and `transparent` hides its caret, as a one-time code field does to draw its
  own.
- Its `type`, `inputmode`, `autocomplete` and `maxlength` are the keyboard and entry native has for
  them, and `readOnly`, `disabled` or a disabled `<fieldset>` around it make it a field that cannot
  be typed into.
- An `<input type="range">` is no text field. Its value is kept within its `min` and `max`, 0 to
  100 with none written, on its `step`, and is the middle with none set, as HTML has it. It has
  `valueAsNumber`, `stepUp()` and `stepDown()`, as a number input does, and a finger dragged across
  it moves the value to where the finger is, with `input` as it moves and `change` as the finger
  lifts. Material's slider is built on one.
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
and the named keys, not for other punctuation. A range input draws nothing of its own, where a
browser draws a track and a thumb: a library draws those over it. Its value runs left to right in
a page written right to left too, and a date's or a time's `valueAsNumber` is `NaN`.

## SVG

- An `<svg>` a template writes, markup builds or a script makes with `createElementNS` is drawn by
  react-native-svg's native views, the ones `@ng-native/icons` draws with: shapes, groups, links
  (drawn as a group of what they hold), texts and their spans, a text along a path, gradients and
  their stops, clips, masks, markers, patterns, a drop shadow and HTML in a `foreignObject`, which
  is the whole drawing for each of `x`, `y`, `width` and `height` it does not say.
- Its elements have SVG's names and namespace, `className` as an object with `baseVal`,
  `getBBox`, `getComputedTextLength`, a text's `getNumberOfChars` and `getSubStringLength`,
  `ownerSVGElement` and `createSVGRect`.
- A style a script sets on a shape is its paint or its font, a paint that names a token is that
  token's colour, and a `light-dark()` paint is the side for the app's colour scheme, drawn again
  as the scheme changes.
- A `<path>` of thousands of straight segments that go one way across, a chart's line series, is
  drawn thinned to the lowest and highest point of each point-wide column: react-native-svg on
  iOS takes seconds over a stroke that long. `getAttribute('d')` and `getBBox` read the whole
  path. A curve, a relative command, a path that turns back so often that no run is long, or one
  under a rotation or a skew, or in a drawing whose width is not in points, is drawn as written.
  A long line a `<canvas>` draws is thinned the same way, each time it is drawn again.
- A shape with a listener for a touch, a click, a pointer or the mouse takes the touch, as does
  every shape in a group or a drawing with one, for as long as the listener is there.
- A touch native finds no shape for, as one between the letters of a text, is on the text,
  rectangle, circle or ellipse whose box is under the finger, in a shape that listens.
- A touch on a shape sends `mouseover` to it and `mouseenter` to it and what it is in, after the
  touch events and not for a touch a listener cancels, as a phone's browser sends the mouse events
  of a tap: a chart shows a series' tooltip. The mouse stays there as the finger lifts, and goes
  `mouseout` and `mouseleave` when a finger comes down on another shape or anywhere else.

Gaps: without react-native-svg's native views a drawing shows nothing, as an icon does. A
stylesheet's attribute selector does not match a drawing's attributes: `svg[width="16"]` matches
nothing. A marker is drawn from the `marker-start`, `marker-mid` and `marker-end` attributes, not
from a style. A filter draws its drop shadow and its blur; each other step passes on what it
is given. A paint written as `var()` is not followed to its token. `getBBox` does not follow a
rotation or a skew, and a curve's box includes its handles. A path native finds no touch on is
not found by its box, and the mouse a touch is goes over a drawing's shapes only, not over other
elements.

## Images

- An `<img>` is the platform's image view, shown from its `src`, which resolves against the page's
  address when it is set. Its `alt` is what a screen reader says, and an
  image with an empty one is passed over.
- Its `width` and `height` attributes are its size, in points or as a share of what it is in,
  under any size a stylesheet gives it. Where nothing sizes it, it is the size of its picture once
  that has loaded, and given one side it keeps the picture's shape.
- `naturalWidth`, `naturalHeight` and `complete` say what has loaded, `load` and `error` are told
  as native says them, and `width` and `height` read the attribute or the picture's size.
- Its picture fills its box, as `object-fit: fill` has it, and a stylesheet's `object-fit` is how
  the picture fits; what is past the box is clipped.
- A picture that is an SVG, by its name, is fetched and drawn as an `<svg>` a template writes, at
  the drawing's own size, with no element of it in the page. As a browser draws an SVG as an
  image, only its shapes are drawn: a `foreignObject` or a `script` in it, and any HTML, is left
  out, so nothing in it is fetched or framed.
- An image clipped to a band of itself from side to side,
  `clip-path: polygon(a 0, b 0, b 100%, a 100%)` with `a` and `b` percentages, is drawn through
  the band: one picture over another, cut where a before-and-after slider is. The band is a
  library's stylesheet's or one a script sets in `style.clipPath`, and the image follows it as it
  moves and is whole once it goes.

Gaps: `srcset`, `sizes`, `loading` and `decoding` are kept as attributes, and the picture is the
one `src` names. An image whose picture is an SVG is drawn whole, and a band of a `<style>` made
while the app runs is not read. `width` and `height` read the attribute or the picture, not the size
the image is
laid out at. There is no `Image` constructor. A `src` is resolved when it is set, and not again
when the page's address changes.

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
- An `<img>` drawn on a canvas is drawn once its picture has loaded, and is not in the pixels read
  back, where it is transparent. One whose picture is an SVG draws nothing.
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
