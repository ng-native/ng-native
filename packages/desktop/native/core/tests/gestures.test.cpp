#include "helpers.h"
#include "ngn/gestures.h"

#include <doctest/doctest.h>

#include <memory>

using namespace facebook::react;
using folly::dynamic;
using ngn::GestureAction;
using ngn::GesturePhase;
using ngn::GesturePointer;
using ngn::testing::shadowView;

namespace {

constexpr int kPan = 1;
constexpr int kTap = 2;
constexpr int kPress = 3;
constexpr int kNative = 4;
constexpr int kOther = 5;

// Timers the test moves on by hand.
struct Clock {
  struct Timer {
    double due;
    std::function<void()> fn;
    std::shared_ptr<bool> cancelled;
  };
  double now = 0;
  std::vector<Timer> timers;

  ngn::Gestures::Schedule schedule() {
    return [this](double ms, std::function<void()> fn) {
      auto cancelled = std::make_shared<bool>(false);
      timers.push_back({now + ms, std::move(fn), cancelled});
      return [cancelled] { *cancelled = true; };
    };
  }

  void advance(double ms) {
    now += ms;
    bool ran = true;
    while (ran) {
      ran = false;
      for (size_t i = 0; i < timers.size(); ++i) {
        if (!*timers[i].cancelled && timers[i].due <= now) {
          *timers[i].cancelled = true;
          auto fn = timers[i].fn;
          fn();
          ran = true;
          break;
        }
      }
    }
  }
};

// A surface (1) with a card (2) at 10,20 sized 200x100 inside a scroll view (3) at 0,0 400x400,
// and a second card (4) beside it at 220,20.
struct Fixture {
  ngn::ViewTree tree;
  Clock clock;
  ngn::Gestures gestures{tree, clock.schedule()};
  // "state <tag> <old>-><new>" and "update <tag>" for each event, in order, whichever way it went.
  std::vector<std::string> events;
  std::vector<dynamic> bodies;
  std::vector<std::string> workletNames;
  int claims = 0;

  Fixture() {
    tree.create(shadowView(1, "RootView", {{0, 0}, {800, 600}}));
    tree.create(shadowView(3, "ScrollView", {{0, 0}, {400, 400}}));
    tree.create(shadowView(2, "View", {{10, 20}, {200, 100}}));
    tree.create(shadowView(4, "View", {{220, 20}, {150, 100}}));
    tree.insert(1, 3, 0);
    tree.insert(3, 2, 0);
    tree.insert(3, 4, 1);
    auto record = [this](const dynamic &body) {
      bodies.push_back(body);
      auto tag = std::to_string(body["handlerTag"].asInt());
      if (body.count("oldState")) {
        events.push_back("state " + tag + " " + std::to_string(body["oldState"].asInt()) + "->" + std::to_string(body["state"].asInt()));
      } else {
        events.push_back("update " + tag);
      }
    };
    gestures.onDeviceEvent = record;
    gestures.onWorkletEvent = [this, record](const std::string &name, Tag view, const dynamic &body) {
      CHECK(view == body["target"].asInt());
      workletNames.push_back(name);
      record(body);
    };
    gestures.onClaim = [this] { ++claims; };
  }

  void add(const char *name, int tag, Tag view, dynamic config = dynamic::object(), dynamic relations = dynamic::object(),
           GestureAction action = GestureAction::JsFunctionNewApi) {
    gestures.create(name, tag, config);
    gestures.attach(tag, view, action);
    gestures.configure(tag, config, true);
    gestures.relations(tag, relations);
  }

  GesturePointer at(Float x, Float y) const {
    return {.id = 1, .page = {x, y}, .time = clock.now};
  }
  void down(Float x, Float y) {
    gestures.pointerDown(1, tree.hitTest(1, {x, y}), at(x, y));
  }
  void move(Float x, Float y, double after = 16) {
    clock.advance(after);
    gestures.pointerMove(at(x, y));
  }
  void up(Float x, Float y, double after = 16) {
    clock.advance(after);
    gestures.pointerUp(at(x, y));
  }

  bool has(const std::string &event) const {
    return std::find(events.begin(), events.end(), event) != events.end();
  }
};

// The state numbers: 0 undetermined, 1 failed, 2 began, 3 cancelled, 4 active, 5 end.

} // namespace

TEST_CASE("a pan begins on the press, activates past the slop with its translation, and ends on the release") {
  Fixture f;
  f.add("PanGestureHandler", kPan, 2);
  f.down(50, 60);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2"});
  f.move(55, 62);
  // Under 10 points: still only began.
  CHECK(f.events.size() == 1);
  f.move(70, 60);
  // The move that activates it is also its first update, as the library sends it.
  CHECK(f.events == std::vector<std::string>{"state 1 0->2", "state 1 2->4", "update 1", "update 1"});
  // Translation counts from where it activated, as UIKit's pan and the library's iOS pan report it.
  CHECK(f.bodies.back()["translationX"].asDouble() == doctest::Approx(0));
  // Position is in the view's own coordinates; absolute is the surface's.
  const auto &active = f.bodies.back();
  CHECK(active["x"].asDouble() == doctest::Approx(60));
  CHECK(active["y"].asDouble() == doctest::Approx(40));
  CHECK(active["absoluteX"].asDouble() == doctest::Approx(70));
  CHECK(active["target"].asInt() == 2);
  CHECK(active["pointerType"].asInt() == 2);
  f.move(90, 70);
  CHECK(f.events.back() == "update 1");
  CHECK(f.bodies.back()["translationX"].asDouble() == doctest::Approx(20));
  CHECK(f.bodies.back()["translationY"].asDouble() == doctest::Approx(10));
  CHECK(f.bodies.back()["velocityX"].asDouble() > 0);
  f.up(90, 70);
  CHECK(f.events.back() == "state 1 4->5");
  // It took the press from JavaScript as it activated, once.
  CHECK(f.claims == 1);
}

TEST_CASE("a pan's offsets activate it in one direction and fail it in the other") {
  Fixture f;
  // The inbox row's swipe: left only.
  f.add("PanGestureHandler", kPan, 2, dynamic::object("activeOffsetXStart", -12)("failOffsetXEnd", 12)("failOffsetYStart", -10)("failOffsetYEnd", 10));
  f.down(100, 60);
  f.move(108, 60);
  f.move(114, 60);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2", "state 1 2->1"});
  CHECK(f.claims == 0);

  f.events.clear();
  f.up(114, 60);
  f.down(100, 60);
  // Under the custom criteria the default slop no longer activates it.
  f.move(95, 60);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2"});
  f.move(87, 61);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2", "state 1 2->4", "update 1", "update 1"});
  f.move(80, 61);
  CHECK(f.bodies.back()["translationX"].asDouble() == doctest::Approx(-7));
}

TEST_CASE("a pan that activates after a long press waits for it, and fails when dragged first") {
  Fixture f;
  f.add("PanGestureHandler", kPan, 2, dynamic::object("activateAfterLongPress", 250));
  f.down(50, 60);
  f.move(52, 61, 100);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2"});
  f.clock.advance(150);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2", "state 1 2->4", "update 1"});
  f.move(150, 61);
  CHECK(f.events.back() == "update 1");
  f.up(150, 61);
  CHECK(f.events.back() == "state 1 4->5");

  f.events.clear();
  f.down(50, 60);
  f.move(80, 60, 50);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2", "state 1 2->1"});
  // The long press's timer went with the failure.
  f.clock.advance(500);
  CHECK(f.events.size() == 2);
}

TEST_CASE("an exclusive tap waits for the pan before it to fail, and a click runs it") {
  Fixture f;
  // Gesture.Exclusive(pan, tap): the tap waits for the pan.
  f.add("PanGestureHandler", kPan, 2, dynamic::object("activateAfterLongPress", 250));
  f.add("TapGestureHandler", kTap, 2, dynamic::object(), dynamic::object("waitFor", dynamic::array(kPan)));
  f.down(50, 60);
  f.up(50, 60, 80);
  CHECK(f.has("state 1 2->1"));
  // The tap ended while it waited, so it reports each step once the pan failed.
  CHECK(f.has("state 2 0->2"));
  CHECK(f.has("state 2 2->4"));
  CHECK(f.has("state 2 4->5"));
  auto failed = std::find(f.events.begin(), f.events.end(), "state 1 2->1");
  auto tapped = std::find(f.events.begin(), f.events.end(), "state 2 4->5");
  CHECK(failed < tapped);

  // A hold that lifts the card is the pan's; the tap is cancelled, never reporting an end.
  f.events.clear();
  f.down(50, 60);
  f.clock.advance(300);
  f.up(50, 60);
  CHECK(f.has("state 1 2->4"));
  CHECK(f.has("state 1 4->5"));
  CHECK_FALSE(f.has("state 2 4->5"));
}

TEST_CASE("a tap fails when the press is held past its duration or dragged away") {
  Fixture f;
  f.add("TapGestureHandler", kTap, 2, dynamic::object("maxDist", 10));
  f.down(50, 60);
  f.clock.advance(600);
  CHECK(f.events == std::vector<std::string>{"state 2 0->2", "state 2 2->1"});
  f.up(50, 60);

  f.events.clear();
  f.down(50, 60);
  f.move(70, 60);
  CHECK(f.events == std::vector<std::string>{"state 2 0->2", "state 2 2->1"});
}

TEST_CASE("a long press activates after its duration and reports how long it was held") {
  Fixture f;
  f.add("LongPressGestureHandler", kPress, 2, dynamic::object("minDurationMs", 400));
  f.down(50, 60);
  f.clock.advance(399);
  CHECK(f.events == std::vector<std::string>{"state 3 0->2"});
  f.clock.advance(1);
  CHECK(f.has("state 3 2->4"));
  CHECK(f.bodies.back()["duration"].asDouble() >= 0);
  f.up(50, 60, 100);
  CHECK(f.events.back() == "state 3 4->5");
}

TEST_CASE("a race of a swipe and an exclusive press-or-tap: a quick click is the tap") {
  Fixture f;
  // The inbox row: Race(pan, Exclusive(press, tap)).
  f.add("PanGestureHandler", kPan, 2, dynamic::object("activeOffsetXStart", -12)("failOffsetXEnd", 12));
  f.add("LongPressGestureHandler", kPress, 2, dynamic::object("minDurationMs", 400));
  f.add("TapGestureHandler", kTap, 2, dynamic::object(), dynamic::object("waitFor", dynamic::array(kPress)));
  f.down(100, 60);
  f.up(100, 60, 120);
  CHECK(f.has("state 3 2->1"));
  CHECK(f.has("state 2 4->5"));
  CHECK_FALSE(f.has("state 1 2->4"));

  // A swipe left wins the race: the press and the tap are cancelled.
  f.events.clear();
  f.down(100, 60);
  f.move(80, 60);
  CHECK(f.has("state 1 2->4"));
  CHECK(f.has("state 3 2->3"));
  CHECK(f.has("state 2 2->3"));
  f.up(60, 60);
  CHECK(f.events.back() == "state 1 4->5");
}

TEST_CASE("a native scroll view handler runs beside a pan that is simultaneous with it, and cancels one that is not") {
  Fixture f;
  f.add("NativeViewGestureHandler", kNative, 3);
  f.add("PanGestureHandler", kPan, 2, dynamic::object("activateAfterLongPress", 300),
        dynamic::object("simultaneousHandlers", dynamic::array(kNative)));
  f.down(50, 60);
  CHECK(f.has("state 4 0->2"));
  CHECK(f.has("state 1 0->2"));
  // A mouse drag does not scroll a scroll view, so its handler does not activate on one.
  f.move(53, 60);
  CHECK_FALSE(f.has("state 4 2->4"));
  f.clock.advance(300);
  CHECK(f.has("state 1 2->4"));
  CHECK_FALSE(f.has("state 1 4->3"));
  f.up(53, 60);

  // Scrolling the view activates its handler, which cancels a pan that is not simultaneous.
  Fixture g;
  g.add("NativeViewGestureHandler", kNative, 3);
  g.add("PanGestureHandler", kPan, 2);
  g.down(50, 60);
  CHECK(g.has("state 1 0->2"));
  g.gestures.scroll(1, g.tree.hitTest(1, {50, 60}), g.at(50, 60), {0, -5}, std::nullopt);
  CHECK(g.has("state 4 2->4"));
  CHECK(g.has("state 1 2->3"));
  // The scroll view's own handler takes nothing from JavaScript's press.
  CHECK(g.claims == 0);
  g.up(50, 60);
}

TEST_CASE("a handler that blocks another makes it wait for its failure") {
  Fixture f;
  // pan.blocksExternalGesture(outer): the outer one waits for the pan.
  f.add("PanGestureHandler", kPan, 2, dynamic::object("activeOffsetXStart", -12)("failOffsetXEnd", 12), dynamic::object("blocksHandlers", dynamic::array(kOther)));
  f.add("PanGestureHandler", kOther, 3);
  f.down(100, 60);
  f.move(111, 60);
  // The outer pan is past its slop, but the row's swipe has not decided: the outer one waits.
  CHECK_FALSE(f.has("state 5 2->4"));
  CHECK_FALSE(f.has("state 1 2->1"));
  f.move(114, 60);
  CHECK(f.has("state 1 2->1"));
  CHECK(f.has("state 5 2->4"));
}

TEST_CASE("a worklet gesture's events go to Reanimated under the library's event names") {
  Fixture f;
  f.add("PanGestureHandler", kPan, 2, dynamic::object(), dynamic::object(), GestureAction::ReanimatedWorklet);
  f.down(50, 60);
  f.move(70, 60);
  f.up(70, 60);
  CHECK(f.workletNames == std::vector<std::string>{"onGestureHandlerStateChange", "onGestureHandlerStateChange",
                                                   "onGestureHandlerEvent", "onGestureHandlerEvent",
                                                   "onGestureHandlerStateChange"});
}

TEST_CASE("a trackpad's magnify is a pinch and its rotation a rotation, with their focal point") {
  Fixture f;
  f.add("PinchGestureHandler", kPan, 2);
  f.add("RotationGestureHandler", kTap, 2, dynamic::object(), dynamic::object("simultaneousHandlers", dynamic::array(kPan)));
  auto chain = f.tree.hitTest(1, {60, 70});
  f.gestures.magnify(1, chain, f.at(60, 70), 0, GesturePhase::Began);
  f.gestures.rotate(1, chain, f.at(60, 70), 0, GesturePhase::Began);
  f.clock.advance(16);
  f.gestures.magnify(1, chain, f.at(60, 70), 0.5, GesturePhase::Changed);
  CHECK(f.has("state 1 2->4"));
  CHECK(f.bodies.back()["scale"].asDouble() == doctest::Approx(1.5));
  CHECK(f.bodies.back()["focalX"].asDouble() == doctest::Approx(50));
  CHECK(f.bodies.back()["focalY"].asDouble() == doctest::Approx(50));
  f.clock.advance(16);
  f.gestures.magnify(1, chain, f.at(60, 70), -0.5, GesturePhase::Changed);
  CHECK(f.bodies.back()["scale"].asDouble() == doctest::Approx(0.75));
  // Ninety degrees anticlockwise on the trackpad is a quarter turn back in UIKit's terms, and the
  // pinch that runs beside it is not cancelled.
  f.gestures.rotate(1, chain, f.at(60, 70), 90, GesturePhase::Changed);
  CHECK(f.has("state 2 2->4"));
  CHECK(f.bodies.back()["rotation"].asDouble() == doctest::Approx(-M_PI / 2));
  CHECK_FALSE(f.has("state 1 4->3"));
  f.gestures.magnify(1, chain, f.at(60, 70), 0, GesturePhase::Ended);
  f.gestures.rotate(1, chain, f.at(60, 70), 0, GesturePhase::Ended);
  CHECK(f.has("state 1 4->5"));
  CHECK(f.has("state 2 4->5"));
}

TEST_CASE("hover activates as the pointer comes over the view and ends as it leaves") {
  Fixture f;
  f.add("HoverGestureHandler", kPan, 2);
  f.gestures.hover(1, f.tree.hitTest(1, {300, 300}), f.at(300, 300));
  CHECK(f.events.empty());
  f.gestures.hover(1, f.tree.hitTest(1, {50, 60}), f.at(50, 60));
  CHECK(f.events == std::vector<std::string>{"state 1 0->2", "state 1 2->4", "update 1"});
  f.gestures.hover(1, f.tree.hitTest(1, {60, 60}), f.at(60, 60));
  CHECK(f.events.back() == "update 1");
  CHECK(f.bodies.back()["x"].asDouble() == doctest::Approx(50));
  f.gestures.hover(1, f.tree.hitTest(1, {300, 300}), f.at(300, 300));
  CHECK(f.events.back() == "state 1 4->5");
  // And again, from the start.
  f.gestures.hover(1, f.tree.hitTest(1, {50, 60}), f.at(50, 60));
  CHECK(f.events.back() == "update 1");
}

TEST_CASE("a pan that asks for the trackpad follows a two-finger scroll as the fingers move") {
  Fixture f;
  f.add("PanGestureHandler", kPan, 2, dynamic::object("enableTrackpadTwoFingerGesture", true));
  f.add("PanGestureHandler", kOther, 4);
  auto chain = f.tree.hitTest(1, {50, 60});
  CHECK_FALSE(f.gestures.scroll(1, chain, f.at(50, 60), {0, 0}, GesturePhase::Began));
  f.clock.advance(16);
  CHECK(f.gestures.scroll(1, chain, f.at(50, 60), {12, 0}, GesturePhase::Changed));
  CHECK(f.has("state 1 2->4"));
  f.clock.advance(16);
  f.gestures.scroll(1, chain, f.at(50, 60), {8, -3}, GesturePhase::Changed);
  CHECK(f.bodies.back()["translationX"].asDouble() == doctest::Approx(8));
  CHECK(f.bodies.back()["translationY"].asDouble() == doctest::Approx(-3));
  f.gestures.scroll(1, chain, f.at(50, 60), {0, 0}, GesturePhase::Ended);
  CHECK(f.events.back() == "state 1 4->5");
  // A pan that did not ask for it never sees a scroll.
  CHECK_FALSE(f.has("state 5 0->2"));
}

TEST_CASE("a dropped handler stops, and a disabled one is not routed to") {
  Fixture f;
  f.add("PanGestureHandler", kPan, 2);
  f.add("TapGestureHandler", kTap, 2);
  f.gestures.configure(kTap, dynamic::object("enabled", false), false);
  f.down(50, 60);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2"});
  f.gestures.drop(kPan);
  f.move(90, 60);
  f.up(90, 60);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2"});
  CHECK(f.gestures.find(kPan) == nullptr);
}

TEST_CASE("a manual handler is moved by its state manager") {
  Fixture f;
  f.add("ManualGestureHandler", kPan, 2, dynamic::object("manualActivation", true));
  f.down(50, 60);
  CHECK(f.events == std::vector<std::string>{"state 1 0->2"});
  f.gestures.setState(kPan, 4);
  CHECK(f.has("state 1 2->4"));
  f.gestures.setState(kPan, 5);
  CHECK(f.events.back() == "state 1 4->5");
}

TEST_CASE("a handler with pointer data sends the touches as they go down, move and go up") {
  Fixture f;
  f.add("ManualGestureHandler", kPan, 2, dynamic::object("needsPointerData", true));
  f.down(50, 60);
  f.move(55, 60);
  f.up(55, 60);
  std::vector<int> types;
  for (const auto &body : f.bodies) {
    if (body.count("eventType")) {
      types.push_back(body["eventType"].asInt());
    }
  }
  CHECK(types == std::vector<int>{1, 2, 3});
  const auto &up = f.bodies.back();
  CHECK(up["numberOfTouches"].asInt() == 0);
  CHECK(up["changedTouches"][0]["x"].asDouble() == doctest::Approx(45));
}

TEST_CASE("the secondary button reaches only a handler that asks for it") {
  Fixture f;
  f.add("TapGestureHandler", kTap, 2);
  f.add("TapGestureHandler", kOther, 4, dynamic::object("mouseButton", 2));
  GesturePointer right = f.at(50, 60);
  right.button = 2;
  f.gestures.pointerDown(1, f.tree.hitTest(1, {50, 60}), right);
  CHECK(f.events.empty());
  right.page = {250, 60};
  f.gestures.pointerDown(1, f.tree.hitTest(1, {250, 60}), right);
  CHECK(f.events == std::vector<std::string>{"state 5 0->2"});
}

TEST_CASE("a tap that ended while it waited for a pan is cancelled when the pan ends") {
  Fixture f;
  // (Tags: the tap is 1 and the pan 2.) The tap is first, so it sees the release first: it ends, and waits for the pan, which runs
  // beside it and is still active; the pan's end then cancels it.
  f.add("TapGestureHandler", kPan, 2, dynamic::object("maxDist", 100),
        dynamic::object("waitFor", dynamic::array(kTap))("simultaneousHandlers", dynamic::array(kTap)));
  f.add("PanGestureHandler", kTap, 2);
  f.down(50, 60);
  f.move(65, 60);
  CHECK(f.has("state 2 2->4"));
  f.up(65, 60);
  CHECK(f.has("state 2 4->5"));
  CHECK(f.has("state 1 2->3"));
  CHECK_FALSE(f.has("state 1 4->5"));
}
