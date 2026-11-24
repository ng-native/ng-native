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

// How a view applies the insets it is told, as a library's glue reads it from its props: as a
// margin that moves the view, or as padding that moves its content, on the edges weighted 1.
struct Applies {
  bool padding{false};
  EdgeInsets edges{.left = 1, .top = 1, .right = 1, .bottom = 1};
};

struct RecordingAreas final : ngn::SafeAreas {
  Lines *out;
  std::map<Tag, Applies> *applies;
  // The insets each view's mounted state holds.
  std::map<Tag, EdgeInsets> *mounted;
  RecordingAreas(Lines *out, std::map<Tag, Applies> *applies, std::map<Tag, EdgeInsets> *mounted)
      : out(out), applies(applies), mounted(mounted) {}
  ngn::SafeAreaApplied applied(const ngn::ViewTree::Node &node, std::optional<EdgeInsets> insets) const override {
    auto how = applies->find(node.view.tag);
    if (how == applies->end()) {
      return {};
    }
    auto state = mounted->find(node.view.tag);
    EdgeInsets told = insets ? *insets : state == mounted->end() ? EdgeInsets{} : state->second;
    const auto &w = how->second.edges;
    EdgeInsets added{
        .left = told.left * w.left,
        .top = told.top * w.top,
        .right = told.right * w.right,
        .bottom = told.bottom * w.bottom,
    };
    return how->second.padding ? ngn::SafeAreaApplied{.padding = added} : ngn::SafeAreaApplied{.margin = added};
  }
  void emitInsetsChange(const ngn::ViewTree::Node &node, EdgeInsets insets, Rect frame, double leading, double trailing)
      override {
    std::ostringstream line;
    line << "provider " << node.view.tag << " " << text(insets) << " at " << frame.origin.x << "," << frame.origin.y
         << " leading " << leading;
    if (trailing != 0) {
      line << " trailing " << trailing;
    }
    out->push_back(line.str());
  }
  void setStateInsets(const ngn::ViewTree::Node &node, EdgeInsets insets) override {
    out->push_back("view " + std::to_string(node.view.tag) + " " + text(insets));
  }
};

struct Fixture {
  Lines sent;
  std::map<Tag, Applies> applies;
  std::map<Tag, EdgeInsets> mounted;
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(
      backend, backend, nullptr, std::make_unique<RecordingAreas>(&sent, &applies, &mounted));

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

TEST_CASE("the window controls reach in from the leading edge, the right one right to left") {
  // A 360-point window with the controls 13 to 69 points from its left, or from its right.
  CHECK(ngn::titlebarLeading(13, 69, 360, false) == 69);
  CHECK(ngn::titlebarLeading(291, 347, 360, true) == 69);
  // A content pane beside a sidebar the controls are over: they do not reach it.
  CHECK(ngn::titlebarLeading(-187, -131, 600, false) == 0);
  CHECK(ngn::titlebarLeading(851, 907, 600, true) == 0);
  // Controls past the far edge of a narrow container, either way, reach nothing either.
  CHECK(ngn::titlebarLeading(150, 164, 100, false) == 0);
  CHECK(ngn::titlebarLeading(-64, -50, 100, true) == 0);
  // Controls overlapping the container still count from its leading edge.
  CHECK(ngn::titlebarLeading(80, 110, 100, false) == 110);
  CHECK(ngn::titlebarLeading(-10, 20, 100, true) == 110);
}

TEST_CASE("the window controls reach in from the trailing edge, the left one right to left") {
  // A close button 46 points wide, 6 in from the right of a 360-point window, or from its left.
  CHECK(ngn::titlebarTrailing(308, 354, 360, false) == 52);
  CHECK(ngn::titlebarTrailing(6, 52, 360, true) == 52);
  // Controls outside the container reach nothing.
  CHECK(ngn::titlebarTrailing(-60, -10, 360, false) == 0);
  CHECK(ngn::titlebarTrailing(370, 400, 360, true) == 0);
  // Controls overlapping the container count from its trailing edge.
  CHECK(ngn::titlebarTrailing(-10, 20, 100, false) == 110);
  CHECK(ngn::titlebarTrailing(80, 110, 100, true) == 110);
}

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

TEST_CASE("the provider hears a change in the window controls' room alone") {
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto provider = shadowView(2, "RNCSafeAreaProvider", {{0, 0}, {800, 600}});
  f.mount({ShadowViewMutation::CreateMutation(provider), ShadowViewMutation::InsertMutation(1, provider, 0)});
  CHECK(f.sent == Lines{"provider 2 52,0,0,0 at 0,0 leading 78"});
  // Full screen hides the controls; the insets and frame stay as they were.
  f.sent.clear();
  auto controlsHidden = kWindow;
  controlsHidden.titlebarLeading = 0;
  f.mounting->setContainerInsets(1, controlsHidden);
  CHECK(f.sent == Lines{"provider 2 52,0,0,0 at 0,0 leading 0"});
}

TEST_CASE("the provider hears a change in the trailing window controls' room alone, and their going") {
  Fixture f;
  auto header = kWindow;
  header.titlebarLeading = 0;
  header.titlebarTrailing = 42;
  f.mounting->setContainerInsets(1, header);
  auto provider = shadowView(2, "RNCSafeAreaProvider", {{0, 0}, {800, 600}});
  f.mount({ShadowViewMutation::CreateMutation(provider), ShadowViewMutation::InsertMutation(1, provider, 0)});
  CHECK(f.sent == Lines{"provider 2 52,0,0,0 at 0,0 leading 0 trailing 42"});
  f.sent.clear();
  header.titlebarTrailing = 0;
  f.mounting->setContainerInsets(1, header);
  CHECK(f.sent == Lines{"provider 2 52,0,0,0 at 0,0 leading 0"});
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
  f.applies[4] = {};
  f.mount({ShadowViewMutation::CreateMutation(view), ShadowViewMutation::InsertMutation(1, view, 0)});
  CHECK(f.sent == Lines{"view 4 52,0,0,0"});

  // The state's commit lands: 52 points of margin, and the view below the toolbar.
  auto moved = view;
  moved.layoutMetrics.frame = {{0, 52}, {800, 548}};
  f.mounted[4] = {.left = 0, .top = 52, .right = 0, .bottom = 0};
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
  f.applies[4] = {};
  f.mount({ShadowViewMutation::CreateMutation(view), ShadowViewMutation::InsertMutation(1, view, 0)});
  CHECK_FALSE(f.mounting->safeAreasSettled());

  // The state's commit lands and moves the view: nothing new to say.
  auto moved = view;
  moved.layoutMetrics.frame = {{0, 52}, {800, 548}};
  f.mounted[4] = {.left = 0, .top = 52, .right = 0, .bottom = 0};
  f.mount({ShadowViewMutation::UpdateMutation(view, moved, 1)});
  CHECK(f.mounting->safeAreasSettled());

  // The toolbar grows: unsettled until a mount says nothing again.
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 60, .right = 0, .bottom = 0}});
  CHECK_FALSE(f.mounting->safeAreasSettled());
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 60, .right = 0, .bottom = 0}});
  CHECK_FALSE(f.mounting->safeAreasSettled());
}

TEST_CASE("a view inside one that moves by its insets is measured from where that margin will put it") {
  // The native stack's inset view (RNSSafeAreaView, top edge) with a page's own
  // screen-safe-area-view inside it. Measured where it is mounted, before the outer view's margin
  // lands, the inner one would be told the toolbar too, and the page would draw one commit at
  // twice the toolbar's height before settling. The inner view's tag is the lower one, so the
  // order the views are kept in decides nothing.
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto outer = shadowView(4, "RNSSafeAreaView", {{0, 0}, {800, 600}});
  auto inner = shadowView(3, "RNSSafeAreaView", {{0, 0}, {800, 600}});
  f.applies[4] = {.edges = {.left = 0, .top = 1, .right = 0, .bottom = 0}};
  f.applies[3] = {.edges = {.left = 0, .top = 1, .right = 0, .bottom = 0}};
  f.mount({
      ShadowViewMutation::CreateMutation(outer),
      ShadowViewMutation::CreateMutation(inner),
      ShadowViewMutation::InsertMutation(4, inner, 0),
      ShadowViewMutation::InsertMutation(1, outer, 0),
  });
  std::sort(f.sent.begin(), f.sent.end());
  CHECK(f.sent == Lines{"view 3 0,0,0,0", "view 4 52,0,0,0"});

  // The outer view's margin lands: nothing new for either.
  auto outerMoved = outer;
  outerMoved.layoutMetrics.frame = {{0, 52}, {800, 548}};
  auto innerMoved = inner;
  innerMoved.layoutMetrics.frame = {{0, 0}, {800, 548}};
  f.mounted[4] = {.left = 0, .top = 52, .right = 0, .bottom = 0};
  f.mount({
      ShadowViewMutation::UpdateMutation(outer, outerMoved, 0),
      ShadowViewMutation::UpdateMutation(inner, innerMoved, 0),
  });
  CHECK(f.sent.empty());

  // The toolbar grows: the outer view takes all of it, the inner one none.
  f.sent.clear();
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 60, .right = 0, .bottom = 0}});
  CHECK(f.sent == Lines{"view 4 60,0,0,0"});
}

TEST_CASE("a view inside one that pads its content by its insets is measured from where that padding will put it") {
  // react-native-safe-area-context's view in padding mode does not move, but its content does.
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto outer = shadowView(4, "RNCSafeAreaView", {{0, 0}, {800, 600}});
  auto inner = shadowView(3, "RNSSafeAreaView", {{0, 0}, {800, 600}});
  f.applies[4] = {.padding = true};
  f.applies[3] = {};
  f.mount({
      ShadowViewMutation::CreateMutation(outer),
      ShadowViewMutation::CreateMutation(inner),
      ShadowViewMutation::InsertMutation(4, inner, 0),
      ShadowViewMutation::InsertMutation(1, outer, 0),
  });
  std::sort(f.sent.begin(), f.sent.end());
  CHECK(f.sent == Lines{"view 3 0,0,0,0", "view 4 52,0,0,0"});

  // The padding lands and the inner view is below the toolbar: nothing new.
  auto innerMoved = inner;
  innerMoved.layoutMetrics.frame = {{0, 52}, {800, 548}};
  f.mounted[4] = {.left = 0, .top = 52, .right = 0, .bottom = 0};
  f.mount({ShadowViewMutation::UpdateMutation(inner, innerMoved, 0)});
  CHECK(f.sent.empty());

  // The toolbar goes: the outer view's content moves up with it, and the inner view stays clear.
  f.sent.clear();
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 28, .right = 0, .bottom = 0}});
  CHECK(f.sent == Lines{"view 4 28,0,0,0"});
}

TEST_CASE("an outer view's new insets move only the inner views at the edge they inset") {
  // A window with a bottom inset too. The outer view insets its top alone; a bar pinned to its
  // bottom keeps its place and its bottom inset, and a banner under its top edge is pushed clear.
  Fixture f;
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 52, .right = 0, .bottom = 20}});
  auto outer = shadowView(4, "RNSSafeAreaView", {{0, 0}, {800, 600}});
  auto bar = shadowView(3, "RNSSafeAreaView", {{0, 550}, {800, 50}});
  auto banner = shadowView(5, "RNSSafeAreaView", {{0, 30}, {800, 40}});
  f.applies[4] = {.edges = {.left = 0, .top = 1, .right = 0, .bottom = 0}};
  f.applies[3] = {};
  f.applies[5] = {};
  f.mount({
      ShadowViewMutation::CreateMutation(outer),
      ShadowViewMutation::CreateMutation(bar),
      ShadowViewMutation::CreateMutation(banner),
      ShadowViewMutation::InsertMutation(4, bar, 0),
      ShadowViewMutation::InsertMutation(4, banner, 1),
      ShadowViewMutation::InsertMutation(1, outer, 0),
  });
  std::sort(f.sent.begin(), f.sent.end());
  CHECK(f.sent == Lines{"view 3 0,0,20,0", "view 4 52,0,20,0", "view 5 0,0,0,0"});
}

TEST_CASE("a provider inside a view that moves by its insets hears where it will be") {
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto outer = shadowView(4, "RNSSafeAreaView", {{0, 0}, {800, 600}});
  auto provider = shadowView(2, "RNCSafeAreaProvider", {{0, 0}, {800, 600}});
  f.applies[4] = {.edges = {.left = 0, .top = 1, .right = 0, .bottom = 0}};
  f.mount({
      ShadowViewMutation::CreateMutation(outer),
      ShadowViewMutation::CreateMutation(provider),
      ShadowViewMutation::InsertMutation(4, provider, 0),
      ShadowViewMutation::InsertMutation(1, outer, 0),
  });
  std::sort(f.sent.begin(), f.sent.end());
  CHECK(f.sent == Lines{"provider 2 0,0,0,0 at 0,52 leading 78", "view 4 52,0,0,0"});

  // A commit before the margin lands, and the one it lands in, say nothing new.
  auto box = shadowView(5, "View", {{0, 0}, {10, 10}});
  f.mount({ShadowViewMutation::CreateMutation(box), ShadowViewMutation::InsertMutation(2, box, 0)});
  CHECK(f.sent.empty());
  auto outerMoved = outer;
  outerMoved.layoutMetrics.frame = {{0, 52}, {800, 548}};
  auto providerMoved = provider;
  providerMoved.layoutMetrics.frame = {{0, 0}, {800, 548}};
  f.mounted[4] = {.left = 0, .top = 52, .right = 0, .bottom = 0};
  f.mount({
      ShadowViewMutation::UpdateMutation(outer, outerMoved, 0),
      ShadowViewMutation::UpdateMutation(provider, providerMoved, 0),
  });
  CHECK(f.sent.empty());
}

TEST_CASE("a view pulled under the toolbar inside a padded view keeps its overlap as the padding changes") {
  // A negative margin puts the inner view 12 points under the toolbar, inside a view whose padding
  // has already landed. The toolbar grows: the padding moves the inner view down with it, so its
  // overlap stays 12 and it is told nothing new.
  Fixture f;
  f.mounting->setContainerInsets(1, kWindow);
  auto outer = shadowView(4, "RNCSafeAreaView", {{0, 0}, {800, 600}});
  auto inner = shadowView(3, "RNSSafeAreaView", {{0, 40}, {800, 560}});
  f.applies[4] = {.padding = true};
  f.applies[3] = {};
  f.mounted[4] = {.left = 0, .top = 52, .right = 0, .bottom = 0};
  f.mount({
      ShadowViewMutation::CreateMutation(outer),
      ShadowViewMutation::CreateMutation(inner),
      ShadowViewMutation::InsertMutation(4, inner, 0),
      ShadowViewMutation::InsertMutation(1, outer, 0),
  });
  std::sort(f.sent.begin(), f.sent.end());
  CHECK(f.sent == Lines{"view 3 12,0,0,0", "view 4 52,0,0,0"});

  f.sent.clear();
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 0, .top = 60, .right = 0, .bottom = 0}});
  CHECK(f.sent == Lines{"view 4 60,0,0,0"});
}

TEST_CASE("a view is placed by the nearest safe-area view it is in") {
  // Three deep: the outer view's margin has landed, the middle one insets its left edge alone and
  // is about to move by it, and the innermost one moves with the middle one, clear of the left.
  Fixture f;
  f.mounting->setContainerInsets(1, {.size = {800, 600}, .insets = {.left = 10, .top = 52, .right = 0, .bottom = 0}});
  auto outer = shadowView(4, "RNSSafeAreaView", {{0, 52}, {800, 548}});
  auto middle = shadowView(5, "RNSSafeAreaView", {{0, 0}, {800, 548}});
  auto inner = shadowView(3, "RNSSafeAreaView", {{0, 0}, {800, 548}});
  f.applies[4] = {.edges = {.left = 0, .top = 1, .right = 0, .bottom = 0}};
  f.applies[5] = {.edges = {.left = 1, .top = 0, .right = 0, .bottom = 0}};
  f.applies[3] = {.edges = {.left = 1, .top = 0, .right = 0, .bottom = 0}};
  f.mounted[4] = {.left = 10, .top = 52, .right = 0, .bottom = 0};
  f.mount({
      ShadowViewMutation::CreateMutation(outer),
      ShadowViewMutation::CreateMutation(middle),
      ShadowViewMutation::CreateMutation(inner),
      ShadowViewMutation::InsertMutation(5, inner, 0),
      ShadowViewMutation::InsertMutation(4, middle, 0),
      ShadowViewMutation::InsertMutation(1, outer, 0),
  });
  std::sort(f.sent.begin(), f.sent.end());
  CHECK(f.sent == Lines{"view 3 0,0,0,0", "view 4 52,0,0,10", "view 5 0,0,0,10"});
}
