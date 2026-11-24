#include "ngn/testing-capture.h"

#include <doctest/doctest.h>

#include <optional>
#include <string>

using folly::dynamic;

namespace {

// Answers with what it was asked for, so the test sees what reached it, or with an error.
struct FakeCapture final : ngn::WindowCapture {
  std::optional<Region> region;
  int64_t tag{-1};
  std::string error;
  void capture(std::optional<Region> asked, Done done) override {
    region = asked;
    done(error.empty() ? "png" : "", error);
  }
  void captureView(int64_t asked, Done done) override {
    tag = asked;
    done(error.empty() ? "view" : "", error);
  }
};

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

Answer ask(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  Answer answer;
  module.callWithPromise(
      method, args, {.resolve = [&](dynamic v) { answer.value = v; }, .reject = [&](const std::string &e) { answer.error = e; }});
  return answer;
}

} // namespace

TEST_CASE("NgNativeTesting captures the window, a region of it in points, or a view, as base64 PNG") {
  auto capture = std::make_shared<FakeCapture>();
  auto module = ngn::makeTestingModule(capture);
  CHECK(module->name() == "NgNativeTesting");

  CHECK(ask(*module, "capture", dynamic::array(nullptr)).value == dynamic("cG5n"));
  CHECK_FALSE(capture->region);

  dynamic region = dynamic::object("x", 10)("y", 20.5)("width", 30)("height", 40);
  CHECK(ask(*module, "capture", dynamic::array(region)).value == dynamic("cG5n"));
  REQUIRE(capture->region);
  CHECK(capture->region->x == 10);
  CHECK(capture->region->y == 20.5);
  CHECK(capture->region->width == 30);
  CHECK(capture->region->height == 40);

  CHECK(ask(*module, "captureView", dynamic::array(42)).value == dynamic("dmlldw=="));
  CHECK(capture->tag == 42);
}

TEST_CASE("NgNativeTesting rejects with the host's reason, and a captureView with no tag") {
  auto capture = std::make_shared<FakeCapture>();
  capture->error = "The app has no window to capture";
  auto module = ngn::makeTestingModule(capture);
  CHECK(ask(*module, "capture", dynamic::array(nullptr)).error == std::string("The app has no window to capture"));
  CHECK(ask(*module, "captureView", dynamic::array()).error == std::string("captureView needs a view's tag"));
}
