// NGNTextField and NGNTextView (text-input-field.mm) on offscreen windows, never shown.
#include "../text-input-field.h"
#include "ink.h"

#include <doctest/doctest.h>

#include <chrono>

using ngn::Capitalize;
using ngn::FontSmoothing;
using ngn::TextInputOptions;
using ngn::test::inkOf;

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

TEST_CASE("NGNFitReplacement fits a large paste with words capitalized in linear time") {
  // 200,000 units: converted for every character, this takes minutes; once, a moment.
  NSString *paste = [@"" stringByPaddingToLength:200000 withString:@"ab cd " startingAtIndex:0];
  TextInputOptions words{.capitalize = Capitalize::Words, .maxLength = 9};
  auto start = std::chrono::steady_clock::now();
  NSString *fitted = NGNFitReplacement(@"", NSMakeRange(0, 0), paste, words);
  auto seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
  CHECK([fitted isEqualToString:@"Ab Cd Ab "]);
  CHECK(seconds < 5);
}

TEST_CASE("NGNTextCheckingOptions turns the user's capitalization off for autoCapitalize none") {
  NSDictionary *in = @{};
  NSDictionary *none = NGNTextCheckingOptions(in, {.capitalize = Capitalize::None});
  if (NSString *key = NGNAutomaticCapitalizationKey()) {
    CHECK([none[key] isEqual:@NO]);
  } else {
    CHECK(none.count == 0);
  }
  CHECK(NGNTextCheckingOptions(in, {.capitalize = Capitalize::Sentences}).count == 0);
}

TEST_CASE("each field sets up its editor with its own options") {
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

TEST_CASE("a field's alignment and writing direction reach its editor while editing and survive secure entry") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window);
  field.stringValue = @"Hello";
  [field setTextAlignment:NSTextAlignmentRight writingDirection:NSWritingDirectionRightToLeft];
  REQUIRE([window makeFirstResponder:field.control]);
  REQUIRE((editor(field) != nil));
  CHECK(editor(field).alignment == NSTextAlignmentRight);
  CHECK(editor(field).baseWritingDirection == NSWritingDirectionRightToLeft);

  // Changed while editing, as a relayout in the other direction does: the editing goes on, and
  // the control has it once the editing ends and when it starts again.
  [field setTextAlignment:NSTextAlignmentLeft writingDirection:NSWritingDirectionLeftToRight];
  REQUIRE((editor(field) != nil));
  CHECK(editor(field).alignment == NSTextAlignmentLeft);
  CHECK(editor(field).baseWritingDirection == NSWritingDirectionLeftToRight);
  [window makeFirstResponder:nil];
  CHECK(field.control.alignment == NSTextAlignmentLeft);
  CHECK(field.control.baseWritingDirection == NSWritingDirectionLeftToRight);
  REQUIRE([window makeFirstResponder:field.control]);
  CHECK(editor(field).alignment == NSTextAlignmentLeft);

  // Editing aborted, which tells the control nothing: the next request, the same one again as each
  // layout sends, puts it right.
  [field setTextAlignment:NSTextAlignmentRight writingDirection:NSWritingDirectionRightToLeft];
  [field.control abortEditing];
  REQUIRE((field.currentEditor == nil));
  [field setTextAlignment:NSTextAlignmentRight writingDirection:NSWritingDirectionRightToLeft];
  CHECK(field.control.alignment == NSTextAlignmentRight);
  CHECK(field.control.baseWritingDirection == NSWritingDirectionRightToLeft);
  REQUIRE([window makeFirstResponder:field.control]);

  [field setTextAlignment:NSTextAlignmentCenter writingDirection:NSWritingDirectionRightToLeft];
  field.secure = YES;
  CHECK(field.control.alignment == NSTextAlignmentCenter);
  CHECK(field.control.baseWritingDirection == NSWritingDirectionRightToLeft);
  REQUIRE((editor(field) != nil));
  CHECK(editor(field).alignment == NSTextAlignmentCenter);
  CHECK(editor(field).baseWritingDirection == NSWritingDirectionRightToLeft);
  [window close];
}

TEST_CASE("a placeholder takes the text's alignment, set before it or after") {
  for (bool secure : {false, true}) {
    INFO("secure ", secure);
    NSWindow *window = offscreenWindow();
    NGNTextField *field = addField(window, NSMakeRect(0, 0, 300, 40));
    field.secure = secure;
    [field setPlaceholder:@"Name" color:NSColor.redColor];
    [field setTextAlignment:NSTextAlignmentRight writingDirection:NSWritingDirectionRightToLeft];
    NSParagraphStyle *style = [field.control.placeholderAttributedString attribute:NSParagraphStyleAttributeName
                                                                           atIndex:0
                                                                    effectiveRange:nullptr];
    CHECK(style.alignment == NSTextAlignmentRight);
    CHECK(style.baseWritingDirection == NSWritingDirectionRightToLeft);
    [field setPlaceholder:@"Other" color:NSColor.redColor];
    style = [field.control.placeholderAttributedString attribute:NSParagraphStyleAttributeName atIndex:0 effectiveRange:nullptr];
    CHECK(style.alignment == NSTextAlignmentRight);
    [window close];
  }

  NGNTextView *text = [[NGNTextView alloc] initWithFrame:NSMakeRect(0, 0, 300, 60)];
  [text setPlaceholder:@"Name" color:NSColor.redColor];
  [text setTextAlignment:NSTextAlignmentRight writingDirection:NSWritingDirectionRightToLeft];
  NSParagraphStyle *style = [text.placeholder attribute:NSParagraphStyleAttributeName atIndex:0 effectiveRange:nullptr];
  CHECK(style.alignment == NSTextAlignmentRight);
  CHECK(style.baseWritingDirection == NSWritingDirectionRightToLeft);
  // Text set or typed later takes it.
  text.string = @"Hello";
  CHECK([[text.textStorage attribute:NSParagraphStyleAttributeName atIndex:0 effectiveRange:nullptr] alignment] ==
        NSTextAlignmentRight);
  [text setTextAlignment:NSTextAlignmentLeft writingDirection:NSWritingDirectionNatural];
  CHECK([[text.textStorage attribute:NSParagraphStyleAttributeName atIndex:0 effectiveRange:nullptr] alignment] ==
        NSTextAlignmentLeft);
  // Emptied, then typed into.
  text.string = @"";
  [text setTextAlignment:NSTextAlignmentCenter writingDirection:NSWritingDirectionRightToLeft];
  type(text, @"Typed");
  NSParagraphStyle *typed = [text.textStorage attribute:NSParagraphStyleAttributeName atIndex:0 effectiveRange:nullptr];
  CHECK(typed.alignment == NSTextAlignmentCenter);
  CHECK(typed.baseWritingDirection == NSWritingDirectionRightToLeft);
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

TEST_CASE("a command a key sends is named as the web names the key, and other commands are not") {
  CHECK([NGNKeyForCommand(@selector(insertNewline:)) isEqualToString:@"Enter"]);
  CHECK([NGNKeyForCommand(@selector(insertNewlineIgnoringFieldEditor:)) isEqualToString:@"Enter"]);
  CHECK([NGNKeyForCommand(@selector(insertLineBreak:)) isEqualToString:@"Enter"]);
  CHECK([NGNKeyForCommand(@selector(deleteBackward:)) isEqualToString:@"Backspace"]);
  CHECK([NGNKeyForCommand(@selector(cancelOperation:)) isEqualToString:@"Escape"]);
  CHECK([NGNKeyForCommand(@selector(moveUp:)) isEqualToString:@"ArrowUp"]);
  CHECK([NGNKeyForCommand(@selector(moveDown:)) isEqualToString:@"ArrowDown"]);
  CHECK([NGNKeyForCommand(@selector(moveLeft:)) isEqualToString:@"ArrowLeft"]);
  CHECK([NGNKeyForCommand(@selector(moveRight:)) isEqualToString:@"ArrowRight"]);
  // Shift with an arrow extends the selection: the same key.
  CHECK([NGNKeyForCommand(@selector(moveUpAndModifySelection:)) isEqualToString:@"ArrowUp"]);
  CHECK([NGNKeyForCommand(@selector(moveDownAndModifySelection:)) isEqualToString:@"ArrowDown"]);
  CHECK([NGNKeyForCommand(@selector(moveLeftAndModifySelection:)) isEqualToString:@"ArrowLeft"]);
  CHECK([NGNKeyForCommand(@selector(moveRightAndModifySelection:)) isEqualToString:@"ArrowRight"]);
  // Option or Command with a key, which the GTK field leaves out too.
  CHECK((NGNKeyForCommand(@selector(moveWordLeft:)) == nil));
  CHECK((NGNKeyForCommand(@selector(deleteWordBackward:)) == nil));
  CHECK((NGNKeyForCommand(@selector(moveToBeginningOfDocument:)) == nil));
  CHECK((NGNKeyForCommand(@selector(selectAll:)) == nil));
  // Tab: the host's key monitor takes it first, to move the focus, and sends it for the field.
  CHECK((NGNKeyForCommand(@selector(insertTab:)) == nil));
}

namespace {

NSEvent *keyDown(NSEventModifierFlags flags) {
  return [NSEvent keyEventWithType:NSEventTypeKeyDown
                          location:NSZeroPoint
                     modifierFlags:flags
                         timestamp:0
                      windowNumber:0
                           context:nil
                        characters:@"v"
       charactersIgnoringModifiers:@"v"
                         isARepeat:NO
                           keyCode:9];
}

NSEvent *mouseUp() {
  return [NSEvent mouseEventWithType:NSEventTypeLeftMouseUp
                            location:NSZeroPoint
                       modifierFlags:0
                           timestamp:0
                        windowNumber:0
                             context:nil
                         eventNumber:0
                          clickCount:1
                            pressure:0];
}

} // namespace

TEST_CASE("a change is a typed key when a keystroke or an input method made it, not a paste or a drop") {
  CHECK([NGNTypedKey(@"a", nil, NO) isEqualToString:@"a"]);
  CHECK([NGNTypedKey(@"a", keyDown(0), NO) isEqualToString:@"a"]);
  CHECK([NGNTypedKey(@"A", keyDown(NSEventModifierFlagShift), NO) isEqualToString:@"A"]);
  CHECK([NGNTypedKey(@" ", keyDown(0), NO) isEqualToString:@" "]);
  // Option types a character of its own.
  CHECK([NGNTypedKey(@"é", keyDown(NSEventModifierFlagOption), NO) isEqualToString:@"é"]);
  // Command-V, and the Edit menu's Paste or a drop, which a mouse event made.
  CHECK((NGNTypedKey(@"pasted", keyDown(NSEventModifierFlagCommand), NO) == nil));
  CHECK((NGNTypedKey(@"pasted", mouseUp(), NO) == nil));
  // A deletion, and Return and Tab, which their commands name.
  CHECK((NGNTypedKey(@"", keyDown(0), NO) == nil));
  CHECK((NGNTypedKey(nil, keyDown(0), NO) == nil));
  CHECK((NGNTypedKey(@"\n", keyDown(0), NO) == nil));
  CHECK((NGNTypedKey(@"\t", keyDown(0), NO) == nil));
  // What an input method is composing.
  CHECK((NGNTypedKey(@"に", keyDown(0), YES) == nil));
}

TEST_CASE("a field and a multiline text view tell their owner each key typed, once") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window);
  NSMutableArray<NSString *> *keys = [NSMutableArray array];
  field.typed = ^(NSString *key) {
    [keys addObject:key];
  };
  // Cut to fit, and put in again in its place, it is still one key.
  [field applyOptions:{.maxLength = 2}];
  REQUIRE([window makeFirstResponder:field.control]);
  type(editor(field), @"a");
  type(editor(field), @"bc");
  CHECK([field.stringValue isEqualToString:@"ab"]);
  CHECK([keys isEqualToArray:@[ @"a", @"bc" ]]);

  NGNTextView *text = [[NGNTextView alloc] initWithFrame:NSMakeRect(0, 40, 200, 80)];
  [window.contentView addSubview:text];
  [keys removeAllObjects];
  text.typed = ^(NSString *key) {
    [keys addObject:key];
  };
  [text applyOptions:{.capitalize = Capitalize::Words}];
  REQUIRE([window makeFirstResponder:text]);
  type(text, @"x");
  CHECK([text.string isEqualToString:@"X"]);
  CHECK([keys isEqualToArray:@[ @"x" ]]);
  [window close];
}

TEST_CASE("-webkit-font-smoothing draws a field's text thinner when antialiased, and with no partial pixels when none") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window, NSMakeRect(10, 10, 200, 30));
  field.control.bezeled = NO;
  field.control.bordered = NO;
  field.control.drawsBackground = NO;
  field.control.textColor = NSColor.blackColor;
  field.font = [NSFont systemFontOfSize:13];
  field.stringValue = @"Hamburgefonstiv";
  auto smoothed = inkOf(field);
  CHECK(smoothed.partial > 0);
  field.fontSmoothing = FontSmoothing::Antialiased;
  auto antialiased = inkOf(field);
  CHECK(antialiased.partial > 0);
  CHECK(antialiased.total < smoothed.total);
  field.fontSmoothing = FontSmoothing::None;
  CHECK(inkOf(field).partial == 0);
  // Back to the system's smoothing.
  field.fontSmoothing = FontSmoothing::Auto;
  CHECK(inkOf(field).total == smoothed.total);
  [window close];
}

TEST_CASE("a field editor smooths as its field does, including auto") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window, NSMakeRect(10, 10, 200, 30));
  field.control.textColor = NSColor.blackColor;
  field.font = [NSFont systemFontOfSize:13];
  field.stringValue = @"Hamburgefonstiv";
  field.fontSmoothing = FontSmoothing::Antialiased;
  REQUIRE([window makeFirstResponder:field.control]);
  NSTextView *own = editor(field);
  REQUIRE((own != nil));
  REQUIRE([own isKindOfClass:NGNSmoothedFieldEditor.class]);
  CHECK(((NGNSmoothedFieldEditor *)own).fontSmoothing == FontSmoothing::Antialiased);
  CHECK([own.string isEqualToString:@"Hamburgefonstiv"]);
  [own setSelectedRange:NSMakeRange(0, 0)];
  auto antialiased = inkOf(own);
  // A change while editing reaches the editor at once.
  field.fontSmoothing = FontSmoothing::None;
  CHECK(((NGNSmoothedFieldEditor *)own).fontSmoothing == FontSmoothing::None);
  [window makeFirstResponder:nil];

  field.fontSmoothing = FontSmoothing::Auto;
  REQUIRE([window makeFirstResponder:field.control]);
  CHECK((editor(field) == own));
  CHECK(((NGNSmoothedFieldEditor *)own).fontSmoothing == FontSmoothing::Auto);
  [own setSelectedRange:NSMakeRange(0, 0)];
  CHECK(antialiased.total < inkOf(own).total);
  [window close];
}

TEST_CASE("a field keeps its editor, text and selection when smoothing changes") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window, NSMakeRect(10, 10, 200, 30));
  field.stringValue = @"Hamburgefonstiv";
  __block int focuses = 0;
  field.focused = ^{
    ++focuses;
  };
  REQUIRE([window makeFirstResponder:field.control]);
  NSTextView *own = editor(field);
  REQUIRE((own != nil));
  [own setSelectedRange:NSMakeRange(15, 0)];
  type(own, @"!");
  [own setSelectedRange:NSMakeRange(2, 3)];
  field.fontSmoothing = FontSmoothing::None;
  REQUIRE((editor(field) == own));
  REQUIRE([own isKindOfClass:NGNSmoothedFieldEditor.class]);
  CHECK(((NGNSmoothedFieldEditor *)own).fontSmoothing == FontSmoothing::None);
  CHECK([own.string isEqualToString:@"Hamburgefonstiv!"]);
  CHECK(NSEqualRanges(own.selectedRange, NSMakeRange(2, 3)));
  CHECK(focuses == 1);
  CHECK_FALSE(field.swapping);
  [window makeFirstResponder:nil];
  [window close];
}

TEST_CASE("a field can change smoothing during composition without ending it") {
  NSWindow *window = offscreenWindow();
  NGNTextField *field = addField(window, NSMakeRect(10, 10, 200, 30));
  field.stringValue = @"ab";
  REQUIRE([window makeFirstResponder:field.control]);
  NSTextView *own = editor(field);
  REQUIRE((own != nil));
  [own setSelectedRange:NSMakeRange(2, 0)];
  [own setMarkedText:@"k" selectedRange:NSMakeRange(1, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
  field.fontSmoothing = FontSmoothing::Antialiased;
  CHECK((window.firstResponder == own));
  CHECK(own.hasMarkedText);
  [own insertText:@"k" replacementRange:own.markedRange];
  CHECK((editor(field) == own));
  CHECK(((NGNSmoothedFieldEditor *)own).fontSmoothing == FontSmoothing::Antialiased);
  CHECK([own.string isEqualToString:@"abk"]);
  CHECK(NSEqualRanges(own.selectedRange, NSMakeRange(3, 0)));
  [window makeFirstResponder:nil];
  [window close];
}

TEST_CASE("-webkit-font-smoothing draws a multiline text view's text thinner when antialiased") {
  NSWindow *window = offscreenWindow();
  NGNTextView *text = [[NGNTextView alloc] initWithFrame:NSMakeRect(0, 0, 200, 40)];
  text.font = [NSFont systemFontOfSize:13];
  text.textColor = NSColor.blackColor;
  text.drawsBackground = NO;
  text.string = @"Hamburgefonstiv";
  [window.contentView addSubview:text];
  auto smoothed = inkOf(text);
  CHECK(smoothed.partial > 0);
  text.fontSmoothing = FontSmoothing::Antialiased;
  CHECK(inkOf(text).total < smoothed.total);
  text.fontSmoothing = FontSmoothing::None;
  CHECK(inkOf(text).partial == 0);
  // The placeholder too.
  text.string = @"";
  [text setPlaceholder:@"Hamburgefonstiv" color:NSColor.blackColor];
  CHECK(inkOf(text).partial == 0);
  text.fontSmoothing = FontSmoothing::Auto;
  CHECK(inkOf(text).partial > 0);
  [window close];
}
