#import "appkit-backend.h"

#import "host-view.h"
#import "surface-view.h"

namespace ngn::appkit {

AppKitBackend::AppKitBackend()
    : views_([NSMutableDictionary dictionary]), surfaces_([NSMutableDictionary dictionary]) {}

void AppKitBackend::addSurface(NGNSurfaceView *surfaceView) {
  surfaces_[@(surfaceView.surfaceId)] = surfaceView;
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
  NSMutableArray<NSView *> *siblings = [NSMutableArray array];
  for (NSView *v in parentView.subviews) {
    if ([v isKindOfClass:NGNView.class]) {
      [siblings addObject:v];
    }
  }
  if (index >= (int)siblings.count) {
    [parentView addSubview:childView];
  } else {
    [parentView addSubview:childView positioned:NSWindowBelow relativeTo:siblings[index]];
  }
}

void AppKitBackend::removeChild(SurfaceId, Tag, Tag child, int) {
  [views_[@(child)] removeFromSuperview];
}

void AppKitBackend::updateProps(const ShadowView &view) {
  [views_[@(view.tag)] updateProps:view.props];
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

void AppKitBackend::didMount(SurfaceId surfaceId) {
  if (onMount) {
    onMount(surfaceId);
  }
}

void AppKitBackend::updateDesktopProps(SurfaceId, Tag tag, const DesktopProps &props) {
  [views_[@(tag)] updateDesktopProps:props];
}

} // namespace ngn::appkit
