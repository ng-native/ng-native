import { registerViewName, type Engine, type EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';

/**
 * The HTML elements a library writes that the engine has no view for, each a plain view with the
 * role a browser gives it. A component an app has for the same name still takes it.
 */
const ROLES: Readonly<Record<string, string>> = { button: 'button', a: 'link' };

/** Register the elements above, and answer what takes them away again. */
export function registerElements(): () => void {
  const undo = Object.keys(ROLES).map((name) =>
    registerViewName(name, 'View', undefined, { yieldsToComponents: true }),
  );
  return () => undo.forEach((each) => each());
}

/** Give an element what it has for its name alone, in an app that asked for this package. */
export function created(node: EngineNode, engine: Engine): void {
  const role = ROLES[node.name];
  if (!role || !documentOf(engine)) return;
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
}
