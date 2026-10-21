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

/**
 * A fieldset's legend, which a browser draws on the fieldset's top border and not inside it:
 * the border runs through the middle of the legend's height, and what the fieldset holds
 * starts under the legend, its padding between them. A view has no such box, so the legend is
 * moved up over the padding and the border by its margin, and the fieldset down by half the
 * legend's height, which is how far the legend then stands above it. The fieldset is as tall
 * as it was. The legend's height is read as it is laid out, and again when it changes.
 */
const placed = new WeakSet<EngineNode>();

const points = (value: unknown): number => (typeof value === 'number' ? value : 0);

function place(legend: EngineNode, height: number, engine: Engine): void {
  const fieldset = legend.parent;
  if (fieldset?.tag !== 'fieldset') return;
  const around = fieldset.committed?.props ?? {};
  const border = points(around['borderTopWidth']);
  const written = (fieldset.props['style'] ?? {}) as Record<string, unknown>;
  // With no border there is none to set it on: it is the first thing in the box, as written.
  if (!border) {
    if (legend.props['styleOverride'] == null) return;
    engine.setProp(legend, 'styleOverride', null);
    const { marginTop: _, ...rest } = written;
    engine.setProp(fieldset, 'style', rest);
    return void engine.commit();
  }
  const padding = points(around['paddingTop']);
  const half = height / 2;
  const over = (legend.props['styleOverride'] ?? {}) as Record<string, unknown>;
  if (over['marginTop'] === -(padding + border + half) && over['marginBottom'] === padding) return;
  // Over any rule: a library's sheet gives both a margin of none.
  engine.setProp(legend, 'styleOverride', {
    marginTop: -(padding + border + half),
    marginBottom: padding,
  });
  // On the element itself, which is over a rule as well, and is read once by the flow it is in.
  engine.setProp(fieldset, 'style', { ...written, marginTop: half });
  engine.commit();
}

/** A legend put in a fieldset: hear how tall it is, and set it on the border from then on. */
export function legendInserted(node: EngineNode, parent: EngineNode, engine: Engine): void {
  if (node.tag !== 'legend' || parent.tag !== 'fieldset' || placed.has(node)) return;
  placed.add(node);
  engine.setEventListener(node, 'topLayout', (event) => {
    const layout = (event as { nativeEvent?: { layout?: { height?: unknown } } }).nativeEvent
      ?.layout;
    if (typeof layout?.height === 'number') place(node, layout.height, engine);
  });
}
