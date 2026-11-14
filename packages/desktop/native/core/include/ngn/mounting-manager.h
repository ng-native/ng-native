// React Native's IMountingManager for every toolkit: replays each mounting transaction through a
// MountingBackend on its UI thread, keeps the core's ViewTree in step, and reports desktop props.
#pragma once

#include "ngn/desktop-view-props.h"
#include "ngn/live-regions.h"
#include "ngn/mounting-backend.h"
#include "ngn/safe-areas.h"
#include "ngn/screen-stacks.h"
#include "ngn/split-view.h"
#include "ngn/svg.h"
#include "ngn/tabs-host.h"
#include "ngn/view-tree.h"

#include <react/renderer/uimanager/IMountingManager.h>

#include <functional>
#include <memory>
#include <unordered_map>
#include <unordered_set>

namespace ngn {

class MountingManager final : public facebook::react::IMountingManager,
                              public std::enable_shared_from_this<MountingManager> {
 public:
  // `desktopProps` may be null for a backend that has no use for focusable and tabIndex yet.
  // `screens` and `safeAreas` replace the native stack's and the safe area's rules (tests record
  // what they send); null keeps the defaults.
  MountingManager(
      std::shared_ptr<MountingBackend> backend,
      std::shared_ptr<DesktopPropsSink> desktopProps,
      std::unique_ptr<ScreenStacks> screens = nullptr,
      std::unique_ptr<SafeAreas> safeAreas = nullptr,
      std::unique_ptr<TabsHosts> tabs = nullptr);

  // JS thread: the mutations are applied later, on the backend's UI thread, in order.
  void executeMount(SurfaceId surfaceId, facebook::react::MountingTransaction &&transaction) override;
  void dispatchCommand(const ShadowView &view, const std::string &name, const folly::dynamic &args) override;
  void setAfterMountCallback(std::function<void(SurfaceId)> &&onAfterMount) override;

  facebook::react::ComponentRegistryFactory getComponentRegistryFactory() override;
  bool hasComponent(const std::string &name) override;

  // Told on the JS thread of each commit a transaction carries: how long the commit took (layout
  // and diff included), in milliseconds. The host logs it for the performance budget.
  std::function<void(SurfaceId surfaceId, double ms)> onCommit;

  // UI thread only. A container's size and OS insets (safe-areas.h), which its safe-area views
  // follow at once.
  void setContainerInsets(Tag root, const ContainerInsets &insets);
  // UI thread only. The user chose the tab `screen` of the tabs host `host` (tabs-host.h).
  void chooseTab(SurfaceId surfaceId, Tag host, Tag screen);
  void removeContainerInsets(Tag root);
  // UI thread only. Whether the last mount told no safe-area view anything new and no container's
  // insets changed since: the views have the insets they will draw with. A window is shown then,
  // so its first frame is not drawn under its toolbar.
  bool safeAreasSettled() const {
    return safeAreasSettled_;
  }

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
  LiveRegions liveRegions_;
  std::unique_ptr<ScreenStacks> screens_;
  std::unique_ptr<SafeAreas> safeAreas_;
  bool safeAreasSettled_{false};
  Sidebars sidebars_;
  SvgDrawings svgs_;
  std::unique_ptr<TabsHosts> tabs_;
  void applyTabs(SurfaceId surfaceId);
  std::unordered_map<SurfaceId, std::optional<ScreenStacks::FrontHeader>> frontHeaders_;
};

} // namespace ngn
