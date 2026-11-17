#import "presentation-label.h"

#include "ngn/desktop-modal.h"

namespace ngn::appkit {

void labelPresentation(NSView *container, std::string_view label, std::string_view title) {
  auto name = ngn::presentationLabel(label, title);
  container.accessibilityLabel = name.empty() ? nil : [NSString stringWithUTF8String:name.c_str()];
}

} // namespace ngn::appkit
