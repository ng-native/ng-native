// NGNSearchField (search-field.mm) on offscreen windows, never shown.
#include "../search-field.h"

#include <doctest/doctest.h>

#include <string>
#include <vector>

using ngn::ControlSize;
using ngn::NativeControlProps;

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

struct Events {
  std::vector<std::string> log;
  std::vector<int> counts;
};

NGNSearchField *makeField(NSWindow *window, Events &events) {
  NGNSearchField *search = [[NGNSearchField alloc] initWithFrame:NSMakeRect(10, 10, 240, 56)];
  Events *e = &events;
  search.changed = ^(NSString *text, int count) {
    e->log.push_back("change:" + std::string(text.UTF8String));
    e->counts.push_back(count);
  };
  search.submitted = ^(NSString *text) {
    e->log.push_back("search:" + std::string(text.UTF8String));
  };
  search.cancelled = ^{
    e->log.push_back("cancel");
  };
  search.began = ^{
    e->log.push_back("focus");
  };
  search.ended = ^{
    e->log.push_back("blur");
  };
  [window.contentView addSubview:search];
  return search;
}

NSTextView *editor(NGNSearchField *search) {
  return [search.field.currentEditor isKindOfClass:NSTextView.class] ? (NSTextView *)search.field.currentEditor : nil;
}

} // namespace

TEST_CASE("a search field takes its text, placeholder, control size and enabled state from the props") {
  NSWindow *window = offscreenWindow();
  Events events;
  NGNSearchField *search = makeField(window, events);
  NativeControlProps p;
  p.text = "teal";
  p.placeholder = "Search colours";
  p.controlSize = ControlSize::Small;
  [search apply:p];
  CHECK([search.field.stringValue isEqualToString:@"teal"]);
  CHECK([search.field.placeholderString isEqualToString:@"Search colours"]);
  CHECK(search.field.controlSize == NSControlSizeSmall);
  CHECK(search.field.font.pointSize == [NSFont systemFontSizeForControlSize:NSControlSizeSmall]);
  CHECK(search.field.enabled);
  // Its own height, centred in the box.
  CHECK(NSHeight(search.field.frame) < 56);
  CHECK(NSMidY(search.field.frame) == doctest::Approx(28).epsilon(0.05));
  CHECK(NSWidth(search.field.frame) == 240);

  p.enabled = false;
  [search apply:p];
  CHECK_FALSE(search.field.enabled);
  CHECK(events.log.empty());
  [window close];
}

TEST_CASE("typing reports the text with its count, and a text older than the typing is skipped") {
  NSWindow *window = offscreenWindow();
  Events events;
  NGNSearchField *search = makeField(window, events);
  NativeControlProps p;
  [search apply:p];
  [search focus];
  REQUIRE((editor(search) != nil));
  CHECK(events.log == std::vector<std::string>{"focus"});
  [editor(search) insertText:@"a" replacementRange:NSMakeRange(NSNotFound, 0)];
  [editor(search) insertText:@"b" replacementRange:NSMakeRange(NSNotFound, 0)];
  CHECK(events.log == std::vector<std::string>{"focus", "change:a", "change:ab"});
  CHECK(events.counts == std::vector<int>{1, 2});

  // JavaScript's echo of the first keystroke arrives after the second: it is stale.
  p.text = "a";
  p.mostRecentEventCount = 1;
  [search apply:p];
  CHECK([search.field.stringValue isEqualToString:@"ab"]);
  // Its answer to the latest keystroke goes in.
  p.text = "AB";
  p.mostRecentEventCount = 2;
  [search apply:p];
  CHECK([search.field.stringValue isEqualToString:@"AB"]);
  [window close];
}

TEST_CASE("Return submits, and Escape and the clear button empty the field and cancel") {
  NSWindow *window = offscreenWindow();
  Events events;
  NGNSearchField *search = makeField(window, events);
  NativeControlProps p;
  p.text = "ink";
  [search apply:p];
  [search focus];
  [editor(search) doCommandBySelector:@selector(insertNewline:)];
  CHECK(events.log == std::vector<std::string>{"focus", "search:ink"});

  [editor(search) doCommandBySelector:@selector(cancelOperation:)];
  CHECK(events.log == std::vector<std::string>{"focus", "search:ink", "change:", "cancel"});
  CHECK(search.field.stringValue.length == 0);

  // The clear button, whose action the field took over.
  search.field.stringValue = @"x";
  NSButtonCell *clear = ((NSSearchFieldCell *)search.field.cell).cancelButtonCell;
  REQUIRE((clear != nil));
  [NSApp sendAction:clear.action to:clear.target from:clear];
  CHECK(search.field.stringValue.length == 0);
  CHECK(events.log.back() == "cancel");
  CHECK(events.counts.back() == 2);
  // An empty field cancels without a change.
  [NSApp sendAction:clear.action to:clear.target from:clear];
  CHECK(events.counts.size() == 2);
  [window close];
}

TEST_CASE("a search field reports the keyboard going, and blur and disabling take it away") {
  NSWindow *window = offscreenWindow();
  Events events;
  NGNSearchField *search = makeField(window, events);
  NativeControlProps p;
  [search apply:p];
  [search focus];
  [search blur];
  CHECK(events.log == std::vector<std::string>{"focus", "blur"});
  CHECK((search.field.currentEditor == nil));

  [search focus];
  p.enabled = false;
  [search apply:p];
  CHECK((search.field.currentEditor == nil));
  CHECK(events.log.back() == "blur");
  [window close];
}

TEST_CASE("a search field capitalizes what is typed as autoCapitalize says, and none by default") {
  NSWindow *window = offscreenWindow();
  Events events;
  NGNSearchField *search = makeField(window, events);
  NativeControlProps p;
  [search apply:p];
  [search focus];
  [editor(search) insertText:@"red" replacementRange:NSMakeRange(NSNotFound, 0)];
  CHECK([search.field.stringValue isEqualToString:@"red"]);
  p.text = "red";
  p.mostRecentEventCount = 1;
  p.autoCapitalize = "characters";
  [search apply:p];
  [editor(search) insertText:@"dish" replacementRange:NSMakeRange(NSNotFound, 0)];
  CHECK([search.field.stringValue isEqualToString:@"redDISH"]);
  [window close];
}

TEST_CASE("the tint colours the caret while the field edits") {
  NSWindow *window = offscreenWindow();
  Events events;
  NGNSearchField *search = makeField(window, events);
  NativeControlProps p;
  p.tintColor = facebook::react::colorFromComponents({1, 0, 0, 1});
  [search apply:p];
  [search focus];
  NSColor *caret = [editor(search).insertionPointColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  CHECK(caret.redComponent == doctest::Approx(1));
  CHECK(caret.greenComponent == doctest::Approx(0));
  [window close];
}

TEST_CASE("a search field measures at its control size, font and placeholder") {
  NativeControlProps p;
  p.placeholder = "Search";
  auto regular = NGNSearchFieldSize(p);
  p.controlSize = ControlSize::Mini;
  auto mini = NGNSearchFieldSize(p);
  p.controlSize = ControlSize::Large;
  auto large = NGNSearchFieldSize(p);
  CHECK(regular.height > 0);
  CHECK(mini.height < regular.height);
  CHECK(large.height > regular.height);

  p.controlSize = ControlSize::Regular;
  p.fontSize = 30;
  CHECK(NGNSearchFieldSize(p).height > regular.height);
  p.fontSize.reset();
  p.placeholder = "Search every colour in the catalogue";
  CHECK(NGNSearchFieldSize(p).width > regular.width);
}

TEST_CASE("the field's font is the CSS's face, weight and slant over the control's system font") {
  NativeControlProps p;
  CHECK(NGNSearchFieldFont(p).pointSize == [NSFont systemFontSizeForControlSize:NSControlSizeRegular]);
  p.fontFamily = "Georgia";
  p.fontSize = 20;
  NSFont *georgia = NGNSearchFieldFont(p);
  CHECK([georgia.familyName isEqualToString:@"Georgia"]);
  CHECK(georgia.pointSize == 20);
  p.fontWeight = 700;
  p.italic = true;
  NSFont *boldItalic = NGNSearchFieldFont(p);
  CHECK([boldItalic.familyName isEqualToString:@"Georgia"]);
  NSFontTraitMask traits = [NSFontManager.sharedFontManager traitsOfFont:boldItalic];
  CHECK((traits & NSBoldFontMask) != 0);
  CHECK((traits & NSItalicFontMask) != 0);
  // A family the system lacks keeps the system face.
  p.fontFamily = "No Such Face";
  p.fontWeight.reset();
  p.italic = false;
  CHECK_FALSE([NGNSearchFieldFont(p).familyName isEqualToString:@"No Such Face"]);
}
