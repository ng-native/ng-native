// `<search-field>` on macOS: an NSSearchField with `@ng-native/expo`'s iOS contract. The text is
// controlled from JavaScript and a text older than what has been typed since is skipped; Return
// submits, and the clear button and Escape cancel, emptying the field. No Fabric here, so it is
// tested on offscreen windows; native-controls.mm puts it in a Fabric view.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/native-controls.h"

// The font the field draws its text in: the control size's system font, with the CSS's face, size,
// weight and slant over it. A name no face has is looked up as a family; one the system lacks
// keeps the system face.
NSFont *NGNSearchFieldFont(const ngn::NativeControlProps &props);

// How big AppKit draws the field at its control size, font and placeholder. Safe off the main
// thread: it measures a cell.
NSSize NGNSearchFieldSize(const ngn::NativeControlProps &props);

@interface NGNSearchField : NSView
@property (nonatomic, readonly) NSSearchField *field;
// The text the user changed, with the count of changes so far.
@property (nonatomic, copy) void (^changed)(NSString *text, int eventCount);
// Return, with the text.
@property (nonatomic, copy) void (^submitted)(NSString *text);
// The clear button or Escape, after the field is emptied.
@property (nonatomic, copy) void (^cancelled)(void);
@property (nonatomic, copy) void (^began)(void);
@property (nonatomic, copy) void (^ended)(void);
- (void)apply:(const ngn::NativeControlProps &)props;
- (void)focus;
- (void)blur;
@end
