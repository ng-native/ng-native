#include "ngn/scrollers.h"

using namespace facebook::react;
namespace yoga = facebook::yoga;

namespace ngn {

ScrollerVisibility scrollerVisibility(
    const DesktopProps &props,
    bool showsVertical,
    bool showsHorizontal,
    Size content,
    Size view) {
  bool none = props.scrollbarWidth == ScrollbarWidth::None;
  bool stable = props.scrollbarGutter == ScrollbarGutter::Stable;
  return ScrollerVisibility{
      .vertical = !none && showsVertical && (stable || content.height > view.height + 0.5f),
      .horizontal = !none && showsHorizontal && content.width > view.width + 0.5f,
      .autohides = !stable,
  };
}

ScrollerGutter scrollerGutter(ScrollerStyle style, float legacyWidth, const ScrollerVisibility &visibility) {
  if (style == ScrollerStyle::Overlay) {
    return {};
  }
  return {
      .right = visibility.vertical ? legacyWidth : 0,
      .bottom = visibility.horizontal ? legacyWidth : 0,
  };
}

namespace {

// The edge Yoga reads an edge's padding from: the most specific one the style defines.
yoga::Edge winningEdge(const yoga::Style &style, std::initializer_list<yoga::Edge> order) {
  for (auto edge : order) {
    if (style.padding(edge).isDefined()) {
      return edge;
    }
  }
  return *order.begin();
}

void addPadding(yoga::Style &style, yoga::Edge winner, yoga::Edge target, float amount) {
  if (amount <= 0) {
    return;
  }
  auto length = style.padding(winner);
  if (length.isUndefined()) {
    style.setPadding(target, yoga::StyleLength::points(amount));
  } else if (length.isPoints()) {
    style.setPadding(target, yoga::StyleLength::points(length.value().unwrap() + amount));
  }
}

} // namespace

yoga::Style withGutter(const yoga::Style &style, ScrollerGutter gutter, yoga::Direction direction) {
  yoga::Style out{style};
  // Yoga's order for the right edge: the logical one first, then right, horizontal and all.
  auto logical = direction == yoga::Direction::RTL ? yoga::Edge::Start : yoga::Edge::End;
  auto right = winningEdge(style, {logical, yoga::Edge::Right, yoga::Edge::Horizontal, yoga::Edge::All});
  // Written where it wins: the logical edge when that is the one set, the physical one otherwise.
  bool logicalSet = style.padding(logical).isDefined();
  addPadding(out, right, logicalSet ? logical : yoga::Edge::Right, gutter.right);
  auto bottom = winningEdge(style, {yoga::Edge::Bottom, yoga::Edge::Vertical, yoga::Edge::All});
  addPadding(out, bottom, yoga::Edge::Bottom, gutter.bottom);
  return out;
}

ScrollerGutters &ScrollerGutters::shared() {
  static ScrollerGutters gutters;
  return gutters;
}

bool ScrollerGutters::set(Tag tag, ScrollerGutter gutter) {
  std::lock_guard lock(mutex_);
  auto it = gutters_.find(tag);
  ScrollerGutter before = it == gutters_.end() ? ScrollerGutter{} : it->second;
  if (gutter == ScrollerGutter{}) {
    gutters_.erase(tag);
  } else {
    gutters_[tag] = gutter;
  }
  return before != gutter;
}

ScrollerGutter ScrollerGutters::get(Tag tag) const {
  std::lock_guard lock(mutex_);
  auto it = gutters_.find(tag);
  return it == gutters_.end() ? ScrollerGutter{} : it->second;
}

void ScrollerGutters::remove(Tag tag) {
  std::lock_guard lock(mutex_);
  gutters_.erase(tag);
}

#pragma mark - DesktopScrollViewShadowNode

DesktopScrollViewShadowNode::DesktopScrollViewShadowNode(
    const ShadowNodeFragment &fragment,
    const ShadowNodeFamily::Shared &family,
    ShadowNodeTraits traits)
    : ConcreteViewShadowNode(fragment, family, traits) {
  applyGutter(yoga::Direction::LTR);
}

DesktopScrollViewShadowNode::DesktopScrollViewShadowNode(
    const ShadowNode &sourceShadowNode,
    const ShadowNodeFragment &fragment)
    : ConcreteViewShadowNode(sourceShadowNode, fragment) {
  auto direction = getLayoutMetrics().layoutDirection == LayoutDirection::RightToLeft ? yoga::Direction::RTL
                                                                                       : yoga::Direction::LTR;
  applyGutter(direction);
}

// The props' style with the gutter over it, whenever the node is made: a new gutter reaches
// layout through any clone, a state update included.
void DesktopScrollViewShadowNode::applyGutter(yoga::Direction direction) {
  auto before = yogaNode_.style();
  bool dirty = yogaNode_.isDirty();
  // The props' own style, as Yoga would have it with no gutter.
  updateYogaProps();
  auto style = withGutter(yogaNode_.style(), ScrollerGutters::shared().get(getTag()), direction);
  yogaNode_.setStyle(style);
  // A clone whose style comes out as it was keeps its layout: a scroll's state update makes one
  // for every frame.
  yogaNode_.setDirty(style == before ? dirty : true);
}

ScrollViewState DesktopScrollViewShadowNode::initialStateData(
    const Props::Shared &props,
    const ShadowNodeFamily::Shared &family,
    const ComponentDescriptor &componentDescriptor) {
  return {static_cast<const ScrollViewProps &>(*props).contentOffset, {}, 0};
}

// What React Native's ScrollViewShadowNode does after Yoga.
void DesktopScrollViewShadowNode::layout(LayoutContext layoutContext) {
  ConcreteViewShadowNode::layout(layoutContext);
  updateScrollContentOffsetIfNeeded();
  updateStateIfNeeded();
}

void DesktopScrollViewShadowNode::updateStateIfNeeded() {
  ensureUnsealed();
  auto contentBoundingRect = Rect{};
  for (const auto &child : getLayoutableChildNodes()) {
    contentBoundingRect.unionInPlace(child->getLayoutMetrics().frame);
  }
  auto state = getStateData();
  if (state.contentBoundingRect != contentBoundingRect) {
    state.contentBoundingRect = contentBoundingRect;
    setStateData(std::move(state));
  }
}

void DesktopScrollViewShadowNode::updateScrollContentOffsetIfNeeded() {
  // Yoga puts the content on the right of a right-to-left scroll view; React Native moves it back.
  if (getLayoutMetrics().layoutDirection == LayoutDirection::RightToLeft) {
    for (auto *child : getLayoutableChildNodes()) {
      auto metrics = child->getLayoutMetrics();
      if (metrics.frame.origin.x != 0) {
        metrics.frame.origin.x = 0;
        child->setLayoutMetrics(metrics);
      }
    }
  }
}

Point DesktopScrollViewShadowNode::getContentOriginOffset(bool includeTransform) const {
  auto stateData = getStateData();
  auto contentOffset = stateData.contentOffset;
  auto transform = includeTransform ? getTransform() : Transform::Identity();
  auto result = transform * Vector{.x = -contentOffset.x, .y = -contentOffset.y, .z = 0.0f, .w = 1.0f};
  return {.x = result.x, .y = result.y + static_cast<float>(stateData.scrollAwayPaddingTop)};
}

} // namespace ngn
