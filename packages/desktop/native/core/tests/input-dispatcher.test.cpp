#include "helpers.h"
#include "ngn/gestures.h"
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
    const char *names[] = {"start", "move", "end", "cancel"};
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

TEST_CASE("activating a view is a press at its centre, sent to it even where another view covers it") {
  Fixture f;
  // 2's centre (60,60) is under 4, which a click there would hit.
  CHECK(f.input.activate(1, 2));
  CHECK(
      f.input.events ==
      Events{
          "touch start 2 page 60,60 offset 50,50 touches 1",
          "touch end 2 page 60,60 offset 50,50 touches 0",
      });

  // A view in a popover is pressed through the popover's container, in surface coordinates.
  f.input.events.clear();
  f.tree.addContainerRoot(5);
  f.input.addContainer(7, 1, 5);
  CHECK(f.input.activate(1, 6));
  CHECK(f.input.events.front() == "touch start 6 page 220,20 offset 10,10 touches 1");
}

TEST_CASE("activating does nothing for a view no container holds, or while a press is down") {
  Fixture f;
  CHECK_FALSE(f.input.activate(1, 99));
  CHECK_FALSE(f.input.activate(2, 3));
  f.input.pointerDown(Fixture::at({35, 35}));
  f.input.events.clear();
  CHECK_FALSE(f.input.activate(1, 4));
  CHECK(f.input.events.empty());
  // The press under way still ends on its own view.
  f.input.pointerUp(Fixture::at({35, 35}));
  CHECK(f.input.events == Events{"touch end 3 page 35,35 offset 5,5 touches 0"});
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

TEST_CASE("a right click finds the nearest view with a context menu, and the choice goes back to that view") {
  Fixture f;
  auto menu = folly::dynamic::array(
      folly::dynamic::object("id", "0")("label", "Rename"), folly::dynamic::object("separator", true),
      folly::dynamic::object("id", "2")("label", "Copy")("menuRole", "copy"));
  setProps(f.tree, 2, desktopView(folly::dynamic::object("contextMenu", menu)));

  auto target = f.input.contextMenuAt(Fixture::at({35, 36}));
  REQUIRE(target);
  CHECK(target->tag == 2);
  REQUIRE(target->items.size() == 3);
  CHECK(target->items[0].title == "Rename");
  CHECK(target->items[1].separator);
  CHECK(target->items[2].command == ngn::MenuCommand::Copy);
  CHECK_FALSE(f.input.contextMenuAt(Fixture::at({120, 120})));
  CHECK_FALSE(f.input.contextMenuAt(Fixture::at({35, 36}, 9)));

  f.input.contextMenuSelect(2, "0");
  CHECK(f.input.events == Events{R"(contextMenuSelect 2 {"id":"0"})"});

  // A menu taken away (null) is gone.
  setProps(f.tree, 2, desktopView(folly::dynamic::object("contextMenu", nullptr)));
  CHECK_FALSE(f.input.contextMenuAt(Fixture::at({35, 36})));
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

namespace {

ngn::DragItems notes() {
  return ngn::dragItems({"file:///Users/me/notes.md"}, std::nullopt);
}

} // namespace

TEST_CASE("a drag's urls split into files, named by their last part, and other urls") {
  auto items = ngn::dragItems(
      {"file:///Users/me/My%20Notes.md", "file:///Users/me/Photos/", "https://example.com/a?b=1",
       "file://localhost/tmp/caf%C3%A9.txt"},
      std::string("hello"));
  REQUIRE(items.files.size() == 3);
  CHECK(items.files[0].uri == "file:///Users/me/My%20Notes.md");
  CHECK(items.files[0].name == "My Notes.md");
  // A folder's url ends in a slash; its name is the folder's.
  CHECK(items.files[1].name == "Photos");
  CHECK(items.files[2].name == "caf\xC3\xA9.txt");
  CHECK(items.urls == std::vector<std::string>{"https://example.com/a?b=1"});
  CHECK(items.text == "hello");

  // A url is offered as text too, and a file as its path: that is not dragged text.
  CHECK_FALSE(ngn::dragItems({"https://example.com/"}, std::string("https://example.com/")).text);
  CHECK_FALSE(ngn::dragItems({"file:///Users/me/My%20Notes.md"}, std::string("/Users/me/My Notes.md")).text);
  CHECK(ngn::dragItems({"https://example.com/"}, std::string("Example")).text == "Example");

  folly::json::serialization_opts opts;
  opts.sort_keys = true;
  CHECK(
      folly::json::serialize(ngn::dropPayload(notes()), opts) ==
      R"({"files":[{"name":"notes.md","uri":"file:///Users/me/notes.md"}],"text":null,"urls":[]})");
}

TEST_CASE("a drag goes to the nearest view under it that takes drops, entering and leaving as it moves") {
  Fixture f;
  setProps(f.tree, 2, desktopView(folly::dynamic::object("fileDrop", true)));
  setProps(f.tree, 4, desktopView(folly::dynamic::object("fileDrop", true)));
  const std::string enter2 =
      R"(dropEnter 2 {"files":[{"name":"notes.md","uri":"file:///Users/me/notes.md"}],"text":null,"urls":[]})";

  // Over 3, inside 2: the event goes to 2, the view that takes drops, not the deepest.
  CHECK(f.input.dragOver(Fixture::at({35, 35}), notes()));
  CHECK(f.input.events == Events{enter2});
  // Moving within 2 sends nothing new.
  CHECK(f.input.dragOver(Fixture::at({15, 15}), notes()));
  CHECK(f.input.events.size() == 1);

  // Onto 4: 2 is left and 4 entered.
  f.input.events.clear();
  CHECK(f.input.dragOver(Fixture::at({120, 120}), notes()));
  CHECK(f.input.events.size() == 2);
  CHECK(f.input.events[0] == "dropLeave 2 {}");
  CHECK(f.input.events[1].rfind("dropEnter 4 ", 0) == 0);

  // Over the root, which takes none: 4 is left, and the drag is refused there.
  f.input.events.clear();
  CHECK_FALSE(f.input.dragOver(Fixture::at({390, 290}), notes()));
  CHECK(f.input.events == Events{"dropLeave 4 {}"});

  // Back onto 2 and out of the window.
  f.input.events.clear();
  f.input.dragOver(Fixture::at({35, 35}), notes());
  f.input.dragExit(0);
  CHECK(f.input.events == Events{enter2, "dropLeave 2 {}"});
  f.input.dragExit(0);
  CHECK(f.input.events.size() == 2);
}

TEST_CASE("a drop goes to the view the drag is over, with no leave, and ends the drag") {
  Fixture f;
  setProps(f.tree, 2, desktopView(folly::dynamic::object("fileDrop", true)));
  f.input.dragOver(Fixture::at({35, 35}), notes());
  f.input.events.clear();

  CHECK(f.input.drop(Fixture::at({35, 35}), notes()));
  CHECK(
      f.input.events ==
      Events{R"(dropPerform 2 {"files":[{"name":"notes.md","uri":"file:///Users/me/notes.md"}],"text":null,"urls":[]})"});
  // The drag is over: an exit after it sends no leave.
  f.input.dragExit(0);
  CHECK(f.input.events.size() == 1);

  // A drop where no view takes it is refused, and so is one in a container nobody added.
  f.input.events.clear();
  CHECK_FALSE(f.input.drop(Fixture::at({390, 290}), notes()));
  CHECK_FALSE(f.input.drop(Fixture::at({35, 35}, 9), notes()));
  CHECK(f.input.events.empty());
}

TEST_CASE("a drag forgets a view that stops taking drops or goes away") {
  Fixture f;
  setProps(f.tree, 2, desktopView(folly::dynamic::object("fileDrop", true)));
  f.input.dragOver(Fixture::at({35, 35}), notes());

  // The prop is taken away while the drag is over it: the next move leaves it.
  setProps(f.tree, 2, desktopView(folly::dynamic::object("fileDrop", nullptr)));
  f.input.events.clear();
  CHECK_FALSE(f.input.dragOver(Fixture::at({35, 35}), notes()));
  CHECK(f.input.events == Events{"dropLeave 2 {}"});

  // A target deleted under the drag gets no leave: there is nothing to send it to.
  setProps(f.tree, 4, desktopView(folly::dynamic::object("fileDrop", true)));
  f.input.dragOver(Fixture::at({120, 120}), notes());
  f.tree.remove(1, 4);
  f.tree.destroy(4);
  f.input.events.clear();
  f.input.dragExit(0);
  CHECK(f.input.events.empty());
}

TEST_CASE("a drag hit-tests as a click does, so a view that lets points through takes no drop") {
  Fixture f;
  setProps(f.tree, 2, desktopView(folly::dynamic::object("fileDrop", true)("pointerEvents", "none")));
  CHECK_FALSE(f.input.dragOver(Fixture::at({35, 35}), notes()));
  CHECK(f.input.events.empty());
}

TEST_CASE("a drag item is parsed from its prop, and one with nothing in it is none") {
  auto item = ngn::dragItemOf(folly::dynamic::object(
      "files", folly::dynamic::array("file:///Users/me/a%20b.md"))("text", "Hello")("url", "https://example.com/"));
  REQUIRE(item);
  CHECK(item->files == std::vector<std::string>{"file:///Users/me/a%20b.md"});
  CHECK(item->text == "Hello");
  CHECK(item->url == "https://example.com/");
  CHECK_FALSE(ngn::dragItemOf(nullptr));
  CHECK_FALSE(ngn::dragItemOf(folly::dynamic::object("files", folly::dynamic::array())("text", nullptr)("url", nullptr)));
  // Files that are not file urls are left out.
  CHECK_FALSE(ngn::dragItemOf(folly::dynamic::object("files", folly::dynamic::array("/no/scheme", 3))));
}

TEST_CASE("a press that moves on a view with a drag item drags it out, and cancels the press") {
  Fixture f;
  setProps(
      f.tree, 2,
      desktopView(folly::dynamic::object(
          "dragItem", folly::dynamic::object("files", folly::dynamic::array("file:///tmp/a.md"))("text", nullptr)("url", nullptr))));
  std::vector<std::pair<Tag, ngn::DragOutItem>> started;
  f.input.onDragOut = [&](Tag tag, const ngn::PointerInput &, const ngn::DragOutItem &item) { started.emplace_back(tag, item); };

  f.input.pointerDown(Fixture::at({35, 35}));
  // A wobble under the threshold is still a press.
  f.input.pointerMove(Fixture::at({37, 36}));
  CHECK(started.empty());
  f.input.pointerMove(Fixture::at({45, 35}));
  REQUIRE(started.size() == 1);
  CHECK(started[0].first == 2);
  CHECK(started[0].second.files == std::vector<std::string>{"file:///tmp/a.md"});
  // The press is cancelled, so a pressable under it never sees a release as a press.
  CHECK(only(f.input.events, "touch").back().rfind("touch cancel 3", 0) == 0);

  // The drag owns the mouse now: the rest of the gesture sends no touches.
  f.input.events.clear();
  f.input.pointerMove(Fixture::at({80, 80}));
  f.input.pointerUp(Fixture::at({80, 80}));
  CHECK(only(f.input.events, "touch").empty());
  CHECK(started.size() == 1);

  // A press on a view with no drag item above it moves as a press.
  f.input.pointerDown(Fixture::at({120, 120}));
  f.input.pointerMove(Fixture::at({140, 140}));
  CHECK(started.size() == 1);
  CHECK(only(f.input.events, "touch move").size() == 1);
}

TEST_CASE("a gesture handler sees the press, its moves and the pointer's hover, and one that activates cancels JavaScript's touch") {
  Fixture f;
  ngn::Gestures gestures(f.tree, nullptr);
  f.input.setGestures(&gestures);
  std::vector<std::string> sent;
  gestures.onDeviceEvent = [&](const folly::dynamic &body) {
    sent.push_back(std::to_string(body["handlerTag"].asInt()) + " " + std::to_string(body["state"].asInt()));
  };
  gestures.create("PanGestureHandler", 1, folly::dynamic::object());
  gestures.attach(1, 2, ngn::GestureAction::JsFunctionNewApi);
  gestures.create("HoverGestureHandler", 2, folly::dynamic::object());
  gestures.attach(2, 4, ngn::GestureAction::JsFunctionNewApi);

  f.input.pointerDown(Fixture::at({30, 30}));
  CHECK(sent == std::vector<std::string>{"1 2"});
  f.input.events.clear();
  f.input.pointerMove(Fixture::at({34, 30}));
  // Under the slop: JavaScript's touch moves, the pan has not decided.
  CHECK(std::count(f.input.events.begin(), f.input.events.end(), "touch move 3 page 34,30 offset 4,0 touches 1") == 1);
  f.input.events.clear();
  f.input.pointerMove(Fixture::at({60, 30}));
  // Past it: the pan activates and the touch is cancelled, and the release goes to the pan alone.
  CHECK(sent.back() == "1 4");
  bool cancelled = false;
  for (const auto &event : f.input.events) {
    cancelled = cancelled || event.rfind("touch cancel 3", 0) == 0;
  }
  CHECK(cancelled);
  // The pan keeps the moves after it took the press from JavaScript.
  sent.clear();
  f.input.pointerMove(Fixture::at({70, 40}));
  CHECK(sent == std::vector<std::string>{"1 4"});
  f.input.events.clear();
  f.input.pointerUp(Fixture::at({70, 40}));
  CHECK(sent.back() == "1 5");
  for (const auto &event : f.input.events) {
    CHECK(event.rfind("touch", 0) != 0);
  }

  // With no button down the pointer hovers: the hover handler on 4 activates over it and ends off it.
  sent.clear();
  f.input.pointerMove(Fixture::at({120, 120}));
  CHECK(sent == std::vector<std::string>{"2 2", "2 4", "2 4"});
  f.input.pointerLeave(1, Fixture::at({390, 290}));
  CHECK(sent.back() == "2 5");
}
