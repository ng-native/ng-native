#include "symbol-drawing.h"

#include <react/renderer/graphics/Color.h>

namespace ngn::appkit {

namespace {

NSColor *colorOf(const facebook::react::SharedColor &color) {
  auto c = facebook::react::colorComponentsFromColor(color);
  return [NSColor colorWithSRGBRed:c.red green:c.green blue:c.blue alpha:c.alpha];
}

// expo-symbols' weights, as AppKit's.
NSFontWeight weightOf(const std::string &name) {
  if (name == "ultraLight") return NSFontWeightUltraLight;
  if (name == "thin") return NSFontWeightThin;
  if (name == "light") return NSFontWeightLight;
  if (name == "medium") return NSFontWeightMedium;
  if (name == "semibold") return NSFontWeightSemibold;
  if (name == "bold") return NSFontWeightBold;
  if (name == "heavy") return NSFontWeightHeavy;
  if (name == "black") return NSFontWeightBlack;
  return NSFontWeightRegular;
}

// expo-symbols' scales; its macOS default is medium.
NSImageSymbolScale scaleOf(const std::string &name) {
  if (name == "small") return NSImageSymbolScaleSmall;
  if (name == "large") return NSImageSymbolScaleLarge;
  return NSImageSymbolScaleMedium;
}

NSImage *configured(const std::string &name, double pointSize, const std::string &weight, const std::string &scale) {
  NSString *symbol = [NSString stringWithUTF8String:name.c_str()];
  NSImage *image = symbol.length > 0 ? [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:nil] : nil;
  NSImageSymbolConfiguration *configuration =
      [NSImageSymbolConfiguration configurationWithPointSize:pointSize weight:weightOf(weight) scale:scaleOf(scale)];
  return [image imageWithSymbolConfiguration:configuration];
}

class AppKitSymbolMeasurer final : public SymbolMeasurer {
 public:
  std::optional<std::pair<double, double>> imageSize(
      const std::string &name, double pointSize, const std::string &weight, const std::string &scale) override {
    @autoreleasepool {
      NSImage *image = configured(name, pointSize, weight, scale);
      if (image == nil) {
        return std::nullopt;
      }
      return std::pair<double, double>{image.size.width, image.size.height};
    }
  }
};

} // namespace

NSImage *symbolImage(const SymbolProps &props) {
  NSImage *image = configured(props.name, NSFont.systemFontSize, props.weight, props.scale);
  if (image == nil) {
    return nil;
  }
  auto paint = symbolPaint(props);
  NSMutableArray<NSColor *> *colors = [NSMutableArray array];
  for (const auto &color : paint.colors) {
    [colors addObject:colorOf(color)];
  }
  NSImageSymbolConfiguration *colouring = nil;
  switch (paint.mode) {
    case SymbolPaint::Mode::Monochrome:
      // One colour over every layer: the tint, or the label colour.
      colouring = [NSImageSymbolConfiguration configurationWithPaletteColors:@[ colors.count > 0 ? colors[0] : NSColor.labelColor ]];
      break;
    case SymbolPaint::Mode::Hierarchical:
      colouring = [NSImageSymbolConfiguration configurationWithHierarchicalColor:colors.count > 0 ? colors[0] : NSColor.systemBlueColor];
      break;
    case SymbolPaint::Mode::Palette:
      colouring = [NSImageSymbolConfiguration configurationWithPaletteColors:colors];
      break;
    case SymbolPaint::Mode::Multicolor:
      colouring = [NSImageSymbolConfiguration configurationPreferringMulticolor];
      if (colors.count > 0) {
        colouring = [colouring configurationByApplyingConfiguration:[NSImageSymbolConfiguration configurationWithPaletteColors:colors]];
      }
      break;
  }
  return [image imageWithSymbolConfiguration:colouring];
}

void drawSymbol(CGContextRef context, const SymbolProps &props, CGSize size) {
  @autoreleasepool {
    NSImage *image = symbolImage(props);
    if (image == nil) {
      return;
    }
    auto rect = placeSymbol(props.resizeMode, {image.size.width, image.size.height}, {size.width, size.height});
    NSGraphicsContext *graphics = [NSGraphicsContext graphicsContextWithCGContext:context flipped:YES];
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext.currentContext = graphics;
    CGContextSaveGState(context);
    CGContextClipToRect(context, CGRectMake(0, 0, size.width, size.height));
    [image drawInRect:NSMakeRect(rect.x, rect.y, rect.width, rect.height)
             fromRect:NSZeroRect
            operation:NSCompositingOperationSourceOver
             fraction:1
       respectFlipped:YES
                hints:nil];
    CGContextRestoreGState(context);
    [NSGraphicsContext restoreGraphicsState];
  }
}

std::shared_ptr<SymbolMeasurer> makeSymbolMeasurer() {
  return std::make_shared<AppKitSymbolMeasurer>();
}

} // namespace ngn::appkit
