// NGNTextField and NGNTextView (text-input-field.mm) on offscreen windows, never shown.
#include "../text-input-field.h"

#include <doctest/doctest.h>

using ngn::Capitalize;
using ngn::TextInputOptions;

namespace {

NSWindow *offscreenWindow() {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 320, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:YES];
  window.releasedWhenClosed = NO;
  return window;
}

NGNTextField *addField(NSWindow *window, NSRect frame = NSMakeRect(10, 10, 200, 22)) {
  NGNTextField *field = [[NGNTextField alloc] initWithFrame:frame];
  [window.contentView addSubview:field];
  return field;
}

NSTextView *editor(NGNTextField *field) {
  return [field.currentEditor isKindOfClass:NSTextView.class] ? (NSTextView *)field.currentEditor : nil;
}

void type(NSTextView *text, NSString *typed) {
  [text insertText:typed replacementRange:NSMakeRange(NSNotFound, 0)];
}

// The share of the pixels in `rect` of `view` that are mostly red.
double redShare(NSView *view) {
  NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
  long red = 0, all = 0;
  for (NSInteger y = 0; y < bitmap.pixelsHigh; y++) {
    for (NSInteger x = 0; x < bitmap.pixelsWide; x++) {
      NSColor *c = [[bitmap colorAtX:x y:y] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      all++;
      if (c.alphaComponent > 0.5 && c.redComponent > 0.7 && c.greenComponent < 0.4 && c.blueComponent < 0.4) {
        red++;
      }
    }
  }
  return all ? static_cast<double>(red) / all : 0;
}

} // namespace

TEST_CASE("NGNApplyTextOptions sets AppKit's checks, and an unset option goes back to the user's setting") {
  NSTextView *text = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, 100, 100)];
  NGNApplyTextOptions(text, {.autoCorrect = true, .spellCheck = true, .smartQuotes = true, .smartInsertDelete = true});
  CHECK(text.automaticSpellingCorrectionEnabled);
  CHECK(text.automaticTextReplacementEnabled);
  CHECK(text.continuousSpellCheckingEnabled);
  CHECK(text.automaticQuoteSubstitutionEnabled);
  CHECK(text.automaticDashSubstitutionEnabled);
  CHECK(text.smartInsertDeleteEnabled);

  NGNApplyTextOptions(text, {.autoCorrect = false, .spellCheck = false, .smartQuotes = false, .smartInsertDelete = false});
  CHECK_FALSE(text.automaticSpellingCorrectionEnabled);
  CHECK_FALSE(text.automaticTextReplacementEnabled);
  CHECK_FALSE(text.continuousSpellCheckingEnabled);
  CHECK_FALSE(text.automaticQuoteSubstitutionEnabled);
  CHECK_FALSE(text.automaticDashSubstitutionEnabled);
  CHECK_FALSE(text.smartInsertDeleteEnabled);

  NGNApplyTextOptions(text, {});
  CHECK(text.automaticSpellingCorrectionEnabled == NSSpellChecker.isAutomaticSpellingCorrectionEnabled);
  CHECK(text.automaticTextReplacementEnabled == NSSpellChecker.isAutomaticTextReplacementEnabled);
  CHECK(text.automaticQuoteSubstitutionEnabled == NSSpellChecker.isAutomaticQuoteSubstitutionEnabled);
  CHECK(text.automaticDashSubstitutionEnabled == NSSpellChecker.isAutomaticDashSubstitutionEnabled);
  CHECK(text.continuousSpellCheckingEnabled);
  CHECK(text.smartInsertDeleteEnabled);
}

TEST_CASE("NGNFitReplacement cuts to maxLength between characters and capitalizes words or characters") {
  TextInputOptions limit{.capitalize = Capitalize::None, .maxLength = 5};
  CHECK([NGNFitReplacement(@"abc", NSMakeRange(3, 0), @"defg", limit) isEqualToString:@"de"]);
  CHECK([NGNFitReplacement(@"abcde", NSMakeRange(5, 0), @"f", limit) isEqualToString:@""]);
  CHECK([NGNFitReplacement(@"abcde", NSMakeRange(1, 2), @"xyz", limit) isEqualToString:@"xy"]);
  // A two-unit emoji that does not fit whole is left out, not split.
  CHECK([NGNFitReplacement(@"abcd", NSMakeRange(4, 0), @"\U0001F600", limit) isEqualToString:@""]);
  CHECK([NGNFitReplacement(@"abc", NSMakeRange(3, 0), @"\U0001F600", limit) isEqualToString:@"\U0001F600"]);

  TextInputOptions characters{.capitalize = Capitalize::Characters};
  CHECK([NGNFitReplacement(@"", NSMakeRange(0, 0), @"abc d", characters) isEqualToString:@"ABC D"]);

  TextInputOptions words{.capitalize = Capitalize::Words};
  CHECK([NGNFitReplacement(@"", NSMakeRange(0, 0), @"hello big world", words) isEqualToString:@"Hello Big World"]);
  CHECK([NGNFitReplacement(@"hel", NSMakeRange(3, 0), @"lo", words) isEqualToString:@"lo"]);
  CHECK([NGNFitReplacement(@"one ", NSMakeRange(4, 0), @"t", words) isEqualToString:@"T"]);

  TextInputOptions sentences{};
  CHECK([NGNFitReplacement(@"", NSMakeRange(0, 0), @"abc", sentences) isEqualToString:@"abc"]);
}

TEST_CASE("NGNTextCheckingOptions turns the user's capitalization off for autoCapitalize none") {
  NSDictionary *in = @{};
  NSDictionary *none = NGNTextCheckingOptions(in, {.capitalize = Capitalize::None});
  if (@available(macOS 26.0, *)) {
    CHECK([none[NSTextCheckingAutomaticCapitalizationEnabledKey] isEqual:@NO]);
  } else {
    CHECK(none.count == 0);
  }
  CHECK(NGNTextCheckingOptions(in, {.capitalize = Capitalize::Sentences}).count == 0);
}

TEST_CASE("a field sets the shared field editor up with its own options each time it edits") {
  NSWindow *window = offscreenWindow();
  NGNTextField *plain = addField(window);
  [plain applyOptions:{.autoCorrect = false, .spellCheck = false, .smartQuotes = false, .smartInsertDelete = false}];
  NGNTextField *smart = addField(window, NSMakeRect(10, 50, 200, 22));
  [smart applyOptions:{.autoCorrect = true, .spellCheck = true, .smartQuotes = true}];

  REQUIRE([window makeFirstResponder:plain.control]);
  NSTextView *first = editor(plain);
  REQUIRE((first != nil));
  CHECK_FALSE(first.automaticQuoteSubstitutionEnabled);
  CHECK_FALSE(first.automaticDashSubstitutionEnabled);
  CHECK_FALSE(first.automaticSpellingCorrectionEnabled);
  CHECK_FALSE(first.continuousSpellCheckingEnabled);
  CHECK_FALSE(first.smartInsertDeleteEnabled);

  REQUIRE([window makeFirstResponder:smart.control]);
  NSTextView *second = editor(smart);
  REQUIRE((second != nil));
  CHECK(second.automaticQuoteSubstitutionEnabled);
  CHECK(second.automaticDashSubstitutionEnabled);
  CHECK(second.automaticSpellingCorrectionEnabled);
  CHECK(second.continuousSpellCheckingEnabled);

  // Options changed while editing reach the editor at once.
  [smart applyOptions:{.smartQuotes = false}];
  CHECK_FALSE(second.automaticQuoteSubstitutionEnabled);
  [window close];
}

TEST_CASE("a field keeps to maxLength and capitalizes what is typed") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window);
  [field applyOptions:{.capitalize = Capitalize::Characters, .maxLength = 4}];
  REQUIRE([window makeFirstResponder:field.control]);
  type(editor(field), @"ab");
  CHECK([field.stringValue isEqualToString:@"AB"]);
  type(editor(field), @"cdef");
  CHECK([field.stringValue isEqualToString:@"ABCD"]);
  type(editor(field), @"g");
  CHECK([field.stringValue isEqualToString:@"ABCD"]);
  // The caret is after what went in.
  CHECK(editor(field).selectedRange.location == 4);
  [window close];
}

TEST_CASE("secure entry toggles in place, keeping the text, the keyboard and the selection") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window);
  __block int focuses = 0;
  field.focused = ^{
    focuses++;
  };
  field.stringValue = @"hunter2";
  [field applyOptions:{.smartQuotes = false, .secure = true}];
  REQUIRE([window makeFirstResponder:field.control]);
  CHECK(focuses == 1);
  editor(field).selectedRange = NSMakeRange(2, 3);

  field.secure = YES;
  CHECK([field.control isKindOfClass:NSSecureTextField.class]);
  CHECK((field.control.superview == field));
  CHECK(field.subviews.count == 1);
  CHECK([field.stringValue isEqualToString:@"hunter2"]);
  REQUIRE((editor(field) != nil));
  CHECK(NSEqualRanges(editor(field).selectedRange, NSMakeRange(2, 3)));
  CHECK(focuses == 1);
  CHECK_FALSE(field.swapping);
  // The secure field's editor has the field's options too.
  CHECK_FALSE(editor(field).automaticQuoteSubstitutionEnabled);

  field.secure = NO;
  CHECK_FALSE([field.control isKindOfClass:NSSecureTextField.class]);
  CHECK([field.stringValue isEqualToString:@"hunter2"]);
  CHECK((editor(field) != nil));

  // Out of editing, only the control changes.
  [window makeFirstResponder:nil];
  field.secure = YES;
  CHECK([field.control isKindOfClass:NSSecureTextField.class]);
  CHECK((field.currentEditor == nil));
  CHECK(focuses == 1);
  [window close];
}

TEST_CASE("a field draws its placeholder in the colour given, in its font") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window, NSMakeRect(0, 0, 200, 40));
  field.font = [NSFont systemFontOfSize:30];
  [field setPlaceholder:@"MMMM" color:NSColor.redColor];
  NSAttributedString *placeholder = field.control.placeholderAttributedString;
  REQUIRE((placeholder != nil));
  CHECK([[placeholder attribute:NSForegroundColorAttributeName atIndex:0 effectiveRange:nullptr] isEqual:NSColor.redColor]);
  CHECK([[placeholder attribute:NSFontAttributeName atIndex:0 effectiveRange:nullptr] pointSize] == 30);
  CHECK(redShare(field) > 0.02);
  field.stringValue = @"x";
  CHECK(redShare(field) == 0);
  [field setPlaceholder:@"" color:nil];
  CHECK((field.control.placeholderAttributedString == nil));
  [window close];
}

TEST_CASE("a field selects a range from the props now while editing, or when editing starts") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window);
  field.stringValue = @"hello world";
  [field selectRange:NSMakeRange(6, 5)];
  REQUIRE([window makeFirstResponder:field.control]);
  CHECK(NSEqualRanges(editor(field).selectedRange, NSMakeRange(6, 5)));
  [field selectRange:NSMakeRange(1, 0)];
  CHECK(NSEqualRanges(editor(field).selectedRange, NSMakeRange(1, 0)));
  // Past the end is ignored.
  [field selectRange:NSMakeRange(20, 0)];
  CHECK(NSEqualRanges(editor(field).selectedRange, NSMakeRange(1, 0)));
  [window close];
}

TEST_CASE("autoFocus focuses a field the first time it is in a window, and only then") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = [[NGNTextField alloc] initWithFrame:NSMakeRect(0, 0, 100, 22)];
  __block int focuses = 0;
  field.focused = ^{
    focuses++;
  };
  field.autoFocus = YES;
  [window.contentView addSubview:field];
  CHECK((field.currentEditor != nil));
  CHECK(focuses == 1);
  [window makeFirstResponder:nil];
  [field removeFromSuperview];
  [window.contentView addSubview:field];
  CHECK((field.currentEditor == nil));
  CHECK(focuses == 1);

  NGNTextField *plain = addField(window);
  CHECK((plain.currentEditor == nil));
  [window close];
}

TEST_CASE("a multiline text view keeps to maxLength, draws its placeholder and focuses for autoFocus") {
  NSWindow *window = offscreenWindow();
  NGNTextView *text = [[NGNTextView alloc] initWithFrame:NSMakeRect(0, 0, 200, 80)];
  text.font = [NSFont systemFontOfSize:30];
  text.drawsBackground = NO;
  __block int focuses = 0;
  text.focused = ^{
    focuses++;
  };
  text.autoFocus = YES;
  [text applyOptions:{.smartQuotes = false, .capitalize = Capitalize::Words, .maxLength = 9}];
  CHECK_FALSE(text.automaticQuoteSubstitutionEnabled);
  [text setPlaceholder:@"MMMM" color:NSColor.redColor];
  [window.contentView addSubview:text];
  CHECK((window.firstResponder == text));
  CHECK(focuses == 1);
  CHECK(redShare(text) > 0.02);

  type(text, @"one two three");
  CHECK([text.string isEqualToString:@"One Two T"]);
  CHECK(redShare(text) == 0);
  [text selectRange:NSMakeRange(0, 3)];
  CHECK(NSEqualRanges(text.selectedRange, NSMakeRange(0, 3)));
  [window close];
}
