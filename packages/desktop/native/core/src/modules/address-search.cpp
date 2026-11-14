#include "ngn/address-search.h"

#include <array>
#include <map>
#include <mutex>
#include <sstream>
#include <utility>

namespace ngn {

namespace {

// One `suggest()` in JavaScript: its completer, the promise for its latest query, and the
// completions of its latest answer, which ids name by the answer's generation.
struct Session {
  std::unique_ptr<AddressCompleter> completer;
  std::optional<JsPromise> pending;
  std::optional<std::string> pendingQuery;
  int generation{0};
  std::vector<AddressCompletion> answered;
};

struct State {
  std::mutex mutex;
  std::map<int, Session> sessions;
  std::function<void(folly::dynamic)> send;
};

folly::dynamic addressOf(const PostalAddressParts &parts) {
  folly::dynamic address = folly::dynamic::object("line1", parts.line1)("town", parts.town)("postcode", parts.postcode)(
      "country", parts.country)("countryCode", parts.countryCode)(
      "coordinates", folly::dynamic::object("latitude", parts.latitude)("longitude", parts.longitude));
  if (parts.locality) {
    address["locality"] = *parts.locality;
  }
  if (parts.region) {
    address["region"] = *parts.region;
  }
  return address;
}

// The session, generation and index an id names, or nothing for one malformed.
std::optional<std::array<int, 3>> partsOf(const std::string &id) {
  std::array<int, 3> parts{};
  std::istringstream in(id);
  char first = 0, second = 0;
  if (!(in >> parts[0] >> first >> parts[1] >> second >> parts[2]) || first != ':' || second != ':' || !in.eof()) {
    return std::nullopt;
  }
  return parts;
}

// Settles `session`'s query with `completions` when they are for it: the pending promise, or an
// event for a later report. Called with the state's lock held; answers what to call after it.
std::function<void()> answer(State &state, int id, Session &session, const std::string &query, std::vector<AddressCompletion> completions) {
  if (session.pendingQuery != query) {
    return nullptr;
  }
  session.generation++;
  folly::dynamic suggestions = folly::dynamic::array();
  for (size_t i = 0; i < completions.size(); i++) {
    suggestions.push_back(folly::dynamic::object(
        "id", std::to_string(id) + ":" + std::to_string(session.generation) + ":" + std::to_string(i))(
        "title", completions[i].title)("subtitle", completions[i].subtitle));
  }
  session.answered = std::move(completions);
  if (auto pending = std::exchange(session.pending, std::nullopt)) {
    return [pending, suggestions] { pending->resolve(suggestions); };
  }
  auto send = state.send;
  return [send, id, query, suggestions] {
    if (send) {
      send(folly::dynamic::object("session", id)("query", query)("suggestions", suggestions));
    }
  };
}

} // namespace

std::shared_ptr<NativeModule> makeAddressSearchModule(std::shared_ptr<AddressLookup> lookup) {
  struct AddressSearch : NativeModule {
    std::shared_ptr<State> state = std::make_shared<State>();

    explicit AddressSearch(std::shared_ptr<AddressLookup> lookup) : NativeModule("NgNativeAddressSearch") {
      listeners();
      state->send = [this](folly::dynamic body) { emit("ngNativeAddressSearch", std::move(body)); };
      std::weak_ptr<State> weak = state;
      auto state = this->state;

      promise("complete", [state, weak, lookup](const folly::dynamic &args, JsPromise promise) {
        if (args.size() < 2 || !args[0].isNumber() || !args[1].isString()) {
          promise.reject("AddressSearch.complete: takes a session number and a query");
          return;
        }
        int id = static_cast<int>(args[0].asDouble());
        auto query = args[1].asString();
        const auto options = args.size() > 2 && args[2].isObject() ? args[2] : folly::dynamic::object();
        auto region = options.getDefault("region", "");
        auto pointsOfInterest = options.getDefault("pointsOfInterest", false);
        std::optional<JsPromise> before;
        AddressCompleter *completer = nullptr;
        {
          std::lock_guard lock(state->mutex);
          auto &session = state->sessions[id];
          if (!session.completer) {
            auto settle = [weak, id](const std::string &query, auto act) {
              auto state = weak.lock();
              if (!state) {
                return;
              }
              std::function<void()> after;
              {
                std::lock_guard lock(state->mutex);
                auto found = state->sessions.find(id);
                if (found != state->sessions.end()) {
                  after = act(*state, found->second);
                }
              }
              if (after) {
                after();
              }
            };
            session.completer = lookup->makeCompleter({
                .results =
                    [settle, id](const std::string &query, std::vector<AddressCompletion> completions) {
                      settle(query, [&](State &state, Session &session) {
                        return answer(state, id, session, query, std::move(completions));
                      });
                    },
                .failed =
                    [settle](const std::string &query, const std::string &reason) {
                      settle(query, [&](State &, Session &session) -> std::function<void()> {
                        if (session.pendingQuery != query) {
                          return nullptr;
                        }
                        auto pending = std::exchange(session.pending, std::nullopt);
                        return pending ? std::function<void()>([pending, reason] { pending->reject(reason); }) : nullptr;
                      });
                    },
            });
          }
          // A newer query settles the one before: JavaScript keeps only the latest answer.
          before = std::exchange(session.pending, promise);
          session.pendingQuery = query;
          completer = session.completer.get();
        }
        if (before) {
          before->resolve(folly::dynamic::array());
        }
        completer->complete(query, region.isString() ? region.asString() : "", pointsOfInterest.isBool() && pointsOfInterest.asBool());
      });

      promise("resolve", [state, lookup](const folly::dynamic &args, JsPromise promise) {
        auto parts = !args.empty() && args[0].isString() ? partsOf(args[0].asString()) : std::nullopt;
        std::shared_ptr<void> completion;
        if (parts) {
          std::lock_guard lock(state->mutex);
          auto found = state->sessions.find((*parts)[0]);
          if (found != state->sessions.end() && found->second.generation == (*parts)[1] && (*parts)[2] >= 0 &&
              static_cast<size_t>((*parts)[2]) < found->second.answered.size()) {
            completion = found->second.answered[static_cast<size_t>((*parts)[2])].handle;
          }
        }
        if (!completion) {
          promise.resolve(nullptr);
          return;
        }
        lookup->lookup(completion, [promise](std::optional<PostalAddressParts> address, std::string error) {
          if (address) {
            promise.resolve(addressOf(*address));
          } else if (!error.empty()) {
            promise.reject(error);
          } else {
            promise.resolve(nullptr);
          }
        });
      });

      sync("end", [state](const folly::dynamic &args) {
        if (args.empty() || !args[0].isNumber()) {
          return folly::dynamic(nullptr);
        }
        Session ended;
        {
          std::lock_guard lock(state->mutex);
          auto found = state->sessions.find(static_cast<int>(args[0].asDouble()));
          if (found == state->sessions.end()) {
            return folly::dynamic(nullptr);
          }
          ended = std::move(found->second);
          state->sessions.erase(found);
        }
        ended.completer->cancel();
        if (ended.pending) {
          ended.pending->resolve(folly::dynamic::array());
        }
        return folly::dynamic(nullptr);
      });
    }

    ~AddressSearch() override {
      std::map<int, Session> left;
      {
        std::lock_guard lock(state->mutex);
        state->send = nullptr;
        left.swap(state->sessions);
      }
      for (auto &[id, session] : left) {
        session.completer->cancel();
      }
    }
  };
  return std::make_shared<AddressSearch>(std::move(lookup));
}

} // namespace ngn
