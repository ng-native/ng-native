// The AppKit backend: the core's mounting and desktop props interfaces over NSViews, on the main
// thread.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/app-menus.h"
#include "ngn/desktop-view-props.h"
#include "ngn/mounting-backend.h"

@class NGNHeaderToolbar;
@class NGNSourceLists;
@class NGNSurfaceView;
@class NGNView;

namespace ngn::appkit {

class AppKitBackend final : public MountingBackend, public DesktopPropsSink {
 public:
  AppKitBackend();

  // The view a surface's root mounts into. Main thread.
  void addSurface(NGNSurfaceView *surfaceView);
  void removeSurface(SurfaceId surfaceId);
  NGNSurfaceView *surface(SurfaceId surfaceId) const;
  // The view mounted for `tag`, or nil. Main thread.
  NGNView *view(Tag tag) const;
  // The history the app reports for the window of `surfaceId`, for its toolbar's chevrons. Main
  // thread.
  void setHistory(SurfaceId surfaceId, const std::optional<WindowHistory> &history);
  // The history a window's toolbar starts with, when it is made after the app reported it.
  std::function<std::optional<WindowHistory>(SurfaceId)> historyOf;
  // Called on the main thread after each mounted transaction.
  std::function<void(SurfaceId)> onMount;

  void runOnUiThread(std::function<void()> task) override;
  bool onUiThread() const override;
  void serviceUiThread() override;
  void createView(const ShadowView &view) override;
  void deleteView(SurfaceId surfaceId, Tag tag) override;
  void insertChild(SurfaceId surfaceId, Tag parent, Tag child, int index) override;
  void removeChild(SurfaceId surfaceId, Tag parent, Tag child, int index) override;
  void updateProps(const ShadowView &view) override;
  void updateState(const ShadowView &view) override;
  void updateLayout(const ShadowView &view) override;
  void updateEventEmitter(const ShadowView &view) override;
  void dispatchCommand(Tag tag, const std::string &name, const folly::dynamic &args) override;
  void setCovered(SurfaceId surfaceId, Tag tag, bool covered) override;
  void setFrontHeader(SurfaceId surfaceId, const std::optional<ScreenStacks::FrontHeader> &header) override;
  void setPresented(SurfaceId surfaceId, Tag screen, bool presented) override;
  void setSplitView(SurfaceId surfaceId, Tag split, bool window) override;
  void setSourceLists(SurfaceId surfaceId, Tag parent, const std::vector<SourceList> &lists) override;
  void setSvgDrawing(SurfaceId surfaceId, Tag svg, std::shared_ptr<const SvgDocument> document) override;
  void setExpoUITree(SurfaceId surfaceId, Tag host, std::shared_ptr<const ExpoUINode> root) override;
  void announce(SurfaceId surfaceId, const Announcement &announcement) override;
  void setAccessibilityRelations(SurfaceId surfaceId, Tag tag, const AxRelations &relations) override;
  void didMount(SurfaceId surfaceId) override;
  void updateDesktopProps(SurfaceId surfaceId, Tag tag, const DesktopProps &props) override;
  std::vector<facebook::react::ComponentDescriptorProvider> componentProviders() const override;

 private:
  NSMutableDictionary<NSNumber *, NGNView *> *views_;
  NGNHeaderToolbar *toolbarFor(SurfaceId surfaceId);
  // A view whose change may change the header in front, rebuilt once the transaction is in.
  void touched(NSView *view);

  NSMutableDictionary<NSNumber *, NGNSurfaceView *> *surfaces_;
  NSMutableDictionary<NSNumber *, NGNHeaderToolbar *> *toolbars_;
  NSMutableSet<NSView *> *touched_;
  // The window's split view of each surface, by the split view's tag, whose sidebar says whether
  // the toolbar shows the sidebar button.
  NSMutableDictionary<NSNumber *, NSNumber *> *windowSplits_;
  void refreshSidebarToggle(SurfaceId surfaceId);
  // The source lists of each parent that has some, by the parent's tag.
  NSMutableDictionary<NSNumber *, NGNSourceLists *> *sourceLists_;
};

} // namespace ngn::appkit
