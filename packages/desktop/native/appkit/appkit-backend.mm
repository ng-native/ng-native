#import "appkit-backend.h"

#import "header-toolbar.h"
#import "host-view.h"
#import "modal-host-view.h"
#import "surface-view.h"

#include "ngn/library-components.h"

namespace ngn::appkit {

AppKitBackend::AppKitBackend()
    : views_([NSMutableDictionary dictionary]),
      surfaces_([NSMutableDictionary dictionary]),
      toolbars_([NSMutableDictionary dictionary]),
      touched_([NSMutableSet set]) {}

void AppKitBackend::addSurface(NGNSurfaceView *surfaceView) {
  surfaces_[@(surfaceView.surfaceId)] = surfaceView;
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
}

void AppKitBackend::insertChild(SurfaceId, Tag parent, Tag child, int index) {
  NGNView *parentView = views_[@(parent)];
  NGNView *childView = views_[@(child)];
  if (parentView == nil || childView == nil) {
    return;
  }
  // The index counts Fabric children only: a TextInput holds an NSTextField of its own.
  if ([childView isKindOfClass:NGNModalHostView.class]) {
    [(NGNModalHostView *)childView presentOver:parentView];
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

void AppKitBackend::removeChild(SurfaceId, Tag, Tag child, int) {
  NGNView *view = views_[@(child)];
  if ([view isKindOfClass:NGNModalHostView.class]) {
    [(NGNModalHostView *)view dismiss];
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
  views_[@(tag)].covered = covered;
}

NGNHeaderToolbar *AppKitBackend::toolbarFor(SurfaceId surfaceId) {
  NGNHeaderToolbar *toolbar = toolbars_[@(surfaceId)];
  NSWindow *window = surfaces_[@(surfaceId)].window;
  if (toolbar == nil && window != nil) {
    toolbar = [[NGNHeaderToolbar alloc] initWithWindow:window];
    toolbars_[@(surfaceId)] = toolbar;
  }
  return toolbar;
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

void AppKitBackend::didMount(SurfaceId surfaceId) {
  [NGNModalHostView fitPopovers];
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
