// ModalHostView (what <modal> commits) as an in-window cover: its own container on top of the
// window's content, hit-tested from the modal's root, so clicks and hover land in the modal and
// nowhere under it. On the cxx platform the modal's size comes only from its state, which starts
// at 0x0, so the host sets it to the cover's size, and again whenever the window resizes.
// Escape asks to close it (onRequestClose), as a swipe down does on iOS.
//
// A modal with an `anchor` (desktop-modal.h) is a popover instead: an NSPopover at the anchor's
// view, whose content is the same kind of container. It takes the size of the modal's content
// root, measured at the window's size on the first commit and fitted on the next. A click outside
// closes it and asks to close (onRequestClose), as Escape does.
#pragma once

#import "host-view.h"

#include "ngn/input.h"

#include <functional>

@interface NGNModalHostView : NGNView
// Set once by the host: the input sink containers report to, and where the core learns which
// views root a container of their own.
@property (class, nonatomic) ngn::InputSink *input;
@property (class, nonatomic) std::function<void(NSInteger tag, BOOL presented)> presentationChanged;
// Finds the view an anchor names.
@property (class, nonatomic) std::function<NSView *(NSInteger tag)> viewForTag;

// Fits each open popover to its content, after a transaction is mounted.
+ (void)fitPopovers;

// Called by the backend in place of inserting the view into its parent.
- (void)presentOver:(NSView *)parent;
- (void)dismiss;
@end
