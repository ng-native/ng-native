// The OS half of NgNativeImageManipulator on Linux (the core's image-manipulator.h): gdk-pixbuf
// decodes the image the right way up by its Exif orientation, cairo draws each step, and
// gdk-pixbuf encodes the result in a format it has a writer for (JPEG and PNG; WebP only with a
// WebP loader installed).
#pragma once

#include "ngn/image-manipulator.h"

#include <memory>

namespace ngn::gtk {

std::shared_ptr<ImageCodec> makeImageCodec();

} // namespace ngn::gtk
