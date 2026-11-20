// React Native's IMountingManager for every toolkit: replays each mounting transaction through a
// MountingBackend on its UI thread, keeps the core's ViewTree in step, and reports desktop props.
#pragma once

#include "ngn/control-sizes.h"
#include "ngn/desktop-view-props.h"
#include "ngn/expo-ui.h"
#include "ngn/live-regions.h"
#include "ngn/mounting-backend.h"
#include "ngn/safe-areas.h"
#include "ngn/screen-stacks.h"
#include "ngn/split-view.h"
#include "ngn/svg.h"
#include "ngn/tabs-host.h"
#include "ngn/view-tree.h"

#include <react/renderer/uimanager/IMountingManager.h>

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
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
  // UI thread. The props in `changed` merged into the mounted view's and given to the backend at
  // once, with no commit, as RCTMountingManager does: Animated and Reanimated move views this way.
  void synchronouslyUpdateViewOnUIThread(Tag tag, const folly::dynamic &changed) override;

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
  // Runs `task` on the backend's UI thread, after what is queued there already. Any thread.
  void runOnUiThread(std::function<void()> task) {
    backend_->runOnUiThread(std::move(task));
  }
  // Runs the backend's pending UI-thread tasks for a moment when called on its UI thread, and does
  // nothing elsewhere: for the UI thread while it waits on another thread's work.
  void serviceUiThread() {
    if (backend_->onUiThread()) {
      backend_->serviceUiThread();
    }
  }
  // UI thread only. Whether the last mount told no safe-area view anything new and no container's
  // insets changed since: the views have the insets they will draw with. A window is shown then,
  // so its first frame is not drawn under its toolbar.
  bool safeAreasSettled() const {
    return safeAreasSettled_;
  }

  // The native controls' sizes for a runtime's layout (control-sizes.h), measured with `measurer`
  // on the backend's UI thread. A new one for each JavaScript instance, which drops the last's.
  // Any thread. `relayout` replaces the state update that lays a measured control out again.
  std::shared_ptr<ControlSizes> startControlSizes(
      std::shared_ptr<const ControlMeasurer> measurer,
      ControlSizes::Relayout relayout = nullptr);
  // Any thread: a new JavaScript instance (a runtime's first, or a reload's) begins committing.
  // Answers its number, which every mount applied after the last instance's transactions is
  // recorded under (mountedBy): the UI thread's queue keeps the two apart.
  uint64_t beginInstance();
  // Any thread: the instance begun last.
  uint64_t instance() const {
    return instances_;
  }
  // UI thread only. The instance whose transaction last mounted on `surfaceId`, 0 for none.
  uint64_t mountedBy(SurfaceId surfaceId) const {
    auto it = mountedBy_.find(surfaceId);
    return it == mountedBy_.end() ? 0 : it->second;
  }

  // UI thread only. Whether every control layout measured has been mounted at its size: a window
  // is shown then, as for its safe areas, so its first frame does not draw them unsized.
  bool controlSizesSettled() const;

  // UI thread only. What a back swipe in the window of `surfaceId` moves (back-swipe.h), and the top
  // screen of a stack now.
  std::optional<BackSwipeTarget> backSwipeTarget(SurfaceId surfaceId) const {
    return screens_->backSwipeTarget(tree_, surfaceId);
  }
  Tag stackTop(Tag stack) const {
    return screens_->top(stack);
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

  std::shared_ptr<ControlSizes> controlSizes() const;

  std::shared_ptr<MountingBackend> backend_;
  std::shared_ptr<DesktopPropsSink> desktopProps_;
  mutable std::mutex controlSizesMutex_;
  std::shared_ptr<ControlSizes> controlSizes_;
  std::vector<facebook::react::ComponentDescriptorProvider> components_;
  // The descriptors a synchronous update clones props with, made the first time a name needs one.
  std::shared_ptr<const facebook::react::ContextContainer> propsContext_;
  std::unordered_map<std::string, std::shared_ptr<const facebook::react::ComponentDescriptor>> descriptors_;
  std::unordered_set<std::string> componentNames_;
  std::function<void(SurfaceId)> afterMount_;
  std::atomic<uint64_t> instances_{0};
  // UI thread: the instance whose transactions are being applied, and each surface's last.
  uint64_t applying_{0};
  std::unordered_map<SurfaceId, uint64_t> mountedBy_;
  ViewTree tree_;
  LiveRegions liveRegions_;
  AccessibilityRelations relations_;
  std::unique_ptr<ScreenStacks> screens_;
  std::unique_ptr<SafeAreas> safeAreas_;
  bool safeAreasSettled_{false};
  Sidebars sidebars_;
  SvgDrawings svgs_;
  ExpoUITrees expoUI_;
  std::unique_ptr<TabsHosts> tabs_;
  void applyTabs(SurfaceId surfaceId);
  std::unordered_map<SurfaceId, std::optional<ScreenStacks::FrontHeader>> frontHeaders_;
};

} // namespace ngn
