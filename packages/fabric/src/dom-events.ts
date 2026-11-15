/**
 * The DOM events a template can bind on an element that a host sends under another name: the
 * mouse events as React Native's pointer events, and `dblclick`, `contextmenu` and `wheel` as
 * element events of a desktop host. A binding of any other name listens for the engine event of
 * its own name, `(scroll)` for `topScroll`.
 *
 * `@ng-native/metro`'s `dom-events.cjs` is the build-time table the lint rule and the build
 * warning read; `dom-events.test.ts` holds the two to the same names.
 */
export const DOM_EVENT_TYPES: Readonly<Record<string, string>> = {
  mouseenter: 'topPointerEnter',
  mouseleave: 'topPointerLeave',
  mousemove: 'topPointerMove',
  mouseover: 'topPointerOver',
  mouseout: 'topPointerOut',
  dblclick: 'topDoubleClick',
  contextmenu: 'topContextMenu',
  wheel: 'topWheel',
};

/** The mouse events, which a finger's pointer events are not. */
export const MOUSE_EVENTS: ReadonlySet<string> = new Set([
  'mouseenter',
  'mouseleave',
  'mousemove',
  'mouseover',
  'mouseout',
]);
