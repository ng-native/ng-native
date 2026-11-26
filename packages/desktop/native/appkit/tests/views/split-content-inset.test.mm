// A split view's content pane drawn inset (`contentStyle: 'inset'`): a card with rounded corners,
// inset from its space and below the toolbar, on a backdrop, and back to filling its space as the
// prop goes back to `plain`.
#import "../../split-view.h"
#import "../../surface-view.h"

#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;
using ngn::testing::viewProps;

namespace {

Props::Shared contentProps(const char *style) {
  return parsedProps<ngn::SplitContentComponentDescriptor>(folly::dynamic::object("contentStyle", style));
}

void layOut(NSWindow *window) {
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  [window layoutIfNeeded];
}

// The view the split shows for the content: the window's content item's, or the plain split's
// second arranged subview.
NSView *contentHost(NSWindow *window, NSSplitView *plain) {
  if (plain != nil) {
    return plain.arrangedSubviews.count > 1 ? plain.arrangedSubviews[1] : nil;
  }
  auto *controller = (NSSplitViewController *)window.contentViewController;
  return controller.splitViewItems.lastObject.viewController.view;
}

NSSplitViewItem *contentItem(NSWindow *window) {
  return ((NSSplitViewController *)window.contentViewController).splitViewItems.lastObject;
}

// The card's frame in the host's coordinates, its top measured from the host's top.
struct Inset {
  CGFloat left, right, top, bottom;
};
Inset insetOf(NSView *container, NSView *host) {
  NSRect frame = [host convertRect:container.bounds fromView:container];
  NSRect bounds = host.bounds;
  CGFloat top = host.isFlipped ? NSMinY(frame) : NSMaxY(bounds) - NSMaxY(frame);
  CGFloat bottom = host.isFlipped ? NSMaxY(bounds) - NSMaxY(frame) : NSMinY(frame);
  return {NSMinX(frame), NSMaxX(bounds) - NSMaxX(frame), top, bottom};
}

struct Restore {
  ngn::InputSink *split = NGNSplitView.input;
  ~Restore() {
    NGNSplitView.input = split;
  }
};

} // namespace

TEST_CASE("A window's split view draws its content pane inset below the toolbar, and plain again") {
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &mounted.input;
  mounted.window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(6, ngn::SidebarComponentName, viewProps(folly::dynamic::object())), 5);
  auto content = MountedViews::shadow(7, ngn::SplitContentComponentName, contentProps("inset"));
  mounted.add(content, 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  REQUIRE([split isKindOfClass:NGNSplitView.class]);
  mounted.backend->setSplitView(MountedViews::kSurface, 5, true);
  REQUIRE((mounted.window.toolbar != nil));
  layOut(mounted.window);

  NSView *container = mounted.view(7).superview;
  NSView *host = contentHost(mounted.window, nil);
  REQUIRE((container != nil));
  REQUIRE((host != nil));
  CHECK((host != container));
  CHECK([container isDescendantOf:host]);
  auto inset = insetOf(container, host);
  CHECK(inset.left == doctest::Approx(ngn::kInsetContentMargin));
  CHECK(inset.right == doctest::Approx(ngn::kInsetContentMargin));
  CHECK(inset.bottom == doctest::Approx(ngn::kInsetContentMargin));
  // Below the toolbar, which the backdrop runs under.
  CHECK(host.safeAreaInsets.top > 0);
  CHECK(inset.top == doctest::Approx(host.safeAreaInsets.top + ngn::kInsetContentMargin));
  CHECK(container.safeAreaInsets.top == doctest::Approx(0));
  // The card clips the pane to its rounded corners.
  NSView *card = container.superview;
  CHECK(card.layer.cornerRadius == doctest::Approx(ngn::kInsetContentRadius));
  CHECK(card.layer.masksToBounds);
  CHECK(contentItem(mounted.window).titlebarSeparatorStyle == NSTitlebarSeparatorStyleNone);
  // The toolbar goes, the frame stays: the card follows the safe area up, as the header's toolbar
  // asks the window's containers to lay out again.
  NSToolbar *toolbar = mounted.window.toolbar;
  CGFloat withToolbar = inset.top;
  mounted.window.toolbar = nil;
  [NGNSurfaceView safeAreaChangedIn:mounted.window];
  layOut(mounted.window);
  CHECK(insetOf(container, host).top < withToolbar);
  CHECK(insetOf(container, host).top == doctest::Approx(host.safeAreaInsets.top + ngn::kInsetContentMargin));
  mounted.window.toolbar = toolbar;
  [NGNSurfaceView safeAreaChangedIn:mounted.window];
  layOut(mounted.window);
  CHECK(insetOf(container, host).top == doctest::Approx(withToolbar));

  // Plain again: the pane fills its item, under the toolbar.
  mounted.update(content, contentProps("plain"));
  layOut(mounted.window);
  CHECK((contentHost(mounted.window, nil) == container));
  CHECK(contentItem(mounted.window).titlebarSeparatorStyle == NSTitlebarSeparatorStyleAutomatic);
  // And inset once more.
  mounted.update(content, contentProps("inset"));
  layOut(mounted.window);
  CHECK((contentHost(mounted.window, nil) != container));
  CHECK([container isDescendantOf:contentHost(mounted.window, nil)]);
  CHECK(contentItem(mounted.window).titlebarSeparatorStyle == NSTitlebarSeparatorStyleNone);
  // Another prop of the pane changing leaves the content's split item as it is.
  NSSplitViewItem *item = contentItem(mounted.window);
  mounted.update(content, parsedProps<ngn::SplitContentComponentDescriptor>(
                              folly::dynamic::object("contentStyle", "inset")("nativeID", "pane")));
  layOut(mounted.window);
  CHECK((contentItem(mounted.window) == item));
  [split uninstall];
}

TEST_CASE("A plain split view in the content draws its content pane inset in its own space") {
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &mounted.input;
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())));
  [mounted.view(5) setFrame:NSMakeRect(0, 0, 600, 400)];
  mounted.add(MountedViews::shadow(6, ngn::SidebarComponentName, viewProps(folly::dynamic::object())), 5);
  auto content = MountedViews::shadow(7, ngn::SplitContentComponentName, contentProps("inset"));
  mounted.add(content, 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  [split placeAsWindows:NO];
  NSSplitView *plain = nil;
  for (NSView *child in split.subviews) {
    if ([child isKindOfClass:NSSplitView.class]) {
      plain = (NSSplitView *)child;
    }
  }
  REQUIRE((plain != nil));
  NSView *container = mounted.view(7).superview;
  auto checkInset = [&] {
    NSView *host = contentHost(nil, plain);
    REQUIRE((host != container));
    CHECK([container isDescendantOf:host]);
    auto inset = insetOf(container, host);
    CHECK(inset.left == doctest::Approx(ngn::kInsetContentMargin));
    CHECK(inset.right == doctest::Approx(ngn::kInsetContentMargin));
    CHECK(inset.top == doctest::Approx(ngn::kInsetContentMargin));
    CHECK(inset.bottom == doctest::Approx(ngn::kInsetContentMargin));
  };
  // Inset as the split is built.
  layOut(mounted.window);
  checkInset();

  mounted.update(content, contentProps("plain"));
  layOut(mounted.window);
  CHECK((contentHost(nil, plain) == container));
  CHECK(plain.arrangedSubviews.count == 2);

  mounted.update(content, contentProps("inset"));
  layOut(mounted.window);
  checkInset();
  // The card follows the pane as the divider moves.
  NSView *host = contentHost(nil, plain);
  CGFloat width = NSWidth(host.frame);
  [plain setPosition:NSMinX(host.frame) - plain.dividerThickness + 40 ofDividerAtIndex:0];
  layOut(mounted.window);
  REQUIRE(NSWidth(host.frame) == doctest::Approx(width - 40));
  checkInset();
}

TEST_CASE("An inset card runs to the window's top when the title is hidden and nothing fills a toolbar") {
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &mounted.input;
  auto sidebarProps = [](bool toggle) {
    return parsedProps<ngn::SidebarComponentDescriptor>(folly::dynamic::object("toggleButton", toggle));
  };
  // As provideMainWindow({ titleBar: 'hidden' }) makes it.
  mounted.window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  mounted.window.titlebarAppearsTransparent = YES;
  mounted.window.titleVisibility = NSWindowTitleHidden;
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())));
  auto sidebar = MountedViews::shadow(6, ngn::SidebarComponentName, sidebarProps(false));
  mounted.add(sidebar, 5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, contentProps("inset")), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  mounted.backend->setSplitView(MountedViews::kSurface, 5, true);
  layOut(mounted.window);

  // No sidebar button, no header and no history: the window has no toolbar to clear.
  CHECK((mounted.window.toolbar == nil));
  NSView *container = mounted.view(7).superview;
  NSView *host = contentHost(mounted.window, nil);
  REQUIRE((container != nil));
  REQUIRE((host != nil));
  CHECK(insetOf(container, host).top == doctest::Approx(ngn::kInsetContentMargin));
  CHECK(insetOf(container, host).left == doctest::Approx(ngn::kInsetContentMargin));
  // Its content has what is left of the title bar as its safe area, clear of the window controls.
  CHECK(host.safeAreaInsets.top > ngn::kInsetContentMargin);
  CHECK(container.safeAreaInsets.top == doctest::Approx(host.safeAreaInsets.top - ngn::kInsetContentMargin));

  // The sidebar button back: a toolbar again, and the card below it.
  mounted.update(sidebar, sidebarProps(true));
  layOut(mounted.window);
  REQUIRE((mounted.window.toolbar != nil));
  CHECK(host.safeAreaInsets.top > 0);
  CHECK(insetOf(container, host).top == doctest::Approx(host.safeAreaInsets.top + ngn::kInsetContentMargin));
  [split uninstall];
}

TEST_CASE("An inset card stays below a title bar that shows its title, with no toolbar") {
  MountedViews mounted;
  Restore restore;
  NGNSplitView.input = &mounted.input;
  mounted.window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  mounted.add(MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object())));
  mounted.add(MountedViews::shadow(6, ngn::SidebarComponentName,
                                   parsedProps<ngn::SidebarComponentDescriptor>(folly::dynamic::object("toggleButton", false))),
              5);
  mounted.add(MountedViews::shadow(7, ngn::SplitContentComponentName, contentProps("inset")), 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  mounted.backend->setSplitView(MountedViews::kSurface, 5, true);
  layOut(mounted.window);
  CHECK((mounted.window.toolbar == nil));
  NSView *container = mounted.view(7).superview;
  NSView *host = contentHost(mounted.window, nil);
  REQUIRE((host != nil));
  CHECK(host.safeAreaInsets.top > 0);
  CHECK(insetOf(container, host).top == doctest::Approx(host.safeAreaInsets.top + ngn::kInsetContentMargin));
  [split uninstall];
}
