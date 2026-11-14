// The shape every core module takes: methods over folly::dynamic, with callbacks and promises as
// plain functions, and events sent through an emitter. The module's logic is then ordinary C++
// that the core tests call directly, without a JavaScript engine; `turboModule` adapts it to
// React Native's TurboModule for the runtime.
#pragma once

#include "ngn/module-registry.h"

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/TurboModule.h>
#include <folly/dynamic.h>

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace ngn {

// A JavaScript function argument. Called with the array of arguments to pass it; safe from any
// thread (the call is queued onto the JavaScript thread).
using JsCallback = std::function<void(folly::dynamic arguments)>;

struct JsPromise {
  std::function<void(folly::dynamic value)> resolve;
  std::function<void(const std::string &message)> reject;
};

class NativeModule {
 public:
  using Sync = std::function<folly::dynamic(const folly::dynamic &args)>;
  // `callbacks` are the function arguments, in order; their places in `args` hold null.
  using Async = std::function<void(const folly::dynamic &args, std::vector<JsCallback> callbacks)>;
  using Promise = std::function<void(const folly::dynamic &args, JsPromise promise)>;

  // Starts something that calls `callback` again and again (a watch), and answers how to stop it.
  // Throws when it cannot start. JavaScript gets a promise of `{remove()}`, as expo-location's
  // watchPositionAsync answers, or its rejection.
  using Subscribe = std::function<std::function<void()>(const folly::dynamic &args, JsCallback callback)>;

  struct Method {
    enum class Kind { Sync, Async, Promise, Subscription } kind;
    Sync sync;
    Async async;
    Promise promise;
    Subscribe subscribe;
  };

  explicit NativeModule(std::string name) : name_(std::move(name)) {}
  virtual ~NativeModule() = default;
  NativeModule(const NativeModule &) = delete;
  NativeModule &operator=(const NativeModule &) = delete;

  const std::string &name() const {
    return name_;
  }
  const std::map<std::string, Method> &methods() const {
    return methods_;
  }

  // Where events go: RCTDeviceEventEmitter in the runtime, a recorder in tests. Any thread.
  using Emitter = std::function<void(const std::string &event, folly::dynamic body)>;
  void setEmitter(Emitter emitter);

  // A property as JavaScript reads it off the module (an Expo module's `isEnabled`), read once per
  // runtime, as a TurboModule keeps what it first answers. Null for one the module does not have.
  folly::dynamic property(const std::string &name) const;
  const std::map<std::string, std::function<folly::dynamic()>> &properties() const {
    return properties_;
  }

  // Calls a method as JavaScript would. For tests; the TurboModule calls the same functions.
  folly::dynamic call(const std::string &method, const folly::dynamic &args = folly::dynamic::array()) const;
  void callWithCallbacks(const std::string &method, const folly::dynamic &args, std::vector<JsCallback> callbacks) const;
  void callWithPromise(const std::string &method, const folly::dynamic &args, JsPromise promise) const;
  // The stop function, which does nothing after its first call.
  std::function<void()> subscribe(const std::string &method, const folly::dynamic &args, JsCallback callback) const;

 protected:
  void sync(const std::string &method, Sync fn);
  void async(const std::string &method, Async fn);
  void promise(const std::string &method, Promise fn);
  // The callback is the first function argument; its place in `args` holds null.
  void subscription(const std::string &method, Subscribe fn);
  // The listener bookkeeping every event-emitting module answers; events go out regardless.
  void listeners();
  void property(const std::string &name, std::function<folly::dynamic()> fn);
  // Constants as getConstants returns them.
  void constants(std::function<folly::dynamic()> fn);
  void emit(const std::string &event, folly::dynamic body) const;

 private:
  std::string name_;
  std::map<std::string, Method> methods_;
  std::map<std::string, std::function<folly::dynamic()>> properties_;
  mutable std::mutex emitterMutex_;
  Emitter emitter_;
};

std::shared_ptr<facebook::react::TurboModule> turboModule(
    std::shared_ptr<NativeModule> module,
    const std::shared_ptr<facebook::react::CallInvoker> &jsInvoker);

// Registers a core module: one instance per runtime, made on first use.
void addModule(ModuleRegistry &registry, const std::string &name, std::function<std::shared_ptr<NativeModule>()> make);

} // namespace ngn
