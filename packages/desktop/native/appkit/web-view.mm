#import "web-view.h"

#include <set>

using ngn::WebViewConfig;

namespace {

NSString *ns(const std::string &text) {
  NSString *made = [[NSString alloc] initWithBytes:text.data() length:text.size() encoding:NSUTF8StringEncoding];
  return made != nil ? made : @"";
}

std::string str(NSString *text) {
  return text != nil ? std::string(text.UTF8String) : std::string();
}

NSString *navigationTypeName(WKNavigationType type) {
  switch (type) {
    case WKNavigationTypeLinkActivated:
      return @"click";
    case WKNavigationTypeFormSubmitted:
      return @"formsubmit";
    case WKNavigationTypeBackForward:
      return @"backforward";
    case WKNavigationTypeReload:
      return @"reload";
    case WKNavigationTypeFormResubmitted:
      return @"formresubmit";
    default:
      return @"other";
  }
}

bool sameScripts(const WebViewConfig &a, const WebViewConfig &b) {
  return a.injectedJavaScript == b.injectedJavaScript &&
      a.injectedJavaScriptBeforeContentLoaded == b.injectedJavaScriptBeforeContentLoaded &&
      a.injectedJavaScriptForMainFrameOnly == b.injectedJavaScriptForMainFrameOnly &&
      a.injectedJavaScriptBeforeContentLoadedForMainFrameOnly == b.injectedJavaScriptBeforeContentLoadedForMainFrameOnly &&
      a.injectedJavaScriptObject == b.injectedJavaScriptObject && a.messagingEnabled == b.messagingEnabled;
}

} // namespace

// A weak hop for WKUserContentController, which keeps its script message handlers strongly.
@interface NGNWeakScriptMessageHandler : NSObject <WKScriptMessageHandler>
@property (nonatomic, weak) id<WKScriptMessageHandler> target;
@end

@implementation NGNWeakScriptMessageHandler
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
  [self.target userContentController:controller didReceiveScriptMessage:message];
}
@end

@implementation NGNWebViewController {
  std::shared_ptr<ngn::NavigationLocks> _locks;
  std::function<void(const std::string &, folly::dynamic)> _send;
  std::function<void(const std::string &)> _openExternally;
  std::optional<WebViewConfig> _config;
  std::set<int> _held;
  WKWebView *_webView;
}

- (instancetype)initWithLocks:(std::shared_ptr<ngn::NavigationLocks>)locks
                         send:(std::function<void(const std::string &, folly::dynamic)>)send
               openExternally:(std::function<void(const std::string &)>)openExternally {
  if ((self = [super init])) {
    _locks = std::move(locks);
    _send = std::move(send);
    _openExternally = std::move(openExternally);
  }
  return self;
}

- (void)dealloc {
  [self invalidate];
}

- (WKWebView *)webView {
  return _webView;
}

- (folly::dynamic)baseEvent {
  return ngn::webViewEvent({
      .url = str(_webView.URL.absoluteString),
      .title = str(_webView.title),
      .loading = static_cast<bool>(_webView.loading),
      .canGoBack = static_cast<bool>(_webView.canGoBack),
      .canGoForward = static_cast<bool>(_webView.canGoForward),
  });
}

- (void)send:(const std::string &)name extra:(folly::dynamic)extra {
  auto event = [self baseEvent];
  if (extra.isObject()) {
    event.update(extra);
  }
  if (_send) {
    _send(name, std::move(event));
  }
}

- (void)makeWebView:(const WebViewConfig &)config {
  WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
  // Chosen when the view is made: WebKit takes no other data store afterwards.
  configuration.websiteDataStore = config.incognito ? WKWebsiteDataStore.nonPersistentDataStore : WKWebsiteDataStore.defaultDataStore;
  if (!config.applicationNameForUserAgent.empty()) {
    configuration.applicationNameForUserAgent = ns(config.applicationNameForUserAgent);
  }
  _webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
  _webView.navigationDelegate = self;
  _webView.UIDelegate = self;
  [_webView addObserver:self forKeyPath:@"estimatedProgress" options:NSKeyValueObservingOptionNew context:nil];
}

- (void)installScripts:(const WebViewConfig &)config {
  WKUserContentController *content = _webView.configuration.userContentController;
  [content removeAllUserScripts];
  [content removeScriptMessageHandlerForName:@"ReactNativeWebView"];
  if (config.messagingEnabled) {
    NGNWeakScriptMessageHandler *handler = [NGNWeakScriptMessageHandler new];
    handler.target = self;
    [content addScriptMessageHandler:handler name:@"ReactNativeWebView"];
    [content addUserScript:[[WKUserScript alloc] initWithSource:ns(ngn::webViewMessagingScript())
                                                  injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                               forMainFrameOnly:YES]];
  }
  if (!config.injectedJavaScriptObject.empty()) {
    [content addUserScript:[[WKUserScript alloc] initWithSource:ns(ngn::webViewInjectedObjectScript(config.injectedJavaScriptObject))
                                                  injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                               forMainFrameOnly:YES]];
  }
  if (!config.injectedJavaScriptBeforeContentLoaded.empty()) {
    [content addUserScript:[[WKUserScript alloc] initWithSource:ns(config.injectedJavaScriptBeforeContentLoaded)
                                                  injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                               forMainFrameOnly:config.injectedJavaScriptBeforeContentLoadedForMainFrameOnly]];
  }
  if (!config.injectedJavaScript.empty()) {
    [content addUserScript:[[WKUserScript alloc] initWithSource:ns(config.injectedJavaScript)
                                                  injectionTime:WKUserScriptInjectionTimeAtDocumentEnd
                                               forMainFrameOnly:config.injectedJavaScriptForMainFrameOnly]];
  }
}

- (void)load:(const ngn::WebViewSource &)source {
  if (!source.html.empty()) {
    NSURL *base = source.baseUrl.empty() ? [NSURL URLWithString:@"about:blank"] : [NSURL URLWithString:ns(source.baseUrl)];
    [_webView loadHTMLString:ns(source.html) baseURL:base];
    return;
  }
  NSURL *url = source.uri.empty() ? nil : [NSURL URLWithString:ns(source.uri)];
  if (url == nil) {
    [_webView loadHTMLString:@"" baseURL:[NSURL URLWithString:@"about:blank"]];
    return;
  }
  if (url.isFileURL) {
    [_webView loadFileURL:url allowingReadAccessToURL:url.URLByDeletingLastPathComponent];
    return;
  }
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  if (!source.method.empty()) {
    request.HTTPMethod = ns(source.method);
  }
  if (!source.body.empty()) {
    request.HTTPBody = [NSData dataWithBytes:source.body.data() length:source.body.size()];
  }
  for (const auto &[name, value] : source.headers) {
    [request setValue:ns(value) forHTTPHeaderField:ns(name)];
  }
  [_webView loadRequest:request];
}

- (void)apply:(const WebViewConfig &)config {
  bool fresh = _webView == nil;
  if (fresh) {
    [self makeWebView:config];
  }
  if (fresh || !sameScripts(*_config, config)) {
    [self installScripts:config];
  }
  _webView.configuration.defaultWebpagePreferences.allowsContentJavaScript = config.javaScriptEnabled;
  _webView.configuration.preferences.javaScriptCanOpenWindowsAutomatically = config.javaScriptCanOpenWindowsAutomatically;
  _webView.customUserAgent = config.userAgent.empty() ? nil : ns(config.userAgent);
  _webView.allowsBackForwardNavigationGestures = config.allowsBackForwardNavigationGestures;
  if (@available(macOS 13.3, *)) {
    _webView.inspectable = config.webviewDebuggingEnabled;
  }
  bool reload = fresh || _config->source != config.source;
  _config = config;
  if (reload) {
    [self load:config.source];
  }
}

- (void)command:(const std::string &)name args:(const folly::dynamic &)args {
  auto text = [&]() -> std::string { return !args.empty() && args[0].isString() ? args[0].asString() : ""; };
  if (name == "goBack") {
    [_webView goBack];
  } else if (name == "goForward") {
    [_webView goForward];
  } else if (name == "reload") {
    [_webView reload];
  } else if (name == "stopLoading") {
    [_webView stopLoading];
  } else if (name == "injectJavaScript") {
    [_webView evaluateJavaScript:ns(text()) completionHandler:nil];
  } else if (name == "postMessage") {
    [_webView evaluateJavaScript:ns(ngn::webViewPostMessageScript(text())) completionHandler:nil];
  } else if (name == "loadUrl") {
    if (NSURL *url = [NSURL URLWithString:ns(text())]) {
      [_webView loadRequest:[NSURLRequest requestWithURL:url]];
    }
  } else if (name == "requestFocus") {
    [_webView.window makeFirstResponder:_webView];
  } else if (name == "clearCache") {
    bool disk = !args.empty() && args[0].isBool() && args[0].asBool();
    NSSet *types = disk ? WKWebsiteDataStore.allWebsiteDataTypes : [NSSet setWithObject:WKWebsiteDataTypeMemoryCache];
    [_webView.configuration.websiteDataStore removeDataOfTypes:types modifiedSince:NSDate.distantPast completionHandler:^{}];
  }
  // clearHistory and clearFormData: WKWebView has no way to, as on iOS.
}

- (void)invalidate {
  for (int lock : std::set<int>(_held)) {
    _locks->settle(lock, false);
  }
  _held.clear();
  if (_webView != nil) {
    [_webView removeObserver:self forKeyPath:@"estimatedProgress"];
    [_webView.configuration.userContentController removeScriptMessageHandlerForName:@"ReactNativeWebView"];
    [_webView stopLoading];
    _webView.navigationDelegate = nil;
    _webView.UIDelegate = nil;
    _webView = nil;
  }
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if ([keyPath isEqualToString:@"estimatedProgress"] && object == _webView) {
    [self send:"loadingProgress" extra:folly::dynamic::object("progress", _webView.estimatedProgress)];
  }
}

// MARK: navigation

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  NSURLRequest *request = action.request;
  std::string url = str(request.URL.absoluteString);
  bool topFrame = [request.URL isEqual:request.mainDocumentURL];
  bool hasTargetFrame = action.targetFrame != nil;
  NSString *type = navigationTypeName(action.navigationType);
  if (_config && _config->hasOnOpenWindowEvent && !hasTargetFrame) {
    decisionHandler(WKNavigationActionPolicyCancel);
    [self send:"openWindow" extra:folly::dynamic::object("targetUrl", url)];
    return;
  }
  if (_config && ngn::navigationStep(*_config, url, topFrame) == ngn::NavigationStep::OpenExternally) {
    decisionHandler(WKNavigationActionPolicyCancel);
    if (_openExternally) {
      _openExternally(url);
    }
    return;
  }
  __weak NGNWebViewController *weakSelf = self;
  auto lockBox = std::make_shared<int>(0);
  int lock = _locks->hold([weakSelf, decisionHandler, topFrame, url, type, lockBox](bool shouldStart) {
    dispatch_async(dispatch_get_main_queue(), ^{
      NGNWebViewController *strong = weakSelf;
      if (strong != nil) {
        strong->_held.erase(*lockBox);
      }
      if (!shouldStart) {
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
      }
      if (strong != nil && topFrame) {
        [strong send:"loadingStart" extra:folly::dynamic::object("url", url)("navigationType", str(type))];
      }
      decisionHandler(WKNavigationActionPolicyAllow);
    });
  });
  *lockBox = lock;
  _held.insert(lock);
  folly::dynamic extra = folly::dynamic::object("url", url)("navigationType", str(type))("isTopFrame", topFrame)("hasTargetFrame", hasTargetFrame)(
      "lockIdentifier", lock);
  if (request.mainDocumentURL != nil) {
    extra["mainDocumentURL"] = str(request.mainDocumentURL.absoluteString);
  }
  [self send:"shouldStartLoadWithRequest" extra:std::move(extra)];
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationResponse:(WKNavigationResponse *)response
                      decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
  if (response.forMainFrame && [response.response isKindOfClass:NSHTTPURLResponse.class]) {
    NSInteger status = ((NSHTTPURLResponse *)response.response).statusCode;
    if (status >= 400) {
      [self send:"httpError"
           extra:folly::dynamic::object("statusCode", status)("description", str([NSHTTPURLResponse localizedStringForStatusCode:status]))];
    }
  }
  decisionHandler(WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  [self send:"loadingFinish" extra:nullptr];
}

- (void)failed:(NSError *)error {
  // A navigation the app or a new load cancelled is not a failure, as on iOS.
  if ([error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled) {
    return;
  }
  if ([error.domain isEqualToString:@"WebKitErrorDomain"] && error.code == 102) {
    return;
  }
  [self send:"loadingError"
       extra:folly::dynamic::object("domain", str(error.domain))("code", error.code)("description", str(error.localizedDescription))];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  [self failed:error];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  [self failed:error];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  [self send:"contentProcessDidTerminate" extra:nullptr];
}

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)action
                    windowFeatures:(WKWindowFeatures *)windowFeatures {
  // A link to a new window opens in this one, as the library's iOS view does.
  if (action.targetFrame == nil) {
    [webView loadRequest:action.request];
  }
  return nil;
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
  if (![message.name isEqualToString:@"ReactNativeWebView"]) {
    return;
  }
  NSString *data = [message.body isKindOfClass:NSString.class] ? message.body : [NSString stringWithFormat:@"%@", message.body];
  [self send:"message" extra:folly::dynamic::object("data", str(data))];
}

@end
