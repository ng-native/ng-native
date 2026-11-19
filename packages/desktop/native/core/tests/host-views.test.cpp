#include "fake-backend.h"
#include "helpers.h"
#include "ngn/host-views.h"
#include "ngn/worklet-host.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <string>
#include <vector>

using namespace facebook::react;
using ngn::testing::shadowView;
using ngn::testing::viewProps;

namespace {

// The worklet host is the process's: what a test sets on it goes as the test ends.
struct WorkletHostReset {
  ~WorkletHostReset() {
    ngn::workletHost().reanimatedEvent.set(nullptr);
    ngn::workletHost().setGestureState = nullptr;
  }
};

} // namespace

TEST_CASE("makeHostViews feeds the input to the recognisers, which reach Reanimated through the worklet host both ways") {
  auto backend = std::make_shared<ngn::testing::FakeBackend>();
  auto views = ngn::makeHostViews(backend, backend, nullptr);
  // Declared after the views, so the recognisers it holds go before the tree they read.
  WorkletHostReset reset;
  REQUIRE(views.mounting);
  REQUIRE(views.input);
  REQUIRE(views.gestures);

  auto &tree = views.mounting->tree();
  tree.create(shadowView(1, "RootView", {{0, 0}, {400, 300}}));
  tree.create(shadowView(2, "View", {{10, 10}, {100, 100}}, viewProps(PointerEventsMode::Auto, true)));
  tree.insert(1, 2, 0);
  views.input->addContainer(0, 1, 1);

  std::vector<std::string> reanimated;
  ngn::workletHost().reanimatedEvent.set([&reanimated](const std::string &name, Tag view, const folly::dynamic &body) {
    if (body.count("oldState")) {
      reanimated.push_back(name + " " + std::to_string(body["oldState"].asInt()) + "->" + std::to_string(body["state"].asInt()));
    } else {
      reanimated.push_back(name);
    }
  });
  folly::dynamic config = folly::dynamic::object("manualActivation", true);
  views.gestures->create("ManualGestureHandler", 7, config);
  views.gestures->attach(7, 2, ngn::GestureAction::ReanimatedWorklet);
  views.gestures->configure(7, config, true);

  // A press through the input dispatcher begins the worklet's handler, told to Reanimated.
  ngn::PointerInput press;
  press.point = {30, 30};
  press.buttons = 1;
  views.input->pointerDown(press);
  CHECK(reanimated == std::vector<std::string>{"onGestureHandlerStateChange 0->2"});

  // Its state manager, on the worklet host, activates it.
  REQUIRE(ngn::workletHost().setGestureState);
  ngn::workletHost().setGestureState(7, 4);
  CHECK(std::find(reanimated.begin(), reanimated.end(), "onGestureHandlerStateChange 2->4") != reanimated.end());
}
