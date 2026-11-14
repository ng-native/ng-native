#include "ngn/desktop-view-props.h"
#include "ngn/screen-presentation.h"

#include "ngn/desktop-modal.h"

#include <react/renderer/components/view/conversions.h>
#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

// CSS keywords: anything else is the initial value.
void fromRawValue(const PropsParserContext &, const RawValue &value, ScrollbarWidth &result) {
  auto keyword = value.hasType<std::string>() ? static_cast<std::string>(value) : std::string{};
  result = keyword == "thin" ? ScrollbarWidth::Thin : keyword == "none" ? ScrollbarWidth::None : ScrollbarWidth::Auto;
}

void fromRawValue(const PropsParserContext &, const RawValue &value, ScrollbarGutter &result) {
  auto keyword = value.hasType<std::string>() ? static_cast<std::string>(value) : std::string{};
  result = keyword == "stable" ? ScrollbarGutter::Stable : ScrollbarGutter::Auto;
}

DesktopProps parseDesktopProps(const PropsParserContext &context, const DesktopProps &source, const RawProps &rawProps) {
  return DesktopProps{
      .focusable = convertRawProp(context, rawProps, "focusable", source.focusable, {}),
      .tabIndex = convertRawProp(context, rawProps, "tabIndex", source.tabIndex, {}),
      .anchor = source.anchor,
      .cursor = convertRawProp(context, rawProps, "desktopCursor", source.cursor, {}),
      .scrollbarWidth = convertRawProp(context, rawProps, "scrollbarWidth", source.scrollbarWidth, ScrollbarWidth::Auto),
      .scrollbarGutter =
          convertRawProp(context, rawProps, "scrollbarGutter", source.scrollbarGutter, ScrollbarGutter::Auto),
      .onDoubleClick = convertRawProp(context, rawProps, "onDoubleClick", source.onDoubleClick, false),
      .onContextMenu = convertRawProp(context, rawProps, "onContextMenu", source.onContextMenu, false),
      .onWheel = convertRawProp(context, rawProps, "onWheel", source.onWheel, false),
      .contextMenu = convertRawProp(context, rawProps, "contextMenu", source.contextMenu, folly::dynamic(nullptr)),
  };
}

DesktopViewProps::DesktopViewProps(
    const PropsParserContext &context,
    const DesktopViewProps &sourceProps,
    const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)} {}

DesktopScrollViewProps::DesktopScrollViewProps(
    const PropsParserContext &context,
    const DesktopScrollViewProps &sourceProps,
    const RawProps &rawProps)
    : ScrollViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)} {}

DesktopProps desktopProps(const Props &props) {
  if (const auto *desktop = dynamic_cast<const HasDesktopProps *>(&props)) {
    return desktop->desktop;
  }
  if (const auto *modal = dynamic_cast<const DesktopModalProps *>(&props)) {
    DesktopProps out{.presentation = modalPresentation(*modal)};
    if (modal->anchor != 0) {
      out.anchor = modal->anchor;
    }
    return out;
  }
  if (auto presented = screenPresentation(props)) {
    // A presented screen shows as a modal does (screen-presentation.h).
    DesktopProps out{.presentation = *presented};
    if (const auto *screen = dynamic_cast<const ScreenProps *>(&props); screen && screen->anchor != 0) {
      out.anchor = screen->anchor;
    }
    return out;
  }
  return {};
}

} // namespace ngn
