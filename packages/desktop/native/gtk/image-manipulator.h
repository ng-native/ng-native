// The OS half of NgNativeImageManipulator on Linux (the core's image-manipulator.h): gdk-pixbuf
// decodes the image the right way up by its Exif orientation, cairo draws each step, and
// gdk-pixbuf encodes the result in a format it has a writer for (JPEG and PNG; WebP only with a
// WebP loader installed).
#pragma once

#include "ngn/image-manipulator.h"

#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace ngn::gtk {

std::shared_ptr<ImageCodec> makeImageCodec();

// An image file's size in pixels as stored (before its Exif orientation), from its header; nothing
// for a file no gdk-pixbuf loader reads. ImagePicker describes a pick with it.
std::optional<std::pair<double, double>> imagePixelSize(const std::string &path);

} // namespace ngn::gtk
