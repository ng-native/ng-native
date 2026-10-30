/**
 * A multi-turn language model session with tools, over a fake `expo-local-llm`.
 *
 * What is pinned is what the session adds over the native one: one native session for every turn,
 * made on the first; tool calls answered by handlers that can inject; the running calls and the
 * conversation as signals; a cancelled or failed turn left out of the transcript, as the native
 * session leaves it out of the model's context; one turn at a time; and the session released with
 * the injector it belongs to.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InjectionToken, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  LanguageModel,
  LanguageModelContextExceededError,
  LanguageModelUnavailableError,
  defineTool,
  type NativeLanguageModel,
  type NativeLanguageSession,
  type NativeToolCall,
} from '@ng-native/expo/language-model';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const ITEMS = new InjectionToken<{ due(from: string, to: string): string[] }>('items');

interface FakeTurn {
  readonly prompt: string;
  onText(text: string): void;
  finish(text: string): void;
  fail(error: Error): void;
  call(call: NativeToolCall): Promise<string>;
}

/** A model whose turns finish, fail and call tools when the test says so. */
function fakeModel(availability = 'available') {
  const log: unknown[] = [];
  const turns: FakeTurn[] = [];
  let current = availability;
  let creating: ((config: unknown) => void) | null = null;

  const native: NativeLanguageModel = {
    availability: () => current,
    onAvailabilityChange: () => ({ remove: () => {} }),
    onDownloadProgress: () => ({ remove: () => {} }),
    download: async () => {},
    session: (config) => {
      creating?.(config);
      const id = log.filter((entry) => Array.isArray(entry) && entry[0] === 'session').length;
      log.push(['session', config]);
      let running: { finish: (text: string) => void; last: string } | null = null;
      const session: NativeLanguageSession = {
        respond: async () => assert.fail('a session turn streams'),
        stream: (prompt, onText, onToolCall) => {
          log.push(['stream', id, prompt]);
          return new Promise((resolve, reject) => {
            const turn = {
              last: '',
              prompt,
              onText: (text: string) => ((turn.last = text), onText(text)),
              finish: (text: string) => ((running = null), resolve(text)),
              fail: (error: Error) => ((running = null), reject(error)),
              call: (call: NativeToolCall) => onToolCall!(call),
            };
            running = turn;
            turns.push(turn);
          });
        },
        cancel: async () => {
          log.push(['cancel', id]);
          // As the module does: a cancelled stream resolves with the text so far, later.
          const turn = running;
          await settle();
          turn?.finish(turn.last);
        },
        release: () => log.push(['release', id]),
      };
      return session;
    },
  };

  return {
    log,
    turns,
    native,
    setAvailability: (value: string) => void (current = value),
    onCreate: (listener: (config: unknown) => void) => void (creating = listener),
    injector: (providers: { provide: unknown; useValue: unknown }[] = []) =>
      Injector.create({
        providers: [{ provide: LanguageModel.SOURCE, useValue: native }, ...(providers as never[])],
      }),
  };
}

function modelIn(injector: Injector): LanguageModel {
  return runInInjectionContext(injector, () => new LanguageModel());
}

const listItemsDue = defineTool({
  name: 'listItemsDue',
  description: 'Items due between two dates',
  parameters: {
    from: { type: 'string', description: 'ISO date' },
    to: { type: 'string', description: 'ISO date' },
  },
  handler: ({ from, to }) => inject(ITEMS).due(from, to),
});

describe('a language model session', () => {
  it('keeps one native session for every turn, made on the first, and records each turn', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session({
      instructions: 'You help with records.',
      temperature: 0.2,
    });
    assert.deepEqual(fake.log, [], 'nothing native until the first turn');
    assert.deepEqual(session.transcript(), [
      { kind: 'instructions', text: 'You help with records.' },
    ]);

    const first = session.stream('What is due?');
    await settle();
    fake.turns[0]!.onText('Two');
    assert.equal(first.text(), 'Two');
    fake.turns[0]!.finish('Two things.');
    assert.equal(await first.result, 'Two things.');
    assert.equal(first.status(), 'done');

    const second = session.respond('And next month?');
    await settle();
    fake.turns[1]!.finish('Nothing.');
    assert.equal(await second, 'Nothing.');

    assert.deepEqual(fake.log, [
      ['session', { instructions: 'You help with records.', options: { temperature: 0.2 } }],
      ['stream', 0, 'What is due?'],
      ['stream', 0, 'And next month?'],
    ]);
    assert.deepEqual(session.transcript(), [
      { kind: 'instructions', text: 'You help with records.' },
      { kind: 'prompt', text: 'What is due?' },
      { kind: 'response', text: 'Two things.' },
      { kind: 'prompt', text: 'And next month?' },
      { kind: 'response', text: 'Nothing.' },
    ]);
  });

  it('declares its tools to the native session without their handlers', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session({ tools: [listItemsDue], toolTimeout: 10 });
    session.stream('hello');
    await settle();
    assert.deepEqual(fake.log[0], [
      'session',
      {
        tools: [
          {
            name: 'listItemsDue',
            description: 'Items due between two dates',
            parameters: listItemsDue.parameters,
          },
        ],
        toolTimeout: 10,
      },
    ]);
  });
});

describe('a tool call in a session', () => {
  it('runs the handler where it can inject, answers with its output, and records the call', async () => {
    const fake = fakeModel();
    const due: unknown[] = [];
    const injector = fake.injector([
      {
        provide: ITEMS,
        useValue: { due: (from: string, to: string) => (due.push([from, to]), ['rent', 'gas']) },
      },
    ]);
    const session = modelIn(injector).session({ tools: [listItemsDue] });
    const reply = session.stream('What is due this month?');
    await settle();

    const call = {
      id: 'c1',
      tool: 'listItemsDue',
      arguments: { from: '2026-10-01', to: '2026-10-31' },
    };
    const answer = fake.turns[0]!.call(call);
    assert.equal(await answer, '["rent","gas"]', 'anything but a string goes to the model as JSON');
    assert.deepEqual(due, [['2026-10-01', '2026-10-31']]);

    fake.turns[0]!.finish('Rent and gas.');
    await reply.result;
    assert.deepEqual(session.transcript(), [
      { kind: 'prompt', text: 'What is due this month?' },
      { kind: 'toolCall', ...call },
      { kind: 'toolOutput', id: 'c1', tool: 'listItemsDue', output: '["rent","gas"]' },
      { kind: 'response', text: 'Rent and gas.' },
    ]);
  });

  it('shows the calls running now, on the reply and on the session, and clears them', async () => {
    const fake = fakeModel();
    let answer: (value: string) => void = () => {};
    const lookUp = defineTool({
      name: 'lookUp',
      description: 'Look something up',
      parameters: { query: { type: 'string', description: 'What to look up' } },
      handler: () => new Promise<string>((resolve) => (answer = resolve)),
    });
    const session = modelIn(fake.injector()).session({ tools: [lookUp] });
    const reply = session.stream('Find it');
    await settle();
    assert.deepEqual(reply.toolCalls(), []);

    const call = { id: 'c1', tool: 'lookUp', arguments: { query: 'it' } };
    const output = fake.turns[0]!.call(call);
    assert.deepEqual(reply.toolCalls(), [call]);
    assert.deepEqual(session.toolCalls(), [call]);

    answer('found');
    assert.equal(await output, 'found');
    assert.deepEqual(reply.toolCalls(), []);
    assert.deepEqual(session.toolCalls(), []);

    fake.turns[0]!.finish('Found it.');
    await reply.result;
    assert.deepEqual(session.toolCalls(), []);
  });

  it('fails the call when the handler throws, and records why', async () => {
    const fake = fakeModel();
    const broken = defineTool({
      name: 'broken',
      description: 'Always fails',
      parameters: {},
      handler: () => {
        throw new Error('The database is locked');
      },
    });
    const session = modelIn(fake.injector()).session({ tools: [broken] });
    const reply = session.stream('Try it');
    await settle();
    const call = { id: 'c1', tool: 'broken', arguments: {} };
    await assert.rejects(fake.turns[0]!.call(call), /The database is locked/);
    assert.deepEqual(session.toolCalls(), []);

    fake.turns[0]!.finish('I could not look that up.');
    await reply.result;
    assert.deepEqual(session.transcript().slice(1, 3), [
      { kind: 'toolCall', ...call },
      { kind: 'toolOutput', id: 'c1', tool: 'broken', error: 'The database is locked' },
    ]);
  });

  it('fails a call to a tool the session does not have', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session();
    session.stream('Try it');
    await settle();
    await assert.rejects(
      fake.turns[0]!.call({ id: 'c1', tool: 'missing', arguments: {} }),
      /no tool named missing/,
    );
  });

  it('injects from the injector given, over the one it was made in', async () => {
    const fake = fakeModel();
    const model = modelIn(fake.injector());
    const injector = Injector.create({
      providers: [{ provide: ITEMS, useValue: { due: () => ['from the option'] } }],
    });
    const caller = Injector.create({
      providers: [{ provide: ITEMS, useValue: { due: () => ['from the caller'] } }],
    });
    const session = runInInjectionContext(caller, () =>
      model.session({ tools: [listItemsDue], injector }),
    );
    session.stream('hello');
    await settle();
    assert.equal(
      await fake.turns[0]!.call({
        id: 'c1',
        tool: 'listItemsDue',
        arguments: { from: 'a', to: 'b' },
      }),
      '["from the option"]',
    );
  });

  it("injects from the caller's injection context when made in one", async () => {
    const fake = fakeModel();
    const model = modelIn(fake.injector());
    const component = Injector.create({
      providers: [{ provide: ITEMS, useValue: { due: () => ['from the caller'] } }],
    });
    const session = runInInjectionContext(component, () =>
      model.session({ tools: [listItemsDue] }),
    );
    session.stream('hello');
    await settle();
    assert.equal(
      await fake.turns[0]!.call({
        id: 'c1',
        tool: 'listItemsDue',
        arguments: { from: 'a', to: 'b' },
      }),
      '["from the caller"]',
    );
  });
});

describe('a session turn that does not finish', () => {
  it('stops when cancelled, keeps the text so far, and leaves the turn out of the transcript', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session();
    const reply = session.stream('Tell me everything');
    await settle();
    fake.turns[0]!.onText('Once');
    session.cancel();
    assert.equal(await reply.result, 'Once');
    assert.equal(reply.status(), 'cancelled');
    assert.deepEqual(fake.log.at(-1), ['cancel', 0]);
    assert.deepEqual(session.transcript(), []);
  });

  it('cancels the running turn when another starts, and starts it once the first has stopped', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session();
    const first = session.stream('one');
    await settle();
    const second = session.stream('two');
    assert.deepEqual(fake.log.at(-1), ['cancel', 0], 'the second has not started yet');
    assert.equal(await first.result, '');
    assert.equal(first.status(), 'cancelled');
    await settle();
    assert.deepEqual(fake.log.at(-1), ['stream', 0, 'two']);
    fake.turns[1]!.finish('Two.');
    await second.result;
    assert.deepEqual(session.transcript(), [
      { kind: 'prompt', text: 'two' },
      { kind: 'response', text: 'Two.' },
    ]);
  });

  it('never starts a turn cancelled while it waits for the one before', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session();
    session.stream('one');
    await settle();
    const second = session.stream('two');
    second.cancel();
    assert.equal(await second.result, '');
    assert.equal(second.status(), 'cancelled');
    await settle();
    assert.equal(fake.turns.length, 1);
  });

  it('leaves a failed turn out of the transcript and keeps the error on the reply', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session();
    const reply = session.stream('hello');
    await settle();
    fake.turns[0]!.fail(
      Object.assign(new Error('Guardrail violation'), { code: 'ERR_GUARDRAIL_VIOLATION' }),
    );
    await assert.rejects(reply.result, /Guardrail violation/);
    assert.equal(reply.status(), 'failed');
    assert.deepEqual(session.transcript(), []);
  });

  it('says when the conversation no longer fits, with the transcript to summarise', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session({ instructions: 'Be brief.' });
    const first = session.respond('one');
    await settle();
    fake.turns[0]!.finish('One.');
    await first;

    const reply = session.respond('two');
    await settle();
    const native = Object.assign(new Error('Context window exceeded'), {
      code: 'ERR_CONTEXT_WINDOW_EXCEEDED',
    });
    fake.turns[1]!.fail(native);
    await assert.rejects(reply, (error: unknown) => {
      assert.ok(error instanceof LanguageModelContextExceededError);
      assert.equal(error.cause, native);
      assert.deepEqual(error.transcript, [
        { kind: 'instructions', text: 'Be brief.' },
        { kind: 'prompt', text: 'one' },
        { kind: 'response', text: 'One.' },
      ]);
      return true;
    });
  });

  it("passes the platform's refusal of tools through, so an app can tell", async () => {
    const fake = fakeModel();
    const refusal = Object.assign(new Error('Tool calling is not supported on Android yet'), {
      code: 'ERR_TOOL_NOT_SUPPORTED',
    });
    fake.onCreate(() => {
      throw refusal;
    });
    const reply = modelIn(fake.injector())
      .session({ tools: [listItemsDue] })
      .stream('hello');
    await assert.rejects(reply.result, (error) => error === refusal);
    assert.equal(reply.status(), 'failed');
  });
});

describe('a session while the model is unavailable', () => {
  it("fails each turn at once with the platform's reason, and answers once it is back", async () => {
    const fake = fakeModel('notEnabled');
    const session = modelIn(fake.injector()).session();
    const reply = session.stream('hello');
    assert.equal(reply.status(), 'failed');
    assert.equal(reply.error(), 'The on-device language model is unavailable: notEnabled');
    await assert.rejects(reply.result, LanguageModelUnavailableError);
    assert.deepEqual(fake.log, []);

    fake.setAvailability('available');
    const again = session.respond('hello');
    await settle();
    fake.turns[0]!.finish('Hi.');
    assert.equal(await again, 'Hi.');
  });

  it('refuses every turn without the module', async () => {
    const injector = Injector.create({
      providers: [{ provide: LanguageModel.SOURCE, useValue: null }],
    });
    const session = modelIn(injector).session({ tools: [listItemsDue] });
    await assert.rejects(session.respond('hello'), (error: unknown) => {
      assert.ok(error instanceof LanguageModelUnavailableError);
      assert.equal(error.reason, 'notInstalled');
      return true;
    });
    session.cancel();
    session.release();
  });
});

describe('releasing a session', () => {
  it('cancels the running turn, frees the native session, and refuses later turns', async () => {
    const fake = fakeModel();
    const session = modelIn(fake.injector()).session();
    const reply = session.stream('hello');
    await settle();
    session.release();
    session.release();
    assert.deepEqual(
      fake.log.slice(1),
      [
        ['stream', 0, 'hello'],
        ['cancel', 0],
        ['release', 0],
      ],
      'a second release does nothing',
    );
    await reply.result;
    const again = session.stream('again');
    assert.equal(again.status(), 'failed', 'at once');
    await assert.rejects(again.result, /released/);
  });

  it('is released when the injector it was made in is destroyed', async () => {
    const fake = fakeModel();
    const model = modelIn(fake.injector());
    const component = Injector.create({ providers: [] });
    const session = runInInjectionContext(component, () => model.session());
    session.stream('hello');
    await settle();
    (component as unknown as { destroy(): void }).destroy();
    assert.deepEqual(fake.log.at(-1), ['release', 0]);
  });

  it('is released with the app when made outside an injection context', async () => {
    const fake = fakeModel();
    const app = fake.injector();
    const session = modelIn(app).session();
    session.stream('hello');
    await settle();
    (app as unknown as { destroy(): void }).destroy();
    assert.deepEqual(fake.log.at(-1), ['release', 0]);
  });
});
