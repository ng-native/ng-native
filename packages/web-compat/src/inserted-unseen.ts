import { nextFrame, type Engine, type EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';

/**
 * Hold what a library inserts over the app unseen until the frame after: a browser paints once
 * the task and its animation frame are over, by when an overlay has been measured and given the
 * class it is shown with. Let go after the frame's callbacks and the timers already waiting,
 * which is where Angular checks for changes, so the first it is seen is as a browser first
 * paints it. Kept a view of its own as well: see `keepAsAView`.
 *
 * ponytail: under the body only, where overlays are. A ripple or anything else a library
 * inserts into the app's own views is drawn at once; hold those too if one is seen to flash.
 */
export function insertedUnseen(engine: Engine, parent: EngineNode, child: EngineNode): void {
  const body = documentOf(engine)?.body;
  if (!body || child.committed || drawnAtOnce.has(child) || !under(body, parent)) return;
  keepAsAView(engine, child);
  if (heldAbove(body, parent)) return;
  engine.hold(child, true);
  // Taken out before then, it is let go with nothing committed to show, and nothing commits.
  void nextFrame().then(() =>
    setTimeout(() => {
      engine.hold(child, false);
      engine.commit();
    }),
  );
}

/**
 * What this package puts over the app itself, whole as it is put there: a select's list. Held,
 * it would only open a frame late.
 */
const drawnAtOnce = new WeakSet<EngineNode>();

export const drawAtOnce = (node: EngineNode): void => void drawnAtOnce.add(node);

/**
 * Keep as a view of its own what a library puts over the app: an overlay's host, its pane and
 * the container put in that. One with no size or paint of its own is a view native flattens
 * away, and what is in it is placed by the library from one commit to the next: under a parent
 * that is no view, native draws it out of place once its views are put to use again, a sheet at
 * the foot of the screen its own height too high the second time it opens. A view native turns
 * back into one is drawn out of place as well, so it is one from the start.
 *
 * A floor: a `collapsable` written on the element is left as it is.
 */
function keepAsAView(engine: Engine, node: EngineNode): void {
  if (node.nodeKind !== 'element' || node.props['collapsable'] !== undefined) return;
  engine.setProp(node, 'collapsable', false);
}

/**
 * Whether something a node is in, up to the body, is held: what joins it is unseen with it, and
 * is not held again. A hold of its own would be a second say in its opacity, beside an animation
 * it opens with, for as long as the first.
 */
function heldAbove(body: EngineNode, node: EngineNode | null): boolean {
  for (let up = node; up && up !== body; up = up.parent) if (up.held) return true;
  return false;
}

function under(body: EngineNode, node: EngineNode | null): boolean {
  for (let up = node; up; up = up.parent) if (up === body) return true;
  return false;
}
