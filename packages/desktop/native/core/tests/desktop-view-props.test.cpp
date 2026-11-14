#include "ngn/desktop-modal.h"
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

TEST_CASE("a modal's anchor is parsed and reported, and goes again when unset") {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopModalComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto anchored = descriptor.cloneProps(parserContext, nullptr, RawProps(folly::dynamic::object("anchor", 42)("transparent", true)));
  CHECK(ngn::desktopProps(*anchored).anchor == 42);
  // A modal's props are still a View's, for the hit test.
  CHECK(dynamic_cast<const ViewProps *>(anchored.get()) != nullptr);
  auto unset = descriptor.cloneProps(parserContext, anchored, RawProps(folly::dynamic::object("anchor", nullptr)));
  CHECK_FALSE(ngn::desktopProps(*unset).anchor);
  // Still transparent: a cover.
  CHECK(ngn::desktopProps(*unset).presentation == ngn::ModalPresentation::Cover);
  CHECK(descriptor.getComponentName() == std::string("ModalHostView"));
}

TEST_CASE("the cursor and the element event opt-ins are parsed from a View's props") {
  Parser p;
  auto props = p.clone(
      nullptr,
      folly::dynamic::object("desktopCursor", "not-allowed")("cursor", "auto")("onDoubleClick", true)(
          "onContextMenu", true)("onWheel", true));
  auto desktop = ngn::desktopProps(*props);
  CHECK(desktop.cursor == Cursor::NotAllowed);
  CHECK(desktop.onDoubleClick);
  CHECK(desktop.onContextMenu);
  CHECK(desktop.onWheel);

  auto unset = ngn::desktopProps(*p.clone(props, folly::dynamic::object("desktopCursor", nullptr)("onWheel", nullptr)));
  CHECK_FALSE(unset.cursor.has_value());
  CHECK_FALSE(unset.onWheel);
  CHECK(unset.onDoubleClick);
}

TEST_CASE("a scroll view's props carry the scroll bar properties, and are still a scroll view's") {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopScrollViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto props = descriptor.cloneProps(
      parserContext,
      nullptr,
      RawProps(folly::dynamic::object("scrollbarWidth", "thin")("scrollbarGutter", "stable")("scrollEnabled", false)));
  CHECK(ngn::desktopProps(*props).scrollbarWidth == ngn::ScrollbarWidth::Thin);
  CHECK(ngn::desktopProps(*props).scrollbarGutter == ngn::ScrollbarGutter::Stable);
  CHECK_FALSE(static_cast<const ScrollViewProps &>(*props).scrollEnabled);

  auto none = descriptor.cloneProps(parserContext, props, RawProps(folly::dynamic::object("scrollbarWidth", "none")));
  CHECK(ngn::desktopProps(*none).scrollbarWidth == ngn::ScrollbarWidth::None);
  CHECK(ngn::desktopProps(*none).scrollbarGutter == ngn::ScrollbarGutter::Stable);

  auto reset = descriptor.cloneProps(
      parserContext, none, RawProps(folly::dynamic::object("scrollbarWidth", nullptr)("scrollbarGutter", "auto")));
  CHECK(ngn::desktopProps(*reset) == ngn::DesktopProps{});
  CHECK(descriptor.getComponentName() == std::string("ScrollView"));
}

TEST_CASE("a view with desktop props is mounted with its children under it, not flattened away") {
  Parser p;
  auto traitsOf = [&](const folly::dynamic &raw) {
    auto props = p.clone(nullptr, raw);
    auto family = p.descriptor.createFamily({.tag = 7, .surfaceId = 1, .instanceHandle = nullptr});
    auto node = p.descriptor.createShadowNode(ShadowNodeFragment{.props = props}, family);
    return node->getTraits();
  };
  // A box with a background is a view, but Fabric mounts its children beside it.
  auto plain = traitsOf(folly::dynamic::object("backgroundColor", 0xff0000ff));
  CHECK(plain.check(ShadowNodeTraits::Trait::FormsView));
  CHECK_FALSE(plain.check(ShadowNodeTraits::Trait::FormsStackingContext));

  std::vector<folly::dynamic> asking{
      folly::dynamic::object("desktopCursor", "grab"),
      folly::dynamic::object("onDoubleClick", true),
      folly::dynamic::object("onContextMenu", true),
      folly::dynamic::object("onWheel", true),
      folly::dynamic::object("tabIndex", 0),
  };
  for (const auto &raw : asking) {
    CHECK(traitsOf(raw).check(ShadowNodeTraits::Trait::FormsStackingContext));
  }
  CHECK(traitsOf(folly::dynamic::object("focusable", true)).check(ShadowNodeTraits::Trait::KeyboardFocusable));
  CHECK_FALSE(traitsOf(folly::dynamic::object("tabIndex", -1)).check(ShadowNodeTraits::Trait::KeyboardFocusable));
}
