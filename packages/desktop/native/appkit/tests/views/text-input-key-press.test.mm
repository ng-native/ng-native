// `<text-input>`'s (keyPress) from a mounted single-line field and a multiline one: a key typed and
// a key whose command names it (text-input-field.h) each send one, other commands none.
#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::SentEvents;
using ngn::testing::textInputProps;

namespace {

// The NSTextView the mounted input edits in: the field editor of its NSTextField, or the
// multiline input's own.
NSTextView *editorIn(NSView *view) {
  for (NSView *child in view.subviews) {
    if ([child isKindOfClass:NSTextView.class]) {
      return (NSTextView *)child;
    }
    if ([child isKindOfClass:NSTextField.class]) {
      [child.window makeFirstResponder:child];
      return (NSTextView *)((NSTextField *)child).currentEditor;
    }
    if (NSTextView *found = editorIn(child)) {
      return found;
    }
  }
  return nil;
}

void sendsKeyPresses(bool multiline) {
  MountedViews m;
  SentEvents<TextInputEventEmitter> sent;
  auto view = MountedViews::shadow(
      2, "TextInput", textInputProps(folly::dynamic::object("multiline", multiline)("editable", true)));
  view.eventEmitter = sent.emitter;
  m.add(view);
  NSTextView *editor = editorIn(m.view(2));
  REQUIRE((editor != nil));
  [m.window makeFirstResponder:editor];

  [editor insertText:@"a" replacementRange:NSMakeRange(NSNotFound, 0)];
  CHECK(sent.count("topKeyPress") == 1);
  for (SEL command : {@selector(moveUp:), @selector(cancelOperation:), @selector(deleteBackward:)}) {
    [editor doCommandBySelector:command];
  }
  CHECK(sent.count("topKeyPress") == 4);
  // Select All is no key of its own.
  [editor doCommandBySelector:@selector(selectAll:)];
  CHECK(sent.count("topKeyPress") == 4);
  // Tab, which the host's key monitor takes, from the input with the keyboard and no other.
  CHECK(NGNSendTextInputKeyPress(m.window, @"Tab"));
  CHECK(sent.count("topKeyPress") == 5);
  [m.window makeFirstResponder:nil];
  CHECK_FALSE(NGNSendTextInputKeyPress(m.window, @"Tab"));
  CHECK(sent.count("topKeyPress") == 5);
}

} // namespace

TEST_CASE("a single-line text input sends keyPress for a key typed and for Escape, the arrows and Backspace") {
  sendsKeyPresses(false);
}

TEST_CASE("a multiline text input sends keyPress for a key typed and for Escape, the arrows and Backspace") {
  sendsKeyPresses(true);
}
