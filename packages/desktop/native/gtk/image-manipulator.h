// The OS half of NgNativeImageManipulator on Linux (the core's image-manipulator.h): gdk-pixbuf
// decodes the image the right way up by its Exif orientation, cairo draws each step, and
// gdk-pixbuf encodes the result in a format it has a writer for (JPEG and PNG; WebP only with a
// WebP loader installed).
#pragma once

#include "ngn/image-manipulator.h"

#include <gdk-pixbuf/gdk-pixbuf.h>

#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace ngn::gtk {

std::shared_ptr<ImageCodec> makeImageCodec();

// An image file's size in pixels as stored (before its Exif orientation), from its header; nothing
// for a file no gdk-pixbuf loader reads. ImagePicker describes a pick with it.
std::optional<std::pair<double, double>> imagePixelSize(const std::string &path);

// `pixbuf`'s colour channels in a new pixbuf without alpha, a new reference to it where it has
// none, or null where the new pixbuf cannot be allocated. JPEG is saved from one: gdk-pixbuf 2.44
// and later write JPEG through glycin, whose encoder refuses an image with alpha.
GdkPixbuf *withoutAlpha(GdkPixbuf *pixbuf);

} // namespace ngn::gtk
