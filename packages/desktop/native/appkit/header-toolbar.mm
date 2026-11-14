#import "header-toolbar.h"

#import "surface-view.h"

#include "ngn/header-bar.h"

#include <react/renderer/graphics/Color.h>

using namespace facebook::react;

namespace {

ngn::InputSink *gInput = nullptr;
std::function<void(NSInteger, BOOL)> gContainerRootChanged;

NSToolbarItemIdentifier const kBack = @"ngn.back";

NSColor *nsColor(const SharedColor &color) {
  if (!color) {
    return nil;
  }
  auto c = colorComponentsFromColor(color);
  return [NSColor colorWithSRGBRed:c.red green:c.green blue:c.blue alpha:c.alpha];
}

NSString *nsString(const std::string &s) {
  NSString *result = [NSString stringWithUTF8String:s.c_str()];
  return result != nil ? result : @"";
}

NSImage *symbol(const std::string &name, NSString *description) {
  if (name.empty()) {
    return nil;
  }
  return [NSImage imageWithSystemSymbolName:nsString(name) accessibilityDescription:description];
}

} // namespace

#pragma mark - Config and subviews

@implementation NGNHeaderConfigView
- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    // Its subtree is never hit in the window's content: what of it shows is in the toolbar.
    if (gContainerRootChanged) {
      gContainerRootChanged(view.tag, YES);
    }
  }
  return self;
}
- (void)setHidden:(BOOL)hidden {
  [super setHidden:YES];
}
@end

@interface NGNHeaderSubviewView ()
@property (nonatomic) BOOL hosted;
@property (nonatomic, copy) void (^sizeChanged)(NSSize size);
@end

@implementation NGNHeaderSubviewView
- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  if (_hosted) {
    [self setFrameOrigin:NSZeroPoint];
    if (_sizeChanged) {
      _sizeChanged(self.frame.size);
    }
  }
}
@end

#pragma mark - Toolbar

// A toolbar item's container for a header item's content: part of the surface, hit-tested from
// the item's root.
@interface NGNHeaderItemContainer : NGNSurfaceView
@property (nonatomic, strong) NSLayoutConstraint *width;
@property (nonatomic, strong) NSLayoutConstraint *height;
@end

@implementation NGNHeaderItemContainer
@end

@implementation NGNHeaderToolbar {
  __weak NSWindow *_window;
  NSString *_appTitle;
  NSToolbar *_toolbar;
  NGNHeaderConfigView *_config;
  NGNView *_screen;
  BOOL _canGoBack;
  ngn::HeaderBar _bar;
  NSArray<NSToolbarItemIdentifier> *_identifiers;
  // Header item views now in the toolbar, by identifier, and the config each came from.
  NSMutableDictionary<NSToolbarItemIdentifier, NGNHeaderSubviewView *> *_hosted;
  NSMapTable<NGNHeaderSubviewView *, NSView *> *_homes;
}

+ (ngn::InputSink *)input {
  return gInput;
}
+ (void)setInput:(ngn::InputSink *)input {
  gInput = input;
}
+ (std::function<void(NSInteger, BOOL)>)containerRootChanged {
  return gContainerRootChanged;
}
+ (void)setContainerRootChanged:(std::function<void(NSInteger, BOOL)>)fn {
  gContainerRootChanged = std::move(fn);
}

- (instancetype)initWithWindow:(NSWindow *)window {
  if ((self = [super init])) {
    _window = window;
    _appTitle = window.title;
    _identifiers = @[];
    _hosted = [NSMutableDictionary dictionary];
    _homes = [NSMapTable weakToWeakObjectsMapTable];
    _toolbar = [[NSToolbar alloc] initWithIdentifier:@"ngn.header"];
    _toolbar.delegate = self;
    _toolbar.displayMode = NSToolbarDisplayModeIconOnly;
    _toolbar.allowsUserCustomization = NO;
  }
  return self;
}

- (void)showConfig:(NGNHeaderConfigView *)config screen:(NGNView *)screen canGoBack:(BOOL)canGoBack {
  _config = config;
  _screen = screen;
  _canGoBack = canGoBack;
  [self rebuild];
}

- (void)refreshIfShowing:(NGNView *)view {
  if (_config == nil) {
    return;
  }
  for (NSView *v = view; v != nil; v = v.superview) {
    if (v == _config) {
      [self rebuild];
      return;
    }
  }
  // A hosted item's own content changed: its size follows its layout.
}

- (NSArray<NGNHeaderSubviewView *> *)itemsOfType:(const std::string &)type {
  NSMutableArray *items = [NSMutableArray array];
  for (NSView *v in _config.subviews) {
    if ([v isKindOfClass:NGNHeaderSubviewView.class] && ((NGNView *)v).props &&
        ngn::headerItemType(*((NGNView *)v).props) == type) {
      [items addObject:v];
    }
  }
  // Those already in the toolbar are no longer the config's subviews.
  for (NGNHeaderSubviewView *v in _hosted.allValues) {
    if ([_homes objectForKey:v] == _config && v.props && ngn::headerItemType(*v.props) == type) {
      [items addObject:v];
    }
  }
  [items sortUsingComparator:^NSComparisonResult(NGNView *a, NGNView *b) {
    return a.reactTag < b.reactTag ? NSOrderedAscending : a.reactTag > b.reactTag ? NSOrderedDescending : NSOrderedSame;
  }];
  return items;
}

- (void)returnHostedViews {
  for (NSToolbarItemIdentifier identifier in _hosted) {
    NGNHeaderSubviewView *view = _hosted[identifier];
    NSView *home = [_homes objectForKey:view];
    BOOL stillMounted = view.superview != nil;
    view.hosted = NO;
    view.sizeChanged = nil;
    [view removeFromSuperview];
    if (stillMounted && home != nil) {
      [home addSubview:view];
    }
    if (gContainerRootChanged) {
      gContainerRootChanged(view.reactTag, NO);
    }
  }
  [_hosted removeAllObjects];
}

- (void)rebuild {
  NSWindow *window = _window;
  if (window == nil) {
    return;
  }
  [self returnHostedViews];
  auto bar = _config && _config.props ? ngn::headerBar(*_config.props) : std::nullopt;
  _bar = bar.value_or(ngn::HeaderBar{});

  NSMutableArray<NSToolbarItemIdentifier> *ids = [NSMutableArray array];
  if (bar) {
    NSArray *left = [self itemsOfType:"left"];
    NSArray *center = [self itemsOfType:"center"];
    NSArray *right = [self itemsOfType:"right"];
    BOOL replacesBack = left.count > 0 || !_bar.left.empty();
    if (_canGoBack && !_bar.hideBackButton && !replacesBack) {
      [ids addObject:kBack];
    }
    for (NGNHeaderSubviewView *v in left) {
      [ids addObject:[self host:v]];
    }
    for (size_t i = 0; i < _bar.left.size(); i++) {
      [ids addObject:[NSString stringWithFormat:@"ngn.button.left.%zu", i]];
    }
    [ids addObject:NSToolbarFlexibleSpaceItemIdentifier];
    for (NGNHeaderSubviewView *v in center) {
      [ids addObject:[self host:v]];
    }
    if (center.count > 0) {
      [ids addObject:NSToolbarFlexibleSpaceItemIdentifier];
    }
    for (size_t i = 0; i < _bar.right.size(); i++) {
      [ids addObject:[NSString stringWithFormat:@"ngn.button.right.%zu", i]];
    }
    for (NGNHeaderSubviewView *v in right) {
      [ids addObject:[self host:v]];
    }
  }
  _identifiers = ids;

  window.title = bar && !_bar.title.empty() ? nsString(_bar.title) : _appTitle;
  while (_toolbar.items.count > 0) {
    [_toolbar removeItemAtIndex:0];
  }
  for (NSUInteger i = 0; i < ids.count; i++) {
    [_toolbar insertItemWithItemIdentifier:ids[i] atIndex:(NSInteger)i];
  }
  if (bar && !_bar.hidden) {
    window.toolbar = _toolbar;
    window.toolbarStyle = NSWindowToolbarStyleUnified;
    window.titlebarSeparatorStyle = _bar.hideShadow ? NSTitlebarSeparatorStyleNone : NSTitlebarSeparatorStyleAutomatic;
  } else {
    window.toolbar = nil;
  }
  // The safe area's top follows the toolbar; containers report it as they lay out.
  window.contentView.needsLayout = YES;
}

// Moves a header item's view into a container of its own, which its toolbar item shows.
- (NSToolbarItemIdentifier)host:(NGNHeaderSubviewView *)view {
  NSToolbarItemIdentifier identifier = [NSString stringWithFormat:@"ngn.view.%ld", (long)view.reactTag];
  [_homes setObject:view.superview != nil ? view.superview : _config forKey:view];
  _hosted[identifier] = view;
  return identifier;
}

- (NSToolbarItem *)toolbar:(NSToolbar *)toolbar
        itemForItemIdentifier:(NSToolbarItemIdentifier)identifier
    willBeInsertedIntoToolbar:(BOOL)flag {
  NSToolbarItem *item = nil;
  NSColor *tint = nsColor(_bar.color);
  if ([identifier isEqualToString:kBack]) {
    item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
    NSButton *button = [self buttonWithTitle:nil
                                       image:symbol("chevron.backward", @"Back")
                                        tint:tint
                                      action:@selector(goBack:)];
    button.toolTip = @"Back";
    item.view = button;
    item.label = @"Back";
    // Before the title, as Finder's and Safari's are.
    item.navigational = YES;
  } else if (NGNHeaderSubviewView *view = _hosted[identifier]) {
    item = [self itemHosting:view identifier:identifier];
  } else if ([identifier hasPrefix:@"ngn.button."]) {
    BOOL left = [identifier hasPrefix:@"ngn.button.left."];
    size_t index = (size_t)[identifier.pathExtension integerValue];
    const auto &buttons = left ? _bar.left : _bar.right;
    if (index < buttons.size()) {
      item = [self itemForButton:buttons[index] identifier:identifier tint:tint];
    }
  }
  return item;
}

- (NSToolbarItem *)itemHosting:(NGNHeaderSubviewView *)view identifier:(NSToolbarItemIdentifier)identifier {
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
  NSSize size = view.frame.size;
  NGNHeaderItemContainer *container = [[NGNHeaderItemContainer alloc]
      initWithFrame:NSMakeRect(0, 0, size.width, size.height)
          surfaceId:static_cast<SurfaceId>(view.surfaceId)
          container:static_cast<ngn::ContainerId>(view.reactTag)
            rootTag:static_cast<Tag>(view.reactTag)
              input:gInput];
  container.translatesAutoresizingMaskIntoConstraints = NO;
  container.width = [container.widthAnchor constraintEqualToConstant:size.width];
  container.height = [container.heightAnchor constraintEqualToConstant:size.height];
  container.width.active = YES;
  container.height.active = YES;
  [view removeFromSuperview];
  [view setFrameOrigin:NSZeroPoint];
  [container addSubview:view];
  view.hosted = YES;
  __weak NGNHeaderItemContainer *weakContainer = container;
  view.sizeChanged = ^(NSSize newSize) {
    weakContainer.width.constant = newSize.width;
    weakContainer.height.constant = newSize.height;
  };
  if (gContainerRootChanged) {
    gContainerRootChanged(view.reactTag, YES);
  }
  item.view = container;
  return item;
}

- (NSToolbarItem *)itemForButton:(const ngn::BarButton &)button
                      identifier:(NSToolbarItemIdentifier)identifier
                            tint:(NSColor *)headerTint {
  if (button.spacing) {
    NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
    item.view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, *button.spacing, 1)];
    return item;
  }
  NSString *title = nsString(button.title);
  NSString *label = button.accessibilityLabel.empty() ? title : nsString(button.accessibilityLabel);
  NSImage *image = symbol(button.symbol, label);
  NSColor *tint = button.tint ? nsColor(button.tint) : headerTint;
  if (button.menu) {
    NSMenuToolbarItem *item = [[NSMenuToolbarItem alloc] initWithItemIdentifier:identifier];
    item.menu = [self menuFor:*button.menu];
    item.title = image != nil ? @"" : title;
    item.image = image;
    item.label = label;
    item.enabled = !button.disabled;
    item.showsIndicator = image == nil;
    return item;
  }
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
  NSButton *view = [self buttonWithTitle:image != nil ? nil : title image:image tint:tint action:@selector(pressButton:)];
  view.identifier = nsString(button.id);
  view.enabled = !button.disabled;
  view.toolTip = label.length > 0 ? label : nil;
  item.view = view;
  item.label = label;
  return item;
}

- (NSButton *)buttonWithTitle:(NSString *)title image:(NSImage *)image tint:(NSColor *)tint action:(SEL)action {
  NSButton *button = image != nil ? [NSButton buttonWithImage:image target:self action:action]
                                  : [NSButton buttonWithTitle:title != nil ? title : @"" target:self action:action];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  button.bezelStyle = NSBezelStyleTexturedRounded;
#pragma clang diagnostic pop
  if (tint != nil) {
    button.contentTintColor = tint;
  }
  return button;
}

- (NSMenu *)menuFor:(const ngn::HeaderMenuItem &)entry {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:nsString(entry.title)];
  for (const auto &child : entry.items) {
    if (child.inlineSection) {
      [menu addItem:NSMenuItem.separatorItem];
      for (const auto &inner : child.items) {
        [menu addItem:[self menuItemFor:inner]];
      }
      [menu addItem:NSMenuItem.separatorItem];
    } else {
      [menu addItem:[self menuItemFor:child]];
    }
  }
  return menu;
}

- (NSMenuItem *)menuItemFor:(const ngn::HeaderMenuItem &)entry {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:nsString(entry.title) action:nil keyEquivalent:@""];
  item.image = symbol(entry.symbol, nil);
  item.state = entry.on ? NSControlStateValueOn : NSControlStateValueOff;
  if (!entry.items.empty() || entry.menuId.empty()) {
    item.submenu = [self menuFor:entry];
  } else {
    item.representedObject = nsString(entry.menuId);
    item.target = self;
    item.action = entry.disabled ? nil : @selector(chooseMenuItem:);
  }
  return item;
}

- (void)goBack:(id)sender {
  if (auto emitter = _screen.eventEmitter) {
    emitter->dispatchEvent("headerBackButtonClicked");
  }
}

- (void)pressButton:(NSButton *)sender {
  if (auto emitter = _config.eventEmitter) {
    emitter->dispatchEvent("pressHeaderBarButtonItem", folly::dynamic::object("buttonId", sender.identifier.UTF8String));
  }
}

- (void)chooseMenuItem:(NSMenuItem *)sender {
  NSString *menuId = sender.representedObject;
  if (auto emitter = _config.eventEmitter; emitter && menuId != nil) {
    emitter->dispatchEvent("pressHeaderBarButtonMenuItem", folly::dynamic::object("menuId", menuId.UTF8String));
  }
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  return _identifiers;
}

- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return [_identifiers arrayByAddingObject:NSToolbarFlexibleSpaceItemIdentifier];
}

@end
