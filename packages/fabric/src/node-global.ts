/**
 * Let an engine node pass Angular's `instanceof Node` checks, whichever `Node` the app has.
 *
 * Angular's development build asserts that a node is a `Node` where it creates and inserts one, and
 * the i18n runtime tests it for each node of an ICU plural or select. An engine node is not a DOM
 * node, so the Metro preset's `animation-globals` polyfill defines a `Node` that recognises them.
 * But a polyfill runs before `InitializeCore`, and React Native 0.8x sets up its own `Node` there,
 * with `polyfillGlobal`, which replaces whatever is on the global. The app was left with a `Node`
 * that no engine node is an instance of, and every plural or select threw `The provided value must
 * be an instance of a DOM Node but got #anchor` in a development build.
 *
 * This runs from `mount()`, after both, and makes the `Node` that is on the global then answer for
 * engine nodes too. Nothing else about that class changes: its own instances still pass, and so
 * does everything its own check accepts.
 */
import { isEngineNode } from './engine.ts';

export type Constructor = abstract new (...args: never[]) => object;

/**
 * Make `target` answer `instanceof` for engine nodes as well, and for everything it did before: its
 * own `Symbol.hasInstance` if it defines one, and the ordinary prototype walk if not. Only for
 * `target` itself, not a subclass that inherits the check: `Text` and `Element` answer for
 * themselves.
 */
export function letEngineNodesPass(target: Constructor): void {
  const own = target[Symbol.hasInstance];
  Object.defineProperty(target, Symbol.hasInstance, {
    configurable: true,
    value(this: Constructor, value: unknown): boolean {
      return (this === target && isEngineNode(value)) || own.call(this, value);
    },
  });
}

/** The classes already patched, so one `Node` is patched once however often an app is mounted. */
const patched = new WeakSet<object>();

export function installNodeGlobal(): void {
  const node = (globalThis as { Node?: Constructor }).Node;
  if (typeof node !== 'function' || patched.has(node)) return;
  patched.add(node);
  letEngineNodesPass(node);
}
