#include <dlfcn.h>
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

std::u16string units(NSString *text) {
  std::u16string out(text.length, u'\0');
  [text getCharacters:reinterpret_cast<unichar *>(out.data()) range:NSMakeRange(0, text.length)];
  return out;
}

NSString *nsUnits(const std::u16string &text) {
  return [NSString stringWithCharacters:reinterpret_cast<const unichar *>(text.data()) length:text.size()];
}

// Foundation's capitals, in the user's locale, and its composed character sequences. Made for one
// fit, in which the strings it is asked about do not change: each is made a Foundation string
// once, not once for every character asked about.
struct FoundationCharacters final : ngn::TextCharacters {
  std::u16string uppercase(const std::u16string &text) const override {
    return units(nsUnits(text).localizedUppercaseString);
  }
  std::pair<std::size_t, std::size_t> characterAt(const std::u16string &text, std::size_t index) const override {
    if (text.data() != convertedFrom_ || text.size() != convertedSize_) {
      converted_ = nsUnits(text);
      convertedFrom_ = text.data();
      convertedSize_ = text.size();
    }
    NSRange range = [converted_ rangeOfComposedCharacterSequenceAtIndex:index];
    return {range.location, range.length};
  }

 private:
  mutable NSString *converted_;
  mutable const char16_t *convertedFrom_{nullptr};
  mutable std::size_t convertedSize_{0};
};

// A placeholder in `font` and `color` (nil is the system's placeholder colour), aligned and
// directed as the text is, the way React Native iOS gives it the text's paragraph style. Nil when
// there is no placeholder.
NSAttributedString *placeholderString(
    NSString *placeholder,
    NSFont *font,
    NSColor *color,
    NSTextAlignment alignment,
    NSWritingDirection direction) {
  if (placeholder.length == 0) {
    return nil;
  }
  NSMutableParagraphStyle *style = [NSParagraphStyle.defaultParagraphStyle mutableCopy];
  style.alignment = alignment;
  style.baseWritingDirection = direction;
  return [[NSAttributedString alloc]
      initWithString:placeholder
          attributes:@{
            NSFontAttributeName : font ? font : [NSFont systemFontOfSize:NSFont.systemFontSize],
            NSForegroundColorAttributeName : color ? color : NSColor.placeholderTextColor,
            NSParagraphStyleAttributeName : style,
          }];
}

} // namespace

NSString *NGNFitReplacement(NSString *current, NSRange range, NSString *replacement, const TextInputOptions &options) {
  return nsUnits(ngn::fitReplacement(units(current), range.location, range.length, units(replacement), options, FoundationCharacters{}));
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

NSString *NGNAutomaticCapitalizationKey() {
  static NSString *key = [] {
    auto symbol = static_cast<NSString *__unsafe_unretained *>(
        dlsym(RTLD_DEFAULT, "NSTextCheckingAutomaticCapitalizationEnabledKey"));
    return symbol != nullptr ? *symbol : nil;
  }();
  return key;
}

NSDictionary<NSTextCheckingOptionKey, id> *NGNTextCheckingOptions(
    NSDictionary<NSTextCheckingOptionKey, id> *options,
    const TextInputOptions &input) {
  // Looked up at run time: the key is newer than some macOS 26 SDKs, so naming it would stop a host
  // built against one of those, and a system without it leaves capitalization to the user.
  NSString *key = NGNAutomaticCapitalizationKey();
  if (key != nil && input.capitalize == Capitalize::None) {
    NSMutableDictionary *out = options ? [options mutableCopy] : [NSMutableDictionary dictionary];
    out[key] = @NO;
    return out;
  }
  return options;
}

#pragma mark - NGNTextField

@interface NGNTextField ()
- (void)controlDidBecomeFirstResponder;
- (void)controlDidEndEditing;
@end

// WebKit's AXInvalid, which AppKit has no property for, said as `invalid` is: a field whose value
// is refused (aria-invalid).
#define NGN_INVALID_ATTRIBUTE_METHODS(invalid)                                                             \
  _Pragma("clang diagnostic push") _Pragma("clang diagnostic ignored \"-Wdeprecated-declarations\"")         \
  -(NSArray<NSAccessibilityAttributeName> *)accessibilityAttributeNames {                                   \
    NSArray *names = [super accessibilityAttributeNames];                                                  \
    return [names containsObject:@"AXInvalid"] ? names : [names arrayByAddingObject:@"AXInvalid"];         \
  }                                                                                                        \
  -(id)accessibilityAttributeValue : (NSAccessibilityAttributeName)attribute {                             \
    if ([attribute isEqualToString:@"AXInvalid"]) {                                                        \
      return (invalid) ? @"true" : @"false";                                                               \
    }                                                                                                      \
    return [super accessibilityAttributeValue:attribute];                                                  \
  }                                                                                                        \
  _Pragma("clang diagnostic pop")

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
  -(void)textDidEndEditing : (NSNotification *)note {                                                      \
    [super textDidEndEditing:note];                                                                        \
    [self.box controlDidEndEditing];                                                                       \
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
  }                                                                                                        \
  NGN_INVALID_ATTRIBUTE_METHODS(self.box.invalid)

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
  NSString *_placeholder;
  NSColor *_placeholderColor;
  NSTextAlignment _alignment;
  NSWritingDirection _writingDirection;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _alignment = NSTextAlignmentNatural;
    _writingDirection = NSWritingDirectionNatural;
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
  control.alignment = _alignment;
  control.baseWritingDirection = _writingDirection;
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
  _placeholder = [placeholder copy];
  _placeholderColor = color;
  _control.placeholderAttributedString =
      placeholderString(placeholder, _control.font, color, _alignment, _writingDirection);
}

- (void)setTextAlignment:(NSTextAlignment)alignment writingDirection:(NSWritingDirection)direction {
  BOOL changed = alignment != _alignment || direction != _writingDirection;
  _alignment = alignment;
  _writingDirection = direction;
  // Setting a control's alignment while it edits ends the editing, so the field editor takes it
  // now, and the control as the editing ends (the field editor takes the control's as it starts).
  // An editing aborted tells the control nothing, so a control out of step is put right on the
  // next request, though the request has not changed.
  if (NSText *editor = _control.currentEditor) {
    if (changed) {
      editor.alignment = alignment;
      editor.baseWritingDirection = direction;
    }
  } else {
    [self alignControl];
  }
  if (changed) {
    [self setPlaceholder:_placeholder color:_placeholderColor];
  }
}

- (void)alignControl {
  if (_control.alignment != _alignment) {
    _control.alignment = _alignment;
  }
  if (_control.baseWritingDirection != _writingDirection) {
    _control.baseWritingDirection = _writingDirection;
  }
}

- (void)controlDidEndEditing {
  [self alignControl];
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
  NSString *_placeholderText;
  NSColor *_placeholderColor;
  NSTextAlignment _textAlignment;
  NSWritingDirection _writingDirection;
}

NGN_INVALID_ATTRIBUTE_METHODS(self.invalid)

- (instancetype)initWithFrame:(NSRect)frame textContainer:(NSTextContainer *)container {
  if ((self = [super initWithFrame:frame textContainer:container])) {
    _textAlignment = NSTextAlignmentNatural;
    _writingDirection = NSWritingDirectionNatural;
  }
  return self;
}

- (void)applyOptions:(const TextInputOptions &)options {
  _options = options;
  NGNApplyTextOptions(self, _options);
}

- (void)setTextAlignment:(NSTextAlignment)alignment writingDirection:(NSWritingDirection)direction {
  if (alignment == _textAlignment && direction == _writingDirection) {
    return;
  }
  _textAlignment = alignment;
  _writingDirection = direction;
  // The text there is now, and what is typed or set later (a plain text view's typing attributes).
  self.alignment = alignment;
  self.baseWritingDirection = direction;
  [self setPlaceholder:_placeholderText color:_placeholderColor];
}

- (void)setPlaceholder:(NSString *)placeholder color:(NSColor *)color {
  _placeholderText = [placeholder copy];
  _placeholderColor = color;
  NSAttributedString *next = placeholderString(placeholder, self.font, color, _textAlignment, _writingDirection);
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
