#include "ngn/desktop-view-props.h"

#include <doctest/doctest.h>

using namespace facebook::react;

namespace {

struct Parser {
  std::shared_ptr<const ContextContainer> context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};

  Props::Shared clone(const Props::Shared &props, folly::dynamic raw) {
    return descriptor.cloneProps(parserContext, props, RawProps(std::move(raw)));
  }
};

} // namespace

TEST_CASE("focusable and tabIndex are parsed from a View's props") {
  Parser p;
  auto props = p.clone(nullptr, folly::dynamic::object("focusable", true)("tabIndex", 2)("opacity", 0.5));
  CHECK(ngn::desktopProps(*props) == ngn::DesktopProps{true, 2});
  // Every other View prop still parses as React Native's ViewProps does.
  CHECK(static_cast<const ViewProps &>(*props).opacity == doctest::Approx(0.5));
}

TEST_CASE("an update keeps what it does not mention and resets what it sets to null") {
  Parser p;
  auto first = p.clone(nullptr, folly::dynamic::object("focusable", true)("tabIndex", 2));
  auto second = p.clone(first, folly::dynamic::object("tabIndex", 5));
  CHECK(ngn::desktopProps(*second) == ngn::DesktopProps{true, 5});

  auto third = p.clone(second, folly::dynamic::object("tabIndex", nullptr)("focusable", false));
  CHECK(ngn::desktopProps(*third) == ngn::DesktopProps{false, std::nullopt});

  auto fourth = p.clone(third, folly::dynamic::object("focusable", nullptr));
  CHECK(ngn::desktopProps(*fourth) == ngn::DesktopProps{});
}

TEST_CASE("a negative tabIndex is kept, to leave a view out of Tab order") {
  Parser p;
  auto props = p.clone(nullptr, folly::dynamic::object("tabIndex", -1));
  CHECK(ngn::desktopProps(*props).tabIndex == -1);
}

TEST_CASE("props that are not a desktop View's have the defaults") {
  Parser p;
  CHECK(ngn::desktopProps(ViewProps{}) == ngn::DesktopProps{});
  // Fabric's shortcut for a node created with no props at all.
  auto empty = p.clone(nullptr, folly::dynamic::object());
  CHECK(ngn::desktopProps(*empty) == ngn::DesktopProps{});
}

TEST_CASE("the descriptor is React Native's View in every other way") {
  Parser p;
  CHECK(std::string(p.descriptor.getComponentName()) == "View");
  CHECK(p.descriptor.getComponentHandle() == ViewShadowNode::Handle());
}
