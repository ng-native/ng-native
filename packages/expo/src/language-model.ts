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
 * Every call is a conversation of its own: a session is made, asked once and released, so one
 * prompt never sees the last one. The module runs one stream at a time, so starting a stream
 * cancels the one before it.
 */
import {
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { expoModule, present } from './native.ts';

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

type SessionConfig = import('expo-local-llm').SessionConfig;

/** The slice of an `expo-local-llm` session this needs, with its token event unwrapped. */
export interface NativeLanguageSession {
  respond(prompt: string): Promise<string>;
  /** Resolves with the whole text, or the text so far when cancelled; rejects on failure. */
  stream(prompt: string, onText: (textSoFar: string) => void): Promise<string>;
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
            const session = llm.createLLMSession(config);
            return {
              respond: (prompt) => session.respond(prompt),
              stream: async (prompt, onText) => {
                const tokens = session.addListener('token', (event) => onText(event.accumulated));
                try {
                  return await session.streamResponse(prompt);
                } finally {
                  tokens.remove();
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
    return this.once(config(options), prompt);
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
    const text = await this.once({ ...config(options), responseFormat: 'json', schema }, prompt);
    return JSON.parse(text) as T;
  }

  /**
   * The answer as it is written, into a signal. Cancels any stream still running, because the
   * module runs one at a time. Never throws: an unavailable model is a stream that has already
   * failed, with the reason as its error.
   */
  stream(prompt: string, options: GenerateOptions = {}): LanguageModelStream {
    this.streaming?.cancel();

    const text = signal('');
    const status = signal<LanguageModelStreamStatus>('streaming');
    const error = signal<string | null>(null);
    let session: NativeLanguageSession | null = null;
    let cancelled = false;

    const fail = (failure: unknown): never => {
      status.set('failed');
      error.set(failure instanceof Error ? failure.message : String(failure));
      throw failure;
    };

    let result: Promise<string>;
    try {
      this.refuseUnlessAvailable();
      const running = this.native!.session(config(options));
      session = running;
      result = running
        .stream(prompt, (soFar) => text.set(soFar))
        .then((final) => {
          text.set(final);
          status.set(cancelled ? 'cancelled' : 'done');
          return final;
        }, fail)
        .finally(() => running.release());
    } catch (refusal) {
      result = Promise.reject(refusal);
      try {
        fail(refusal);
      } catch {
        // Recorded on the signals at once, so a template shows the reason on its first render.
      }
    }
    // Handled here so a stream whose result nobody awaits is not an unhandled rejection; anyone
    // who does await it still sees the failure.
    result.catch(() => {});

    const stream: LanguageModelStream = {
      text: text.asReadonly(),
      status: status.asReadonly(),
      error: error.asReadonly(),
      result,
      cancel: () => {
        if (status() !== 'streaming' || !session) return;
        cancelled = true;
        void session.cancel();
      },
    };
    this.streaming = session ? stream : null;
    return stream;
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

/** Only the keys that were given, so the native side sees its own defaults for the rest. */
function config({ instructions, ...sampling }: GenerateOptions): SessionConfig {
  const options = Object.fromEntries(
    Object.entries(sampling).filter(([, value]) => value !== undefined),
  );
  return {
    ...(instructions === undefined ? {} : { instructions }),
    ...(Object.keys(options).length === 0 ? {} : { options }),
  };
}
