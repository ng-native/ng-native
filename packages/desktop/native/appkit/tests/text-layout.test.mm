// Core Text layout (text-layout.mm) as measurement and drawing share it: attributes per fragment,
// line heights, widths, justification, alignment and the direction a justified last line follows.
#include "../text-layout.h"

#include <doctest/doctest.h>

#import <AppKit/AppKit.h>

#include <vector>

using namespace facebook::react;

namespace {

AttributedString::Fragment fragment(const std::string &text, double fontSize = 14) {
  AttributedString::Fragment f;
  f.string = text;
  f.textAttributes.fontSize = fontSize;
  return f;
}

AttributedString stringOf(std::vector<AttributedString::Fragment> fragments) {
  AttributedString out;
  for (auto &f : fragments) {
    out.appendFragment(std::move(f));
  }
  return out;
}

// A justified fragment, whose one line is its paragraph's last: on the paragraph's side.
AttributedString::Fragment justified(const std::string &text) {
  auto f = fragment(text);
  f.textAttributes.alignment = TextAlignment::Justified;
  return f;
}

const char *kWords = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt";

// The columns with ink, drawing the layout into a box `width` wide.
std::vector<bool> inkedColumns(const ngn::TextLayout &layout, int width, int height) {
  std::vector<uint8_t> pixels(static_cast<size_t>(width * height * 4), 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.data(), width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextTranslateCTM(context, 0, height);
  CGContextScaleCTM(context, 1, -1);
  ngn::drawText(layout, context, CGPointZero, width);
  CGContextRelease(context);
  std::vector<bool> inked(static_cast<size_t>(width), false);
  for (int x = 0; x < width; x++) {
    for (int y = 0; y < height; y++) {
      if (pixels[static_cast<size_t>((y * width + x) * 4 + 3)] > 0) {
        inked[static_cast<size_t>(x)] = true;
        break;
      }
    }
  }
  return inked;
}

// The leftmost column with ink, or -1.
int leftmostInk(const ngn::TextLayout &layout, int width, int height) {
  auto inked = inkedColumns(layout, width, height);
  for (int x = 0; x < width; x++) {
    if (inked[static_cast<size_t>(x)]) {
      return x;
    }
  }
  return -1;
}

// The rightmost column with ink, or -1.
int rightmostInk(const ngn::TextLayout &layout, int width, int height) {
  auto inked = inkedColumns(layout, width, height);
  for (int x = width - 1; x >= 0; x--) {
    if (inked[static_cast<size_t>(x)]) {
      return x;
    }
  }
  return -1;
}

} // namespace

TEST_CASE("A fragment takes none of the attributes of the fragment before it") {
  auto underlined = fragment("ruled");
  underlined.textAttributes.textDecorationLineType = TextDecorationLineType::Underline;
  underlined.textAttributes.letterSpacing = 5;
  CFAttributedStringRef string = ngn::makeAttributedString(stringOf({underlined, fragment("plain")}));
  CHECK(CFAttributedStringGetAttribute(string, 0, kCTUnderlineStyleAttributeName, nullptr) != nullptr);
  CHECK(CFAttributedStringGetAttribute(string, 0, kCTKernAttributeName, nullptr) != nullptr);
  CHECK(CFAttributedStringGetAttribute(string, 5, kCTUnderlineStyleAttributeName, nullptr) == nullptr);
  CHECK(CFAttributedStringGetAttribute(string, 5, kCTKernAttributeName, nullptr) == nullptr);
  CFRelease(string);
}

TEST_CASE("A fixed line height scales by the font size multiplier, capped as the font size is") {
  auto f = fragment("Hello");
  f.textAttributes.lineHeight = 20;
  f.textAttributes.fontSizeMultiplier = 3;
  f.textAttributes.maxFontSizeMultiplier = 1.5;
  auto layout = ngn::layoutText(stringOf({f}), {}, std::numeric_limits<CGFloat>::infinity());
  CHECK(layout.size.height == doctest::Approx(30));
}

TEST_CASE("A zero width is a width: the text breaks and measures no wider, and only infinity is unbounded") {
  auto string = stringOf({fragment("Hello world")});
  ngn::CoreTextMeasurer measurer;
  auto unbounded = measurer.measure(string, {}, std::numeric_limits<Float>::infinity());
  auto zero = measurer.measure(string, {}, 0);
  CHECK(unbounded.width > 0);
  CHECK(zero.width == 0);
  CHECK(zero.height > unbounded.height);
}

TEST_CASE("A justified paragraph's lines fill the width, all but its last") {
  auto f = fragment(kWords);
  f.textAttributes.alignment = TextAlignment::Justified;
  auto layout = ngn::layoutText(stringOf({f}), {}, 200);
  REQUIRE(layout.lines.size() >= 3);
  for (size_t i = 0; i + 1 < layout.lines.size(); i++) {
    INFO("line ", i);
    CHECK(layout.lines[i].width == doctest::Approx(200).epsilon(0.01));
  }
  // Left-aligned, the same lines stop short of the width; the last line is the same either way.
  auto plain = ngn::layoutText(stringOf({fragment(kWords)}), {}, 200);
  REQUIRE(plain.lines.size() == layout.lines.size());
  CHECK(plain.lines[0].width < 199);
  CHECK(layout.lines.back().width == doctest::Approx(plain.lines.back().width));
}

TEST_CASE("A justified paragraph's last line follows the paragraph's direction") {
  auto hebrew = ngn::layoutText(stringOf({justified("שלום עולם")}), {}, 300);
  REQUIRE(hebrew.lines.size() == 1);
  CHECK(hebrew.lines[0].rightToLeft);
  CHECK(leftmostInk(hebrew, 300, 40) > 150);

  // Latin first, so left to right, even with Hebrew after it.
  auto latin = ngn::layoutText(stringOf({justified("Hello שלום")}), {}, 300);
  CHECK_FALSE(latin.lines[0].rightToLeft);
  CHECK(leftmostInk(latin, 300, 40) < 10);

  // A base writing direction set on the text wins over its first letter.
  auto forced = justified("Hello");
  forced.textAttributes.baseWritingDirection = WritingDirection::RightToLeft;
  auto right = ngn::layoutText(stringOf({forced}), {}, 300);
  CHECK(right.lines[0].rightToLeft);
  CHECK(leftmostInk(right, 300, 40) > 150);

  // Hebrew inside an isolate does not count: the Latin after it sets the direction (rule P2).
  auto isolated = ngn::layoutText(stringOf({justified("\u2067שלום\u2069 Hello")}), {}, 300);
  CHECK_FALSE(isolated.lines[0].rightToLeft);
  CHECK(leftmostInk(isolated, 300, 40) < 10);

  // A right-to-left mark is a strong right-to-left character.
  auto marked = ngn::layoutText(stringOf({justified("\u200FHello")}), {}, 300);
  CHECK(marked.lines[0].rightToLeft);
  CHECK(leftmostInk(marked, 300, 40) > 150);
}

TEST_CASE("In a right-to-left layout, alignment follows the layout's direction as React Native iOS has it") {
  auto laidOut = [](const char *text, std::optional<TextAlignment> alignment, LayoutDirection direction) {
    auto f = fragment(text);
    f.textAttributes.alignment = alignment;
    f.textAttributes.layoutDirection = direction;
    return ngn::layoutText(stringOf({f}), {}, 300);
  };
  constexpr auto rtl = LayoutDirection::RightToLeft;
  constexpr auto ltr = LayoutDirection::LeftToRight;
  // Latin text with no alignment, natural or start goes right, though its paragraph runs left to
  // right; so does Hebrew.
  for (auto alignment : {std::optional<TextAlignment>{}, std::optional{TextAlignment::Natural}, std::optional{TextAlignment::Start}}) {
    auto latin = laidOut("Hello", alignment, rtl);
    CHECK_FALSE(latin.lines[0].rightToLeft);
    CHECK(leftmostInk(latin, 300, 40) > 150);
    CHECK(leftmostInk(laidOut("שלום", alignment, rtl), 300, 40) > 150);
  }
  // End goes left, and left and right swap.
  CHECK(leftmostInk(laidOut("Hello", TextAlignment::End, rtl), 300, 40) < 10);
  CHECK(leftmostInk(laidOut("Hello", TextAlignment::Right, rtl), 300, 40) < 10);
  CHECK(leftmostInk(laidOut("Hello", TextAlignment::Left, rtl), 300, 40) > 150);
  int centred = leftmostInk(laidOut("Hello", TextAlignment::Center, rtl), 300, 40);
  CHECK(centred > 100);
  CHECK(centred < 150);

  // Left to right: unset, natural and start go left, whatever the script.
  CHECK(leftmostInk(laidOut("שלום", std::nullopt, ltr), 300, 40) < 10);
  CHECK(leftmostInk(laidOut("שלום", TextAlignment::Natural, ltr), 300, 40) < 10);
  CHECK(leftmostInk(laidOut("שלום", TextAlignment::Start, ltr), 300, 40) < 10);
  CHECK(leftmostInk(laidOut("Hello", TextAlignment::End, ltr), 300, 40) > 150);
  CHECK(leftmostInk(laidOut("Hello", TextAlignment::Right, ltr), 300, 40) > 150);
}

TEST_CASE("With no alignment, text follows the layout's direction, not its script, as on iOS") {
  // A right-to-left script in a left-to-right layout is on the left, and Latin in a right-to-left
  // one on the right; text whose fragment has no layout direction lays out left to right.
  for (const char *text : {"שלום עולם", "مرحبا", "\u200FHello"}) {
    INFO(text);
    auto f = fragment(text);
    f.textAttributes.layoutDirection = LayoutDirection::LeftToRight;
    auto layout = ngn::layoutText(stringOf({f}), {}, 300);
    CHECK(layout.lines[0].rightToLeft);
    CHECK(leftmostInk(layout, 300, 40) < 10);
    CHECK(leftmostInk(ngn::layoutText(stringOf({fragment(text)}), {}, 300), 300, 40) < 10);
  }
  // Every paragraph: each short line of the Hebrew is on the left, each of the Latin on the right.
  auto hebrew = fragment("שלום\nשלום עולם\nעולם");
  hebrew.textAttributes.layoutDirection = LayoutDirection::LeftToRight;
  auto ltr = ngn::layoutText(stringOf({hebrew}), {}, 300);
  REQUIRE(ltr.lines.size() == 3);
  CHECK(leftmostInk(ltr, 300, 80) < 10);
  CHECK(rightmostInk(ltr, 300, 80) < 150);
  auto latin = fragment("Hello\nHello there\nthere");
  latin.textAttributes.layoutDirection = LayoutDirection::RightToLeft;
  auto rtl = ngn::layoutText(stringOf({latin}), {}, 300);
  REQUIRE(rtl.lines.size() == 3);
  CHECK(leftmostInk(rtl, 300, 80) > 150);
}

TEST_CASE("A paragraph's first strong character sets its direction by bidi class, letter or not") {
  // Strong right to left though not letters: Hebrew's maqaf (R) and Arabic's semicolon (AL); and an
  // Arabic letter after a zero-width space, which has no glyph and no direction.
  for (const char *text : {"\u05BEHello", "\u061BHello", "\u200B\u0645 Hello"}) {
    INFO(text);
    auto layout = ngn::layoutText(stringOf({justified(text)}), {}, 300);
    CHECK(layout.lines[0].rightToLeft);
    CHECK(leftmostInk(layout, 300, 40) > 150);
  }
  // Not strong though in the right-to-left blocks: a Hebrew point (NSM), Arabic-Indic and extended
  // Arabic-Indic digits (AN and EN). The Latin after them sets the direction.
  for (const char *text : {"\u05B0Hello", "\u0661 Hello", "\u06F1 Hello"}) {
    INFO(text);
    auto layout = ngn::layoutText(stringOf({justified(text)}), {}, 300);
    CHECK_FALSE(layout.lines[0].rightToLeft);
    CHECK(leftmostInk(layout, 300, 40) < 10);
  }
  // A strong left-to-right character that is not a letter: the circled Latin letters are So but L.
  // So is a Han character.
  for (const char *text : {"\u24B6 שלום", "\u4E2D שלום"}) {
    INFO(text);
    CHECK_FALSE(ngn::layoutText(stringOf({fragment(text)}), {}, 300).lines[0].rightToLeft);
  }
}

TEST_CASE("The embedding and override controls are not a paragraph's first strong character") {
  // LRE, RLE, PDF, LRO and RLO: rule P2 skips them, and the letter after them sets the direction.
  for (const char *control : {"\u202A", "\u202B", "\u202C", "\u202D", "\u202E"}) {
    INFO(control);
    auto hebrew = ngn::layoutText(stringOf({justified(std::string(control) + "שלום Hello")}), {}, 300);
    CHECK(hebrew.lines[0].rightToLeft);
    CHECK(leftmostInk(hebrew, 300, 40) > 150);
    auto latin = ngn::layoutText(stringOf({justified(std::string(control) + "Hello שלום")}), {}, 300);
    CHECK_FALSE(latin.lines[0].rightToLeft);
    CHECK(leftmostInk(latin, 300, 40) < 10);
  }
}

TEST_CASE("Each paragraph's wrapped lines take that paragraph's direction") {
  auto layout = ngn::layoutText(
      stringOf({fragment("Hello there\nשלום עולם שלום עולם שלום עולם שלום עולם\nGood morning to you all")}), {}, 80);
  REQUIRE(layout.lines.size() >= 5);
  CFStringRef text = CFAttributedStringGetString(layout.string);
  for (size_t i = 0; i < layout.lines.size(); i++) {
    CFIndex at = CTLineGetStringRange(layout.lines[i].line).location;
    UniChar c = CFStringGetCharacterAtIndex(text, at);
    INFO("line ", i);
    CHECK(layout.lines[i].rightToLeft == (c >= 0x0590 && c <= 0x05FF));
  }
  CHECK_FALSE(layout.lines.front().rightToLeft);
  CHECK_FALSE(layout.lines.back().rightToLeft);
}

TEST_CASE("A line through crosses the text and the spaces in it, in the decoration's colour") {
  auto plain = fragment("a      b", 20);
  auto through = plain;
  through.textAttributes.textDecorationLineType = TextDecorationLineType::Strikethrough;
  ParagraphAttributes paragraph;
  auto bare = inkedColumns(ngn::layoutText(stringOf({plain}), paragraph, 400), 400, 40);
  auto crossed = inkedColumns(ngn::layoutText(stringOf({through}), paragraph, 400), 400, 40);
  // The gap between a and b has ink only once it is struck through.
  int gap = 0, struck = 0;
  for (size_t x = 0; x < bare.size(); x++) {
    if (!bare[x]) {
      gap++;
      struck += crossed[x] ? 1 : 0;
    }
  }
  CHECK(gap > 300);
  CHECK(struck > 20);

  // Underlined and struck through, in a colour of its own.
  auto both = plain;
  both.textAttributes.textDecorationLineType = TextDecorationLineType::UnderlineStrikethrough;
  both.textAttributes.textDecorationColor = colorFromRGBA(255, 0, 0, 255);
  auto layout = ngn::layoutText(stringOf({both}), paragraph, 400);
  CFDictionaryRef attributes = CFAttributedStringGetAttributes(layout.string, 0, nullptr);
  CHECK(CFDictionaryGetValue(attributes, kCTUnderlineStyleAttributeName) != nullptr);
  CHECK(CFDictionaryGetValue(attributes, kCTUnderlineColorAttributeName) != nullptr);

  // Faded with the text: transparent text has a transparent decoration.
  both.textAttributes.opacity = 0;
  auto faded = ngn::layoutText(stringOf({both}), paragraph, 400);
  auto color = (CGColorRef)CFDictionaryGetValue(CFAttributedStringGetAttributes(faded.string, 0, nullptr), kCTUnderlineColorAttributeName);
  REQUIRE(color != nullptr);
  CHECK(CGColorGetAlpha(color) == 0);
}

TEST_CASE("A line through a right-to-left run beside left-to-right text crosses that run and no more") {
  // The Hebrew goes on past the struck run, so the run is one end of a right-to-left span.
  auto make = [](bool struck) {
    auto hebrew = fragment("אב", 20);
    if (struck) {
      hebrew.textAttributes.textDecorationLineType = TextDecorationLineType::Strikethrough;
    }
    return stringOf({fragment("abc ", 20), hebrew, fragment("גדה xyz", 20)});
  };
  ParagraphAttributes paragraph;
  auto layout = ngn::layoutText(make(true), paragraph, 400);
  // Where the struck letters are drawn: their run, found by its string range.
  CFArrayRef runs = CTLineGetGlyphRuns(layout.lines[0].line);
  CGFloat left = 0, width = 0;
  for (CFIndex i = 0; i < CFArrayGetCount(runs); i++) {
    auto run = (CTRunRef)CFArrayGetValueAtIndex(runs, i);
    if (CTRunGetStringRange(run).location == 4) {
      CGPoint first;
      CTRunGetPositions(run, CFRangeMake(0, 1), &first);
      left = first.x;
      width = CTRunGetTypographicBounds(run, CFRangeMake(0, 0), nullptr, nullptr, nullptr);
    }
  }
  REQUIRE(width > 0);
  auto plain = inkedColumns(ngn::layoutText(make(false), paragraph, 400), 400, 40);
  auto struck = inkedColumns(layout, 400, 40);
  // Every column the line adds is over the struck run.
  int outside = 0;
  for (int x = 0; x < 400; x++) {
    if (struck[static_cast<size_t>(x)] && !plain[static_cast<size_t>(x)] && (x < left - 1 || x > left + width + 1)) {
      outside++;
    }
  }
  CHECK(outside == 0);
}
