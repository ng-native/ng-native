#import "camera-view.h"

#import "camera.h"

namespace {
std::shared_ptr<ngn::CameraHardware> gHardware;
std::shared_ptr<ngn::CameraViews> gViews;
bool gNoPrompts = false;
} // namespace

@implementation NGNCameraView {
  std::shared_ptr<ngn::appkit::SessionCapture> _capture;
  AVCaptureVideoPreviewLayer *_preview;
  bool _asking;
  // Asked once: a request that left the permission undetermined is not repeated (cameraMount).
  bool _asked;
  bool _reported;
  // Which start a running callback belongs to: a stop moves it on, so an earlier capture's late
  // callback never reports a later one ready.
  uint64_t _start;
}

+ (void)useHardware:(std::shared_ptr<ngn::CameraHardware>)hardware views:(std::shared_ptr<ngn::CameraViews>)views noPrompts:(bool)noPrompts {
  gHardware = std::move(hardware);
  gViews = std::move(views);
  gNoPrompts = noPrompts;
}

- (void)dealloc {
  [self stopCamera];
}

- (void)send:(const std::string &)name payload:(folly::dynamic)payload {
  if (auto emitter = self.eventEmitter) {
    emitter->dispatchEvent(name, std::move(payload), facebook::react::RawEvent::Category::Discrete);
  }
}

- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props];
  [self follow];
}

- (void)updateEventEmitter:(const facebook::react::EventEmitter::Shared &)emitter {
  [super updateEventEmitter:emitter];
  [self follow];
}

- (void)layout {
  [super layout];
  _preview.frame = self.bounds;
}

// Starts or stops the camera as `active` and the permission say.
- (void)follow {
  auto props = std::dynamic_pointer_cast<const ngn::CameraProps>(self.props);
  if (!props || !gHardware || !self.eventEmitter) {
    return;
  }
  if (!props->active) {
    [self stopCamera];
    return;
  }
  if (_capture || _asking) {
    return;
  }
  auto mount = ngn::cameraMount(gHardware->access(), gHardware->hasCamera(), gNoPrompts, _asked);
  if (mount == ngn::CameraMount::Ask) {
    _asking = true;
    _asked = true;
    __weak NGNCameraView *weakSelf = self;
    gHardware->requestAccess([weakSelf](ngn::CameraHardware::Access) {
      dispatch_async(dispatch_get_main_queue(), ^{
        NGNCameraView *view = weakSelf;
        if (view != nil) {
          view->_asking = false;
          [view follow];
        }
      });
    });
    return;
  }
  if (mount != ngn::CameraMount::Start) {
    [self reportOnce:ngn::cameraMountError(mount)];
    return;
  }
  std::string error;
  __weak NGNCameraView *weakSelf = self;
  uint64_t start = ++_start;
  auto ready = [weakSelf, start] {
    NGNCameraView *view = weakSelf;
    if (view != nil && view->_capture && view->_start == start) {
      [view send:"cameraReady" payload:folly::dynamic::object()];
    }
  };
  _capture = ngn::appkit::startCapture(ngn::appkit::cameraFor(props->facing), error, ready);
  if (!_capture) {
    [self reportOnce:error];
    return;
  }
  _preview = [AVCaptureVideoPreviewLayer layerWithSession:_capture->session()];
  _preview.videoGravity = AVLayerVideoGravityResizeAspectFill;
  _preview.frame = self.bounds;
  self.wantsLayer = YES;
  [self.layer insertSublayer:_preview atIndex:0];
  gViews->attach(static_cast<int>(self.reactTag), _capture);
}

- (void)reportOnce:(const std::string &)message {
  if (_reported) {
    return;
  }
  _reported = true;
  [self send:"mountError" payload:folly::dynamic::object("message", message)];
}

- (void)stopCamera {
  _start++;
  if (gViews) {
    gViews->detach(static_cast<int>(self.reactTag));
  }
  if (_capture) {
    _capture->stop();
    _capture = nullptr;
  }
  [_preview removeFromSuperlayer];
  _preview = nil;
}

@end
