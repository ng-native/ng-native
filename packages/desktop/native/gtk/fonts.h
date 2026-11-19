// The OS half of NgNativeFont on Linux (the core's fonts.h): a font file added to fontconfig's
// application fonts for this process, and Pango's font maps told to look again. Text names a
// loaded font by the name it was loaded under (useFontLibrary), as on macOS.
#pragma once

#include "ngn/fonts.h"

#include <cstdint>
#include <memory>

namespace ngn::gtk {

std::shared_ptr<FontRegistrar> makeFontRegistrar();

// The names text resolves loaded fonts by: the core's library, which fontOf (pango-text.h) reads.
void useFontLibrary(std::shared_ptr<const FontLibrary> library);
std::shared_ptr<const FontLibrary> fontLibrary();

// How many times fonts have been added: a thread whose Pango font map saw fewer reloads it.
uint64_t fontsAdded();

} // namespace ngn::gtk
