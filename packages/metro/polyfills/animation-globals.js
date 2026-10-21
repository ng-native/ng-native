/**
 * The globals Angular's `animate.enter` and `animate.leave` look for, and nothing else.
 *
 * Both instructions are gated on a module-level constant in `@angular/core`:
 *
 *     const areAnimationSupported =
 *       typeof document !== 'undefined' &&
 *       typeof document?.documentElement?.getAnimations === 'function';
 *
 * It is evaluated the moment `@angular/core` is imported, so this file has to run first, which is
 * why it is a polyfill rather than a module the platform imports. Without it both instructions
 * compile to no-ops and an `animate.leave` element simply disappears with no animation.
 *
 * There is no DOM here, and the point of this file is that there does not have to be. Angular
 * runs the animations themselves entirely through `Renderer2` - `addClass`, `removeClass`, and
 * `listen` for the transition events - all of which this project implements. What it also does is
 * ask the element how long its animation lasts, via `getAnimations()`, and check a few global
 * types on the way past. Those are what this supplies: the engine answers `getAnimations()` from
 * the transitions it is actually running.
 *
 * The one risk of defining `document` is Angular's internal `getDocument()`, which falls back to
 * the global. Its five callers are hydration, two sanitiser paths and a style host that prefers
 * the injected `DOCUMENT` token; none is on this renderer's path.
 */

const global = globalThis;

// Read only as a feature probe. Element-level `getAnimations` is the one that matters, and it
// lives on the engine's nodes.
global.document ??= { documentElement: { getAnimations: () => [] } };

// `assertElementNodes` compares against these in dev builds, and the i18n runtime picks a text or a
// comment by them in every build: without `TEXT_NODE` and `COMMENT_NODE` both read `undefined`, the
// first case matches, and every translated string is created as an empty comment.
//
// A class rather than an object because dev builds also test `node instanceof Node`, when an
// element sits inside an i18n message (`<text i18n>Tap <text>here</text></text>`), and
// `instanceof` an object throws. Every node that reaches that assertion is the engine's, and the
// engine brands its nodes with this symbol. Nothing else is one: the global is visible to an app's
// own code and to its test runner, and Vitest's `toContain` treats a `Node` as a DOM element.
//
// Only until React Native's `InitializeCore`: from 0.8x its `setUpDOM` replaces this global with
// its own `Node`, which no engine node is an instance of. `mount()` patches whichever `Node` is
// there then, in `installNodeGlobal`.
const ENGINE_NODE = Symbol.for('ng-native.node');
global.Node ??= Object.assign(
  class Node {
    static [Symbol.hasInstance](value) {
      return typeof value === 'object' && value !== null && value[ENGINE_NODE] === true;
    }
  },
  { ELEMENT_NODE: 1, TEXT_NODE: 3, COMMENT_NODE: 8 },
);

// Angular tests `event instanceof AnimationEvent` to tell a keyframe animation from a transition.
// Nothing here is ever an instance of it, so every event is read as a transition, which is what
// they are: `@keyframes` is not supported.
global.AnimationEvent ??= class AnimationEvent {};
global.TransitionEvent ??= class TransitionEvent {};

// Only reached when an element reports no animations, where it has to answer "nothing here".
global.getComputedStyle ??= () => ({ getPropertyValue: () => '' });

// React Native has both; Node, which the test suite runs on, has neither.
global.requestAnimationFrame ??= (callback) => setTimeout(() => callback(Date.now()), 16);
global.cancelAnimationFrame ??= (handle) => clearTimeout(handle);
global.CustomEvent ??= class CustomEvent {
  constructor(type) {
    this.type = type;
  }
};
