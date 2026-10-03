/**
 * `audioPlayer`, an `expo-audio` player owned by the component that makes it.
 *
 * ```ts
 * protected readonly player = audioPlayer(this.source, { timeUpdate: 0.5 });
 *
 * // {{ player.state().currentTime }}
 * ```
 */
import { expoModule, unavailable } from './native.ts';
import { ownPlayer, watchAudioPlayer, type Player } from './player.ts';

/**
 * An audio player owned by the current component, released when it is destroyed.
 *
 * `expo-audio` has no `timeUpdateEventInterval` property to set after the fact - the interval is
 * an option to `createAudioPlayer` itself, in milliseconds rather than `videoPlayer`'s seconds.
 */
export function audioPlayer(
  source: import('expo-audio').AudioSource,
  options: { timeUpdate?: number } = {},
): Player<import('expo-audio').AudioPlayer> {
  const expo = expoModule(
    'expo-audio',
    () => require('expo-audio') as typeof import('expo-audio'),
    ['ios', 'android', 'web'],
  );
  if (!expo) throw unavailable('expo-audio', 'Stand in for the player in the test.');
  const updateInterval = options.timeUpdate === undefined ? undefined : options.timeUpdate * 1000;
  const native = expo.createAudioPlayer(source, { updateInterval });
  return ownPlayer(native, () => watchAudioPlayer(native));
}
