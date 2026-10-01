/**
 * `videoPlayer`, an `expo-video` player owned by the component that makes it.
 *
 * ```ts
 * protected readonly player = videoPlayer(this.source, { timeUpdate: 0.5 });
 *
 * // <expo-video [player]="player.native" />
 * // {{ player.state().currentTime }}
 * ```
 */
import { expoModule } from './native.ts';
import { ownPlayer, watchPlayer, type Player } from './player.ts';

/** A video player owned by the current component, released when it is destroyed. */
export function videoPlayer(
  source: import('expo-video').VideoSource,
  options: { timeUpdate?: number } = {},
): Player<import('expo-video').VideoPlayer> {
  const expo = expoModule(
    'expo-video',
    () => require('expo-video') as typeof import('expo-video'),
    ['ios', 'android', 'web'],
  );
  if (!expo) throw new Error('[angular-native] expo-video is not installed');
  const native = expo.createVideoPlayer(source);
  return ownPlayer(native, () => watchPlayer(native, options));
}
