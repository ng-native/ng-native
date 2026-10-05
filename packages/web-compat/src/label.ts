import type { Engine, EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';

const textOf = (node: EngineNode): string =>
  node.kind === 'text' ? node.text : node.children.map(textOf).join('');

/** Each label's press handler, by label: a label has one control, and one way to reach it. */
const presses = new WeakMap<EngineNode, () => void>();

/**
 * `<label for="id">`: the control with that id is named by the label, and a press on the label
 * goes to it, as a click does in a browser. Answers false: the attribute is kept as written too.
 *
 * ponytail: the name is the label's text when the two first meet. A label whose text changes
 * afterwards leaves the old name; follow the label's text if a library does that.
 */
export function setLabel(node: EngineNode, name: string, value: unknown, engine: Engine): boolean {
  if (node.name !== 'label' || (name !== 'for' && name !== 'htmlFor')) return false;
  const document = documentOf(engine);
  if (!document) return false;
  const control = (): EngineNode | null =>
    value == null
      ? null
      : (document['getElementById'] as (id: string) => EngineNode | null)(String(value));
  // Once the template that holds both has been built: the control may come after its label.
  queueMicrotask(() => {
    const target = control();
    const named = target?.props['accessibilityLabel'] ?? target?.props['aria-label'];
    if (target && named == null) engine.setProp(target, 'accessibilityLabel', textOf(node).trim());
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
        if (target) engine.focus(target);
      },
    }),
  );
  return false;
}
