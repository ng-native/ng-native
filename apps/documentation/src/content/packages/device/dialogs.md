---
title: Dialogs
summary: The platform's own alert, confirmation, prompt, action sheet and toast, as promises.
---

# Dialogs

`Dialogs` wraps the platform's own alert, confirmation, prompt, action sheet and toast. Every one of
React Native's dialog APIs is a callback, and a dialog is fundamentally a question, so every method
here resolves to the answer instead.

```ts
import { Component, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { Dialogs } from '@ng-native/device';

@Component({
  selector: 'app-note-row',
  imports: [Pressable, Text],
  template: `<pressable (press)="remove()"><text>Delete</text></pressable>`,
})
export class NoteRow {
  private readonly dialogs = inject(Dialogs);

  protected async remove(): Promise<void> {
    const sure = await this.dialogs.confirm('Delete this note?', { destructive: true });
    if (sure) this.deleteNote();
  }

  private deleteNote(): void {}
}
```

`tell(title, message?, dismiss?)` says something and waits until it has been read, resolving when
the dialog is dismissed. `confirm(title, options?)` asks something with two answers and resolves to
whether they agreed; `destructive` paints the confirm button red, as the platform paints a delete.
The buttons keep the platform's own order: on iOS, Cancel on the left and the confirming button on
the right.

`ask(title, options?)` asks for a line of text and resolves to `null` if canceled. It is iOS only:
`Alert.prompt` has no Android equivalent, and inventing one out of a modal and a text input would be
a dialog that looks nothing like the platform's, so on Android this resolves to `null` and a caller
falls back to a screen of its own.

`choose(title, choices)` offers a short list of `Choice`s (`{ label, style? }`, with `style` one of
`'default' | 'cancel' | 'destructive'`) and resolves to the index chosen, or `null` if dismissed. It
picks the platform's own idiom - an action sheet on iOS, a dialog on Android - so the call site
writes the intent once. It appends a Cancel choice on both platforms if the list does not already
have one, because neither an action sheet nor an Android alert should be a dead end. Android's own
dialog holds at most three buttons, cancel included; past that the platform silently drops the rest,
so `choose()` logs a console error naming the fix rather than showing a list some of whose choices
nobody could ever reach - reach for a select built on your own control or an action-sheet-shaped
list instead for anything longer.

`choose(title, choices, { message })` adds the smaller line under the title that says what a
choice does, such as the explanation under a destructive one. On iOS it is the action sheet's
message, shown under the title; on Android it is the dialog's message, between the title and the
buttons.

```ts
const choice = await this.dialogs.choose(
  'Delete Appointment?',
  [{ label: 'Delete', style: 'destructive' }],
  {
    message: 'This will permanently delete this appointment. This cannot be undone.',
  },
);
```

`notify(message, options?)` says something small and transient: a toast on Android. iOS has no such
affordance and this does nothing there, rather than putting up a modal alert for something that did
not warrant interrupting anyone - an app that needs to be seen on both platforms wants `tell()`
instead.

## Off a device and on the web

Off a device `tell()` and `confirm()` resolve immediately (`confirm()` to `false`), `ask()` and
`choose()` resolve to `null` without showing anything, a `message` included, and `notify()` does
nothing, because there is no platform dialog underneath any of them. There is no equivalent to a
native action sheet or Android toast on the web; `tell()` and `confirm()` are the two most likely to
want a web fallback of their own.

## Reference

<!-- api: Dialogs -->
