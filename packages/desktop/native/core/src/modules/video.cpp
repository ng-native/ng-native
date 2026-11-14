#include "ngn/video.h"

#include "ngn/desktop-view-props.h"

#include <react/renderer/core/propsConversions.h>

#include <algorithm>
#include <map>
#include <mutex>

using namespace facebook::react;
using folly::dynamic;

namespace ngn {

const char VideoViewComponentName[] = "ViewManagerAdapter_ExpoVideo_VideoView";

VideoViewProps::VideoViewProps(const PropsParserContext &context, const VideoViewProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      values(sourceProps.values) {
  auto raw = rawProps.toDynamic();
  if (!raw.isObject()) {
    return;
  }
  for (const auto &[key, value] : raw.items()) {
    if (value.isNull()) {
      values.erase(key);
    } else {
      values[key] = value;
    }
  }
}

VideoViewModel videoViewModel(const dynamic &values) {
  VideoViewModel model;
  if (!values.isObject()) {
    return model;
  }
  auto flag = [&](const char *key, bool fallback) {
    auto found = values.find(key);
    return found != values.items().end() && found->second.isBool() ? found->second.asBool() : fallback;
  };
  if (auto player = values.find("player"); player != values.items().end() && player->second.isNumber()) {
    model.player = static_cast<int>(player->second.asDouble());
  }
  model.nativeControls = flag("nativeControls", true);
  if (auto fit = values.find("contentFit"); fit != values.items().end() && fit->second.isString()) {
    const auto &name = fit->second.getString();
    model.contentFit = name == "cover" ? VideoViewModel::Fit::Cover : name == "fill" ? VideoViewModel::Fit::Fill : VideoViewModel::Fit::Contain;
  }
  if (auto options = values.find("fullscreenOptions"); options != values.items().end() && options->second.isObject()) {
    auto enable = options->second.find("enable");
    model.fullscreen = enable == options->second.items().end() || !enable->second.isBool() || enable->second.asBool();
  }
  model.pictureInPicture = flag("allowsPictureInPicture", false);
  model.timecodes = flag("showsTimecodes", true);
  model.frameAnalysis = flag("allowsVideoFrameAnalysis", true);
  return model;
}

namespace {

using Change = VideoPlayback::Change;

std::optional<std::string> stringArg(const dynamic &args, size_t at) {
  return args.size() > at && args[at].isString() ? std::optional(args[at].asString()) : std::nullopt;
}

std::optional<double> numberArg(const dynamic &args, size_t at) {
  return args.size() > at && args[at].isNumber() ? std::optional(args[at].asDouble()) : std::nullopt;
}

bool flagArg(const dynamic &args, size_t at) {
  return args.size() > at && args[at].isBool() && args[at].asBool();
}

struct Player {
  std::unique_ptr<VideoPlayback> playback;
  std::optional<std::string> source;
  // Each source loaded counts, so a change a replaced source sends late is dropped.
  int generation{0};
  std::string status{"idle"};
  bool playing{false};
  // Whether sourceLoad went out for this source.
  bool loaded{false};
  double volume{1};
  bool muted{false};
  double rate{1};
  bool loop{false};
  bool preservesPitch{true};
  double interval{0};
};

struct Shared {
  std::recursive_mutex mutex;
  std::map<int, Player> players;
  int next{0};
  std::function<void(dynamic)> send;
};

void send(Shared &shared, int id, const char *type, dynamic payload) {
  if (shared.send) {
    shared.send(dynamic::object("type", type)("id", id)("payload", std::move(payload)));
  }
}

dynamic sourceOf(const std::optional<std::string> &uri) {
  return uri ? dynamic::object("uri", *uri) : dynamic(nullptr);
}

// expo-video's status, as its iOS observer reads AVPlayer: a source still loading or waiting for
// data is loading.
std::string statusOf(Player &player, const VideoState &state) {
  if (!player.source) {
    return "idle";
  }
  switch (state.load) {
    case VideoState::Load::Failed: return "error";
    case VideoState::Load::Loading: return "loading";
    case VideoState::Load::Ready: return state.buffering ? "loading" : "readyToPlay";
  }
  return "loading";
}

// Sends what changed since the last look: the status, the source's load, and whether it plays.
void refresh(Shared &shared, int id, Player &player) {
  VideoState state = player.source ? player.playback->state() : VideoState{};
  auto status = statusOf(player, state);
  if (status != player.status) {
    dynamic payload = dynamic::object("status", status)("oldStatus", player.status);
    if (status == "error") {
      payload["error"] = dynamic::object("message", state.error);
    }
    player.status = status;
    send(shared, id, "statusChange", std::move(payload));
  }
  if (status == "readyToPlay" && !player.loaded) {
    player.loaded = true;
    send(shared, id, "sourceLoad",
         dynamic::object("videoSource", sourceOf(player.source))("duration", state.duration)("availableVideoTracks", dynamic::array())(
             "availableSubtitleTracks", dynamic::array())("availableAudioTracks", dynamic::array()));
  }
  if (state.playing != player.playing) {
    player.playing = state.playing;
    send(shared, id, "playingChange", dynamic::object("isPlaying", state.playing)("oldIsPlaying", !state.playing));
  }
}

void changed(Shared &shared, int id, Player &player, Change change) {
  switch (change) {
    case Change::State: refresh(shared, id, player); return;
    case Change::Time:
      if (player.interval > 0) {
        auto state = player.playback->state();
        send(shared, id, "timeUpdate",
             dynamic::object("currentTime", state.currentTime)("currentLiveTimestamp", nullptr)("currentOffsetFromLive", nullptr)(
                 "bufferedPosition", state.bufferedPosition));
      }
      return;
    case Change::Ended:
      send(shared, id, "playToEnd", dynamic::object());
      if (player.loop) {
        player.playback->seek(0, [] {});
        player.playback->play(player.rate);
      }
      return;
  }
}

void load(const std::shared_ptr<Shared> &shared, int id, Player &player, const std::optional<std::string> &uri) {
  auto old = player.source;
  player.source = uri;
  player.loaded = false;
  int generation = ++player.generation;
  std::weak_ptr<Shared> weak = shared;
  player.playback->load(uri, [weak, id, generation](Change change) {
    auto alive = weak.lock();
    if (!alive) {
      return;
    }
    std::lock_guard lock(alive->mutex);
    auto found = alive->players.find(id);
    if (found != alive->players.end() && found->second.generation == generation) {
      changed(*alive, id, found->second, change);
    }
  });
  player.playback->setVolume(player.volume);
  player.playback->setMuted(player.muted);
  player.playback->setRate(player.rate);
  player.playback->setPreservesPitch(player.preservesPitch);
  player.playback->setTimeUpdates(player.interval);
  if (old || uri) {
    send(*shared, id, "sourceChange", dynamic::object("source", sourceOf(uri))("oldSource", sourceOf(old)));
  }
  refresh(*shared, id, player);
}

dynamic stateOf(Player &player) {
  VideoState state = player.source ? player.playback->state() : VideoState{};
  return dynamic::object("status", statusOf(player, state))("playing", state.playing)("currentTime", state.currentTime)(
      "duration", state.duration)("bufferedPosition", state.bufferedPosition)("playbackRate", player.rate)("volume", player.volume)(
      "muted", player.muted)("loop", player.loop)("preservesPitch", player.preservesPitch)("timeUpdateEventInterval", player.interval);
}

} // namespace

std::shared_ptr<NativeModule> makeVideoModule(std::shared_ptr<VideoOutput> output) {
  struct Video : NativeModule {
    std::shared_ptr<Shared> shared = std::make_shared<Shared>();

    explicit Video(std::shared_ptr<VideoOutput> output) : NativeModule("NgNativeVideo") {
      listeners();
      shared->send = [this](dynamic body) { emit("ngNativeVideo", std::move(body)); };
      auto state = shared;
      // Each method on a player: the player, under the lock, or nothing for an id not held.
      auto with = [state](const dynamic &args, auto fn) {
        if (args.empty() || !args[0].isNumber()) {
          return;
        }
        int id = static_cast<int>(args[0].asDouble());
        std::lock_guard lock(state->mutex);
        if (auto found = state->players.find(id); found != state->players.end()) {
          fn(id, found->second);
        }
      };
      // A setter's change event, sent only when the value changes, as expo-video's didSet does.
      auto changeOf = [state](int id, const char *type, const char *key, const char *oldKey, auto before, auto after) {
        if (before != after) {
          send(*state, id, type, dynamic::object(key, after)(oldKey, before));
        }
      };

      sync("createPlayer", [state, output](const dynamic &args) {
        std::lock_guard lock(state->mutex);
        int id = ++state->next;
        auto &player = state->players[id];
        player.playback = output->make(id);
        load(state, id, player, stringArg(args, 0));
        return dynamic(id);
      });
      sync("replace", [state, with](const dynamic &args) {
        with(args, [&](int id, Player &player) { load(state, id, player, stringArg(args, 1)); });
        return dynamic(nullptr);
      });
      sync("release", [state](const dynamic &args) {
        if (!args.empty() && args[0].isNumber()) {
          std::lock_guard lock(state->mutex);
          state->players.erase(static_cast<int>(args[0].asDouble()));
        }
        return dynamic(nullptr);
      });
      sync("play", [with](const dynamic &args) {
        with(args, [](int, Player &player) { player.playback->play(player.rate); });
        return dynamic(nullptr);
      });
      sync("pause", [with](const dynamic &args) {
        with(args, [](int, Player &player) { player.playback->pause(); });
        return dynamic(nullptr);
      });
      sync("replay", [with](const dynamic &args) {
        with(args, [](int, Player &player) {
          player.playback->seek(0, [] {});
          player.playback->play(player.rate);
        });
        return dynamic(nullptr);
      });
      sync("seekBy", [with](const dynamic &args) {
        with(args, [&](int, Player &player) {
          auto to = player.playback->state().currentTime + numberArg(args, 1).value_or(0);
          player.playback->seek(std::max(0.0, to), [] {});
        });
        return dynamic(nullptr);
      });
      sync("setCurrentTime", [with](const dynamic &args) {
        with(args, [&](int, Player &player) { player.playback->seek(std::max(0.0, numberArg(args, 1).value_or(0)), [] {}); });
        return dynamic(nullptr);
      });
      sync("setPlaybackRate", [with, changeOf](const dynamic &args) {
        with(args, [&](int id, Player &player) {
          auto before = player.rate;
          player.rate = std::clamp(numberArg(args, 1).value_or(1), 0.0, 16.0);
          player.playback->setRate(player.rate);
          changeOf(id, "playbackRateChange", "playbackRate", "oldPlaybackRate", before, player.rate);
        });
        return dynamic(nullptr);
      });
      sync("setVolume", [with, changeOf](const dynamic &args) {
        with(args, [&](int id, Player &player) {
          auto before = player.volume;
          player.volume = std::clamp(numberArg(args, 1).value_or(1), 0.0, 1.0);
          player.playback->setVolume(player.volume);
          changeOf(id, "volumeChange", "volume", "oldVolume", before, player.volume);
        });
        return dynamic(nullptr);
      });
      sync("setMuted", [with, changeOf](const dynamic &args) {
        with(args, [&](int id, Player &player) {
          auto before = player.muted;
          player.muted = flagArg(args, 1);
          player.playback->setMuted(player.muted);
          changeOf(id, "mutedChange", "muted", "oldMuted", before, player.muted);
        });
        return dynamic(nullptr);
      });
      sync("setLoop", [with](const dynamic &args) {
        with(args, [&](int, Player &player) { player.loop = flagArg(args, 1); });
        return dynamic(nullptr);
      });
      sync("setPreservesPitch", [with](const dynamic &args) {
        with(args, [&](int, Player &player) {
          player.preservesPitch = flagArg(args, 1);
          player.playback->setPreservesPitch(player.preservesPitch);
        });
        return dynamic(nullptr);
      });
      sync("setTimeUpdateEventInterval", [with](const dynamic &args) {
        with(args, [&](int, Player &player) {
          player.interval = std::max(0.0, numberArg(args, 1).value_or(0));
          player.playback->setTimeUpdates(player.interval);
        });
        return dynamic(nullptr);
      });
      sync("state", [with](const dynamic &args) {
        dynamic out = nullptr;
        with(args, [&](int, Player &player) { out = stateOf(player); });
        return out;
      });
    }

    ~Video() override {
      std::lock_guard lock(shared->mutex);
      shared->send = nullptr;
      shared->players.clear();
    }
  };
  return std::make_shared<Video>(std::move(output));
}

} // namespace ngn
