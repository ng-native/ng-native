#include "ngn/module-registry.h"

#include <doctest/doctest.h>

using namespace facebook::react;

namespace {

struct Named final : TurboModule {
  Named(const std::string &name, const std::shared_ptr<CallInvoker> &invoker) : TurboModule(name, invoker), label(name) {}
  std::string label;
};

std::shared_ptr<TurboModule> named(const std::string &name, const std::shared_ptr<CallInvoker> &invoker) {
  return std::make_shared<Named>(name, invoker);
}

struct ToolkitModules final : ngn::ModuleProvider {
  std::shared_ptr<TurboModule> module(const std::string &name, const std::shared_ptr<CallInvoker> &invoker) override {
    if (name == "Appearance" || name == "Clipboard") {
      return named("toolkit " + name, invoker);
    }
    return nullptr;
  }
};

std::string nameOf(const std::shared_ptr<TurboModule> &module) {
  return module ? std::static_pointer_cast<Named>(module)->label : "none";
}

} // namespace

TEST_CASE("a module comes from the backend first, then the core") {
  ngn::ModuleRegistry registry;
  registry.add("Appearance", [](const auto &invoker) { return named("core Appearance", invoker); });
  registry.add("AsyncStorage", [](const auto &invoker) { return named("core AsyncStorage", invoker); });
  registry.addProvider(std::make_shared<ToolkitModules>());

  CHECK(nameOf(registry.module("Appearance", nullptr)) == "toolkit Appearance");
  CHECK(nameOf(registry.module("Clipboard", nullptr)) == "toolkit Clipboard");
  CHECK(nameOf(registry.module("AsyncStorage", nullptr)) == "core AsyncStorage");
  CHECK(nameOf(registry.module("Missing", nullptr)) == "none");
}

TEST_CASE("registering a core module again replaces it") {
  ngn::ModuleRegistry registry;
  registry.add("Linking", [](const auto &invoker) { return named("first", invoker); });
  registry.add("Linking", [](const auto &invoker) { return named("second", invoker); });
  CHECK(nameOf(registry.module("Linking", nullptr)) == "second");
}

TEST_CASE("ReactHost asks the registry through its providers") {
  ngn::ModuleRegistry registry;
  registry.add("Linking", [](const auto &invoker) { return named("Linking", invoker); });
  auto providers = registry.providers();
  REQUIRE(providers.size() == 1);
  CHECK(nameOf(providers[0]("Linking", nullptr)) == "Linking");
  CHECK(nameOf(providers[0]("Missing", nullptr)) == "none");
  // Modules added after the providers were taken are still found.
  registry.add("AppState", [](const auto &invoker) { return named("AppState", invoker); });
  CHECK(nameOf(providers[0]("AppState", nullptr)) == "AppState");
}
