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

## `readdir(folder)`, `stat(path)` and `watch(path, listener)`

Each takes a uri, or anything with one: a file, a folder from `paths`, a folder the user picked.

- **`readdir(folder)`** resolves to the folder's entries, each with its `name`, `uri` and whether
  it is a `directory`.
- **`stat(path)`** resolves to what is there, `uri`, `directory`, `size` and the `modified` and
  `created` times in milliseconds (null where the platform does not say), or `null` where nothing
  is.
- **`watch(path, listener)`** calls the listener with each change to a file, or to what is in a
  folder: its `type` (`created`, `modified`, `deleted` or `renamed`), its `uri`, and for a rename
  the `newUri`. It answers the function that stops watching. On iOS a folder's watch reports a
  change to what is in it as `modified` on the folder itself, with the folder's `uri`, so it does
  not say which entry was created, deleted or renamed: read the folder again to find out.

```ts
const entries = await this.files.readdir(this.files.paths.document!);
const stop = this.files.watch(this.files.paths.document!, (change) => this.reload(change.uri));
```

They reach what the app can: its own folders and the folders the user picked.

On macOS everything else that takes a path or a `file:` uri from the app reaches no further than
`FileSystem` does, and the app's own assets. That covers an image to edit, show, measure or read
text from, a font, a file to print, share, drag out, open or save to the photo library, a request's
file url or body, an audio or video source, a web view's file page and `Asset.downloadAsync`. A
SQLite database opens or is made only where `FileSystem` can write. Anything else is refused with an
error naming the path, the same whether or not a file is there.

## `paths`

The folders an app writes to, as uris: `cache` and `document`, and the user's `home`, `desktop` and
`downloads`, `temp` and the app's `appData`. Each is `null` where the OS has no such folder or the
app cannot reach it, which on iOS and Android is all but `cache` and `document`.

## `pickDirectory()`

Deprecated: use [`DocumentPicker.pickDirectory()`](/packages/expo/document-picker), which answers
the same. This one goes in a later release.

## Without the module

On iOS and Android, a missing `expo-file-system` - never installed, or installed without the app
being rebuilt since - leaves the service made, so injecting it does not throw. A call, or a read of
a value only the module knows, throws a `MissingModuleError`. Its message names the module and the
commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed). On macOS
the same is true of a desktop host built without its file system module, and the message says to
rebuild it.

On the web, and in a test that provides no fake, `FileSystem` is absent: `available()` is `false`,
`cache()`, `document()` and `file()` answer a file that is not there, which `write()` leaves alone
and which reads as empty, `readdir()` answers no entries, `stat()` answers `null`, `watch()`
reports nothing and every folder in `paths` is `null`.

## Reference

<!-- api: FileSystem -->
