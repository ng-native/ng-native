---
__default__: patch
---

On Linux, `<search-field>` from `@ng-native/expo` is drawn as the GTK host's `GtkSearchEntry`, and `focus()` and `blur()` reach it. Before, it looked for an Expo module the GTK host does not have, so it was hidden and warned that it was missing.

On Linux, a `<modal>` from `@ng-native/components` with an `anchor` waits for its anchor's view to commit before it presents, as it does on macOS, so a modal shown from the start opens as a popover at its anchor rather than as a sheet.

The messages for a desktop host built without a module or a method now name the OS's own script, `npm run linux` on Linux, in place of `npm run macos`: creating a file in a picked folder with no `NgNativeFileSystem`, an `ImageEditor` edit the host has no method for, and a `Processes.spawn` call the app did not declare.
