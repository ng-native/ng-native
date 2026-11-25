---
title: Sharing
summary: The system share sheet, and what its result does and does not confirm.
---

# Sharing

`Sharing` opens the system share sheet. Its result follows React Native's share action and does not
confirm that another app received the content on Android.

```ts
import { Component, inject } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { Sharing } from '@ng-native/device';

@Component({
  selector: 'app-article',
  imports: [Pressable, Text],
  template: `<pressable (press)="share()"><text>Share</text></pressable>`,
})
export class Article {
  private readonly sharing = inject(Sharing);

  protected async share(): Promise<void> {
    const shared = await this.sharing.share({
      url: 'https://example.com/article',
      title: 'Article',
    });
    if (shared) this.trackShare();
  }

  private trackShare(): void {}
}
```

`share(request)` takes a `ShareRequest`: `message` and/or `url` (iOS prefers `url` when both are
present), and `title`, passed in React Native's share-content object; the wrapper does not expose
the separate `dialogTitle` or `subject` options. At least one of `message` or `url` is required; a
request with neither resolves to `false` without opening anything.

React Native's own `Share` module has no `url` field on Android - only `title` and `message` reach
it there, and its own docs say Android's `message` "will often include a URL". `Sharing` folds
`url` into `message` on Android before calling it, on a line of its own if there is a `message`
already, so `share({ url, title })` opens a sheet with something to actually share on both
platforms rather than an empty body on Android.

`Share.share` resolves either way - dismissing the sheet is not an error - and `share()` collapses
both the failure and the dismissal cases down to `false`, reserving `true` for `sharedAction`: the
user picked a target app on iOS, or the sheet reported the action on Android. Neither platform
confirms that the receiving app actually consumed the content, so treat `true` as "the user chose
to share", not as delivery confirmation.

## On macOS

`@ng-native/device`'s `Sharing` uses `NgNativeSharing` on macOS, where React Native's `Share` has
no implementation. It shows AppKit's share picker below the top of the key window's content, with
the message as text and the url as a link, or as the file itself for a `file:` uri or a path, and
gives the picked service the title as its subject. A share answers as shared once the service has
shared, and as dismissed when the picker closes, the service fails, no window is showing, or
`NGN_NO_PROMPTS=1` is set.

## Off a device and on the web

Off a device `share()` always resolves to `false`. `Sharing` does not call the Web Share API on the
web.

## Reference

<!-- api: Sharing -->
