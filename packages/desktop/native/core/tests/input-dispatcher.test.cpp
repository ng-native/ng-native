#include "helpers.h"
#include "ngn/input-dispatcher.h"

#include <doctest/doctest.h>
#include <folly/json.h>

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
  void emitPointer(ngn::PointerKind kind, const ngn::ViewTree::Node &node, const PointerEvent &event) override {
    const char *names[] = {"enter", "leave", "move", "over", "out"};
    events.push_back(std::string(names[static_cast<int>(kind)]) + " " + std::to_string(node.view.tag));
    pointerEvents.push_back(event);
  }
  void emitElementEvent(const ngn::ViewTree::Node &node, const std::string &name, folly::dynamic payload) override {
    folly::json::serialization_opts opts;
    opts.sort_keys = true;
    events.push_back(name + " " + std::to_string(node.view.tag) + " " + folly::json::serialize(payload, opts));
  }

 public:
  std::vector<PointerEvent> pointerEvents;
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

TEST_CASE("every move goes to the deepest view under the pointer, and the leave to the last one") {
  Fixture f;
  f.input.pointerMove(Fixture::at({35, 35}));
  CHECK(f.input.events == Events{"move 3"});
  CHECK(f.input.hovered(1) == std::vector<Tag>{1, 2, 3});

  f.input.pointerMove(Fixture::at({70, 70}));
  // React Native's PointerEventsProcessor makes enter, leave, over and out from these: the core
  // sending them as well delivered each twice.
  CHECK(f.input.events == Events{"move 3", "move 4"});

  f.input.events.clear();
  f.input.pointerLeave(1, Fixture::at({500, 500}));
  CHECK(f.input.events == Events{"leave 4"});
  CHECK(f.input.hovered(1).empty());

  // Only once: the pointer has already gone.
  f.input.pointerLeave(1, Fixture::at({500, 500}));
  CHECK(f.input.events == Events{"leave 4"});
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
          "move 3",
          "touch start 3 page 35,35 offset 5,5 touches 1",
          "move 4",
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
  CHECK(f.input.events == Events{"move 3", "move 1"});

  f.input.events.clear();
  f.input.pointerMove(Fixture::at({15, 15}, 7));
  CHECK(f.input.events == Events{"move 6"});
  CHECK(f.input.hovered(1) == std::vector<Tag>{5, 6});
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

namespace {

// A desktop View's props, parsed from what JavaScript commits.
Props::Shared desktopView(folly::dynamic raw) {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  return descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
}

void setProps(ngn::ViewTree &tree, Tag tag, Props::Shared props) {
  auto view = tree.find(tag)->view;
  view.props = std::move(props);
  tree.update(view);
}

Events only(const Events &events, const std::string &prefix) {
  Events out;
  for (const auto &e : events) {
    if (e.rfind(prefix, 0) == 0) {
      out.push_back(e);
    }
  }
  return out;
}

ngn::PointerInput click(Point p, int count) {
  auto input = Fixture::at(p);
  input.clickCount = count;
  return input;
}

} // namespace

TEST_CASE("pointer events report the surface's coordinates and the target's") {
  Fixture f;
  f.input.pointerMove(Fixture::at({35, 36}));
  REQUIRE(f.input.pointerEvents.size() == 1);
  const auto &event = f.input.pointerEvents[0];
  CHECK(event.clientPoint.x == 35);
  CHECK(event.clientPoint.y == 36);
  CHECK(event.offsetPoint.x == 5);
  CHECK(event.offsetPoint.y == 6);
  CHECK(event.pointerType == "mouse");
}

TEST_CASE("a second click sends a double click to the deepest view when it or an ancestor opts in") {
  Fixture f;
  setProps(f.tree, 2, desktopView(folly::dynamic::object("onDoubleClick", true)));

  f.input.pointerDown(click({35, 36}, 1));
  f.input.pointerUp(click({35, 36}, 1));
  CHECK(only(f.input.events, "doubleClick").empty());

  f.input.pointerDown(click({35, 36}, 2));
  CHECK(only(f.input.events, "doubleClick").empty());
  f.input.pointerUp(click({35, 36}, 2));
  CHECK(
      only(f.input.events, "doubleClick") ==
      Events{R"(doubleClick 3 {"locationX":5,"locationY":6,"pageX":35,"pageY":36})"});

  // 4 has no opt-in, and neither has anything above it.
  f.input.events.clear();
  f.input.pointerDown(click({120, 120}, 2));
  f.input.pointerUp(click({120, 120}, 2));
  CHECK(only(f.input.events, "doubleClick").empty());
}

TEST_CASE("a context menu goes to a view that opts in, and says whether one did") {
  Fixture f;
  setProps(f.tree, 2, desktopView(folly::dynamic::object("onContextMenu", true)));

  CHECK(f.input.contextMenu(Fixture::at({35, 36})));
  CHECK(f.input.events == Events{R"(contextMenu 3 {"locationX":5,"locationY":6,"pageX":35,"pageY":36})"});

  f.input.events.clear();
  CHECK_FALSE(f.input.contextMenu(Fixture::at({120, 120})));
  CHECK(f.input.events.empty());
}

TEST_CASE("a wheel turn goes to a view that opts in, with its deltas") {
  Fixture f;
  setProps(f.tree, 4, desktopView(folly::dynamic::object("onWheel", true)));

  CHECK(f.input.wheel(Fixture::at({120, 120}), {.x = 0, .y = -12.5, .z = 0, .mode = 0}));
  CHECK(f.input.events == Events{R"(wheel 4 {"deltaMode":0,"deltaX":0,"deltaY":-12.5,"deltaZ":0})"});

  f.input.events.clear();
  CHECK_FALSE(f.input.wheel(Fixture::at({35, 35}), {.y = 3}));
  CHECK(f.input.events.empty());
}

TEST_CASE("element events in a popover report page coordinates in the surface") {
  Fixture f;
  setProps(f.tree, 6, desktopView(folly::dynamic::object("onContextMenu", true)));
  f.tree.addContainerRoot(5);
  f.input.addContainer(7, 1, 5);
  CHECK(f.input.contextMenu(Fixture::at({15, 16}, 7)));
  CHECK(f.input.events == Events{R"(contextMenu 6 {"locationX":5,"locationY":6,"pageX":215,"pageY":16})"});
}

TEST_CASE("the cursor is the nearest one under the pointer, text over a text input, and the default elsewhere") {
  Fixture f;
  std::vector<Cursor> cursors;
  f.input.onCursor = [&](Cursor cursor) { cursors.push_back(cursor); };
  setProps(f.tree, 2, desktopView(folly::dynamic::object("desktopCursor", "grab")("cursor", "auto")));
  setProps(f.tree, 3, desktopView(folly::dynamic::object("cursor", "pointer")));
  f.add(7, 1, {{300, 200}, {50, 20}});
  auto field = f.tree.find(7)->view;
  field.componentName = "TextInput";
  f.tree.update(field);

  f.input.pointerMove(Fixture::at({35, 35}));
  f.input.pointerMove(Fixture::at({36, 36}));
  f.input.pointerMove(Fixture::at({15, 15}));
  f.input.pointerMove(Fixture::at({310, 210}));
  f.input.pointerMove(Fixture::at({390, 290}));
  f.input.pointerMove(Fixture::at({15, 15}));
  f.input.pointerLeave(1, Fixture::at({500, 500}));
  // Each change once: the second move over 3 asks for nothing new.
  CHECK(
      cursors ==
      std::vector<Cursor>{Cursor::Pointer, Cursor::Grab, Cursor::Text, Cursor::Auto, Cursor::Grab, Cursor::Auto});
}

TEST_CASE("the cursor follows a change to the views under a still pointer") {
  Fixture f;
  std::vector<Cursor> cursors;
  f.input.onCursor = [&](Cursor cursor) { cursors.push_back(cursor); };
  setProps(f.tree, 2, desktopView(folly::dynamic::object("desktopCursor", "grab")));
  f.input.pointerMove(Fixture::at({15, 15}));

  setProps(f.tree, 2, desktopView(folly::dynamic::object("desktopCursor", "grabbing")));
  f.input.didMount(1);
  // Unset, it is the default again.
  setProps(f.tree, 2, desktopView(folly::dynamic::object()));
  f.input.didMount(1);
  f.input.didMount(1);
  // Another surface's transaction leaves this pointer's cursor alone.
  setProps(f.tree, 2, desktopView(folly::dynamic::object("desktopCursor", "move")));
  f.input.didMount(2);
  CHECK(cursors == std::vector<Cursor>{Cursor::Grab, Cursor::Grabbing, Cursor::Auto});
}
