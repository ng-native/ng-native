---
title: File system
summary: The cache and document directories, a folder the user picks, and writing a file.
---

# File system

`FileSystem` locates files by what they are for, cache or document, rather than by path, and
hands back Expo's own `File`. It is a locator, not a file API: everything else - moving, listing,
downloading, streaming - is on the object it returns, documented by `expo-file-system` itself.

## Install

```sh
npx expo install expo-file-system
```

```ts
import { FileSystem } from '@ng-native/expo/file-system';
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { FileSystem } from '@ng-native/expo/file-system';

@Component({
  selector: 'app-notes',
  imports: [Pressable, Text],
  template: `<pressable (press)="save()"><text>Save</text></pressable>`,
})
export class Notes {
  private readonly files = inject(FileSystem);

  protected save(): void {
    this.files.write(this.files.document('notes.txt'), 'Buy milk');
  }
}
```

## `cache(name)` and `document(name)`

Both return Expo's `File` for a name in one of the two directories an app actually chooses
between:

- **`cache(name)`** - a file the system may delete under storage pressure. Use it for anything
  that can be rebuilt or re-downloaded.
- **`document(name)`** - a file that survives, and is included in backups. Use it for anything the
  user would notice losing.

Neither call touches disk; it only names where the file would live. `File` carries `uri`,
`exists`, `size`, and its own `text()`, `textSync()`, `bytes()`, `create()` and `delete()` - use
those directly for anything beyond writing.

## `file(uri)`

The file at a uri: a document the user picked, a photo from the library, a download. A picker
answers with a uri, and this is the file to read from it:

```ts
const [picked] = await this.documents.pick({ type: 'text/plain' });
if (picked) this.contents.set(await this.files.file(picked.uri).text());
```

## `write(file, content)`

`File.write()` alone throws on a file that has never been created, which is the first thing
everyone hits. `write()` creates the file first (with intermediates) if it does not already
exist, then writes - text or bytes - replacing whatever was there.

```ts
this.files.write(this.files.cache('thumb.jpg'), imageBytes);
```

## `pickDirectory()`

Opens the system folder picker and answers the folder the user chose, so a file can be saved
somewhere they can find it, such as an export in Files on iOS or a Drive folder on Android. It
answers `null` when the user dismisses the picker, like `DocumentPicker.pick()` answering no
files, and rethrows any other failure. No permission is asked for.

```ts
const folder = await this.files.pickDirectory();
if (folder) this.files.write(folder.createFile('export.csv', 'text/csv'), csv);
```

`createFile(name, mimeType)` makes the file inside the folder, empty, so `write()` finds it there
and only writes. Use `mimeType` for the type of the content (Android uses it, `null` means text).
Its type has only `uri` and `createFile()`. To list, move or delete, make Expo's own `Directory`
from the uri, `new Directory(folder.uri)`, imported from `expo-file-system`.

## Without the module

On iOS and Android, a missing `expo-file-system` - never installed, or installed without the app
being rebuilt since - leaves the service made, so injecting it does not throw. A call, or a read of
a value only the module knows, throws a `MissingModuleError`. Its message names the module and the
commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `FileSystem` still does not fall back to reporting
nothing, unlike most services in this package: `cache()` and `document()` throw
`[angular-native] expo-file-system is not installed`, so there is no file to `write()` to. A file
that silently failed to write is worse than an error that says why.

## Reference

<!-- api: FileSystem -->
