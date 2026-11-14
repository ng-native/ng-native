#import "image-view.h"

#include <react/renderer/components/image/ImageEventEmitter.h>
#include <react/renderer/components/image/ImageProps.h>

using namespace facebook::react;

@implementation NGNImageView {
  NSString *_uri;
  NSURLSessionDataTask *_task;
  NSImage *_image;
}

- (void)dealloc {
  [_task cancel];
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
  // The source whose scale is nearest the screen's, as React Native iOS picks.
  NSString *uri = nil;
  double best = INFINITY;
  double screenScale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  for (const auto &source : p->sources) {
    if (source.uri.empty()) {
      continue;
    }
    double distance = std::abs(source.scale - screenScale);
    if (distance < best) {
      best = distance;
      uri = [NSString stringWithUTF8String:source.uri.c_str()];
    }
  }
  if ((uri == nil && _uri == nil) || [uri isEqualToString:_uri]) {
    return;
  }
  _uri = uri;
  [self load];
}

- (void)load {
  [_task cancel];
  _task = nil;
  self.layer.contents = nil;
  NSURL *url = _uri ? [NSURL URLWithString:_uri] : nil;
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
  __weak NGNImageView *weakSelf = self;
  _task = [NSURLSession.sharedSession
        dataTaskWithURL:url
      completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSImage *image = data ? [[NSImage alloc] initWithData:data] : nil;
        NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 200;
        dispatch_async(dispatch_get_main_queue(), ^{
          NGNImageView *view = weakSelf;
          if (view == nil || ![view->_uri isEqualToString:requested]) {
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

- (void)loaded:(NSImage *)image {
  _image = image;
  self.layer.contents = image;
  if (auto e = [self imageEmitter]) {
    NSImageRep *rep = image.representations.firstObject;
    ImageSource source;
    source.uri = std::string(_uri.UTF8String);
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
