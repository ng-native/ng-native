/**
 * expo-local-llm over the desktop host's `NgNativeLocalLlm`, for `LanguageModel` on macOS, where
 * the model is Apple's Foundation Models from macOS 26. A TurboModule cannot hand back
 * expo-local-llm's session objects, so the host keeps sessions by id and this wraps each in the
 * shape of an `LLMSession`: its tokens and tool calls arrive as `ngNativeLocalLlm` events with the
 * session they are for, and a failure as `CODE: message`, which becomes an error with that `code`.
 */
import { desktopHost, type DesktopHost } from './desktop-host.ts';

type ExpoLocalLlm = typeof import('expo-local-llm');

interface LocalLlmHost {
  getAvailability(): string;
  downloadModel(): Promise<void>;
  createSession(config: unknown): string;
  respond(id: string, prompt: string, requestId: string | null): Promise<string>;
  streamResponse(id: string, prompt: string, requestId: string | null): Promise<string>;
  cancelStream(id: string): Promise<void>;
  release(id: string): void;
  resolveToolCall(id: string, callId: string, output: string): void;
  rejectToolCall(id: string, callId: string, error: string): void;
}

interface LocalLlmEvent {
  readonly type: string;
  readonly session: string;
  readonly requestId: string | null;
  readonly [key: string]: unknown;
}

/** The host's rejection, `CODE: message`, as an error with expo-local-llm's `code`. */
async function coded<T>(answer: Promise<T>): Promise<T> {
  try {
    return await answer;
  } catch (failure) {
    const text = failure instanceof Error ? failure.message : String(failure);
    const match = /^(ERR_[A-Z_]+): ([\s\S]*)$/.exec(text);
    if (!match) throw failure;
    throw Object.assign(new Error(match[2]), { code: match[1] });
  }
}

function session(host: DesktopHost<LocalLlmHost>, config: unknown) {
  const native = host.module;
  const id = native.createSession(config);
  return {
    respond: (prompt: string, requestId?: string) =>
      coded(native.respond(id, prompt, requestId ?? null)),
    streamResponse: (prompt: string, requestId?: string) =>
      coded(native.streamResponse(id, prompt, requestId ?? null)),
    cancelStream: () => native.cancelStream(id),
    resolveToolCall: (callId: string, output: string) => native.resolveToolCall(id, callId, output),
    rejectToolCall: (callId: string, error: string) => native.rejectToolCall(id, callId, error),
    release: () => native.release(id),
    addListener: (event: string, listener: (payload: never) => void) =>
      host.listen('ngNativeLocalLlm', (body) => {
        const { type, session: from, ...payload } = (body ?? {}) as LocalLlmEvent;
        if (type === event && from === id) listener(payload as never);
      }),
  };
}

/**
 * Listens for the app coming to the front, when Apple Intelligence may have been switched on or
 * off in System Settings, as expo-local-llm's iOS module checks again then.
 */
function onActive(listener: () => void): { remove(): void } {
  const appState = (require('react-native') as Partial<typeof import('react-native')>).AppState;
  const subscription = appState?.addEventListener?.('change', (state) => {
    if (state === 'active') listener();
  });
  return { remove: () => subscription?.remove() };
}

/** expo-local-llm's slice that `LanguageModel` uses, or null with no NgNativeLocalLlm. */
export function desktopLocalLlm(): ExpoLocalLlm | null {
  const host = desktopHost<LocalLlmHost>('NgNativeLocalLlm');
  if (!host) return null;
  const native = host.module;
  const module = {
    getAvailability: () => native.getAvailability(),
    downloadModel: () => native.downloadModel(),
    addListener: (event: string, listener: (payload: never) => void) => {
      if (event !== 'availabilityChange') return { remove() {} };
      let last = native.getAvailability();
      return onActive(() => {
        const now = native.getAvailability();
        if (now === last) return;
        last = now;
        listener({ availability: now } as never);
      });
    },
  };
  return {
    ExpoLocalLlmModule: module,
    createLLMSession: (config: unknown) => session(host, config),
  } as unknown as ExpoLocalLlm;
}
