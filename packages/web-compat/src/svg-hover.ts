import type { Engine, EngineNode } from '@ng-native/fabric';
import { nativeEvent } from './event-classes.ts';
import { engineOf } from './window.ts';

/**
 * Where the mouse is in each app, as the last finger to come down left it: the shape of a drawing
 * it is over, if any, and each element it is in, the innermost first.
 */
interface Mouse {
  over: EngineNode | null;
  in: EngineNode[];
}

const mice = new WeakMap<Engine, Mouse>();

/** Where a finger came down, as a mouse event says it. */
type At = Readonly<Record<string, unknown>>;

/**
 * Have the mouse go over the shape of a drawing a finger comes down on, and out of the one it
 * was over, as a phone's browser sends a tap the mouse events of one: Highcharts shows a series'
 * tooltip on its tracker's `mouseover`, and measures where its chart is again on `mouseenter`.
 * The mouse stays there as the finger lifts, as it does in that browser, so the tooltip stays up
 * until a finger comes down somewhere else.
 *
 * ponytail: over a drawing's shapes alone, which is where a chart reads it. Go over any element
 * if a library that shows something on hover is seen to need it.
 */
export function hoverTouched(engine: Engine, target: EngineNode, at: At): void {
  const mouse = mice.get(engine) ?? { over: null, in: [] };
  if (mouse.over === target) return;
  const was = mouse.over;
  const into = chainOf(target);
  // In the order a browser sends them: out of one, and on into the next.
  const from = was && inTree(was) ? was : null;
  if (from) send(from, 'mouseout', { ...at, relatedTarget: target });
  left(mouse, into, at);
  send(target, 'mouseover', { ...at, relatedTarget: from });
  for (const node of [...into].reverse()) {
    if (!mouse.in.includes(node)) send(node, 'mouseenter', { ...at, relatedTarget: from });
  }
  mice.set(engine, { over: target, in: into });
}

/**
 * A finger came down on something that is not in a drawing: the mouse goes out of the shape it
 * was over, and leaves what it was in that the finger is not on.
 */
export function hoverElsewhere(engine: Engine, target: EngineNode, at: At): void {
  const mouse = mice.get(engine);
  if (!mouse) return;
  const on = chainOf(target);
  if (mouse.over && inTree(mouse.over))
    send(mouse.over, 'mouseout', { ...at, relatedTarget: null });
  left(mouse, on, at);
  const still = mouse.in.filter((node) => on.includes(node));
  if (still.length) mice.set(engine, { over: null, in: still });
  else mice.delete(engine);
}

/** Leave what the mouse was in and is not in now, the innermost first. */
function left(mouse: Mouse, now: readonly EngineNode[], at: At): void {
  for (const node of mouse.in) {
    if (!now.includes(node) && inTree(node))
      send(node, 'mouseleave', { ...at, relatedTarget: null });
  }
}

/** A node and each element it is in, the innermost first. */
function chainOf(node: EngineNode): EngineNode[] {
  const chain: EngineNode[] = [];
  for (let at: EngineNode | null = node; at?.parent; at = at.parent) chain.push(at);
  return chain;
}

/** Whether a node is still in an app's tree, where a listener can hear of it. */
function inTree(node: EngineNode): boolean {
  let at = node;
  while (at.parent) at = at.parent;
  return at === engineOf(node).root;
}

function send(node: EngineNode, type: string, fields: Record<string, unknown>): void {
  const target = node as unknown as { dispatchEvent?(event: unknown): boolean };
  target.dispatchEvent?.(nativeEvent(type, fields));
}
