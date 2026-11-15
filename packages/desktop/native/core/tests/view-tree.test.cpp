#include "helpers.h"
#include "ngn/view-tree.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::shadowView;
using ngn::testing::viewProps;

namespace {

// 1 is the surface's root, 400x300.
//   2 at 10,10 100x100, holding 3 at 20,20 30x30 (so 30,30 to 60,60 in the root)
//   4 at 50,50 100x100, after 2, so it is on top where they overlap
//   5 at 200,0 100x100, holding 6 at 10,10 20x20: a popover's content, presented elsewhere
struct Tree {
  ngn::ViewTree tree;

  Tree() {
    add(1, -1, {{0, 0}, {400, 300}});
    add(2, 1, {{10, 10}, {100, 100}});
    add(3, 2, {{20, 20}, {30, 30}});
    add(4, 1, {{50, 50}, {100, 100}});
    add(5, 1, {{200, 0}, {100, 100}});
    add(6, 5, {{10, 10}, {20, 20}});
  }

  void add(Tag tag, Tag parent, Rect frame, Props::Shared props = viewProps()) {
    tree.create(shadowView(tag, "View", frame, std::move(props)));
    if (parent != -1) {
      tree.insert(parent, tag, static_cast<int>(tree.find(parent)->children.size()));
    }
  }

  void setProps(Tag tag, Props::Shared props) {
    auto view = tree.find(tag)->view;
    view.props = std::move(props);
    tree.update(view);
  }
};

using Chain = std::vector<Tag>;

} // namespace

TEST_CASE("a hit test finds the deepest view, root first") {
  Tree t;
  CHECK(t.tree.hitTest(1, {35, 35}) == Chain{1, 2, 3});
  CHECK(t.tree.hitTest(1, {15, 15}) == Chain{1, 2});
  CHECK(t.tree.hitTest(1, {390, 290}) == Chain{1});
}

TEST_CASE("a later sibling is on top") {
  Tree t;
  CHECK(t.tree.hitTest(1, {70, 70}) == Chain{1, 4});
}

TEST_CASE("the root covers its whole container, whatever its own frame") {
  Tree t;
  // The container only reports points inside itself, and Fabric may never lay the root out.
  CHECK(t.tree.hitTest(1, {500, 10}) == Chain{1});
  auto root = t.tree.find(1)->view;
  root.layoutMetrics.frame.size = {0, 0};
  t.tree.update(root);
  CHECK(t.tree.hitTest(1, {35, 35}) == Chain{1, 2, 3});
}

TEST_CASE("a hit test from a view that is not in the tree finds nothing") {
  Tree t;
  CHECK(t.tree.hitTest(42, {1, 1}).empty());
}

TEST_CASE("pointerEvents decides what can be hit") {
  Tree t;
  SUBCASE("none lets the point through to what is under it") {
    t.setProps(4, viewProps(PointerEventsMode::None));
    CHECK(t.tree.hitTest(1, {70, 70}) == Chain{1, 2});
  }
  SUBCASE("box-none passes through the view but not its children") {
    t.setProps(2, viewProps(PointerEventsMode::BoxNone));
    CHECK(t.tree.hitTest(1, {15, 15}) == Chain{1});
    CHECK(t.tree.hitTest(1, {35, 35}) == Chain{1, 2, 3});
  }
  SUBCASE("box-only keeps the point from its children") {
    t.setProps(2, viewProps(PointerEventsMode::BoxOnly));
    CHECK(t.tree.hitTest(1, {35, 35}) == Chain{1, 2});
  }
}

TEST_CASE("a hidden view is never hit") {
  Tree t;
  auto view = t.tree.find(4)->view;
  view.layoutMetrics.displayType = DisplayType::None;
  t.tree.update(view);
  CHECK(t.tree.hitTest(1, {70, 70}) == Chain{1, 2});
}

TEST_CASE("a child outside its parent is hit only when the parent lets content overflow") {
  Tree t;
  // 7 sits at 90,90 in 2, so 100,100 to 150,150 in the root: mostly outside 2.
  t.add(7, 2, {{90, 90}, {50, 50}});
  // React Native iOS: a view with no overflow inset clips its hit test to its bounds.
  CHECK(t.tree.hitTest(1, {130, 130}) == Chain{1, 4});

  auto parent = t.tree.find(2)->view;
  parent.layoutMetrics.overflowInset = {0, 0, -40, -40};
  t.tree.update(parent);
  t.tree.remove(1, 4);
  CHECK(t.tree.hitTest(1, {130, 130}) == Chain{1, 2, 7});

  SUBCASE("unless it clips its content") {
    auto props = std::make_shared<ViewProps>();
    props->yogaStyle.setOverflow(facebook::yoga::Overflow::Hidden);
    t.setProps(2, props);
    CHECK(t.tree.hitTest(1, {130, 130}) == Chain{1});
  }
}

TEST_CASE("hitSlop widens where a view is hit, inside a parent that still clips") {
  Tree t;
  auto slop = std::make_shared<ViewProps>();
  slop->hitSlop = {10, 10, 10, 10};
  // 3 is at 30,30 to 60,60 in the root; 25,40 is 5 points left of it, still inside 2.
  t.setProps(3, slop);
  CHECK(t.tree.hitTest(1, {25, 40}) == Chain{1, 2, 3});
  CHECK(t.tree.hitTest(1, {65, 40}) == Chain{1, 2, 3});
  CHECK(t.tree.hitTest(1, {15, 40}) == Chain{1, 2});
  // 6 is at 10,10 in 5 (200,0 in the root).
  t.setProps(6, slop);
  CHECK(t.tree.hitTest(1, {215, 5}) == Chain{1, 5, 6});
  // Lifted to the top of 5, its slop above reaches past 5, which clips it there.
  auto lifted = t.tree.find(6)->view;
  lifted.layoutMetrics.frame.origin = {10, 0};
  t.tree.update(lifted);
  CHECK(t.tree.hitTest(1, {215, -5}) == Chain{1});
}

TEST_CASE("each container hit-tests from its own root, and the main one skips presented subtrees") {
  Tree t;
  // Before 5 is presented, it is part of the window's tree.
  CHECK(t.tree.hitTest(1, {215, 15}) == Chain{1, 5, 6});

  t.tree.addContainerRoot(5);
  // The window no longer lands on the popover's nodes, and finds what is under them.
  CHECK(t.tree.hitTest(1, {215, 15}) == Chain{1});
  // The popover hit-tests from its own root, in its own coordinates.
  CHECK(t.tree.hitTest(5, {15, 15}) == Chain{5, 6});
  CHECK(t.tree.hitTest(5, {90, 90}) == Chain{5});

  t.tree.removeContainerRoot(5);
  CHECK(t.tree.hitTest(1, {215, 15}) == Chain{1, 5, 6});
}

TEST_CASE("a presented subtree nested deeper is skipped too") {
  Tree t;
  t.tree.addContainerRoot(3);
  CHECK(t.tree.hitTest(1, {35, 35}) == Chain{1, 2});
  CHECK(t.tree.hitTest(3, {5, 5}) == Chain{3});
}

TEST_CASE("origins add up the frames between a view and a root") {
  Tree t;
  CHECK(t.tree.originIn(3, 1) == Point{30, 30});
  CHECK(t.tree.originIn(6, 5) == Point{10, 10});
  CHECK(t.tree.originIn(5, 5) == Point{0, 0});
  CHECK_FALSE(t.tree.originIn(3, 5).has_value());
  CHECK_FALSE(t.tree.originIn(42, 1).has_value());
}

TEST_CASE("removing and destroying views keeps the tree consistent") {
  Tree t;
  t.tree.remove(1, 4);
  CHECK(t.tree.find(1)->children == Chain{2, 5});
  CHECK(t.tree.find(4)->parent == -1);
  t.tree.destroy(4);
  CHECK_FALSE(t.tree.contains(4));
  // Inserting at an index puts the child there, not at the end.
  t.add(8, -1, {{0, 0}, {1, 1}});
  t.tree.insert(1, 8, 0);
  CHECK(t.tree.find(1)->children == Chain{8, 2, 5});
}

TEST_CASE("a scrolled view's content is hit where it is drawn, not where its layout put it") {
  // 7 is a scroll view at 0,150 400x100 (it clips), its content 8 400x1000 holding rows 9 (y 0)
  // and 10 (y 300), each 400x50.
  Tree t;
  auto clipping = std::make_shared<ViewProps>();
  clipping->yogaStyle.setOverflow(facebook::yoga::Overflow::Scroll);
  t.add(7, 1, {{0, 150}, {400, 100}}, clipping);
  t.add(8, 7, {{0, 0}, {400, 1000}});
  t.add(9, 8, {{0, 0}, {400, 50}});
  t.add(10, 8, {{0, 300}, {400, 50}});
  CHECK(t.tree.hitTest(1, {200, 160}) == Chain{1, 7, 8, 9});

  t.tree.setScrollOffset(7, {0, 290});
  CHECK(t.tree.hitTest(1, {200, 160}) == Chain{1, 7, 8, 10});
  CHECK(t.tree.originIn(10, 1) == Point{0, 160});
  // What scrolled out of the viewport cannot be hit, even where it would be without the offset.
  CHECK(t.tree.hitTest(1, {200, 130}) == Chain{1});

  // The offset goes with the view.
  t.tree.remove(1, 7);
  t.tree.destroy(7);
  t.add(7, 1, {{0, 150}, {400, 100}}, clipping);
  t.add(8, 7, {{0, 0}, {400, 1000}});
  t.add(9, 8, {{0, 0}, {400, 50}});
  CHECK(t.tree.hitTest(1, {200, 160}) == Chain{1, 7, 8, 9});
}

namespace {

std::shared_ptr<ViewProps> transformed(Transform transform) {
  auto props = std::make_shared<ViewProps>();
  props->transform = std::move(transform);
  return props;
}

} // namespace

TEST_CASE("a transformed view is hit where its layer draws it") {
  Tree t;
  SUBCASE("moved: where it went, and not where its layout put it") {
    // 4 drawn 200 to the right: 250,50 to 350,150, under 5 above y 100.
    t.setProps(4, transformed(Transform::Translate(200, 0, 0)));
    CHECK(t.tree.hitTest(1, {120, 120}) == Chain{1});
    CHECK(t.tree.hitTest(1, {260, 120}) == Chain{1, 4});
    CHECK(t.tree.pointIn(4, 1, {260, 120}) == Point{10, 70});
  }
  SUBCASE("scaled about its centre") {
    // 2 is 10,10 to 110,110; at half size about its centre (60,60) it is drawn 35,35 to 85,85,
    // and 3 inside it 45,45 to 60,60.
    t.tree.remove(1, 4);
    t.setProps(2, transformed(Transform::Scale(0.5, 0.5, 1)));
    CHECK(t.tree.hitTest(1, {20, 20}) == Chain{1});
    CHECK(t.tree.hitTest(1, {40, 40}) == Chain{1, 2});
    CHECK(t.tree.hitTest(1, {50, 50}) == Chain{1, 2, 3});
    auto local = t.tree.pointIn(3, 1, {50, 50});
    REQUIRE(local);
    CHECK(local->x == doctest::Approx(10));
    CHECK(local->y == doctest::Approx(10));
  }
  SUBCASE("rotated about its centre") {
    // 4 is 50,50 to 150,150 about 100,100. Turned 45 degrees, its corners are on the axes
    // through the centre, so a point just inside its layout corner is outside the drawn diamond,
    // and one just past its layout's right edge on the centre line is inside it.
    t.tree.remove(1, 2);
    t.setProps(4, transformed(Transform::RotateZ(M_PI / 4)));
    CHECK(t.tree.hitTest(1, {55, 55}) == Chain{1});
    CHECK(t.tree.hitTest(1, {165, 100}) == Chain{1, 4});
    // Clockwise on screen (y down): the view's own top-centre point is drawn up and to the right
    // of its centre.
    auto half = static_cast<Float>(50 / std::sqrt(2.0));
    auto local = t.tree.pointIn(4, 1, {100 + half, 100 - half});
    REQUIRE(local);
    CHECK(local->x == doctest::Approx(50));
    CHECK(std::abs(local->y) < 1e-3);
  }
  SUBCASE("a scale of zero is never hit") {
    t.setProps(4, transformed(Transform::Scale(0, 0, 1)));
    CHECK(t.tree.hitTest(1, {100, 100}) == Chain{1, 2});
    CHECK_FALSE(t.tree.pointIn(4, 1, {100, 100}));
  }
  SUBCASE("the transform going away puts the view back") {
    t.setProps(4, transformed(Transform::Translate(200, 0, 0)));
    t.setProps(4, viewProps());
    CHECK(t.tree.hitTest(1, {120, 120}) == Chain{1, 4});
  }
}

TEST_CASE("a point in a nested transformed view goes through every transform above it") {
  Tree t;
  // 2 moved 100 down, and 3 inside it moved 10 right: 3 is drawn 40,130 to 70,160.
  t.setProps(2, transformed(Transform::Translate(0, 100, 0)));
  t.setProps(3, transformed(Transform::Translate(10, 0, 0)));
  t.tree.remove(1, 4);
  CHECK(t.tree.hitTest(1, {45, 135}) == Chain{1, 2, 3});
  CHECK(t.tree.pointIn(3, 1, {45, 135}) == Point{5, 5});
  CHECK_FALSE(t.tree.pointIn(3, 5, {45, 135}));
}
