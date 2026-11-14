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

/**
 * The uri a source names, for a desktop host's module to open: an asset's (a number from
 * `require`), resolved as an image's is, which on macOS is a file in the app or the dev server's
 * url; a string; or an object's `uri`. Null for one that names none.
 */
export function assetUri(source: unknown): string | null {
  if (typeof source === 'string') return source;
  if (typeof source === 'number') {
    const { Image } = require('react-native') as typeof import('react-native');
    return Image.resolveAssetSource(source)?.uri ?? null;
  }
  if (source !== null && typeof source === 'object') {
    const { uri, default: module } = source as { uri?: unknown; default?: unknown };
    return typeof uri === 'string' ? uri : module !== undefined ? assetUri(module) : null;
  }
  return null;
}

/**
 * A host's rejection, `CODE: message`, as an error with that `code`, as an Expo module's rejection
 * carries one. A rejection in no such shape is thrown as it is.
 */
export async function coded<T>(answer: Promise<T>): Promise<T> {
  try {
    return await answer;
  } catch (failure) {
    const text = failure instanceof Error ? failure.message : String(failure);
    const match = /^(ERR_[A-Z_]+): ([\s\S]*)$/.exec(text);
    if (!match) throw failure;
    throw Object.assign(new Error(match[2]), { code: match[1] });
  }
}
