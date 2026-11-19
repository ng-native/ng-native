#import "image-view.h"
#import "image-request.h"

#import <QuartzCore/QuartzCore.h>

#include "ngn/file-system.h"
#include "ngn/image-source.h"

#include <react/renderer/components/image/ImageEventEmitter.h>
#include <react/renderer/components/image/ImageProps.h>

using namespace facebook::react;

@implementation NGNImageView {
  NSString *_uri;
  // The source picked, whose method, headers and body the request carries.
  std::optional<ImageSource> _source;
  NSURLSessionDataTask *_task;
  NSImage *_image;
  // resizeMode `repeat`: the image tiles at its own size from the top left, as React Native iOS
  // tiles it, instead of being drawn once by the layer's contents gravity.
  BOOL _repeat;
  // The picked source's scale: how many of the picture's pixels make a point, as React Native iOS
  // hands the source's scale to its loader. Sizes the repeat tile.
  double _scale;
  // Holds the image under the view's children. The view's own layer is no place for it: NGNView
  // draws its box in drawRect:, and each redraw (every layout asks for one) replaces the layer's
  // contents, so an image that loaded before the redraw was wiped.
  CALayer *_imageLayer;
  // Moved on by each load: a completion already queued for an earlier one, even of the same uri,
  // is ignored.
  uint64_t _load;
}

- (void)dealloc {
  [_task cancel];
}

- (CALayer *)imageLayer {
  if (_imageLayer == nil) {
    _imageLayer = [CALayer layer];
    _imageLayer.contentsGravity = self.layer.contentsGravity;
    _imageLayer.frame = self.layer.bounds;
    [self.layer insertSublayer:_imageLayer atIndex:0];
  }
  return _imageLayer;
}

- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _imageLayer.frame = self.layer.bounds;
  [CATransaction commit];
}

- (std::shared_ptr<const ImageEventEmitter>)imageEmitter {
  return std::dynamic_pointer_cast<const ImageEventEmitter>(self.eventEmitter);
}

- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  auto p = std::dynamic_pointer_cast<const ImageProps>(props);
  if (!p) {
    return;
  }
  switch (p->resizeMode) {
    case ImageResizeMode::Cover:
      self.layer.contentsGravity = kCAGravityResizeAspectFill;
      break;
    case ImageResizeMode::Contain:
      self.layer.contentsGravity = kCAGravityResizeAspect;
      break;
    case ImageResizeMode::Center:
      self.layer.contentsGravity = kCAGravityCenter;
      break;
    default:
      self.layer.contentsGravity = kCAGravityResize;
      break;
  }
  self.layer.masksToBounds = YES;
  _imageLayer.contentsGravity = self.layer.contentsGravity;
  BOOL repeat = p->resizeMode == ImageResizeMode::Repeat;
  if (repeat != _repeat) {
    _repeat = repeat;
    [self showImage];
  }
  // The source whose scale is nearest the screen's, as React Native iOS picks.
  double screenScale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  auto source = ngn::pickImageSource(p->sources, screenScale);
  double scale = source && source->scale > 0 ? source->scale : 1;
  if (scale != _scale) {
    _scale = scale;
    [self showImage];
  }
  if (source.has_value() == _source.has_value() && (!source || ngn::sameImageRequest(*source, *_source))) {
    return;
  }
  _source = source;
  _uri = source ? [NSString stringWithUTF8String:source->uri.c_str()] : nil;
  [self load];
}

- (void)load {
  [_task cancel];
  _task = nil;
  _load++;
  _image = nil;
  [self showImage];
  // A file is drawn only inside the file boundary, and exactly the file checked.
  std::shared_ptr<ngn::FileAccess::Use> use;
  NSString *load = _uri;
  if (_uri != nil) {
    try {
      auto source = ngn::readableSource(ngn::viewFileAccess().get(), _uri.UTF8String);
      load = [NSString stringWithUTF8String:source.uri.c_str()];
      use = std::move(source.use);
    } catch (const ngn::FileRefused &refused) {
      [self failed:[NSString stringWithUTF8String:refused.what()]];
      return;
    }
  }
  NSURL *url = load ? [NSURL URLWithString:load] : nil;
  if (url == nil) {
    if (_uri) {
      [self failed:[NSString stringWithFormat:@"Invalid image URL: %@", _uri]];
    }
    return;
  }
  if (auto e = [self imageEmitter]) {
    e->onLoadStart();
  }
  NSString *requested = _uri;
  uint64_t generation = _load;
  __weak NGNImageView *weakSelf = self;
  _task = [NSURLSession.sharedSession
      dataTaskWithRequest:ngn::appkit::imageRequest(url, *_source)
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        // The pick holding a file stays open until it is read.
        (void)use;
        NSImage *image = data ? [[NSImage alloc] initWithData:data] : nil;
        NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 200;
        dispatch_async(dispatch_get_main_queue(), ^{
          NGNImageView *view = weakSelf;
          if (view == nil || view->_load != generation) {
            return;
          }
          if (error != nil) {
            if (error.code != NSURLErrorCancelled) {
              [view failed:error.localizedDescription];
            }
          } else if (status >= 400 || image == nil) {
            [view failed:[NSString stringWithFormat:@"Could not load the image at %@ (HTTP %ld)", requested, (long)status]];
          } else {
            [view loaded:image];
          }
        });
      }];
  [_task resume];
}

// The picture at its pixel size divided by the source's scale, in points: the size one tile takes.
// A copy, so the image that other drawing uses keeps its own size.
- (NSImage *)tile {
  NSImageRep *rep = _image.representations.firstObject;
  NSSize pixels = rep && rep.pixelsWide > 0 && rep.pixelsHigh > 0 ? NSMakeSize(rep.pixelsWide, rep.pixelsHigh) : _image.size;
  NSImage *tile = [_image copy];
  tile.size = NSMakeSize(pixels.width / _scale, pixels.height / _scale);
  return tile;
}

// The image on its layer: tiled as that layer's background, or as its contents.
- (void)showImage {
  if (_image == nil && _imageLayer == nil) {
    return;
  }
  CALayer *layer = [self imageLayer];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  layer.contentsGravity = self.layer.contentsGravity;
  if (_image != nil && _repeat) {
    layer.contents = nil;
    layer.backgroundColor = [NSColor colorWithPatternImage:[self tile]].CGColor;
  } else {
    layer.backgroundColor = nil;
    layer.contents = _image;
  }
  [CATransaction commit];
}

- (void)loaded:(NSImage *)image {
  _image = image;
  [self showImage];
  if (auto e = [self imageEmitter]) {
    NSImageRep *rep = image.representations.firstObject;
    ImageSource source;
    source.uri = std::string(_uri.UTF8String);
    // In pixels, at a scale of 1: ImageSource's default scale of 3 would report three times the size.
    source.scale = 1;
    source.size = {static_cast<Float>(rep ? rep.pixelsWide : image.size.width),
                   static_cast<Float>(rep ? rep.pixelsHigh : image.size.height)};
    e->onLoad(source);
    e->onLoadEnd();
  }
}

- (void)failed:(NSString *)message {
  if (auto e = [self imageEmitter]) {
    ImageErrorInfo info;
    info.error = std::string(message.UTF8String);
    e->onError(info);
    e->onLoadEnd();
  }
}

@end
