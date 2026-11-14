#include "ngn/module-registry.h"
#include "ngn/library-glue.h"

#include <ReactCommon/CxxTurboModuleUtils.h>

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

TEST_CASE("a module a library registers in React Native's C++ module map comes after the host's own") {
  // What an autolinked library's desktop code does as it loads, as React Native's iOS host has it.
  registerCxxModuleToGlobalModuleMap("LinkedMath", [](auto invoker) { return named("linked LinkedMath", invoker); });
  registerCxxModuleToGlobalModuleMap("Appearance", [](auto invoker) { return named("linked Appearance", invoker); });
  struct Restore {
    ~Restore() {
      globalExportedCxxTurboModuleMap().erase("LinkedMath");
      globalExportedCxxTurboModuleMap().erase("Appearance");
    }
  } restore;
  ngn::ModuleRegistry registry;
  registry.add("Appearance", [](const auto &invoker) { return named("core Appearance", invoker); });

  CHECK(nameOf(registry.module("LinkedMath", nullptr)) == "linked LinkedMath");
  CHECK(nameOf(registry.module("Appearance", nullptr)) == "core Appearance");
  CHECK(nameOf(registry.providers()[0]("LinkedMath", nullptr)) == "linked LinkedMath");
}

TEST_CASE("a library's glue module is found after the core's, while the host has the library") {
  ngn::ModuleRegistry registry;
  registry.add("Linking", [](const auto &invoker) { return named("core Linking", invoker); });
  auto &glue = ngn::libraryGlue().modules;
  auto saved = glue;
  try {
    glue["WorkletsModule"] = [](const auto &invoker) { return named("glue WorkletsModule", invoker); };
    glue["Linking"] = [](const auto &invoker) { return named("glue Linking", invoker); };
    CHECK(nameOf(registry.module("WorkletsModule", nullptr)) == "glue WorkletsModule");
    CHECK(nameOf(registry.module("Linking", nullptr)) == "core Linking");
    glue.erase("WorkletsModule");
    CHECK(nameOf(registry.module("WorkletsModule", nullptr)) == "none");
  } catch (...) {
    glue = saved;
    throw;
  }
  glue = saved;
}
