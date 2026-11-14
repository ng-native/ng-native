// React Native's IMountingManager for every toolkit: replays each mounting transaction through a
// MountingBackend on its UI thread, keeps the core's ViewTree in step, and reports desktop props.
#pragma once

#include "ngn/desktop-view-props.h"
#include "ngn/mounting-backend.h"
#include "ngn/screen-stacks.h"
#include "ngn/view-tree.h"

#include <react/renderer/uimanager/IMountingManager.h>

#include <functional>
#include <memory>
#include <unordered_set>

namespace ngn {

class MountingManager final : public facebook::react::IMountingManager,
                              public std::enable_shared_from_this<MountingManager> {
 public:
  // `desktopProps` may be null for a backend that has no use for focusable and tabIndex yet.
  // `screens` replaces the native stack's rule (tests record its events); null keeps the default.
  MountingManager(
      std::shared_ptr<MountingBackend> backend,
      std::shared_ptr<DesktopPropsSink> desktopProps,
      std::unique_ptr<ScreenStacks> screens = nullptr);

  // JS thread: the mutations are applied later, on the backend's UI thread, in order.
  void executeMount(SurfaceId surfaceId, facebook::react::MountingTransaction &&transaction) override;
  void dispatchCommand(const ShadowView &view, const std::string &name, const folly::dynamic &args) override;
  void setAfterMountCallback(std::function<void(SurfaceId)> &&onAfterMount) override;

  facebook::react::ComponentRegistryFactory getComponentRegistryFactory() override;
  bool hasComponent(const std::string &name) override;

  // UI thread only.
  const ViewTree &tree() const {
    return tree_;
  }
  ViewTree &tree() {
    return tree_;
  }

 private:
  void apply(SurfaceId surfaceId, const facebook::react::ShadowViewMutationList &mutations);
  void ensureRoot(SurfaceId surfaceId, Tag tag);
  void reportDesktopProps(const ShadowView &view, const ShadowView *old);

  std::shared_ptr<MountingBackend> backend_;
  std::shared_ptr<DesktopPropsSink> desktopProps_;
  std::vector<facebook::react::ComponentDescriptorProvider> components_;
  std::unordered_set<std::string> componentNames_;
  std::function<void(SurfaceId)> afterMount_;
  ViewTree tree_;
  std::unique_ptr<ScreenStacks> screens_;
};

} // namespace ngn
