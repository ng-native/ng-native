---
title: Media library
summary: Save photos and videos to the user's library, and query what is in it.
---

# Media library

`MediaLibrary` saves to and reads from the user's photos and videos, bound to
`expo-media-library`. It is the library itself: for letting the user pick a photo, the
[image picker](/packages/expo/image-picker) needs no permission at all and is usually the better
fit.

The module's API is its classes. An `Asset` and an `Album` are handles, whose details are read
with their own async getters (`getFilename()`, `getWidth()`, `getUri()` and the rest), and a
`Query` is built by chaining. The service is where they are reached from, and where the two
permissions are: full access to read the library, and write-only access, which is all saving
needs and is the one to ask for when saving is all an app does.

## Install

```sh
npx expo install expo-media-library
```

```ts
import { MediaLibrary, AssetField, MediaType } from '@ng-native/expo/media-library';
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { MediaLibrary } from '@ng-native/expo/media-library';

@Component({
  selector: 'app-save-photo',
  template: `<pressable (press)="save()"><text>Save to Photos</text></pressable>`,
})
export class SavePhoto {
  private readonly library = inject(MediaLibrary);

  protected async save(): Promise<void> {
    const asset = await this.library.save('file:///path/to/edited.jpg');
    if (!asset) console.log('saving was refused');
  }
}
```

`save()` asks for write-only access itself, and resolves to `null` if it is refused.

## Reading the library

Reading needs full access, and a query is the module's own `Query`, handed to a function that
builds it:

```ts
import { inject } from '@angular/core';
import { AssetField, MediaLibrary, MediaType } from '@ng-native/expo/media-library';

const library = inject(MediaLibrary);

if (await library.permission.ensure()) {
  const recent = await library.assets((query) =>
    query
      .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
      .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
      .limit(30),
  );
  const uris = await Promise.all(recent.map((asset) => asset.getUri()));
}
```

`metadata(query)` runs the same query and answers with each asset's details at once, rather than
handles to read one getter at a time.

## What it does

- **`permission`** - a [`Permission`](/packages/expo/permissions) for full access, reading as well
  as adding.
- **`writePermission`** - a `Permission` for write-only access, which `save()` asks for.
- **`requestPermission(writeOnly?, granularPermissions?)`** - asks with the module's own options:
  on Android 13 and later, which of `'photo'`, `'video'` and `'audio'` to ask for.
- **`presentPermissionsPicker(mediaTypes?)`** - on iOS and Android 14 and later, after the user has
  granted access to only some photos, shows the system picker for changing which.
- **`save(uri, album?)`** - saves a local image or video file, into an album if one is given.
- **`assets(query?)`** and **`metadata(query?)`** - the assets a query finds, as handles or as
  details. Every asset without a query.
- **`asset(id)`** - the handle for an asset whose id is already known.
- **`deleteAssets(assets)`** - deletes them from the library.
- **`albums()`**, **`album(title)`**, **`createAlbum(name, assets, move?)`** and
  **`deleteAlbums(albums, deleteAssets?)`** - the user's albums.
- **`watch()`** - a signal: the library's most recent change, from the first call on. On iOS it
  carries the assets inserted, deleted and updated; on Android the event is empty. Listening reads
  the library, so it starts only when `watch()` is first called, which belongs after access is
  granted. The listener is removed when the app is destroyed.

`MediaType` and `AssetField` are exported beside the service: the module's own enums, typed as
those enums, without loading the module, so code that queries can run in a test.

The text in iOS's permission dialogs comes from the module's config plugin options,
`photosPermission` and `savePhotosPermission`.

## Without the module

On iOS and Android, a missing `expo-media-library` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, both permissions are refused, `save()`, `album()`
and `createAlbum()` resolve to `null`, `asset()` returns `null`, the queries and `albums()` resolve
to empty lists, `watch()` stays `null`, and every other method resolves without doing anything.

## Reference

<!-- api: MediaLibrary -->
