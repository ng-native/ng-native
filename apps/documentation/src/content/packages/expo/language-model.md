---
title: On-device AI
summary: The language model the phone already has, as a service - Apple Foundation Models and
  Gemini Nano.
---

# On-device AI

`LanguageModel` wraps [`expo-local-llm`](https://github.com/GijungKim/expo-local-llm): the
language model the operating system already ships, asked from Angular. On iOS that is Apple's
Foundation Models, the model behind Apple Intelligence; on Android it is Gemini Nano. Nothing is
bundled with the app, there is no API key, and the prompt and the answer never leave the device.

It answers in three ways: `generate()` for the whole answer at once, `generateObject()` for an
answer shaped by a schema, and `stream()` for an answer a template shows as it is written. Each of
those is a conversation of its own; `session()` keeps one going across turns, with tools the model
can call to fetch what it needs.

## Requirements

The model is the platform's, so whether there is one is the platform's decision, not the app's.

| Platform | What it needs                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS      | iOS 26 or later, on hardware that runs Apple Intelligence (iPhone 15 Pro and later, and iPads and Macs with an M-series chip), with Apple Intelligence switched on in Settings and its model downloaded. The simulator works when the Mac it runs on has Apple Intelligence on. |
| Android  | A phone that ships Gemini Nano. `expo-local-llm` names Pixel 8 and later and Galaxy S25 and later; the model may have to be downloaded first. The app needs `minSdkVersion` 26: see below.                                                                                      |

Everything else - an older iPhone, iOS 25, most Android phones - loads the module and reports the
model as unavailable, with the reason. Plan for that being most of your users for a while.

## Install

```sh
npx expo install expo-local-llm
```

There is no config plugin and no permission to declare. The module adds native code, so it needs
a development build (`npx expo run:ios`, or EAS) rather than Expo Go, and an app that installs it
has to rebuild before it can answer. Its iOS code compiles for iOS 16.4 and later, which is Expo
SDK 57's default deployment target; if you have lowered yours, raise it with
`expo-build-properties`.

```ts
import { LanguageModel } from '@ng-native/expo/language-model';
```

### Android needs minSdk 26

On Android the module asks Gemini Nano through ML Kit's Prompt API, which needs API level 26
(Android 8.0). Expo SDK 57 builds for 24, so raise it with `expo-build-properties`:

```sh
npx expo install expo-build-properties
```

```json
{
  "expo": {
    "plugins": [["expo-build-properties", { "android": { "minSdkVersion": 26 } }]]
  }
}
```

`expo-local-llm` marks its Android generation as experimental: it has not been validated on Gemini
Nano hardware yet.

An app that does not want to raise it can leave the module out of Android's native build instead,
with `"autolinking": { "android": { "exclude": ["expo-local-llm"] } }` under `expo` in its
`package.json`. `LanguageModel` then reports `notInstalled` on Android and works as before on iOS,
so the same code runs on both.

## Streaming an answer into a template

`stream()` returns a `LanguageModelStream`: the text so far as a signal, a status, an error, and
`cancel()`. Keep the stream in a signal, and the template follows it as the model writes.

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { Pressable, Text, TextInput, View } from '@ng-native/components';
import { LanguageModel, type LanguageModelStream } from '@ng-native/expo/language-model';

@Component({
  selector: 'app-ask',
  imports: [Pressable, Text, TextInput, View],
  template: `
    @if (model.available()) {
      <text-input [(value)]="prompt" placeholder="Ask something" />
      <pressable (press)="ask()"><text>Ask</text></pressable>

      @if (answer(); as stream) {
        <text>{{ stream.text() }}</text>
        @if (stream.status() === 'streaming') {
          <pressable (press)="stream.cancel()"><text>Stop</text></pressable>
        }
        @if (stream.error(); as error) {
          <text>{{ error }}</text>
        }
      }
    } @else {
      <text>{{ unavailable() }}</text>
    }
  `,
})
export class Ask {
  protected readonly model = inject(LanguageModel);
  protected readonly prompt = signal('');
  protected readonly answer = signal<LanguageModelStream | null>(null);

  protected readonly unavailable = computed(() =>
    this.model.availability() === 'notEnabled'
      ? 'Switch on Apple Intelligence in Settings to use this.'
      : 'Not available on this device.',
  );

  protected ask(): void {
    this.answer.set(
      this.model.stream(this.prompt(), { instructions: 'Answer in two sentences or fewer.' }),
    );
  }
}
```

`status` is `'streaming'`, then one of `'done'`, `'cancelled'` or `'failed'`. A canceled stream
keeps the text it had written. `result` is a promise of the final text, for code that wants to
wait for it; it rejects when the stream fails, but a stream nobody awaits is never an unhandled
rejection. `stream()` itself never throws: an unavailable model gives a stream that has already
failed, with the reason as its error.

The module runs one stream at a time, so starting a stream cancels the one still running. A
stream also outlives the component that started it, so cancel it in `ngOnDestroy` if leaving the
screen should stop the model.

## The whole answer at once

```ts
const summary = await this.model.generate(notes, {
  instructions: 'Summarise these notes as three bullet points.',
  temperature: 0.3,
});
```

The options, for all three calls:

- **`instructions`** - the system instructions: who the model is and how it answers, kept apart
  from the prompt. iOS passes them to Foundation Models as instructions; Android prepends them to
  the prompt.
- **`temperature`**, **`topK`** - sampling. Lower is more predictable.
- **`maxTokens`** - a cap on the answer's length.

## A structured answer

`generateObject()` takes a schema, one field per property, and resolves to the parsed object:

```ts
const triage = await this.model.generateObject<{ topic: string; urgent: boolean }>(
  message,
  {
    topic: { type: 'string', enum: ['billing', 'delivery', 'other'] },
    urgent: { type: 'boolean', description: 'Whether the customer needs an answer today' },
  },
  { instructions: 'Classify this customer message.' },
);
```

Fields are `string` (optionally with `enum`), `number`, `integer`, `boolean`, `array` with `items`,
and `object` with `properties`. On iOS the model's decoding is constrained to the schema, so the
answer always fits it. On Android `generateObject()` rejects: `expo-local-llm` does not support a
structured answer there yet. A malformed schema rejects before reaching the model, with the field
paths that are wrong.

## A conversation, with tools

`session()` returns a `LanguageModelSession`: a conversation in which each turn sees the turns
before it. `stream()` gives the reply as a `LanguageModelStream`, the same as the one-shot
`stream()`, and `respond()` resolves to the whole reply.

The context window is small, so an app cannot paste its data into the prompt. Give the session
tools instead, and the model calls them for what it needs. `defineTool()` types the handler's
arguments from `parameters`:

```ts
import { inject } from '@angular/core';
import { defineTool } from '@ng-native/expo/language-model';

export const listItemsDue = defineTool({
  name: 'listItemsDue',
  description: 'The items due between two dates',
  parameters: {
    from: { type: 'string', description: 'The first day, as YYYY-MM-DD' },
    to: { type: 'string', description: 'The last day, as YYYY-MM-DD' },
  },
  handler: ({ from, to }) => inject(ItemsApi).due(from, to),
});
```

A parameter is a `string` (optionally with `enum`), a `number` or a `boolean`, and on iOS the
model's decoding is constrained to the declaration, so every argument arrives with its type. The
handler runs in the session's injection context, so it can `inject()`. A string it returns goes to
the model as it is, and anything else as JSON. When it throws or rejects, the model is told the
call failed. A handler gets 30 seconds unless `toolTimeout` says otherwise.

```ts
import { Component, inject, signal } from '@angular/core';
import { Pressable, Text, TextInput, View } from '@ng-native/components';
import { LanguageModel, type LanguageModelStream } from '@ng-native/expo/language-model';

@Component({
  selector: 'app-assistant',
  imports: [Pressable, Text, TextInput, View],
  template: `
    @for (entry of chat.transcript(); track $index) {
      @if (entry.kind === 'prompt' || entry.kind === 'response') {
        <text>{{ entry.text }}</text>
      }
    }
    @if (reply(); as stream) {
      @if (stream.status() === 'streaming') {
        <text>{{ stream.toolCalls().length > 0 ? 'Looking it up...' : stream.text() }}</text>
      }
      @if (stream.error(); as error) {
        <text>{{ error }}</text>
      }
    }
    <text-input [(value)]="prompt" placeholder="Ask about your records" />
    <pressable (press)="ask()"><text>Send</text></pressable>
  `,
})
export class Assistant {
  private readonly model = inject(LanguageModel);
  protected readonly chat = this.model.session({
    instructions: 'You help the user understand their records. Use the tools for any data.',
    tools: [listItemsDue],
  });
  protected readonly prompt = signal('');
  protected readonly reply = signal<LanguageModelStream | null>(null);

  protected ask(): void {
    this.reply.set(this.chat.stream(this.prompt()));
    this.prompt.set('');
  }
}
```

- **One turn at a time.** Starting a turn cancels the one still running, and the new one starts
  once that has stopped. `cancel()` stops the running turn.
- **`transcript`** is the conversation as plain JSON: the instructions, then for each finished turn
  its `prompt`, any `toolCall` and `toolOutput` entries, and its `response`. A turn joins it when
  it finishes. A cancelled or failed turn does not, because the model leaves it out of its context
  too. It is a record of the conversation, to show or store; a session cannot be started from one
  yet.
- **`toolCalls`**, on the session and on each reply, lists the tool calls running now, for a
  "Looking it up" state.
- **Release.** The session belongs to the injector of the injection context it is made in, such as
  the component above, and is released when that is destroyed. Pass `injector` to choose another.
  Made outside an injection context, it lives until the app is destroyed. `release()` ends it
  sooner; later turns fail.
- **Availability.** Each turn is refused like any other call while the model is unavailable: the
  reply fails at once with a `LanguageModelUnavailableError`.
- **The context window.** Every turn stays in the model's context, so a long conversation outgrows
  it. The turn then fails with a `LanguageModelContextExceededError`, whose `transcript` is the
  conversation up to that turn. Start a new session with a summary of it in `instructions`, which
  you can write with `generate()`.
- **A structured answer** is not part of a session: use the one-shot `generateObject()`, giving it
  what it needs from the conversation in the prompt.
- **Android.** `expo-local-llm` does not support tools on Android and refuses a session that has
  any. The reply fails with that error, whose `code` is `ERR_TOOL_NOT_SUPPORTED`. A session without
  tools works there as on iOS.

## Availability

`availability` is a signal of the platform's answer, and `available` is whether it is
`'available'`. When it is not, the value says why:

| Value              | Meaning                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `available`        | Ready to answer.                                                                          |
| `notEligible`      | This device or OS version cannot run the model.                                           |
| `notEnabled`       | The device can, but Apple Intelligence is switched off in Settings.                       |
| `notReady`         | The system is still preparing the model, usually downloading it after it was switched on. |
| `downloadRequired` | Android: Gemini Nano has to be downloaded. Call `download()`.                             |
| `downloading`      | Android: it is downloading. `downloadProgress` goes from 0 to 1.                          |
| `unknown`          | The platform gave a reason `expo-local-llm` does not name.                                |
| `notInstalled`     | `expo-local-llm` is not in this build, or its native code is not linked (Expo Go).        |

iOS announces a change when the app comes back to the front, which covers someone switching Apple
Intelligence on in Settings and returning. It does not announce the model finishing its
preparation while the app is open, so `refresh()` asks again and returns the answer. Every call
re-reads it before starting, so the signal being stale never sends a prompt to a model that is not
there.

On Android the first reading can be `unknown` while the module asks ML Kit whether Gemini Nano is
there; the signal moves when the module announces the answer.

A call made while the model is unavailable is refused before it reaches the model, with a
`LanguageModelUnavailableError` whose `reason` is one of the values above. `generate()` and
`generateObject()` reject with it; a stream fails with it.

## Fallbacks

Treat the model as an enhancement rather than a dependency. Most phones in use today cannot run
it, and on those that can it may be switched off or still downloading.

- Hide or disable the feature when `available()` is false, rather than showing a button that
  fails.
- Say what the person can do about it: `notEnabled` is fixed in Settings, `notReady` and
  `downloading` by waiting, `notEligible` not at all.
- For a feature that has to work everywhere, keep a server-side path and choose it when the
  on-device model is unavailable - and tell the person that their text is leaving the phone when
  it does.

## Privacy

The prompt, the instructions and the answer are processed by the model on the device. Nothing is
sent to Apple, Google or anyone else, there is no account or key, and it works offline. That is
the reason to reach for it for personal text - notes, messages, journal entries - that should not
go to a server.

## Limits

- **A small model.** Foundation Models and Gemini Nano are a few billion parameters: good at
  summarizing, rewriting, classifying and extracting, weak at facts and reasoning. Do not use it
  as a source of truth.
- **Short context.** About 4,000 tokens on iOS, prompt and answer together; a longer conversation
  or document fails.
- **Guardrails.** Apple's model refuses some categories of prompt, such as interpreting personal
  health data. A refusal arrives as an error.
- **One conversation per call.** `generate()`, `generateObject()` and `stream()` each start a fresh
  session, so the model does not remember the previous prompt. Use `session()` for a conversation.
- **Android is less proven.** `expo-local-llm`'s Android side is built on a beta Google SDK and,
  by its own account, not yet validated on a device.

## Reference

<!-- api: LanguageModel -->

<!-- api: LanguageModelSession -->
