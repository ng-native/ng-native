// NgNativeVideo: what @ng-native/expo's videoPlayer calls on expo-video, over a VideoOutput the
// AppKit backend implements with AVPlayer, and expo-video's view (ViewManagerAdapter_ExpoVideo_VideoView)
// as a Fabric component of the desktop's own. A TurboModule cannot hand back expo-video's shared
// objects, so players are numbers, and the JS adapter (desktop-video.ts) wraps each in expo-video's
// VideoPlayer, whose shared-object id is that number: `<expo-video [player]>` commits it, and the
// view finds the player's AVPlayer by it.
//
// - createPlayer(uri | null) -> id, replace(id, uri | null), release(id).
// - play(id), pause(id), replay(id) (from the start), seekBy(id, seconds), setCurrentTime(id, seconds).
// - setPlaybackRate(id, rate), setVolume(id, volume) (0 to 1), setMuted(id, muted), setLoop(id, loop),
//   setPreservesPitch(id, preserves), setTimeUpdateEventInterval(id, seconds) (0 stops them).
// - state(id) -> {status, playing, currentTime, duration, bufferedPosition, playbackRate, volume,
//   muted, loop, preservesPitch, timeUpdateEventInterval}, what the player's getters read.
//
// Events are `ngNativeVideo` {type, id, payload}, with expo-video's iOS names and payloads:
// statusChange ({status, oldStatus, error?: {message}}), playingChange, playbackRateChange,
// volumeChange, mutedChange (each with its old value), sourceChange ({source, oldSource}),
// sourceLoad (once a source is ready: {videoSource, duration, and empty track lists}), timeUpdate
// ({currentTime, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition}) every
// interval while the position moves, and playToEnd. A looping player starts over at its end, and
// one that is not stays there, as AVPlayer does, until replay() or a seek.
#pragma once

#include "ngn/desktop-props.h"
#include "ngn/native-module.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn {

struct VideoState {
  enum class Load { Loading, Ready, Failed };
  Load load{Load::Loading};
  std::string error;
  bool playing{false};
  // Waiting for data at a rate above zero.
  bool buffering{false};
  // Seconds; a duration not known yet is 0.
  double currentTime{0};
  double duration{0};
  double bufferedPosition{0};
};

// One player and the source it holds, if any. Destroying it stops it, and calls nothing after.
class VideoPlayback {
 public:
  enum class Change { State, Time, Ended };
  virtual ~VideoPlayback() = default;
  // Replaces the source; null leaves the player empty. `changed` on any thread for this source
  // only: State as it loads, fails, starts, stalls or stops, Time every update interval while the
  // position moves, Ended as it reaches the end.
  virtual void load(const std::optional<std::string> &uri, std::function<void(Change)> changed) = 0;
  // The current source's state; meaningless with none.
  virtual VideoState state() = 0;
  virtual void play(double rate) = 0;
  virtual void pause() = 0;
  // `done` once the position is there, on any thread.
  virtual void seek(double seconds, std::function<void()> done) = 0;
  virtual void setRate(double rate) = 0;
  virtual void setVolume(double volume) = 0;
  virtual void setMuted(bool muted) = 0;
  virtual void setPreservesPitch(bool preserves) = 0;
  // Seconds between Time changes; 0 sends none.
  virtual void setTimeUpdates(double interval) = 0;
};

class VideoOutput {
 public:
  virtual ~VideoOutput() = default;
  // A player with no source, that the view finds by `id` while it lives.
  virtual std::unique_ptr<VideoPlayback> make(int id) = 0;
};

std::shared_ptr<NativeModule> makeVideoModule(std::shared_ptr<VideoOutput> output);

// --- the view ------------------------------------------------------------------------------------

extern const char VideoViewComponentName[];

class VideoViewProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  VideoViewProps() = default;
  VideoViewProps(
      const facebook::react::PropsParserContext &context,
      const VideoViewProps &sourceProps,
      const facebook::react::RawProps &rawProps);
  // Every prop as committed, the last value of each: a `null` removes one.
  folly::dynamic values = folly::dynamic::object();
};

using VideoViewShadowNode =
    facebook::react::ConcreteViewShadowNode<VideoViewComponentName, VideoViewProps, facebook::react::ViewEventEmitter>;
using VideoViewComponentDescriptor = facebook::react::ConcreteComponentDescriptor<VideoViewShadowNode>;

// What the view shows, from expo-video's iOS props.
struct VideoViewModel {
  enum class Fit { Contain, Cover, Fill };
  // The player's id, as `player` commits it; none draws nothing.
  std::optional<int> player;
  bool nativeControls{true};
  Fit contentFit{Fit::Contain};
  // `fullscreenOptions.enable`, the full screen button.
  bool fullscreen{true};
  bool pictureInPicture{false};
  bool timecodes{true};
  bool frameAnalysis{true};
  bool operator==(const VideoViewModel &) const = default;
};

VideoViewModel videoViewModel(const folly::dynamic &values);

} // namespace ngn
