#include "fake-backend.h"
#include "helpers.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

using Lines = std::vector<std::string>;

// Records the events the native stack sends, in place of a screen's event emitter.
struct RecordingStacks final : ngn::ScreenStacks {
  Lines *events;
  explicit RecordingStacks(Lines *events) : events(events) {}
  void emit(const ngn::ViewTree::Node &node, const char *event) override {
    events->push_back(std::string(event) + " " + std::to_string(node.view.tag));
  }
};

struct Fixture {
  Lines events;
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting =
      std::make_shared<ngn::MountingManager>(backend, backend, std::make_unique<RecordingStacks>(&events));
  ShadowView stack = shadowView(2, "RNSScreenStack", {{0, 0}, {400, 300}});

  Fixture() {
    mount({ShadowViewMutation::CreateMutation(stack), ShadowViewMutation::InsertMutation(1, stack, 0)});
  }

  void mount(ShadowViewMutationList mutations) {
    backend->calls.clear();
    events.clear();
    mounting->executeMount(1, MountingTransaction(1, 1, std::move(mutations), {}));
    backend->drain();
  }

  // Each screen holds a box, so a hit test can tell which one is under the point.
  ShadowViewMutationList push(Tag screen, int index) {
    auto view = shadowView(screen, "RNSScreen", {{0, 0}, {400, 300}});
    auto box = shadowView(screen + 1, "View", {{0, 0}, {400, 300}});
    return {
        ShadowViewMutation::CreateMutation(view),
        ShadowViewMutation::CreateMutation(box),
        ShadowViewMutation::InsertMutation(screen, box, 0),
        ShadowViewMutation::InsertMutation(2, view, index),
    };
  }

  ShadowViewMutationList pop(Tag screen, int index) {
    auto view = shadowView(screen, "RNSScreen", {{0, 0}, {400, 300}});
    auto box = shadowView(screen + 1, "View", {{0, 0}, {400, 300}});
    return {
        ShadowViewMutation::RemoveMutation(2, view, index),
        ShadowViewMutation::RemoveMutation(screen, box, 0),
        ShadowViewMutation::DeleteMutation(box),
        ShadowViewMutation::DeleteMutation(view),
    };
  }

  Tag hit() const {
    auto chain = mounting->tree().hitTest(1, {200, 150});
    return chain.empty() ? -1 : chain.back();
  }
};

} // namespace

TEST_CASE("the first screen of a stack appears, and the router hears it") {
  Fixture f;
  f.mount(f.push(10, 0));
  CHECK(f.events == Lines{"willAppear 10", "appear 10", "finishTransitioning 2"});
  CHECK(f.hit() == 11);
}

TEST_CASE("a push covers the screen below without unmounting it, and a pop uncovers it") {
  Fixture f;
  f.mount(f.push(10, 0));

  f.mount(f.push(20, 1));
  CHECK(f.events == Lines{"willDisappear 10", "willAppear 20", "disappear 10", "appear 20", "finishTransitioning 2"});
  // Hidden, not removed: nothing deletes screen 10 or its box.
  CHECK(f.backend->calls == Lines{
                                "create 20 RNSScreen 0,0 400x300",
                                "create 21 View 0,0 400x300",
                                "insert 21 into 20 at 0",
                                "insert 20 into 2 at 1",
                                "cover 10",
                                "mounted 1",
                            });
  CHECK(f.mounting->tree().contains(11));
  CHECK(f.mounting->tree().covered(10));
  // The covered screen is under the top one, and never hit through it.
  CHECK(f.hit() == 21);

  f.mount(f.pop(20, 1));
  // The popped screen is gone and hears nothing; the one it covered appears again.
  CHECK(f.events == Lines{"willAppear 10", "appear 10", "finishTransitioning 2"});
  CHECK(f.backend->calls.back() == "mounted 1");
  CHECK(std::find(f.backend->calls.begin(), f.backend->calls.end(), "uncover 10") != f.backend->calls.end());
  CHECK_FALSE(f.mounting->tree().covered(10));
  CHECK(f.hit() == 11);
}

TEST_CASE("a covered screen stays out of hit tests even where the top one lets the point through") {
  Fixture f;
  f.mount(f.push(10, 0));
  f.mount(f.push(20, 1));
  auto top = shadowView(20, "RNSScreen", {{0, 0}, {400, 300}}, ngn::testing::viewProps(PointerEventsMode::BoxNone));
  auto box = shadowView(21, "View", {{0, 0}, {400, 300}}, ngn::testing::viewProps(PointerEventsMode::None));
  f.mount({
      ShadowViewMutation::UpdateMutation(shadowView(20, "RNSScreen", {{0, 0}, {400, 300}}), top, 2),
      ShadowViewMutation::UpdateMutation(shadowView(21, "View", {{0, 0}, {400, 300}}), box, 20),
  });
  CHECK(f.hit() == 2);
}

TEST_CASE("a push and pop in one commit is one change, and a stack with nothing new sends nothing") {
  Fixture f;
  f.mount(f.push(10, 0));
  f.mount(f.push(20, 1));

  // Replace the top: pop 20 and push 30 together.
  auto replace = f.pop(20, 1);
  for (auto &m : f.push(30, 1)) {
    replace.push_back(m);
  }
  f.mount(replace);
  CHECK(f.events == Lines{"willAppear 30", "appear 30", "finishTransitioning 2"});
  CHECK(f.mounting->tree().covered(10));

  // A commit inside the top screen moves nothing in the stack.
  auto inner = shadowView(40, "View", {{0, 0}, {10, 10}});
  f.mount({ShadowViewMutation::CreateMutation(inner), ShadowViewMutation::InsertMutation(31, inner, 0)});
  CHECK(f.events.empty());
}

TEST_CASE("only screens count: another child of a stack is never covered or the top") {
  Fixture f;
  f.mount(f.push(10, 0));
  auto other = shadowView(50, "View", {{0, 0}, {10, 10}});
  f.mount({ShadowViewMutation::CreateMutation(other), ShadowViewMutation::InsertMutation(2, other, 1)});
  CHECK(f.events.empty());
  CHECK_FALSE(f.mounting->tree().covered(10));
}
