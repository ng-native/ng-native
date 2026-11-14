#include "ngn/audio.h"

#include <algorithm>
#include <cstdio>
#include <map>
#include <mutex>
#include <random>
#include <sys/stat.h>

namespace ngn {

namespace {

using Access = AudioInput::Access;

double clampTo(double value, double low, double high) {
  return std::clamp(value, low, high);
}

std::optional<std::string> stringArg(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isString() ? std::optional(args[at].asString()) : std::nullopt;
}

std::optional<double> numberArg(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isNumber() ? std::optional(args[at].asDouble()) : std::nullopt;
}

bool flagArg(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isBool() && args[at].asBool();
}

std::string randomName() {
  static std::mutex mutex;
  static std::mt19937_64 engine{std::random_device{}()};
  std::lock_guard lock(mutex);
  char out[40];
  auto a = engine();
  auto b = engine();
  std::snprintf(out, sizeof out, "%08llX-%04llX-%04llX-%04llX-%012llX", static_cast<unsigned long long>(a >> 32),
                static_cast<unsigned long long>((a >> 16) & 0xffff), static_cast<unsigned long long>(a & 0xffff),
                static_cast<unsigned long long>(b >> 48), static_cast<unsigned long long>(b & 0xffffffffffffULL));
  return out;
}

folly::dynamic permissionOf(Access access) {
  bool granted = access == Access::Granted;
  bool askable = access == Access::NotDetermined;
  return folly::dynamic::object("status", granted ? "granted" : askable ? "undetermined" : "denied")("granted", granted)(
      "canAskAgain", askable)("expires", "never");
}

struct Player {
  std::unique_ptr<AudioTrack> track;
  // Each source opened counts, so a change a replaced track sends late is dropped.
  int generation{0};
  double interval{0.5};
  double volume{1};
  bool muted{false};
  bool loop{false};
  double rate{1};
  bool finished{false};
  bool justFinished{false};
};

struct Recorder {
  RecordingSettings settings;
  std::unique_ptr<AudioRecording> recording;
  std::string path;
};

struct Shared {
  std::recursive_mutex mutex;
  std::map<std::string, Player> players;
  std::map<std::string, Recorder> recorders;
  int next{0};
  std::function<void(folly::dynamic)> send;
};

folly::dynamic statusOf(const std::string &id, Player &player) {
  TrackState state = player.track ? player.track->state() : TrackState{};
  bool loaded = player.track && state.load == TrackState::Load::Ready;
  bool failed = player.track && state.load == TrackState::Load::Failed;
  const char *playbackState = !player.track ? "idle" : failed ? "failed" : loaded ? "readyToPlay" : "loading";
  const char *timeControl = state.playing ? (state.buffering ? "waitingToPlayAtSpecifiedRate" : "playing") : "paused";
  return folly::dynamic::object("id", id)("currentTime", state.currentTime)("playbackState", playbackState)(
      "timeControlStatus", timeControl)("reasonForWaitingToPlay", "")("mute", player.muted)("duration", state.duration)(
      "playing", state.playing)("loop", player.loop)("didJustFinish", player.justFinished)("isBuffering", state.buffering)(
      "isLoaded", loaded)("playbackRate", player.rate)("shouldCorrectPitch", true)("mediaServicesDidReset", false)(
      "isLive", false)("currentOffsetFromLive", nullptr)("error", failed ? folly::dynamic(state.error) : folly::dynamic(nullptr));
}

void sendStatus(Shared &shared, const std::string &id, Player &player) {
  if (shared.send) {
    shared.send(folly::dynamic::object("type", "playbackStatusUpdate")("id", id)("status", statusOf(id, player)));
  }
}

void applyVolume(Player &player) {
  if (player.track) {
    player.track->setVolume(player.muted ? 0 : player.volume);
  }
}

void open(const std::shared_ptr<Shared> &shared, AudioOutput &output, const std::string &id, Player &player,
          const std::optional<std::string> &uri) {
  player.track.reset();
  player.finished = false;
  player.justFinished = false;
  int generation = ++player.generation;
  if (!uri) {
    return;
  }
  std::weak_ptr<Shared> weak = shared;
  player.track = output.open(*uri, player.interval, [weak, id, generation](AudioOutput::Change change) {
    auto alive = weak.lock();
    if (!alive) {
      return;
    }
    std::lock_guard lock(alive->mutex);
    auto found = alive->players.find(id);
    if (found == alive->players.end() || found->second.generation != generation || !found->second.track) {
      return;
    }
    auto &player = found->second;
    if (change == AudioOutput::Change::Ended) {
      player.justFinished = true;
      if (player.loop) {
        player.track->seek(0, [] {});
        player.track->play(player.rate);
      } else {
        // Stopped now, so the status sent says so: the OS's own pause at the end comes later.
        player.track->pause();
        player.finished = true;
      }
      sendStatus(*alive, id, player);
      return;
    }
    player.justFinished = false;
    sendStatus(*alive, id, player);
  });
  applyVolume(player);
}

std::string fileUri(const std::string &path) {
  return "file://" + path;
}

double fileSize(const std::string &path) {
  struct stat info{};
  return ::stat(path.c_str(), &info) == 0 ? static_cast<double>(info.st_size) : 0;
}

folly::dynamic recorderStatusOf(Recorder &recorder) {
  auto &recording = recorder.recording;
  folly::dynamic status = folly::dynamic::object("canRecord", recording != nullptr)("isRecording", recording && recording->recording())(
      "durationMillis", recording ? recording->currentTime() * 1000 : 0.0)("fileSize", recording ? fileSize(recorder.path) : 0.0)(
      "mediaServicesDidReset", false)("url", recording ? folly::dynamic(fileUri(recorder.path)) : folly::dynamic(nullptr));
  if (recording && recorder.settings.metering) {
    if (auto level = recording->metering()) {
      status["metering"] = *level;
    }
  }
  return status;
}

} // namespace

RecordingSettings recordingSettingsOf(const folly::dynamic &options) {
  RecordingSettings settings;
  if (!options.isObject()) {
    return settings;
  }
  auto text = [&](const char *key) {
    auto found = options.find(key);
    return found != options.items().end() && found->second.isString() ? std::optional(found->second.asString()) : std::nullopt;
  };
  auto number = [&](const char *key) {
    auto found = options.find(key);
    return found != options.items().end() && found->second.isNumber() ? std::optional(found->second.asDouble()) : std::nullopt;
  };
  if (auto extension = text("extension")) {
    settings.extension = extension->empty() || (*extension)[0] == '.' ? *extension : "." + *extension;
  }
  const std::string &ext = settings.extension;
  if (ext == ".wav" || ext == ".caf" || ext == ".aif" || ext == ".aiff") {
    settings.format = "pcm";
  }
  // expo-audio's IOSOutputFormat is the CoreAudio format's four characters, or its number.
  std::string format;
  if (auto code = text("outputFormat")) {
    format = *code;
  } else if (auto id = number("outputFormat")) {
    auto value = static_cast<uint32_t>(*id);
    format = {static_cast<char>(value >> 24), static_cast<char>((value >> 16) & 0xff), static_cast<char>((value >> 8) & 0xff),
              static_cast<char>(value & 0xff)};
  }
  while (!format.empty() && format.back() == ' ') {
    format.pop_back();
  }
  if (format == "lpcm") {
    settings.format = "pcm";
  } else if (format == "aac" || format == "aach" || format == "aacl") {
    settings.format = "aac";
  } else if (format == "alac") {
    settings.format = "alac";
  }
  if (auto rate = number("sampleRate")) {
    settings.sampleRate = *rate;
  }
  if (auto channels = number("numberOfChannels")) {
    settings.channels = static_cast<int>(*channels);
  }
  if (auto bitRate = number("bitRate")) {
    settings.bitRate = static_cast<int>(*bitRate);
  }
  if (auto quality = number("audioQuality")) {
    settings.quality = static_cast<int>(clampTo(*quality, 0, 127));
  }
  if (auto depth = number("linearPCMBitDepth")) {
    settings.bitDepth = static_cast<int>(*depth);
  }
  auto metering = options.find("isMeteringEnabled");
  settings.metering = metering != options.items().end() && metering->second.isBool() && metering->second.asBool();
  return settings;
}

std::shared_ptr<NativeModule> makeAudioModule(std::shared_ptr<AudioOutput> output, std::shared_ptr<AudioInput> input,
                                              std::string recordings, bool noPrompts) {
  struct Audio : NativeModule {
    std::shared_ptr<Shared> shared = std::make_shared<Shared>();

    Audio(std::shared_ptr<AudioOutput> output, std::shared_ptr<AudioInput> input, std::string recordings, bool noPrompts)
        : NativeModule("NgNativeAudio") {
      listeners();
      shared->send = [this](folly::dynamic body) { emit("ngNativeAudio", std::move(body)); };
      auto state = shared;
      // Each method on a player: the player, under the lock, or nothing for an id not open.
      auto withPlayer = [state](const folly::dynamic &args, auto fn) {
        auto id = stringArg(args, 0);
        std::lock_guard lock(state->mutex);
        auto found = id ? state->players.find(*id) : state->players.end();
        if (found != state->players.end()) {
          fn(found->first, found->second);
        }
      };

      sync("createPlayer", [state, output](const folly::dynamic &args) {
        std::lock_guard lock(state->mutex);
        auto id = std::to_string(++state->next);
        auto &player = state->players[id];
        if (auto ms = numberArg(args, 1); ms && *ms > 0) {
          player.interval = *ms / 1000;
        }
        open(state, *output, id, player, stringArg(args, 0));
        return folly::dynamic(id);
      });
      sync("replace", [state, output, withPlayer](const folly::dynamic &args) {
        withPlayer(args, [&](const std::string &id, Player &player) { open(state, *output, id, player, stringArg(args, 1)); });
        return folly::dynamic(nullptr);
      });
      sync("release", [state](const folly::dynamic &args) {
        auto id = stringArg(args, 0);
        std::lock_guard lock(state->mutex);
        if (id) {
          state->players.erase(*id);
        }
        return folly::dynamic(nullptr);
      });
      sync("play", [state, withPlayer](const folly::dynamic &args) {
        withPlayer(args, [&](const std::string &id, Player &player) {
          if (!player.track) {
            return;
          }
          // A player at its end starts again from the beginning, as AVPlayer would not.
          if (player.finished) {
            player.track->seek(0, [] {});
            player.finished = false;
          }
          player.justFinished = false;
          player.track->play(player.rate);
          sendStatus(*state, id, player);
        });
        return folly::dynamic(nullptr);
      });
      sync("pause", [state, withPlayer](const folly::dynamic &args) {
        withPlayer(args, [&](const std::string &id, Player &player) {
          if (player.track) {
            player.track->pause();
            sendStatus(*state, id, player);
          }
        });
        return folly::dynamic(nullptr);
      });
      promise("seekTo", [state, withPlayer](const folly::dynamic &args, JsPromise promise) {
        bool started = false;
        withPlayer(args, [&](const std::string &id, Player &player) {
          if (!player.track) {
            return;
          }
          started = true;
          player.finished = false;
          std::weak_ptr<Shared> weak = state;
          player.track->seek(std::max(0.0, numberArg(args, 1).value_or(0)), [weak, id, promise] {
            if (auto alive = weak.lock()) {
              std::lock_guard lock(alive->mutex);
              if (auto found = alive->players.find(id); found != alive->players.end()) {
                sendStatus(*alive, id, found->second);
              }
            }
            promise.resolve(nullptr);
          });
        });
        if (!started) {
          promise.resolve(nullptr);
        }
      });
      sync("setPlaybackRate", [withPlayer](const folly::dynamic &args) {
        withPlayer(args, [&](const std::string &, Player &player) {
          player.rate = clampTo(numberArg(args, 1).value_or(1), 0, 2);
          if (player.track && player.track->state().playing) {
            player.track->setRate(player.rate);
          }
        });
        return folly::dynamic(nullptr);
      });
      sync("setVolume", [withPlayer](const folly::dynamic &args) {
        withPlayer(args, [&](const std::string &, Player &player) {
          player.volume = clampTo(numberArg(args, 1).value_or(1), 0, 1);
          applyVolume(player);
        });
        return folly::dynamic(nullptr);
      });
      sync("setMuted", [withPlayer](const folly::dynamic &args) {
        withPlayer(args, [&](const std::string &, Player &player) {
          player.muted = flagArg(args, 1);
          applyVolume(player);
        });
        return folly::dynamic(nullptr);
      });
      sync("setLoop", [withPlayer](const folly::dynamic &args) {
        withPlayer(args, [&](const std::string &, Player &player) { player.loop = flagArg(args, 1); });
        return folly::dynamic(nullptr);
      });
      sync("status", [withPlayer](const folly::dynamic &args) {
        folly::dynamic out = nullptr;
        withPlayer(args, [&](const std::string &id, Player &player) { out = statusOf(id, player); });
        return out;
      });

      promise("getRecordingPermissionsAsync", [input](const folly::dynamic &, JsPromise promise) {
        promise.resolve(permissionOf(input->access()));
      });
      promise("requestRecordingPermissionsAsync", [input, noPrompts](const folly::dynamic &, JsPromise promise) {
        auto access = input->access();
        if (noPrompts || access != Access::NotDetermined) {
          promise.resolve(permissionOf(access));
          return;
        }
        input->requestAccess([promise](Access decided) { promise.resolve(permissionOf(decided)); });
      });
      // macOS has no audio session: no category, no silent switch, nothing to activate.
      promise("setAudioModeAsync", [](const folly::dynamic &, JsPromise promise) { promise.resolve(nullptr); });
      promise("setIsAudioActiveAsync", [](const folly::dynamic &, JsPromise promise) { promise.resolve(nullptr); });

      auto withRecorder = [state](const folly::dynamic &args, auto fn) {
        auto id = stringArg(args, 0);
        std::lock_guard lock(state->mutex);
        auto found = id ? state->recorders.find(*id) : state->recorders.end();
        if (found != state->recorders.end()) {
          fn(found->first, found->second);
        }
      };
      sync("createRecorder", [state](const folly::dynamic &args) {
        std::lock_guard lock(state->mutex);
        auto id = std::to_string(++state->next);
        state->recorders[id].settings = recordingSettingsOf(args.empty() ? folly::dynamic(nullptr) : args[0]);
        return folly::dynamic(id);
      });
      promise("prepareToRecordAsync", [withRecorder, input, recordings](const folly::dynamic &args, JsPromise promise) {
        std::optional<std::string> failure = "AudioRecorder.prepareToRecordAsync: this recorder was released";
        withRecorder(args, [&](const std::string &, Recorder &recorder) {
          if (input->access() != Access::Granted) {
            failure = "AudioRecorder.prepareToRecordAsync: recording permission has not been granted";
            return;
          }
          if (!input->hasMicrophone()) {
            failure = "AudioRecorder.prepareToRecordAsync: this Mac has no microphone";
            return;
          }
          if (args.size() > 1 && args[1].isObject()) {
            // The prepare's own options over expo-audio's defaults, as on iOS: not over the recorder's.
            recorder.settings = recordingSettingsOf(args[1]);
          }
          recorder.recording.reset();
          auto path = recordings + "/recording-" + randomName() + recorder.settings.extension;
          std::string error;
          recorder.recording = input->prepare(path, recorder.settings, error);
          if (!recorder.recording) {
            failure = "AudioRecorder.prepareToRecordAsync: " + (error.empty() ? std::string("the recorder did not start") : error);
            return;
          }
          recorder.path = path;
          failure.reset();
        });
        if (failure) {
          promise.reject(*failure);
        } else {
          promise.resolve(nullptr);
        }
      });
      sync("record", [withRecorder](const folly::dynamic &args) {
        withRecorder(args, [](const std::string &, Recorder &recorder) {
          if (recorder.recording) {
            recorder.recording->record();
          }
        });
        return folly::dynamic(nullptr);
      });
      sync("pauseRecording", [withRecorder](const folly::dynamic &args) {
        withRecorder(args, [](const std::string &, Recorder &recorder) {
          if (recorder.recording) {
            recorder.recording->pause();
          }
        });
        return folly::dynamic(nullptr);
      });
      promise("stopRecording", [state, withRecorder](const folly::dynamic &args, JsPromise promise) {
        withRecorder(args, [&](const std::string &id, Recorder &recorder) {
          if (!recorder.recording) {
            return;
          }
          recorder.recording->stop();
          if (state->send) {
            state->send(folly::dynamic::object("type", "recordingStatusUpdate")("id", id)(
                "status", folly::dynamic::object("id", id)("isFinished", true)("hasError", false)("error", nullptr)(
                              "url", fileUri(recorder.path))));
          }
        });
        promise.resolve(nullptr);
      });
      sync("recorderStatus", [withRecorder](const folly::dynamic &args) {
        folly::dynamic out = nullptr;
        withRecorder(args, [&](const std::string &, Recorder &recorder) { out = recorderStatusOf(recorder); });
        return out;
      });
      sync("releaseRecorder", [state](const folly::dynamic &args) {
        auto id = stringArg(args, 0);
        std::lock_guard lock(state->mutex);
        if (id) {
          state->recorders.erase(*id);
        }
        return folly::dynamic(nullptr);
      });
    }

    ~Audio() override {
      std::lock_guard lock(shared->mutex);
      shared->send = nullptr;
      shared->players.clear();
      shared->recorders.clear();
    }
  };
  return std::make_shared<Audio>(std::move(output), std::move(input), std::move(recordings), noPrompts);
}

} // namespace ngn
