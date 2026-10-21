import type { Engine, EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';

const textOf = (node: EngineNode): string =>
  node.nodeKind === 'text' ? node.nodeText : node.childList.map(textOf).join('');

/**
 * Click the control a label is for, answering false for one that is typed into, which is
 * focused: a browser clicks a button, a checkbox or a radio where it focuses a text field. Set
 * by what hears the clicks, which is where a control's listeners are.
 */
export const labelPress: { click?: (control: EngineNode) => boolean } = {};

/**
 * What a press on a label, or a click a script sends it, does to its control: clicks it, or
 * focuses one that is typed into.
 */
export function pressControl(control: EngineNode, engine: Engine): void {
  if (!labelPress.click?.(control)) engine.focus(control);
}

/** The elements a label can be for. */
const LABELABLE = new Set(['input', 'textarea', 'select', 'button', 'meter', 'output', 'progress']);

/**
 * The control a label is for: the element its `for` names, or the first one inside it that a
 * label can be for, where it names none.
 */
export function controlOf(label: EngineNode, engine: Engine): EngineNode | null {
  const named = label.props['for'] ?? label.props['htmlFor'];
  if (named != null) {
    const find = documentOf(engine)?.['getElementById'] as
      ((id: string) => EngineNode | null) | undefined;
    return find?.(String(named)) ?? null;
  }
  return firstLabelable(label);
}

function firstLabelable(node: EngineNode): EngineNode | null {
  for (const child of node.childList) {
    if (child.nodeKind !== 'element') continue;
    if (LABELABLE.has(child.tag)) return child;
    const inside = firstLabelable(child);
    if (inside) return inside;
  }
  return null;
}

/** Each label's press handler, by label: a label has one control, and one way to reach it. */
const presses = new WeakMap<EngineNode, () => void>();

/** The control each label named, with the name it gave it. */
const named = new WeakMap<EngineNode, { readonly control: EngineNode; readonly name: string }>();

/** What each label was last given, which a name worked out for an earlier one is not. */
const latest = new WeakMap<EngineNode, object>();

/** Take back the name a label gave its control, where the control still has it. */
function unname(label: EngineNode, engine: Engine): void {
  const had = named.get(label);
  named.delete(label);
  if (had && had.control.props['accessibilityLabel'] === had.name) {
    engine.setProp(had.control, 'accessibilityLabel', null);
  }
}

/**
 * `<label for="id">`: the control with that id is named by the label, and a press on the label
 * goes to it, as a click does in a browser. Answers false: the attribute is kept as written too.
 *
 * ponytail: the name is the label's text when the two first meet. A label whose text changes
 * afterwards leaves the old name; follow the label's text if a library does that.
 */
export function setLabel(node: EngineNode, name: string, value: unknown, engine: Engine): boolean {
  if (node.tag !== 'label' || (name !== 'for' && name !== 'htmlFor')) return false;
  const document = documentOf(engine);
  if (!document) return false;
  const control = (): EngineNode | null =>
    value == null
      ? null
      : (document['getElementById'] as (id: string) => EngineNode | null)(String(value));
  // The control it named before is named by it no longer.
  unname(node, engine);
  const asked = {};
  latest.set(node, asked);
  // Once the template that holds both has been built: the control may come after its label.
  // Not where the label was given another since.
  queueMicrotask(() => {
    const target = control();
    const own = target?.props['accessibilityLabel'] ?? target?.props['aria-label'];
    if (!target || own != null || latest.get(node) !== asked) return;
    const name = textOf(node).trim();
    engine.setProp(target, 'accessibilityLabel', name);
    named.set(node, { control: target, name });
  });
  presses.get(node)?.();
  presses.delete(node);
  if (value == null) return false;
  presses.set(
    node,
    engine.setResponder(node, {
      onStartShouldSetResponder: () => true,
      onResponderRelease: () => {
        const target = control();
        if (target) pressControl(target, engine);
      },
    }),
  );
  return false;
}
