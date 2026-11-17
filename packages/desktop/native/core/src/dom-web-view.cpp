#include "ngn/dom-web-view.h"

#include "ngn/desktop-view-props.h"

#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

const char DomWebViewComponentName[] = "ViewManagerAdapter_ExpoDomWebViewModule";

DomWebViewProps::DomWebViewProps(const PropsParserContext &context, const DomWebViewProps &sourceProps, const RawProps &rawProps)
    : ViewProps(context, sourceProps, rawProps),
      HasDesktopProps{parseDesktopProps(context, sourceProps.desktop, rawProps)},
      source(convertRawProp(context, rawProps, "source", sourceProps.source, folly::dynamic(nullptr))),
      injectedJavaScript(convertRawProp(context, rawProps, "injectedJavaScript", sourceProps.injectedJavaScript, {})),
      injectedJavaScriptBeforeContentLoaded(convertRawProp(
          context, rawProps, "injectedJavaScriptBeforeContentLoaded", sourceProps.injectedJavaScriptBeforeContentLoaded, {})),
      injectedJavaScriptObject(
          convertRawProp(context, rawProps, "injectedJavaScriptObject", sourceProps.injectedJavaScriptObject, {})),
      webviewDebuggingEnabled(
          convertRawProp(context, rawProps, "webviewDebuggingEnabled", sourceProps.webviewDebuggingEnabled, false)) {}

std::optional<WebViewConfig> domWebViewConfig(const Props &props) {
  const auto *own = dynamic_cast<const DomWebViewProps *>(&props);
  if (own == nullptr) {
    return std::nullopt;
  }
  WebViewConfig config;
  if (const auto *uri = own->source.isObject() ? own->source.get_ptr("uri") : nullptr; uri != nullptr && uri->isString()) {
    config.source.uri = uri->asString();
  }
  config.injectedJavaScript = own->injectedJavaScript;
  config.injectedJavaScriptBeforeContentLoaded = own->injectedJavaScriptBeforeContentLoaded;
  config.injectedJavaScriptForMainFrameOnly = false;
  config.injectedJavaScriptBeforeContentLoadedForMainFrameOnly = false;
  config.injectedJavaScriptObject = own->injectedJavaScriptObject;
  config.messagingEnabled = true;
  config.webviewDebuggingEnabled = own->webviewDebuggingEnabled;
  config.asksApp = false;
  return config;
}

} // namespace ngn
