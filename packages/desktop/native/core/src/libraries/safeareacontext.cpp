// The core's writing of react-native-safe-area-context's state, compiled into the host only with
// the library (cmake/libraries.cmake).
#include "ngn/library-glue.h"

#include <algorithm>

#include <react/renderer/components/safeareacontext/Props.h>
#include <react/renderer/components/safeareacontext/RNCSafeAreaViewState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace ngn {

namespace {

// How far an edge's margin moves the view for its inset, as RNCSafeAreaViewShadowNode sets it: the
// inset added to the style's margin, the larger of the two ("maximum"), or nothing ("off").
float moved(const std::string &mode, float inset, const facebook::yoga::Style::Length &style) {
  float margin = style.value().unwrapOrDefault(0);
  if (mode == "off") {
    return 0;
  }
  if (mode == "maximum") {
    return std::max(inset, margin) - margin;
  }
  return inset;
}

facebook::yoga::Style::Length marginOf(const facebook::yoga::Style &style, facebook::yoga::Edge edge, facebook::yoga::Edge axis) {
  if (style.margin(edge).isDefined()) {
    return style.margin(edge);
  }
  return style.margin(axis).isDefined() ? style.margin(axis) : style.margin(facebook::yoga::Edge::All);
}

} // namespace

void installGlue_safeareacontext() {
  libraryGlue().safeAreaStates.emplace_back([](const State &state, EdgeInsets insets) {
    const auto *concrete = dynamic_cast<const ConcreteState<RNCSafeAreaViewState> *>(&state);
    if (concrete == nullptr) {
      return false;
    }
    RNCSafeAreaViewState data;
    data.insets = insets;
    concrete->updateState(std::move(data));
    return true;
  });
  // In margin mode the view moves itself by its insets; in padding mode it does not.
  libraryGlue().safeAreaMargins.emplace_back([](const ShadowView &view) -> std::optional<EdgeInsets> {
    const auto *props = dynamic_cast<const RNCSafeAreaViewProps *>(view.props.get());
    const auto *state = dynamic_cast<const ConcreteState<RNCSafeAreaViewState> *>(view.state.get());
    if (props == nullptr || state == nullptr || props->mode != RNCSafeAreaViewMode::Margin) {
      return std::nullopt;
    }
    auto insets = state->getData().insets;
    const auto &style = props->yogaStyle;
    const auto &edges = props->edges;
    using facebook::yoga::Edge;
    return EdgeInsets{
        .left = moved(edges.left, insets.left, marginOf(style, Edge::Left, Edge::Horizontal)),
        .top = moved(edges.top, insets.top, marginOf(style, Edge::Top, Edge::Vertical)),
        .right = moved(edges.right, insets.right, marginOf(style, Edge::Right, Edge::Horizontal)),
        .bottom = moved(edges.bottom, insets.bottom, marginOf(style, Edge::Bottom, Edge::Vertical)),
    };
  });
}

} // namespace ngn
