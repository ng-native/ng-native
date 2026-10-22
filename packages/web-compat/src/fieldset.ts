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
 *
 * Both margins are the engine's own overrides (`styleOverride`), over any rule and apart from
 * the `style` the page binds, which neither loses them nor reads them back. They are taken back
 * when the legend leaves the fieldset or the fieldset has no border to set it on.
 */
const placed = new WeakSet<EngineNode>();

/** The fieldset each legend has put its margin on, to take it back from. */
const marginOn = new WeakMap<EngineNode, EngineNode>();

/** The fieldset each legend is in, as its parent is gone by the time it is told it left. */
const inFieldset = new WeakMap<EngineNode, EngineNode>();

/** How tall each legend was last laid out, to set it again in a fieldset it is moved to. */
const heights = new WeakMap<EngineNode, number>();

const points = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** A node's override as it is now. */
const overrideOf = (node: EngineNode): Record<string, unknown> =>
  (node.props['styleOverride'] ?? {}) as Record<string, unknown>;

/** Set some of a node's override, or take them away with `undefined`, and the rest stay. */
function override(node: EngineNode, entries: Record<string, number | undefined>, engine: Engine) {
  const next = { ...overrideOf(node) };
  for (const [name, value] of Object.entries(entries)) {
    if (value === undefined) delete next[name];
    else next[name] = value;
  }
  engine.setProp(node, 'styleOverride', Object.keys(next).length ? next : null);
}

/** Take the margins a legend set back from it and from the fieldset it set one on. */
function release(legend: EngineNode, engine: Engine): void {
  const fieldset = marginOn.get(legend);
  marginOn.delete(legend);
  if (!fieldset) return;
  override(legend, { marginTop: undefined, marginBottom: undefined }, engine);
  override(fieldset, { marginTop: undefined }, engine);
  engine.commit();
}

/** The legend a browser draws on a fieldset's border: its first, as `fenced` has it too. */
const firstLegend = (fieldset: EngineNode) =>
  fieldset.childList.find((each) => each.tag === 'legend');

function place(legend: EngineNode, height: number, engine: Engine): void {
  const fieldset = legend.parent;
  if (fieldset?.tag !== 'fieldset') return;
  // Any other is a block in the box, as written.
  if (firstLegend(fieldset) !== legend) return release(legend, engine);
  const around = fieldset.committed?.props ?? {};
  const border = points(around['borderTopWidth']);
  // With no border there is none to set it on: it is the first thing in the box, as written.
  if (!border) return release(legend, engine);
  const padding = points(around['paddingTop']);
  const half = height / 2;
  const top = -(padding + border + half);
  const over = overrideOf(legend);
  if (
    marginOn.get(legend) === fieldset &&
    over['marginTop'] === top &&
    over['marginBottom'] === padding &&
    overrideOf(fieldset)['marginTop'] === half
  ) {
    return;
  }
  // Over any rule: a library's sheet gives both a margin of none.
  override(legend, { marginTop: top, marginBottom: padding }, engine);
  override(fieldset, { marginTop: half }, engine);
  marginOn.set(legend, fieldset);
  engine.commit();
}

/**
 * A legend put in a fieldset: hear how tall it is, and set it on the border from then on. One
 * put anywhere else, or in another fieldset, gives the margins back to the fieldset it left.
 */
export function legendInserted(node: EngineNode, parent: EngineNode, engine: Engine): void {
  if (node.tag !== 'legend') return;
  // Moved here straight from a fieldset, which is not told it left: it leaves that one first.
  const was = inFieldset.get(node);
  if (was && was !== parent) legendRemoved(node, engine);
  else if (marginOn.get(node) !== parent) release(node, engine);
  if (parent.tag !== 'fieldset') return;
  inFieldset.set(node, parent);
  // One put in before the legend on the border takes the border from it.
  if (firstLegend(parent) === node) {
    for (const other of parent.childList) {
      if (other !== node && marginOn.get(other) === parent) release(other, engine);
    }
  }
  if (!placed.has(node)) {
    placed.add(node);
    engine.setEventListener(node, 'topLayout', (event) => {
      const layout = (event as { nativeEvent?: { layout?: { height?: unknown } } }).nativeEvent
        ?.layout;
      if (typeof layout?.height !== 'number') return;
      heights.set(node, layout.height);
      place(node, layout.height, engine);
    });
  }
  const known = heights.get(node);
  if (known !== undefined) place(node, known, engine);
}

/**
 * A legend taken out of its fieldset: its margins and the fieldset's are taken back, and the
 * legend after it, now the first, is set on the border.
 */
export function legendRemoved(node: EngineNode, engine: Engine): void {
  if (node.tag !== 'legend') return;
  const fieldset = inFieldset.get(node);
  inFieldset.delete(node);
  release(node, engine);
  const next = fieldset && firstLegend(fieldset);
  const known = next && heights.get(next);
  if (known !== undefined) place(next!, known, engine);
}
