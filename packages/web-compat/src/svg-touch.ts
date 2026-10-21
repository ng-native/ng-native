import type { Engine, EngineNode } from '@ng-native/fabric';
import { isShape } from './svg.ts';

/**
 * The shapes of a drawing that take a touch. Native finds a shape under a finger only where it
 * says it takes one (react-native-svg's `responsible`), and gives a touch on one that does not
 * to the drawing: a browser gives it to the shape, whose listeners and those of what it is in
 * hear of it. So a shape with a listener for a touch, and every shape in one or in a drawing
 * that has one, says it takes one, for as long as the listener is there.
 */

/** How many listeners for a touch each shape, and each drawing, has. */
const listeners = new WeakMap<EngineNode, number>();

/** Whether a shape or a drawing has a listener for a touch of its own. */
export const listensForTouch = (node: EngineNode): boolean => (listeners.get(node) ?? 0) > 0;

/** Whether a node is a drawing or a shape in one, which a listener for a touch makes take one. */
export const isDrawn = (node: EngineNode): boolean => node.tag === 'svg' || isShape(node);

/**
 * Count a listener for a touch added to a shape or a drawing, answering what takes it off again:
 * it, and what is in it, take a touch while it has any.
 */
export function takesTouches(node: EngineNode, engine: Engine): () => void {
  const count = (by: number) => {
    const before = listensForTouch(node);
    const now = (listeners.get(node) ?? 0) + by;
    if (now > 0) listeners.set(node, now);
    else listeners.delete(node);
    if (before !== listensForTouch(node)) mark(node, heardAbove(node.parent), engine);
  };
  count(1);
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    count(-1);
  };
}

/** A shape put somewhere takes a touch as what it is in now has it take one. */
export function shapeInserted(node: EngineNode, parent: EngineNode, engine: Engine): void {
  if (isShape(node)) mark(node, heardAbove(parent), engine);
}

/** Whether a node, or a shape or drawing it is in, has a listener for a touch. */
function heardAbove(node: EngineNode | null): boolean {
  for (let at = node; at && isDrawn(at); at = at.parent) {
    if (listensForTouch(at)) return true;
    if (at.tag === 'svg') return false;
  }
  return false;
}

/**
 * Say a shape, and each in it, takes a touch where it or one it is in listens, and not where none
 * does. Each shape is as what was over it had it, so where one already says what it should, what
 * is in it does too: a shape put in a drawing walks no further than it changes.
 */
function mark(node: EngineNode, above: boolean, engine: Engine): void {
  const heard = above || listensForTouch(node);
  if (isShape(node)) {
    if ((node.props['responsible'] === true) === heard) return;
    engine.setProp(node, 'responsible', heard ? true : null);
  }
  for (const child of node.childList) if (isShape(child)) mark(child, heard, engine);
}
