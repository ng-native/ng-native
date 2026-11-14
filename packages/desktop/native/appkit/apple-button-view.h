// `<apple-sign-in-button>`'s view on macOS: an NGNView holding an NGNAppleIdButton
// (apple-id-button.h), with expo's props, sending `buttonPress` to the view's emitter on a click.
#pragma once

#import "host-view.h"

#include "ngn/apple-authentication.h"

@interface NGNAppleButtonView : NGNView
@end
