#import "header-toolbar.h"

#import "surface-view.h"

#include "ngn/header-bar.h"

#include <react/renderer/graphics/Color.h>

using namespace facebook::react;

namespace {

ngn::InputSink *gInput = nullptr;
std::function<void(NSInteger, BOOL)> gContainerRootChanged;
std::function<void(NSWindow *, ngn::NavigationDirection, int)> gNavigate;

NSToolbarItemIdentifier const kHistory = @"ngn.history";

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

// The back and forward chevrons as one control, Finder's and Safari's: a click on a segment goes
// that way, and pressing and holding it, or a secondary click, lists that way's entries.
@interface NGNHistoryControl : NSSegmentedControl
@end

@implementation NGNHistoryControl
- (NSMenu *)menuForEvent:(NSEvent *)event {
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  NSInteger segment = point.x < NSWidth(self.bounds) / 2 ? 0 : 1;
  return [self isEnabledForSegment:segment] ? [self menuForSegment:segment] : nil;
}
@end

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
  std::optional<ngn::WindowHistory> _history;
  ngn::HistoryButtons _buttons;
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
+ (std::function<void(NSWindow *, ngn::NavigationDirection, int)>)navigate {
  return gNavigate;
}
+ (void)setNavigate:(std::function<void(NSWindow *, ngn::NavigationDirection, int)>)fn {
  gNavigate = std::move(fn);
}

+ (BOOL)showHistoryMenuForEvent:(NSEvent *)event {
  // The window's frame view, whose own coordinates are the window's: the toolbar is in it.
  NSView *frame = event.window.contentView.superview;
  NSView *hit = [frame hitTest:event.locationInWindow];
  for (NSView *v = hit; v != nil; v = v.superview) {
    if ([v isKindOfClass:NGNHistoryControl.class]) {
      NSMenu *menu = [v menuForEvent:event];
      if (menu == nil) {
        return NO;
      }
      // From the run loop rather than here, where a replayed click is inside a main-queue block
      // that the menu's tracking would hold up, and the queue with it.
      CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopCommonModes, ^{
        [NSMenu popUpContextMenu:menu withEvent:event forView:v];
      });
      CFRunLoopWakeUp(CFRunLoopGetMain());
      return YES;
    }
  }
  return NO;
}

- (void)showHistory:(const std::optional<ngn::WindowHistory> &)history {
  if (_history != history) {
    _history = history;
    [self rebuild];
  }
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

- (void)setSidebar:(BOOL)sidebar {
  if (_sidebar != sidebar) {
    _sidebar = sidebar;
    [self rebuild];
  }
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
  if (_sidebar) {
    [ids addObject:NSToolbarToggleSidebarItemIdentifier];
    [ids addObject:NSToolbarSidebarTrackingSeparatorItemIdentifier];
  }
  if (!bar) {
    // No header in front: the chevrons still lead the content pane while the window has history.
    _buttons = ngn::historyButtons(_history, NO, NO);
    if (_buttons.shown && _sidebar) {
      [ids addObject:kHistory];
    }
  }
  if (bar) {
    NSArray *left = [self itemsOfType:"left"];
    NSArray *center = [self itemsOfType:"center"];
    NSArray *right = [self itemsOfType:"right"];
    BOOL replacesBack = left.count > 0 || !_bar.left.empty();
    _buttons = ngn::historyButtons(_history, _canGoBack, _bar.hideBackButton || replacesBack);
    if (_buttons.shown) {
      [ids addObject:kHistory];
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
  if ((bar && !_bar.hidden) || _sidebar) {
    window.toolbar = _toolbar;
    window.toolbarStyle = NSWindowToolbarStyleUnified;
    window.titlebarSeparatorStyle =
        bar && _bar.hideShadow ? NSTitlebarSeparatorStyleNone : NSTitlebarSeparatorStyleAutomatic;
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
  if ([identifier isEqualToString:kHistory]) {
    item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
    item.view = [self historyControlWithTint:tint];
    item.label = @"Back/Forward";
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

- (NGNHistoryControl *)historyControlWithTint:(NSColor *)tint {
  NSArray<NSImage *> *images = @[ symbol("chevron.backward", @"Back"), symbol("chevron.forward", @"Forward") ];
  if (tint != nil) {
    // The header's tint on the chevrons, as on the bar's other buttons: a segment has no content
    // tint of its own, so the symbol is drawn in that colour.
    NSImageSymbolConfiguration *colour = [NSImageSymbolConfiguration configurationWithPaletteColors:@[ tint ]];
    images = @[
      [images[0] imageWithSymbolConfiguration:colour], [images[1] imageWithSymbolConfiguration:colour]
    ];
  }
  NGNHistoryControl *control = [NGNHistoryControl segmentedControlWithImages:images
                                                                trackingMode:NSSegmentSwitchTrackingMomentary
                                                                      target:self
                                                                      action:@selector(chooseChevron:)];
  control.segmentStyle = NSSegmentStyleSeparated;
  [control setToolTip:@"Back" forSegment:0];
  [control setToolTip:@"Forward" forSegment:1];
  [control setEnabled:_buttons.backEnabled forSegment:0];
  [control setEnabled:_buttons.forwardEnabled forSegment:1];
  if (_history && _buttons.fromHistory) {
    [control setMenu:[self historyMenu:ngn::NavigationDirection::Back] forSegment:0];
    [control setMenu:[self historyMenu:ngn::NavigationDirection::Forward] forSegment:1];
    [control setShowsMenuIndicator:NO forSegment:0];
    [control setShowsMenuIndicator:NO forSegment:1];
  }
  return control;
}

- (NSMenu *)historyMenu:(ngn::NavigationDirection)direction {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:direction == ngn::NavigationDirection::Back ? @"Back" : @"Forward"];
  for (const auto &entry : ngn::historyMenu(*_history, direction)) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:nsString(entry.title)
                                                  action:@selector(chooseHistoryItem:)
                                           keyEquivalent:@""];
    item.target = self;
    item.tag = direction == ngn::NavigationDirection::Back ? -entry.steps : entry.steps;
    [menu addItem:item];
  }
  return menu;
}

- (void)chooseChevron:(NGNHistoryControl *)sender {
  auto direction = sender.selectedSegment == 0 ? ngn::NavigationDirection::Back : ngn::NavigationDirection::Forward;
  if (_buttons.fromHistory) {
    if (gNavigate) {
      gNavigate(_window, direction, 1);
    }
  } else if (direction == ngn::NavigationDirection::Back) {
    [self goBack:sender];
  }
}

- (void)chooseHistoryItem:(NSMenuItem *)sender {
  if (gNavigate && sender.tag != 0) {
    gNavigate(
        _window,
        sender.tag < 0 ? ngn::NavigationDirection::Back : ngn::NavigationDirection::Forward,
        static_cast<int>(sender.tag < 0 ? -sender.tag : sender.tag));
  }
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
  return [_identifiers arrayByAddingObjectsFromArray:@[
    NSToolbarFlexibleSpaceItemIdentifier, NSToolbarToggleSidebarItemIdentifier,
    NSToolbarSidebarTrackingSeparatorItemIdentifier
  ]];
}

@end
