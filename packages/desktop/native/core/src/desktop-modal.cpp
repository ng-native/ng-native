#include "ngn/desktop-modal.h"

#include <algorithm>

#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

DesktopModalProps::DesktopModalProps(
    const PropsParserContext &context,
    const DesktopModalProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      anchor(convertRawProp(context, rawProps, "anchor", sourceProps.anchor, 0)),
      presentationStyle(
          convertRawProp(context, rawProps, "presentationStyle", sourceProps.presentationStyle, std::string{})),
      transparent(convertRawProp(context, rawProps, "transparent", sourceProps.transparent, false)) {}

ModalPresentation modalPresentation(const DesktopModalProps &props) {
  if (props.anchor != 0) {
    return ModalPresentation::Popover;
  }
  if (props.transparent || props.presentationStyle == "fullScreen" || props.presentationStyle == "overFullScreen") {
    return ModalPresentation::Cover;
  }
  return ModalPresentation::Sheet;
}

namespace {

std::optional<Float> definite(const ViewProps &props, facebook::yoga::Dimension axis) {
  auto length = props.yogaStyle.dimension(axis);
  if (length.isPoints() && length.value().isDefined()) {
    return length.value().unwrap();
  }
  return std::nullopt;
}

} // namespace

bool takesRoomInSheet(std::string_view componentName) {
  return componentName != std::string_view(ModalHostViewComponentName) && componentName != "RNSScreenStackHeaderConfig";
}

SheetNode sheetNode(const ShadowNode &node) {
  SheetNode out;
  if (const auto *layoutable = dynamic_cast<const LayoutableShadowNode *>(&node)) {
    out.frame = layoutable->getLayoutMetrics().frame;
    out.insets = layoutable->getLayoutMetrics().contentInsets;
  }
  if (const auto *props = dynamic_cast<const ViewProps *>(node.getProps().get())) {
    out.width = definite(*props, facebook::yoga::Dimension::Width);
    out.height = definite(*props, facebook::yoga::Dimension::Height);
  }
  for (const auto &child : node.getChildren()) {
    if (takesRoomInSheet(child->getComponentName())) {
      out.children.push_back(sheetNode(*child));
    }
  }
  return out;
}

namespace {

// Past the views that fill their parent and have no size of their own (<modal>'s container, a
// presented screen), the view whose children are the content.
const SheetNode &contentParent(const SheetNode &presented) {
  const SheetNode *node = &presented;
  while (node->children.size() == 1) {
    const auto &child = node->children[0];
    bool fills = child.frame.size == node->frame.size;
    if (!fills || child.width || child.height) {
      break;
    }
    node = &child;
  }
  return *node;
}

// How far the content reaches in `parent`, with the parent's own padding past it: the content
// sized the parent when the parent was passed through for filling, and its padding is part of it.
Size extent(const SheetNode &parent) {
  Size out{0, 0};
  for (const auto &child : parent.children) {
    out.width = std::max(out.width, child.frame.origin.x + child.frame.size.width);
    out.height = std::max(out.height, child.frame.origin.y + child.frame.size.height);
  }
  if (!parent.children.empty()) {
    out.width += parent.insets.right;
    out.height += parent.insets.bottom;
  }
  return out;
}

} // namespace

Size sheetSize(const SheetNode &modal, Size window) {
  const SheetNode &node = contentParent(modal);
  std::optional<Float> width;
  std::optional<Float> height;
  if (node.children.size() == 1) {
    width = node.children[0].width;
    height = node.children[0].height;
  }
  auto clamp = [](Float value, Float min, Float max) { return std::max(min, std::min(value, std::max(min, max))); };
  return {
      .width = clamp(width.value_or(kDefaultSheetWidth), kMinimumSheetSize.width, window.width),
      .height = clamp(height.value_or(extent(node).height), kMinimumSheetSize.height, window.height),
  };
}

Size popoverSize(const SheetNode &presented, Size window) {
  const SheetNode &node = contentParent(presented);
  auto reach = extent(node);
  if (node.children.size() == 1) {
    reach.width = node.children[0].width.value_or(reach.width);
    reach.height = node.children[0].height.value_or(reach.height);
  }
  return {
      .width = std::min({reach.width, kPopoverMax, window.width}),
      .height = std::min({reach.height, kPopoverMax, window.height}),
  };
}

ShadowNodeTraits DesktopModalShadowNode::BaseTraits() {
  auto traits = ConcreteViewShadowNode::BaseTraits();
  traits.set(ShadowNodeTraits::Trait::RootNodeKind);
  traits.set(ShadowNodeTraits::Trait::Unstable_uncullableView);
  return traits;
}

void DesktopModalComponentDescriptor::adopt(ShadowNode &shadowNode) const {
  auto &layoutable = static_cast<YogaLayoutableShadowNode &>(shadowNode);
  const auto &state = static_cast<const DesktopModalShadowNode::ConcreteState &>(*shadowNode.getState()).getData();
  layoutable.setSize(Size{.width = state.screenSize.width, .height = state.screenSize.height});
  layoutable.setPositionType(YGPositionTypeAbsolute);
  ConcreteComponentDescriptor::adopt(shadowNode);
}

} // namespace ngn
