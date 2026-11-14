// RNSScreen, which react-native-screens presents over its stack when its `stackPresentation` is not
// `push` (the core's screen-presentation.h): as a sheet, a cover or, with an `anchor`, a popover, the
// way <modal> is. A pushed screen is an ordinary view in its stack.
//
// In a sheet the screen's header is drawn around it, as a sheet has no toolbar: its title as a
// heading at the top and its bar buttons as a row at the bottom right, the left ones first and
// bound to Escape, the last right one the default on Return. A popover draws none and takes the
// title as its accessibility label. Escape, Cmd-W and a click outside a popover send `dismissed`,
// and the router takes the screen away.
#pragma once

#import "modal-host-view.h"

@interface NGNPresentedScreenView : NGNModalHostView
// Called by the backend as the core decides (ScreenStacks::takePresented).
- (void)setPresented:(BOOL)presented;
// Brings what is drawn around it in step with its header, after a transaction is mounted.
+ (void)refreshChrome;
@end
