import type { Engine, EngineNode } from '@ng-native/fabric';

/** A listener as a plugin adds one: what it hears is the event. */
type Handler = (event: never) => unknown;

/** Angular's `EventManagerPlugin`, by the members a renderer asks of one. */
export interface EventPlugin {
  manager: unknown;
  supports(eventName: string): boolean;
  addEventListener(
    element: unknown,
    eventName: string,
    handler: Handler,
    options?: unknown,
  ): () => void;
}

/** What a plugin hands a listener of its own back to: the app's listening, by any name. */
type Attach = (
  target: EngineNode | object,
  eventName: string,
  handler: Handler,
  options: unknown,
) => () => void;

/** The plugins an app asked to run, last-provided first, as Angular's `EventManager` asks them. */
const pluginsOf = new WeakMap<Engine, readonly EventPlugin[]>();

/**
 * A name no plugin written for a modifier claims: one that does claim it claims every name, as
 * Angular's own DOM plugin does, and the renderer attaches those itself.
 */
const PROBE = '\u0000';

/**
 * Run `plugins` for the listeners of the app on `engine`: each is given a manager, as Angular's
 * `EventManager` gives one, whose `addEventListener` is the app's own listening and whose
 * `getZone()` is the app's zone. Answers what stops them again.
 */
export function runPlugins(
  engine: Engine,
  plugins: readonly EventPlugin[],
  zone: unknown,
  attach: Attach,
): () => void {
  const manager = {
    addEventListener: (
      target: EngineNode | object,
      eventName: string,
      handler: Handler,
      options?: unknown,
    ) => attach(target, eventName, handler, options),
    getZone: () => zone,
  };
  const claiming = plugins.filter((plugin) => !plugin.supports(PROBE));
  for (const plugin of claiming) plugin.manager = manager;
  pluginsOf.set(engine, [...claiming].reverse());
  return () => pluginsOf.delete(engine);
}

/** The plugin that attaches a listener by this name in the app on `engine`, if one claims it. */
export const pluginFor = (engine: Engine, eventName: string): EventPlugin | undefined =>
  pluginsOf.get(engine)?.find((plugin) => plugin.supports(eventName));
