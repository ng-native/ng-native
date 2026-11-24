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

// An input method's composition sends no keyPress, as React Native iOS sends none: AppKit asks
// whether the text may change with the text already marked, from the first keystroke to the commit
// (NGNTypedKey's `composing`). A key typed after it sends one again.
void sendsNoKeyPressWhileComposing(bool multiline) {
  MountedViews m;
  SentEvents<TextInputEventEmitter> sent;
  auto view = MountedViews::shadow(
      2, "TextInput", textInputProps(folly::dynamic::object("multiline", multiline)("editable", true)));
  view.eventEmitter = sent.emitter;
  m.add(view);
  NSTextView *editor = editorIn(m.view(2));
  REQUIRE((editor != nil));
  [m.window makeFirstResponder:editor];

  NSRange none = NSMakeRange(NSNotFound, 0);
  [editor setMarkedText:@"k" selectedRange:NSMakeRange(1, 0) replacementRange:none];
  REQUIRE(editor.hasMarkedText);
  CHECK(sent.count("topKeyPress") == 0);
  [editor setMarkedText:@"か" selectedRange:NSMakeRange(1, 0) replacementRange:none];
  [editor insertText:@"か" replacementRange:none];
  CHECK_FALSE(editor.hasMarkedText);
  CHECK([editor.string isEqualToString:@"か"]);
  CHECK(sent.count("topKeyPress") == 0);
  [editor insertText:@"a" replacementRange:none];
  CHECK(sent.count("topKeyPress") == 1);
}

void limitsCompositionCommit(bool multiline, bool unmark) {
  SentEvents<TextInputEventEmitter> sent;
  MountedViews m;
  auto view = MountedViews::shadow(2, "TextInput", textInputProps(folly::dynamic::object("multiline", multiline)(
      "editable", true)("maxLength", 5)));
  view.eventEmitter = sent.emitter;
  m.add(view);
  NSTextView *editor = editorIn(m.view(2));
  REQUIRE((editor != nil));
  REQUIRE([m.window makeFirstResponder:editor]);
  editor.string = @"AxZ";
  editor.selectedRange = NSMakeRange(1, 1);

  NSRange none = NSMakeRange(NSNotFound, 0);
  NSString *marked = @"日本😀語";
  [editor setMarkedText:@"にほんご" selectedRange:NSMakeRange(4, 0) replacementRange:none];
  [editor setMarkedText:marked selectedRange:NSMakeRange(marked.length, 0) replacementRange:none];
  REQUIRE(editor.hasMarkedText);
  CHECK([editor.string isEqualToString:@"A日本😀語Z"]);
  CHECK(sent.count("topKeyPress") == 0);

  if (unmark) {
    [editor unmarkText];
  } else {
    [editor insertText:@"横浜😀町" replacementRange:none];
    CHECK(sent.count("topKeyPress") == 0);
  }
  NSString *committed = unmark ? @"A日本Z" : @"A横浜Z";
  CHECK_FALSE(editor.hasMarkedText);
  CHECK([editor.string isEqualToString:committed]);
  CHECK(NSEqualRanges(editor.selectedRange, NSMakeRange(3, 0)));

  // A shorter limit leaves no space at the caret. A range supplied by the IME can replace
  // more than the marked text, leaving room for part of an attributed candidate.
  [editor setMarkedText:@"かな" selectedRange:NSMakeRange(2, 0) replacementRange:none];
  REQUIRE(editor.hasMarkedText);
  m.update(view, textInputProps(folly::dynamic::object("multiline", multiline)("editable", true)("maxLength", 4)));
  REQUIRE(editor.hasMarkedText);
  [editor insertText:@"仮名" replacementRange:editor.markedRange];
  CHECK_FALSE(editor.hasMarkedText);
  CHECK([editor.string isEqualToString:committed]);
  CHECK(NSEqualRanges(editor.selectedRange, NSMakeRange(3, 0)));

  [editor setMarkedText:@"かな" selectedRange:NSMakeRange(2, 0) replacementRange:none];
  NSAttributedString *candidate = [[NSAttributedString alloc] initWithString:@"仮名"];
  [editor insertText:candidate replacementRange:NSMakeRange(2, 3)];
  NSString *replaced = unmark ? @"A日仮Z" : @"A横仮Z";
  CHECK_FALSE(editor.hasMarkedText);
  CHECK([editor.string isEqualToString:replaced]);

  // Ordinary typing at the limit can still replace a selection.
  editor.selectedRange = NSMakeRange(1, 2);
  [editor insertText:@"猫犬" replacementRange:none];
  CHECK([editor.string isEqualToString:@"A猫犬Z"]);

  m.update(view, textInputProps(folly::dynamic::object("multiline", multiline)("editable", true)));
  editor.selectedRange = NSMakeRange(editor.string.length, 0);
  [editor setMarkedText:@"かな" selectedRange:NSMakeRange(2, 0) replacementRange:none];
  [editor insertText:@"仮名" replacementRange:none];
  CHECK([editor.string isEqualToString:@"A猫犬Z仮名"]);
}

} // namespace

TEST_CASE("a single-line text input sends keyPress for a key typed and for Escape, the arrows and Backspace") {
  sendsKeyPresses(false);
}

TEST_CASE("a multiline text input sends keyPress for a key typed and for Escape, the arrows and Backspace") {
  sendsKeyPresses(true);
}

TEST_CASE("a single-line text input sends no keyPress for an input method's composition") {
  sendsNoKeyPressWhileComposing(false);
}

TEST_CASE("a multiline text input sends no keyPress for an input method's composition") {
  sendsNoKeyPressWhileComposing(true);
}

TEST_CASE("a text input limits a composition only when AppKit commits it") {
  for (bool multiline : {false, true}) {
    for (bool unmark : {false, true}) {
      CAPTURE(multiline);
      CAPTURE(unmark);
      limitsCompositionCommit(multiline, unmark);
    }
  }
}
