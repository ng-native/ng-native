#import "expo-image-view.h"

#include "expo-image-drawing.h"

#import <QuartzCore/QuartzCore.h>

namespace {

std::shared_ptr<ngn::Http> gHttp;
std::shared_ptr<ngn::ImageCache> gCache;

struct Shown {
  CGImageRef image{nullptr};
  ~Shown() {
    CGImageRelease(image);
  }
  void set(CGImageRef next) {
    CGImageRelease(image);
    image = next;
  }
};

} // namespace

@implementation NGNExpoImageView {
  Shown _image;
  Shown _placeholder;
  // The source shown or loading, and which load is current: a later one supersedes it.
  std::optional<ngn::ImageSourceRef> _source;
  std::optional<ngn::ImageSourceRef> _placeholderSource;
  uint64_t _generation;
}

+ (void)useHttp:(std::shared_ptr<ngn::Http>)http cache:(std::shared_ptr<ngn::ImageCache>)cache {
  gHttp = std::move(http);
  gCache = std::move(cache);
}

- (std::shared_ptr<const ngn::ExpoImageProps>)imageProps {
  return std::dynamic_pointer_cast<const ngn::ExpoImageProps>(self.props);
}

- (void)updateProps:(const facebook::react::Props::Shared &)props {
  [super updateProps:props];
  [self reload];
  [self setNeedsDisplay:YES];
}

- (void)updateLayout:(const facebook::react::LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [self reload];
  [self setNeedsDisplay:YES];
}

- (void)send:(const std::string &)name payload:(folly::dynamic)payload {
  if (auto emitter = self.eventEmitter) {
    emitter->dispatchEvent(name, std::move(payload), facebook::react::RawEvent::Category::Discrete);
  }
}

// Loads the source that fits the view now, and the placeholder, when either changed.
- (void)reload {
  auto props = [self imageProps];
  if (!props || self.bounds.size.width <= 0 || self.bounds.size.height <= 0) {
    return;
  }
  double scale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  auto placeholder = ngn::bestImageSource(ngn::imageSources(props->placeholder), self.bounds.size.width, self.bounds.size.height, scale);
  if (placeholder != _placeholderSource) {
    _placeholderSource = placeholder;
    [self loadPlaceholder:placeholder cachePolicy:props->cachePolicy];
  }
  auto source = ngn::bestImageSource(ngn::imageSources(props->source), self.bounds.size.width, self.bounds.size.height, scale);
  if (source == _source) {
    return;
  }
  _source = source;
  uint64_t generation = ++_generation;
  if (!source) {
    _image.set(nullptr);
    [self setNeedsDisplay:YES];
    return;
  }
  [self send:"loadStart" payload:folly::dynamic::object()];
  __weak NGNExpoImageView *weakSelf = self;
  auto policy = props->cachePolicy;
  auto url = source->uri;
  ngn::loadImageBytes(gHttp, gCache, *source, policy, [weakSelf, generation, url](std::string bytes, ngn::ImageCache::Hit hit, const std::string &error) {
    auto decoded = error.empty() ? ngn::appkit::decodeImage(bytes) : std::nullopt;
    auto shared = std::make_shared<std::optional<ngn::appkit::DecodedImage>>(std::move(decoded));
    std::string why = !error.empty() ? error : (*shared ? "" : url + " is not an image");
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf show:shared generation:generation hit:hit url:url error:why];
    });
  });
}

- (void)loadPlaceholder:(const std::optional<ngn::ImageSourceRef> &)source cachePolicy:(const std::string &)policy {
  _placeholder.set(nullptr);
  if (!source) {
    return;
  }
  if (auto pixels = ngn::decodeHashUri(source->uri, source->width, source->height)) {
    _placeholder.set(ngn::appkit::imageOfPixels(*pixels));
    [self setNeedsDisplay:YES];
    return;
  }
  __weak NGNExpoImageView *weakSelf = self;
  auto wanted = *source;
  ngn::loadImageBytes(gHttp, gCache, wanted, policy, [weakSelf, wanted](std::string bytes, ngn::ImageCache::Hit, const std::string &error) {
    if (!error.empty()) {
      return;
    }
    auto decoded = std::make_shared<std::optional<ngn::appkit::DecodedImage>>(ngn::appkit::decodeImage(bytes));
    dispatch_async(dispatch_get_main_queue(), ^{
      NGNExpoImageView *view = weakSelf;
      if (view == nil || view->_placeholderSource != wanted || !*decoded) {
        return;
      }
      view->_placeholder.set(CGImageRetain((*decoded)->image));
      [view setNeedsDisplay:YES];
    });
  });
}

- (void)show:(std::shared_ptr<std::optional<ngn::appkit::DecodedImage>>)decoded
    generation:(uint64_t)generation
           hit:(ngn::ImageCache::Hit)hit
           url:(const std::string &)url
         error:(const std::string &)error {
  if (generation != _generation) {
    return;
  }
  if (!error.empty()) {
    [self send:"error" payload:folly::dynamic::object("error", error)];
    return;
  }
  auto &image = **decoded;
  auto props = [self imageProps];
  auto transition = props ? ngn::imageTransition(props->transition) : ngn::ImageTransition{};
  if (transition.duration > 0 && transition.effect != "none" && self.layer != nil) {
    // Every effect is a cross-dissolve here; AppKit's layers have no flips or curls.
    CATransition *fade = [CATransition animation];
    fade.type = kCATransitionFade;
    fade.duration = transition.duration / 1000.0;
    NSString *timing = transition.timing == "linear" ? kCAMediaTimingFunctionLinear
        : transition.timing == "ease-in"            ? kCAMediaTimingFunctionEaseIn
        : transition.timing == "ease-out"           ? kCAMediaTimingFunctionEaseOut
                                                    : kCAMediaTimingFunctionEaseInEaseOut;
    fade.timingFunction = [CAMediaTimingFunction functionWithName:timing];
    [self.layer addAnimation:fade forKey:@"expoImageTransition"];
  }
  _image.set(CGImageRetain(image.image));
  [self setNeedsDisplay:YES];
  auto source = folly::dynamic::object("url", url)("width", static_cast<double>(CGImageGetWidth(image.image)))(
      "height", static_cast<double>(CGImageGetHeight(image.image)))("mediaType", image.mediaType)("isAnimated", image.animated);
  [self send:"load" payload:folly::dynamic::object("cacheType", ngn::cacheTypeName(hit))("source", std::move(source))];
  [self send:"display" payload:folly::dynamic::object()];
}

- (void)drawRect:(NSRect)dirtyRect {
  auto props = [self imageProps];
  if (!props) {
    return;
  }
  CGContextRef context = NSGraphicsContext.currentContext.CGContext;
  if (_image.image != nullptr) {
    ngn::appkit::drawImage(context, _image.image, props->contentFit, props->contentPosition, self.bounds.size, props->tintColor, props->blurRadius);
  } else if (_placeholder.image != nullptr) {
    ngn::appkit::drawImage(context, _placeholder.image, props->placeholderContentFit, props->contentPosition, self.bounds.size, {}, 0);
  }
}

@end
