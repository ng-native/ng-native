// Views mounted the way the host mounts them: Fabric mutations through the core's MountingManager
// into the AppKit backend, in a surface that is the content view of an offscreen window that is
// never shown.
#pragma once

#import "../../appkit-backend.h"
#import "../../host-view.h"
#import "../../surface-view.h"

#include "helpers.h"
#include "ngn/desktop-view-props.h"
#include "ngn/mounting-manager.h"
#include "ngn/native-controls.h"
#include "ngn/text-input.h"

#include <react/renderer/mounting/MountingTransaction.h>

#include <memory>
#include <stdexcept>

namespace ngn::testing {

// Pointer input goes nowhere: these tests drive the focus and read accessibility only.
struct NoInput final : InputSink {
  void addContainer(ContainerId, facebook::react::SurfaceId, facebook::react::Tag) override {}
  void removeContainer(ContainerId) override {}
  void pointerDown(const PointerInput &) override {}
  void pointerMove(const PointerInput &) override {}
  void pointerUp(const PointerInput &) override {}
  void pointerLeave(facebook::react::SurfaceId, const PointerInput &) override {}
  bool contextMenu(const PointerInput &) override { return false; }
  WheelResult wheel(const PointerInput &, const WheelDelta &) override { return {}; }
  bool dragOver(const PointerInput &, const DragItems &) override { return false; }
  void dragExit(ContainerId) override {}
  bool drop(const PointerInput &, const DragItems &) override { return false; }
};

// Props as a component's descriptor parses them from what the app commits.
template <typename Descriptor>
facebook::react::Props::Shared parsedProps(folly::dynamic raw) {
  static auto context = std::make_shared<const facebook::react::ContextContainer>();
  static Descriptor descriptor{{{}, context, nullptr}};
  facebook::react::PropsParserContext parserContext{1, *context};
  return descriptor.cloneProps(parserContext, nullptr, facebook::react::RawProps(std::move(raw)));
}

inline facebook::react::Props::Shared viewProps(folly::dynamic raw) {
  return parsedProps<DesktopViewComponentDescriptor>(std::move(raw));
}

inline facebook::react::Props::Shared textInputProps(folly::dynamic raw) {
  return parsedProps<DesktopTextInputComponentDescriptor>(std::move(raw));
}

inline facebook::react::Props::Shared nativeButtonProps(folly::dynamic raw) {
  return parsedProps<NativeButtonComponentDescriptor>(std::move(raw));
}

inline facebook::react::Props::Shared datePickerProps(folly::dynamic raw) {
  return parsedProps<DatePickerComponentDescriptor>(std::move(raw));
}

struct MountedViews {
  static constexpr facebook::react::SurfaceId kSurface = 1;

  // The sink the surface view, and a split view's pane containers, tell as they go. AppKit can keep
  // a view past its test and free it in a later one, so the sink lives as long as the process, as
  // the host's does.
  static inline NoInput &input = *new NoInput;
  std::shared_ptr<appkit::AppKitBackend> backend = std::make_shared<appkit::AppKitBackend>();
  std::shared_ptr<MountingManager> mounting = std::make_shared<MountingManager>(backend, backend);
  NSWindow *window = nil;
  NGNSurfaceView *surface = nil;

  MountedViews() {
    [NSApplication sharedApplication];
    window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 400)
                                         styleMask:NSWindowStyleMaskTitled
                                           backing:NSBackingStoreBuffered
                                             defer:YES];
    window.releasedWhenClosed = NO;
    surface = [[NGNSurfaceView alloc] initWithFrame:NSMakeRect(0, 0, 400, 400) surfaceId:kSurface input:&input];
    window.contentView = surface;
    backend->addSurface(surface);
    mount({facebook::react::ShadowViewMutation::CreateMutation(shadow(kSurface, "RootView", viewProps(folly::dynamic::object())))});
  }

  ~MountedViews() {
    backend->removeSurface(kSurface);
    [window close];
  }

  MountedViews(const MountedViews &) = delete;
  MountedViews &operator=(const MountedViews &) = delete;

  static facebook::react::ShadowView shadow(
      facebook::react::Tag tag,
      const char *componentName,
      facebook::react::Props::Shared props,
      facebook::react::Float y = 0) {
    auto view = shadowView(tag, componentName, {{10, y}, {200, 24}}, std::move(props));
    view.surfaceId = kSurface;
    return view;
  }

  // Applies the mutations as a commit does, and waits for the main queue to have mounted them.
  void mount(facebook::react::ShadowViewMutationList mutations) {
    mounting->executeMount(kSurface, facebook::react::MountingTransaction(kSurface, 1, std::move(mutations), {}));
    // Shared, so a mount that gives up leaves the flag alive for the task that still runs later.
    auto mounted = std::make_shared<bool>(false);
    backend->runOnUiThread([mounted] { *mounted = true; });
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
    while (!*mounted && [deadline timeIntervalSinceNow] > 0) {
      [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
    if (!*mounted) {
      throw std::runtime_error("MountedViews: the main queue never mounted the transaction");
    }
  }

  // Creates `view` and inserts it as the last child of `parent`.
  void add(const facebook::react::ShadowView &view, facebook::react::Tag parent = kSurface) {
    auto index = static_cast<int>(mounting->tree().find(parent)->children.size());
    mount({facebook::react::ShadowViewMutation::CreateMutation(view),
           facebook::react::ShadowViewMutation::InsertMutation(parent, view, index)});
  }

  // Commits `props` to the view mounted with `view`'s tag, from what is mounted now: a snapshot
  // older than the last commit would hide a change back to an earlier value.
  void update(const facebook::react::ShadowView &view, facebook::react::Props::Shared props) {
    auto current = mounting->tree().find(view.tag)->view;
    auto next = current;
    next.props = std::move(props);
    mount({facebook::react::ShadowViewMutation::UpdateMutation(current, next, kSurface)});
  }

  NGNView *view(facebook::react::Tag tag) const {
    return backend->view(tag);
  }
};

// The alpha of `image` drawn `size` points square at 1x, at the pixel (x, y) from its top left.
inline CGFloat imageAlpha(NSImage *image, CGFloat size, NSInteger x, NSInteger y) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil
                                                                  pixelsWide:(NSInteger)size
                                                                  pixelsHigh:(NSInteger)size
                                                               bitsPerSample:8
                                                             samplesPerPixel:4
                                                                    hasAlpha:YES
                                                                    isPlanar:NO
                                                              colorSpaceName:NSDeviceRGBColorSpace
                                                                 bytesPerRow:0
                                                                bitsPerPixel:0];
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [image drawInRect:NSMakeRect(0, 0, size, size)];
  [NSGraphicsContext restoreGraphicsState];
  return [rep colorAtX:x y:y].alphaComponent;
}

// An icon whose top half is filled, to tell it drew, and drew the right way up.
inline constexpr const char *kTopHalfIcon = R"svg(<svg viewBox="0 0 16 16"><rect width="16" height="8"/></svg>)svg";

} // namespace ngn::testing
