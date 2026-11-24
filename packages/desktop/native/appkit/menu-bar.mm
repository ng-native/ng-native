#import "menu-bar.h"

#import "svg-icon.h"

using ngn::MenuCommand;
using ngn::MenuItem;

namespace {

SEL selectorFor(MenuCommand command) {
  using C = MenuCommand;
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
    case C::Find: return @selector(performFindPanelAction:);
    case C::ToggleSidebar: return @selector(toggleSidebar:);
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

NSString *string(const std::string &s) {
  NSString *out = [NSString stringWithUTF8String:s.c_str()];
  return out != nil ? out : @"";
}

} // namespace

// An item the host handles: the core's model of it, and who hears it chosen.
@interface NGNMenuBox : NSObject {
 @public
  MenuItem item;
  ngn::appkit::MenuChosen chosen;
}
@end

@implementation NGNMenuBox
@end

// The target of every item AppKit has no selector for.
@interface NGNMenuTarget : NSObject <NSMenuItemValidation>
- (void)performCommand:(NSMenuItem *)sender;
@end

@implementation NGNMenuTarget
- (void)performCommand:(NSMenuItem *)sender {
  NGNMenuBox *box = sender.representedObject;
  if (box != nil && box->chosen) {
    box->chosen(box->item);
  }
}
- (BOOL)validateMenuItem:(NSMenuItem *)menuItem {
  NGNMenuBox *box = menuItem.representedObject;
  return box == nil || !box->item.disabled;
}
@end

namespace ngn::appkit {

namespace {

NGNMenuTarget *target() {
  static NGNMenuTarget *t = [NGNMenuTarget new];
  return t;
}

void addItems(NSMenu *menu, const std::vector<MenuItem> &items, const MenuChosen &chosen);

// The side of an item's SVG icon: what a menu draws an SF Symbol at.
constexpr CGFloat kMenuIconSize = 16;

NSMenuItem *makeItem(const MenuItem &spec, const MenuChosen &chosen) {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:string(spec.title) action:nil keyEquivalent:keyEquivalent(spec.key)];
  item.keyEquivalentModifierMask = flagsFor(spec.modifiers);
  if (spec.checked) {
    item.state = NSControlStateValueOn;
  }
  if (!spec.sfSymbol.empty()) {
    item.image = [NSImage imageWithSystemSymbolName:string(spec.sfSymbol) accessibilityDescription:nil];
  } else {
    item.image = NGNSvgTemplateImage(spec.svgIcon, kMenuIconSize);
  }
  if (!spec.subtitle.empty() && [item respondsToSelector:@selector(setSubtitle:)]) {
    [item performSelector:@selector(setSubtitle:) withObject:string(spec.subtitle)];
  }
  if (!spec.items.empty() || spec.role != MenuRole::None) {
    item.submenu = buildMenu(spec.title, spec.items, chosen);
    if (spec.role == MenuRole::Services) {
      NSApp.servicesMenu = item.submenu;
    }
  } else if (SEL sel = selectorFor(spec.command)) {
    // Nil-targeted: the responder chain answers, and disables the item when nothing can.
    item.action = sel;
    if (spec.command == MenuCommand::Find) {
      item.tag = NSFindPanelActionShowFindPanel;
    }
  } else {
    NGNMenuBox *box = [NGNMenuBox new];
    box->item = spec;
    box->chosen = chosen;
    item.representedObject = box;
    item.action = @selector(performCommand:);
    item.target = target();
  }
  // An app's disabled role item is disabled whatever the responder chain says.
  if (spec.disabled && item.target == nil && item.action != nil) {
    item.action = nil;
  }
  return item;
}

void addItems(NSMenu *menu, const std::vector<MenuItem> &items, const MenuChosen &chosen) {
  for (const auto &child : items) {
    if (child.separator) {
      [menu addItem:NSMenuItem.separatorItem];
    } else if (child.inlineItems) {
      // A section drawn in place, between separators.
      if (menu.numberOfItems > 0 && !menu.itemArray.lastObject.separatorItem) {
        [menu addItem:NSMenuItem.separatorItem];
      }
      addItems(menu, child.items, chosen);
      [menu addItem:NSMenuItem.separatorItem];
    } else {
      [menu addItem:makeItem(child, chosen)];
    }
  }
}

} // namespace

NSString *keyEquivalent(const std::string &key) {
  // One character, counted as the user sees it: "é" is two bytes of UTF-8.
  NSString *character = string(key);
  if (character.length == 0 || [character rangeOfComposedCharacterSequenceAtIndex:0].length == character.length) {
    return character;
  }
  static NSDictionary<NSString *, NSString *> *named = @{
    @"ArrowLeft" : [NSString stringWithFormat:@"%C", (unichar)NSLeftArrowFunctionKey],
    @"ArrowRight" : [NSString stringWithFormat:@"%C", (unichar)NSRightArrowFunctionKey],
    @"ArrowUp" : [NSString stringWithFormat:@"%C", (unichar)NSUpArrowFunctionKey],
    @"ArrowDown" : [NSString stringWithFormat:@"%C", (unichar)NSDownArrowFunctionKey],
    @"Enter" : @"\r",
    @"Escape" : @"\x1b",
    @"Backspace" : @"\b",
    @"Delete" : [NSString stringWithFormat:@"%C", (unichar)NSDeleteFunctionKey],
    @"Tab" : @"\t",
    @"Home" : [NSString stringWithFormat:@"%C", (unichar)NSHomeFunctionKey],
    @"End" : [NSString stringWithFormat:@"%C", (unichar)NSEndFunctionKey],
    @"PageUp" : [NSString stringWithFormat:@"%C", (unichar)NSPageUpFunctionKey],
    @"PageDown" : [NSString stringWithFormat:@"%C", (unichar)NSPageDownFunctionKey],
  };
  NSString *name = string(key);
  if (NSString *found = named[name]) {
    return found;
  }
  if ([name hasPrefix:@"F"] && name.length <= 3) {
    int n = [name substringFromIndex:1].intValue;
    if (n >= 1 && n <= 20) {
      return [NSString stringWithFormat:@"%C", (unichar)(NSF1FunctionKey + n - 1)];
    }
  }
  return @"";
}

NSString *keyName(unsigned short keyCode) {
  static NSDictionary<NSNumber *, NSString *> *named = @{
    @123 : @"ArrowLeft", @124 : @"ArrowRight", @125 : @"ArrowDown", @126 : @"ArrowUp",
    @36 : @"Enter", @76 : @"Enter", @53 : @"Escape", @51 : @"Backspace", @117 : @"Delete",
    @48 : @"Tab", @115 : @"Home", @119 : @"End", @116 : @"PageUp", @121 : @"PageDown",
    @122 : @"F1", @120 : @"F2", @99 : @"F3", @118 : @"F4", @96 : @"F5", @97 : @"F6",
    @98 : @"F7", @100 : @"F8", @101 : @"F9", @109 : @"F10", @103 : @"F11", @111 : @"F12",
    @105 : @"F13", @107 : @"F14", @113 : @"F15", @106 : @"F16", @64 : @"F17", @79 : @"F18",
    @80 : @"F19", @90 : @"F20",
  };
  return named[@(keyCode)];
}

NSMenu *buildMenu(const std::string &title, const std::vector<MenuItem> &items, MenuChosen chosen) {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:string(title)];
  addItems(menu, items, chosen);
  // A trailing separator, as an inline section leaves at the end, draws nothing useful.
  while (menu.numberOfItems > 0 && menu.itemArray.lastObject.separatorItem) {
    [menu removeItemAtIndex:menu.numberOfItems - 1];
  }
  return menu;
}

void installMenuBar(const std::vector<MenuItem> &menus, MenuChosen chosen) {
  NSMenu *bar = [NSMenu new];
  for (const auto &spec : menus) {
    NSMenuItem *top = [[NSMenuItem alloc] initWithTitle:string(spec.title) action:nil keyEquivalent:@""];
    NSMenu *menu = buildMenu(spec.title, spec.items, chosen);
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

// The gap between the view and the menu under it, as a pull-down button leaves.
constexpr CGFloat kMenuGap = 2;

NSPoint menuLocationUnder(NSView *view) {
  NSRect bounds = view.bounds;
  bool rightToLeft = view.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
  return NSMakePoint(
      rightToLeft ? NSMaxX(bounds) : NSMinX(bounds), view.isFlipped ? NSMaxY(bounds) + kMenuGap : NSMinY(bounds) - kMenuGap);
}

void popUpMenuUnder(NSMenu *menu, NSView *view) {
  // A right-to-left menu is placed by its top right corner.
  menu.userInterfaceLayoutDirection = view.userInterfaceLayoutDirection;
  [menu popUpMenuPositioningItem:nil atLocation:menuLocationUnder(view) inView:view];
}

} // namespace ngn::appkit
