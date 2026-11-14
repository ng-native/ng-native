---
title: Undo
summary: The app's own actions on Edit > Undo and Redo, kept by the OS's undo manager.
---

# Undo

`UndoStack` puts what the app does on the OS's undo manager: NSUndoManager on macOS and
UIUndoManager on iOS and iPadOS. Edit > Undo and Edit > Redo in the menu bar, mod+z and
mod+shift+z, and shake to undo on an iPhone then take the app's actions back and do them again.
A focused text input keeps its own undo history, so these reach the app's actions only while no
text input has focus.

On Android and in the web host there is no undo manager: `available()` is `false` and every call
does nothing.

## Recording an action

Do the action, then `push` how to take it back and do it again:

```ts
import { UndoStack } from '@ng-native/device';

const undo = inject(UndoStack);

rename(note: Note, title: string): void {
  const before = note.title;
  this.notes.rename(note.id, title);
  undo.push({
    label: 'Rename',
    undo: () => this.notes.rename(note.id, before),
    redo: () => this.notes.rename(note.id, title),
  });
}
```

`label` names the action in the menu: Edit > Undo reads "Undo Rename". A new `push` clears what
Edit > Redo had, as on every Mac app.

## The rest of the API

- **`undo()`** and **`redo()`** - what Edit > Undo and Edit > Redo do, for a toolbar button of the
  app's own. The action runs when the undo manager reaches it, not before the call returns.
- **`clear()`** - forget every action, as after the document they changed is closed.
- **`canUndo()`**, **`canRedo()`**, **`undoLabel()`** and **`redoLabel()`** - signals for a button
  of the app's own to read.

The menu bar's Undo and Redo items stay the OS's own, which the undo manager names and enables, so
an app writes no `<menu-item>` for them.

## In a test

`provideDesktopFakes()`, and `render(X, { os: 'macos' })`, give `UndoStack` a fake undo manager.
`fakeUndo()` from `@ng-native/testing` makes one to hold: `chooseUndo()` and `chooseRedo()` play
Edit > Undo and Edit > Redo, and `undoTitle` and `redoTitle` read what the menu items say.
