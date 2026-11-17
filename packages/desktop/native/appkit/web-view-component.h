// RNCWebView's mounted view on macOS, and Expo's DOM web view's: an NGNView holding an
// NGNWebViewController's WKWebView, configured from the library's props through the glue
// (libraryGlue().webViewConfig) or from Expo's (domWebViewConfig, dom-web-view.h), its events sent
// through the view's event emitter and its commands handed to the controller.
#pragma once

#import "host-view.h"

@interface NGNWebView : NGNView
@end
