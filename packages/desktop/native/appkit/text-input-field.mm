#import "text-input-field.h"

#import <objc/message.h>

using ngn::Capitalize;
using ngn::TextInputOptions;

void NGNApplyTextOptions(NSTextView *text, const TextInputOptions &options) {
  text.automaticSpellingCorrectionEnabled =
      options.autoCorrect.value_or(NSSpellChecker.isAutomaticSpellingCorrectionEnabled);
  text.automaticTextReplacementEnabled =
      options.autoCorrect.value_or(NSSpellChecker.isAutomaticTextReplacementEnabled);
  // AppKit has no user setting for checking spelling as you type; iOS checks by default.
  text.continuousSpellCheckingEnabled = options.spellCheck.value_or(true);
  text.automaticQuoteSubstitutionEnabled =
      options.smartQuotes.value_or(NSSpellChecker.isAutomaticQuoteSubstitutionEnabled);
  text.automaticDashSubstitutionEnabled =
      options.smartQuotes.value_or(NSSpellChecker.isAutomaticDashSubstitutionEnabled);
  text.smartInsertDeleteEnabled = options.smartInsertDelete.value_or(true);
}

namespace {

// Whether the character before `index` ends a word: the start, or white space.
bool atWordStart(NSString *text, NSUInteger index) {
  if (index == 0) {
    return true;
  }
  return [NSCharacterSet.whitespaceAndNewlineCharacterSet characterIsMember:[text characterAtIndex:index - 1]];
}

NSString *capitalizeWords(NSString *before, NSString *inserted) {
  NSMutableString *out = [NSMutableString string];
  __block bool wordStart = atWordStart(before, before.length);
  [inserted enumerateSubstringsInRange:NSMakeRange(0, inserted.length)
                               options:NSStringEnumerationByComposedCharacterSequences
                            usingBlock:^(NSString *piece, NSRange, NSRange, BOOL *) {
                              bool space = [NSCharacterSet.whitespaceAndNewlineCharacterSet
                                  characterIsMember:[piece characterAtIndex:0]];
                              [out appendString:wordStart && !space ? piece.localizedUppercaseString : piece];
                              wordStart = space;
                            }];
  return out;
}

} // namespace

NSString *NGNFitReplacement(NSString *current, NSRange range, NSString *replacement, const TextInputOptions &options) {
  NSString *out = replacement;
  if (options.capitalize == Capitalize::Characters) {
    out = out.localizedUppercaseString;
  } else if (options.capitalize == Capitalize::Words) {
    out = capitalizeWords([current substringToIndex:range.location], out);
  }
  NSUInteger fits = ngn::insertionThatFits(current.length, range.length, out.length, options.maxLength);
  if (fits < out.length) {
    // Never half of a surrogate pair or of a character with combining marks.
    if (fits > 0) {
      NSRange last = [out rangeOfComposedCharacterSequenceAtIndex:fits];
      fits = last.location;
    }
    out = [out substringToIndex:fits];
  }
  return out;
}

namespace {

// textView:shouldChangeTextInRange:replacementString: for either control: lets the change through
// when it needs nothing, inserts what fits in its place when it does, and refuses it when nothing
// does. Composition goes through untouched; its committed text is checked like any other.
BOOL shouldChange(NSTextView *text, NSRange range, NSString *replacement, const TextInputOptions &options, BOOL *inserting) {
  if (replacement == nil || *inserting || text.hasMarkedText) {
    return YES;
  }
  NSString *fitted = NGNFitReplacement(text.string, range, replacement, options);
  if ([fitted isEqualToString:replacement]) {
    return YES;
  }
  if (fitted.length > 0) {
    *inserting = YES;
    [text insertText:fitted replacementRange:range];
    *inserting = NO;
  } else {
    NSBeep();
  }
  return NO;
}

} // namespace

NSDictionary<NSTextCheckingOptionKey, id> *NGNTextCheckingOptions(
    NSDictionary<NSTextCheckingOptionKey, id> *options,
    const TextInputOptions &input) {
  if (@available(macOS 26.0, *)) {
    if (input.capitalize == Capitalize::None) {
      NSMutableDictionary *out = options ? [options mutableCopy] : [NSMutableDictionary dictionary];
      out[NSTextCheckingAutomaticCapitalizationEnabledKey] = @NO;
      return out;
    }
  }
  return options;
}

#pragma mark - NGNTextField

@interface NGNTextField ()
- (void)controlDidBecomeFirstResponder;
@end

// The two controls a field swaps between. AppKit's secure field editor takes only an
// NSSecureTextField as its delegate, so each is a subclass of its own, with the same few
// overrides: they report focus to their box, and keep the shared field editor to its options.
#define NGN_FIELD_CONTROL_METHODS                                                                          \
  -(BOOL)becomeFirstResponder {                                                                            \
    if (![super becomeFirstResponder]) {                                                                   \
      return NO;                                                                                           \
    }                                                                                                      \
    [self.box controlDidBecomeFirstResponder];                                                             \
    return YES;                                                                                            \
  }                                                                                                        \
  -(BOOL)textView : (NSTextView *)textView shouldChangeTextInRange : (NSRange)range replacementString      \
      : (NSString *)string {                                                                               \
    static const TextInputOptions none{};                                                                  \
    return NGNControlShouldChangeText(                                                                     \
        self, self.superclass, textView, range, string, self.box ? self.box.options : none, &_inserting);  \
  }                                                                                                        \
  -(NSDictionary<NSTextCheckingOptionKey, id> *)textView : (NSTextView *)view willCheckTextInRange         \
      : (NSRange)range options : (NSDictionary<NSTextCheckingOptionKey, id> *)options types                 \
      : (NSTextCheckingTypes *)checkingTypes {                                                             \
    return self.box ? NGNTextCheckingOptions(options, self.box.options) : options;                         \
  }

#define NGN_FIELD_CELL_METHODS                                                                             \
  -(NSText *)setUpFieldEditorAttributes : (NSText *)text {                                                 \
    NSText *out = [super setUpFieldEditorAttributes:text];                                                 \
    NGNTextField *box = [self.controlView respondsToSelector:@selector(box)]                               \
        ? [(id)self.controlView box]                                                                       \
        : nil;                                                                                             \
    if (box && [out isKindOfClass:NSTextView.class]) {                                                     \
      NGNApplyTextOptions((NSTextView *)out, box.options);                                                 \
    }                                                                                                      \
    return out;                                                                                            \
  }

namespace {

// NSTextField's own textView:shouldChangeTextInRange:replacementString: (a formatter's partial
// validation), which no header declares.
BOOL callSuperShouldChange(id self, Class superclass, NSTextView *textView, NSRange range, NSString *string) {
  if (![superclass instancesRespondToSelector:@selector(textView:shouldChangeTextInRange:replacementString:)]) {
    return YES;
  }
  struct objc_super base = {self, superclass};
  auto send = reinterpret_cast<BOOL (*)(struct objc_super *, SEL, NSTextView *, NSRange, NSString *)>(objc_msgSendSuper);
  return send(&base, @selector(textView:shouldChangeTextInRange:replacementString:), textView, range, string);
}

} // namespace

BOOL NGNControlShouldChangeText(
    NSControl *control,
    Class superclass,
    NSTextView *editor,
    NSRange range,
    NSString *replacement,
    const TextInputOptions &options,
    BOOL *inserting) {
  return callSuperShouldChange(control, superclass, editor, range, replacement) &&
      shouldChange(editor, range, replacement, options, inserting);
}

@interface NGNPlainFieldCell : NSTextFieldCell
@end
@interface NGNSecureFieldCell : NSSecureTextFieldCell
@end

@interface NGNPlainField : NSTextField
@property (nonatomic, weak) NGNTextField *box;
@end
@interface NGNSecureField : NSSecureTextField
@property (nonatomic, weak) NGNTextField *box;
@end

@implementation NGNPlainField {
  BOOL _inserting;
}
+ (Class)cellClass {
  return NGNPlainFieldCell.class;
}
NGN_FIELD_CONTROL_METHODS
@end

@implementation NGNSecureField {
  BOOL _inserting;
}
+ (Class)cellClass {
  return NGNSecureFieldCell.class;
}
NGN_FIELD_CONTROL_METHODS
@end

@implementation NGNPlainFieldCell
NGN_FIELD_CELL_METHODS
@end

@implementation NGNSecureFieldCell
NGN_FIELD_CELL_METHODS
@end

@implementation NGNTextField {
  TextInputOptions _options;
  NSRange _pendingSelection;
  BOOL _autoFocused;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _pendingSelection = NSMakeRange(NSNotFound, 0);
    NGNPlainField *control = [[NGNPlainField alloc] initWithFrame:self.bounds];
    control.box = self;
    _control = control;
    _control.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_control];
  }
  return self;
}

- (NSString *)stringValue {
  return _control.stringValue;
}

- (void)setStringValue:(NSString *)stringValue {
  _control.stringValue = stringValue;
}

- (NSFont *)font {
  return _control.font;
}

- (void)setFont:(NSFont *)font {
  _control.font = font;
}

- (NSText *)currentEditor {
  return _control.currentEditor;
}

- (void)applyOptions:(const TextInputOptions &)options {
  _options = options;
  if ([_control.currentEditor isKindOfClass:NSTextView.class]) {
    NGNApplyTextOptions((NSTextView *)_control.currentEditor, _options);
  }
}

- (const TextInputOptions &)options {
  return _options;
}

- (void)setSecure:(BOOL)secure {
  if (secure == _secure) {
    return;
  }
  _secure = secure;
  NSTextField *old = _control;
  NSText *editor = old.currentEditor;
  NSRange selection = editor ? editor.selectedRange : NSMakeRange(NSNotFound, 0);
  NSString *value = old.stringValue;
  _swapping = YES;
  if (editor) {
    [self.window makeFirstResponder:nil];
  }
  NSTextField *control;
  if (secure) {
    NGNSecureField *field = [[NGNSecureField alloc] initWithFrame:old.frame];
    field.box = self;
    control = field;
  } else {
    NGNPlainField *field = [[NGNPlainField alloc] initWithFrame:old.frame];
    field.box = self;
    control = field;
  }
  control.autoresizingMask = old.autoresizingMask;
  control.font = old.font;
  control.textColor = old.textColor;
  control.alignment = old.alignment;
  control.placeholderAttributedString = old.placeholderAttributedString;
  control.editable = old.editable;
  control.selectable = old.selectable;
  control.bezeled = old.bezeled;
  control.bordered = old.bordered;
  control.drawsBackground = old.drawsBackground;
  control.backgroundColor = old.backgroundColor;
  control.focusRingType = old.focusRingType;
  control.usesSingleLineMode = old.usesSingleLineMode;
  control.cell.scrollable = old.cell.scrollable;
  control.cell.wraps = old.cell.wraps;
  control.lineBreakMode = old.lineBreakMode;
  control.delegate = old.delegate;
  control.stringValue = value;
  old.delegate = nil;
  [self replaceSubview:old with:control];
  _control = control;
  if (editor) {
    [self.window makeFirstResponder:control];
    if (selection.location != NSNotFound && NSMaxRange(selection) <= value.length) {
      control.currentEditor.selectedRange = selection;
    }
  }
  _swapping = NO;
}

- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color {
  if (placeholder.length == 0) {
    _control.placeholderAttributedString = nil;
    return;
  }
  NSFont *font = _control.font ? _control.font : [NSFont systemFontOfSize:NSFont.systemFontSize];
  _control.placeholderAttributedString = [[NSAttributedString alloc]
      initWithString:placeholder
          attributes:@{
            NSFontAttributeName : font,
            NSForegroundColorAttributeName : color ? color : NSColor.placeholderTextColor,
          }];
}

- (void)selectRange:(NSRange)range {
  NSText *editor = _control.currentEditor;
  if (editor) {
    if (NSMaxRange(range) <= _control.stringValue.length) {
      editor.selectedRange = range;
    }
  } else {
    _pendingSelection = range;
  }
}

- (void)controlDidBecomeFirstResponder {
  if (_pendingSelection.location != NSNotFound && _control.currentEditor &&
      NSMaxRange(_pendingSelection) <= _control.stringValue.length) {
    _control.currentEditor.selectedRange = _pendingSelection;
  }
  _pendingSelection = NSMakeRange(NSNotFound, 0);
  if (!_swapping && self.focused) {
    self.focused();
  }
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (_autoFocus && !_autoFocused && self.window) {
    _autoFocused = YES;
    [self.window makeFirstResponder:_control];
  }
}

@end

#pragma mark - NGNTextView

@implementation NGNTextView {
  TextInputOptions _options;
  BOOL _autoFocused;
  BOOL _inserting;
}

- (void)applyOptions:(const TextInputOptions &)options {
  _options = options;
  NGNApplyTextOptions(self, _options);
}

- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color {
  NSAttributedString *next = nil;
  if (placeholder.length > 0) {
    next = [[NSAttributedString alloc]
        initWithString:placeholder
            attributes:@{
              NSFontAttributeName : self.font ? self.font : [NSFont systemFontOfSize:NSFont.systemFontSize],
              NSForegroundColorAttributeName : color ? color : NSColor.placeholderTextColor,
            }];
  }
  if (![next isEqualToAttributedString:_placeholder] && !(next == nil && _placeholder == nil)) {
    _placeholder = [next copy];
    self.needsDisplay = YES;
  }
}

- (void)selectRange:(NSRange)range {
  if (NSMaxRange(range) <= self.string.length) {
    self.selectedRange = range;
  }
}

- (void)drawRect:(NSRect)dirtyRect {
  [super drawRect:dirtyRect];
  if (_placeholder && self.string.length == 0) {
    NSPoint origin = self.textContainerOrigin;
    CGFloat padding = self.textContainer.lineFragmentPadding;
    NSRect rect = NSMakeRect(
        origin.x + padding, origin.y, NSWidth(self.bounds) - origin.x * 2 - padding * 2, NSHeight(self.bounds) - origin.y);
    [_placeholder drawWithRect:rect options:NSStringDrawingUsesLineFragmentOrigin];
  }
}

- (void)didChangeText {
  [super didChangeText];
  if (_placeholder) {
    self.needsDisplay = YES;
  }
}

- (BOOL)shouldChangeTextInRange:(NSRange)range replacementString:(NSString *)string {
  if (![super shouldChangeTextInRange:range replacementString:string]) {
    return NO;
  }
  return shouldChange(self, range, string, _options, &_inserting);
}

- (BOOL)becomeFirstResponder {
  if (![super becomeFirstResponder]) {
    return NO;
  }
  if (self.focused) {
    self.focused();
  }
  return YES;
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (_autoFocus && !_autoFocused && self.window) {
    _autoFocused = YES;
    [self.window makeFirstResponder:self];
  }
}

@end
