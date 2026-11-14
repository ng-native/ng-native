// `<apple-sign-in-button>`'s drawing with no Fabric in it: an ASAuthorizationAppleIDButton filling
// the view, made again when its type or style changes (AuthenticationServices takes both only at
// init), as expo's iOS view does, and calling `pressed` on a click.
#pragma once

#import <AppKit/AppKit.h>
#import <AuthenticationServices/AuthenticationServices.h>

#include <functional>

@interface NGNAppleIdButton : NSView
- (instancetype)initWithFrame:(NSRect)frame pressed:(std::function<void()>)pressed;
@property(readonly) ASAuthorizationAppleIDButton *control;
// expo's enums, which are AuthenticationServices' own.
- (void)applyType:(int)type style:(int)style cornerRadius:(double)cornerRadius;
@end
