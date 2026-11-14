// SF Symbols for `<expo-symbol>` (the core's symbol.h), drawn with NSImage's symbol configuration:
// the image at the system font size, weight and scale, as expo-symbols builds it on macOS, coloured
// by the core's paint and drawn into the rectangle the core places it in. No view or window: the
// view (symbol-view.mm) calls drawSymbol in its drawRect.
#pragma once

#include "ngn/symbol.h"

#import <AppKit/AppKit.h>

#include <memory>

namespace ngn::appkit {

// The symbol `props` names, configured and coloured, or nil for a name with no symbol.
NSImage *symbolImage(const SymbolProps &props);

// Draws `props`' symbol into `context` (flipped: its origin at the top left) over a view of
// `size`. Draws nothing for a name with no symbol.
void drawSymbol(CGContextRef context, const SymbolProps &props, CGSize size);

std::shared_ptr<SymbolMeasurer> makeSymbolMeasurer();

} // namespace ngn::appkit
