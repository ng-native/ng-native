#include "fake-backend.h"
#include "helpers.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

MountingTransaction transaction(ShadowViewMutationList mutations) {
  return MountingTransaction(1, 1, std::move(mutations), {});
}

struct Fixture {
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(backend, backend);

  void mount(ShadowViewMutationList mutations) {
    mounting->executeMount(1, transaction(std::move(mutations)));
    backend->drain();
  }
};

std::shared_ptr<const Props> desktop(folly::dynamic raw) {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor({{}, context, nullptr});
  PropsParserContext parserContext{1, *context};
  return descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
}

} // namespace

TEST_CASE("a transaction reaches the backend in order, on the UI thread") {
  Fixture f;
  auto box = shadowView(2, "View", {{0, 0}, {100, 50}});
  auto label = shadowView(3, "Paragraph", {{4, 4}, {60, 17}});

  f.mounting->executeMount(
      1,
      transaction({
          ShadowViewMutation::CreateMutation(box),
          ShadowViewMutation::CreateMutation(label),
          ShadowViewMutation::InsertMutation(1, box, 0),
          ShadowViewMutation::InsertMutation(2, label, 0),
      }));

  // Nothing touches the toolkit on the JS thread.
  CHECK(f.backend->calls.empty());
  CHECK(f.backend->pending() == 1);

  f.backend->drain();
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{
          "create 2 View 0,0 100x50",
          "create 3 Paragraph 4,4 60x17",
          // The surface's root is made the first time a mutation names it.
          "create 1 RootView 0,0 0x0",
          "insert 2 into 1 at 0",
          "insert 3 into 2 at 0",
          "mounted 1",
      });

  f.backend->calls.clear();
  auto moved = label;
  moved.layoutMetrics.frame.origin = {8, 8};
  f.mount({
      ShadowViewMutation::UpdateMutation(label, moved, 2),
      ShadowViewMutation::RemoveMutation(2, moved, 0),
      ShadowViewMutation::DeleteMutation(moved),
  });
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{
          // Only what changed: the layout, not the props, state or event emitter.
          "layout 3 8,8 60x17",
          "remove 3 from 2 at 0",
          "delete 3",
          "mounted 1",
      });
}

TEST_CASE("transactions mount in the order they were committed") {
  Fixture f;
  auto a = shadowView(2, "View", {{0, 0}, {10, 10}});
  auto b = shadowView(3, "View", {{0, 0}, {10, 10}});
  f.mounting->executeMount(1, transaction({ShadowViewMutation::CreateMutation(a)}));
  f.mounting->executeMount(1, transaction({ShadowViewMutation::CreateMutation(b)}));
  CHECK(f.backend->pending() == 2);
  f.backend->drain();
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{"create 2 View 0,0 10x10", "mounted 1", "create 3 View 0,0 10x10", "mounted 1"});
}

TEST_CASE("an update reports each part that changed") {
  Fixture f;
  auto before = shadowView(2, "View", {{0, 0}, {10, 10}});
  f.mount({ShadowViewMutation::CreateMutation(before), ShadowViewMutation::InsertMutation(1, before, 0)});
  f.backend->calls.clear();

  auto after = before;
  after.props = std::make_shared<const ViewProps>();
  after.layoutMetrics.frame.size = {20, 20};
  f.mount({ShadowViewMutation::UpdateMutation(before, after, 1)});
  CHECK(f.backend->calls == std::vector<std::string>{"props 2", "layout 2 0,0 20x20", "mounted 1"});
}

TEST_CASE("the view tree follows the mounted tree") {
  Fixture f;
  auto box = shadowView(2, "View", {{10, 20}, {100, 50}});
  auto label = shadowView(3, "Paragraph", {{4, 4}, {60, 17}});
  f.mount({
      ShadowViewMutation::CreateMutation(box),
      ShadowViewMutation::CreateMutation(label),
      ShadowViewMutation::InsertMutation(1, box, 0),
      ShadowViewMutation::InsertMutation(2, label, 0),
  });
  const auto &tree = f.mounting->tree();
  REQUIRE(tree.find(2) != nullptr);
  CHECK(tree.find(1)->children == std::vector<Tag>{2});
  CHECK(tree.find(2)->children == std::vector<Tag>{3});
  CHECK(tree.find(3)->parent == 2);
  CHECK(tree.originIn(3, 1) == Point{14, 24});

  f.mount({ShadowViewMutation::RemoveMutation(2, label, 0), ShadowViewMutation::DeleteMutation(label)});
  CHECK(tree.find(2)->children.empty());
  CHECK(tree.find(3) == nullptr);
}

TEST_CASE("commands run on the UI thread") {
  Fixture f;
  f.mounting->dispatchCommand(shadowView(2, "TextInput", {}), "focus", folly::dynamic::array());
  CHECK(f.backend->calls.empty());
  f.backend->drain();
  CHECK(f.backend->calls == std::vector<std::string>{"command 2 focus"});
}

TEST_CASE("the after-mount callback runs once a transaction is mounted") {
  Fixture f;
  std::vector<SurfaceId> mounted;
  f.mounting->setAfterMountCallback([&](SurfaceId surfaceId) { mounted.push_back(surfaceId); });
  f.mount({ShadowViewMutation::CreateMutation(shadowView(2, "View", {}))});
  CHECK(mounted == std::vector<SurfaceId>{1});
}

TEST_CASE("desktop props reach the backend when set and when they change") {
  Fixture f;
  auto plain = shadowView(2, "View", {});
  auto focusable = shadowView(3, "View", {}, desktop(folly::dynamic::object("focusable", true)("tabIndex", 2)));
  f.mount({ShadowViewMutation::CreateMutation(plain), ShadowViewMutation::CreateMutation(focusable)});
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{
          "create 2 View 0,0 0x0",
          "create 3 View 0,0 0x0",
          // A view that sets none of them is not reported.
          "desktop 3 focusable=true tabIndex=2",
          "mounted 1",
      });

  f.backend->calls.clear();
  auto sameAgain = focusable;
  sameAgain.props = desktop(folly::dynamic::object("focusable", true)("tabIndex", 2)("opacity", 0.5));
  f.mount({ShadowViewMutation::UpdateMutation(focusable, sameAgain, 1)});
  CHECK(f.backend->calls == std::vector<std::string>{"props 3", "mounted 1"});

  f.backend->calls.clear();
  auto cleared = sameAgain;
  cleared.props = std::make_shared<const ViewProps>();
  f.mount({ShadowViewMutation::UpdateMutation(sameAgain, cleared, 1)});
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{"props 3", "desktop 3 focusable=unset tabIndex=unset", "mounted 1"});
}

TEST_CASE("the core registers its components and the backend's") {
  Fixture f;
  for (const char *name : {"View", "Paragraph", "Text", "RawText", "ScrollView", "TextInput", "Image", "ModalHostView", "UnimplementedNativeView"}) {
    CHECK_MESSAGE(f.mounting->hasComponent(name), name);
  }
  CHECK_FALSE(f.mounting->hasComponent("RNSScreen"));
}
