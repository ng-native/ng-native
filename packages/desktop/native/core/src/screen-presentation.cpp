#include "ngn/screen-presentation.h"

#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

ScreenProps::ScreenProps(const PropsParserContext &context, const ScreenProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      stackPresentation(
          convertRawProp(context, rawProps, "stackPresentation", sourceProps.stackPresentation, std::string{"push"})),
      anchor(convertRawProp(context, rawProps, "anchor", sourceProps.anchor, 0)) {}

std::optional<ModalPresentation> screenPresentation(const Props &props) {
  const auto *screen = dynamic_cast<const ScreenProps *>(&props);
  if (screen == nullptr || screen->stackPresentation == "push" || screen->stackPresentation.empty()) {
    return std::nullopt;
  }
  if (screen->anchor != 0) {
    return ModalPresentation::Popover;
  }
  const auto &how = screen->stackPresentation;
  if (how == "modal" || how == "formSheet" || how == "pageSheet") {
    return ModalPresentation::Sheet;
  }
  return ModalPresentation::Cover;
}

SheetChrome sheetChrome(const HeaderBar &header, ModalPresentation presentation) {
  SheetChrome chrome{.label = header.title};
  if (presentation != ModalPresentation::Sheet || header.hidden) {
    return chrome;
  }
  chrome.heading = header.title;
  auto add = [&](const std::vector<BarButton> &items, bool cancel) {
    for (const auto &item : items) {
      // A fixed space has nothing to press.
      if (item.spacing || (item.title.empty() && item.accessibilityLabel.empty())) {
        continue;
      }
      chrome.buttons.push_back(SheetButton{
          .id = item.id,
          .title = item.title.empty() ? item.accessibilityLabel : item.title,
          .cancel = cancel,
          .disabled = item.disabled});
    }
  };
  add(header.left, true);
  add(header.right, false);
  if (!chrome.buttons.empty() && !chrome.buttons.back().cancel) {
    chrome.buttons.back().isDefault = true;
  }
  return chrome;
}

} // namespace ngn
