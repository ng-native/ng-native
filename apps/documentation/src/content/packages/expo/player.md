---
title: Video and audio player
summary: videoPlayer()/audioPlayer(), released on destroy, and the <expo-video> view.
---

# Video and audio player

`videoPlayer()` and `audioPlayer()` create a player owned by the current component, wired to
`expo-video` and `expo-audio`. `useVideoPlayer` and `useAudioPlayer` are the documented way in,
and the player they hand back is not the React part - `createVideoPlayer` gives the same object.
What these functions add is the two things a component needs and cannot get otherwise: the player
is _released_ when the component is destroyed, and its changing state is _readable_, because the
player's own properties are plain mutable fields no template can watch.

## Install

```sh
npx expo install expo-video expo-audio
```

```ts
import { videoPlayer } from '@ng-native/expo/video';
import { audioPlayer } from '@ng-native/expo/audio';
```

Install only the one an app needs: each has its own entry point, so an app bundles with only its
own module installed. `Player`, `PlayerState` and the watchers both use come from
`@ng-native/expo/player`.

## The smallest useful example

```ts
import { Component } from '@angular/core';
import { registerExpoViews } from '@ng-native/expo';
import { videoPlayer } from '@ng-native/expo/video';

registerExpoViews('expo-video'); // once, before the app mounts

@Component({
  selector: 'app-clip',
  template: `
    <expo-video [player]="player.native" class="flex-1" />
    <text>{{ player.state().currentTime }} / {{ player.state().duration }}</text>
    <pressable (press)="player.native.play()"><text>Play</text></pressable>
  `,
})
export class Clip {
  protected readonly player = videoPlayer('https://example.com/clip.mp4', { timeUpdate: 0.5 });
}
```

## `videoPlayer(source, options?)` and `audioPlayer(source, options?)`

Both must be called in an injection context - a field initializer or a constructor - the same
constraint the React hooks have and for the same reason: something has to know when the component
that owns the player goes away. `source` is the module's own source type (`VideoSource` or
`AudioSource`); `options.timeUpdate` is the number of seconds between `currentTime` updates.

Each returns a `Player<T>`:

- **`native`** - the module's own player object, straight through: it already has `play()`,
  `pause()`, `seekBy()`, `replace()` and the rest, and wrapping them would be a second place for
  each to be wrong. Pass it to `<expo-video [player]="player.native">`, or call its methods
  directly for audio.
- **`state`** - a signal, updated from the player's own change events: `playing`, `status`
  (`'idle'`, `'loading'`, `'readyToPlay'`, `'error'`), `currentTime`, `duration`, `muted`,
  `volume`, and `ended` (set once playback runs to the end, cleared when it starts again). Video
  reports these across several named events; audio reports all of them together on one status
  event, since that is how `expo-audio` emits them.

## `timeUpdate`

For video, off unless asked for: `currentTime` never moves without it, because `timeUpdate` is
the most frequent event the player emits, and a screen with no progress bar should not pay for it.
Pass `{ timeUpdate: 0.5 }` for updates twice a second.

For audio, `currentTime` always moves: `expo-audio` reports its status on an interval regardless,
500ms by default. `timeUpdate` sets that interval instead of switching it on - `{ timeUpdate: 0.5 }`
still means updates twice a second, just by shortening the interval rather than enabling it.

## Release

The player is released when the component that created it is destroyed - no `ngOnDestroy` to
write. A player left alive holds its decoder, its audio session and, on iOS, the now-playing
controls, so this happens automatically rather than being something a caller has to remember.

## The `<expo-video>` view

`videoPlayer()` gives you the player; showing it needs the view. Register it once, before the app
mounts:

```ts
import { registerExpoViews } from '@ng-native/expo';

registerExpoViews('expo-video');
```

Then use it as a plain element, with `player` bound to `player.native`:

```html
<expo-video [player]="player.native" [nativeControls]="false" contentFit="cover" class="flex-1" />
```

The props are `expo-video`'s own `VideoViewProps`, unwrapped: `player`, `nativeControls` (default
`true`), `contentFit` (`'contain'`, `'cover'` or `'fill'`, default `'contain'`),
`requiresLinearPlayback`, `fullscreenOptions`, and a few platform-specific ones (`showsTimecodes`
on iOS, `surfaceType` and `buttonOptions` on Android). There is no Angular component wrapping
these props one by one - an unknown prop on the element reaches native exactly as it would in
`expo-video`'s own React component, and the module's own documentation is the reference for what
each one does.

Audio has no view: `expo-audio` plays through the device's audio session, not a view on screen.

## Without the module installed

`videoPlayer()` and `audioPlayer()` throw a `MissingModuleError` when `expo-video` (or
`expo-audio`) is missing - never installed, or installed without the app being rebuilt since - on
iOS, Android and the web alike, rather than returning a player that does nothing: there is no
sensible default state for a player object with no native side. Its message names the module and
the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed). An
`<expo-video>` with no `expo-video` installed commits as `UnimplementedNativeView` rather than
throwing, since the element is registered independently of whether the JavaScript module was ever
asked for a player.
