/**
 * The fake `nativeFabricUIManager`, and a Testing Library on top of it. Kept out of the engine so
 * nothing in a shipped bundle can reach it, and out of `test/` so an app's own tests can use it.
 *
 * The runners live beside `src/` rather than in it: `@ng-native/testing/vitest` and
 * `@ng-native/testing/register` are plain JavaScript, because they are loaded by Node before
 * anything can compile TypeScript for it.
 */
export { createFakeFabric, type FakeFabric, type FakeFabricNode } from './test-utils.ts';
export {
  cleanup,
  render,
  screen,
  settle,
  waitForElementToBeRemoved,
  within,
  type RenderOptions,
  type RenderResult,
} from './render.ts';
export { injectService, type InjectServiceOptions } from './inject-service.ts';
export type { BoundQueries, ByRoleOptions, Matcher, TextMatchOptions } from './queries.ts';
export { waitFor, type WaitForOptions } from './wait-for.ts';
export { gestureOf } from './gesture-of.ts';
export type { TestGesture } from './gesture-handler.ts';
export {
  fireEvent,
  userEvent,
  type EventPayload,
  type TypeOptions,
  type UserEvent,
} from './events.ts';
