/**
 * `LanguageModel`, bound to `expo-local-llm`.
 *
 * The model the operating system already has: Apple's Foundation Models on iOS 26 with Apple
 * Intelligence, Gemini Nano on the Android phones that ship it. Nothing is bundled and nothing is
 * sent anywhere; the prompt and the answer stay on the device.
 *
 * ```ts
 * private readonly model = inject(LanguageModel);
 * protected readonly answer = signal<LanguageModelStream | null>(null);
 * ask(prompt: string) { this.answer.set(this.model.stream(prompt)); }
 * ```
 *
 * `generate`, `generateObject` and `stream` are each a conversation of their own: a session is
 * made, asked once and released, so one prompt never sees the last one. Starting a stream cancels
 * the one before it. `session()` keeps a conversation going across turns, with tools the model
 * can call.
 */
import {
  DestroyRef,
  InjectionToken,
  Injector,
  Service,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import {
  LanguageModelSession,
  liveStream,
  nativeConfig,
  type LanguageModelSessionOptions,
  type LanguageModelToolCall,
} from './language-model-session.ts';
import { expoModule, present } from './native.ts';

export {
  LanguageModelContextExceededError,
  LanguageModelSession,
  defineTool,
  type LanguageModelSessionOptions,
  type LanguageModelTool,
  type LanguageModelToolArguments,
  type LanguageModelToolCall,
  type LanguageModelToolParameter,
  type LanguageModelToolParameters,
  type LanguageModelTranscriptEntry,
} from './language-model-session.ts';

/**
 * What `expo-local-llm` reports, plus `notInstalled` for an app without the module or a build
 * without its native code (Expo Go, or installed without a rebuild).
 *
 * - `available`: ready to answer.
 * - `notEligible`: this device or OS version cannot run it (before iOS 26, older iPhones, most
 *   Android phones).
 * - `notEnabled`: the device can, but Apple Intelligence is switched off in Settings.
 * - `notReady`: the model is still being prepared by the system, usually downloading after
 *   Apple Intelligence was switched on.
 * - `downloadRequired` / `downloading`: Android, where the app asks for Gemini Nano with
 *   `download()`.
 * - `unknown`: the platform said something the module does not name.
 */
export type LanguageModelAvailability =
  | 'available'
  | 'notEligible'
  | 'notEnabled'
  | 'notReady'
  | 'downloadRequired'
  | 'downloading'
  | 'unknown'
  | 'notInstalled';

const REPORTED = new Set<string>([
  'available',
  'notEligible',
  'notEnabled',
  'notReady',
  'downloadRequired',
  'downloading',
  'unknown',
]);

export interface GenerateOptions {
  /** System instructions: who the model is and how it answers. Kept apart from the prompt. */
  readonly instructions?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topK?: number;
}

/** A structured answer's shape: `expo-local-llm`'s own schema, a field per property. */
export type LanguageModelSchema = import('expo-local-llm').Schema;

/** A session's configuration, with tools as declarations: their handlers stay in JavaScript. */
export type NativeSessionConfig = Omit<import('expo-local-llm').SessionConfig, 'tools'> & {
  tools?: import('expo-local-llm').ToolConfig[];
};

type SessionConfig = NativeSessionConfig;

/** A tool call the model made, answered with the tool's output or a rejection. */
export type NativeToolCall = LanguageModelToolCall;

/** The slice of an `expo-local-llm` session this needs, with its events unwrapped. */
export interface NativeLanguageSession {
  respond(prompt: string): Promise<string>;
  /**
   * Resolves with the whole text, or the text so far when cancelled; rejects on failure. A tool
   * call is answered with what `onToolCall` resolves to, or fails with what it rejects with.
   */
  stream(
    prompt: string,
    onText: (textSoFar: string) => void,
    onToolCall?: (call: NativeToolCall) => Promise<string>,
  ): Promise<string>;
  cancel(): Promise<void>;
  release(): void;
}

/** The slice of `expo-local-llm` this needs. */
export interface NativeLanguageModel {
  availability(): string;
  onAvailabilityChange(listener: (availability: string) => void): { remove(): void };
  onDownloadProgress(listener: (progress: number) => void): { remove(): void };
  download(): Promise<void>;
  session(config: SessionConfig): NativeLanguageSession;
}

/** Why a call was refused before it reached the model. */
export class LanguageModelUnavailableError extends Error {
  readonly reason: Exclude<LanguageModelAvailability, 'available'>;

  constructor(reason: Exclude<LanguageModelAvailability, 'available'>) {
    super(`The on-device language model is unavailable: ${reason}`);
    this.name = 'LanguageModelUnavailableError';
    this.reason = reason;
  }
}

export type LanguageModelStreamStatus = 'streaming' | 'done' | 'cancelled' | 'failed';

/** One streamed answer, as signals a template binds. */
export interface LanguageModelStream {
  /** The text so far; the whole answer once `status` is `done`. */
  readonly text: Signal<string>;
  readonly status: Signal<LanguageModelStreamStatus>;
  /** The failure's message while `status` is `failed`, otherwise null. */
  readonly error: Signal<string | null>;
  /** The tool calls running now, in a session with tools. Always empty for a one-shot stream. */
  readonly toolCalls: Signal<readonly LanguageModelToolCall[]>;
  /** The final text (the partial text if cancelled). Rejects if the stream fails. */
  readonly result: Promise<string>;
  /** Stop generating. The text so far is kept. Does nothing once the stream has ended. */
  cancel(): void;
}

/**
 * The availability and download listeners follow the model for the life of the app, and are
 * removed when the app is destroyed.
 */
@Service()
export class LanguageModel {
  /** Overridden in a test to answer without a model. */
  static readonly SOURCE = new InjectionToken<NativeLanguageModel | null>(
    'angular-native.languageModelSource',
    {
      factory: () => {
        // The package loads without its native half, so that half is what decides.
        const llm = expoModule('expo-local-llm', () => {
          const loaded = require('expo-local-llm') as typeof import('expo-local-llm');
          return loaded.ExpoLocalLlmModule ? loaded : null;
        });
        // Missing from the build: the stand-in, to say so when it is used.
        if (llm && !present(llm)) return llm as never;
        const module = llm?.ExpoLocalLlmModule;
        if (!llm || !module) return null;
        return {
          availability: () => module.getAvailability(),
          onAvailabilityChange: (listener) =>
            module.addListener('availabilityChange', (event) => listener(event.availability)),
          onDownloadProgress: (listener) =>
            module.addListener('downloadProgress', (event) => listener(event.progress)),
          download: () => module.downloadModel(),
          session: (config) => {
            // The module strips handlers before the native side sees them, so declarations are
            // enough; tool calls are answered through the `toolCall` event instead.
            const session = llm.createLLMSession(config as import('expo-local-llm').SessionConfig);
            return {
              respond: (prompt) => session.respond(prompt),
              stream: async (prompt, onText, onToolCall) => {
                // Tags the turn, so a late call from a cancelled one is not answered for this.
                const requestId = `ng-native-${++requests}`;
                const tokens = session.addListener('token', (event) => onText(event.accumulated));
                const calls = onToolCall
                  ? session.addListener('toolCall', (event) => {
                      if (event.requestId !== requestId) return;
                      const { callId: id, toolName: tool, arguments: args } = event;
                      // Answering throws once the turn has been cancelled or the session
                      // released, when the model has stopped waiting.
                      onToolCall({ id, tool, arguments: args }).then(
                        (output) => quietly(() => session.resolveToolCall(id, output)),
                        (failure: unknown) =>
                          quietly(() => session.rejectToolCall(id, messageOf(failure))),
                      );
                    })
                  : null;
                try {
                  return await session.streamResponse(prompt, requestId);
                } finally {
                  tokens.remove();
                  calls?.remove();
                }
              },
              cancel: () => session.cancelStream(),
              release: () => session.release(),
            };
          },
        };
      },
    },
  );

  private readonly native = inject(LanguageModel.SOURCE);
  private readonly injector = inject(Injector);
  private readonly state = signal<LanguageModelAvailability>(this.read());
  private readonly progress = signal<number | null>(null);
  private streaming: LanguageModelStream | null = null;

  /** Whether the model can answer, and if not, the platform's reason. */
  readonly availability: Signal<LanguageModelAvailability> = this.state.asReadonly();

  readonly available: Signal<boolean> = computed(() => this.state() === 'available');

  /** Android's download of Gemini Nano, 0 to 1. Null until a download reports; iOS never does. */
  readonly downloadProgress: Signal<number | null> = this.progress.asReadonly();

  constructor() {
    const native = present(this.native);
    if (!native) return;
    const availability = native.onAvailabilityChange((value) => this.state.set(known(value)));
    const progress = native.onDownloadProgress((value) => this.progress.set(value));
    inject(DestroyRef).onDestroy(() => {
      availability.remove();
      progress.remove();
    });
  }

  /**
   * Ask the platform again. iOS announces a change when the app comes back to the front, which
   * covers Apple Intelligence being switched on in Settings; it does not announce the model
   * finishing its preparation while the app is open.
   */
  refresh(): LanguageModelAvailability {
    this.state.set(this.read());
    return this.state();
  }

  /** Ask Android to fetch Gemini Nano. Does nothing on iOS, where the system manages the model. */
  async download(): Promise<void> {
    await this.native?.download();
  }

  /** The whole answer at once. Rejects with the platform's reason when the model is unavailable. */
  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    return this.once(nativeConfig(options), prompt);
  }

  /**
   * An answer shaped by `schema`, parsed. iOS constrains the model's decoding to the schema, so
   * the answer always fits it. Android rejects: `expo-local-llm` does not support a schema there.
   */
  async generateObject<T = unknown>(
    prompt: string,
    schema: LanguageModelSchema,
    options: GenerateOptions = {},
  ): Promise<T> {
    const text = await this.once(
      { ...nativeConfig(options), responseFormat: 'json', schema },
      prompt,
    );
    return JSON.parse(text) as T;
  }

  /**
   * The answer as it is written, into a signal. Cancels any stream still running, because the
   * module runs one at a time. Never throws: an unavailable model is a stream that has already
   * failed, with the reason as its error.
   */
  stream(prompt: string, options: GenerateOptions = {}): LanguageModelStream {
    this.streaming?.cancel();

    let session: NativeLanguageSession | null = null;
    const stream = liveStream(
      (onText) => {
        this.refuseUnlessAvailable();
        const running = this.native!.session(nativeConfig(options));
        session = running;
        return running.stream(prompt, onText).finally(() => running.release());
      },
      () => void session?.cancel(),
    );
    this.streaming = session ? stream : null;
    return stream;
  }

  /**
   * A conversation that keeps its context across turns, with tools the model can call. Each
   * turn is refused like any call while the model is unavailable. Released when
   * `options.injector`, or the injection context this is called in, is destroyed.
   */
  session(options: LanguageModelSessionOptions = {}): LanguageModelSession {
    const injector = options.injector ?? callerInjector() ?? this.injector;
    return new LanguageModelSession(
      {
        refuseUnlessAvailable: () => this.refuseUnlessAvailable(),
        create: (sessionConfig) => this.native!.session(sessionConfig),
      },
      options,
      injector,
    );
  }

  private async once(sessionConfig: SessionConfig, prompt: string): Promise<string> {
    this.refuseUnlessAvailable();
    const session = this.native!.session(sessionConfig);
    try {
      return await session.respond(prompt);
    } finally {
      session.release();
    }
  }

  /** Re-reads rather than trusting the signal, which only moves when the platform announces it. */
  private refuseUnlessAvailable(): void {
    const availability = this.refresh();
    if (availability !== 'available') throw new LanguageModelUnavailableError(availability);
  }

  private read(): LanguageModelAvailability {
    const native = present(this.native);
    return native ? known(native.availability()) : 'notInstalled';
  }
}

function known(value: string): LanguageModelAvailability {
  return REPORTED.has(value) ? (value as LanguageModelAvailability) : 'unknown';
}

let requests = 0;

/** The injector of the injection context this is called in, or null outside one. */
function callerInjector(): Injector | null {
  try {
    return inject(Injector);
  } catch {
    return null;
  }
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function quietly(answer: () => void): void {
  try {
    answer();
  } catch {
    // See the caller.
  }
}
