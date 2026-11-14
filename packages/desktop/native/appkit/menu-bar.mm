#import "menu-bar.h"

namespace {

std::function<void(ngn::MenuCommand)> gHandler;

SEL selectorFor(ngn::MenuCommand command) {
  using C = ngn::MenuCommand;
  switch (command) {
    case C::About: return @selector(orderFrontStandardAboutPanel:);
    case C::Hide: return @selector(hide:);
    case C::HideOthers: return @selector(hideOtherApplications:);
    case C::ShowAll: return @selector(unhideAllApplications:);
    case C::Quit: return @selector(terminate:);
    case C::CloseWindow: return @selector(performClose:);
    case C::Undo: return @selector(undo:);
    case C::Redo: return @selector(redo:);
    case C::Cut: return @selector(cut:);
    case C::Copy: return @selector(copy:);
    case C::Paste: return @selector(paste:);
    case C::PasteAndMatchStyle: return @selector(pasteAsPlainText:);
    case C::Delete: return @selector(delete:);
    case C::SelectAll: return @selector(selectAll:);
    case C::ToggleFullScreen: return @selector(toggleFullScreen:);
    case C::Minimize: return @selector(performMiniaturize:);
    case C::Zoom: return @selector(performZoom:);
    case C::BringAllToFront: return @selector(arrangeInFront:);
    default: return nil;
  }
}

NSEventModifierFlags flagsFor(unsigned modifiers) {
  NSEventModifierFlags flags = 0;
  if (modifiers & ngn::Command) flags |= NSEventModifierFlagCommand;
  if (modifiers & ngn::Shift) flags |= NSEventModifierFlagShift;
  if (modifiers & ngn::Option) flags |= NSEventModifierFlagOption;
  if (modifiers & ngn::Control) flags |= NSEventModifierFlagControl;
  return flags;
}

} // namespace

// The target of the commands AppKit has no selector for.
@interface NGNMenuTarget : NSObject
- (void)performCommand:(NSMenuItem *)sender;
@end

@implementation NGNMenuTarget
- (void)performCommand:(NSMenuItem *)sender {
  if (gHandler) {
    gHandler(static_cast<ngn::MenuCommand>(sender.tag));
  }
}
@end

namespace ngn::appkit {

namespace {

NGNMenuTarget *target() {
  static NGNMenuTarget *t = [NGNMenuTarget new];
  return t;
}

NSMenu *build(const MenuItem &spec) {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:[NSString stringWithUTF8String:spec.title.c_str()]];
  for (const auto &child : spec.items) {
    if (child.separator) {
      [menu addItem:NSMenuItem.separatorItem];
      continue;
    }
    NSString *title = [NSString stringWithUTF8String:child.title.c_str()];
    NSString *key = [NSString stringWithUTF8String:child.key.c_str()];
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:key];
    item.keyEquivalentModifierMask = flagsFor(child.modifiers);
    if (!child.items.empty() || child.role != MenuRole::None) {
      NSMenu *sub = build(child);
      item.submenu = sub;
      if (child.role == MenuRole::Services) {
        NSApp.servicesMenu = sub;
      }
    } else if (SEL sel = selectorFor(child.command)) {
      // Nil-targeted: the responder chain answers, and disables the item when nothing can.
      item.action = sel;
    } else {
      item.action = @selector(performCommand:);
      item.target = target();
      item.tag = static_cast<NSInteger>(child.command);
    }
    [menu addItem:item];
  }
  return menu;
}

} // namespace

void installMenuBar(const std::vector<MenuItem> &menus, std::function<void(MenuCommand)> handler) {
  gHandler = std::move(handler);
  NSMenu *bar = [NSMenu new];
  for (const auto &spec : menus) {
    NSMenuItem *top = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    NSMenu *menu = build(spec);
    top.submenu = menu;
    [bar addItem:top];
    if (spec.role == MenuRole::Window) {
      NSApp.windowsMenu = menu;
    } else if (spec.role == MenuRole::Help) {
      NSApp.helpMenu = menu;
    }
  }
  NSApp.mainMenu = bar;
}

} // namespace ngn::appkit
