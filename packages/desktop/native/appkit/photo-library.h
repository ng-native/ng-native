// The OS half of NgNativeMediaLibrary and NgNativeImagePicker (the core's photo-library.h):
// PhotoKit, and PHPicker as a sheet on the key window. It asks for access only when the app's
// Info.plist has the usage string, and the core reads and writes only with access, so a build
// without the strings never shows a prompt. Picked files are copied into `caches`/ImagePicker.
#pragma once

#include "ngn/photo-library.h"

#include <memory>
#include <string>

namespace ngn::appkit {

std::shared_ptr<PhotoLibrary> makePhotoLibrary(const std::string &caches);

} // namespace ngn::appkit

#ifdef __OBJC__
#import <AppKit/AppKit.h>

namespace ngn::appkit {

// The sheet the photo picker shows in on `window`: a picker's size (780 by 560), or 20 points in
// from the window on each side where that is smaller. The picker's own fitting size is only its
// title and Cancel, which would leave no room for the photos.
NSWindow *pickerSheet(NSViewController *picker, NSWindow *window);

} // namespace ngn::appkit
#endif

namespace ngn::appkit {

} // namespace ngn::appkit
