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

TEST_CASE("a sheet, cover or popover is named by its own accessibility label, else by its title") {
  // A label of its own wins over a title, and changes with it.
  CHECK(ngn::presentationLabel("Filters panel", "Filters") == "Filters panel");
  CHECK(ngn::presentationLabel("Search options", "Filters") == "Search options");
  // With the label gone, the title names it, and a new title renames it.
  CHECK(ngn::presentationLabel("", "Filters") == "Filters");
  CHECK(ngn::presentationLabel("", "Renamed filters") == "Renamed filters");
  // A label with no title (a <modal>) is still the name; with neither there is none.
  CHECK(ngn::presentationLabel("Labelled modal", "") == "Labelled modal");
  CHECK(ngn::presentationLabel("", "").empty());
}
