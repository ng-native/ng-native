#import "search-toolbar-item.h"

#import "text-input-field.h"

#include <react/renderer/graphics/Color.h>

namespace {

NSString *string(const std::string &s) {
  NSString *out = [NSString stringWithUTF8String:s.c_str()];
  return out != nil ? out : @"";
}

NSColor *color(const facebook::react::SharedColor &value) {
  if (!value) {
    return nil;
  }
  auto c = facebook::react::colorComponentsFromColor(value);
  return [NSColor colorWithSRGBRed:c.red green:c.green blue:c.blue alpha:c.alpha];
}

// systemDefault is none, as UIKit's default for a search bar is.
ngn::TextInputOptions inputOptions(const std::string &autoCapitalize) {
  ngn::TextInputOptions options{.capitalize = ngn::Capitalize::None};
  if (autoCapitalize == "words") {
    options.capitalize = ngn::Capitalize::Words;
  } else if (autoCapitalize == "sentences") {
    options.capitalize = ngn::Capitalize::Sentences;
  } else if (autoCapitalize == "characters") {
    options.capitalize = ngn::Capitalize::Characters;
  }
  return options;
}

} // namespace

@interface NGNSearchToolbarItem () <NSSearchFieldDelegate>
- (const ngn::TextInputOptions &)options;
- (void)fieldDidBecomeFirstResponder;
@end

// The item's field: it tells the item when it takes the keyboard, and keeps the shared field editor
// to the item's capitalization.
@interface NGNSearchBarField : NSSearchField
@property (nonatomic, weak) NGNSearchToolbarItem *item;
@end

@implementation NGNSearchBarField {
  BOOL _inserting;
}

- (BOOL)becomeFirstResponder {
  if (![super becomeFirstResponder]) {
    return NO;
  }
  [self.item fieldDidBecomeFirstResponder];
  return YES;
}

- (BOOL)textView:(NSTextView *)textView shouldChangeTextInRange:(NSRange)range replacementString:(NSString *)string {
  static const ngn::TextInputOptions none{};
  return NGNControlShouldChangeText(
      self, NSSearchField.class, textView, range, string, self.item ? self.item.options : none, &_inserting);
}

- (NSDictionary<NSTextCheckingOptionKey, id> *)textView:(NSTextView *)view
                                   willCheckTextInRange:(NSRange)range
                                                options:(NSDictionary<NSTextCheckingOptionKey, id> *)options
                                                  types:(NSTextCheckingTypes *)checkingTypes {
  return self.item ? NGNTextCheckingOptions(options, self.item.options) : options;
}

@end

@implementation NGNSearchToolbarItem {
  ngn::TextInputOptions _options;
  NSColor *_tint;
  BOOL _quiet;
  // Whether the field's taking the keyboard has been reported, and not its leaving.
  BOOL _editing;
  // The text last reported or set from JavaScript: a change is reported once, from whichever of the
  // field's action and its text-change notification comes first.
  NSString *_text;
}

- (instancetype)initWithItemIdentifier:(NSToolbarItemIdentifier)identifier {
  if ((self = [super initWithItemIdentifier:identifier])) {
    NGNSearchBarField *field = [[NGNSearchBarField alloc] initWithFrame:NSZeroRect];
    field.item = self;
    field.delegate = self;
    field.sendsWholeSearchString = NO;
    self.searchField = field;
    field.target = self;
    field.action = @selector(fieldAction:);
    self.label = @"Search";
    _text = @"";
    [self takeClearButton];
  }
  return self;
}

- (const ngn::TextInputOptions &)options {
  return _options;
}

- (void)report:(ngn::SearchBarInput)input {
  if (_quiet && (input == ngn::SearchBarInput::Began || input == ngn::SearchBarInput::Ended)) {
    return;
  }
  if (self.input) {
    self.input(input, self.searchField.stringValue);
  }
}

- (void)apply:(const ngn::SearchBarConfig &)config {
  NSString *placeholder = string(config.placeholder);
  if (![self.searchField.placeholderString isEqualToString:placeholder]) {
    self.searchField.placeholderString = placeholder;
  }
  self.label = placeholder.length > 0 ? placeholder : @"Search";
  _options = inputOptions(config.autoCapitalize);
  NSColor *text = color(config.textColor);
  self.searchField.textColor = text != nil ? text : NSColor.controlTextColor;
  _tint = color(config.tintColor);
  [self applyTint];
  [self takeClearButton];
}

- (void)applyTint {
  if ([self.searchField.currentEditor isKindOfClass:NSTextView.class]) {
    ((NSTextView *)self.searchField.currentEditor).insertionPointColor = _tint ? _tint : NSColor.textColor;
  }
}

- (void)keepFocusAcross:(void (^)(void))change {
  NSText *editor = self.searchField.currentEditor;
  if (editor == nil) {
    change();
    return;
  }
  NSRange selection = editor.selectedRange;
  NSWindow *window = self.searchField.window;
  _quiet = YES;
  change();
  // The toolbar places an item put back on its next layout: the field needs its window now.
  [window layoutIfNeeded];
  [self focus];
  NSText *again = self.searchField.currentEditor;
  if (again != nil && NSMaxRange(selection) <= again.string.length) {
    again.selectedRange = selection;
  }
  _quiet = NO;
}

- (void)run:(const ngn::SearchBarCommand &)command {
  switch (command.kind) {
    case ngn::SearchBarCommand::Focus:
      [self focus];
      break;
    case ngn::SearchBarCommand::Blur:
      [self blur];
      break;
    case ngn::SearchBarCommand::ClearText:
      [self setText:@""];
      break;
    case ngn::SearchBarCommand::SetText:
      [self setText:string(command.text)];
      break;
    case ngn::SearchBarCommand::Cancel:
      [self cancel];
      break;
  }
}

- (void)focus {
  // In a narrow window the item is a button until a search begins; beginning one expands it and
  // gives the field the keyboard.
  [self beginSearchInteraction];
  if (self.searchField.currentEditor == nil) {
    [self.searchField.window makeFirstResponder:self.searchField];
  }
  [self fieldDidBecomeFirstResponder];
}

- (void)blur {
  if (self.searchField.currentEditor != nil) {
    [self.searchField.window makeFirstResponder:nil];
  }
}

// iOS's Cancel button: the text goes, the search ends.
- (void)cancel {
  [self setText:@""];
  if (self.input) {
    self.input(ngn::SearchBarInput::Cancelled, @"");
  }
  [self blur];
  [self endSearchInteraction];
}

- (void)textMayHaveChanged {
  NSString *text = self.searchField.stringValue;
  if (![text isEqualToString:_text]) {
    _text = [text copy];
    [self report:ngn::SearchBarInput::Typed];
  }
}

// The clear button empties the field and reports the empty text, as iOS's clear button does; the
// cell's own only sends the field's action while it edits.
- (void)takeClearButton {
  NSButtonCell *clear = ((NSSearchFieldCell *)self.searchField.cell).cancelButtonCell;
  clear.target = self;
  clear.action = @selector(clearField:);
}

- (void)clearField:(id)sender {
  self.searchField.stringValue = @"";
  [self textMayHaveChanged];
}

- (void)fieldAction:(id)sender {
  [self textMayHaveChanged];
}

- (void)setText:(NSString *)text {
  _text = [text copy];
  self.searchField.stringValue = text;
}

// The field took the keyboard: through a click (becomeFirstResponder), or through the item's own
// search interaction, which gives it a field editor without going through becomeFirstResponder.
- (void)fieldDidBecomeFirstResponder {
  [self applyTint];
  if (!_editing && self.searchField.currentEditor != nil) {
    _editing = YES;
    [self report:ngn::SearchBarInput::Began];
  }
}

- (void)beginSearchInteraction {
  [super beginSearchInteraction];
  [self fieldDidBecomeFirstResponder];
}

- (void)controlTextDidChange:(NSNotification *)note {
  [self textMayHaveChanged];
}

- (void)controlTextDidEndEditing:(NSNotification *)note {
  if (_editing) {
    _editing = NO;
    [self report:ngn::SearchBarInput::Ended];
  }
}

- (BOOL)control:(NSControl *)control textView:(NSTextView *)textView doCommandBySelector:(SEL)selector {
  if (selector == @selector(insertNewline:)) {
    [self report:ngn::SearchBarInput::Submitted];
    return YES;
  }
  if (selector == @selector(cancelOperation:)) {
    [self cancel];
    return YES;
  }
  return NO;
}

@end
