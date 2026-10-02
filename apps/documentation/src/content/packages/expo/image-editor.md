---
title: Image editor
summary: Resize, crop, rotate, flip and re-encode an image file, with the native memory released.
---

# Image editor

`ImageEditor` resizes, crops, rotates, flips and re-encodes an image file, bound to
`expo-image-manipulator`. A photo from the [image picker](/packages/expo/image-picker) is usually
far larger than anything the app shows or uploads, and this is how it becomes a thumbnail or an
upload-sized JPEG.

`edit()` takes the module's own actions and save options, and runs them through its contextual API:
each action applied in order, the result rendered and saved to a new file in the cache. The context
and the rendered image hold native memory that nothing else frees, so both are released once the
file is written, including when it fails.

## Install

```sh
npx expo install expo-image-manipulator
```

```ts
import { ImageEditor, SaveFormat, FlipType } from '@ng-native/expo/image-editor';
```

## The smallest useful example

```ts
import { Component, inject, signal } from '@angular/core';
import { ImagePicker } from '@ng-native/expo/image-picker';
import { ImageEditor, SaveFormat } from '@ng-native/expo/image-editor';

@Component({
  selector: 'app-avatar',
  template: `<pressable (press)="choose()"><text>Choose a photo</text></pressable>`,
})
export class Avatar {
  private readonly picker = inject(ImagePicker);
  private readonly editor = inject(ImageEditor);
  protected readonly uri = signal<string | null>(null);

  protected async choose(): Promise<void> {
    const [photo] = await this.picker.pick({ mediaTypes: ['images'] });
    if (!photo) return;
    const avatar = await this.editor.edit(photo.uri, [{ resize: { width: 256 } }], {
      format: SaveFormat.WEBP,
      compress: 0.8,
    });
    this.uri.set(avatar?.uri ?? null);
  }
}
```

## What it does

- **`edit(uri, actions?, options?)`** - applies each action in order and resolves to the saved
  file: its `uri`, `width` and `height`, and `base64` when asked for. Each action has exactly one
  key:
  - `{ resize: { width?, height? } }` - one side given keeps the aspect ratio.
  - `{ rotate: degrees }` - clockwise.
  - `{ flip: FlipType.Horizontal }` or `FlipType.Vertical`.
  - `{ crop: { originX, originY, width, height } }` - in pixels of the image as it is at that step.
  - `{ extent: { width, height, originX?, originY?, backgroundColor? } }` - on the web only, grows
    or shrinks the canvas, filling any new space with the color. Elsewhere it is skipped.

  The options are `format` (`SaveFormat.JPEG` by default, `PNG` or `WEBP`), `compress` from 0 to
  1, and `base64`.

- **`manipulate(uri)`** - the module's own `ImageManipulatorContext`, for chaining steps by hand:
  `resize()`, `rotate()`, `flip()`, `crop()` and `reset()`, then `renderAsync()` and
  the image's `saveAsync()`. The caller releases the context and the image once done.

`SaveFormat` and `FlipType` are exported beside the service: the module's own enums, typed as those
enums, without loading the module, so code that edits can run in a test.

## Without the module

On iOS and Android, a missing `expo-image-manipulator` - never installed, or installed without the
app being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `edit()` resolves to `null` and `manipulate()`
returns `null`.

## Reference

<!-- api: ImageEditor -->
