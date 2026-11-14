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
