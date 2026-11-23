// Views mounted again after a reload: the new JavaScript instance numbers its views from the start
// again, so they take the tags the old ones had. What the host keeps by tag (a pane's size from the
// toolkit, a scroll view's gutter) belongs to the new view, not the old one.
#import "../../scroll-view.h"
#import "../../split-view.h"

#include "mounted-views.h"
#include "ngn/scrollers.h"

#include <doctest/doctest.h>

#include <react/renderer/components/scrollview/ScrollViewState.h>
#include <react/renderer/core/ConcreteState.h>

#import <objc/runtime.h>

#include <map>

using facebook::react::ConcreteState;
using facebook::react::ShadowNodeFamily;
using facebook::react::ShadowView;
using facebook::react::ShadowViewMutation;
using facebook::react::ShadowViewMutationList;
using facebook::react::Tag;
using RNSize = facebook::react::Size;
using facebook::react::ScrollViewState;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;
using ngn::testing::viewProps;

// Declared in split-view.mm: how a pane hears the size the toolkit gave it.
@interface NGNSplitPaneView (ToolkitSize)
- (void)applyToolkitSize:(facebook::react::Size)size;
@end

namespace {

// The reload stops the surface: each view the old instance mounted is removed and deleted.
void unmount(MountedViews &mounted, const std::vector<std::pair<Tag, ShadowView>> &removed) {
  ShadowViewMutationList mutations;
  for (const auto &[parent, view] : removed) {
    mutations.push_back(ShadowViewMutation::RemoveMutation(parent, view, 0));
  }
  for (const auto &[parent, view] : removed) {
    mutations.push_back(ShadowViewMutation::DeleteMutation(view));
  }
  mounted.mount(std::move(mutations));
}

// The sizes the panes hear, by tag, recorded on the way to the pane's own handling of them, which
// still runs. Put back as it goes.
struct HeardSizes {
  std::map<Tag, RNSize> heard;
  Method method = class_getInstanceMethod(NGNSplitPaneView.class, @selector(applyToolkitSize:));
  IMP original = method_getImplementation(method);

  HeardSizes() {
    auto *heardMap = &heard;
    IMP pane = original;
    method_setImplementation(method, imp_implementationWithBlock(^(NGNSplitPaneView *view, RNSize size) {
                               (*heardMap)[static_cast<Tag>(view.reactTag)] = size;
                               reinterpret_cast<void (*)(id, SEL, RNSize)>(pane)(view, @selector(applyToolkitSize:), size);
                             }));
  }
  ~HeardSizes() {
    method_setImplementation(method, original);
  }
  HeardSizes(const HeardSizes &) = delete;
  HeardSizes &operator=(const HeardSizes &) = delete;

  // Runs the main loop until both panes have heard a size (flushed a display frame after it is
  // given), or a deadline passes.
  void settle() {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:3];
    while ((heard.count(6) == 0 || heard.count(7) == 0) && deadline.timeIntervalSinceNow > 0) {
      [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    }
  }
};

struct SplitViewTags {
  ShadowView split = MountedViews::shadow(5, ngn::SplitViewComponentName, viewProps(folly::dynamic::object()));
  ShadowView sidebar = MountedViews::shadow(
      6, ngn::SidebarComponentName, parsedProps<ngn::SidebarComponentDescriptor>(folly::dynamic::object()));
  ShadowView content = MountedViews::shadow(7, ngn::SplitContentComponentName, viewProps(folly::dynamic::object()));
};

// The split view mounted as the app's root content, taking the window.
NGNSplitView *mountSplit(MountedViews &mounted, const SplitViewTags &views) {
  mounted.add(views.split);
  mounted.add(views.sidebar, 5);
  mounted.add(views.content, 5);
  auto *split = (NGNSplitView *)mounted.view(5);
  [split placeAsWindows:YES];
  // The window is never shown, so nothing lays its constraints out on its own.
  [mounted.window.contentView layoutSubtreeIfNeeded];
  return split;
}

// AppKit's preferred scroller style while it lives: legacy, as "Show scroll bars: Always" makes it.
struct LegacyScrollers {
  Method method = class_getClassMethod(NSScroller.class, @selector(preferredScrollerStyle));
  IMP original = method_getImplementation(method);
  LegacyScrollers() {
    method_setImplementation(method, imp_implementationWithBlock(^NSScrollerStyle(id) {
                               return NSScrollerStyleLegacy;
                             }));
  }
  ~LegacyScrollers() {
    method_setImplementation(method, original);
  }
  LegacyScrollers(const LegacyScrollers &) = delete;
  LegacyScrollers &operator=(const LegacyScrollers &) = delete;
};

// A scroll view at `tag` whose content is taller than it, so it shows a vertical scroller.
ShadowView tallScrollView(Tag tag) {
  auto view = MountedViews::shadow(tag, "ScrollView", viewProps(folly::dynamic::object()));
  view.layoutMetrics.frame.size = {200, 300};
  view.state = std::make_shared<const ConcreteState<ScrollViewState>>(
      std::make_shared<const ScrollViewState>(facebook::react::Point{}, facebook::react::Rect{{0, 0}, {200, 900}}, 0),
      ShadowNodeFamily::Weak{});
  return view;
}

} // namespace

TEST_CASE("A window's split view mounted again under the same tags gives its panes their sizes") {
  MountedViews mounted;
  struct Restore {
    ngn::InputSink *split = NGNSplitView.input;
    ~Restore() {
      NGNSplitView.input = split;
    }
  } restore;
  NGNSplitView.input = &mounted.input;
  HeardSizes sizes;
  SplitViewTags views;
  // The app window's size: a narrower one collapses the sidebar.
  [mounted.window setContentSize:NSMakeSize(1040, 720)];

  mountSplit(mounted, views);
  sizes.settle();
  REQUIRE(sizes.heard.count(6) == 1);
  REQUIRE(sizes.heard.count(7) == 1);
  RNSize sidebar = sizes.heard[6], content = sizes.heard[7];
  REQUIRE(sidebar.width > 0);
  REQUIRE(content.width > 0);

  unmount(mounted, {{5, views.sidebar}, {5, views.content}, {MountedViews::kSurface, views.split}});
  REQUIRE((mounted.window.contentView == mounted.surface));
  sizes.heard.clear();

  // The new instance mounts the same split view, under the same tags, in the same window.
  auto *again = mountSplit(mounted, views);
  sizes.settle();
  CHECK(sizes.heard.count(6) == 1);
  CHECK(sizes.heard.count(7) == 1);
  CHECK(sizes.heard[6] == sidebar);
  CHECK(sizes.heard[7] == content);
  [again uninstall];
}

TEST_CASE("A scroll view mounted again under its tag keeps its gutter when the old one is freed later") {
  LegacyScrollers legacy;
  MountedViews mounted;
  struct Restore {
    ~Restore() {
      ngn::ScrollerGutters::shared().remove(5);
    }
  } restore;
  auto scroll = tallScrollView(5);
  // Held past its deletion, as AppKit can hold a view a while after it leaves the window.
  NGNView *old = nil;
  @autoreleasepool {
    mounted.add(scroll);
    old = mounted.view(5);
    REQUIRE(ngn::ScrollerGutters::shared().get(5).right > 0);
    unmount(mounted, {{MountedViews::kSurface, scroll}});
  }
  REQUIRE((old != nil));
  // The gutter of a scroll view that went is not kept for the next view under its tag.
  CHECK(ngn::ScrollerGutters::shared().get(5) == ngn::ScrollerGutter{});

  mounted.add(tallScrollView(5));
  auto gutter = ngn::ScrollerGutters::shared().get(5);
  REQUIRE(gutter.right > 0);
  @autoreleasepool {
    old = nil;
  }
  // The new scroll view's content is still laid out beside its scroller.
  CHECK(ngn::ScrollerGutters::shared().get(5) == gutter);
}
