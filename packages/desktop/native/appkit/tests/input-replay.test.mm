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
// Focused when a press is released, as a control whose action focuses a field.
@property(nonatomic, weak) NSView *focusOnRelease;
// Run when a press is released, before the press's handling returns, as a control's action.
@property(nonatomic, copy) void (^onRelease)(void);
@end
@implementation NGNTrackingTestView
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}
- (BOOL)acceptsFirstResponder {
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
      if (self.focusOnRelease != nil) {
        [self.window makeFirstResponder:self.focusOnRelease];
      }
      if (self.onRelease != nil) {
        self.onRelease();
      }
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

TEST_CASE("the steps after a tracked press's release wait for the press to end") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NGNTrackingTestView *view = [[NGNTrackingTestView alloc] initWithFrame:NSMakeRect(0, 0, 300, 200)];
  window.contentView = view;
  NSTextField *field = [[NSTextField alloc] initWithFrame:NSMakeRect(150, 150, 140, 24)];
  [view addSubview:field];
  view.focusOnRelease = field;
  [window orderFront:nil];
  // The press's view has the keyboard until the release moves it to the field.
  REQUIRE([window makeFirstResponder:view]);
  auto script = ngn::parseInputScript("down 50 50\nup 50 50\ntype hi\n");
  REQUIRE_FALSE(script.error);
  ngn::appkit::replayInputScript(window, std::move(script));
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:8];
  while (![field.currentEditor.string isEqualToString:@"hi"] && view.stuck == 0 && until.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  CHECK(view.stuck == 0);
  CHECK(view.clicks == 1);
  // The release focused the field before the text was typed.
  CHECK([field.currentEditor.string isEqualToString:@"hi"]);
  [window close];
}

TEST_CASE("a key step reaches an alert a tracked press's release runs, so the press can end") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NGNTrackingTestView *view = [[NGNTrackingTestView alloc] initWithFrame:NSMakeRect(0, 0, 300, 200)];
  window.contentView = view;
  NSTextField *field = [[NSTextField alloc] initWithFrame:NSMakeRect(150, 150, 140, 24)];
  [view addSubview:field];
  [window orderFront:nil];
  __block NSModalResponse response = 0;
  __block bool timedOut = false;
  // The release's action runs an alert inside the press's handling, as a button's action can.
  view.onRelease = ^{
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Replayed";
    [alert addButtonWithTitle:@"OK"];
    NSTimer *guard = [NSTimer timerWithTimeInterval:5
                                            repeats:NO
                                              block:^(NSTimer *) {
                                                timedOut = true;
                                                [NSApp abortModal];
                                              }];
    [NSRunLoop.mainRunLoop addTimer:guard forMode:NSModalPanelRunLoopMode];
    response = [alert runModal];
    [guard invalidate];
    [window makeFirstResponder:field];
  };
  // The alert's default button takes a return sent to the key window. This process is never active,
  // so no window is key: a monitor of the keys NSApp is sent stands in for the button, for a return
  // sent to the alert while it runs.
  __block bool returnToAlert = false;
  id monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                                     handler:^NSEvent *(NSEvent *event) {
                                                       NSWindow *modal = NSApp.modalWindow;
                                                       if (modal != nil && event.keyCode == 36 &&
                                                           event.windowNumber == modal.windowNumber) {
                                                         returnToAlert = true;
                                                         [NSApp stopModalWithCode:NSAlertFirstButtonReturn];
                                                         return nil;
                                                       }
                                                       return event;
                                                     }];
  // The return dismisses the alert; the typing waits for the press to end, after the alert.
  auto script = ngn::parseInputScript("down 50 50\nup 50 50\nkey return\ntype hi\n");
  REQUIRE_FALSE(script.error);
  ngn::appkit::replayInputScript(window, std::move(script));
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:10];
  while (![field.currentEditor.string isEqualToString:@"hi"] && !timedOut && view.stuck == 0 &&
         until.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  [NSEvent removeMonitor:monitor];
  CHECK_FALSE(timedOut);
  CHECK(returnToAlert);
  CHECK(response == NSAlertFirstButtonReturn);
  CHECK([field.currentEditor.string isEqualToString:@"hi"]);
  [window close];
}

TEST_CASE("a type step reaches the field of an alert a tracked press's release runs, with no window key") {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
  window.releasedWhenClosed = NO;
  NGNTrackingTestView *view = [[NGNTrackingTestView alloc] initWithFrame:NSMakeRect(0, 0, 300, 200)];
  window.contentView = view;
  [window orderFront:nil];
  [NSApp deactivate];
  __block NSString *typed = nil;
  __block bool timedOut = false;
  __block bool noKeyWindow = false;
  view.onRelease = ^{
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Name";
    [alert addButtonWithTitle:@"OK"];
    NSTextField *name = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 200, 24)];
    alert.accessoryView = name;
    [alert layout];
    alert.window.initialFirstResponder = name;
    NSTimer *guard = [NSTimer timerWithTimeInterval:5
                                            repeats:NO
                                              block:^(NSTimer *) {
                                                timedOut = true;
                                                [NSApp abortModal];
                                              }];
    [NSRunLoop.mainRunLoop addTimer:guard forMode:NSModalPanelRunLoopMode];
    // In the session: the alert's field takes the keyboard, though its window is not key.
    NSTimer *focus = [NSTimer timerWithTimeInterval:0
                                            repeats:NO
                                              block:^(NSTimer *) {
                                                noKeyWindow = NSApp.keyWindow == nil;
                                                [alert.window makeFirstResponder:name];
                                              }];
    [NSRunLoop.mainRunLoop addTimer:focus forMode:NSModalPanelRunLoopMode];
    [alert runModal];
    [guard invalidate];
    typed = name.stringValue;
  };
  // The return ends the session once the typing is in, as the alert's default button would.
  id monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                                     handler:^NSEvent *(NSEvent *event) {
                                                       NSWindow *modal = NSApp.modalWindow;
                                                       if (modal != nil && event.keyCode == 36) {
                                                         [NSApp stopModalWithCode:NSAlertFirstButtonReturn];
                                                         return nil;
                                                       }
                                                       return event;
                                                     }];
  auto script = ngn::parseInputScript("down 50 50\nup 50 50\nwait 50\ntype ok\nkey return\n");
  REQUIRE_FALSE(script.error);
  ngn::appkit::replayInputScript(window, std::move(script));
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:10];
  while (typed == nil && !timedOut && view.stuck == 0 && until.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  }
  [NSEvent removeMonitor:monitor];
  CHECK_FALSE(timedOut);
  CHECK(noKeyWindow);
  CHECK([typed isEqualToString:@"ok"]);
  [window close];
}
