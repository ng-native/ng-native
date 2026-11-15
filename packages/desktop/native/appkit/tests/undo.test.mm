// undoManagerFor (undo.mm): which history a window's undo reaches, by what has the focus.
#import "../undo.h"

#include <doctest/doctest.h>

#import <WebKit/WebKit.h>

namespace {

NSWindow *windowWith(NSView *content) {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:YES];
  window.releasedWhenClosed = NO;
  window.delegate = NGNUndoWindowDelegate.shared;
  [window.contentView addSubview:content];
  return window;
}

// What AppKit's own editors do as the user edits: register an undo with no group begun, which
// a manager that groups by event takes and one that does not throws on.
bool registersAnEdit(NSUndoManager *manager) {
  @try {
    [manager registerUndoWithTarget:manager handler:^(id) {}];
    return true;
  } @catch (NSException *) {
    return false;
  }
}

} // namespace

TEST_CASE("a focused web view's edits go to a history of the window's own, so WebKit's undo never throws") {
  WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 200, 100)];
  NSWindow *window = windowWith(web);
  REQUIRE([window makeFirstResponder:web]);
  NSUndoManager *manager = window.undoManager;
  CHECK(manager.groupsByEvent);
  CHECK(registersAnEdit(manager));
  CHECK((manager == ngn::appkit::undoManagerFor(window)));
  [window close];
}

TEST_CASE("with nothing focused that edits, the window's undo reaches the app's actions") {
  NSView *plain = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 10, 10)];
  NSWindow *window = windowWith(plain);
  [window makeFirstResponder:nil];
  CHECK_FALSE(window.undoManager.groupsByEvent);
  // The window's undo is the app's: an action the app registers is undone through it.
  auto app = ngn::appkit::makeUndoManager();
  int undone = 0;
  app->registerAction("Rename", [&] { undone++; });
  REQUIRE(window.undoManager.canUndo);
  CHECK([window.undoManager.undoActionName isEqualToString:@"Rename"]);
  [window.undoManager undo];
  CHECK(undone == 1);
  app->clear();
  [window close];
}
