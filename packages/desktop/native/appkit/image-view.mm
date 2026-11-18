#import "image-view.h"
#import "image-request.h"

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
  // Moved on by each load: a completion already queued for an earlier one, even of the same uri,
  // is ignored.
  uint64_t _load;
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
  double screenScale = self.window ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
  auto source = ngn::pickImageSource(p->sources, screenScale);
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
  self.layer.contents = nil;
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
