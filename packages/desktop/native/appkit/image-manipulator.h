// The OS half of NgNativeImageManipulator (the core's image-manipulator.h): ImageIO decodes the
// image the right way up and encodes the result, and each edit is drawn with Core Graphics into a
// bitmap context of its size. No window or view is involved.
#pragma once

#include "ngn/image-manipulator.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<ImageCodec> makeImageCodec();

} // namespace ngn::appkit
