// The module registry interface: which TurboModules the runtime gets, by name.
//
// The core registers the modules it implements once for every toolkit; a backend registers a
// ModuleProvider for what only the toolkit can answer. A backend's provider is asked first, so a
// toolkit can replace a core module, then the core's own, in the order they were added.
#pragma once

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/TurboModule.h>
#include <react/nativemodule/TurboModuleProvider.h>

#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace ngn {

class ModuleProvider {
 public:
  virtual ~ModuleProvider() = default;
  // The module called `name`, or null when this provider has none.
  virtual std::shared_ptr<facebook::react::TurboModule> module(
      const std::string &name,
      const std::shared_ptr<facebook::react::CallInvoker> &jsInvoker) = 0;
};

class ModuleRegistry {
 public:
  using Factory = std::function<std::shared_ptr<facebook::react::TurboModule>(
      const std::shared_ptr<facebook::react::CallInvoker> &jsInvoker)>;

  // A core module. A second registration under one name replaces the first.
  void add(const std::string &name, Factory factory);
  void addProvider(std::shared_ptr<ModuleProvider> provider);

  std::shared_ptr<facebook::react::TurboModule> module(
      const std::string &name,
      const std::shared_ptr<facebook::react::CallInvoker> &jsInvoker) const;

  // The registry as ReactHost takes it.
  facebook::react::TurboModuleProviders providers() const;

 private:
  std::vector<std::shared_ptr<ModuleProvider>> providers_;
  std::map<std::string, Factory> factories_;
};

} // namespace ngn
