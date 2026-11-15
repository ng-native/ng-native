#include "share-picker.h"

#include "ngn/file-system.h"

@implementation NGNSharePickerDelegate {
  std::optional<std::string> _title;
  std::function<void(std::optional<std::string>)> _done;
  // Keeps itself alive until it has answered: the picker and the service hold their delegates weakly.
  NGNSharePickerDelegate *_self;
  id _held;
}

- (void)holdUntilAnswered:(id)object {
  _held = object;
}

- (instancetype)initWithTitle:(std::optional<std::string>)title done:(std::function<void(std::optional<std::string>)>)done {
  if ((self = [super init])) {
    _title = std::move(title);
    _done = std::move(done);
    _self = self;
  }
  return self;
}

- (void)answer:(std::optional<std::string>)service {
  if (auto done = std::exchange(_done, nullptr)) {
    done(std::move(service));
  }
  _held = nil;
  _self = nil;
}

- (id<NSSharingServiceDelegate>)sharingServicePicker:(NSSharingServicePicker *)picker
                           delegateForSharingService:(NSSharingService *)sharingService {
  return self;
}

- (void)sharingServicePicker:(NSSharingServicePicker *)picker didChooseSharingService:(NSSharingService *)service {
  if (service == nil) {
    [self answer:std::nullopt];
    return;
  }
  if (_title) {
    service.subject = [NSString stringWithUTF8String:_title->c_str()];
  }
}

- (void)sharingService:(NSSharingService *)sharingService didShareItems:(NSArray *)items {
  NSString *title = sharingService.title;
  [self answer:std::string(title.length > 0 ? title.UTF8String : "")];
}

- (void)sharingService:(NSSharingService *)sharingService didFailToShareItems:(NSArray *)items error:(NSError *)error {
  [self answer:std::nullopt];
}

@end

namespace ngn::appkit {

NSArray *shareItems(const SharePicker::Request &request) {
  NSMutableArray *items = [NSMutableArray array];
  if (request.message) {
    NSString *message = [NSString stringWithUTF8String:request.message->c_str()];
    [items addObject:message != nil ? message : @""];
  }
  if (request.url) {
    NSURL *url = nil;
    if (auto path = pathOfUri(*request.url)) {
      url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path->c_str()]];
    } else if (NSString *text = [NSString stringWithUTF8String:request.url->c_str()]) {
      url = [NSURL URLWithString:text];
      if (url.scheme.length == 0) {
        url = nil;
      }
    }
    if (url != nil) {
      [items addObject:url];
    } else {
      NSString *text = [NSString stringWithUTF8String:request.url->c_str()];
      [items addObject:text != nil ? text : @""];
    }
  }
  return items;
}

namespace {

class AppKitSharePicker final : public SharePicker {
 public:
  void show(const Request &request, std::function<void(std::optional<std::string>)> done) override {
    auto answer = std::make_shared<std::function<void(std::optional<std::string>)>>(std::move(done));
    Request copy = request;
    dispatch_async(dispatch_get_main_queue(), ^{
      NSWindow *window = NSApp.keyWindow != nil ? NSApp.keyWindow : NSApp.mainWindow;
      NSView *anchor = window.isVisible ? window.contentView : nil;
      if (anchor == nil) {
        // No window to show it on: nothing was shared.
        (*answer)(std::nullopt);
        return;
      }
      NGNSharePickerDelegate *delegate = [[NGNSharePickerDelegate alloc] initWithTitle:copy.title done:*answer];
      NSSharingServicePicker *picker = [[NSSharingServicePicker alloc] initWithItems:shareItems(copy)];
      picker.delegate = delegate;
      [delegate holdUntilAnswered:picker];
      NSRect bounds = anchor.bounds;
      // A point at the top centre of the content, as a sheet comes from.
      NSRect at = NSMakeRect(NSMidX(bounds) - 1, anchor.isFlipped ? NSMinY(bounds) : NSMaxY(bounds) - 2, 2, 2);
      [picker showRelativeToRect:at ofView:anchor preferredEdge:NSRectEdgeMinY];
    });
  }
};

} // namespace

std::shared_ptr<SharePicker> makeSharePicker() {
  return std::make_shared<AppKitSharePicker>();
}

} // namespace ngn::appkit
