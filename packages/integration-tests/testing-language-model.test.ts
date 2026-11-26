/**
 * `fakeLanguageModel()` from `@ng-native/testing`, standing in for `LanguageModel.SOURCE`: each
 * turn takes the next scripted reply, waits for one when none is queued, calls the tools it
 * names through the session's handlers, and fails with the native code it is given.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { Injector, runInInjectionContext, type Type } from '@angular/core';
import {
  LanguageModel,
  LanguageModelContextExceededError,
  LanguageModelUnavailableError,
  defineTool,
  type NativeLanguageModel,
} from '@ng-native/expo/language-model';
import {
  cleanup,
  fakeLanguageModel,
  render,
  screen,
  userEvent,
  type FakeLanguageModel,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function modelOver(fake: FakeLanguageModel): LanguageModel {
  // Assigned to the source's own type, so the fake keeps up with what `LanguageModel` calls.
  const source: NativeLanguageModel = fake;
  const injector = Injector.create({
    providers: [{ provide: LanguageModel.SOURCE, useValue: source }],
  });
  return runInInjectionContext(injector, () => new LanguageModel());
}

describe('fakeLanguageModel()', () => {
  it('answers one-shot calls with the queued replies, in order, and records each request', async () => {
    const fake = fakeLanguageModel();
    const model = modelOver(fake);
    fake.reply('Hello.');
    fake.reply(JSON.stringify({ total: 3.3 }));

    assert.equal(await model.generate('Hi', { instructions: 'Be brief.' }), 'Hello.');
    const schema = { total: { type: 'number' } } as const;
    assert.deepEqual(await model.generateObject('Read it', schema), { total: 3.3 });
    assert.deepEqual(fake.requests, [
      { prompt: 'Hi', config: { instructions: 'Be brief.' } },
      { prompt: 'Read it', config: { responseFormat: 'json', schema } },
    ]);
  });

  it('keeps a turn streaming until a reply comes, running its tool calls first', async () => {
    const fake = fakeLanguageModel();
    let finishLookup!: (items: string[]) => void;
    const listItemsDue = defineTool({
      name: 'listItemsDue',
      description: 'Items due between two dates',
      parameters: {
        from: { type: 'string', description: 'The first day' },
        to: { type: 'string', description: 'The last day' },
      },
      handler: () => new Promise<string[]>((resolve) => (finishLookup = resolve)),
    });
    const session = modelOver(fake).session({ tools: [listItemsDue] });

    const reply = session.stream('What is due?');
    await settle();
    assert.equal(reply.status(), 'streaming', 'no reply queued yet');

    fake.reply({
      toolCalls: [{ tool: 'listItemsDue', arguments: { from: '2026-11-01', to: '2026-11-30' } }],
      text: 'Rent is due.',
    });
    await settle();
    assert.deepEqual(reply.toolCalls(), [
      {
        id: 'fake-call-1',
        tool: 'listItemsDue',
        arguments: { from: '2026-11-01', to: '2026-11-30' },
      },
    ]);
    assert.equal(reply.text(), '', 'the text comes after the tool calls');

    finishLookup(['Rent']);
    assert.equal(await reply.result, 'Rent is due.');
    assert.equal(reply.text(), 'Rent is due.');
    assert.deepEqual(reply.toolCalls(), []);
    assert.deepEqual(
      session.transcript().map((entry) => entry.kind),
      ['prompt', 'toolCall', 'toolOutput', 'response'],
    );
    assert.deepEqual(session.transcript()[2], {
      kind: 'toolOutput',
      id: 'fake-call-1',
      tool: 'listItemsDue',
      output: '["Rent"]',
    });
  });

  it('answers on after a tool call fails, as the model does', async () => {
    const fake = fakeLanguageModel();
    const session = modelOver(fake).session();
    fake.reply({ toolCalls: [{ tool: 'missing', arguments: {} }], text: 'I could not look.' });

    assert.equal(await session.respond('Look it up'), 'I could not look.');
    assert.deepEqual(session.transcript()[2], {
      kind: 'toolOutput',
      id: 'fake-call-1',
      tool: 'missing',
      error: 'The session has no tool named missing',
    });
  });

  it('fails a turn with the native code it is given', async () => {
    const fake = fakeLanguageModel();
    const session = modelOver(fake).session();
    fake.reply({ error: 'Too long', code: 'ERR_CONTEXT_WINDOW_EXCEEDED' });

    const failed = await session.respond('More').then(
      () => assert.fail('the turn should fail'),
      (error: unknown) => error,
    );
    assert.ok(failed instanceof LanguageModelContextExceededError);
    assert.equal((failed.cause as Error).message, 'Too long');
  });

  it('gives the next reply to the next turn when a waiting turn is cancelled', async () => {
    const fake = fakeLanguageModel();
    const session = modelOver(fake).session();

    const first = session.stream('First');
    await settle();
    first.cancel();
    assert.equal(await first.result, '');
    assert.equal(first.status(), 'cancelled');

    const second = session.stream('Second');
    await settle();
    fake.reply('Answer to the second.');
    assert.equal(await second.result, 'Answer to the second.');
    assert.equal(first.text(), '', 'the cancelled turn never takes it');
    assert.deepEqual(
      fake.requests.map((request) => request.prompt),
      ['First', 'Second'],
    );
  });

  it('drops the text, and makes no more tool calls, after a turn is cancelled in one', async () => {
    const fake = fakeLanguageModel();
    let finishLookup!: (value: string) => void;
    const lookedUp: string[] = [];
    const lookUp = defineTool({
      name: 'lookUp',
      description: 'Looks something up',
      parameters: { what: { type: 'string', description: 'What to look up' } },
      handler: ({ what }) => {
        lookedUp.push(what);
        return new Promise<string>((resolve) => (finishLookup = resolve));
      },
    });
    const session = modelOver(fake).session({ tools: [lookUp] });
    fake.reply({
      toolCalls: [
        { tool: 'lookUp', arguments: { what: 'first' } },
        { tool: 'lookUp', arguments: { what: 'second' } },
      ],
      text: 'Found it.',
    });

    const reply = session.stream('Look');
    await settle();
    reply.cancel();
    finishLookup('done');
    await settle();
    assert.equal(await reply.result, '');
    assert.equal(reply.text(), '');
    assert.deepEqual(lookedUp, ['first']);
  });

  it('reports the availability it is set to, and refuses turns while it is not available', async () => {
    const fake = fakeLanguageModel();
    const model = modelOver(fake);
    assert.equal(model.availability(), 'available');

    fake.setAvailability('notReady');
    assert.equal(model.availability(), 'notReady');
    await assert.rejects(model.generate('Hi'), LanguageModelUnavailableError);
    assert.deepEqual(fake.requests, []);
  });
});

describe('fakeLanguageModel() behind a rendered chat', () => {
  let Chat: Type<unknown>;
  before(async () => {
    const mod = await compileFixture('fixtures/testing-language-model.ts');
    Chat = mod['TestingLanguageModelFixture'] as Type<unknown>;
  });
  afterEach(() => cleanup());

  it('shows the turn waiting, then the answer once the test gives it', async () => {
    const model = fakeLanguageModel();
    await render(Chat, { providers: [{ provide: LanguageModel.SOURCE, useValue: model }] });

    await userEvent.press(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText('Thinking...');

    model.reply({
      toolCalls: [{ tool: 'listItemsDue', arguments: { from: '2026-11-01', to: '2026-11-30' } }],
      text: 'Rent is due.',
    });
    await screen.findByText('Rent is due.');
    assert.ok(screen.getByText('What is due?'));
    assert.equal(screen.queryByText('Thinking...'), null);
  });
});
