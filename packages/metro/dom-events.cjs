/**
 * The DOM events a template can bind that a device does not send under that name, with what to
 * bind instead: one table for `@ng-native/eslint-plugin`'s `no-dom-events` and
 * `desktop-only-events` rules and for the warning the build gives, so the two cannot disagree.
 *
 * An event with `desktop` set is sent by a desktop host, as the engine event named, and by no
 * phone: the mouse events as React Native's pointer events, which a finger's are not, and
 * `dblclick`, `contextmenu` and `wheel` as events of their own. `@ng-native/fabric`'s
 * `DOM_EVENT_TYPES` maps them at runtime, and a test holds the two to the same names.
 *
 * Only names no native view or Angular Native component uses are here: `change`, `load`, `error`,
 * `focus` and `blur` are outputs or native events of some element and are left alone.
 */
'use strict';

const PRESS = '(press) on a <pressable>, or <text pressable (press)="...">';
const GESTURE = 'a [gesture] from @ng-native/components';

/** @typedef {{ instead: string, desktop?: string }} DomEvent */

/** @type {ReadonlyMap<string, DomEvent>} */
const DOM_EVENTS = new Map(
  /** @type {[string, DomEvent][]} */ ([
    ['click', { instead: PRESS }],
    ['dblclick', { instead: PRESS, desktop: 'topDoubleClick' }],
    ['contextmenu', { instead: '(longPress) on a <pressable>', desktop: 'topContextMenu' }],
    ['mousedown', { instead: '(pressIn) on a <pressable>' }],
    ['mouseup', { instead: '(pressOut) on a <pressable>' }],
    ['input', { instead: '(changeText) or [(value)] on a <text-input>' }],
    ['beforeinput', { instead: '(changeText) on a <text-input>' }],
    ['keydown', { instead: '(keyPress) or (submitEditing) on a <text-input>' }],
    ['keyup', { instead: '(keyPress) or (submitEditing) on a <text-input>' }],
    ['keypress', { instead: '(keyPress) on a <text-input>' }],
    [
      'submit',
      { instead: '(submitEditing) on a <text-input>, or (press) on a submit <pressable>' },
    ],
    ['wheel', { instead: '(scroll) on a <scroll-view>', desktop: 'topWheel' }],
    ['mouseenter', { instead: GESTURE, desktop: 'topPointerEnter' }],
    ['mouseleave', { instead: GESTURE, desktop: 'topPointerLeave' }],
    ['mousemove', { instead: GESTURE, desktop: 'topPointerMove' }],
    ['mouseover', { instead: GESTURE, desktop: 'topPointerOver' }],
    ['mouseout', { instead: GESTURE, desktop: 'topPointerOut' }],
    ...['drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop'].map(
      (name) => [name, { instead: 'a pan [gesture] from @ng-native/components' }],
    ),
    ...['copy', 'cut', 'paste'].map((name) => [
      name,
      { instead: '(changeText) on a <text-input>' },
    ]),
  ]),
);

/** The OSes in `expo.platforms` that are desktops, where an event with `desktop` set fires. */
const DESKTOP_PLATFORMS = new Set(['macos']);

/**
 * The elements from @ng-native/components whose names have a hyphen. An element without one is
 * HTML's or a primitive's; any other hyphenated one is a component, which may declare an output
 * called `drag` or `drop`, so its events are its own business.
 */
const NATIVE_ELEMENTS = new Set([
  'activity-indicator',
  'gesture-root',
  'gradient-text',
  'image-background',
  'input-accessory-view',
  'keyboard-avoiding-view',
  'keyboard-controller-view',
  'keyboard-dock',
  'keyboard-gesture-area',
  'keyboard-motion-view',
  'menu-bar',
  'menu-group',
  'menu-item',
  'menu-separator',
  'native-button',
  'refresh-control',
  'safe-area-provider',
  'safe-area-view',
  'scroll-view',
  'section-list',
  'sidebar-item',
  'sidebar-section',
  'split-view',
  'split-view-content',
  'text-input',
  'touchable-opacity',
  'tray-icon',
  'virtual-list',
]);

/** Whether an element is a native view, whose events are the device's rather than a component's. */
const isNativeElement = (name) => !name.includes('-') || NATIVE_ELEMENTS.has(name);

/**
 * An element, a listener, or the start of a component's host bindings, in Angular's compiled
 * output. A listener comes straight after the element it is on, before anything inside it.
 */
const INSTRUCTION = /ɵɵ(elementStart|element|listener)\((?:\d+,\s*)?"([^"]+)"|(_HostBindings)\(/g;

/**
 * Each binding in compiled code to a DOM event no OS sends, on a native element or on a component's
 * own host, which is a plain view: once each, as `(click) on <view>`, with what to bind instead.
 * The events a desktop sends are not among them.
 */
function unsentEvents(code) {
  const found = new Map();
  let element = null;
  for (const [, kind, name, host] of code.matchAll(INSTRUCTION)) {
    if (host) element = 'host';
    else if (kind !== 'listener') element = name;
    else {
      const known = DOM_EVENTS.get(name.split('.')[0]);
      const native = element === 'host' || (element !== null && isNativeElement(element));
      if (!known || known.desktop || !native) continue;
      const where =
        element === 'host' ? `(${name}) on a component's host` : `(${name}) on <${element}>`;
      found.set(where, known.instead);
    }
  }
  return [...found].map(([where, instead]) => ({ where, instead }));
}

module.exports = { DOM_EVENTS, DESKTOP_PLATFORMS, NATIVE_ELEMENTS, isNativeElement, unsentEvents };
