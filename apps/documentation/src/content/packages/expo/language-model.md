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
answer shaped by a schema, and `stream()` for an answer a template shows as it is written.

## Requirements

The model is the platform's, so whether there is one is the platform's decision, not the app's.

| Platform | What it needs                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS      | iOS 26 or later, on hardware that runs Apple Intelligence (iPhone 15 Pro and later, and iPads and Macs with an M-series chip), with Apple Intelligence switched on in Settings and its model downloaded. The simulator works when the Mac it runs on has Apple Intelligence on. |
| Android  | A phone that ships Gemini Nano. `expo-local-llm` names Pixel 8 and later and Galaxy S25 and later; the model may have to be downloaded first. Not buildable yet: see below.                                                                                                     |

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

### Android does not build yet

`expo-local-llm` 0.6's Android code depends on Google's
`com.google.ai.edge.localagent:localagent`, which is not published to Google's Maven repository or
Maven Central yet, so an Android build with the module in it fails to resolve that dependency.
Until it is, leave the module out of Android's native build in `package.json`:

```json
{
  "expo": {
    "autolinking": {
      "android": { "exclude": ["expo-local-llm"] }
    }
  }
}
```

`LanguageModel` then reports `notInstalled` on Android and works as before on iOS, so the same
code runs on both.

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
- **`maxTokens`** - a cap on the answer's length. Android caps it at 256 whatever you ask for.

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
answer always fits it. On Android the schema is only described to the model in the prompt, so
check what comes back before trusting it. A malformed schema rejects before reaching the model,
with the field paths that are wrong.

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
  or document fails. Android answers are capped at 256 tokens.
- **Guardrails.** Apple's model refuses some categories of prompt, such as interpreting personal
  health data. A refusal arrives as an error.
- **One conversation per call.** Each call is a fresh session, so the model does not remember the
  previous prompt. Carry what it needs in the prompt.
- **What is not wrapped.** `expo-local-llm` also offers multi-turn sessions and tool calling (iOS
  only); this service does not expose them yet.
- **Android is less proven.** `expo-local-llm`'s Android side is built on a beta Google SDK and,
  by its own account, not yet validated on a device.

## Reference

<!-- api: LanguageModel -->
