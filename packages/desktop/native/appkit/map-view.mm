#import "map-view.h"

#import "maps.h"

namespace {
std::shared_ptr<ngn::MapViews> gViews;
std::shared_ptr<ngn::LocationSource> gLocation;
} // namespace

@interface NGNMapView ()
- (NGNMap *)map;
- (void)send:(const ngn::MapEvent &)event;
@end

namespace {

// NgNativeMaps' calls arrive on the JavaScript thread; the map is the main thread's.
struct Controller final : ngn::MapController {
  __weak NGNMapView *view;
  void setCamera(std::optional<ngn::MapCamera> camera) override {
    __weak NGNMapView *target = view;
    dispatch_async(dispatch_get_main_queue(), ^{
      [target.map moveCamera:camera];
    });
  }
  void selectMarker(std::optional<std::string> id, std::optional<double> zoom, bool moveCamera) override {
    __weak NGNMapView *target = view;
    dispatch_async(dispatch_get_main_queue(), ^{
      [target.map selectMarker:id zoom:zoom moveCamera:moveCamera];
    });
  }
};

} // namespace

@implementation NGNMapView {
  NGNMap *_map;
}

+ (void)useViews:(std::shared_ptr<ngn::MapViews>)views location:(std::shared_ptr<ngn::LocationSource>)location {
  gViews = std::move(views);
  gLocation = std::move(location);
}

- (instancetype)initWithShadowView:(const facebook::react::ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    __weak NGNMapView *weakSelf = self;
    _map = [[NGNMap alloc] initWithFrame:self.bounds
                                  events:[weakSelf](const ngn::MapEvent &event) { [weakSelf send:event]; }
                                  access:[] {
                                    return gLocation ? gLocation->authorization() : ngn::LocationSource::Authorization::Denied;
                                  }];
    _map.mapView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_map.mapView];
    if (gViews) {
      auto controller = std::make_shared<Controller>();
      controller->view = self;
      gViews->attach(static_cast<int>(self.reactTag), controller);
    }
  }
  return self;
}

- (void)dealloc {
  if (gViews) {
    gViews->detach(static_cast<int>(self.reactTag));
  }
}

- (NGNMap *)map {
  return _map;
}

- (void)send:(const ngn::MapEvent &)event {
  if (auto emitter = self.eventEmitter) {
    emitter->dispatchEvent(event.name, folly::dynamic(event.payload), facebook::react::RawEvent::Category::Discrete);
  }
}

- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props];
  if (auto map = std::dynamic_pointer_cast<const ngn::MapProps>(props)) {
    [_map apply:ngn::mapModel(map->values)];
  }
}

- (void)updateEventEmitter:(const facebook::react::EventEmitter::Shared &)emitter {
  [super updateEventEmitter:emitter];
  [self appearIfShown];
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self appearIfShown];
}

- (void)layout {
  [super layout];
  _map.mapView.frame = self.bounds;
}

// The first cameraMove, which MapView waits for before it calls the map's functions.
- (void)appearIfShown {
  if (self.window != nil && self.eventEmitter) {
    [_map appear];
  }
}

@end
