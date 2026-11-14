// The AppKit controls behind `<text-input>`: NGNTextField for a single line, NGNTextView for
// multiline (whose owner, its delegate, answers textView:willCheckTextInRange: with
// NGNTextCheckingOptions). They apply the core's TextInputOptions (text-input.h) to AppKit's text checking,
// keep a field within maxLength and capitalize what is typed, draw a coloured placeholder, take a
// selection set from the props, focus themselves for autoFocus and tell their owner when they take
// the keyboard. No Fabric here, so they are tested on offscreen windows.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/text-input.h"

// The checks and substitutions `options` turns on or off on a text view: a multiline input, or the
// field editor while a field edits. An unset option leaves the text view at the user's setting.
void NGNApplyTextOptions(NSTextView *text, const ngn::TextInputOptions &options);

// What goes in for `replacement` at `range` of `current`: cut to maxLength (never through a
// composed character) and capitalized for `words` or `characters`. Empty when nothing fits.
NSString *NGNFitReplacement(NSString *current, NSRange range, NSString *replacement, const ngn::TextInputOptions &options);

// A text-checking delegate's options with `options`' capitalization: `none` turns the user's
// sentence capitalization off, on macOS 26 and later.
NSDictionary<NSTextCheckingOptionKey, id> *NGNTextCheckingOptions(
    NSDictionary<NSTextCheckingOptionKey, id> *checking,
    const ngn::TextInputOptions &options);

// A single-line field: an NSTextField, or an NSSecureTextField for secure entry, in a box that swaps
// one for the other.
@interface NGNTextField : NSView
// The NSTextField (or NSSecureTextField) now in the box. A swap carries its delegate over.
@property (nonatomic, readonly) NSTextField *control;
@property (nonatomic, copy) NSString *stringValue;
@property (nonatomic, strong) NSFont *font;
@property (nonatomic, readonly) NSText *currentEditor;
// An NSSecureTextField in place of the NSTextField (or back), keeping the text, its look, and the
// keyboard and selection while editing.
@property (nonatomic) BOOL secure;
// True while `secure` swaps the control, as the editing session that ends and starts again is not the
// user's.
@property (nonatomic, readonly) BOOL swapping;
// Focuses the field the first time it is in a window.
@property (nonatomic) BOOL autoFocus;
// Called when the field takes the keyboard.
@property (nonatomic, copy) void (^focused)(void);
- (void)applyOptions:(const ngn::TextInputOptions &)options;
- (const ngn::TextInputOptions &)options;
// Drawn in the field's font; nil colour is the system's placeholder colour.
- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color;
// Selects now while editing, or as editing starts.
- (void)selectRange:(NSRange)range;
@end

@interface NGNTextView : NSTextView
@property (nonatomic) BOOL autoFocus;
@property (nonatomic, copy) void (^focused)(void);
@property (nonatomic, copy, readonly) NSAttributedString *placeholder;
- (void)applyOptions:(const ngn::TextInputOptions &)options;
- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color;
- (void)selectRange:(NSRange)range;
@end
