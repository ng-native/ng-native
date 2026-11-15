// @react-native-async-storage's native modules over the core's KeyValueStore, so the package runs
// unchanged: RNCAsyncStorage (2.x, callbacks) and RNAsyncStorage (3.x, promises and named
// databases, with its legacy_ calls on 2.x's database).
#include "ngn/core-modules.h"
#include "ngn/key-value-store.h"


namespace ngn {

namespace {

std::vector<std::string> strings(const folly::dynamic &array) {
  std::vector<std::string> out;
  if (array.isArray()) {
    for (const auto &v : array) {
      if (v.isString()) {
        out.push_back(v.asString());
      }
    }
  }
  return out;
}

std::vector<std::pair<std::string, std::string>> pairs(const folly::dynamic &array) {
  std::vector<std::pair<std::string, std::string>> out;
  if (array.isArray()) {
    for (const auto &p : array) {
      if (p.isArray() && p.size() >= 2 && p[0].isString() && p[1].isString()) {
        out.emplace_back(p[0].asString(), p[1].asString());
      }
    }
  }
  return out;
}

folly::dynamic error(const std::string &message) {
  return folly::dynamic::array(folly::dynamic::object("message", message));
}

const folly::dynamic &arg(const folly::dynamic &args, size_t i) {
  static const folly::dynamic none = nullptr;
  return args.size() > i ? args[i] : none;
}

} // namespace

std::shared_ptr<NativeModule> makeLegacyAsyncStorage(const CoreModuleServices &s) {
  struct Legacy : NativeModule {
    explicit Legacy(const CoreModuleServices &s) : NativeModule("RNCAsyncStorage"), store(s.storage) {
      constexpr const char *db = KeyValueStore::kLegacy;
      auto reply = [](std::vector<JsCallback> &callbacks, bool ok) {
        if (!callbacks.empty() && callbacks[0]) {
          callbacks[0](ok ? folly::dynamic::array() : folly::dynamic::array(error("Could not write the storage file.")));
        }
      };
      async("multiGet", [this](const folly::dynamic &args, std::vector<JsCallback> callbacks) {
        auto keys = strings(arg(args, 0));
        auto values = store->get(db, keys);
        folly::dynamic result = folly::dynamic::array();
        for (size_t i = 0; i < keys.size(); i++) {
          result.push_back(folly::dynamic::array(keys[i], values[i] ? folly::dynamic(*values[i]) : folly::dynamic(nullptr)));
        }
        if (!callbacks.empty() && callbacks[0]) {
          callbacks[0](folly::dynamic::array(nullptr, result));
        }
      });
      async("multiSet", [this, reply](const folly::dynamic &args, std::vector<JsCallback> callbacks) {
        std::vector<std::pair<std::string, std::optional<std::string>>> values;
        for (auto &[k, v] : pairs(arg(args, 0))) {
          values.emplace_back(k, v);
        }
        reply(callbacks, store->set(db, values));
      });
      async("multiMerge", [this, reply](const folly::dynamic &args, std::vector<JsCallback> callbacks) {
        reply(callbacks, store->merge(db, pairs(arg(args, 0))));
      });
      async("multiRemove", [this, reply](const folly::dynamic &args, std::vector<JsCallback> callbacks) {
        reply(callbacks, store->remove(db, strings(arg(args, 0))));
      });
      async("getAllKeys", [this](const folly::dynamic &, std::vector<JsCallback> callbacks) {
        folly::dynamic keys = folly::dynamic::array();
        for (auto &k : store->keys(db)) {
          keys.push_back(k);
        }
        if (!callbacks.empty() && callbacks[0]) {
          callbacks[0](folly::dynamic::array(nullptr, keys));
        }
      });
      async("clear", [this, reply](const folly::dynamic &, std::vector<JsCallback> callbacks) {
        reply(callbacks, store->clear(db));
      });
    }
    std::shared_ptr<KeyValueStore> store;
  };
  return std::make_shared<Legacy>(s);
}

std::shared_ptr<NativeModule> makeAsyncStorage(const CoreModuleServices &s) {
  struct Storage : NativeModule {
    explicit Storage(const CoreModuleServices &s) : NativeModule("RNAsyncStorage"), store(s.storage) {
      auto done = [](JsPromise &p, bool ok, folly::dynamic value = nullptr) {
        if (ok) {
          p.resolve(std::move(value));
        } else {
          p.reject("Could not write the storage file.");
        }
      };
      auto entries = [](const std::vector<std::string> &keys, const std::vector<std::optional<std::string>> &values) {
        folly::dynamic out = folly::dynamic::array();
        for (size_t i = 0; i < keys.size(); i++) {
          out.push_back(folly::dynamic::object("key", keys[i])(
              "value", values[i] ? folly::dynamic(*values[i]) : folly::dynamic(nullptr)));
        }
        return out;
      };
      auto dbName = [](const folly::dynamic &args) {
        return arg(args, 0).isString() ? arg(args, 0).asString() : std::string(KeyValueStore::kLegacy);
      };
      promise("getValues", [this, entries, dbName](const folly::dynamic &args, JsPromise p) {
        auto keys = strings(arg(args, 1));
        p.resolve(entries(keys, store->get(dbName(args), keys)));
      });
      promise("setValues", [this, done, dbName](const folly::dynamic &args, JsPromise p) {
        std::vector<std::pair<std::string, std::optional<std::string>>> values;
        folly::dynamic echo = folly::dynamic::array();
        if (arg(args, 1).isArray()) {
          for (const auto &e : arg(args, 1)) {
            if (e.isObject() && e.count("key") && e["key"].isString()) {
              auto v = e.getDefault("value", nullptr);
              values.emplace_back(e["key"].asString(), v.isString() ? std::optional(v.asString()) : std::nullopt);
              echo.push_back(folly::dynamic::object("key", e["key"])("value", v.isString() ? v : nullptr));
            }
          }
        }
        done(p, store->set(dbName(args), values), echo);
      });
      promise("removeValues", [this, done, dbName](const folly::dynamic &args, JsPromise p) {
        done(p, store->remove(dbName(args), strings(arg(args, 1))));
      });
      promise("getKeys", [this, dbName](const folly::dynamic &args, JsPromise p) {
        folly::dynamic keys = folly::dynamic::array();
        for (auto &k : store->keys(dbName(args))) {
          keys.push_back(k);
        }
        p.resolve(keys);
      });
      promise("clearStorage", [this, done, dbName](const folly::dynamic &args, JsPromise p) { done(p, store->clear(dbName(args))); });

      constexpr const char *legacy = KeyValueStore::kLegacy;
      promise("legacy_multiGet", [this](const folly::dynamic &args, JsPromise p) {
        auto keys = strings(arg(args, 0));
        auto values = store->get(legacy, keys);
        folly::dynamic out = folly::dynamic::array();
        for (size_t i = 0; i < keys.size(); i++) {
          out.push_back(folly::dynamic::array(keys[i], values[i] ? folly::dynamic(*values[i]) : folly::dynamic(nullptr)));
        }
        p.resolve(out);
      });
      promise("legacy_multiSet", [this, done](const folly::dynamic &args, JsPromise p) {
        std::vector<std::pair<std::string, std::optional<std::string>>> values;
        for (auto &[k, v] : pairs(arg(args, 0))) {
          values.emplace_back(k, v);
        }
        done(p, store->set(legacy, values));
      });
      promise("legacy_multiRemove", [this, done](const folly::dynamic &args, JsPromise p) {
        done(p, store->remove(legacy, strings(arg(args, 0))));
      });
      promise("legacy_multiMerge", [this, done](const folly::dynamic &args, JsPromise p) {
        done(p, store->merge(legacy, pairs(arg(args, 0))));
      });
      promise("legacy_getAllKeys", [this](const folly::dynamic &, JsPromise p) {
        folly::dynamic keys = folly::dynamic::array();
        for (auto &k : store->keys(legacy)) {
          keys.push_back(k);
        }
        p.resolve(keys);
      });
      promise("legacy_clear", [this, done](const folly::dynamic &, JsPromise p) { done(p, store->clear(legacy)); });
    }
    std::shared_ptr<KeyValueStore> store;
  };
  return std::make_shared<Storage>(s);
}

} // namespace ngn
