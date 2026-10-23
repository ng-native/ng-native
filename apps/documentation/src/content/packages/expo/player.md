---
title: Video and audio player
summary: videoPlayer(), audioPlayer() and audioRecorder(), released on destroy, and <expo-video>.
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
import { audioPlayer, audioRecorder } from '@ng-native/expo/audio';
```

Install only the one an app needs: each has its own entry point, so an app bundles with only its
own module installed. `Player`, `PlayerState` and the watchers both use come from
`@ng-native/expo/player`.

## The smallest useful example

```ts
import { Component, input } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { registerExpoViews } from '@ng-native/expo';
import { videoPlayer } from '@ng-native/expo/video';

registerExpoViews('expo-video'); // once, before the app mounts

/** The view's one prop this uses, as an input, so the template is checked against it. */
@Component({ selector: 'expo-video', template: '', host: { '[player]': 'player()' } })
class ExpoVideo {
  readonly player = input<number>();
}

@Component({
  selector: 'app-clip',
  imports: [ExpoVideo, Pressable, Text],
  template: `
    <expo-video [player]="player.id" class="flex-1" />
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
  each to be wrong. Call its methods directly.
- **`id`** - the player's shared-object id, which is what `<expo-video [player]="player.id">`
  takes: `expo-video`'s own `VideoView` passes this id, not the player. Bound to the player
  itself, the view has no player and draws nothing, while the video keeps playing with nothing on
  screen.
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

## Playing with the silent switch on

On iOS an app plays nothing while the silent switch is on, unless it says it plays anyway. That is
`expo-audio`'s own `setAudioModeAsync`, a plain function with no React in it, so it is called
directly, before playing:

```ts
import { setAudioModeAsync } from 'expo-audio';

await setAudioModeAsync({ playsInSilentMode: true });
```

The mode belongs to the app, not to a player, and stays until it is set again. Android has no
silent switch and plays either way.

## `audioRecorder(options, { statusInterval? })`

`audioRecorder()` is `useAudioRecorder` and `useAudioRecorderState` for a component: a recorder
owned by the current component, released when it is destroyed, with its status as a signal. Call
it in an injection context, as the players:

```ts
import { Component, DestroyRef, ErrorHandler, inject } from '@angular/core';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { audioRecorder } from '@ng-native/expo/audio';

@Component({
  selector: 'app-voice-note',
  template: `<text>{{ recorder.state().durationMillis / 1000 }} s</text>`,
})
export class VoiceNote {
  protected readonly recorder = audioRecorder(RecordingPresets.HIGH_QUALITY);
  private readonly errorHandler = inject(ErrorHandler);
  private recordingMode = false;

  constructor() {
    // Destroyed while recording, stop() never runs, so the mode goes here.
    inject(DestroyRef).onDestroy(() => {
      if (!this.recordingMode) return;
      this.stopRecordingMode().catch((error: unknown) => this.errorHandler.handleError(error));
    });
  }

  async start(): Promise<void> {
    if (!(await requestRecordingPermissionsAsync()).granted) return;
    this.recordingMode = true;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await this.recorder.native.prepareToRecordAsync();
      this.recorder.native.record();
    } catch (error) {
      await this.stopRecordingMode();
      throw error;
    }
  }

  async stop(): Promise<string | null> {
    try {
      await this.recorder.native.stop();
    } finally {
      await this.stopRecordingMode();
    }
    return this.recorder.native.uri;
  }

  /** Recording mode routes playback to the earpiece on iOS, so it goes as soon as recording does. */
  private stopRecordingMode(): Promise<void> {
    this.recordingMode = false;
    return setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  }
}
```

It returns a `Recorder<AudioRecorder>`:

- **`native`** - the module's own recorder, for `prepareToRecordAsync()`, `record()`, `pause()`,
  `stop()`, `uri` and the rest. `record()` after `pause()` goes on in the same file.
- **`state`** - the recorder's `getStatus()`, asked every `statusInterval` seconds (0.5 by
  default) while the component lives: `isRecording`, `durationMillis`, `canRecord`, `url`,
  `mediaServicesDidReset`, and `metering`, the level in decibels, when the options turn
  `isMeteringEnabled` on. A change of up to 50 ms of duration, or up to 0.1 dB of level, both
  included, is no change, as in `useAudioRecorderState`. The interval
  is in seconds, as `audioPlayer`'s `timeUpdate` is, where `useAudioRecorderState` takes
  milliseconds.

The recorder is made with `options` merged for the platform, as `useAudioRecorder` makes it, so
`prepareToRecordAsync()` takes none. That matters on Android, where the recorder reads
`isMeteringEnabled` only from the options it was made with: one prepared with it but made without
it reports no `metering`. Android also measures the peak level where iOS measures the average, so
the same voice reads louder there. Permissions and the audio mode are `expo-audio`'s own plain
functions, as above. Releasing a recorder stops its recording but leaves the audio mode as it
was, so a component that sets recording mode sets it back when it is destroyed, as `VoiceNote`
does.

## The `<expo-video>` view

`videoPlayer()` gives you the player; showing it needs the view. Register it once, before the app
mounts:

```ts
import { registerExpoViews } from '@ng-native/expo';

registerExpoViews('expo-video');
```

Then use it as a plain element, with `player` bound to `player.id`:

```html
<expo-video [player]="player.id" [nativeControls]="false" contentFit="cover" class="flex-1" />
```

The view is `VideoView` on iOS and `SurfaceVideoView` on Android, as `expo-video` names them;
`registerExpoViews('expo-video')` registers each on its own platform.

The props are `expo-video`'s own `VideoViewProps`, unwrapped: `player`, `nativeControls` (default
`true`), `contentFit` (`'contain'`, `'cover'` or `'fill'`, default `'contain'`),
`requiresLinearPlayback`, `fullscreenOptions`, and a few platform-specific ones (`showsTimecodes`
on iOS, `buttonOptions` on Android). There is no Angular component wrapping these props one by
one - an unknown prop on the element reaches native exactly as it would in `expo-video`'s own
React component, and the module's own documentation is the reference for what each one does.

`surfaceType` is the exception: `expo-video`'s React component reads it to choose between two
Android views, and no native view reads it, so on the element it does nothing. For a
`TextureView` on Android, register that view under an element of its own:

```ts
import { registerExpoView } from '@ng-native/expo';

registerExpoView('expo-texture-video', 'ExpoVideo', {
  viewName: { ios: 'VideoView', android: 'TextureVideoView' },
});
```

Audio has no view: `expo-audio` plays through the device's audio session, not a view on screen.

## Without the module installed

`videoPlayer()`, `audioPlayer()` and `audioRecorder()` throw a `MissingModuleError` when
`expo-video` (or `expo-audio`) is missing - never installed, or installed without the app being
rebuilt since - on iOS, Android and the web alike, rather than returning a player that does
nothing: there is no sensible default state for a player object with no native side. Its message
names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed). An
`<expo-video>` with no `expo-video` installed commits as `UnimplementedNativeView` rather than
throwing, since the element is registered independently of whether the JavaScript module was ever
asked for a player.
