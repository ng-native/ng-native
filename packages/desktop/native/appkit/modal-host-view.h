// ModalHostView (what <modal> commits) as a sheet, an in-window cover or a popover
// (desktop-modal.h). Each is a container of its own, hit-tested from the modal's root, so clicks and
// hover land in the modal and nowhere under it. On the cxx platform the modal's size comes only
// from its state, which starts at 0x0, so the host sets it: to the cover's size, again whenever
// the window resizes; or to the sheet's size, which the core works out from the content
// (`sheetSizer`). Escape and Cmd-W ask to close a sheet or a cover (onRequestClose), as a swipe down
// does on iOS.
//
// A sheet is an NSWindow sheet on the window (on its top sheet, so sheets stack), and takes the key
// focus while it is up; the window gets it back when it goes. Whatever the presentation, the focus
// moves into it when it opens (to the first view in its Tab order, `initialFocus`, else its
// container), Tab stays inside it, and the focus goes back to the view that held it when it closes
// (modal-focus.h). Its container is named by the modal's accessibility label, or a presented
// screen's title without one, and follows either as it changes. A cover sits below the title bar
// and the toolbar, and a transparent one leaves the screen under it showing.
//
// A modal with an `anchor` (desktop-modal.h) is a popover instead: an NSPopover at the anchor's
// view, whose content is the same kind of container. It takes the size of the modal's content
// root, measured at the window's size on the first commit and fitted on the next. A click outside
// closes it and asks to close (onRequestClose), as Escape does.
#pragma once

#import "host-view.h"

#include "ngn/desktop-props.h"
#include "ngn/input.h"

#include <functional>

@interface NGNModalHostView : NGNView
// Set once by the host: the input sink containers report to, and where the core learns which
// views root a container of their own.
@property (class, nonatomic) ngn::InputSink *input;
@property (class, nonatomic) std::function<void(NSInteger tag, BOOL presented)> presentationChanged;
// Finds the view an anchor names.
@property (class, nonatomic) std::function<NSView *(NSInteger tag)> viewForTag;
// The size a sheet takes for the modal `tag` on `surface`, on a window of `window`'s size
// (ngn::sheetSize).
@property (class, nonatomic) std::function<NSSize(NSInteger surface, NSInteger tag, NSSize window)> sheetSizer;
// The size a popover takes for its content, which the core works out (ngn::popoverSize).
@property (class, nonatomic) std::function<NSSize(NSInteger surface, NSInteger tag, NSSize window)> popoverSizer;

// What takes the focus when the modal rooted at `tag` opens: the first view in its Tab order, or
// nil for the container itself.
@property (class, nonatomic) std::function<NSResponder *(NSInteger tag)> initialFocus;

// The front in-window cover in `window`, or nil.
+ (NSView *)frontCoverIn:(NSWindow *)window;
// Whether `view` is a sheet's, a cover's or a popover's container.
+ (BOOL)isPresentationContainer:(NSView *)view;

// Fits each open popover and sheet to its content, after a transaction is mounted.
+ (void)fitPopovers;

// Called by the backend in place of inserting the view into its parent.
- (void)presentOver:(NSView *)parent;
- (void)dismiss;

// For a subclass that presents other content the same way (a presented screen).
// The sheet, cover or popover's container while presented, or nil.
@property (nonatomic, readonly) NSView *presentationView;
@property (nonatomic, readonly) ngn::ModalPresentation presentedAs;
// Escape, Cmd-W or a click outside a popover: asks the app to close it.
- (void)requestClose;
// Sets the size the content was given in layout: a modal's state by default.
- (void)applyPresentedSize:(NSSize)size;
// Where the content sits in its container, which the subclass may draw around: all of it by default.
- (NSRect)contentFrameIn:(NSRect)bounds;
// What a sheet adds to its content's size for what the subclass draws around it.
- (NSSize)chromeSize;
// Called once presented, before the app hears it.
- (void)didPresent;
// What names the presentation when the modal has no accessibility label of its own: nothing by
// default, a presented screen's header title.
- (std::string)presentationTitle;
// Names the presentation's container (presentation-label.h) as it opens, and again whenever its
// label or title changes.
- (void)labelPresentation;
@end
