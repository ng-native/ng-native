import { registerViewName, type Engine, type EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';

/**
 * The HTML elements a library writes that the engine has no view for, each a plain view with the
 * role a browser gives it. A component an app has for the same name still takes it.
 */
const ROLES: Readonly<Record<string, string>> = { button: 'button', a: 'link' };

/**
 * The elements with no role to give and no view of their own: a table's and a form's, each a
 * plain view for a stylesheet to lay out. A table has no layout of its own here.
 */
const PLAIN = [
  ...['table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
  ...['form', 'fieldset', 'legend', 'hr'],
];

/** The platform's text field, which an `<input>` and a `<textarea>` are. */
const TEXT_FIELD = { ios: 'TextInput', android: 'AndroidTextInput' };

/**
 * What Android gives a text field that a browser does not: a line under it, and padding above
 * and below its text, which a field shorter than the two clips its text on. A stylesheet's own
 * padding replaces these.
 */
const FIELD_DEFAULTS = { underlineColorAndroid: 'transparent', paddingTop: 0, paddingBottom: 0 };

/** Register the elements above, and answer what takes them away again. */
export function registerElements(): () => void {
  const yieldsToComponents = { yieldsToComponents: true };
  const undo = [
    ...[...Object.keys(ROLES), ...PLAIN].map((name) =>
      registerViewName(name, 'View', undefined, yieldsToComponents),
    ),
    ...['input', 'textarea'].map((name) =>
      registerViewName(name, TEXT_FIELD, FIELD_DEFAULTS, yieldsToComponents),
    ),
  ];
  return () => undo.forEach((each) => each());
}

/**
 * Give an element what it has for its name alone, in an app that asked for this package.
 * Answers whether it is one a press is aimed at.
 */
export function created(node: EngineNode, engine: Engine): boolean {
  const role = ROLES[node.name];
  if (!role || !documentOf(engine)) return false;
  // Props a binding can replace, as it can any other: `role="tab"` on a button is a tab.
  engine.setProp(node, 'accessibilityRole', role);
  engine.setProp(node, 'accessible', true);
  // A keyboard, a switch control or a remote can reach it, which is where `:focus` comes from.
  engine.setProp(node, 'focusable', true);
  // `:hover`, for the devices with a pointer: the Tailwind preset reads it as `data-hover`.
  // ponytail: on the elements a pointer is aimed at. A stylesheet's `:hover` on any other
  // element never matches; track every element with a hover rule if a library needs it.
  engine.setEventListener(node, 'topPointerEnter', () => engine.setProp(node, 'data-hover', true));
  engine.setEventListener(node, 'topPointerLeave', () => engine.setProp(node, 'data-hover', null));
  return true;
}
