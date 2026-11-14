#include "ngn/native-module.h"

#include <jsi/JSIDynamic.h>
#include <react/bridging/Dynamic.h>
#include <react/bridging/Function.h>
#include <react/bridging/Promise.h>

#include <stdexcept>

using namespace facebook;
using namespace facebook::react;

namespace ngn {

void NativeModule::setEmitter(Emitter emitter) {
  std::lock_guard lock(emitterMutex_);
  emitter_ = std::move(emitter);
}

void NativeModule::emit(const std::string &event, folly::dynamic body) const {
  Emitter emitter;
  {
    std::lock_guard lock(emitterMutex_);
    emitter = emitter_;
  }
  if (emitter) {
    emitter(event, std::move(body));
  }
}

void NativeModule::sync(const std::string &method, Sync fn) {
  methods_[method] = Method{.kind = Method::Kind::Sync, .sync = std::move(fn)};
}

void NativeModule::async(const std::string &method, Async fn) {
  methods_[method] = Method{.kind = Method::Kind::Async, .async = std::move(fn)};
}

void NativeModule::promise(const std::string &method, Promise fn) {
  methods_[method] = Method{.kind = Method::Kind::Promise, .promise = std::move(fn)};
}

void NativeModule::listeners() {
  async("addListener", [](const folly::dynamic &, std::vector<JsCallback>) {});
  async("removeListeners", [](const folly::dynamic &, std::vector<JsCallback>) {});
}

void NativeModule::property(const std::string &name, std::function<folly::dynamic()> fn) {
  properties_[name] = std::move(fn);
}

folly::dynamic NativeModule::property(const std::string &name) const {
  auto it = properties_.find(name);
  return it == properties_.end() ? folly::dynamic(nullptr) : it->second();
}

void NativeModule::constants(std::function<folly::dynamic()> fn) {
  sync("getConstants", [fn = std::move(fn)](const folly::dynamic &) { return fn(); });
}

folly::dynamic NativeModule::call(const std::string &method, const folly::dynamic &args) const {
  const auto &m = methods_.at(method);
  if (m.kind == Method::Kind::Sync) {
    return m.sync(args);
  }
  if (m.kind == Method::Kind::Async) {
    m.async(args, {});
    return nullptr;
  }
  throw std::logic_error(name_ + "." + method + " returns a promise");
}

void NativeModule::callWithCallbacks(
    const std::string &method,
    const folly::dynamic &args,
    std::vector<JsCallback> callbacks) const {
  methods_.at(method).async(args, std::move(callbacks));
}

void NativeModule::callWithPromise(const std::string &method, const folly::dynamic &args, JsPromise promise) const {
  methods_.at(method).promise(args, std::move(promise));
}

namespace {

jsi::Value toJs(jsi::Runtime &rt, const folly::dynamic &value) {
  return jsi::valueFromDynamic(rt, value);
}

class Adapter final : public TurboModule {
 public:
  Adapter(std::shared_ptr<NativeModule> module, std::shared_ptr<CallInvoker> jsInvoker)
      : TurboModule(module->name(), jsInvoker), module_(std::move(module)) {}

  void attach(const std::shared_ptr<Adapter> &self) {
    // Events are queued onto the JavaScript thread by emitDeviceEvent. The emitter holds the
    // adapter weakly, so an event from a module whose runtime is gone goes nowhere.
    std::weak_ptr<Adapter> weak = self;
    module_->setEmitter([weak](const std::string &event, folly::dynamic body) {
      if (auto adapter = weak.lock()) {
        adapter->emitDeviceEvent(event, [body = std::move(body)](jsi::Runtime &rt, std::vector<jsi::Value> &args) {
          args.emplace_back(toJs(rt, body));
        });
      }
    });
  }

  jsi::Value create(jsi::Runtime &rt, const jsi::PropNameID &propName) override {
    std::string name = propName.utf8(rt);
    if (auto property = module_->properties().find(name); property != module_->properties().end()) {
      return toJs(rt, property->second());
    }
    auto it = module_->methods().find(name);
    if (it == module_->methods().end()) {
      return jsi::Value::undefined();
    }
    auto kind = it->second.kind;
    return jsi::Function::createFromHostFunction(
        rt, propName, 0, [this, name, kind](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
          return invoke(rt, name, kind, args, count);
        });
  }

  ~Adapter() override {
    module_->setEmitter(nullptr);
  }

 private:
  jsi::Value invoke(
      jsi::Runtime &rt,
      const std::string &name,
      NativeModule::Method::Kind kind,
      const jsi::Value *args,
      size_t count) {
    folly::dynamic values = folly::dynamic::array();
    std::vector<JsCallback> callbacks;
    for (size_t i = 0; i < count; i++) {
      if (args[i].isObject() && args[i].asObject(rt).isFunction(rt)) {
        AsyncCallback<> callback(rt, args[i].asObject(rt).asFunction(rt), jsInvoker_);
        callbacks.push_back([callback](folly::dynamic arguments) {
          std::function<void(jsi::Runtime &, jsi::Function &)> impl =
              [arguments = std::move(arguments)](jsi::Runtime &rt, jsi::Function &fn) {
                std::vector<jsi::Value> jsArgs;
                if (arguments.isArray()) {
                  for (const auto &a : arguments) {
                    jsArgs.push_back(toJs(rt, a));
                  }
                }
                fn.call(rt, static_cast<const jsi::Value *>(jsArgs.data()), jsArgs.size());
              };
          // The same queue, at the same priority, as emitDeviceEvent: a callback JavaScript is
          // waiting on (Networking's request id) must not land after the events that follow it.
          callback.call(std::move(impl));
        });
        values.push_back(nullptr);
      } else {
        values.push_back(jsi::dynamicFromValue(rt, args[i]));
      }
    }
    const auto &method = module_->methods().at(name);
    switch (kind) {
      case NativeModule::Method::Kind::Sync:
        // Thrown as a JavaScript Error with the module's own message, rather than Hermes's
        // "Exception in HostFunction: " in front of it.
        try {
          return toJs(rt, method.sync(values));
        } catch (const jsi::JSIException &) {
          throw;
        } catch (const std::exception &error) {
          throw jsi::JSError(rt, error.what());
        }
      case NativeModule::Method::Kind::Async:
        method.async(values, std::move(callbacks));
        return jsi::Value::undefined();
      case NativeModule::Method::Kind::Promise: {
        AsyncPromise<folly::dynamic> promise(rt, jsInvoker_);
        method.promise(
            values,
            JsPromise{
                .resolve = [promise](folly::dynamic value) mutable { promise.resolve(std::move(value)); },
                .reject = [promise](const std::string &message) mutable { promise.reject(Error(message)); },
            });
        return bridging::toJs(rt, promise, jsInvoker_);
      }
    }
    return jsi::Value::undefined();
  }

  std::shared_ptr<NativeModule> module_;
};

} // namespace

std::shared_ptr<TurboModule> turboModule(std::shared_ptr<NativeModule> module, const std::shared_ptr<CallInvoker> &jsInvoker) {
  auto adapter = std::make_shared<Adapter>(std::move(module), jsInvoker);
  adapter->attach(adapter);
  return adapter;
}

void addModule(ModuleRegistry &registry, const std::string &name, std::function<std::shared_ptr<NativeModule>()> make) {
  registry.add(name, [make = std::move(make)](const std::shared_ptr<CallInvoker> &jsInvoker) {
    return turboModule(make(), jsInvoker);
  });
}

} // namespace ngn
