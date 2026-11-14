/**
 * A desktop host's TurboModule and the events it sends on `DeviceEventEmitter`, for a desktop
 * loader: a TurboModule cannot hand back the subscription an Expo `add*Listener` answers, so the
 * host sends its events as `ngNative<Name>` and a listener is the emitter's.
 */
type Host = Record<string, (...args: unknown[]) => unknown>;

export interface DesktopHost<T = Host> {
  readonly module: T;
  /** Listens to the host's `event`, and answers how to stop, as an Expo subscription. */
  listen(event: string, listener: (body: unknown) => void): { remove(): void };
}

/** The desktop host's TurboModule `name`, or null where it has none. */
export function desktopHost<T = Host>(name: string): DesktopHost<T> | null {
  const native = require('react-native') as {
    TurboModuleRegistry: { get(name: string): unknown };
    DeviceEventEmitter: {
      addListener(event: string, listener: (body: unknown) => void): { remove(): void };
    };
  };
  const module = native.TurboModuleRegistry.get(name) as T | null;
  if (!module) return null;
  return {
    module,
    listen: (event, listener) => native.DeviceEventEmitter.addListener(event, listener),
  };
}
