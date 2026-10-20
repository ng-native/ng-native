import {
  registeredViewName,
  registerViewName,
  scrollsOverflow,
  type Engine,
  type EngineNode,
} from '@ng-native/fabric';
import { documentOf } from './document.ts';
import { nameRecordOf, XHTML } from './qualified-name.ts';

/**
 * The HTML elements a library writes that the engine has no view for, each a plain view, with
 * the role a browser gives it where it has one. A component an app has for the same name still
 * takes it.
 */
const ROLES: Readonly<Record<string, string>> = { button: 'button', a: 'link' };

/** The elements with no role to give and no view of their own: a table's and a form's. */
const PLAIN = [
  ...['table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
  ...['form', 'fieldset', 'legend', 'hr', 'blockquote', 'br'],
  ...['select', 'option', 'optgroup'],
];

/**
 * What a browser draws nothing of, which is a view all the same: a table's columns, a stylesheet,
 * and what a page is called, runs, links to and says of itself.
 */
const UNDRAWN = [
  ...['colgroup', 'col', 'style', 'title', 'script', 'template', 'head', 'link', 'meta'],
  ...['area', 'base', 'datalist', 'noembed', 'noframes', 'param', 'rp'],
];

/**
 * The platform's text field, which an `<input>` and a `<textarea>` are. With no defaults of the
 * view's: the engine keeps those after the name is given back, for every app's `<text-input>`.
 * A field's own are given it as it is made: see `field.ts`.
 */
const TEXT_FIELD = { ios: 'TextInput', android: 'AndroidTextInput' };

/** Register the elements above, and answer what takes them away again. */
export function registerElements(): () => void {
  const yieldsToComponents = { yieldsToComponents: true };
  const undo = [
    ...[...Object.keys(ROLES), ...PLAIN, ...UNDRAWN].map((name) =>
      registerViewName(name, 'View', undefined, yieldsToComponents),
    ),
    ...['input', 'textarea'].map((name) =>
      registerViewName(name, TEXT_FIELD, undefined, yieldsToComponents),
    ),
  ];
  return () => undo.forEach((each) => each());
}

/**
 * Give an element made in an app that asked for this package the role a browser gives one of
 * its name: a button is a button, and a link a link, to accessibility and to a keyboard. Props a
 * binding can replace, as it can any other: `role="tab"` on a button is a tab. Answers whether it
 * is one, which a press is aimed at.
 */
export function giveRole(node: EngineNode, engine: Engine): boolean {
  const role = ROLES[node.tag];
  if (!role || !documentOf(engine)) return false;
  engine.setProp(node, 'accessibilityRole', role);
  engine.setProp(node, 'accessible', true);
  // A keyboard, a switch control or a remote can reach it, which is where `:focus` comes from.
  engine.setProp(node, 'focusable', true);
  // `:hover`, for the devices with a pointer: the Tailwind preset reads it as `data-hover`.
  // ponytail: on the elements a pointer is aimed at. A stylesheet's `:hover` on any other
  // element never matches; track every element with a hover rule if a library needs it.
  // One the app wrote is the app's, and left as it is.
  engine.setEventListener(node, 'topPointerEnter', () => {
    if (node.props['data-hover'] != null) return;
    hovered.add(node);
    engine.setProp(node, 'data-hover', true);
  });
  engine.setEventListener(node, 'topPointerLeave', () => {
    if (hovered.delete(node)) engine.setProp(node, 'data-hover', null);
  });
  return true;
}

/** The elements whose `data-hover` is the pointer over them, and no attribute. */
const hovered = new WeakSet<EngineNode>();

/** Whether an element's `data-hover` is the one the pointer over it gives, and no attribute. */
export const marksHover = (node: EngineNode): boolean => hovered.has(node);

/** An app wrote an element's `data-hover`, which is its own from then on. */
export const hoverWritten = (node: EngineNode): void => void hovered.delete(node);

/** HTML's elements that the engine has a view for already, and so a registered name. */
const HTML_ELEMENTS = new Set([
  ...['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'ul', 'ol', 'li'],
  ...['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'strong', 'b', 'em', 'i'],
  ...['u', 's', 'small', 'code', 'mark', 'abbr', 'cite', 'time', 'img', 'input', 'textarea'],
  ...Object.keys(ROLES),
  ...PLAIN,
  ...UNDRAWN,
]);

/**
 * Whether a custom element is a browser's: one a library the app named to the build has a
 * selector for, which the build lists as each of its modules loads. Every other custom element
 * is the native view it is without this package.
 */
const named = (name: string): boolean =>
  (globalThis as { ɵngNativeBrowserElements?: ReadonlySet<string> }).ɵngNativeBrowserElements?.has(
    name.toLowerCase(),
  ) ?? false;

/** Whether a name is an element a browser has: one of HTML's, or a custom element named as one. */
const isHtml = (name: string): boolean =>
  HTML_ELEMENTS.has(name) ||
  (registeredViewName(name) === undefined && (!name.includes('-') || named(name)));

/**
 * What a browser's own stylesheet starts an HTML element at, under every style an app or a
 * library writes. Its padding and border are outside the width and height it is given, where a
 * native view's are inside them.
 */
const CONTENT_BOX = { boxSizing: 'content-box' };
/**
 * What a browser sizes whole, its padding and border inside its size: a button, a select, and a
 * table, which is no block and keeps the engine's layout.
 */
const WHOLE = { boxSizing: 'border-box' };
/**
 * The elements a browser lays out as blocks: one under the other, as wide as what holds them.
 * A paragraph and a heading are text to the engine, and blocks to what holds them. A table's
 * parts are not blocks in a browser, and keep the engine's layout.
 */
const BLOCKS = new Set([
  ...['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'address'],
  ...['ul', 'ol', 'li', 'dl', 'dt', 'dd', 'menu', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  ...['hgroup', 'pre', 'blockquote', 'figure', 'figcaption', 'hr', 'form', 'fieldset', 'legend'],
  ...['details', 'summary', 'search'],
]);
const BLOCK = { ...CONTENT_BOX, display: 'block' };
const SIZED_WHOLE = new Set(['button', 'select', 'table']);

/**
 * What a browser's own stylesheet gives an HTML element of this one's name, in an app that asked
 * for this package. None for an element of a drawing, which SVG sizes itself, nor one a script
 * made in no namespace or another, which has no browser default.
 */
export function defaultsOf(node: EngineNode, engine: Engine): Record<string, unknown> | undefined {
  if (node.namespace !== undefined || !isHtml(node.tag) || !documentOf(engine)) return undefined;
  const record = nameRecordOf(node);
  if (record && record.namespace !== XHTML) return undefined;
  return SIZED_WHOLE.has(node.tag) ? WHOLE : BLOCKS.has(node.tag) ? BLOCK : CONTENT_BOX;
}

/**
 * Give an element what `defaultsOf` says, where it says anything: one made, and a copy
 * `cloneNode` makes, which is given it by its name and not by what the element has now: a
 * field's and a select's own defaults are added to it.
 */
export function giveDefaults(node: EngineNode, engine: Engine): void {
  const style = defaultsOf(node, engine);
  if (style) engine.setDefaultStyle(node, style);
}

/**
 * Have an element made in an app that asked for this package scroll what overflows it where its
 * style says `overflow: auto` or `scroll`, as a browser's does: a list of options in a panel. The
 * engine's own views, a `<view>` or a `<scroll-view>`, keep what they are, a text field
 * scrolls its own text, and is no field as a scroll view, and a table scrolls nothing, as Chrome
 * draws one.
 */
export function scrollWhereStyled(node: EngineNode, engine: Engine): void {
  if (node.tag === 'input' || node.tag === 'textarea' || node.tag === 'table') return;
  if (isHtml(node.tag) && documentOf(engine)) scrollsOverflow(node);
}
