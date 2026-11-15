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

// A content-sized view with 20 points of padding all round.
SheetNode padded(Rect frame, std::vector<SheetNode> children) {
  auto out = node(frame, {}, {}, std::move(children));
  out.insets = {.left = 20, .top = 20, .right = 20, .bottom = 20};
  return out;
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

TEST_CASE("a modal inside and a presented screen's header config take no room in a sheet") {
  CHECK_FALSE(ngn::takesRoomInSheet("ModalHostView"));
  CHECK_FALSE(ngn::takesRoomInSheet("RNSScreenStackHeaderConfig"));
  CHECK(ngn::takesRoomInSheet("View"));
  CHECK(ngn::takesRoomInSheet("RNSScreenStack"));
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

TEST_CASE("a content-sized root keeps its padding once the sheet is its size") {
  // Once the sheet takes the column's height, the column fills the container and is passed
  // through: its bottom padding still counts, or the sheet would shrink and grow every commit.
  auto column = padded({{0, 0}, {480, 260}}, {node({{20, 20}, {440, 100}}), node({{20, 120}, {440, 120}})});
  CHECK(ngn::sheetSize(modal({column}, {480, 260}), {1200, 800}) == Size{ngn::kDefaultSheetWidth, 260});
}

TEST_CASE("a popover takes its root's definite size, or its content's extent with its padding") {
  // A presented screen as it first lays out, at the most a popover measures against, holding a
  // root 200 by 90 with padding.
  auto root = padded({{0, 0}, {200, 90}}, {node({{20, 20}, {40, 17}}), node({{20, 43}, {40, 17}})});
  root.width = 200;
  root.height = 90;
  auto screen = [](SheetNode content, Size laidOut) { return node({{0, 0}, laidOut}, {}, {}, {std::move(content)}); };
  CHECK(ngn::popoverSize(screen(root, {640, 640}), {900, 600}) == Size{200, 90});
  // Laid out at that size, the root fills the screen; it is still what the popover is sized by.
  CHECK(ngn::popoverSize(screen(root, {200, 90}), {900, 600}) == Size{200, 90});

  // A content-sized root: its children's extent and its padding, the same at either size.
  auto loose = padded({{0, 0}, {100, 77}}, {node({{20, 20}, {60, 17}}), node({{20, 40}, {40, 17}})});
  CHECK(ngn::popoverSize(screen(loose, {640, 640}), {900, 600}) == Size{100, 77});
  loose.frame.size = {100, 77};
  CHECK(ngn::popoverSize(screen(loose, {100, 77}), {900, 600}) == Size{100, 77});

  // Never past the window, nor the most a popover measures against.
  auto huge = node({{0, 0}, {2000, 1500}}, 2000, 1500);
  CHECK(ngn::popoverSize(screen(huge, {640, 640}), {900, 600}) == Size{640, 600});
  // Nothing laid out yet: no size.
  CHECK(ngn::popoverSize(node({{0, 0}, {640, 640}}), {900, 600}) == Size{0, 0});
}
