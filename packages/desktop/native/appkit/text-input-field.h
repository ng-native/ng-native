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

// An editor that lets AppKit display marked text and fits the input method's final insertion.
@interface NGNInputEditor : NSTextView
- (std::optional<std::size_t>)compositionMaxLength;
@end

// A field editor that draws its text smoothed as `fontSmoothing` says (ngn::applyFontSmoothing), on
// TextKit 1, which draws the text in the view's own drawRect.
@interface NGNSmoothedFieldEditor : NGNInputEditor
@property (nonatomic) ngn::FontSmoothing fontSmoothing;
@end

// The field editor a cell whose text is smoothed as `smoothing` says edits in: `*editor`, made the
// first time, or nil for `auto`, which edits in the window's shared one.
NSTextView *NGNFieldEditorFor(ngn::FontSmoothing smoothing, NGNSmoothedFieldEditor *__strong *editor);

// A cell's interior drawn as `draw` draws it, with its text smoothed as `smoothing` says.
void NGNDrawSmoothed(ngn::FontSmoothing smoothing, void (^draw)(void));

// Editing in `control` ended and begun again, so it edits in the field editor its cell gives now,
// with its text and selection kept, and `*restarting` YES meanwhile, for the focus and blur that
// session sends to be left out. NO, with nothing done, while text is being composed, which ending
// would commit: call it again once the text changes.
BOOL NGNRestartEditing(NSTextField *control, BOOL *restarting);

// The field editor `control` is being edited in, or nil: the window's first responder, as
// `currentEditor` answers nil for it once the control is marked to be drawn again.
NSText *NGNEditorOf(NSControl *control);

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
// True while `secure` swaps the control, so the app can leave out the focus events of the swap.
@property (nonatomic, readonly) BOOL swapping;
// Focuses the field the first time it is in a window.
@property (nonatomic) BOOL autoFocus;
// Called when the field takes the keyboard.
@property (nonatomic, copy) void (^focused)(void);
// Called with each key typed into the field (NGNTypedKey), before the change is made.
@property (nonatomic, copy) void (^typed)(NSString *key);
// Whether its value is refused (aria-invalid), as VoiceOver reads it from the control.
@property (nonatomic) BOOL invalid;
// `-webkit-font-smoothing`, for the text drawn and the text being edited.
@property (nonatomic) ngn::FontSmoothing fontSmoothing;
- (void)applyOptions:(const ngn::TextInputOptions &)options;
- (const ngn::TextInputOptions &)options;
// Drawn in the field's font; nil colour is the system's placeholder colour.
- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color;
// The alignment and base writing direction of the text, while editing too, and of the placeholder.
- (void)setTextAlignment:(NSTextAlignment)alignment writingDirection:(NSWritingDirection)direction;
// Selects now while editing, or as editing starts.
- (void)selectRange:(NSRange)range;
@end

@interface NGNTextView : NGNInputEditor
@property (nonatomic) BOOL autoFocus;
// Called with each key typed into it (NGNTypedKey), before the change is made.
@property (nonatomic, copy) void (^typed)(NSString *key);
// Whether its value is refused (aria-invalid), as VoiceOver reads it.
@property (nonatomic) BOOL invalid;
@property (nonatomic, copy) void (^focused)(void);
@property (nonatomic, copy, readonly) NSAttributedString *placeholder;
// `-webkit-font-smoothing`, for the text and the placeholder.
@property (nonatomic) ngn::FontSmoothing fontSmoothing;
- (void)applyOptions:(const ngn::TextInputOptions &)options;
- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color;
// The alignment and base writing direction of the text, typed or set later too, and of the
// placeholder.
- (void)setTextAlignment:(NSTextAlignment)alignment writingDirection:(NSWritingDirection)direction;
- (void)selectRange:(NSRange)range;
@end
