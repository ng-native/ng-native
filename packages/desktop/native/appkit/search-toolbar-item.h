// `<native-search-bar>` on macOS: react-native-screens' RNSSearchBar as the window's
// NSSearchToolbarItem, trailing the toolbar as Finder's and Mail's search does. It reports what the
// user does as the core's SearchBarInput (header-bar.h) and takes RNSSearchBar's commands. No
// Fabric here, so it is tested on offscreen windows; header-toolbar.mm puts it in the toolbar.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/header-bar.h"

@interface NGNSearchToolbarItem : NSSearchToolbarItem
// What the user did, with the field's text after it.
@property (nonatomic, copy) void (^input)(ngn::SearchBarInput input, NSString *text);
- (void)apply:(const ngn::SearchBarConfig &)config;
- (void)run:(const ngn::SearchBarCommand &)command;
// Runs `change`, which may take the item out of its toolbar and put it back, and gives the field
// the keyboard and selection again if it was editing, with no blur or focus reported.
- (void)keepFocusAcross:(void (^)(void))change;
@end
