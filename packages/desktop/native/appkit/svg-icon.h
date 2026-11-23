// An icon's SVG markup (ngn/svg-markup.h) as the template image AppKit draws in a sidebar row, a
// button or a tab: drawn in one colour and tinted by AppKit, as an SF Symbol is, for the selection,
// an inactive window and Increase Contrast.
#pragma once

#import <AppKit/AppKit.h>

#include <string>

// `markup` drawn `size` points square, at whatever scale it is drawn at, or nil when it is no svg.
// The same markup and size give the same image.
NSImage *NGNSvgTemplateImage(const std::string &markup, CGFloat size);
