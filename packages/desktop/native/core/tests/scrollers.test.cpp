#include "ngn/desktop-view-props.h"
#include "ngn/scrollers.h"

#include <doctest/doctest.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>

using namespace facebook::react;
namespace yoga = facebook::yoga;

namespace {

ngn::DesktopProps scrollbars(ngn::ScrollbarWidth width, ngn::ScrollbarGutter gutter = ngn::ScrollbarGutter::Auto) {
  ngn::DesktopProps props;
  props.scrollbarWidth = width;
  props.scrollbarGutter = gutter;
  return props;
}

float padding(const yoga::Style &style, yoga::Edge edge) {
  auto length = style.padding(edge);
  return length.isPoints() ? length.value().unwrap() : -1;
}

// A scroll view 200 by 300 with one child View that stretches across it.
struct ScrollTree {
  std::shared_ptr<const ContextContainer> context = std::make_shared<const ContextContainer>();
  ngn::DesktopScrollViewComponentDescriptor scrollDescriptor{{{}, context, nullptr}};
  ngn::DesktopViewComponentDescriptor viewDescriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  Tag tag;
  std::shared_ptr<ShadowNode> scroll;

  explicit ScrollTree(Tag tag, folly::dynamic scrollProps = folly::dynamic::object()) : tag(tag) {
    auto childFamily = viewDescriptor.createFamily({.tag = tag + 1, .surfaceId = 1, .instanceHandle = nullptr});
    auto child = viewDescriptor.createShadowNode(
        ShadowNodeFragment{
            .props = viewDescriptor.cloneProps(parserContext, nullptr, RawProps(folly::dynamic::object("height", 50)))},
        childFamily);
    auto family = scrollDescriptor.createFamily({.tag = tag, .surfaceId = 1, .instanceHandle = nullptr});
    auto props = scrollDescriptor.cloneProps(parserContext, nullptr, RawProps(std::move(scrollProps)));
    scroll = scrollDescriptor.createShadowNode(
        ShadowNodeFragment{
            .props = props,
            .children = std::make_shared<const std::vector<std::shared_ptr<const ShadowNode>>>(std::vector<std::shared_ptr<const ShadowNode>>{child}),
            .state = scrollDescriptor.createInitialState(props, family)},
        family);
  }

  // A clone, as a state update makes one, laid out; the width of its child.
  float childWidth() {
    scroll = scroll->clone({});
    auto &layoutable = dynamic_cast<LayoutableShadowNode &>(*scroll);
    layoutable.layoutTree(LayoutContext{}, LayoutConstraints{.minimumSize = {200, 300}, .maximumSize = {200, 300}});
    const auto &child = dynamic_cast<const LayoutableShadowNode &>(*scroll->getChildren().front());
    return child.getLayoutMetrics().frame.size.width;
  }
};

} // namespace

TEST_CASE("a scroller shows along an axis the content overflows, or for a stable gutter") {
  ngn::DesktopProps plain;
  auto fits = ngn::scrollerVisibility(plain, true, true, {100, 100}, {200, 300});
  CHECK(fits == ngn::ScrollerVisibility{false, false, true});
  auto tall = ngn::scrollerVisibility(plain, true, true, {200, 900}, {200, 300});
  CHECK(tall == ngn::ScrollerVisibility{true, false, true});
  auto wide = ngn::scrollerVisibility(plain, true, true, {900, 100}, {200, 300});
  CHECK(wide == ngn::ScrollerVisibility{false, true, true});
  // The indicators turned off, or `scrollbar-width: none`.
  CHECK_FALSE(ngn::scrollerVisibility(plain, false, true, {200, 900}, {200, 300}).vertical);
  CHECK_FALSE(ngn::scrollerVisibility(scrollbars(ngn::ScrollbarWidth::None), true, true, {900, 900}, {200, 300}).vertical);
  // `scrollbar-gutter: stable` keeps the vertical one, and AppKit never hides it.
  auto stable = ngn::scrollerVisibility(
      scrollbars(ngn::ScrollbarWidth::Auto, ngn::ScrollbarGutter::Stable), true, true, {100, 100}, {200, 300});
  CHECK(stable == ngn::ScrollerVisibility{true, false, false});
}

TEST_CASE("legacy scrollers take their width from the content, and overlay ones nothing") {
  ngn::ScrollerVisibility both{true, true, true};
  CHECK(ngn::scrollerGutter(ngn::ScrollerStyle::Overlay, 15, both) == ngn::ScrollerGutter{});
  CHECK(ngn::scrollerGutter(ngn::ScrollerStyle::Legacy, 15, both) == ngn::ScrollerGutter{15, 15});
  CHECK(ngn::scrollerGutter(ngn::ScrollerStyle::Legacy, 15, {true, false, true}) == ngn::ScrollerGutter{15, 0});
  CHECK(ngn::scrollerGutter(ngn::ScrollerStyle::Legacy, 11, {false, true, true}) == ngn::ScrollerGutter{0, 11});
}

TEST_CASE("the gutter is added to the padding Yoga reads for the right and bottom edges") {
  yoga::Style none;
  auto plain = ngn::withGutter(none, {15, 11}, yoga::Direction::LTR);
  CHECK(padding(plain, yoga::Edge::Right) == 15);
  CHECK(padding(plain, yoga::Edge::Bottom) == 11);
  CHECK(padding(plain, yoga::Edge::Left) == -1);

  yoga::Style all;
  all.setPadding(yoga::Edge::All, yoga::StyleLength::points(10));
  auto padded = ngn::withGutter(all, {15, 0}, yoga::Direction::LTR);
  CHECK(padding(padded, yoga::Edge::Right) == 25);
  CHECK(padding(padded, yoga::Edge::All) == 10);
  CHECK(padded.padding(yoga::Edge::Bottom).isUndefined());

  yoga::Style logical;
  logical.setPadding(yoga::Edge::End, yoga::StyleLength::points(5));
  logical.setPadding(yoga::Edge::Start, yoga::StyleLength::points(7));
  CHECK(padding(ngn::withGutter(logical, {15, 0}, yoga::Direction::LTR), yoga::Edge::End) == 20);
  CHECK(padding(ngn::withGutter(logical, {15, 0}, yoga::Direction::RTL), yoga::Edge::Start) == 22);

  yoga::Style vertical;
  vertical.setPadding(yoga::Edge::Vertical, yoga::StyleLength::points(4));
  CHECK(padding(ngn::withGutter(vertical, {0, 11}, yoga::Direction::LTR), yoga::Edge::Bottom) == 15);

  // A percentage cannot take points, so it is left as it is.
  yoga::Style percent;
  percent.setPadding(yoga::Edge::Right, yoga::StyleLength::percent(10));
  auto kept = ngn::withGutter(percent, {15, 0}, yoga::Direction::LTR);
  CHECK(kept.padding(yoga::Edge::Right).isPercent());

  CHECK(ngn::withGutter(all, {}, yoga::Direction::LTR) == all);
}

TEST_CASE("the gutters say whether a scroll view's changed, and forget one set back to none") {
  auto &gutters = ngn::ScrollerGutters::shared();
  CHECK(gutters.set(9001, {15, 0}));
  CHECK_FALSE(gutters.set(9001, {15, 0}));
  CHECK(gutters.get(9001) == ngn::ScrollerGutter{15, 0});
  CHECK(gutters.set(9001, {}));
  CHECK(gutters.get(9001) == ngn::ScrollerGutter{});
  CHECK(gutters.set(9001, {0, 11}));
  gutters.remove(9001);
  CHECK(gutters.get(9001) == ngn::ScrollerGutter{});
}

TEST_CASE("a scroll view lays its content out narrower by its gutter, from the next clone on") {
  auto &gutters = ngn::ScrollerGutters::shared();
  ScrollTree tree(9100);
  try {
    CHECK(tree.childWidth() == 200);
    gutters.set(tree.tag, {15, 0});
    CHECK(tree.childWidth() == 185);
    // The style's own padding stays, with the gutter after it.
    gutters.set(tree.tag, {16, 0});
    CHECK(tree.childWidth() == 184);
    // The gutter going away gives the width back.
    gutters.set(tree.tag, {});
    CHECK(tree.childWidth() == 200);

    ScrollTree padded(9200, folly::dynamic::object("paddingRight", 10)("paddingLeft", 10));
    CHECK(padded.childWidth() == 180);
    gutters.set(padded.tag, {15, 0});
    CHECK(padded.childWidth() == 165);
  } catch (...) {
    gutters.remove(9100);
    gutters.remove(9200);
    throw;
  }
  gutters.remove(9100);
  gutters.remove(9200);
}

TEST_CASE("the desktop scroll view is React Native's in name and state") {
  ScrollTree tree(9300, folly::dynamic::object("contentOffset", folly::dynamic::object("x", 0)("y", 40)));
  CHECK(std::string(tree.scroll->getComponentName()) == "ScrollView");
  auto state = std::static_pointer_cast<const ConcreteState<ScrollViewState>>(tree.scroll->getState());
  CHECK(state->getData().contentOffset.y == 40);
}
