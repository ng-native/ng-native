/**
 * A scripted on-device language model, for a test of a chat UI or a service built on
 * `LanguageModel` from `@ng-native/expo/language-model`, in Node, where no model can load:
 *
 *     const model = fakeLanguageModel();
 *     render(Chat, { providers: [{ provide: LanguageModel.SOURCE, useValue: model }] });
 *     model.reply({ toolCalls: [{ tool: 'listItemsDue', arguments: { from, to } }], text: 'Two.' });
 *
 * Each turn takes the next queued reply. A turn with none queued waits for the next `reply()`,
 * so a test can see the streaming state, and the tool calls running, before the answer lands.
 */
type Remove = { remove(): void };

/** A tool call the model makes, answered by the session's handler for it. */
export interface FakeToolCall {
  readonly tool: string;
  readonly arguments: Readonly<Record<string, string | number | boolean>>;
}

/**
 * The next answer: its text, or the tool calls the model makes first and then its text, or a
 * failure. A failure's `code` is the native one, such as `ERR_CONTEXT_WINDOW_EXCEEDED`.
 */
export type FakeReply =
  | string
  | { readonly toolCalls?: readonly FakeToolCall[]; readonly text: string }
  | { readonly error: string; readonly code?: string };

/** One turn the model was asked, with the configuration of the session it was asked in. */
export interface FakeRequest {
  readonly prompt: string;
  /** Instructions, sampling, `responseFormat`, `schema` and the tools' declarations. */
  readonly config: Readonly<Record<string, unknown>>;
}

interface FakeSession {
  respond(prompt: string): Promise<string>;
  stream(
    prompt: string,
    onText: (textSoFar: string) => void,
    onToolCall?: (call: FakeToolCall & { id: string }) => Promise<string>,
  ): Promise<string>;
  cancel(): Promise<void>;
  release(): void;
}

export interface FakeLanguageModel {
  /** Queue the answer to the next turn, or give it to a turn already waiting. */
  reply(answer: FakeReply): void;
  /** What the platform says, as `LanguageModel.availability` reads it. `available` at first. */
  setAvailability(availability: string): void;
  /** Every turn asked, in order. */
  readonly requests: readonly FakeRequest[];
  /** The `LanguageModel.SOURCE` side, which `LanguageModel` calls. */
  availability(): string;
  onAvailabilityChange(listener: (availability: string) => void): Remove;
  onDownloadProgress(listener: (progress: number) => void): Remove;
  download(): Promise<void>;
  session(config: Readonly<Record<string, unknown>>): FakeSession;
}

function failure(answer: { error: string; code?: string }): Error {
  return Object.assign(new Error(answer.error), answer.code ? { code: answer.code } : {});
}

export function fakeLanguageModel(): FakeLanguageModel {
  const queued: FakeReply[] = [];
  const waiting: ((answer: FakeReply) => void)[] = [];
  const listeners = new Set<(availability: string) => void>();
  const requests: FakeRequest[] = [];
  let current = 'available';
  let calls = 0;

  /** The next reply, and a way to stop waiting for it when the turn is cancelled. */
  const next = (): { reply: Promise<FakeReply>; abandon(): void } => {
    if (queued.length > 0) return { reply: Promise.resolve(queued.shift()!), abandon: () => {} };
    let take!: (answer: FakeReply) => void;
    const reply = new Promise<FakeReply>((resolve) => waiting.push((take = resolve)));
    const abandon = () => {
      const at = waiting.indexOf(take);
      if (at >= 0) waiting.splice(at, 1);
    };
    return { reply, abandon };
  };

  return {
    requests,
    reply: (answer) => {
      const turn = waiting.shift();
      if (turn) turn(answer);
      else queued.push(answer);
    },
    setAvailability: (availability) => {
      current = availability;
      for (const listener of listeners) listener(availability);
    },
    availability: () => current,
    onAvailabilityChange: (listener) => {
      listeners.add(listener);
      return { remove: () => void listeners.delete(listener) };
    },
    onDownloadProgress: () => ({ remove: () => {} }),
    download: async () => {},
    session: (config) => {
      let stop: (() => void) | null = null;
      const answer = async (
        reply: FakeReply,
        onToolCall?: (call: FakeToolCall & { id: string }) => Promise<string>,
      ): Promise<string> => {
        if (typeof reply === 'string') return reply;
        if ('error' in reply) throw failure(reply);
        for (const call of reply.toolCalls ?? []) {
          // As the native session does, a failed call goes back to the model, which answers on.
          await onToolCall?.({ id: `fake-call-${++calls}`, ...call }).catch(() => {});
        }
        return reply.text;
      };
      const ask = (prompt: string) => {
        requests.push({ prompt, config });
        return next();
      };
      return {
        respond: (prompt) => ask(prompt).reply.then((reply) => answer(reply)),
        stream: (prompt, onText, onToolCall) =>
          new Promise((resolve, reject) => {
            const turn = ask(prompt);
            let cancelled = false;
            // Cancelled, a turn ends with the text so far: none, since the text comes at once.
            stop = () => {
              cancelled = true;
              turn.abandon();
              resolve('');
            };
            // A cancelled turn makes no more tool calls, as the model stops with it.
            const call = (toolCall: FakeToolCall & { id: string }) =>
              cancelled ? Promise.resolve('') : onToolCall!(toolCall);
            turn.reply
              .then((reply) => answer(reply, onToolCall && call))
              .then((text) => {
                if (cancelled) return;
                onText(text);
                resolve(text);
              }, reject);
          }),
        cancel: async () => {
          stop?.();
          stop = null;
        },
        release: () => {},
      };
    },
  };
}
