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
// The text checking key that overrides the user's automatic capitalization, or nil where the
// system has none.
NSString *NGNAutomaticCapitalizationKey();

NSDictionary<NSTextCheckingOptionKey, id> *NGNTextCheckingOptions(
    NSDictionary<NSTextCheckingOptionKey, id> *checking,
    const ngn::TextInputOptions &options);

// The key a text command is sent for, as `(keyPress)` names it (the web's KeyboardEvent.key):
// Return, Backspace, Escape and the arrows, alone or with Shift. Nil for any other command, such
// as one Option or Command sends, and for Tab, which the host's key monitor takes before the field
// and sends itself (NGNSendTextInputKeyPress).
NSString *NGNKeyForCommand(SEL command);

// A change to a field's text as `(keyPress)` names it, React Native iOS's way: the text a keystroke
// or an input method put in. Nil for a change `current` (NSApp's event) shows was not typed (Command
// held, as for a paste, or a mouse event, as for the Edit menu or a drop), for a deletion, Return
// and Tab (NGNKeyForCommand names those), and while an input method is composing.
NSString *NGNTypedKey(NSString *replacement, NSEvent *current, BOOL composing);

// textView:shouldChangeTextInRange:replacementString: for an NSTextField subclass whose field editor
// `editor` is: `superclass`'s answer (a formatter's), then NGNFitReplacement's, putting what fits in
// place of the change when it differs. `inserting` is the control's own flag for that re-entry.
BOOL NGNControlShouldChangeText(
    NSControl *control,
    Class superclass,
    NSTextView *editor,
    NSRange range,
    NSString *replacement,
    const ngn::TextInputOptions &options,
    BOOL *inserting);

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
// Called with each key typed into the field (NGNTypedKey), before the change is made.
@property (nonatomic, copy) void (^typed)(NSString *key);
// Whether its value is refused (aria-invalid), as VoiceOver reads it from the control.
@property (nonatomic) BOOL invalid;
- (void)applyOptions:(const ngn::TextInputOptions &)options;
- (const ngn::TextInputOptions &)options;
// Drawn in the field's font; nil colour is the system's placeholder colour.
- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color;
// The alignment and base writing direction of the text, while editing too, and of the placeholder.
- (void)setTextAlignment:(NSTextAlignment)alignment writingDirection:(NSWritingDirection)direction;
// Selects now while editing, or as editing starts.
- (void)selectRange:(NSRange)range;
@end

@interface NGNTextView : NSTextView
@property (nonatomic) BOOL autoFocus;
// Called with each key typed into it (NGNTypedKey), before the change is made.
@property (nonatomic, copy) void (^typed)(NSString *key);
// Whether its value is refused (aria-invalid), as VoiceOver reads it.
@property (nonatomic) BOOL invalid;
@property (nonatomic, copy) void (^focused)(void);
@property (nonatomic, copy, readonly) NSAttributedString *placeholder;
- (void)applyOptions:(const ngn::TextInputOptions &)options;
- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color;
// The alignment and base writing direction of the text, typed or set later too, and of the
// placeholder.
- (void)setTextAlignment:(NSTextAlignment)alignment writingDirection:(NSWritingDirection)direction;
- (void)selectRange:(NSRange)range;
@end
