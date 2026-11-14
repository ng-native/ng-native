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
