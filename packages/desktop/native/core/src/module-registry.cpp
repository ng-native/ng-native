#include "ngn/module-registry.h"

#include <ReactCommon/CxxTurboModuleUtils.h>

using namespace facebook::react;

namespace ngn {

void ModuleRegistry::add(const std::string &name, Factory factory) {
  factories_[name] = std::move(factory);
}

void ModuleRegistry::addProvider(std::shared_ptr<ModuleProvider> provider) {
  providers_.push_back(std::move(provider));
}

std::shared_ptr<TurboModule> ModuleRegistry::module(
    const std::string &name,
    const std::shared_ptr<CallInvoker> &jsInvoker) const {
  for (const auto &provider : providers_) {
    if (auto module = provider->module(name, jsInvoker)) {
      return module;
    }
  }
  if (auto it = factories_.find(name); it != factories_.end()) {
    return it->second(jsInvoker);
  }
  // Autolinked libraries' and the app's own modules, which register themselves as they load, the
  // way React Native's iOS host finds a C++ TurboModule.
  auto &linked = globalExportedCxxTurboModuleMap();
  if (auto it = linked.find(name); it != linked.end()) {
    return it->second(jsInvoker);
  }
  return nullptr;
}

// The registry must outlive the ReactHost it is given to.
TurboModuleProviders ModuleRegistry::providers() const {
  return {[this](const std::string &name, const std::shared_ptr<CallInvoker> &jsInvoker) {
    return module(name, jsInvoker);
  }};
}

} // namespace ngn
