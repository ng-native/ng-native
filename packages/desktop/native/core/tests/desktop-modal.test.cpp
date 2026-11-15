#include "ngn/desktop-modal.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::SheetNode;

TEST_CASE("a sheet or popover sized by a child's definite size keeps the padding around that child") {
  // A wrapper that fills the modal, with 20 points of padding, holding one 400x300 child.
  auto child = SheetNode{.frame = {{20, 20}, {400, 300}}, .width = 400, .height = 300};
  auto wrapper = SheetNode{.frame = {{0, 0}, {1000, 700}}, .children = {child}};
  wrapper.insets = {.left = 20, .top = 20, .right = 20, .bottom = 20};
  auto modal = SheetNode{.frame = {{0, 0}, {1000, 700}}, .children = {wrapper}};
  CHECK(ngn::sheetSize(modal, {1200, 800}) == Size{440, 340});
  CHECK(ngn::popoverSize(modal, {1200, 800}) == Size{440, 340});
  // Without padding, the child's own size.
  wrapper.insets = {};
  wrapper.children[0].frame.origin = {0, 0};
  CHECK(ngn::sheetSize(SheetNode{.frame = modal.frame, .children = {wrapper}}, {1200, 800}) == Size{400, 300});
}
