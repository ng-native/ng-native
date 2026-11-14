// The AppKit backend: the core's mounting and desktop props interfaces over NSViews, on the main
// thread.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/desktop-view-props.h"
#include "ngn/mounting-backend.h"

@class NGNHeaderToolbar;
@class NGNSurfaceView;
@class NGNView;

namespace ngn::appkit {

class AppKitBackend final : public MountingBackend, public DesktopPropsSink {
 public:
  AppKitBackend();

  // The view a surface's root mounts into. Main thread.
  void addSurface(NGNSurfaceView *surfaceView);
  // Called on the main thread after each mounted transaction.
  std::function<void(SurfaceId)> onMount;

  void runOnUiThread(std::function<void()> task) override;
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
};

} // namespace ngn::appkit
