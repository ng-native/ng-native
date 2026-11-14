#include "ngn/desktop-modal.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::ModalPresentation;

namespace {

ModalPresentation presentation(dynamic raw) {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::DesktopModalComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  return ngn::desktopProps(*descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)))).presentation;
}

using ngn::SheetNode;

SheetNode node(Rect frame, std::optional<Float> width = {}, std::optional<Float> height = {},
               std::vector<SheetNode> children = {}) {
  return SheetNode{.frame = frame, .width = width, .height = height, .children = std::move(children)};
}

// A <modal> as it lays out at `laidOut`: the ModalHostView, its full-bleed container and the app's
// content under that.
SheetNode modal(std::vector<SheetNode> content, Size laidOut = {1000, 700}) {
  return node({{0, 0}, laidOut}, {}, {}, {node({{0, 0}, laidOut}, {}, {}, std::move(content))});
}

} // namespace

TEST_CASE("a modal is a sheet unless it is full screen or transparent, and a popover with an anchor") {
  CHECK(presentation(dynamic::object()) == ModalPresentation::Sheet);
  CHECK(presentation(dynamic::object("presentationStyle", "pageSheet")) == ModalPresentation::Sheet);
  CHECK(presentation(dynamic::object("presentationStyle", "formSheet")) == ModalPresentation::Sheet);
  CHECK(presentation(dynamic::object("presentationStyle", "fullScreen")) == ModalPresentation::Cover);
  CHECK(presentation(dynamic::object("presentationStyle", "overFullScreen")) == ModalPresentation::Cover);
  CHECK(presentation(dynamic::object("transparent", true)) == ModalPresentation::Cover);
  CHECK(presentation(dynamic::object("anchor", 7)("presentationStyle", "fullScreen")) == ModalPresentation::Popover);
}

TEST_CASE("a sheet takes its root's definite CSS size") {
  CHECK(ngn::sheetSize(modal({node({{0, 0}, {400, 300}}, 400, 300)}), {1200, 800}) == Size{400, 300});
}

TEST_CASE("the definite size is read from the shadow node's Yoga style") {
  static auto context = std::make_shared<const ContextContainer>();
  static ngn::DesktopViewComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto props = descriptor.cloneProps(parserContext, nullptr, RawProps(dynamic::object("width", 420)("height", 260)));
  auto family = descriptor.createFamily({.tag = 12, .surfaceId = 1, .instanceHandle = nullptr});
  auto shadow = descriptor.createShadowNode({.props = props}, family);
  auto read = ngn::sheetNode(*shadow);
  CHECK(read.width == 420);
  CHECK(read.height == 260);
  auto unsized = descriptor.createShadowNode(
      {.props = descriptor.cloneProps(parserContext, nullptr, RawProps(dynamic::object("padding", 4)))}, family);
  CHECK_FALSE(ngn::sheetNode(*unsized).width);

  // A modal inside (a sheet on this sheet) is not part of its content.
  static ngn::DesktopModalComponentDescriptor modals{{{}, context, nullptr}};
  auto innerProps = modals.cloneProps(parserContext, nullptr, RawProps(dynamic::object()));
  auto innerFamily = modals.createFamily({.tag = 14, .surfaceId = 1, .instanceHandle = nullptr});
  auto inner = modals.createShadowNode(
      {.props = innerProps, .state = modals.createInitialState(innerProps, innerFamily)}, innerFamily);
  auto withInner = descriptor.createShadowNode(
      {.props = props,
       .children = std::make_shared<const std::vector<std::shared_ptr<const ShadowNode>>>(std::vector<std::shared_ptr<const ShadowNode>>{shadow, inner})},
      descriptor.createFamily({.tag = 13, .surfaceId = 1, .instanceHandle = nullptr}));
  CHECK(ngn::sheetNode(*withInner).children.size() == 1);
}

TEST_CASE("a content-sized root gives the default width and the height its content laid out to") {
  // A column stretched across the container, as tall as its two rows and its padding.
  auto column = node({{0, 0}, {1000, 260}}, {}, {}, {node({{20, 20}, {960, 100}}), node({{20, 120}, {960, 120}})});
  CHECK(ngn::sheetSize(modal({column}), {1200, 800}) == Size{ngn::kDefaultSheetWidth, 260});

  // A root that fills the container (flex: 1) is passed through to what is in it.
  auto filling = node({{0, 0}, {1000, 700}}, {}, {}, {node({{0, 0}, {1000, 180}})});
  CHECK(ngn::sheetSize(modal({filling}), {1200, 800}) == Size{ngn::kDefaultSheetWidth, 200});

  // A definite width alone keeps the measured height.
  CHECK(ngn::sheetSize(modal({node({{0, 0}, {360, 240}}, 360)}), {1200, 800}) == Size{360, 240});
}

TEST_CASE("a sheet stays between 320x200 and the window") {
  CHECK(ngn::sheetSize(modal({node({{0, 0}, {2000, 1500}}, 2000, 1500)}), {900, 600}) == Size{900, 600});
  auto small = modal({node({{0, 0}, {100, 40}}, 100, 40)});
  CHECK(ngn::sheetSize(small, {900, 600}) == Size{320, 200});
  // A window smaller than the minimum still gets the minimum.
  CHECK(ngn::sheetSize(small, {300, 150}) == Size{320, 200});
  // An empty modal, before its content commits.
  CHECK(ngn::sheetSize(modal({}), {900, 600}) == Size{ngn::kDefaultSheetWidth, 200});
}
