// NgNativeAudio: what @ng-native/expo's audioPlayer and audioRecorder call on expo-audio, over an
// AudioOutput and an AudioInput, which the AppKit backend implements with AVPlayer and
// AVAudioRecorder. A TurboModule cannot hand back expo-audio's shared objects, so players and
// recorders are ids, and the JS adapter (desktop-audio.ts) wraps them in expo-audio's classes.
//
// Players:
// - createPlayer(uri | null, updateIntervalMs) -> id, replace(id, uri | null), release(id).
// - play(id), pause(id), seekTo(id, seconds) (a promise), setPlaybackRate(id, rate) (0 to 2),
//   setVolume(id, volume) (0 to 1), setMuted(id, muted), setLoop(id, loop).
// - status(id) -> expo-audio's AudioStatus. `ngNativeAudio` events {type: 'playbackStatusUpdate',
//   id, status} as it loads, plays, pauses, seeks, ends, and every update interval while playing.
//   Each end sends didJustFinish once; a looping player starts over, and one that is not stays
//   at the end until play() starts it from the beginning.
//
// Recorders:
// - getRecordingPermissionsAsync(), requestRecordingPermissionsAsync(): the microphone. Only what
//   is undetermined is asked, never with `noPrompts` (NGN_NO_PROMPTS=1), and the input asks only
//   when the app's Info.plist explains why.
// - createRecorder(options) -> id, prepareToRecordAsync(id, options) (rejects without the
//   microphone's permission, or with no microphone), record(id), pauseRecording(id),
//   stopRecording(id) (a promise), recorderStatus(id) -> expo-audio's RecorderState,
//   releaseRecorder(id). `ngNativeAudio` {type: 'recordingStatusUpdate', id, status} on a stop.
//   Recordings are files in `recordings`, named as expo-audio names them.
// - setAudioModeAsync(), setIsAudioActiveAsync(): nothing to set on macOS, which has no audio
//   session; they resolve.
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn {

struct TrackState {
  enum class Load { Loading, Ready, Failed };
  Load load{Load::Loading};
  std::string error;
  bool playing{false};
  bool buffering{false};
  // Seconds; a duration not known yet is 0.
  double currentTime{0};
  double duration{0};
};

// One source, playing or not. Destroying it stops it, and calls nothing after.
class AudioTrack {
 public:
  virtual ~AudioTrack() = default;
  virtual TrackState state() = 0;
  virtual void play(double rate) = 0;
  virtual void pause() = 0;
  // `done` once the position is there, on any thread.
  virtual void seek(double seconds, std::function<void()> done) = 0;
  // The rate while it plays.
  virtual void setRate(double rate) = 0;
  virtual void setVolume(double volume) = 0;
};

class AudioOutput {
 public:
  enum class Change { State, Ended };
  virtual ~AudioOutput() = default;
  // A track for a `file:` or `http(s):` uri, loading. `changed` on any thread: State as it loads
  // or fails and every `interval` seconds while it plays, Ended as it reaches the end.
  virtual std::unique_ptr<AudioTrack> open(const std::string &uri, double interval, std::function<void(Change)> changed) = 0;
};

// What a recording is made with, from expo-audio's RecordingOptions with its `ios` merged in.
struct RecordingSettings {
  // ".m4a", with its dot.
  std::string extension{".m4a"};
  // "aac", "pcm" (linear PCM, for .wav, .caf and .aiff) or "alac".
  std::string format{"aac"};
  double sampleRate{44100};
  int channels{2};
  int bitRate{128000};
  // expo-audio's AudioQuality, 0 (MIN) to 127 (MAX).
  int quality{127};
  int bitDepth{16};
  bool metering{false};
  bool operator==(const RecordingSettings &) const = default;
};

RecordingSettings recordingSettingsOf(const folly::dynamic &options);

class AudioRecording {
 public:
  virtual ~AudioRecording() = default;
  virtual bool record() = 0;
  virtual void pause() = 0;
  virtual void stop() = 0;
  virtual bool recording() = 0;
  // Seconds recorded.
  virtual double currentTime() = 0;
  // The average power in dBFS, when metering.
  virtual std::optional<double> metering() = 0;
};

class AudioInput {
 public:
  enum class Access { NotDetermined, Denied, Restricted, Granted };
  virtual ~AudioInput() = default;
  virtual Access access() = 0;
  // Shows the OS's prompt and answers once the user decides; answers the access as it is, with no
  // prompt, when the app's Info.plist gives no reason to ask. Any thread.
  virtual void requestAccess(std::function<void(Access)> done) = 0;
  virtual bool hasMicrophone() = 0;
  // A recording into `path`, ready to start; null with `error` set when it cannot be made. Only
  // called with access granted and a microphone.
  virtual std::unique_ptr<AudioRecording> prepare(const std::string &path, const RecordingSettings &settings, std::string &error) = 0;
};

std::shared_ptr<NativeModule> makeAudioModule(std::shared_ptr<AudioOutput> output, std::shared_ptr<AudioInput> input,
                                              std::string recordings, bool noPrompts);

} // namespace ngn
