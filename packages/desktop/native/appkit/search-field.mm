#import "search-field.h"

#import "text-input-field.h"

using ngn::ControlSize;
using ngn::NativeControlProps;

namespace {

NSControlSize controlSize(ControlSize size) {
  switch (size) {
    case ControlSize::Mini:
      return NSControlSizeMini;
    case ControlSize::Small:
      return NSControlSizeSmall;
    case ControlSize::Large:
      return NSControlSizeLarge;
    case ControlSize::Regular:
      return NSControlSizeRegular;
  }
  return NSControlSizeRegular;
}

NSString *string(const std::string &s) {
  NSString *out = [NSString stringWithUTF8String:s.c_str()];
  return out != nil ? out : @"";
}

// A CSS weight as AppKit's nearest, as the iOS field maps it to UIKit's.
NSFontWeight fontWeight(int css) {
  static const NSFontWeight weights[] = {
      NSFontWeightUltraLight,
      NSFontWeightThin,
      NSFontWeightLight,
      NSFontWeightRegular,
      NSFontWeightMedium,
      NSFontWeightSemibold,
      NSFontWeightBold,
      NSFontWeightHeavy,
      NSFontWeightBlack};
  long index = std::lround(css / 100.0) - 1;
  return weights[std::clamp<long>(index, 0, 8)];
}

ngn::TextInputOptions inputOptions(const NativeControlProps &p) {
  ngn::TextInputOptions options{.capitalize = ngn::Capitalize::None};
  if (p.autoCapitalize == "words") {
    options.capitalize = ngn::Capitalize::Words;
  } else if (p.autoCapitalize == "sentences") {
    options.capitalize = ngn::Capitalize::Sentences;
  } else if (p.autoCapitalize == "characters") {
    options.capitalize = ngn::Capitalize::Characters;
  }
  return options;
}

} // namespace

NSFont *NGNSearchFieldFont(const NativeControlProps &p) {
  CGFloat base = [NSFont systemFontSizeForControlSize:controlSize(p.controlSize)];
  CGFloat size = p.fontSize ? static_cast<CGFloat>(*p.fontSize) : base;
  NSFont *font = p.fontWeight ? [NSFont systemFontOfSize:size weight:fontWeight(*p.fontWeight)] : [NSFont systemFontOfSize:size];
  if (p.fontFamily == "monospace" || p.fontFamily == "ui-monospace") {
    // The system's monospaced face, as a paragraph draws both (text-layout.mm).
    font = [NSFont monospacedSystemFontOfSize:size weight:p.fontWeight ? fontWeight(*p.fontWeight) : NSFontWeightRegular];
  } else if (!p.fontFamily.empty()) {
    NSString *family = string(p.fontFamily);
    NSFont *named = [NSFont fontWithName:family size:size];
    NSString *familyName = named ? named.familyName : ([NSFontManager.sharedFontManager availableMembersOfFontFamily:family] ? family : nil);
    if (familyName && p.fontWeight) {
      NSFontDescriptor *descriptor = [NSFontDescriptor fontDescriptorWithFontAttributes:@{
        NSFontFamilyAttribute : familyName,
        NSFontTraitsAttribute : @{NSFontWeightTrait : @(fontWeight(*p.fontWeight))},
      }];
      NSFont *weighted = [NSFont fontWithDescriptor:descriptor size:size];
      font = weighted ? weighted : font;
    } else if (named) {
      font = named;
    } else if (familyName) {
      NSFontDescriptor *descriptor = [NSFontDescriptor fontDescriptorWithFontAttributes:@{NSFontFamilyAttribute : familyName}];
      NSFont *found = [NSFont fontWithDescriptor:descriptor size:size];
      font = found ? found : font;
    }
  }
  if (p.italic) {
    font = [NSFontManager.sharedFontManager convertFont:font toHaveTrait:NSItalicFontMask];
  }
  return font;
}

NSSize NGNSearchFieldSize(const NativeControlProps &p) {
  @autoreleasepool {
    NSSearchFieldCell *cell = [[NSSearchFieldCell alloc] initTextCell:string(p.text)];
    cell.controlSize = controlSize(p.controlSize);
    cell.font = NGNSearchFieldFont(p);
    cell.placeholderString = string(p.placeholder);
    cell.bezeled = YES;
    cell.editable = YES;
    NSSize size = cell.cellSize;
    // The cell keeps its control size's height whatever the font, so a larger face gets the
    // padding the control size's own font has around it.
    NSFont *system = [NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:cell.controlSize]];
    auto lineHeight = [](NSFont *font) { return std::ceil(font.ascender - font.descender + font.leading); };
    CGFloat padding = size.height - lineHeight(system);
    CGFloat height = std::max<CGFloat>(size.height, lineHeight(cell.font) + padding);
    return NSMakeSize(std::ceil(size.width), std::ceil(height));
  }
}

@interface NGNSearchField () <NSSearchFieldDelegate>
- (const ngn::TextInputOptions &)options;
- (void)fieldDidBecomeFirstResponder;
@end

// The field itself: it tells its box when it takes the keyboard, and keeps the shared field editor
// to its capitalization.
@interface NGNSearchControl : NSSearchField
@property (nonatomic, weak) NGNSearchField *box;
@end

// The field's cell, which draws its text smoothed as the box says, and edits it in a field editor
// that draws it so while it is not smoothed as the system smooths it.
@interface NGNSearchFieldCell : NSSearchFieldCell
@end

@implementation NGNSearchFieldCell {
  NGNSmoothedFieldEditor *_editor;
}

- (ngn::FontSmoothing)fontSmoothing {
  id control = self.controlView;
  return [control isKindOfClass:NGNSearchControl.class] ? ((NGNSearchControl *)control).box.fontSmoothing
                                                         : ngn::FontSmoothing::Auto;
}

- (void)drawInteriorWithFrame:(NSRect)frame inView:(NSView *)view {
  NGNDrawSmoothed(self.fontSmoothing, ^{
    [super drawInteriorWithFrame:frame inView:view];
  });
}

- (NSTextView *)fieldEditorForView:(NSView *)view {
  NSTextView *own = NGNFieldEditorFor(self.fontSmoothing, &_editor);
  return own != nil ? own : [super fieldEditorForView:view];
}

@end

@implementation NGNSearchControl {
  BOOL _inserting;
}

+ (Class)cellClass {
  return NGNSearchFieldCell.class;
}

- (BOOL)becomeFirstResponder {
  if (![super becomeFirstResponder]) {
    return NO;
  }
  [self.box fieldDidBecomeFirstResponder];
  return YES;
}

- (BOOL)textView:(NSTextView *)textView shouldChangeTextInRange:(NSRange)range replacementString:(NSString *)string {
  static const ngn::TextInputOptions none{};
  return NGNControlShouldChangeText(
      self, NSSearchField.class, textView, range, string, self.box ? self.box.options : none, &_inserting);
}

- (NSDictionary<NSTextCheckingOptionKey, id> *)textView:(NSTextView *)view
                                   willCheckTextInRange:(NSRange)range
                                                options:(NSDictionary<NSTextCheckingOptionKey, id> *)options
                                                  types:(NSTextCheckingTypes *)checkingTypes {
  return self.box ? NGNTextCheckingOptions(options, self.box.options) : options;
}

@end

@implementation NGNSearchField {
  ngn::TextInputOptions _options;
  NSColor *_tint;
  int _eventCount;
  CGFloat _height;
  // Counts the editing ends: only the latest one's turn-later check may report a blur.
  NSUInteger _endings;
  // An editing session begun in the shared field editor, to begin again in the field's own, and
  // whether it is beginning again, which is no focus.
  BOOL _restartPending;
  BOOL _restarting;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    NGNSearchControl *field = [[NGNSearchControl alloc] initWithFrame:self.bounds];
    field.box = self;
    field.delegate = self;
    field.sendsWholeSearchString = YES;
    _field = field;
    [self addSubview:field];
    [self takeCancelButton];
  }
  return self;
}

- (const ngn::TextInputOptions &)options {
  return _options;
}

// The clear button empties the field through `cancel`, so JavaScript hears the text and the cancel.
- (void)takeCancelButton {
  NSButtonCell *cancel = ((NSSearchFieldCell *)_field.cell).cancelButtonCell;
  cancel.target = self;
  cancel.action = @selector(cancel);
}

- (void)apply:(const NativeControlProps &)p {
  _field.controlSize = controlSize(p.controlSize);
  _field.font = NGNSearchFieldFont(p);
  if (p.desktop.fontSmoothing != _fontSmoothing) {
    _fontSmoothing = p.desktop.fontSmoothing;
    _field.needsDisplay = YES;
    NSText *editor = NGNEditorOf(_field);
    if ([editor isKindOfClass:NGNSmoothedFieldEditor.class]) {
      ((NGNSmoothedFieldEditor *)editor).fontSmoothing = _fontSmoothing;
      editor.needsDisplay = YES;
    } else {
      _restartPending = YES;
      [self restartInOwnEditor];
    }
  }
  NSString *placeholder = string(p.placeholder);
  if (![_field.placeholderString isEqualToString:placeholder]) {
    _field.placeholderString = placeholder;
  }
  _options = inputOptions(p);
  if (p.tintColor) {
    auto c = facebook::react::colorComponentsFromColor(p.tintColor);
    _tint = [NSColor colorWithSRGBRed:c.red green:c.green blue:c.blue alpha:c.alpha];
  } else {
    _tint = nil;
  }
  [self applyTint];
  if (!p.enabled) {
    [self blur]; // before AppKit ends the editing silently
  }
  _field.enabled = p.enabled;
  NSString *text = string(p.text);
  NSText *editor = _field.currentEditor;
  BOOL composing = [editor isKindOfClass:NSTextView.class] && [(NSTextView *)editor hasMarkedText];
  if (ngn::controlledTextIsCurrent(p.mostRecentEventCount, _eventCount, composing) && ![_field.stringValue isEqualToString:text]) {
    _field.stringValue = text;
  }
  [self takeCancelButton];
  _height = NGNSearchFieldSize(p).height;
  [self layoutField];
}

- (void)applyTint {
  if ([_field.currentEditor isKindOfClass:NSTextView.class]) {
    ((NSTextView *)_field.currentEditor).insertionPointColor = _tint ? _tint : NSColor.textColor;
  }
}

- (void)layoutField {
  // Its own height at its control size and font, centred in the box Yoga gives it.
  CGFloat own = _height > 0 ? _height : _field.intrinsicContentSize.height;
  CGFloat height = std::min<CGFloat>(NSHeight(self.bounds), own);
  _field.frame = NSMakeRect(0, std::round((NSHeight(self.bounds) - height) / 2), NSWidth(self.bounds), height);
}

- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  [self layoutField];
}

- (void)focus {
  [self.window makeFirstResponder:_field];
}

- (void)blur {
  if (_field.currentEditor) {
    [self.window makeFirstResponder:nil];
  }
}

- (void)fieldDidBecomeFirstResponder {
  [self applyTint];
  if (!_restarting && self.began) {
    self.began();
  }
}

- (void)cancel {
  if (_field.stringValue.length > 0) {
    _field.stringValue = @"";
    [self changedTo:@""];
  }
  if (self.cancelled) {
    self.cancelled();
  }
}

- (void)changedTo:(NSString *)text {
  _eventCount++;
  if (self.changed) {
    self.changed(text, _eventCount);
  }
}

- (void)controlTextDidChange:(NSNotification *)note {
  [self changedTo:_field.stringValue];
  if (_restartPending) {
    // A turn later, out of the text system's change.
    __weak NGNSearchField *weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf restartInOwnEditor];
    });
  }
}

// Editing begun under auto, in the shared field editor, which draws as the system smooths, moves
// to the field's own once its text is smoothed otherwise.
- (void)restartInOwnEditor {
  NSText *editor = NGNEditorOf(_field);
  if (!_restartPending || editor == nil || _fontSmoothing == ngn::FontSmoothing::Auto ||
      [editor isKindOfClass:NGNSmoothedFieldEditor.class]) {
    _restartPending = NO;
    return;
  }
  _restartPending = !NGNRestartEditing(_field, &_restarting);
}

// A turn later, and only when the field no longer edits: a click into the field ends its editing
// and starts it again at the click's point, which is no blur.
- (void)controlTextDidEndEditing:(NSNotification *)note {
  __weak NGNSearchField *weakSelf = self;
  NSUInteger ending = ++_endings;
  dispatch_async(dispatch_get_main_queue(), ^{
    NGNSearchField *strongSelf = weakSelf;
    if (strongSelf != nil && strongSelf->_endings == ending && strongSelf.field.currentEditor == nil && strongSelf.ended) {
      strongSelf.ended();
    }
  });
}

- (BOOL)control:(NSControl *)control textView:(NSTextView *)textView doCommandBySelector:(SEL)selector {
  if (selector == @selector(insertNewline:)) {
    if (self.submitted) {
      self.submitted(_field.stringValue);
    }
    return YES;
  }
  if (selector == @selector(cancelOperation:)) {
    [self cancel];
    return YES;
  }
  return NO;
}

@end
