// react-native-webview's RNCWebView on macOS (the core's web-view.h): NGNWebViewController drives
// a WKWebView from a WebViewConfig and sends the library's iOS events through `send`, with no
// Fabric in it, so it runs headless. NGNWebView (web-view-component.h) mounts one.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/web-view.h"

#import <WebKit/WebKit.h>

#include <functional>
#include <memory>
#include <string>

@interface NGNWebViewController : NSObject <WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate>
// `send(name, payload)` gets each event, `name` as the library's iOS view emits it ("message");
// `openExternally` each url outside `originWhitelist`. Main thread.
- (instancetype)initWithLocks:(std::shared_ptr<ngn::NavigationLocks>)locks
                         send:(std::function<void(const std::string &name, folly::dynamic payload)>)send
               openExternally:(std::function<void(const std::string &url)>)openExternally;
// The web view, made on the first apply.
@property (nonatomic, readonly) WKWebView *webView;
// Applies a config: the scripts when they change, and the source when it does.
- (void)apply:(const ngn::WebViewConfig &)config;
// One of the library's commands: goBack, goForward, reload, stopLoading, injectJavaScript,
// postMessage, loadUrl, requestFocus, clearCache, clearHistory, clearFormData.
- (void)command:(const std::string &)name args:(const folly::dynamic &)args;
// Stops what it holds: the navigations waiting for the app are refused.
- (void)invalidate;
@end
