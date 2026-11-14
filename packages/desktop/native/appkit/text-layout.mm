#include "text-layout.h"

#import <AppKit/AppKit.h>
#include <cmath>

using namespace facebook::react;

namespace ngn {

namespace {

CGFloat appKitWeight(FontWeight weight) {
  switch (static_cast<int>(weight)) {
    case 100: return NSFontWeightUltraLight;
    case 200: return NSFontWeightThin;
    case 300: return NSFontWeightLight;
    case 500: return NSFontWeightMedium;
    case 600: return NSFontWeightSemibold;
    case 700: return NSFontWeightBold;
    case 800: return NSFontWeightHeavy;
    case 900: return NSFontWeightBlack;
    default: return NSFontWeightRegular;
  }
}

CGColorRef cgColor(const SharedColor &color) {
  auto c = colorComponentsFromColor(color);
  return CGColorCreateSRGB(c.red, c.green, c.blue, c.alpha);
}

CTFontRef makeFont(const TextAttributes &a) {
  CGFloat multiplier = 1;
  if (a.allowFontScaling.value_or(true) && !std::isnan(a.fontSizeMultiplier)) {
    multiplier = a.fontSizeMultiplier;
    if (!std::isnan(a.maxFontSizeMultiplier) && a.maxFontSizeMultiplier >= 1) {
      multiplier = std::min<CGFloat>(multiplier, a.maxFontSizeMultiplier);
    }
  }
  CGFloat size = (std::isnan(a.fontSize) ? 14 : a.fontSize) * multiplier;
  CGFloat weight = appKitWeight(a.fontWeight.value_or(FontWeight::Regular));
  bool italic = a.fontStyle.has_value() && *a.fontStyle != FontStyle::Normal;
  NSFont *font = nil;
  const std::string &family = a.fontFamily;
  if (family.empty() || family == "System" || family == "system-ui" || family == "sans-serif") {
    font = [NSFont systemFontOfSize:size weight:weight];
  } else if (family == "monospace" || family == "Menlo") {
    font = [NSFont monospacedSystemFontOfSize:size weight:weight];
  } else {
    NSString *name = [NSString stringWithUTF8String:family.c_str()];
    NSFontDescriptor *d = [NSFontDescriptor fontDescriptorWithFontAttributes:@{
      NSFontFamilyAttribute : name,
      NSFontTraitsAttribute : @{NSFontWeightTrait : @(weight)},
    }];
    font = [NSFont fontWithDescriptor:d size:size];
    if (font == nil) {
      font = [NSFont fontWithName:name size:size];
    }
    if (font == nil) {
      font = [NSFont systemFontOfSize:size weight:weight];
    }
  }
  if (italic) {
    NSFontDescriptor *d = [font.fontDescriptor fontDescriptorWithSymbolicTraits:
                                                    font.fontDescriptor.symbolicTraits | NSFontDescriptorTraitItalic];
    NSFont *slanted = [NSFont fontWithDescriptor:d size:size];
    if (slanted != nil) {
      font = slanted;
    }
  }
  return (CTFontRef)CFBridgingRetain(font);
}

CTTextAlignment ctAlignment(std::optional<TextAlignment> alignment) {
  switch (alignment.value_or(TextAlignment::Natural)) {
    case TextAlignment::Left: return kCTTextAlignmentLeft;
    case TextAlignment::Center: return kCTTextAlignmentCenter;
    case TextAlignment::Right: return kCTTextAlignmentRight;
    case TextAlignment::Justified: return kCTTextAlignmentJustified;
    case TextAlignment::End: return kCTTextAlignmentRight;
    default: return kCTTextAlignmentNatural;
  }
}

std::string transformed(const std::string &text, std::optional<TextTransform> transform) {
  if (!transform || *transform == TextTransform::None) {
    return text;
  }
  NSString *s = [NSString stringWithUTF8String:text.c_str()];
  switch (*transform) {
    case TextTransform::Uppercase: s = s.uppercaseString; break;
    case TextTransform::Lowercase: s = s.lowercaseString; break;
    case TextTransform::Capitalize: s = s.capitalizedString; break;
    default: break;
  }
  return s.UTF8String;
}

} // namespace

TextLayout::TextLayout(TextLayout &&other) noexcept
    : string(other.string), lines(std::move(other.lines)), size(other.size) {
  other.string = nullptr;
  other.lines.clear();
}

TextLayout::~TextLayout() {
  for (auto &l : lines) {
    CFRelease(l.line);
  }
  if (string != nullptr) {
    CFRelease(string);
  }
}

CFAttributedStringRef makeAttributedString(const AttributedString &attributedString) {
  CFMutableAttributedStringRef out = CFAttributedStringCreateMutable(kCFAllocatorDefault, 0);
  CFAttributedStringBeginEditing(out);
  for (const auto &fragment : attributedString.getFragments()) {
    if (fragment.isAttachment()) {
      continue;
    }
    const auto &a = fragment.textAttributes;
    std::string text = transformed(fragment.string, a.textTransform);
    CFStringRef cf = CFStringCreateWithCString(kCFAllocatorDefault, text.c_str(), kCFStringEncodingUTF8);
    if (cf == nullptr) {
      continue;
    }
    CFIndex start = CFAttributedStringGetLength(out);
    CFAttributedStringReplaceString(out, CFRangeMake(start, 0), cf);
    CFRange range = CFRangeMake(start, CFStringGetLength(cf));
    CFRelease(cf);

    CTFontRef font = makeFont(a);
    CFAttributedStringSetAttribute(out, range, kCTFontAttributeName, font);

    CGColorRef color = a.foregroundColor ? cgColor(a.foregroundColor) : CGColorCreateSRGB(0, 0, 0, 1);
    if (!std::isnan(a.opacity)) {
      CGColorRef faded = CGColorCreateCopyWithAlpha(color, CGColorGetAlpha(color) * a.opacity);
      CGColorRelease(color);
      color = faded;
    }
    CFAttributedStringSetAttribute(out, range, kCTForegroundColorAttributeName, color);
    CGColorRelease(color);

    if (!std::isnan(a.letterSpacing)) {
      CGFloat kern = a.letterSpacing;
      CFNumberRef n = CFNumberCreate(kCFAllocatorDefault, kCFNumberCGFloatType, &kern);
      CFAttributedStringSetAttribute(out, range, kCTKernAttributeName, n);
      CFRelease(n);
    }

    // Paragraph style: alignment, and lineHeight as a fixed line box (as React Native iOS does),
    // with the glyphs centred in it through a baseline offset applied at draw time.
    CTTextAlignment alignment = ctAlignment(a.alignment);
    CGFloat lineHeight = 0;
    if (!std::isnan(a.lineHeight) && a.lineHeight > 0) {
      CGFloat multiplier =
          a.allowFontScaling.value_or(true) && !std::isnan(a.fontSizeMultiplier) ? a.fontSizeMultiplier : 1;
      lineHeight = a.lineHeight * multiplier;
    }
    CTParagraphStyleSetting settings[] = {
        {kCTParagraphStyleSpecifierAlignment, sizeof(alignment), &alignment},
        {kCTParagraphStyleSpecifierMinimumLineHeight, sizeof(lineHeight), &lineHeight},
        {kCTParagraphStyleSpecifierMaximumLineHeight, sizeof(lineHeight), &lineHeight},
    };
    CTParagraphStyleRef style = CTParagraphStyleCreate(settings, lineHeight > 0 ? 3 : 1);
    CFAttributedStringSetAttribute(out, range, kCTParagraphStyleAttributeName, style);
    CFRelease(style);

    if (a.textDecorationLineType == TextDecorationLineType::Underline ||
        a.textDecorationLineType == TextDecorationLineType::UnderlineStrikethrough) {
      int32_t single = kCTUnderlineStyleSingle;
      CFNumberRef n = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &single);
      CFAttributedStringSetAttribute(out, range, kCTUnderlineStyleAttributeName, n);
      CFRelease(n);
    }
    CFRelease(font);
  }
  CFAttributedStringEndEditing(out);
  return out;
}

TextLayout layoutText(
    const AttributedString &attributedString,
    const ParagraphAttributes &paragraphAttributes,
    CGFloat maxWidth) {
  TextLayout layout;
  layout.string = makeAttributedString(attributedString);
  CFIndex length = CFAttributedStringGetLength(layout.string);
  if (length == 0) {
    return layout;
  }
  if (!std::isfinite(maxWidth) || maxWidth <= 0) {
    maxWidth = CGFLOAT_MAX / 4;
  }
  CTTypesetterRef typesetter = CTTypesetterCreateWithAttributedString(layout.string);
  int maxLines = paragraphAttributes.maximumNumberOfLines;
  CFIndex at = 0;
  CGFloat y = 0;
  CGFloat widest = 0;
  while (at < length) {
    CFIndex count = CTTypesetterSuggestLineBreak(typesetter, at, maxWidth);
    if (count <= 0) {
      count = 1;
    }
    bool last = maxLines > 0 && (int)layout.lines.size() == maxLines - 1 && at + count < length;
    CTLineRef line = CTTypesetterCreateLine(typesetter, CFRangeMake(at, count));
    if (last && paragraphAttributes.ellipsizeMode != EllipsizeMode::Clip) {
      // The rest of the text on one line, truncated to fit.
      CTLineRef rest = CTTypesetterCreateLine(typesetter, CFRangeMake(at, length - at));
      CFDictionaryRef attrs = CFAttributedStringGetAttributes(layout.string, at, nullptr);
      CFAttributedStringRef dots = CFAttributedStringCreate(kCFAllocatorDefault, CFSTR("…"), attrs);
      CTLineRef token = CTLineCreateWithAttributedString(dots);
      CTLineTruncationType type = paragraphAttributes.ellipsizeMode == EllipsizeMode::Head ? kCTLineTruncationStart
          : paragraphAttributes.ellipsizeMode == EllipsizeMode::Middle                    ? kCTLineTruncationMiddle
                                                                                          : kCTLineTruncationEnd;
      CTLineRef truncated = CTLineCreateTruncatedLine(rest, maxWidth, type, token);
      CFRelease(token);
      CFRelease(dots);
      CFRelease(rest);
      if (truncated != nullptr) {
        CFRelease(line);
        line = truncated;
      }
    }
    CGFloat ascent = 0, descent = 0, leading = 0;
    CGFloat width = CTLineGetTypographicBounds(line, &ascent, &descent, &leading);
    width -= CTLineGetTrailingWhitespaceWidth(line);
    // Fixed line height from the paragraph style, if any (min == max).
    CGFloat fixed = 0;
    CFRange r = CTLineGetStringRange(line);
    CTParagraphStyleRef style = (CTParagraphStyleRef)CFAttributedStringGetAttribute(
        layout.string, r.location, kCTParagraphStyleAttributeName, nullptr);
    if (style != nullptr) {
      CTParagraphStyleGetValueForSpecifier(style, kCTParagraphStyleSpecifierMinimumLineHeight, sizeof(fixed), &fixed);
    }
    CGFloat natural = std::ceil(ascent + descent + leading);
    CGFloat height = fixed > 0 ? fixed : natural;
    // Glyphs centred in a fixed line box, as React Native iOS centres them.
    CGFloat baseline = y + (height - (ascent + descent)) / 2 + ascent;
    if (fixed <= 0) {
      baseline = y + ascent;
    }
    layout.lines.push_back({line, CGPointMake(0, baseline), width});
    widest = std::max(widest, width);
    y += height;
    at += count;
    if (maxLines > 0 && (int)layout.lines.size() >= maxLines) {
      break;
    }
  }
  CFRelease(typesetter);
  layout.size = CGSizeMake(widest, y);
  return layout;
}

void drawText(const TextLayout &layout, CGContextRef context, CGPoint origin, CGFloat boxWidth) {
  CGContextSaveGState(context);
  // The view is flipped; glyphs are drawn with an inverted text matrix rather than by flipping
  // the whole context, so line origins stay top-down.
  CGContextSetTextMatrix(context, CGAffineTransformMakeScale(1, -1));
  for (const auto &l : layout.lines) {
    CFRange r = CTLineGetStringRange(l.line);
    CTTextAlignment alignment = kCTTextAlignmentNatural;
    CTParagraphStyleRef style = r.length > 0
        ? (CTParagraphStyleRef)CFAttributedStringGetAttribute(
              layout.string, r.location, kCTParagraphStyleAttributeName, nullptr)
        : nullptr;
    if (style != nullptr) {
      CTParagraphStyleGetValueForSpecifier(style, kCTParagraphStyleSpecifierAlignment, sizeof(alignment), &alignment);
    }
    CGFloat x = 0;
    if (alignment == kCTTextAlignmentCenter) {
      x = (boxWidth - l.width) / 2;
    } else if (alignment == kCTTextAlignmentRight) {
      x = boxWidth - l.width;
    }
    CGContextSetTextPosition(context, origin.x + x, origin.y + l.origin.y);
    CTLineDraw(l.line, context);
  }
  CGContextRestoreGState(context);
}

facebook::react::Size CoreTextMeasurer::measure(
    const AttributedString &text,
    const ParagraphAttributes &paragraph,
    facebook::react::Float maxWidth) const {
  @autoreleasepool {
    auto layout = layoutText(text, paragraph, maxWidth);
    return {static_cast<facebook::react::Float>(layout.size.width), static_cast<facebook::react::Float>(layout.size.height)};
  }
}

} // namespace ngn
