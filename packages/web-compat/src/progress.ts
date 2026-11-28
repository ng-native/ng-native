import type { Engine, EngineNode } from '@ng-native/fabric';
import { documentOf } from './document.ts';
import { watchCommits } from './commit-watch.ts';
import { keptOwn } from './in-document.ts';
import { WeakList } from './weak-list.ts';
import type { Reflecting } from './reflect.ts';
import { maxOf, valueOf } from './progress-value.ts';

/**
 * A `<progress>`, as a library draws one: the element is the track, and the bar inside it filled
 * to its value is a box of its own, which a stylesheet styles as `::-webkit-progress-value` (or
 * Firefox's `::-moz-progress-bar`). The box is kept in the element, from a script, and is as wide
 * a share of it as `value` is of `max`, over its whole height. With no `value` the bar is
 * `:indeterminate`, as a browser's is, and the box is empty: a library draws that state on the
 * track.
 *
 * The bar follows the value and the max however they are set, a binding, a property or an
 * attribute: each progress bar in the app is looked at after a commit, and filled again where
 * either changed. A bar is held weakly, so one taken out with what holds it is let go of, and one
 * a script puts back is filled again.
 */

const BAR = '::-webkit-progress-value';
const bars = new WeakMap<EngineNode, EngineNode>();
/** The progress bars of each app. */
const progressBars = new WeakMap<Engine, WeakList<EngineNode>>();
/** What each progress bar was last filled to. */
const filledTo = new WeakMap<EngineNode, string>();

/** Give a progress bar made in an app with this package the box its value fills. */
export function progressCreated(node: EngineNode, engine: Engine): void {
  if (node.tag !== 'progress' || !documentOf(engine)) return;
  // The bar is placed in the element, which a library's rules leave unpositioned.
  engine.setDefaultStyle(node, { ...node.defaultStyle, position: 'relative' });
  const bar = engine.createElement(BAR, node.templateSheet);
  keptOwn.add(bar);
  // From the inline start, the right in a box written right to left, as a browser fills it.
  engine.setDefaultStyle(bar, { position: 'absolute', top: 0, bottom: 0, start: 0 });
  engine.appendChild(node, bar);
  bars.set(node, bar);
  let shown = progressBars.get(engine);
  if (!shown) {
    const each = new WeakList<EngineNode>();
    progressBars.set(engine, each);
    shown = each;
    watchCommits(engine, () => refill(engine, each));
  }
  shown.add(new WeakRef(node));
  // Once the template has written the element's attributes.
  queueMicrotask(() => refill(engine, shown));
}

/**
 * Fill again each progress bar whose value or max changed, and commit once for all of them: the
 * commit's own look finds nothing changed.
 */
function refill(engine: Engine, shown: WeakList<EngineNode>): void {
  shown.forEach((node) => {
    const now = `${valueOf(node as Reflecting)}/${maxOf(node as Reflecting)}`;
    if (now === filledTo.get(node)) return;
    filledTo.set(node, now);
    filled(node as Reflecting, engine);
  });
  if (engine.pending) engine.commit();
}

/** The bar's width, a share of the track, and whether the bar is indeterminate. */
function filled(node: Reflecting, engine: Engine): void {
  const bar = bars.get(node);
  if (!bar) return;
  const value = valueOf(node);
  engine.setControlState(node, 'indeterminate', value === null ? true : undefined);
  const share = value === null ? 0 : value / maxOf(node);
  engine.setProp(bar, 'style', { width: `${Math.round(share * 100000) / 1000}%` });
}
