#include "ngn/input-script.h"

#include <doctest/doctest.h>

using Kind = ngn::InputStep::Kind;

TEST_CASE("an input script reads each step, skipping comments and blank lines") {
  auto script = ngn::parseInputScript(R"(
    # a swipe, then a pinch
    wait 500
    move 10 20
    down 10 20   # pressed
    drag 40.5 20
    up 40.5 20

    scroll 100 200 -3 0 began
    scroll 100 200 -3 1
    magnify 50 60 0.25 changed
    rotate 50 60 15 ended
  )");
  REQUIRE_FALSE(script.error);
  REQUIRE(script.steps.size() == 9);
  CHECK(script.steps[0].kind == Kind::Wait);
  CHECK(script.steps[0].amount == 500);
  CHECK(script.steps[2].kind == Kind::Down);
  CHECK(script.steps[3].x == doctest::Approx(40.5));
  CHECK(script.steps[5].kind == Kind::Scroll);
  CHECK(script.steps[5].amount == -3);
  CHECK(script.steps[5].phase == ngn::GesturePhase::Began);
  CHECK_FALSE(script.steps[6].phase);
  CHECK(script.steps[6].dy == 1);
  CHECK(script.steps[7].kind == Kind::Magnify);
  CHECK(script.steps[7].amount == doctest::Approx(0.25));
  CHECK(script.steps[8].phase == ngn::GesturePhase::Ended);
}

TEST_CASE("an input script with a bad line plays nothing and names the line") {
  CHECK(ngn::parseInputScript("wait 10\nclick 1 2").error == "line 2: unknown step click");
  CHECK(ngn::parseInputScript("down 1").error == "line 1: down needs x and y");
  CHECK(ngn::parseInputScript("magnify 1 2 0.5").error == "line 1: magnify needs x, y, an amount and a phase");
  CHECK(ngn::parseInputScript("scroll 1 2 3 4 sideways").error == "line 1: unknown phase sideways");
  CHECK(ngn::parseInputScript("up 1 2 3").error == "line 1: unexpected 3");
  CHECK(ngn::parseInputScript("wait -1").steps.empty());
}
