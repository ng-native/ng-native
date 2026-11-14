// The OS half of NgNativeSharing (the core's sharing.h): AppKit's NSSharingServicePicker, shown
// below the top of the key window's content. The items it shares and how it answers are built
// apart from the picker, so they run without a window.
#pragma once

#include "ngn/sharing.h"

#import <AppKit/AppKit.h>

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn::appkit {

// What a share request hands NSSharingServicePicker, in React Native iOS's order: the message as
// text, then the url as an NSURL (a `file:` uri or an absolute path as a file url, so the file
// itself is shared). A url NSURL cannot read is shared as text.
NSArray *shareItems(const SharePicker::Request &request);

std::shared_ptr<SharePicker> makeSharePicker();

} // namespace ngn::appkit

// Follows one share through the picker and the service picked, and answers once: the service's
// title once it has shared, or nothing when the picker is dismissed or the service fails. It gives
// the service the request's title as its subject (a mail's).
@interface NGNSharePickerDelegate : NSObject <NSSharingServicePickerDelegate, NSSharingServiceDelegate>
- (instancetype)initWithTitle:(std::optional<std::string>)title
                         done:(std::function<void(std::optional<std::string>)>)done;
// Keeps `object` (the picker) alive until the share has answered.
- (void)holdUntilAnswered:(id)object;
@end
