// The core's reading of react-native-webview's props into a WebViewConfig (web-view.h), compiled
// into the host only with the library (cmake/libraries.cmake).
//
// RNCWebView is registered as the desktop's own component: the library's props, parsed by its
// codegen, beside `originWhitelist`, which the library's codegen props leave to its JavaScript.
// Its events go out by name, as the library's iOS view sends them.
#include "ngn/library-glue.h"
#include "ngn/web-view.h"

#include <react/renderer/components/RNCWebViewSpec/Props.h>
#include <react/renderer/components/RNCWebViewSpec/ShadowNodes.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/propsConversions.h>

using namespace facebook::react;

namespace ngn {

namespace {

class DesktopWebViewProps final : public ViewProps {
 public:
  DesktopWebViewProps() = default;
  DesktopWebViewProps(const PropsParserContext &context, const DesktopWebViewProps &source, const RawProps &raw)
      : ViewProps(context, source, raw),
        library(context, source.library, raw),
        originWhitelist(convertRawProp(context, raw, "originWhitelist", source.originWhitelist, {})) {}

  RNCWebViewProps library;
  std::optional<std::vector<std::string>> originWhitelist;
};

using DesktopWebViewShadowNode = ConcreteViewShadowNode<RNCWebViewComponentName, DesktopWebViewProps, ViewEventEmitter>;

std::optional<WebViewConfig> webViewConfig(const Props &props) {
  const auto *own = dynamic_cast<const DesktopWebViewProps *>(&props);
  if (own == nullptr) {
    return std::nullopt;
  }
  const auto &p = own->library;
  WebViewConfig config;
  config.source = {
      .uri = p.newSource.uri,
      .method = p.newSource.method,
      .body = p.newSource.body,
      .html = p.newSource.html,
      .baseUrl = p.newSource.baseUrl,
  };
  for (const auto &header : p.newSource.headers) {
    config.source.headers.emplace_back(header.name, header.value);
  }
  config.injectedJavaScript = p.injectedJavaScript;
  config.injectedJavaScriptBeforeContentLoaded = p.injectedJavaScriptBeforeContentLoaded;
  config.injectedJavaScriptForMainFrameOnly = p.injectedJavaScriptForMainFrameOnly;
  config.injectedJavaScriptBeforeContentLoadedForMainFrameOnly = p.injectedJavaScriptBeforeContentLoadedForMainFrameOnly;
  config.injectedJavaScriptObject = p.injectedJavaScriptObject;
  config.messagingEnabled = p.messagingEnabled;
  config.javaScriptEnabled = p.javaScriptEnabled;
  config.javaScriptCanOpenWindowsAutomatically = p.javaScriptCanOpenWindowsAutomatically;
  config.hasOnOpenWindowEvent = p.hasOnOpenWindowEvent;
  config.incognito = p.incognito;
  config.webviewDebuggingEnabled = p.webviewDebuggingEnabled;
  config.allowsBackForwardNavigationGestures = p.allowsBackForwardNavigationGestures;
  config.userAgent = p.userAgent;
  config.applicationNameForUserAgent = p.applicationNameForUserAgent;
  config.originWhitelist = own->originWhitelist;
  return config;
}

} // namespace

void installGlue_RNCWebViewSpec() {
  auto &glue = libraryGlue();
  glue.webViewConfig = webViewConfig;
  glue.components.push_back(concreteComponentDescriptorProvider<ConcreteComponentDescriptor<DesktopWebViewShadowNode>>());
}

} // namespace ngn
