#include "helpers.h"
#include "ngn/input-dispatcher.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::shadowView;
using ngn::testing::viewProps;

namespace {

std::string point(Point p) {
  return std::to_string(static_cast<int>(p.x)) + "," + std::to_string(static_cast<int>(p.y));
}

class RecordingDispatcher final : public ngn::InputDispatcher {
 public:
  using InputDispatcher::InputDispatcher;
  std::vector<std::string> events;

 protected:
  void emitTouch(ngn::TouchPhase phase, const ngn::ViewTree::Node &target, const TouchEvent &event) override {
    const char *names[] = {"start", "move", "end"};
    const auto &touch = *event.changedTouches.begin();
    events.push_back(
        std::string("touch ") + names[static_cast<int>(phase)] + " " + std::to_string(target.view.tag) + " page " +
        point(touch.pagePoint) + " offset " + point(touch.offsetPoint) + " touches " +
        std::to_string(event.touches.size()));
  }
  void emitPointerEnter(const ngn::ViewTree::Node &node, const PointerEvent &) override {
    events.push_back("enter " + std::to_string(node.view.tag));
  }
  void emitPointerLeave(const ngn::ViewTree::Node &node, const PointerEvent &) override {
    events.push_back("leave " + std::to_string(node.view.tag));
  }
};

// The view tree test's layout. 2 and 4 ask for hover; 3 does not; 5 holds a popover's content.
struct Fixture {
  ngn::ViewTree tree;
  RecordingDispatcher input{tree};

  Fixture() {
    add(1, -1, {{0, 0}, {400, 300}});
    add(2, 1, {{10, 10}, {100, 100}}, viewProps(PointerEventsMode::Auto, true));
    add(3, 2, {{20, 20}, {30, 30}});
    add(4, 1, {{50, 50}, {100, 100}}, viewProps(PointerEventsMode::Auto, true));
    add(5, 1, {{200, 0}, {100, 100}}, viewProps(PointerEventsMode::Auto, true));
    add(6, 5, {{10, 10}, {20, 20}}, viewProps(PointerEventsMode::Auto, true));
    input.addContainer(0, 1, 1);
  }

  void add(Tag tag, Tag parent, Rect frame, Props::Shared props = viewProps()) {
    tree.create(shadowView(tag, "View", frame, std::move(props)));
    if (parent != -1) {
      tree.insert(parent, tag, static_cast<int>(tree.find(parent)->children.size()));
    }
  }

  static ngn::PointerInput at(Point p, ngn::ContainerId container = 0) {
    ngn::PointerInput input;
    input.container = container;
    input.point = p;
    return input;
  }
};

using Events = std::vector<std::string>;

} // namespace

TEST_CASE("hover enters and leaves the views that ask for it, outermost first") {
  Fixture f;
  f.input.pointerMove(Fixture::at({35, 35}));
  CHECK(f.input.events == Events{"enter 2"});
  CHECK(f.input.hovered(1) == std::vector<Tag>{1, 2, 3});

  f.input.events.clear();
  f.input.pointerMove(Fixture::at({40, 40}));
  CHECK(f.input.events.empty());

  f.input.pointerMove(Fixture::at({70, 70}));
  CHECK(f.input.events == Events{"leave 2", "enter 4"});

  f.input.events.clear();
  f.input.pointerLeave(1, Fixture::at({500, 500}));
  CHECK(f.input.events == Events{"leave 4"});
  CHECK(f.input.hovered(1).empty());
}

TEST_CASE("a press becomes touches on the deepest view, which keeps them until release") {
  Fixture f;
  f.input.pointerDown(Fixture::at({35, 35}));
  f.input.pointerMove(Fixture::at({120, 120}));
  f.input.pointerUp(Fixture::at({120, 120}));
  CHECK(
      f.input.events ==
      Events{
          // Hover moves first, as pointer enter comes before pointer down and move on the web.
          "enter 2",
          "touch start 3 page 35,35 offset 5,5 touches 1",
          "leave 2",
          "enter 4",
          "touch move 3 page 120,120 offset 90,90 touches 1",
          "touch end 3 page 120,120 offset 90,90 touches 0",
      });
}

TEST_CASE("a press that hits no view sends no touches") {
  Fixture f;
  // A root that lets points through, with nothing under this one.
  auto root = f.tree.find(1)->view;
  root.props = viewProps(PointerEventsMode::BoxNone);
  f.tree.update(root);
  f.input.pointerDown(Fixture::at({390, 290}));
  f.input.pointerUp(Fixture::at({390, 290}));
  CHECK(f.input.events.empty());
}

TEST_CASE("hover is per surface, so it follows the pointer from the window into a popover") {
  Fixture f;
  f.tree.addContainerRoot(5);
  f.input.addContainer(7, 1, 5);

  f.input.pointerMove(Fixture::at({35, 35}));
  // The window's hit test skips the popover's nodes even where they are in its tree.
  f.input.pointerMove(Fixture::at({215, 15}));
  CHECK(f.input.events == Events{"enter 2", "leave 2"});

  f.input.events.clear();
  f.input.pointerMove(Fixture::at({15, 15}, 7));
  CHECK(f.input.events == Events{"enter 5", "enter 6"});
  CHECK(f.input.hovered(1) == std::vector<Tag>{5, 6});

  f.input.events.clear();
  f.input.pointerMove(Fixture::at({70, 70}));
  CHECK(f.input.events == Events{"leave 6", "leave 5", "enter 4"});
}

TEST_CASE("a press in a popover reports page coordinates in the surface") {
  Fixture f;
  f.tree.addContainerRoot(5);
  f.input.addContainer(7, 1, 5);
  f.input.pointerDown(Fixture::at({15, 15}, 7));
  CHECK(f.input.events.back() == "touch start 6 page 215,15 offset 5,5 touches 1");
}

TEST_CASE("events for a container nobody added are ignored") {
  Fixture f;
  f.input.pointerMove(Fixture::at({35, 35}, 99));
  f.input.pointerDown(Fixture::at({35, 35}, 99));
  CHECK(f.input.events.empty());

  f.input.removeContainer(0);
  f.input.pointerMove(Fixture::at({35, 35}));
  CHECK(f.input.events.empty());
}
