---
title: Document picker
summary: Pick files with the system's own picker, and get nothing back when it is canceled.
---

# Document picker

`DocumentPicker` opens the system's file picker, bound to `expo-document-picker`: the Files app's
browser on iOS and the storage access framework on Android.

The options are the module's own, passed through unchanged. A canceled picker answers with no
files rather than a result to unwrap, and the system picker needs no permission, so none is asked
for.

## Install

```sh
npx expo install expo-document-picker
```

```ts
import { DocumentPicker } from '@ng-native/expo/document-picker';
```

## The smallest useful example

```ts
import { Component, inject, signal } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { DocumentPicker } from '@ng-native/expo/document-picker';

@Component({
  selector: 'app-attach',
  imports: [Pressable, Text],
  template: `
    <pressable (press)="attach()"><text>Attach a PDF</text></pressable>
    <text>{{ attached() }}</text>
  `,
})
export class Attach {
  private readonly documents = inject(DocumentPicker);
  protected readonly attached = signal('');

  protected async attach(): Promise<void> {
    const [file] = await this.documents.pick({ type: 'application/pdf' });
    if (file) this.attached.set(file.name);
  }
}
```

To read what was picked, open its uri with [`FileSystem`](/packages/expo/file-system#fileuri):
`await this.files.file(file.uri).text()`, with `files = inject(FileSystem)` as a field of the
component, or `.bytes()` for anything that is not text.

## What it does

- **`pick(options?)`** - opens the picker and resolves to the files chosen, empty if the user
  canceled. Each is the module's own `DocumentPickerAsset`: `uri`, `name`, `mimeType`, `size` and
  `lastModified`.
  - `type` - a MIME type such as `'image/*'`, or a list of them. Everything by default.
  - `multiple` - allow more than one file.
  - `copyToCacheDirectory` - on by default: each file is copied into the app's cache, so
    [the file system](/packages/expo/file-system) and other Expo modules can read its `uri`. Off
    leaves the platform's own reference, which only some readers understand.
  - `base64` - on the web, whether each `uri` is the file's contents as base64. On by default.

- **`pickDirectory()`** - opens the system folder picker and resolves to the folder chosen, so a
  file can be saved somewhere the user can find it, such as Files on iOS or a Drive folder on
  Android. `null` when the user dismisses it, and where the platform has no folder picker; any
  other failure is rethrown. It uses `expo-file-system`'s picker, so that package must be installed
  too. Make a file in the folder with `createFile(name, mimeType)`, then write it with
  [`FileSystem.write()`](/packages/expo/file-system). On macOS it is the desktop host's open
  panel, and the folder has a `uri` but no `createFile` yet: write a file with `save()` instead.
- **`save(options)`** - writes a file where the user chooses and resolves to where it went, or
  `null` if they dismissed the dialog or there is nowhere to save. On macOS it is the save panel;
  on iOS and Android the user picks a folder and the file is made in it.
  - `suggestedName` - the name to give the file, with its extension.
  - `contents` - text, or bytes for anything that is not text. Or `fromFile`, a file to copy, such
    as one from [the file system](/packages/expo/file-system).
  - `types` - the MIME types it may be saved as, the first the default.

```ts
const where = await this.documents.save({
  suggestedName: 'export.csv',
  contents: csv,
  types: ['text/csv'],
});
```

## Without the module

On iOS and Android, a missing `expo-document-picker` - never installed, or installed without the app
being rebuilt since - leaves the service made, so injecting it does not throw. A call, or a read of
a value only the module knows, throws a `MissingModuleError`. Its message names the module and the
commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `pick()` resolves to an empty list and
`pickDirectory()` and `save()` to `null`.

## Reference

<!-- api: DocumentPicker -->
