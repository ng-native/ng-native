#include "ngn/language-model.h"

#include <folly/json.h>

#include <map>
#include <mutex>

namespace ngn {

namespace {

using Outcome = LanguageModelEngine::Outcome;

// One turn's text so far, and whether the app cancelled it.
struct Turn {
  std::string soFar;
  bool cancelled{false};
};

struct Entry {
  std::unique_ptr<LanguageModelEngine::Session> session;
  std::shared_ptr<Turn> running;
  folly::dynamic requestId = nullptr;
};

struct Shared {
  std::recursive_mutex mutex;
  std::map<std::string, Entry> sessions;
  int next{0};
  std::function<void(folly::dynamic)> send;
};

std::optional<std::string> stringArg(const folly::dynamic &args, size_t at) {
  return args.size() > at && args[at].isString() ? std::optional(args[at].asString()) : std::nullopt;
}

folly::dynamic jsonOrEmpty(const std::string &text) {
  try {
    return folly::parseJson(text);
  } catch (const std::exception &) {
    return folly::dynamic::object();
  }
}

} // namespace

std::shared_ptr<NativeModule> makeLocalLlmModule(std::shared_ptr<LanguageModelEngine> engine) {
  struct LocalLlm : NativeModule {
    std::shared_ptr<Shared> shared = std::make_shared<Shared>();

    explicit LocalLlm(std::shared_ptr<LanguageModelEngine> engine) : NativeModule("NgNativeLocalLlm") {
      listeners();
      shared->send = [this](folly::dynamic body) { emit("ngNativeLocalLlm", std::move(body)); };
      auto state = shared;

      sync("getAvailability", [engine](const folly::dynamic &) { return folly::dynamic(engine->availability()); });
      // macOS fetches and updates the model itself.
      promise("downloadModel", [](const folly::dynamic &, JsPromise promise) { promise.resolve(nullptr); });

      sync("createSession", [state, engine](const folly::dynamic &args) {
        auto config = args.empty() || !args[0].isObject() ? folly::dynamic::object() : args[0];
        std::lock_guard lock(state->mutex);
        auto id = std::to_string(++state->next);
        std::weak_ptr<Shared> weak = state;
        std::string error;
        auto session = engine->session(folly::toJson(config), [weak, id](LanguageModelEngine::ToolCall call) {
          auto alive = weak.lock();
          if (!alive) {
            return;
          }
          std::lock_guard lock(alive->mutex);
          auto found = alive->sessions.find(id);
          if (found == alive->sessions.end() || !alive->send) {
            return;
          }
          alive->send(folly::dynamic::object("type", "toolCall")("session", id)("requestId", found->second.requestId)(
              "callId", call.id)("toolName", call.tool)("arguments", jsonOrEmpty(call.arguments)));
        }, error);
        if (!session) {
          throw std::runtime_error(error.empty() ? "LanguageModel: the model refused the session's config" : error);
        }
        state->sessions[id].session = std::move(session);
        return folly::dynamic(id);
      });

      auto turn = [state, engine](const folly::dynamic &args, bool stream, JsPromise promise) {
        auto id = stringArg(args, 0);
        auto prompt = stringArg(args, 1).value_or("");
        std::lock_guard lock(state->mutex);
        auto found = id ? state->sessions.find(*id) : state->sessions.end();
        if (found == state->sessions.end()) {
          promise.reject("ERR_SESSION_RELEASED: This language model session has been released");
          return;
        }
        if (auto availability = engine->availability(); availability != "available") {
          promise.reject("ERR_MODEL_UNAVAILABLE: The on-device language model is unavailable: " + availability);
          return;
        }
        auto &entry = found->second;
        if (entry.running) {
          promise.reject("ERR_SESSION_BUSY: The session is still answering its last prompt");
          return;
        }
        auto running = std::make_shared<Turn>();
        entry.running = running;
        entry.requestId = args.size() > 2 && args[2].isString() ? args[2] : folly::dynamic(nullptr);
        std::weak_ptr<Shared> weak = state;
        auto requestId = entry.requestId;
        auto session = *id;
        entry.session->respond(
            prompt, stream,
            [weak, running, session, requestId](const std::string &text) {
              auto alive = weak.lock();
              if (!alive) {
                return;
              }
              std::lock_guard lock(alive->mutex);
              running->soFar = text;
              if (alive->send) {
                alive->send(folly::dynamic::object("type", "token")("session", session)("requestId", requestId)("accumulated", text));
              }
            },
            [weak, running, session, promise](Outcome outcome) {
              auto alive = weak.lock();
              // Without the module there is no cancel left to race with.
              std::unique_lock<std::recursive_mutex> lock;
              if (alive) {
                lock = std::unique_lock(alive->mutex);
                auto found = alive->sessions.find(session);
                if (found != alive->sessions.end() && found->second.running == running) {
                  found->second.running.reset();
                }
              }
              auto soFar = running->soFar;
              bool cancelled = running->cancelled;
              if (lock.owns_lock()) {
                lock.unlock();
              }
              if (outcome.text) {
                promise.resolve(*outcome.text);
              } else if (cancelled || outcome.code == "ERR_CANCELLED") {
                promise.resolve(soFar);
              } else {
                promise.reject(outcome.code + ": " + outcome.message);
              }
            });
      };
      promise("respond", [turn](const folly::dynamic &args, JsPromise promise) { turn(args, false, std::move(promise)); });
      promise("streamResponse", [turn](const folly::dynamic &args, JsPromise promise) { turn(args, true, std::move(promise)); });

      promise("cancelStream", [state](const folly::dynamic &args, JsPromise promise) {
        auto id = stringArg(args, 0);
        {
          std::lock_guard lock(state->mutex);
          auto found = id ? state->sessions.find(*id) : state->sessions.end();
          if (found != state->sessions.end() && found->second.running) {
            found->second.running->cancelled = true;
            found->second.session->cancel();
          }
        }
        promise.resolve(nullptr);
      });
      auto answer = [state](const folly::dynamic &args, bool resolved) {
        auto id = stringArg(args, 0);
        auto callId = stringArg(args, 1);
        auto text = stringArg(args, 2).value_or("");
        std::lock_guard lock(state->mutex);
        auto found = id ? state->sessions.find(*id) : state->sessions.end();
        if (found != state->sessions.end() && callId) {
          found->second.session->answerTool(*callId, resolved ? std::optional(text) : std::nullopt, text);
        }
        return folly::dynamic(nullptr);
      };
      sync("resolveToolCall", [answer](const folly::dynamic &args) { return answer(args, true); });
      sync("rejectToolCall", [answer](const folly::dynamic &args) { return answer(args, false); });
      sync("release", [state](const folly::dynamic &args) {
        auto id = stringArg(args, 0);
        std::lock_guard lock(state->mutex);
        if (id) {
          state->sessions.erase(*id);
        }
        return folly::dynamic(nullptr);
      });
    }

    ~LocalLlm() override {
      std::lock_guard lock(shared->mutex);
      shared->send = nullptr;
      shared->sessions.clear();
    }
  };
  return std::make_shared<LocalLlm>(std::move(engine));
}

} // namespace ngn
