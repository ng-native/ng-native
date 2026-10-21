import type { Engine, EngineNode } from '@ng-native/fabric';
import { fenceField } from './field.ts';

/**
 * A disabled `<fieldset>` disables the controls in it, but for those in its first `<legend>`:
 * none of them takes a press, and no field in one can be typed into. Worked out as a control is
 * pressed, and for a field as it comes into the page and as a fieldset around it changes.
 */

/** A boolean HTML attribute or property: present, and not `false`. */
const on = (value: unknown): boolean => value != null && value !== false && value !== 'false';

/** Whether a disabled fieldset is around a node, outside that fieldset's first legend. */
export function fenced(node: EngineNode): boolean {
  let child = node;
  for (let at = node.parent; at; child = at, at = at.parent) {
    if (at.tag !== 'fieldset' || !on(at.props['disabled'])) continue;
    const legend = at.childList.find((each) => each.tag === 'legend');
    if (child !== legend) return true;
  }
  return false;
}

/** Each field at or under a node, as able to be typed into as the fieldsets around it leave it. */
export function fenceUnder(node: EngineNode, engine: Engine): void {
  if (node.nodeKind !== 'element') return;
  fenceField(node, fenced(node), engine);
  for (const child of node.childList) fenceUnder(child, engine);
}
