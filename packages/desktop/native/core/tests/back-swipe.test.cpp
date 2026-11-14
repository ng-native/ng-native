#include "fake-backend.h"
#include "helpers.h"
#include "ngn/back-swipe.h"
#include "ngn/mounting-manager.h"
#include "ngn/screen-presentation.h"

#include <doctest/doctest.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;
using ngn::BackSwipe;
using ngn::BackSwipeFrame;
using ngn::BackSwipeTarget;
using ngn::SwipeStyle;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

struct ScreenOptions {
  std::string presentation{"push"};
  bool gestureEnabled{true};
  std::string animation{"default"};
};

ShadowView screen(Tag tag, ScreenOptions options = {}) {
  auto props = std::make_shared<ngn::ScreenProps>();
  props->stackPresentation = options.presentation;
  props->gestureEnabled = options.gestureEnabled;
  props->stackAnimation = options.animation;
  return shadowView(tag, "RNSScreen", {{0, 0}, {400, 300}}, props);
}

struct Fixture {
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(backend, backend);

  Fixture() {
    mount(stack(2, 1, 0));
  }

  void mount(ShadowViewMutationList mutations) {
    mounting->executeMount(1, MountingTransaction(1, 1, std::move(mutations), {}));
    backend->drain();
  }

  static ShadowViewMutationList stack(Tag tag, Tag parent, int index) {
    auto view = shadowView(tag, "RNSScreenStack", {{0, 0}, {400, 300}});
    return {ShadowViewMutation::CreateMutation(view), ShadowViewMutation::InsertMutation(parent, view, index)};
  }

  static ShadowViewMutationList add(const ShadowView &view, Tag parent, int index) {
    return {ShadowViewMutation::CreateMutation(view), ShadowViewMutation::InsertMutation(parent, view, index)};
  }

  std::optional<BackSwipeTarget> target() const {
    return mounting->backSwipeTarget(1);
  }
};

} // namespace

TEST_CASE("a back swipe moves the stack's top screen over the one below it, and needs one below") {
  Fixture f;
  f.mount(Fixture::add(screen(10), 2, 0));
  CHECK_FALSE(f.target());

  f.mount(Fixture::add(screen(20), 2, 1));
  CHECK(f.target() == BackSwipeTarget{.stack = 2, .top = 20, .below = 10, .style = SwipeStyle::Slide});
  CHECK(f.mounting->stackTop(2) == 20);

  f.mount(Fixture::add(screen(30), 2, 2));
  CHECK(f.target() == BackSwipeTarget{.stack = 2, .top = 30, .below = 20});
}

TEST_CASE("a back swipe honours gestureEnabled and stackAnimation, and leaves a presented screen be") {
  SUBCASE("gestureEnabled: false has no swipe") {
    Fixture f;
    f.mount(Fixture::add(screen(10), 2, 0));
    f.mount(Fixture::add(screen(20, {.gestureEnabled = false}), 2, 1));
    CHECK_FALSE(f.target());
  }
  SUBCASE("stackAnimation none has no swipe, and fade fades") {
    Fixture f;
    f.mount(Fixture::add(screen(10), 2, 0));
    f.mount(Fixture::add(screen(20, {.animation = "none"}), 2, 1));
    CHECK_FALSE(f.target());
    f.mount(Fixture::add(screen(30, {.animation = "fade"}), 2, 2));
    CHECK(f.target() == BackSwipeTarget{.stack = 2, .top = 30, .below = 20, .style = SwipeStyle::Fade});
  }
  SUBCASE("a sheet or a cover over the stack stops it") {
    Fixture f;
    f.mount(Fixture::add(screen(10), 2, 0));
    f.mount(Fixture::add(screen(20), 2, 1));
    f.mount(Fixture::add(screen(30, {.presentation = "formSheet"}), 2, 2));
    CHECK_FALSE(f.target());
  }
}

TEST_CASE("the innermost stack that can go back is swiped, and not one under a covered screen") {
  Fixture f;
  f.mount(Fixture::add(screen(10), 2, 0));
  f.mount(Fixture::add(screen(20), 2, 1));
  // A stack inside the top screen with one screen: nothing to go back to in it, so the outer moves.
  f.mount(Fixture::stack(40, 20, 0));
  f.mount(Fixture::add(screen(50), 40, 0));
  CHECK(f.target() == BackSwipeTarget{.stack = 2, .top = 20, .below = 10});

  // With two, the inner one moves.
  f.mount(Fixture::add(screen(60), 40, 1));
  CHECK(f.target() == BackSwipeTarget{.stack = 40, .top = 60, .below = 50});

  // A stack under a covered screen is not in front.
  f.mount(Fixture::stack(70, 10, 0));
  f.mount(Fixture::add(screen(80), 70, 0));
  f.mount(Fixture::add(screen(90), 70, 1));
  CHECK(f.target() == BackSwipeTarget{.stack = 40, .top = 60, .below = 50});
}

TEST_CASE("the screen in front follows the fingers, and a swipe released early goes home") {
  BackSwipe swipe;
  CHECK_FALSE(swipe.begin(std::nullopt, 400));
  REQUIRE(swipe.begin(BackSwipeTarget{.stack = 2, .top = 20, .below = 10}, 400));
  CHECK_FALSE(swipe.begin(BackSwipeTarget{.stack = 2, .top = 20, .below = 10}, 400));

  CHECK(swipe.moved(40) == BackSwipeFrame{.offset = 40, .opacity = 1, .belowShown = true});
  CHECK(swipe.moved(30) == BackSwipeFrame{.offset = 70, .opacity = 1, .belowShown = true});
  // It stops at its home edge, and the screen below hides again there.
  CHECK(swipe.moved(-200) == BackSwipeFrame{.offset = 0, .opacity = 1, .belowShown = false});
  swipe.moved(60);
  swipe.moved(-2);

  // A tenth of the way and not flicked: it goes home.
  CHECK_FALSE(swipe.lifted());
  CHECK(swipe.phase() == BackSwipe::Phase::Returning);
  CHECK(swipe.settled() == BackSwipeFrame{.offset = 0, .opacity = 1, .belowShown = true});
  // A mount does not end a return; the animation does.
  CHECK_FALSE(swipe.mounted(10));
  swipe.returned();
  CHECK(swipe.phase() == BackSwipe::Phase::Idle);
  CHECK(swipe.moved(10) == BackSwipe::rest());
}

TEST_CASE("a swipe past a third, or flicked past a tenth, goes back and stays away until the stack's top changes") {
  BackSwipe swipe;
  swipe.begin(BackSwipeTarget{.stack = 2, .top = 20, .below = 10}, 300);
  swipe.moved(100);
  CHECK(swipe.lifted());
  CHECK(swipe.settled() == BackSwipeFrame{.offset = 300, .opacity = 1, .belowShown = true});
  // The commit that has not popped yet changes nothing.
  CHECK_FALSE(swipe.mounted(20));
  CHECK(swipe.phase() == BackSwipe::Phase::Leaving);
  CHECK(swipe.mounted(10));
  CHECK(swipe.phase() == BackSwipe::Phase::Idle);

  swipe.begin(BackSwipeTarget{.stack = 2, .top = 20, .below = 10}, 300);
  swipe.moved(25);
  swipe.moved(BackSwipe::kFlick);
  CHECK(swipe.lifted());

  // A scroll the OS cancelled returns, however far it went.
  swipe.abandon();
  swipe.begin(BackSwipeTarget{.stack = 2, .top = 20, .below = 10}, 300);
  swipe.moved(250);
  CHECK_FALSE(swipe.lifted(true));
  CHECK(swipe.phase() == BackSwipe::Phase::Returning);

  // A back the app refused leaves the swipe to be abandoned.
  swipe.abandon();
  CHECK(swipe.phase() == BackSwipe::Phase::Idle);
  CHECK_FALSE(swipe.target());
}

TEST_CASE("a fading screen fades in place as the fingers move") {
  BackSwipe swipe;
  swipe.begin(BackSwipeTarget{.stack = 2, .top = 20, .below = 10, .style = SwipeStyle::Fade}, 400);
  CHECK(swipe.moved(100) == BackSwipeFrame{.offset = 0, .opacity = 0.75, .belowShown = true});
  // Held still before lifting: not a flick, and short of a third.
  swipe.moved(-1);
  CHECK_FALSE(swipe.lifted());
  CHECK(swipe.settled() == BackSwipeFrame{.offset = 0, .opacity = 1, .belowShown = true});
  swipe.returned();
  swipe.begin(BackSwipeTarget{.stack = 2, .top = 20, .below = 10, .style = SwipeStyle::Fade}, 400);
  swipe.moved(200);
  CHECK(swipe.lifted());
  CHECK(swipe.settled() == BackSwipeFrame{.offset = 0, .opacity = 0, .belowShown = true});
}

TEST_CASE("a swipe tracker opens only the ways the window's history can go") {
  CHECK(ngn::swipeBounds(true, true) == ngn::SwipeBounds{.min = -1, .max = 1});
  CHECK(ngn::swipeBounds(true, false) == ngn::SwipeBounds{.min = 0, .max = 1});
  CHECK(ngn::swipeBounds(false, true) == ngn::SwipeBounds{.min = -1, .max = 0});
  CHECK(ngn::swipeBounds(false, false) == ngn::SwipeBounds{});
}

TEST_CASE("a screen's gestureEnabled and stackAnimation are read from what the router commits") {
  static auto context = std::make_shared<const ContextContainer>();
  PropsParserContext parserContext{1, *context};
  RawPropsParser parser;
  parser.prepare<ngn::ScreenProps>();
  RawProps raw(folly::dynamic::object("gestureEnabled", false)("stackAnimation", "fade"));
  raw.parse(parser);
  ngn::ScreenProps empty;
  ngn::ScreenProps props(parserContext, empty, raw);
  CHECK_FALSE(props.gestureEnabled);
  CHECK(props.stackAnimation == "fade");
  CHECK(empty.gestureEnabled);
  CHECK(empty.stackAnimation == "default");
}
