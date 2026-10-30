/**
 * A conversation with the on-device model that keeps its context from one turn to the next, and
 * the tools the model can call during it. Made by `LanguageModel.session()`.
 *
 * The native session holds the conversation; this keeps a copy of it as plain data (the
 * transcript), because `expo-local-llm` does not read a native transcript back.
 */
import {
  DestroyRef,
  computed,
  runInInjectionContext,
  signal,
  type Injector,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import type {
  GenerateOptions,
  LanguageModelStream,
  LanguageModelStreamStatus,
  NativeLanguageSession,
  NativeSessionConfig,
  NativeToolCall,
} from './language-model.ts';

/** A tool's argument: what the model fills in, typed and, on iOS, constrained to the declaration. */
export interface LanguageModelToolParameter {
  readonly type: 'string' | 'number' | 'boolean';
  /** What the argument means, for the model. */
  readonly description: string;
  /** The values a `string` argument may take. */
  readonly enum?: readonly string[];
}

export type LanguageModelToolParameters = Readonly<Record<string, LanguageModelToolParameter>>;

type ArgumentOf<P extends LanguageModelToolParameter> = P extends {
  type: 'string';
  enum: readonly (infer Value extends string)[];
}
  ? Value
  : P extends { type: 'string' }
    ? string
    : P extends { type: 'number' }
      ? number
      : boolean;

/** The arguments a tool's handler receives, typed from its parameters. */
export type LanguageModelToolArguments<P extends LanguageModelToolParameters> = {
  -readonly [Key in keyof P]: ArgumentOf<P[Key]>;
};

/** A function the model can call during a session, for data the prompt does not carry. */
export interface LanguageModelTool<
  P extends LanguageModelToolParameters = LanguageModelToolParameters,
> {
  /** How the model names it. */
  readonly name: string;
  /** When to call it, for the model. */
  readonly description: string;
  readonly parameters: P;
  /**
   * Runs in the session's injection context, so it can `inject()`. A string goes to the model as
   * it is; anything else as JSON. A throw or a rejection tells the model the call failed.
   */
  handler(args: LanguageModelToolArguments<P>): unknown;
}

/** Declare a tool, with its handler's arguments typed from `parameters`. */
export function defineTool<const P extends LanguageModelToolParameters>(
  tool: LanguageModelTool<P>,
): LanguageModelTool<P> {
  return tool;
}

/** A tool call the model made: running, in `toolCalls`, or finished, in the transcript. */
export interface LanguageModelToolCall {
  readonly id: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, string | number | boolean>>;
}

/** One entry of a session's transcript. Plain JSON, so a conversation can be stored or shown. */
export type LanguageModelTranscriptEntry =
  | { readonly kind: 'instructions'; readonly text: string }
  | { readonly kind: 'prompt'; readonly text: string }
  | ({ readonly kind: 'toolCall' } & LanguageModelToolCall)
  | {
      readonly kind: 'toolOutput';
      readonly id: string;
      readonly tool: string;
      /** What the handler returned, as the model saw it; absent when it failed. */
      readonly output?: string;
      /** Why the handler failed; absent when it succeeded. */
      readonly error?: string;
    }
  | { readonly kind: 'response'; readonly text: string };

export interface LanguageModelSessionOptions extends GenerateOptions {
  /** Functions the model can call. iOS only: Android refuses a session with tools. */
  readonly tools?: readonly LanguageModelTool[];
  /** How long a tool's handler may take, in seconds, before the call fails. 30 by default. */
  readonly toolTimeout?: number;
  /**
   * Where tool handlers inject from, and whose destruction releases the session. Defaults to the
   * injection context `session()` is called in, or the app's when there is none.
   */
  readonly injector?: Injector;
}

/** Raised when the conversation no longer fits the model's context window. */
export class LanguageModelContextExceededError extends Error {
  /** The conversation up to the turn that did not fit, to summarise into a new session. */
  readonly transcript: readonly LanguageModelTranscriptEntry[];

  constructor(transcript: readonly LanguageModelTranscriptEntry[], cause: unknown) {
    super('The conversation no longer fits the context window of the on-device model', {
      cause,
    });
    this.name = 'LanguageModelContextExceededError';
    this.transcript = transcript;
  }
}

/** The stream machinery the service's one-shot `stream()` and a session's turns share. */
export function liveStream(
  run: (onText: (soFar: string) => void) => Promise<string>,
  stop: () => void,
  toolCalls: Signal<readonly LanguageModelToolCall[]> = NO_CALLS,
): LanguageModelStream {
  const text = signal('');
  const status = signal<LanguageModelStreamStatus>('streaming');
  const error = signal<string | null>(null);
  let cancelled = false;

  const fail = (failure: unknown): never => {
    status.set('failed');
    error.set(failure instanceof Error ? failure.message : String(failure));
    throw failure;
  };

  let result: Promise<string>;
  try {
    result = run((soFar) => text.set(soFar)).then((final) => {
      text.set(final);
      status.set(cancelled ? 'cancelled' : 'done');
      return final;
    }, fail);
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

  return {
    text: text.asReadonly(),
    status: status.asReadonly(),
    error: error.asReadonly(),
    toolCalls,
    result,
    cancel: () => {
      if (status() !== 'streaming') return;
      cancelled = true;
      stop();
    },
  };
}

const NO_CALLS: Signal<readonly LanguageModelToolCall[]> = signal([]).asReadonly();

interface Turn {
  readonly calls: WritableSignal<readonly LanguageModelToolCall[]>;
  cancelled: boolean;
  native: NativeLanguageSession | null;
  /** The reply's own `cancel()`, so a cancel from the session marks the reply cancelled too. */
  cancel: () => void;
}

/**
 * A conversation that remembers. Each turn sees the turns before it, and one turn runs at a time:
 * starting a turn cancels the one still running and waits for it to stop.
 *
 * A turn reaches the transcript when it finishes. A cancelled or failed turn does not, because
 * the native session drops it too, so the transcript always matches what the model remembers.
 */
export class LanguageModelSession {
  private readonly entries: WritableSignal<readonly LanguageModelTranscriptEntry[]>;
  private readonly current = signal<Turn | null>(null);
  private readonly tools: ReadonlyMap<string, LanguageModelTool>;
  private readonly config: NativeSessionConfig;
  private readonly unregister: () => void;
  private readonly refuseUnlessAvailable: () => void;
  private readonly create: (config: NativeSessionConfig) => NativeLanguageSession;
  private readonly injector: Injector;
  private native: NativeLanguageSession | null = null;
  private last: Promise<unknown> = Promise.resolve();
  private released = false;

  /** The conversation so far, as plain data: the instructions, then each finished turn. */
  readonly transcript: Signal<readonly LanguageModelTranscriptEntry[]>;

  /** The tool calls running now, for a "Looking it up" state. Empty between calls. */
  readonly toolCalls: Signal<readonly LanguageModelToolCall[]> = computed(
    () => this.current()?.calls() ?? [],
  );

  /** @internal Made by `LanguageModel.session()`. */
  constructor(
    native: {
      /** Throws the reason the model cannot answer now. */
      readonly refuseUnlessAvailable: () => void;
      readonly create: (config: NativeSessionConfig) => NativeLanguageSession;
    },
    options: LanguageModelSessionOptions,
    injector: Injector,
  ) {
    this.refuseUnlessAvailable = native.refuseUnlessAvailable;
    this.create = native.create;
    this.injector = injector;
    const { instructions, temperature, maxTokens, topK } = options;
    const { tools = [], toolTimeout } = options;
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.entries = signal(
      instructions === undefined ? [] : [{ kind: 'instructions', text: instructions }],
    );
    this.transcript = this.entries.asReadonly();
    this.config = nativeConfig({ instructions, temperature, maxTokens, topK }, tools, toolTimeout);
    this.unregister = injector.get(DestroyRef).onDestroy(() => this.release());
  }

  /** The reply as it is written. Never throws: a turn that cannot start is a failed stream. */
  stream(prompt: string): LanguageModelStream {
    const turn: Turn = { calls: signal([]), cancelled: false, native: null, cancel: () => {} };
    const reply = liveStream(
      (onText) => this.take(turn, prompt, onText),
      () => this.stop(turn),
      turn.calls.asReadonly(),
    );
    turn.cancel = reply.cancel;
    return reply;
  }

  /** The whole reply. Rejects with the reason when the turn fails or the model is unavailable. */
  respond(prompt: string): Promise<string> {
    return this.stream(prompt).result;
  }

  /** Stop the running turn. A stream keeps the text so far; the turn is left out of the transcript. */
  cancel(): void {
    const turn = this.current();
    turn?.cancel();
  }

  /** End the session and free the native one. Later turns fail. */
  release(): void {
    this.released = true;
    this.unregister();
    this.cancel();
    this.native?.release();
    this.native = null;
  }

  /** Throws at once when the turn cannot start, so its stream shows the reason on first render. */
  private take(turn: Turn, prompt: string, onText: (soFar: string) => void): Promise<string> {
    this.refuseIfReleased();
    this.refuseUnlessAvailable();
    const before = this.current();
    before?.cancel();
    this.current.set(turn);
    const running = this.run(turn, prompt, onText, this.last);
    this.last = running.catch(() => {});
    return running;
  }

  private async run(
    turn: Turn,
    prompt: string,
    onText: (soFar: string) => void,
    previous: Promise<unknown>,
  ): Promise<string> {
    // The native session takes one turn at a time, and a cancelled one stops asynchronously.
    // Releasing the session cancels this turn too, so it never reaches a released session.
    await previous;
    if (turn.cancelled) return '';
    const native = (this.native ??= this.create(this.config));
    turn.native = native;
    const entries: LanguageModelTranscriptEntry[] = [{ kind: 'prompt', text: prompt }];
    try {
      const text = await native.stream(prompt, onText, (call) => this.call(turn, call, entries));
      if (!turn.cancelled) {
        this.entries.update((all) => [...all, ...entries, { kind: 'response', text }]);
      }
      return text;
    } catch (failure) {
      if (code(failure) === 'ERR_CONTEXT_WINDOW_EXCEEDED') {
        throw new LanguageModelContextExceededError(this.entries(), failure);
      }
      throw failure;
    }
  }

  private refuseIfReleased(): void {
    if (this.released) throw new Error('This language model session has been released');
  }

  private stop(turn: Turn): void {
    if (turn.cancelled) return;
    turn.cancelled = true;
    void turn.native?.cancel();
  }

  private async call(
    turn: Turn,
    call: NativeToolCall,
    entries: LanguageModelTranscriptEntry[],
  ): Promise<string> {
    entries.push({ kind: 'toolCall', ...call });
    turn.calls.update((calls) => [...calls, call]);
    try {
      const tool = this.tools.get(call.tool);
      if (!tool) throw new Error(`The session has no tool named ${call.tool}`);
      const value: unknown = await runInInjectionContext(this.injector, () =>
        tool.handler(call.arguments as never),
      );
      const output = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
      entries.push({ kind: 'toolOutput', id: call.id, tool: call.tool, output });
      return output;
    } catch (failure) {
      const error = failure instanceof Error ? failure.message : String(failure);
      entries.push({ kind: 'toolOutput', id: call.id, tool: call.tool, error });
      throw failure;
    } finally {
      turn.calls.update((calls) => calls.filter((running) => running.id !== call.id));
    }
  }
}

/** Only the keys that were given, so the native side sees its own defaults for the rest. */
export function nativeConfig(
  { instructions, ...sampling }: GenerateOptions,
  tools: readonly LanguageModelTool[] = [],
  toolTimeout?: number,
): NativeSessionConfig {
  const options = Object.fromEntries(
    Object.entries(sampling).filter(([, value]) => value !== undefined),
  );
  return {
    ...(instructions === undefined ? {} : { instructions }),
    ...(Object.keys(options).length === 0 ? {} : { options }),
    ...(tools.length === 0
      ? {}
      : {
          tools: tools.map(({ name, description, parameters }) => ({
            name,
            description,
            parameters,
          })),
        }),
    ...(toolTimeout === undefined ? {} : { toolTimeout }),
  };
}

function code(failure: unknown): unknown {
  return failure instanceof Error && 'code' in failure ? failure.code : undefined;
}
