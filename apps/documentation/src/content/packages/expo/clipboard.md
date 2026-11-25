---
title: Clipboard
summary: Read and write the pasteboard, and count changes without prompting for them.
---

# Clipboard

`Clipboard` reads and writes the system pasteboard, bound to `expo-clipboard`.

<!-- platforms: Clipboard -->

## Install

```sh
npx expo install expo-clipboard
```

```ts
import { Clipboard } from '@ng-native/expo/clipboard';
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { Clipboard } from '@ng-native/expo/clipboard';

@Component({
  selector: 'app-share-link',
  imports: [Pressable, Text],
  template: `<pressable (press)="copy()"><text>Copy link</text></pressable>`,
})
export class ShareLink {
  private readonly clipboard = inject(Clipboard);

  protected async copy(): Promise<void> {
    await this.clipboard.write('https://example.com');
  }
}
```

## What it does

- **`changes`** - a signal: how many times the pasteboard has changed since the app started
  reading it. It counts changes rather than holding the text, and that is deliberate: on iOS 16 and
  later, _reading_ the clipboard is what prompts the user for permission. A signal that held the
  contents would prompt on every change - including changes made by other apps - which is both a
  poor experience and a good way to have the read denied. The notification is free; the read stays
  explicit.
- **`read()`** - resolves to what is on the clipboard. On iOS 16+, this is the call that prompts
  for permission.
- **`write(text)`** - puts text on the clipboard. Resolves once native has it.

On Linux the GTK host's clipboard is the desktop's, through GTK. GTK reads another app's text
asynchronously, so `changes` moves once that text has been read, and `read()` answers it.

The change listener lives as long as the app does and is removed when the app is destroyed.
`Clipboard` is a root service, which makes it one per app rather than one per process: an app that
is mounted and unmounted - by a test's `unmount()`, a reload, or a host that embeds it - gets a
fresh listener each time and leaves none behind.

## Without the module

On iOS and Android, a missing `expo-clipboard` throws a
[`MissingModuleError`](/packages/expo/using-a-module#what-happens-without-the-module-installed) on
the first call or read that needs it. Injecting the service does not throw.

On the web, and in a test that provides no fake, `changes` stays at `0`. `read()` resolves to an
empty string. `write()` resolves without doing anything.

## Reference

<!-- api: Clipboard -->
