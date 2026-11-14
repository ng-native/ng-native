// The OS half of NgNativeTextRecognition (the core's text-recognition.h): Vision, on the image
// ImageIO decodes, with the orientation the file records.
#pragma once

#include "ngn/text-recognition.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<TextReader> makeTextReader();

} // namespace ngn::appkit
