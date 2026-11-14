// RNCWebView's mounted view on macOS: an NGNView holding an NGNWebViewController's WKWebView,
// configured from the library's props through the glue (libraryGlue().webViewConfig), its events
// sent through the view's event emitter and its commands handed to the controller.
#pragma once

#import "host-view.h"

@interface NGNWebView : NGNView
@end
