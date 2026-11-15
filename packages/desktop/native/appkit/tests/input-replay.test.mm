// The input script's replay (input-replay.mm): a trackpad scroll reaches the view under its point,
// whichever window the pointer is really over.
#include "../input-replay.h"

#include <doctest/doctest.h>

@interface NGNFlippedTestView : NSView
@end
@implementation NGNFlippedTestView
- (BOOL)isFlipped {
  return YES;
}
@end

TEST_CASE("a replayed scroll moves the scroll view under its point, though the pointer is elsewhere") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(0, 0, 300, 200)];
  scroll.documentView = [[NGNFlippedTestView alloc] initWithFrame:NSMakeRect(0, 0, 300, 4000)];
  window.contentView = scroll;
  // On screen, as a dev run's window is, though never key.
  [window orderFront:nil];
  [window layoutIfNeeded];
  REQUIRE(scroll.contentView.bounds.origin.y == 0);

  // No phase: a phased one starts NSScrollView tracking the gesture, which waits for the real
  // trackpad's next events.
  auto script = ngn::parseInputScript("scroll 150 100 0 120\nscroll 150 100 0 120\n");
  REQUIRE_FALSE(script.error);
  for (const auto &step : script.steps) {
    ngn::appkit::playInputStep(window, step);
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  // The scroll lands on the run loop.
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:2];
  while (scroll.contentView.bounds.origin.y <= 100 && until.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  CHECK(scroll.contentView.bounds.origin.y > 100);
  [window close];
}

@interface NGNChoiceTestTarget : NSObject
@property(nonatomic, copy) NSString *chosen;
@end
@implementation NGNChoiceTestTarget
- (void)choose:(NSMenuItem *)item {
  self.chosen = item.title;
}
@end

TEST_CASE("a choose step picks the item with its title in the next menu that opens, and only that menu") {
  [NSApplication sharedApplication];
  NGNChoiceTestTarget *target = [NGNChoiceTestTarget new];
  auto menuOf = [&](NSArray<NSString *> *titles) {
    NSMenu *menu = [NSMenu new];
    for (NSString *title in titles) {
      NSMenuItem *item = [menu addItemWithTitle:title action:@selector(choose:) keyEquivalent:@""];
      item.target = target;
    }
    return menu;
  };
  auto opens = [](NSMenu *menu) {
    [NSNotificationCenter.defaultCenter postNotificationName:NSMenuDidBeginTrackingNotification object:menu];
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1.3]];
  };
  auto script = ngn::parseInputScript("choose United States\n");
  REQUIRE_FALSE(script.error);
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 10, 10)
                                                 styleMask:NSWindowStyleMaskBorderless
                                                   backing:NSBackingStoreBuffered
                                                     defer:YES];
  ngn::appkit::playInputStep(window, script.steps[0]);
  opens(menuOf(@[ @"United Kingdom", @"United States" ]));
  CHECK([target.chosen isEqualToString:@"United States"]);

  target.chosen = nil;
  opens(menuOf(@[ @"United States" ]));
  CHECK((target.chosen == nil));
}

TEST_CASE("a type step types its text, spaces and all, into the focused field a character at a time") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSTextField *field = [[NSTextField alloc] initWithFrame:NSMakeRect(10, 10, 200, 24)];
  [window.contentView addSubview:field];
  REQUIRE([window makeFirstResponder:field]);

  auto script = ngn::parseInputScript("type hello big\nkey space\ntype world");
  REQUIRE_FALSE(script.error);
  for (const auto &step : script.steps) {
    ngn::appkit::playInputStep(window, step);
  }
  CHECK([field.currentEditor.string isEqualToString:@"hello big world"]);
  [window close];
}

TEST_CASE("a key step with Shift types the shifted character into the focused field") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NSTextField *field = [[NSTextField alloc] initWithFrame:NSMakeRect(10, 10, 200, 24)];
  [window.contentView addSubview:field];
  REQUIRE([window makeFirstResponder:field]);
  auto script = ngn::parseInputScript("key a shift\nkey b");
  REQUIRE_FALSE(script.error);
  for (const auto &step : script.steps) {
    ngn::appkit::playInputStep(window, step);
  }
  CHECK([field.currentEditor.string isEqualToString:@"Ab"]);
  [window close];
}

// Tracks each press in a loop of its own, as AppKit's controls do, reading drags and the release
// from the event queue.
@interface NGNTrackingTestView : NSView
@property(nonatomic) int clicks;
@property(nonatomic) int drags;
@property(nonatomic) int stuck;
// Each click as "press x>release x", in the order the clicks end.
@property(nonatomic, strong) NSMutableArray<NSString *> *ended;
@end
@implementation NGNTrackingTestView
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}
- (void)mouseDown:(NSEvent *)event {
  if (self.ended == nil) {
    self.ended = [NSMutableArray array];
  }
  while (true) {
    NSEvent *next = [self.window nextEventMatchingMask:NSEventMaskLeftMouseUp | NSEventMaskLeftMouseDragged
                                             untilDate:[NSDate dateWithTimeIntervalSinceNow:2]
                                                inMode:NSEventTrackingRunLoopMode
                                               dequeue:YES];
    if (next == nil) {
      self.stuck++;
      return;
    }
    if (next.type == NSEventTypeLeftMouseDragged) {
      self.drags++;
    } else {
      self.clicks++;
      [self.ended addObject:[NSString stringWithFormat:@"%g>%g", event.locationInWindow.x, next.locationInWindow.x]];
      return;
    }
  }
}
@end

TEST_CASE("a press a view tracks in its own loop gets its drags and release, and back-to-back clicks each end") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NGNTrackingTestView *view = [[NGNTrackingTestView alloc] initWithFrame:NSMakeRect(0, 0, 300, 200)];
  window.contentView = view;
  [window orderFront:nil];
  auto script = ngn::parseInputScript("down 50 50\ndrag 60 60\nup 60 60\ndown 100 50\nup 100 50\n");
  REQUIRE_FALSE(script.error);
  ngn::appkit::replayInputScript(window, std::move(script));
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:8];
  while (view.clicks + view.stuck < 2 && until.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  CHECK(view.stuck == 0);
  CHECK(view.clicks == 2);
  CHECK(view.drags == 1);
  // Each press gets its own release.
  CHECK([view.ended isEqualToArray:@[ @"50>60", @"100>100" ]]);
  [window close];
}
