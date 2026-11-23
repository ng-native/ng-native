#import "appkit-backend.h"
#import "system.h"

#import "expo-ui-view.h"
#import "header-toolbar.h"
#import "host-view.h"
#import "modal-host-view.h"
#import "presented-screen.h"
#import "split-view.h"
#import "surface-view.h"
#import "svg-view.h"

#include "ngn/library-components.h"
#include "ngn/scrollers.h"

namespace ngn::appkit {

AppKitBackend::AppKitBackend()
    : views_([NSMutableDictionary dictionary]),
      surfaces_([NSMutableDictionary dictionary]),
      toolbars_([NSMutableDictionary dictionary]),
      touched_([NSMutableSet set]),
      sourceLists_([NSMutableDictionary dictionary]) {}

void AppKitBackend::addSurface(NGNSurfaceView *surfaceView) {
  surfaces_[@(surfaceView.surfaceId)] = surfaceView;
}

void AppKitBackend::removeSurface(SurfaceId surfaceId) {
  [surfaces_ removeObjectForKey:@(surfaceId)];
  [toolbars_ removeObjectForKey:@(surfaceId)];
}

NGNSurfaceView *AppKitBackend::surface(SurfaceId surfaceId) const {
  return surfaces_[@(surfaceId)];
}

NGNView *AppKitBackend::view(Tag tag) const {
  return views_[@(tag)];
}

void AppKitBackend::runOnUiThread(std::function<void()> task) {
  // The main queue is FIFO, which keeps transactions in commit order.
  auto shared = std::make_shared<std::function<void()>>(std::move(task));
  dispatch_async(dispatch_get_main_queue(), ^{
    (*shared)();
  });
}

bool AppKitBackend::onUiThread() const {
  return NSThread.isMainThread;
}

void AppKitBackend::serviceUiThread() {
  // The main run loop serves the main queue.
  [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
}

void AppKitBackend::createView(const ShadowView &view) {
  NGNView *created = NGNMakeView(view);
  views_[@(view.tag)] = created;
  [created updateEventEmitter:view.eventEmitter];
  [created updateProps:view.props];
  [created updateState:view.state];
  if (view.tag == view.surfaceId) {
    // A surface's root fills its container: Fabric gives it no frame of its own.
    NGNSurfaceView *surface = surfaces_[@(view.surfaceId)];
    created.frame = surface.bounds;
    created.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [surface addSubview:created];
  } else {
    [created updateLayout:view.layoutMetrics];
  }
}

void AppKitBackend::deleteView(SurfaceId, Tag tag) {
  [views_ removeObjectForKey:@(tag)];
  // What the host keeps by tag goes now, in mount order, rather than as the view is freed: a
  // reload's instance reuses the tags, and its views may mount before the old ones are freed.
  NGNForgetToolkitSize(tag);
  ngn::ScrollerGutters::shared().remove(tag);
  [sourceLists_[@(tag)] remove];
  [sourceLists_ removeObjectForKey:@(tag)];
}

void AppKitBackend::insertChild(SurfaceId surfaceId, Tag parent, Tag child, int index) {
  NGNView *parentView = views_[@(parent)];
  NGNView *childView = views_[@(child)];
  if (parentView == nil || childView == nil) {
    return;
  }
  // The index counts Fabric children only: a TextInput holds an NSTextField of its own.
  if ([childView isKindOfClass:NGNModalHostView.class] && ![childView isKindOfClass:NGNPresentedScreenView.class]) {
    // A view beside a split view at the root has no window: the split view's controller took the
    // window's content, surface and all. The modal goes over the surface's window all the same.
    NSView *over = parentView;
    if (over.window == nil) {
      // A surface already removed (a mount queued before it went) has no window to give.
      NGNSurfaceView *surface = surfaces_[@(surfaceId)];
      NSView *content = surface != nil ? NGNWindowOfSplit(surface).contentView : nil;
      over = content != nil ? content : parentView;
    }
    [(NGNModalHostView *)childView presentOver:over];
    return;
  }
  if ([parentView conformsToProtocol:@protocol(NGNMountsChildren)]) {
    [(id<NGNMountsChildren>)parentView mountChild:childView index:index];
    return;
  }
  NSView *container = parentView.contentContainer;
  NSMutableArray<NSView *> *siblings = [NSMutableArray array];
  for (NSView *v in container.subviews) {
    if ([v isKindOfClass:NGNView.class]) {
      [siblings addObject:v];
    }
  }
  touched(parentView);
  if (index >= (int)siblings.count) {
    [container addSubview:childView];
  } else {
    [container addSubview:childView positioned:NSWindowBelow relativeTo:siblings[index]];
  }
}

void AppKitBackend::removeChild(SurfaceId, Tag parent, Tag child, int) {
  NGNView *view = views_[@(child)];
  if ([view isKindOfClass:NGNPresentedScreenView.class]) {
    [(NGNPresentedScreenView *)view dismiss];
    [view removeFromSuperview];
    return;
  }
  if ([view isKindOfClass:NGNModalHostView.class]) {
    [(NGNModalHostView *)view dismiss];
    return;
  }
  if ([view isKindOfClass:NGNSplitView.class]) {
    [(NGNSplitView *)view uninstall];
  }
  NGNView *parentView = views_[@(parent)];
  if ([parentView conformsToProtocol:@protocol(NGNMountsChildren)]) {
    [(id<NGNMountsChildren>)parentView unmountChild:view];
    return;
  }
  touched(view.superview);
  [view removeFromSuperview];
}

void AppKitBackend::updateProps(const ShadowView &view) {
  [views_[@(view.tag)] updateProps:view.props];
  touched(views_[@(view.tag)]);
}

void AppKitBackend::updateState(const ShadowView &view) {
  [views_[@(view.tag)] updateState:view.state];
}

void AppKitBackend::updateLayout(const ShadowView &view) {
  if (view.tag != view.surfaceId) {
    [views_[@(view.tag)] updateLayout:view.layoutMetrics];
  }
}

void AppKitBackend::updateEventEmitter(const ShadowView &view) {
  [views_[@(view.tag)] updateEventEmitter:view.eventEmitter];
}

void AppKitBackend::dispatchCommand(Tag tag, const std::string &name, const folly::dynamic &args) {
  [views_[@(tag)] handleCommand:name args:args];
}

void AppKitBackend::setCovered(SurfaceId, Tag tag, bool covered) {
  NGNView *screen = views_[@(tag)];
  if (screen == nil) {
    return;
  }
  screen.covered = covered;
  // A window's split view on the covered screen gives the window back to the screen in front.
  // ponytail: walks the screen's views on each push and pop; keep a registry if that shows up.
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:screen];
  while (queue.count > 0) {
    NSView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if ([view isKindOfClass:NGNSplitView.class]) {
      [(NGNSplitView *)view setScreenCovered:covered];
      continue;
    }
    [queue addObjectsFromArray:view.subviews];
  }
}

NGNHeaderToolbar *AppKitBackend::toolbarFor(SurfaceId surfaceId) {
  NGNHeaderToolbar *toolbar = toolbars_[@(surfaceId)];
  NSWindow *window = NGNWindowOfSplit(surfaces_[@(surfaceId)]);
  if (toolbar == nil && window != nil) {
    toolbar = [[NGNHeaderToolbar alloc] initWithWindow:window];
    toolbars_[@(surfaceId)] = toolbar;
    if (historyOf) {
      [toolbar showHistory:historyOf(surfaceId)];
    }
  }
  return toolbar;
}

void AppKitBackend::setHistory(SurfaceId surfaceId, const std::optional<WindowHistory> &history) {
  [toolbarFor(surfaceId) showHistory:history];
}

void AppKitBackend::setFrontHeader(SurfaceId surfaceId, const std::optional<ScreenStacks::FrontHeader> &header) {
  NGNView *config = header ? views_[@(header->config)] : nil;
  [toolbarFor(surfaceId) showConfig:[config isKindOfClass:NGNHeaderConfigView.class] ? (NGNHeaderConfigView *)config : nil
                             screen:header ? views_[@(header->screen)] : nil
                          canGoBack:header && header->canGoBack];
  [touched_ removeAllObjects];
}

void AppKitBackend::touched(NSView *view) {
  if (view != nil && toolbars_.count > 0) {
    [touched_ addObject:view];
  }
}

void AppKitBackend::setPresented(SurfaceId, Tag screen, bool presented) {
  if (auto *view = (NGNPresentedScreenView *)views_[@(screen)]; [view isKindOfClass:NGNPresentedScreenView.class]) {
    [view setPresented:presented];
  }
}

void AppKitBackend::setSplitView(SurfaceId surfaceId, Tag split, bool window) {
  NGNSplitView *view = (NGNSplitView *)views_[@(split)];
  if (![view isKindOfClass:NGNSplitView.class]) {
    return;
  }
  [view placeAsWindows:window];
  if (window) {
    toolbarFor(surfaceId).sidebar = view.ownWindow != nil;
  }
}

void AppKitBackend::setSvgDrawing(SurfaceId, Tag svg, std::shared_ptr<const SvgDocument> document) {
  if (auto *view = (NGNSvgView *)views_[@(svg)]; [view isKindOfClass:NGNSvgView.class]) {
    [view setDocument:std::move(document)];
  }
}

void AppKitBackend::setExpoUITree(SurfaceId, Tag host, std::shared_ptr<const ExpoUINode> root) {
  if (auto *view = (NGNExpoUIHostView *)views_[@(host)]; [view isKindOfClass:NGNExpoUIHostView.class]) {
    [view setTree:std::move(root)];
  }
}

void AppKitBackend::setSourceLists(SurfaceId, Tag parent, const std::vector<SourceList> &lists) {
  if (auto *tabs = (NGNTabsHostView *)views_[@(parent)]; [tabs isKindOfClass:NGNTabsHostView.class]) {
    [tabs setTabs:lists.empty() ? SourceList{} : lists[0]];
    return;
  }
  NGNSourceLists *known = sourceLists_[@(parent)];
  if (lists.empty()) {
    [known remove];
    [sourceLists_ removeObjectForKey:@(parent)];
    return;
  }
  NGNView *parentView = views_[@(parent)];
  if (parentView == nil) {
    return;
  }
  if (known == nil) {
    known = [[NGNSourceLists alloc] initWithParent:parentView];
    sourceLists_[@(parent)] = known;
  }
  NSMutableDictionary<NSNumber *, NGNView *> *views = views_;
  [known setLists:lists
            views:^NGNView *(NSInteger tag) {
              return views[@(tag)];
            }];
}

void AppKitBackend::announce(SurfaceId, const Announcement &announcement) {
  postAnnouncement(announcement);
}

void AppKitBackend::setAccessibilityRelations(SurfaceId, Tag tag, const AxRelations &relations) {
  auto views = [this](const std::vector<Tag> &tags) {
    NSMutableArray<NGNView *> *found = [NSMutableArray array];
    for (Tag target : tags) {
      if (NGNView *v = views_[@(target)]) {
        [found addObject:v];
      }
    }
    return found;
  };
  [views_[@(tag)] setLabelledBy:views(relations.labelledBy) describedBy:views(relations.describedBy)];
}

void AppKitBackend::didMount(SurfaceId surfaceId) {
  [NGNPresentedScreenView refreshChrome];
  [NGNModalHostView fitPopovers];
  for (NGNSourceLists *lists in sourceLists_.allValues) {
    [lists layOut];
  }
  for (NSView *view in touched_) {
    for (NGNHeaderToolbar *toolbar in toolbars_.allValues) {
      [toolbar refreshIfShowing:(NGNView *)view];
    }
  }
  [touched_ removeAllObjects];
  if (onMount) {
    onMount(surfaceId);
  }
}

void AppKitBackend::updateDesktopProps(SurfaceId, Tag tag, const DesktopProps &props) {
  [views_[@(tag)] updateDesktopProps:props];
}

std::vector<facebook::react::ComponentDescriptorProvider> AppKitBackend::componentProviders() const {
  return libraryComponents();
}

} // namespace ngn::appkit
