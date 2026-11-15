#include "fake-backend.h"
#include "helpers.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>
#include <react/renderer/mounting/MountingTransaction.h>

#include <map>
#include <sstream>

using namespace facebook::react;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

using Lines = std::vector<std::string>;

std::string text(EdgeInsets i) {
  std::ostringstream out;
  out << i.top << "," << i.right << "," << i.bottom << "," << i.left;
  return out.str();
}

struct RecordingAreas final : ngn::SafeAreas {
  Lines *out;
  // The margin each view's state applies, as a library's glue reads it from the mounted state.
  std::map<Tag, EdgeInsets> *margins;
  RecordingAreas(Lines *out, std::map<Tag, EdgeInsets> *margins) : out(out), margins(margins) {}
  std::optional<EdgeInsets> appliedMargin(const ngn::ViewTree::Node &node) const override {
    auto it = margins->find(node.view.tag);
    return it == margins->end() ? std::nullopt : std::optional(it->second);
  }
  void emitInsetsChange(const ngn::ViewTree::Node &node, EdgeInsets insets, Rect frame, double leading) override {
    std::ostringstream line;
    line << "provider " << node.view.tag << " " << text(insets) << " at " << frame.origin.x << "," << frame.origin.y
         << " leading " << leading;
    out->push_back(line.str());
  }
  void setStateInsets(const ngn::ViewTree::Node &node, EdgeInsets insets) override {
    out->push_back("view " + std::to_string(node.view.tag) + " " + text(insets));
  }
};

struct Fixture {
  Lines sent;
  std::map<Tag, EdgeInsets> margins;
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(
      backend, backend, nullptr, std::make_unique<RecordingAreas>(&sent, &margins));

  void mount(ShadowViewMutationList mutations) {
    sent.clear();
    mounting->executeMount(1, MountingTransaction(1, 1, std::move(mutations), {}));
    backend->drain();
  }
};

// A window 800 by 600 whose title bar and toolbar cover the top 52 points, with the window
// controls 78 points in from the left.
const ngn::ContainerInsets kWindow{.size = {800, 600}, .insets = {.left = 0, .top = 52, .right = 0, .bottom = 0}, .titlebarLeading = 78};

} // namespace

TEST_CASE("a view gets the part of its container's insets it overlaps") {
  ngn::ContainerInsets c{.size = {800, 600}, .insets = {.left = 10, .top = 52, .right = 20, .bottom = 30}};
  CHECK(ngn::insetsWithin(c, {{0, 0}, {800, 600}}) == EdgeInsets{.left = 10, .top = 52, .right = 20, .bottom = 30});
  // 40 down and 5 in: 12 of the top and 5 of the left are left; the far edges are clear.
  CHECK(ngn::insetsWithin(c, {{5, 40}, {100, 100}}) == EdgeInsets{.left = 5, .top = 12, .right = 0, .bottom = 0});
  CHECK(ngn::insetsWithin(c, {{700, 500}, {95, 90}}) == EdgeInsets{.left = 0, .top = 0, .right = 15, .bottom = 20});
}

TEST_CASE("the provider hears its insets and frame, and safe-area views get theirs, once each") {
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto provider = shadowView(2, "RNCSafeAreaProvider", {{0, 0}, {800, 600}});
  auto view = shadowView(3, "RNCSafeAreaView", {{0, 0}, {800, 600}});
  auto screens = shadowView(4, "RNSSafeAreaView", {{0, 100}, {800, 500}});
  f.mount({
      ShadowViewMutation::CreateMutation(provider),
      ShadowViewMutation::CreateMutation(view),
      ShadowViewMutation::CreateMutation(screens),
      ShadowViewMutation::InsertMutation(1, provider, 0),
      ShadowViewMutation::InsertMutation(2, view, 0),
      ShadowViewMutation::InsertMutation(2, screens, 1),
  });
  std::sort(f.sent.begin(), f.sent.end());
  CHECK(f.sent == Lines{"provider 2 52,0,0,0 at 0,0 leading 78", "view 3 52,0,0,0", "view 4 0,0,0,0"});

  // A commit that moves none of them says nothing.
  auto box = shadowView(5, "View", {{0, 0}, {10, 10}});
  f.mount({ShadowViewMutation::CreateMutation(box), ShadowViewMutation::InsertMutation(3, box, 0)});
  CHECK(f.sent.empty());

  // The view moves up under the toolbar: it is told its new insets.
  auto moved = screens;
  moved.layoutMetrics.frame.origin.y = 20;
  f.mount({ShadowViewMutation::UpdateMutation(screens, moved, 2)});
  CHECK(f.sent == Lines{"view 4 32,0,0,0"});
}

TEST_CASE("a change in the container's insets reaches its views at once, and a deleted view is forgotten") {
  Fixture f;
  auto view = shadowView(3, "RNCSafeAreaView", {{0, 0}, {800, 600}});
  f.mount({ShadowViewMutation::CreateMutation(view), ShadowViewMutation::InsertMutation(1, view, 0)});
  // No container metrics yet: nothing to say.
  CHECK(f.sent.empty());

  f.sent.clear();
  f.mounting->setContainerInsets(1, kWindow);
  CHECK(f.sent == Lines{"view 3 52,0,0,0"});

  // The toolbar goes away.
  f.sent.clear();
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 28, .right = 0, .bottom = 0}});
  CHECK(f.sent == Lines{"view 3 28,0,0,0"});

  f.mount({ShadowViewMutation::RemoveMutation(1, view, 0), ShadowViewMutation::DeleteMutation(view)});
  f.sent.clear();
  f.mounting->setContainerInsets(1, kWindow);
  CHECK(f.sent.empty());
}

TEST_CASE("a view in a container of its own takes that container's insets") {
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto cover = shadowView(6, "View", {{0, 0}, {800, 600}});
  auto view = shadowView(7, "RNCSafeAreaView", {{0, 0}, {300, 200}});
  f.mount({
      ShadowViewMutation::CreateMutation(cover),
      ShadowViewMutation::CreateMutation(view),
      ShadowViewMutation::InsertMutation(6, view, 0),
      ShadowViewMutation::InsertMutation(1, cover, 0),
  });
  CHECK(f.sent == Lines{"view 7 52,0,0,0"});
  f.sent.clear();
  f.mounting->setContainerInsets(6, {.size = {300, 200}, .insets = {}});
  CHECK(f.sent == Lines{"view 7 0,0,0,0"});
}

TEST_CASE("a view that applies its insets as a margin keeps them once the margin moves it") {
  // react-native-screens' safe-area view, and react-native-safe-area-context's in margin mode, move
  // themselves by their insets. Measured from where the margin put it, the view would be told it
  // is clear of the toolbar, drop the margin, move back under it, and so on every frame.
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto view = shadowView(4, "RNSSafeAreaView", {{0, 0}, {800, 600}});
  f.mount({ShadowViewMutation::CreateMutation(view), ShadowViewMutation::InsertMutation(1, view, 0)});
  CHECK(f.sent == Lines{"view 4 52,0,0,0"});

  // The state's commit lands: 52 points of margin, and the view below the toolbar.
  auto moved = view;
  moved.layoutMetrics.frame = {{0, 52}, {800, 548}};
  f.margins[4] = {.left = 0, .top = 52, .right = 0, .bottom = 0};
  f.mount({ShadowViewMutation::UpdateMutation(view, moved, 1)});
  CHECK(f.sent.empty());

  // The toolbar goes: measured from where it would be without its margin, the view is told 28.
  f.sent.clear();
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 28, .right = 0, .bottom = 0}});
  CHECK(f.sent == Lines{"view 4 28,0,0,0"});
}

TEST_CASE("the safe areas are settled once a mount tells no view anything new") {
  // What the host waits for before it shows a window, so the first frame drawn has its insets.
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto view = shadowView(4, "RNSSafeAreaView", {{0, 0}, {800, 600}});
  f.mount({ShadowViewMutation::CreateMutation(view), ShadowViewMutation::InsertMutation(1, view, 0)});
  CHECK_FALSE(f.mounting->safeAreasSettled());

  // The state's commit lands and moves the view: nothing new to say.
  auto moved = view;
  moved.layoutMetrics.frame = {{0, 52}, {800, 548}};
  f.margins[4] = {.left = 0, .top = 52, .right = 0, .bottom = 0};
  f.mount({ShadowViewMutation::UpdateMutation(view, moved, 1)});
  CHECK(f.mounting->safeAreasSettled());

  // The toolbar grows: unsettled until a mount says nothing again.
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 60, .right = 0, .bottom = 0}});
  CHECK_FALSE(f.mounting->safeAreasSettled());
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 60, .right = 0, .bottom = 0}});
  CHECK_FALSE(f.mounting->safeAreasSettled());
}
