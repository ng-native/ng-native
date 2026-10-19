import { registerViewName, type Engine, type EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';

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

/** Register the elements above, and answer what takes them away again. */
export function registerElements(): () => void {
  const yieldsToComponents = { yieldsToComponents: true };
  const undo = [...Object.keys(ROLES), ...PLAIN, ...UNDRAWN].map((name) =>
    registerViewName(name, 'View', undefined, yieldsToComponents),
  );
  return () => undo.forEach((each) => each());
}

/**
 * Give an element made in an app that asked for this package the role a browser gives one of
 * its name: a button is a button, and a link a link, to accessibility and to a keyboard. Props a
 * binding can replace, as it can any other: `role="tab"` on a button is a tab.
 */
export function giveRole(node: EngineNode, engine: Engine): void {
  const role = ROLES[node.tag];
  if (!role || !documentOf(engine)) return;
  engine.setProp(node, 'accessibilityRole', role);
  engine.setProp(node, 'accessible', true);
  // A keyboard, a switch control or a remote can reach it, which is where `:focus` comes from.
  engine.setProp(node, 'focusable', true);
}
