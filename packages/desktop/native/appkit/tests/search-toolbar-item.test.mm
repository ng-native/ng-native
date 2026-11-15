// NGNSearchToolbarItem (search-toolbar-item.mm) in an offscreen window's toolbar, never shown.
#include "../search-toolbar-item.h"

#include <doctest/doctest.h>

#include <string>
#include <vector>

using ngn::SearchBarCommand;
using ngn::SearchBarConfig;
using ngn::SearchBarInput;

@interface NGNSearchToolbarTestDelegate : NSObject <NSToolbarDelegate>
@property (nonatomic, strong) NSToolbarItem *item;
@end

@implementation NGNSearchToolbarTestDelegate
- (NSToolbarItem *)toolbar:(NSToolbar *)toolbar
        itemForItemIdentifier:(NSToolbarItemIdentifier)identifier
    willBeInsertedIntoToolbar:(BOOL)flag {
  return [identifier isEqualToString:self.item.itemIdentifier] ? self.item : nil;
}
- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  return @[ self.item.itemIdentifier ];
}
- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return @[ self.item.itemIdentifier ];
}
@end

namespace {

struct Bar {
  NSWindow *window;
  NGNSearchToolbarTestDelegate *delegate;
  NGNSearchToolbarItem *item;
  std::vector<std::string> log;
};

const char *name(SearchBarInput input) {
  switch (input) {
    case SearchBarInput::Typed:
      return "change";
    case SearchBarInput::Submitted:
      return "search";
    case SearchBarInput::Cancelled:
      return "cancel";
    case SearchBarInput::Began:
      return "focus";
    case SearchBarInput::Ended:
      return "blur";
  }
  return "";
}

// A window with a toolbar holding only the search item.
void makeBar(Bar &bar) {
  [NSApplication sharedApplication];
  bar.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 600, 300)
                                           styleMask:NSWindowStyleMaskTitled
                                             backing:NSBackingStoreBuffered
                                               defer:YES];
  bar.window.releasedWhenClosed = NO;
  bar.item = [[NGNSearchToolbarItem alloc] initWithItemIdentifier:@"ngn.search.7"];
  Bar *b = &bar;
  bar.item.input = ^(SearchBarInput input, NSString *text) {
    b->log.push_back(std::string(name(input)) + ":" + text.UTF8String);
  };
  bar.delegate = [NGNSearchToolbarTestDelegate new];
  bar.delegate.item = bar.item;
  NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"ngn.test.search"];
  toolbar.delegate = bar.delegate;
  bar.window.toolbar = toolbar;
}

// The log as one line, which a failing check prints.
std::string joined(const std::vector<std::string> &log) {
  std::string out;
  for (const auto &entry : log) {
    out += (out.empty() ? "" : " ") + entry;
  }
  return out;
}

// Closes the window without reporting to a log that is about to go: closing ends the editing.
void finish(Bar &bar) {
  bar.item.input = nil;
  [bar.window close];
}

NSTextView *editor(Bar &bar) {
  NSText *e = bar.item.searchField.currentEditor;
  return [e isKindOfClass:NSTextView.class] ? (NSTextView *)e : nil;
}

void type(Bar &bar, NSString *text) {
  [editor(bar) insertText:text replacementRange:NSMakeRange(NSNotFound, 0)];
}

} // namespace

TEST_CASE("a header's search bar is an NSSearchToolbarItem in the window's toolbar") {
  Bar bar;
  makeBar(bar);
  REQUIRE(bar.window.toolbar.items.count == 1);
  CHECK((bar.window.toolbar.items[0] == bar.item));
  CHECK([bar.item isKindOfClass:NSSearchToolbarItem.class]);
  SearchBarConfig config;
  config.placeholder = "Search mail";
  [bar.item apply:config];
  CHECK([bar.item.searchField.placeholderString isEqualToString:@"Search mail"]);
  // The label the overflow menu and VoiceOver read.
  CHECK([bar.item.label isEqualToString:@"Search mail"]);
  CHECK(bar.log.empty());
  finish(bar);
}

TEST_CASE("the toolbar search field reports focus, typing, Return and blur") {
  Bar bar;
  makeBar(bar);
  [bar.item apply:SearchBarConfig{}];
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::Focus, .text = {}}];
  REQUIRE((editor(bar) != nil));
  type(bar, @"a");
  type(bar, @"b");
  [editor(bar) doCommandBySelector:@selector(insertNewline:)];
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::Blur, .text = {}}];
  CHECK(joined(bar.log) == "focus: change:a change:ab search:ab blur:ab");
  CHECK((editor(bar) == nil));
  finish(bar);
}

TEST_CASE("Escape and cancelSearch cancel and empty the field; the clear button only empties it") {
  Bar bar;
  makeBar(bar);
  [bar.item apply:SearchBarConfig{}];
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::Focus, .text = {}}];
  type(bar, @"ink");
  bar.log.clear();
  [editor(bar) doCommandBySelector:@selector(cancelOperation:)];
  CHECK(bar.item.searchField.stringValue.length == 0);
  REQUIRE(!bar.log.empty());
  CHECK(bar.log.front() == "cancel:");

  // The clear button in the field is iOS's clear button: the text goes, the search stays.
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::Focus, .text = {}}];
  type(bar, @"x");
  bar.log.clear();
  NSButtonCell *clear = ((NSSearchFieldCell *)bar.item.searchField.cell).cancelButtonCell;
  REQUIRE((clear != nil));
  [NSApp sendAction:clear.action to:clear.target from:clear];
  CHECK(bar.item.searchField.stringValue.length == 0);
  CHECK(joined(bar.log) == "change:");

  bar.item.searchField.stringValue = @"y";
  bar.log.clear();
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::Cancel, .text = {}}];
  CHECK(bar.item.searchField.stringValue.length == 0);
  REQUIRE(!bar.log.empty());
  CHECK(bar.log.front() == "cancel:");
  finish(bar);
}

TEST_CASE("setText and clearText put text in the field without reporting it back") {
  Bar bar;
  makeBar(bar);
  [bar.item apply:SearchBarConfig{}];
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::SetText, .text = "recent"}];
  CHECK([bar.item.searchField.stringValue isEqualToString:@"recent"]);
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::ClearText, .text = {}}];
  CHECK(bar.item.searchField.stringValue.length == 0);
  CHECK(bar.log.empty());
  finish(bar);
}

TEST_CASE("the toolbar search field capitalizes as autoCapitalize says and takes the text colour") {
  Bar bar;
  makeBar(bar);
  SearchBarConfig config;
  config.autoCapitalize = "characters";
  config.textColor = facebook::react::colorFromComponents({0, 0, 1, 1});
  config.tintColor = facebook::react::colorFromComponents({1, 0, 0, 1});
  [bar.item apply:config];
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::Focus, .text = {}}];
  type(bar, @"red");
  CHECK([bar.item.searchField.stringValue isEqualToString:@"RED"]);
  NSColor *text = [bar.item.searchField.textColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  CHECK(text.blueComponent == doctest::Approx(1));
  CHECK(text.redComponent == doctest::Approx(0));
  NSColor *caret = [editor(bar).insertionPointColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  CHECK(caret.redComponent == doctest::Approx(1));

  // Back to the defaults.
  [bar.item apply:SearchBarConfig{}];
  type(bar, @"x");
  CHECK([bar.item.searchField.stringValue isEqualToString:@"REDx"]);
  CHECK([bar.item.searchField.textColor isEqual:NSColor.controlTextColor]);
  finish(bar);
}

TEST_CASE("a toolbar rebuilt while the field edits keeps it editing, without a blur and focus") {
  Bar bar;
  makeBar(bar);
  [bar.item apply:SearchBarConfig{}];
  [bar.item run:SearchBarCommand{.kind = SearchBarCommand::Focus, .text = {}}];
  type(bar, @"abc");
  editor(bar).selectedRange = NSMakeRange(1, 1);
  bar.log.clear();
  NSToolbar *toolbar = bar.window.toolbar;
  [bar.item keepFocusAcross:^{
    [toolbar removeItemAtIndex:0];
    [toolbar insertItemWithItemIdentifier:bar.item.itemIdentifier atIndex:0];
  }];

  REQUIRE((editor(bar) != nil));
  CHECK(NSEqualRanges(editor(bar).selectedRange, NSMakeRange(1, 1)));
  CHECK(bar.log.empty());
  // Reporting is back on after.
  type(bar, @"d");
  CHECK(joined(bar.log) == "change:adc");
  finish(bar);
}
