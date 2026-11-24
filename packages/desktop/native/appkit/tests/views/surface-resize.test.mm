#import "mounted-views.h"

#include "ngn/layout-animations.h"
#include "ngn/surface-metrics.h"

#include <doctest/doctest.h>

#include <react/renderer/runtimescheduler/RuntimeScheduler.h>
#include <react/renderer/scheduler/Scheduler.h>
#include <react/renderer/scheduler/SchedulerToolbox.h>
#include <react/renderer/scheduler/SurfaceHandler.h>
#include <react/renderer/scheduler/SchedulerDelegateImpl.h>
#include <react/renderer/uimanager/UIManager.h>

using namespace facebook::react;
using ngn::testing::MountedViews;

namespace {

struct RunningSurface {
  Scheduler &scheduler;
  SurfaceHandler surface{"", MountedViews::kSurface};

  explicit RunningSurface(Scheduler &scheduler) : scheduler(scheduler) {
    scheduler.registerSurface(surface);
    resize({400, 400});
    surface.start();
  }

  ~RunningSurface() {
    surface.stop();
    scheduler.unregisterSurface(surface);
  }

  void resize(facebook::react::Size size) {
    surface.constraintLayout(ngn::surfaceConstraints({.size = size}, false), {.pointScaleFactor = 2});
  }
};

} // namespace

TEST_CASE("A commit with retained Fabric nodes keeps the AppKit layout after a window resizes") {
  MountedViews mounted;
  auto context = std::make_shared<ContextContainer>();
  auto runtime = std::make_shared<RuntimeScheduler>([](auto &&) {});
  context->insert(RuntimeSchedulerKey, std::weak_ptr<RuntimeScheduler>(runtime));
  SchedulerDelegateImpl delegate(mounted.mounting);
  auto scheduler = ngn::makeScheduler(
      {.contextContainer = context,
       .componentRegistryFactory = mounted.mounting->getComponentRegistryFactory(),
       .runtimeExecutor = [](auto &&) {},
       .eventBeatFactory = [&](auto owner) { return std::make_unique<EventBeat>(std::move(owner), *runtime); }},
      &delegate);
  auto uiManager = scheduler->getUIManager();
  delegate.setUIManager(uiManager);
  RunningSurface running(*scheduler);

  constexpr Tag tag = 2;
  auto view = uiManager->createNode(
      tag, "View", MountedViews::kSurface, RawProps(folly::dynamic::object("flex", 1)("collapsable", false)), nullptr);
  auto children = std::make_shared<std::vector<std::shared_ptr<const ShadowNode>>>();
  children->push_back(view);
  auto commit = [&] {
    uiManager->completeSurface(MountedViews::kSurface, children, {.source = ShadowTree::CommitSource::React});
    mounted.mount({});
  };

  commit();
  REQUIRE(static_cast<bool>(mounted.view(tag)));
  CHECK(NSEqualSizes(mounted.view(tag).frame.size, NSMakeSize(400, 400)));

  for (auto size : {facebook::react::Size{600, 400}, {600, 500}, {300, 250}, {400, 400}}) {
    CAPTURE(size.width);
    CAPTURE(size.height);
    NSSize expected = NSMakeSize(size.width, size.height);
    [mounted.window setContentSize:expected];
    running.resize(size);
    mounted.mount({});
    CHECK(NSEqualSizes(mounted.view(tag).frame.size, expected));

    // The engine still holds the node from its own commit when it commits after the resize.
    commit();
    CHECK(NSEqualSizes(mounted.view(tag).frame.size, expected));
  }
}
