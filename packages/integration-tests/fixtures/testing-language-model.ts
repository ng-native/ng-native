import { Component, inject, signal } from '@angular/core';
import { Pressable, Text } from '../../components/src/index.ts';
import {
  LanguageModel,
  defineTool,
  type LanguageModelStream,
} from '../../expo/src/language-model.ts';

const listItemsDue = defineTool({
  name: 'listItemsDue',
  description: 'The items due between two dates',
  parameters: {
    from: { type: 'string', description: 'The first day' },
    to: { type: 'string', description: 'The last day' },
  },
  handler: () => ['Rent'],
});

/** A chat that asks one question and shows the reply as it streams, with a lookup state. */
@Component({
  selector: 'x-testing-language-model',
  imports: [Pressable, Text],
  template: `
    @for (entry of chat.transcript(); track $index) {
      @if (entry.kind === 'prompt' || entry.kind === 'response') {
        <text>{{ entry.text }}</text>
      }
    }
    @if (reply(); as stream) {
      @if (stream.status() === 'streaming') {
        <text>{{ stream.toolCalls().length > 0 ? 'Looking it up...' : 'Thinking...' }}</text>
      }
    }
    <pressable accessibilityRole="button" (press)="ask()"><text>Ask</text></pressable>
  `,
})
export class TestingLanguageModelFixture {
  protected readonly chat = inject(LanguageModel).session({ tools: [listItemsDue] });
  protected readonly reply = signal<LanguageModelStream | null>(null);

  protected ask(): void {
    this.reply.set(this.chat.stream('What is due?'));
  }
}
