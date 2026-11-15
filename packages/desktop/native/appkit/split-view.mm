#import "split-view.h"
#import "test-launch.h"

#import "surface-view.h"

#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace {

ngn::InputSink *gInput = nullptr;
std::function<void(NSInteger, BOOL)> gContainerRootChanged;
std::function<bool(NSInteger, NSPoint)> gRowContentTakesClick;

NSString *nsString(const std::string &s) {
  NSString *result = [NSString stringWithUTF8String:s.c_str()];
  return result != nil ? result : @"";
}

// The name NSSplitView autosaves under, in the standard defaults: in a test launch prefixed with
// the run's, so a run never restores another's divider and removes its own as it ends.
NSString *autosaveKey(const std::string &name) {
  if (name.empty()) {
    return nil;
  }
  auto &test = ngn::appkit::testLaunch();
  return nsString(test ? test->keychainPrefix() + name : name);
}

void send(NGNView *view, const std::string &name, folly::dynamic payload) {
  if (auto emitter = view.eventEmitter) {
    emitter->dispatchEvent(name, std::move(payload), RawEvent::Category::Discrete);
  }
}

// The narrowest and widest a sidebar is dragged to when the app sets no bound.
constexpr CGFloat kSidebarMinimum = 150;
constexpr CGFloat kSidebarMaximum = 400;

} // namespace

#pragma mark - Sizes back into layout

// A view whose size the toolkit decides and layout follows.
@protocol NGNSizedByToolkit
- (void)applyToolkitSize:(facebook::react::Size)size;
@end

namespace {

ngn::FrameSizes gSizes;
NSMapTable<NSNumber *, NGNView<NGNSizedByToolkit> *> *gSized = [NSMapTable strongToWeakObjectsMapTable];

void flushSizes() {
  for (const auto &[tag, size] : gSizes.flush()) {
    [[gSized objectForKey:@(tag)] applyToolkitSize:size];
  }
}

// Layout hears the latest size of each view at most once a display frame, however many steps a
// divider drag takes.
void reportSize(NGNView<NGNSizedByToolkit> *view, NSSize size) {
  if (view == nil) {
    return;
  }
  [gSized setObject:view forKey:@(view.reactTag)];
  if (gSizes.report(static_cast<Tag>(view.reactTag), {static_cast<Float>(size.width), static_cast<Float>(size.height)})) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 60), dispatch_get_main_queue(), ^{
      flushSizes();
    });
  }
}

// Sets a pane's or a row's SplitPaneState, unless it already says that.
void updatePaneState(NGNView *view, facebook::react::Size size) {
  auto concrete = std::dynamic_pointer_cast<const ConcreteState<ngn::SplitPaneState>>(view.state);
  if (!concrete || concrete->getData().size == size) {
    return;
  }
  concrete->updateState(ngn::SplitPaneState{.size = size});
}

} // namespace

#pragma mark - Panes

// A pane's container in its split item: part of the surface, hit-tested from the pane.
@interface NGNPaneContainer : NGNSurfaceView
@property (nonatomic, weak) NGNSplitPaneView *pane;
@end

@interface NGNSplitPaneView () <NGNSizedByToolkit>
@property (nonatomic, weak) NGNSplitView *split;
- (const ngn::SplitPaneProps *)paneProps;
@end

@interface NGNSplitView ()
- (void)paneChanged:(NGNSplitPaneView *)pane;
// What a subclass shows in place of the panes.
- (void)setSidebarView:(NSView *)sidebar contentView:(NSView *)content;
@end

@implementation NGNPaneContainer
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  if (size.width > 0 && size.height > 0) {
    reportSize(self.pane, size);
  }
}
@end

@implementation NGNSplitPaneView
- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  [self.split paneChanged:self];
}
// Its container places it: Yoga's origin is in the split view, and its size is the container's.
- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  if ([self.superview isKindOfClass:NGNPaneContainer.class]) {
    self.frame = self.superview.bounds;
  }
}
- (void)applyToolkitSize:(facebook::react::Size)size {
  updatePaneState(self, size);
}
- (const ngn::SplitPaneProps *)paneProps {
  return dynamic_cast<const ngn::SplitPaneProps *>(self.props.get());
}
@end

#pragma mark - Split view

NSWindow *NGNWindowOfSplit(NSView *surfaceView) {
  if (surfaceView.window != nil) {
    return surfaceView.window;
  }
  // A split view controller took the window's content: the surface's split view knows the window.
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:surfaceView];
  while (queue.count > 0) {
    NSView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if ([view isKindOfClass:NGNSplitView.class] && ((NGNSplitView *)view).ownWindow != nil) {
      return ((NGNSplitView *)view).ownWindow;
    }
    [queue addObjectsFromArray:view.subviews];
  }
  return nil;
}

@interface NGNSplitView () <NSSplitViewDelegate>
@end

@implementation NGNSplitView {
  NGNSplitPaneView *_sidebar;
  NGNSplitPaneView *_content;
  // What the split view shows: the panes' containers, or a tabs host's list and content.
  NSView *_sidebarContainer;
  NSView *_contentContainer;
  BOOL _decided;
  BOOL _windows;
  // The window's: the controller, its sidebar item, and the surface view it took the place of.
  NSSplitViewController *_controller;
  NSSplitViewItem *_sidebarItem;
  NSView *_surfaceView;
  // A plain one.
  NSSplitView *_plain;
  CGFloat _plainWidth;
  ngn::SidebarCollapse _collapse;
  std::string _autosave;
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
+ (std::function<bool(NSInteger, NSPoint)>)rowContentTakesClick {
  return gRowContentTakesClick;
}
+ (void)setRowContentTakesClick:(std::function<bool(NSInteger, NSPoint)>)fn {
  gRowContentTakesClick = std::move(fn);
}

- (NGNPaneContainer *)containerFor:(NGNSplitPaneView *)pane {
  if (gInput == nullptr) {
    return nil;
  }
  NGNPaneContainer *container = [[NGNPaneContainer alloc] initWithFrame:NSMakeRect(0, 0, 240, 400)
                                                              surfaceId:static_cast<SurfaceId>(pane.surfaceId)
                                                              container:static_cast<ngn::ContainerId>(pane.reactTag)
                                                                rootTag:static_cast<Tag>(pane.reactTag)
                                                                  input:gInput];
  container.wantsLayer = YES;
  container.pane = pane;
  pane.frame = container.bounds;
  pane.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [container addSubview:pane];
  if (gContainerRootChanged) {
    gContainerRootChanged(pane.reactTag, YES);
  }
  return container;
}

- (void)setSidebarView:(NSView *)sidebar contentView:(NSView *)content {
  _sidebarContainer = sidebar;
  _contentContainer = content;
}

- (void)mountChild:(NGNView *)child index:(NSInteger)index {
  if (![child isKindOfClass:NGNSplitPaneView.class]) {
    // Anything else in a split view has nowhere to show: the element puts only its panes here.
    return;
  }
  auto *pane = (NGNSplitPaneView *)child;
  pane.split = self;
  if ([pane.componentName isEqualToString:@"NgNativeSidebar"]) {
    _sidebar = pane;
    _sidebarContainer = [self containerFor:pane];
  } else {
    _content = pane;
    _contentContainer = [self containerFor:pane];
  }
  if (_decided) {
    [self build];
  }
}

- (void)unmountChild:(NGNView *)child {
  [child removeFromSuperview];
  if (gContainerRootChanged) {
    gContainerRootChanged(child.reactTag, NO);
  }
}

- (void)placeAsWindows:(BOOL)window {
  _decided = YES;
  _windows = window;
  [self build];
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (_decided && _windows && _controller == nil && self.window != nil) {
    [self build];
  }
}

- (void)build {
  if (_sidebarContainer == nil || _contentContainer == nil) {
    return;
  }
  if (_windows) {
    [self installInWindow];
  } else {
    [self buildPlain];
  }
  [self paneChanged:_sidebar];
}

- (CGFloat)minimumWidth {
  const auto *p = [_sidebar paneProps];
  return p && p->paneMinWidth > 0 ? p->paneMinWidth : kSidebarMinimum;
}

- (CGFloat)maximumWidth {
  const auto *p = [_sidebar paneProps];
  return std::max([self minimumWidth], p && p->paneMaxWidth > 0 ? (CGFloat)p->paneMaxWidth : kSidebarMaximum);
}

- (CGFloat)startingWidth {
  return std::min(std::max<CGFloat>(ngn::kSidebarDefaultWidth, [self minimumWidth]), [self maximumWidth]);
}

// Whether the split view's autosave already holds its divider, which it then restores.
- (BOOL)hasAutosavedFrames {
  return !_autosave.empty() &&
      [NSUserDefaults.standardUserDefaults
          objectForKey:[@"NSSplitView Subview Frames " stringByAppendingString:autosaveKey(_autosave)]] != nil;
}

- (void)installInWindow {
  NSWindow *window = self.window;
  if (window == nil || _controller != nil) {
    return;
  }
  NSRect frame = window.frame;
  _ownWindow = window;
  _surfaceView = window.contentView;

  NSViewController *side = [NSViewController new];
  NSView *sideView = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, [self startingWidth], NSHeight(frame))];
  side.view = sideView;
  // Below the title bar, where the window controls are; the sidebar's material runs under it.
  _sidebarContainer.translatesAutoresizingMaskIntoConstraints = NO;
  [sideView addSubview:_sidebarContainer];
  [NSLayoutConstraint activateConstraints:@[
    [_sidebarContainer.topAnchor constraintEqualToAnchor:sideView.safeAreaLayoutGuide.topAnchor],
    [_sidebarContainer.bottomAnchor constraintEqualToAnchor:sideView.bottomAnchor],
    [_sidebarContainer.leadingAnchor constraintEqualToAnchor:sideView.leadingAnchor],
    [_sidebarContainer.trailingAnchor constraintEqualToAnchor:sideView.trailingAnchor],
  ]];
  _sidebarItem = [NSSplitViewItem sidebarWithViewController:side];
  _sidebarItem.canCollapse = YES;
  _sidebarItem.minimumThickness = [self minimumWidth];
  _sidebarItem.maximumThickness = [self maximumWidth];

  NSViewController *main = [NSViewController new];
  main.view = _contentContainer;
  NSSplitViewItem *contentItem = [NSSplitViewItem splitViewItemWithViewController:main];

  _controller = [NSSplitViewController new];
  const auto *p = [_sidebar paneProps];
  _autosave = p ? p->autosaveName : std::string{};
  if (!_autosave.empty()) {
    _controller.splitView.autosaveName = autosaveKey(_autosave);
  }
  BOOL restoring = [self hasAutosavedFrames];
  [_controller addSplitViewItem:_sidebarItem];
  [_controller addSplitViewItem:contentItem];
  window.contentViewController = _controller;
  [window setFrame:frame display:YES];
  if (!restoring) {
    [_controller.splitView setPosition:[self startingWidth] ofDividerAtIndex:0];
  }
  [_sidebarItem addObserver:self forKeyPath:@"collapsed" options:NSKeyValueObservingOptionNew context:nil];
  // A collapsed state the autosave restored is the user's: the app hears it.
  if (_sidebarItem.collapsed) {
    [self toolkitCollapsed:YES];
  }
}

- (void)buildPlain {
  if (_plain != nil) {
    return;
  }
  _plain = [[NSSplitView alloc] initWithFrame:self.bounds];
  _plain.vertical = YES;
  _plain.dividerStyle = NSSplitViewDividerStyleThin;
  _plain.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _plain.delegate = self;
  const auto *p = [_sidebar paneProps];
  _autosave = p ? p->autosaveName : std::string{};
  if (!_autosave.empty()) {
    _plain.autosaveName = autosaveKey(_autosave);
  }
  BOOL restoring = [self hasAutosavedFrames];
  [_plain addArrangedSubview:_sidebarContainer];
  [_plain addArrangedSubview:_contentContainer];
  [self addSubview:_plain];
  [_plain adjustSubviews];
  if (!restoring) {
    [_plain setPosition:[self startingWidth] ofDividerAtIndex:0];
  }
  _plainWidth = [self startingWidth];
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(plainResized:)
                                             name:NSSplitViewDidResizeSubviewsNotification
                                           object:_plain];
}

- (void)uninstall {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  if (_sidebarItem != nil) {
    [_sidebarItem removeObserver:self forKeyPath:@"collapsed"];
  }
  NSWindow *window = _ownWindow;
  if (window != nil && window.contentViewController == _controller && _surfaceView != nil) {
    NSRect frame = window.frame;
    window.contentViewController = nil;
    window.contentView = _surfaceView;
    [window setFrame:frame display:YES];
  }
  _controller = nil;
  _sidebarItem = nil;
  _ownWindow = nil;
}

- (void)dealloc {
  [self uninstall];
}

// The sidebar's props: its bounds, its autosave and whether the app has it collapsed.
- (void)paneChanged:(NGNSplitPaneView *)pane {
  if (pane != _sidebar || !_decided) {
    return;
  }
  const auto *p = [_sidebar paneProps];
  if (p == nullptr) {
    return;
  }
  if (_sidebarItem != nil) {
    _sidebarItem.minimumThickness = [self minimumWidth];
    _sidebarItem.maximumThickness = [self maximumWidth];
  }
  if (p->autosaveName != _autosave) {
    _autosave = p->autosaveName;
    NSSplitView *view = _controller != nil ? _controller.splitView : _plain;
    view.autosaveName = autosaveKey(_autosave);
  }
  if (auto collapsed = _collapse.propChanged(p->collapsed)) {
    [self setToolkitCollapsed:*collapsed];
  }
}

- (void)setToolkitCollapsed:(BOOL)collapsed {
  if (_sidebarItem != nil) {
    if (_sidebarItem.collapsed != collapsed) {
      _sidebarItem.animator.collapsed = collapsed;
    }
  } else if (_plain != nil) {
    [_plain setPosition:collapsed ? 0 : _plainWidth ofDividerAtIndex:0];
  }
}

- (void)toolkitCollapsed:(BOOL)collapsed {
  if (_collapse.toolkitChanged(collapsed)) {
    send(_sidebar, "sidebarCollapse", folly::dynamic::object("collapsed", (bool)collapsed));
  }
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context {
  if (object == _sidebarItem) {
    [self toolkitCollapsed:_sidebarItem.collapsed];
  }
}

- (void)plainResized:(NSNotification *)note {
  BOOL collapsed = [_plain isSubviewCollapsed:_sidebarContainer] || NSWidth(_sidebarContainer.frame) < 1;
  if (!collapsed) {
    _plainWidth = NSWidth(_sidebarContainer.frame);
  }
  [self toolkitCollapsed:collapsed];
}

#pragma mark NSSplitViewDelegate (a plain one)

- (BOOL)splitView:(NSSplitView *)splitView canCollapseSubview:(NSView *)subview {
  return subview == _sidebarContainer;
}

- (CGFloat)splitView:(NSSplitView *)splitView
    constrainMinCoordinate:(CGFloat)proposedMinimumPosition
               ofSubviewAt:(NSInteger)dividerIndex {
  return [self minimumWidth];
}

- (CGFloat)splitView:(NSSplitView *)splitView
    constrainMaxCoordinate:(CGFloat)proposedMaximumPosition
               ofSubviewAt:(NSInteger)dividerIndex {
  return [self maximumWidth];
}

- (BOOL)splitView:(NSSplitView *)splitView shouldAdjustSizeOfSubview:(NSView *)view {
  return view != _sidebarContainer;
}

@end

#pragma mark - Source lists

@interface NGNSidebarSectionView () <NGNSizedByToolkit>
@end

@implementation NGNSidebarSectionView
- (void)setHidden:(BOOL)hidden {
  // The source list draws it.
  [super setHidden:YES];
}
- (void)setFolded:(BOOL)folded {
  auto concrete = std::dynamic_pointer_cast<const ConcreteState<ngn::SidebarSectionState>>(self.state);
  if (concrete && concrete->getData().collapsed != folded) {
    concrete->updateState(ngn::SidebarSectionState{.collapsed = static_cast<bool>(folded)});
  }
}
- (void)applyToolkitSize:(facebook::react::Size)size {
}
@end

@interface NGNSidebarItemView () <NGNSizedByToolkit>
// The custom row's container it is in, once its source list drew it.
@property (nonatomic, weak) NSView *host;
@property (nonatomic, copy) void (^heightChanged)(void);
@end

@implementation NGNSidebarItemView
- (void)updateLayout:(const LayoutMetrics &)metrics {
  CGFloat before = NSHeight(self.frame);
  [super updateLayout:metrics];
  if (self.host != nil && self.superview == self.host) {
    [self setFrameOrigin:NSZeroPoint];
    if (fabs(NSHeight(self.frame) - before) > 0.5 && self.heightChanged) {
      self.heightChanged();
    }
  }
}
- (void)applyToolkitSize:(facebook::react::Size)size {
  updatePaneState(self, size);
}
@end

// The model the outline view reads: a titled section, and a row.
@interface NGNSourceGroup : NSObject
@property (nonatomic) NSInteger tag;
@property (nonatomic, copy) NSString *title;
@property (nonatomic) BOOL collapsible;
@property (nonatomic, copy) NSArray *rows;
@end
@implementation NGNSourceGroup
@end

@interface NGNSourceRow : NSObject
@property (nonatomic) NSInteger tag;
@property (nonatomic) ngn::SidebarRow row;
@end
@implementation NGNSourceRow
@end

// A custom row's cell: a container of its own for the item's views, kept for the row (never
// recycled). A click goes to the content when it lands on something that takes it, and otherwise
// to the outline view, which selects the row.
@interface NGNSourceRowHost : NGNSurfaceView
@property (nonatomic, weak) NGNSidebarItemView *item;
- (BOOL)takeMouseDown:(NSEvent *)event;
@end

@implementation NGNSourceRowHost
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  if (size.width > 0) {
    // Only the width is the cell's: the row is as tall as the item lays out.
    reportSize(self.item, NSMakeSize(size.width, 0));
  }
}
- (NSOutlineView *)outline {
  for (NSView *v = self.superview; v != nil; v = v.superview) {
    if ([v isKindOfClass:NSOutlineView.class]) {
      return (NSOutlineView *)v;
    }
  }
  return nil;
}
// The outline view hears the click (it selects rows) and offers it here first: the row's content
// takes it when it lands on something that takes it. Then the drag and the release follow it.
- (BOOL)takeMouseDown:(NSEvent *)event {
  NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
  bool takes = gRowContentTakesClick && gRowContentTakesClick(self.item.reactTag, point);
  if (!takes) {
    return NO;
  }
  [super mouseDown:event];
  return YES;
}
- (void)dealloc {
  if (gContainerRootChanged && self.item != nil) {
    gContainerRootChanged(self.item.reactTag, NO);
  }
}
@end

// A native row: the item's SF Symbol, label and badge.
@interface NGNSourceRowCell : NSTableCellView
@property (nonatomic, strong) NSTextField *badge;
@end

@implementation NGNSourceRowCell
- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    NSImageView *image = [NSImageView new];
    NSTextField *label = [NSTextField labelWithString:@""];
    label.lineBreakMode = NSLineBreakByTruncatingTail;
    [label setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow
                                    forOrientation:NSLayoutConstraintOrientationHorizontal];
    _badge = [NSTextField labelWithString:@""];
    _badge.textColor = NSColor.secondaryLabelColor;
    _badge.alignment = NSTextAlignmentRight;
    for (NSView *v in @[ image, label, _badge ]) {
      v.translatesAutoresizingMaskIntoConstraints = NO;
      [self addSubview:v];
    }
    self.imageView = image;
    self.textField = label;
    [NSLayoutConstraint activateConstraints:@[
      [image.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:2],
      [image.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
      [image.widthAnchor constraintEqualToConstant:18],
      [label.leadingAnchor constraintEqualToAnchor:image.trailingAnchor constant:6],
      [label.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
      [_badge.leadingAnchor constraintGreaterThanOrEqualToAnchor:label.trailingAnchor constant:6],
      [_badge.trailingAnchor constraintEqualToAnchor:self.trailingAnchor constant:-14],
      [_badge.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
    ]];
  }
  return self;
}
@end

// A row's selection as a source list draws it: rounded, inset from the sidebar's edges, the accent
// colour while the list has the focus and grey otherwise.
@interface NGNSourceRowView : NSTableRowView
@end

@implementation NGNSourceRowView
- (void)drawSelectionInRect:(NSRect)dirtyRect {
  NSRect rect = NSInsetRect(self.bounds, 10, 0);
  NSColor *color =
      self.emphasized ? NSColor.selectedContentBackgroundColor : NSColor.unemphasizedSelectedContentBackgroundColor;
  [color setFill];
  [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:6 yRadius:6] fill];
}
@end

// One run of sections as one source list.
@interface NGNSourceListView : NSOutlineView <NSOutlineViewDataSource, NSOutlineViewDelegate>
@property (nonatomic, copy) NGNView * (^views)(NSInteger tag);
// A tabs host's: it fills its scroll view, in the source-list style, and a choice goes to `chose`
// rather than to the row's item.
@property (nonatomic) BOOL fills;
@property (nonatomic, copy) void (^chose)(NSInteger rowTag);
- (void)setList:(const ngn::SourceList &)list;
- (void)layOutInParent;
@end

@implementation NGNSourceListView {
  ngn::SourceList _list;
  NSArray *_top;
  NSMutableDictionary<NSNumber *, id> *_objects;
  NSMutableDictionary<NSNumber *, NGNSourceRowHost *> *_hosts;
  // Sections the user folded away.
  NSMutableSet<NSNumber *> *_folded;
  BOOL _syncing;
  // The custom row whose content took the click in progress.
  NGNSourceRowHost *_claimedBy;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _objects = [NSMutableDictionary dictionary];
    _hosts = [NSMutableDictionary dictionary];
    _folded = [NSMutableSet set];
    _top = @[];
    NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:@"row"];
    column.resizingMask = NSTableColumnAutoresizingMask;
    [self addTableColumn:column];
    self.outlineTableColumn = column;
    self.headerView = nil;
    // The plain style lays rows out exactly at their heights, as Yoga does: the source-list style
    // adds insets above and between sections. Its rounded selection is drawn by NGNSourceRowView.
    self.style = NSTableViewStylePlain;
    self.backgroundColor = NSColor.clearColor;
    self.focusRingType = NSFocusRingTypeNone;
    self.intercellSpacing = NSMakeSize(0, 0);
    self.floatsGroupRows = NO;
    self.columnAutoresizingStyle = NSTableViewUniformColumnAutoresizingStyle;
    self.dataSource = self;
    self.delegate = self;
  }
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

// NSTableView's hit test answers the table for a cell's content, so the custom row under the click
// is found by where it is.
- (void)mouseDown:(NSEvent *)event {
  for (NGNSourceRowHost *host in _hosts.allValues) {
    if (host.window == self.window &&
        NSPointInRect([host convertPoint:event.locationInWindow fromView:nil], host.bounds)) {
      if ([host takeMouseDown:event]) {
        _claimedBy = host;
        return;
      }
      break;
    }
  }
  [super mouseDown:event];
}

- (void)mouseDragged:(NSEvent *)event {
  if (_claimedBy != nil) {
    [_claimedBy mouseDragged:event];
  } else {
    [super mouseDragged:event];
  }
}

- (void)mouseUp:(NSEvent *)event {
  if (_claimedBy != nil) {
    [_claimedBy mouseUp:event];
    _claimedBy = nil;
  } else {
    [super mouseUp:event];
  }
}

- (id)objectFor:(NSInteger)tag class:(Class)cls {
  id object = _objects[@(tag)];
  if (![object isKindOfClass:cls]) {
    object = [cls new];
    _objects[@(tag)] = object;
  }
  return object;
}

- (void)setList:(const ngn::SourceList &)list {
  _list = list;
  NSMutableArray *top = [NSMutableArray array];
  NSMutableSet<NSNumber *> *live = [NSMutableSet set];
  for (const auto &g : list.groups) {
    NSMutableArray *rows = [NSMutableArray array];
    for (const auto &r : g.rows) {
      NGNSourceRow *row = [self objectFor:r.tag class:NGNSourceRow.class];
      row.tag = r.tag;
      row.row = r;
      [rows addObject:row];
      [live addObject:@(r.tag)];
    }
    if (g.title.empty()) {
      [top addObjectsFromArray:rows];
    } else {
      NGNSourceGroup *group = [self objectFor:g.tag class:NGNSourceGroup.class];
      group.tag = g.tag;
      group.title = nsString(g.title);
      group.collapsible = g.collapsible;
      group.rows = rows;
      [top addObject:group];
      [live addObject:@(g.tag)];
    }
  }
  _top = top;
  for (NSNumber *tag in _objects.allKeys) {
    if (![live containsObject:tag]) {
      [_objects removeObjectForKey:tag];
      [_folded removeObject:tag];
      [_hosts removeObjectForKey:tag];
    }
  }
  _syncing = YES;
  [self reloadData];
  for (id item in _top) {
    if ([item isKindOfClass:NGNSourceGroup.class] && ![_folded containsObject:@(((NGNSourceGroup *)item).tag)]) {
      [self expandItem:item];
    }
  }
  _syncing = NO;
  [self syncSelection];
  [self layOutInParent];
}

// The row the app says is selected, which survives its section folding away and back.
- (void)syncSelection {
  _syncing = YES;
  NSInteger selected = -1;
  for (NSNumber *tag in _objects) {
    NGNSourceRow *row = _objects[tag];
    if ([row isKindOfClass:NGNSourceRow.class] && row.row.selected) {
      selected = [self rowForItem:row];
    }
  }
  if (selected >= 0) {
    [self selectRowIndexes:[NSIndexSet indexSetWithIndex:(NSUInteger)selected] byExtendingSelection:NO];
  } else {
    [self deselectAll:nil];
  }
  _syncing = NO;
}

// Over the union of its sections' frames, in their parent.
- (void)setFills:(BOOL)fills {
  _fills = fills;
  self.style = fills ? NSTableViewStyleSourceList : NSTableViewStylePlain;
}

// Filling its scroll view, its one column is as wide as the view.
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  if (self.fills) {
    [self sizeLastColumnToFit];
  }
}

- (void)layOutInParent {
  if (self.fills) {
    return;
  }
  NSRect frame = NSZeroRect;
  BOOL first = YES;
  for (const auto &g : _list.groups) {
    NGNView *section = self.views ? self.views(g.tag) : nil;
    if (section == nil) {
      continue;
    }
    frame = first ? section.frame : NSUnionRect(frame, section.frame);
    first = NO;
  }
  if (!NSEqualRects(self.frame, frame)) {
    self.frame = frame;
    [self sizeLastColumnToFit];
  }
}

#pragma mark Data source

- (NSInteger)outlineView:(NSOutlineView *)outlineView numberOfChildrenOfItem:(id)item {
  if (item == nil) {
    return (NSInteger)_top.count;
  }
  return [item isKindOfClass:NGNSourceGroup.class] ? (NSInteger)((NGNSourceGroup *)item).rows.count : 0;
}

- (id)outlineView:(NSOutlineView *)outlineView child:(NSInteger)index ofItem:(id)item {
  return item == nil ? _top[(NSUInteger)index] : ((NGNSourceGroup *)item).rows[(NSUInteger)index];
}

- (BOOL)outlineView:(NSOutlineView *)outlineView isItemExpandable:(id)item {
  return [item isKindOfClass:NGNSourceGroup.class];
}

#pragma mark Delegate

- (BOOL)outlineView:(NSOutlineView *)outlineView isGroupItem:(id)item {
  return [item isKindOfClass:NGNSourceGroup.class];
}

- (BOOL)outlineView:(NSOutlineView *)outlineView shouldShowOutlineCellForItem:(id)item {
  return [item isKindOfClass:NGNSourceGroup.class] && ((NGNSourceGroup *)item).collapsible;
}

- (BOOL)outlineView:(NSOutlineView *)outlineView shouldCollapseItem:(id)item {
  return [item isKindOfClass:NGNSourceGroup.class] && ((NGNSourceGroup *)item).collapsible;
}

- (BOOL)outlineView:(NSOutlineView *)outlineView shouldSelectItem:(id)item {
  return [item isKindOfClass:NGNSourceRow.class];
}

- (NSTableRowView *)outlineView:(NSOutlineView *)outlineView rowViewForItem:(id)item {
  return self.fills ? nil : [NGNSourceRowView new];
}

- (CGFloat)outlineView:(NSOutlineView *)outlineView heightOfRowByItem:(id)item {
  if ([item isKindOfClass:NGNSourceGroup.class]) {
    return ngn::kSidebarHeaderHeight;
  }
  NGNSourceRow *row = item;
  if (row.row.custom) {
    NGNView *view = self.views ? self.views(row.tag) : nil;
    return std::max<CGFloat>(ngn::kSidebarRowHeight, NSHeight(view.frame));
  }
  return ngn::kSidebarRowHeight;
}

- (NSView *)outlineView:(NSOutlineView *)outlineView viewForTableColumn:(NSTableColumn *)column item:(id)item {
  if ([item isKindOfClass:NGNSourceGroup.class]) {
    NSTableCellView *cell = [outlineView makeViewWithIdentifier:@"header" owner:self];
    if (cell == nil) {
      cell = [NSTableCellView new];
      cell.identifier = @"header";
      NSTextField *title = [NSTextField labelWithString:@""];
      title.font = [NSFont systemFontOfSize:NSFont.smallSystemFontSize weight:NSFontWeightSemibold];
      title.textColor = NSColor.secondaryLabelColor;
      title.translatesAutoresizingMaskIntoConstraints = NO;
      [cell addSubview:title];
      cell.textField = title;
      [NSLayoutConstraint activateConstraints:@[
        [title.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:2],
        [title.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
      ]];
    }
    cell.textField.stringValue = ((NGNSourceGroup *)item).title;
    return cell;
  }
  NGNSourceRow *row = item;
  if (row.row.custom) {
    return [self hostFor:row];
  }
  NGNSourceRowCell *cell = [outlineView makeViewWithIdentifier:@"row" owner:self];
  if (cell == nil) {
    cell = [[NGNSourceRowCell alloc] initWithFrame:NSZeroRect];
    cell.identifier = @"row";
  }
  const auto &r = row.row;
  cell.textField.stringValue = nsString(r.label);
  cell.imageView.image = r.sfSymbol.empty()
      ? nil
      : [NSImage imageWithSystemSymbolName:nsString(r.sfSymbol) accessibilityDescription:nil];
  cell.badge.stringValue = nsString(r.badge);
  cell.badge.hidden = r.badge.empty();
  return cell;
}

- (NGNSourceRowHost *)hostFor:(NGNSourceRow *)row {
  NGNSourceRowHost *host = _hosts[@(row.tag)];
  NGNSidebarItemView *item = (NGNSidebarItemView *)(self.views ? self.views(row.tag) : nil);
  if (![item isKindOfClass:NGNSidebarItemView.class] || gInput == nullptr) {
    return nil;
  }
  if (host == nil || host.item != item) {
    host = [[NGNSourceRowHost alloc] initWithFrame:NSMakeRect(0, 0, NSWidth(self.bounds), NSHeight(item.frame))
                                         surfaceId:static_cast<SurfaceId>(item.surfaceId)
                                         container:static_cast<ngn::ContainerId>(item.reactTag)
                                           rootTag:static_cast<Tag>(item.reactTag)
                                             input:gInput];
    host.item = item;
    host.wantsLayer = YES;
    _hosts[@(row.tag)] = host;
    if (gContainerRootChanged) {
      gContainerRootChanged(item.reactTag, YES);
    }
  }
  if (item.superview != host) {
    [item removeFromSuperview];
    [host addSubview:item];
  }
  item.host = host;
  [item setFrameOrigin:NSZeroPoint];
  __weak NGNSourceListView *weakSelf = self;
  __weak NGNSourceRow *weakRow = row;
  item.heightChanged = ^{
    NGNSourceListView *list = weakSelf;
    NSInteger index = [list rowForItem:weakRow];
    if (index >= 0) {
      [list noteHeightOfRowsWithIndexesChanged:[NSIndexSet indexSetWithIndex:(NSUInteger)index]];
    }
  };
  return host;
}

- (void)outlineViewSelectionDidChange:(NSNotification *)notification {
  if (_syncing) {
    return;
  }
  id item = [self itemAtRow:self.selectedRow];
  if (![item isKindOfClass:NGNSourceRow.class]) {
    return;
  }
  NSInteger tag = ((NGNSourceRow *)item).tag;
  if (self.chose) {
    self.chose(tag);
    return;
  }
  NGNView *view = self.views ? self.views(tag) : nil;
  send(view, "sidebarSelect", folly::dynamic::object());
}

- (void)outlineViewItemDidCollapse:(NSNotification *)notification {
  [self folded:notification.userInfo[@"NSObject"] folded:YES];
}

- (void)outlineViewItemDidExpand:(NSNotification *)notification {
  [self folded:notification.userInfo[@"NSObject"] folded:NO];
  if (!_syncing) {
    [self syncSelection];
  }
}

- (void)folded:(id)item folded:(BOOL)folded {
  if (![item isKindOfClass:NGNSourceGroup.class]) {
    return;
  }
  NSInteger tag = ((NGNSourceGroup *)item).tag;
  if (!_syncing) {
    if (folded) {
      [_folded addObject:@(tag)];
    } else {
      [_folded removeObject:@(tag)];
    }
  }
  NGNView *section = self.views ? self.views(tag) : nil;
  if ([section isKindOfClass:NGNSidebarSectionView.class]) {
    [(NGNSidebarSectionView *)section setFolded:folded];
  }
}

@end

@implementation NGNSourceLists {
  __weak NGNView *_parent;
  NSMutableArray<NGNSourceListView *> *_lists;
}

- (instancetype)initWithParent:(NGNView *)parent {
  if ((self = [super init])) {
    _parent = parent;
    _lists = [NSMutableArray array];
  }
  return self;
}

- (void)setLists:(const std::vector<ngn::SourceList> &)lists views:(NGNView * (^)(NSInteger tag))views {
  while (_lists.count > lists.size()) {
    [_lists.lastObject removeFromSuperview];
    [_lists removeLastObject];
  }
  while (_lists.count < lists.size()) {
    NGNSourceListView *list = [[NGNSourceListView alloc] initWithFrame:NSZeroRect];
    [_parent.contentContainer addSubview:list];
    [_lists addObject:list];
  }
  for (size_t i = 0; i < lists.size(); i++) {
    _lists[i].views = views;
    [_lists[i] setList:lists[i]];
  }
}

- (void)layOut {
  for (NGNSourceListView *list in _lists) {
    [list layOutInParent];
  }
}

- (void)remove {
  for (NGNSourceListView *list in _lists) {
    [list removeFromSuperview];
  }
  [_lists removeAllObjects];
}

@end

#pragma mark - Tabs

namespace {
std::function<void(NSInteger, NSInteger, NSInteger)> gTabChosen;
} // namespace

@interface NGNTabScreenView () <NGNSizedByToolkit>
@end

@implementation NGNTabScreenView
- (void)applyToolkitSize:(facebook::react::Size)size {
  updatePaneState(self, size);
}
@end

// The flipped view a tabs host's screens mount in.
@interface NGNTabsScreens : NSView
@end
@implementation NGNTabsScreens
- (BOOL)isFlipped {
  return YES;
}
@end

// The content pane of a tabs host: part of the surface, hit-tested from the host, and the size
// every tab's screen takes.
@interface NGNTabsContent : NGNSurfaceView
@property (nonatomic, weak) NSView *screens;
@end

@implementation NGNTabsContent
- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  if (size.width > 0 && size.height > 0) {
    for (NSView *screen in self.screens.subviews) {
      if ([screen isKindOfClass:NGNTabScreenView.class]) {
        reportSize((NGNTabScreenView *)screen, size);
      }
    }
  }
}
@end

@implementation NGNTabsHostView {
  NGNTabsScreens *_screens;
  NGNTabsContent *_content;
  NSScrollView *_scroll;
  NGNSourceListView *_list;
}

+ (std::function<void(NSInteger, NSInteger, NSInteger)>)tabChosen {
  return gTabChosen;
}
+ (void)setTabChosen:(std::function<void(NSInteger, NSInteger, NSInteger)>)fn {
  gTabChosen = std::move(fn);
}

- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    _screens = [[NGNTabsScreens alloc] initWithFrame:NSMakeRect(0, 0, 600, 400)];
    _screens.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    if (gInput != nullptr) {
      _content = [[NGNTabsContent alloc] initWithFrame:_screens.frame
                                             surfaceId:view.surfaceId
                                             container:static_cast<ngn::ContainerId>(view.tag)
                                               rootTag:view.tag
                                                 input:gInput];
      _content.wantsLayer = YES;
      _content.screens = _screens;
      [_content addSubview:_screens];
      if (gContainerRootChanged) {
        gContainerRootChanged(view.tag, YES);
      }
    }
    _list = [[NGNSourceListView alloc] initWithFrame:NSMakeRect(0, 0, 240, 400)];
    _list.fills = YES;
    NSInteger surface = view.surfaceId;
    NSInteger host = view.tag;
    _list.chose = ^(NSInteger screen) {
      if (gTabChosen) {
        gTabChosen(surface, host, screen);
      }
    };
    _scroll = [[NSScrollView alloc] initWithFrame:_list.frame];
    _scroll.drawsBackground = NO;
    _scroll.hasVerticalScroller = YES;
    _scroll.autohidesScrollers = YES;
    _scroll.documentView = _list;
    [self setSidebarView:_scroll contentView:_content];
  }
  return self;
}

- (NSView *)contentContainer {
  return _screens;
}

- (void)mountChild:(NGNView *)child index:(NSInteger)index {
  NSMutableArray<NSView *> *siblings = [NSMutableArray array];
  for (NSView *v in _screens.subviews) {
    if ([v isKindOfClass:NGNView.class]) {
      [siblings addObject:v];
    }
  }
  if (index >= (NSInteger)siblings.count) {
    [_screens addSubview:child];
  } else {
    [_screens addSubview:child positioned:NSWindowBelow relativeTo:siblings[(NSUInteger)index]];
  }
  if ([child isKindOfClass:NGNTabScreenView.class] && NSWidth(_content.bounds) > 0) {
    reportSize((NGNTabScreenView *)child, _content.bounds.size);
  }
}

- (void)unmountChild:(NGNView *)child {
  [child removeFromSuperview];
}

- (void)setTabs:(const ngn::SourceList &)tabs {
  [_list setList:tabs];
}

- (void)dealloc {
  if (gContainerRootChanged) {
    gContainerRootChanged(self.reactTag, NO);
  }
}
@end
