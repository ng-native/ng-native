// `<dom-component>` on a desktop host: @expo/dom-webview's view (ViewManagerAdapter_ExpoDomWebViewModule,
// the component @ng-native/expo's `<dom-component>` commits) as a Fabric component of the desktop's
// own, drawn by the same web view as react-native-webview's RNCWebView (web-view.h).
//
// The core reads Expo's props into a WebViewConfig (domWebViewConfig): `source` ({uri}),
// `injectedJavaScript`, `injectedJavaScriptBeforeContentLoaded`, `injectedJavaScriptObject` and
// `webviewDebuggingEnabled`. As in Expo's iOS view, the page always has
// window.ReactNativeWebView.postMessage, each message is the `message` event ({url, title, data}),
// the injected scripts run in every frame, and a navigation goes ahead without asking the app.
// `injectJavaScript` is the view's command, where Expo's is a function on its view.
#pragma once

#include "ngn/desktop-props.h"
#include "ngn/web-view.h"

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

#include <folly/dynamic.h>

#include <optional>
#include <string>

namespace ngn {

extern const char DomWebViewComponentName[];

class DomWebViewProps final : public facebook::react::ViewProps, public HasDesktopProps {
 public:
  DomWebViewProps() = default;
  DomWebViewProps(
      const facebook::react::PropsParserContext &context,
      const DomWebViewProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  // {uri}, as Expo's DomWebViewSource.
  folly::dynamic source;
  std::string injectedJavaScript;
  std::string injectedJavaScriptBeforeContentLoaded;
  std::string injectedJavaScriptObject;
  bool webviewDebuggingEnabled{false};
};

// The web view's config for Expo's DOM web view's props; nothing for another component's.
std::optional<WebViewConfig> domWebViewConfig(const facebook::react::Props &props);

using DomWebViewShadowNode =
    facebook::react::ConcreteViewShadowNode<DomWebViewComponentName, DomWebViewProps, facebook::react::ViewEventEmitter>;
using DomWebViewComponentDescriptor = facebook::react::ConcreteComponentDescriptor<DomWebViewShadowNode>;

} // namespace ngn
