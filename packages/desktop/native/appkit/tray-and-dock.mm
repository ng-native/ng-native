#import "tray-and-dock.h"

#import "menu-bar.h"

#import <objc/runtime.h>

// The target of a status item's button, for an icon with no menu.
@interface NGNTrayButtonTarget : NSObject
@property (nonatomic, copy) NSString *icon;
@property (nonatomic) std::function<void(const std::string &)> pressed;
- (void)press:(id)sender;
@end

@implementation NGNTrayButtonTarget
- (void)press:(id)sender {
  if (_pressed) {
    _pressed(std::string(_icon.UTF8String));
  }
}
@end

namespace ngn::appkit {

namespace {

void onMain(std::function<void()> task) {
  auto shared = std::make_shared<std::function<void()>>(std::move(task));
  dispatch_async(dispatch_get_main_queue(), ^{
    (*shared)();
  });
}

NSString *string(const std::string &s) {
  NSString *out = [NSString stringWithUTF8String:s.c_str()];
  return out != nil ? out : @"";
}

NSImage *iconImage(const TrayIcon &icon) {
  NSImage *image = nil;
  if (!icon.sfSymbol.empty()) {
    image = [NSImage imageWithSystemSymbolName:string(icon.sfSymbol) accessibilityDescription:string(icon.tooltip)];
    // A template follows the menu bar's appearance, light or dark.
    [image setTemplate:YES];
  } else if (!icon.image.empty()) {
    image = [NSImage imageNamed:string(icon.image)];
  }
  return image;
}

} // namespace

AppKitTray::AppKitTray(std::function<void(const std::string &)> pressed,
                       std::function<void(const std::string &, const std::string &)> chose)
    : pressed_(std::move(pressed)), chose_(std::move(chose)), items_([NSMutableDictionary dictionary]) {}

void AppKitTray::setIcons(std::vector<TrayIcon> icons) {
  onMain([this, icons = std::move(icons)] {
    NSMutableSet<NSString *> *kept = [NSMutableSet set];
    for (const auto &icon : icons) {
      NSString *key = string(icon.id);
      [kept addObject:key];
      NSStatusItem *item = items_[key];
      if (item == nil) {
        item = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
        items_[key] = item;
      }
      NSImage *image = iconImage(icon);
      item.button.image = image;
      item.button.imagePosition = image != nil && !icon.title.empty() ? NSImageLeading : NSImageOnly;
      item.button.title = string(icon.title);
      if (image == nil && icon.title.empty()) {
        // Something to click, rather than an empty slot.
        item.button.title = @"•";
      }
      item.button.toolTip = icon.tooltip.empty() ? nil : string(icon.tooltip);
      if (icon.menu) {
        std::string id = icon.id;
        auto chose = chose_;
        item.menu = buildMenu("", *icon.menu, [id, chose](const MenuItem &chosen) { chose(id, chosen.id); });
        item.button.target = nil;
        item.button.action = nil;
      } else {
        item.menu = nil;
        NGNTrayButtonTarget *target = [NGNTrayButtonTarget new];
        target.icon = key;
        target.pressed = pressed_;
        // The button holds its target weakly: the item keeps it.
        objc_setAssociatedObject(item, "ngnTarget", target, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        item.button.target = target;
        item.button.action = @selector(press:);
      }
    }
    for (NSString *key in items_.allKeys) {
      if (![kept containsObject:key]) {
        [NSStatusBar.systemStatusBar removeStatusItem:items_[key]];
        [items_ removeObjectForKey:key];
      }
    }
  });
}

AppKitDock::AppKitDock(std::function<void(const std::string &)> chose) : chose_(std::move(chose)), menu_(nil) {}

void AppKitDock::setMenu(std::optional<std::vector<MenuItem>> menu) {
  onMain([this, menu = std::move(menu)] {
    auto chose = chose_;
    menu_ = menu ? buildMenu("", *menu, [chose](const MenuItem &item) { chose(item.id); }) : nil;
  });
}

void AppKitDock::bounce(int id, bool critical) {
  onMain([this, id, critical] {
    // Zero when the app is active, which needs no attention.
    NSInteger request = [NSApp requestUserAttention:critical ? NSCriticalRequest : NSInformationalRequest];
    if (request != 0) {
      requests_[id] = request;
    }
  });
}

void AppKitDock::cancelBounce(int id) {
  onMain([this, id] {
    if (auto it = requests_.find(id); it != requests_.end()) {
      [NSApp cancelUserAttentionRequest:it->second];
      requests_.erase(it);
    }
  });
}

} // namespace ngn::appkit
