// Core Text layout (text-layout.mm) as measurement and drawing share it: attributes per fragment,
// line heights, widths, justification and the direction natural alignment follows.
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

const char *kWords = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt";

// The leftmost column with ink, drawing the layout into a box `width` wide.
int leftmostInk(const ngn::TextLayout &layout, int width, int height) {
  std::vector<uint8_t> pixels(static_cast<size_t>(width * height * 4), 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.data(), width, height, 8, width * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextTranslateCTM(context, 0, height);
  CGContextScaleCTM(context, 1, -1);
  ngn::drawText(layout, context, CGPointZero, width);
  CGContextRelease(context);
  for (int x = 0; x < width; x++) {
    for (int y = 0; y < height; y++) {
      if (pixels[static_cast<size_t>((y * width + x) * 4 + 3)] > 0) {
        return x;
      }
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

TEST_CASE("Natural alignment follows the paragraph's direction") {
  auto hebrew = ngn::layoutText(stringOf({fragment("שלום עולם")}), {}, 300);
  REQUIRE(hebrew.lines.size() == 1);
  CHECK(hebrew.lines[0].rightToLeft);
  CHECK(leftmostInk(hebrew, 300, 40) > 150);

  // Latin first, so left to right, even with Hebrew after it.
  auto latin = ngn::layoutText(stringOf({fragment("Hello שלום")}), {}, 300);
  CHECK_FALSE(latin.lines[0].rightToLeft);
  CHECK(leftmostInk(latin, 300, 40) < 10);

  // A base writing direction set on the text wins over its first letter.
  auto forced = fragment("Hello");
  forced.textAttributes.baseWritingDirection = WritingDirection::RightToLeft;
  auto right = ngn::layoutText(stringOf({forced}), {}, 300);
  CHECK(right.lines[0].rightToLeft);
  CHECK(leftmostInk(right, 300, 40) > 150);

  // Hebrew inside an isolate does not count: the Latin after it sets the direction (rule P2).
  auto isolated = ngn::layoutText(stringOf({fragment("\u2067שלום\u2069 Hello")}), {}, 300);
  CHECK_FALSE(isolated.lines[0].rightToLeft);
  CHECK(leftmostInk(isolated, 300, 40) < 10);

  // A right-to-left mark is a strong right-to-left character.
  auto marked = ngn::layoutText(stringOf({fragment("\u200FHello")}), {}, 300);
  CHECK(marked.lines[0].rightToLeft);
  CHECK(leftmostInk(marked, 300, 40) > 150);
}

TEST_CASE("A paragraph's first strong character sets its direction by bidi class, letter or not") {
  // Strong right to left though not letters: Hebrew's maqaf (R) and Arabic's semicolon (AL); and an
  // Arabic letter after a zero-width space, which has no glyph and no direction.
  for (const char *text : {"\u05BEHello", "\u061BHello", "\u200B\u0645 Hello"}) {
    INFO(text);
    auto layout = ngn::layoutText(stringOf({fragment(text)}), {}, 300);
    CHECK(layout.lines[0].rightToLeft);
    CHECK(leftmostInk(layout, 300, 40) > 150);
  }
  // Not strong though in the right-to-left blocks: a Hebrew point (NSM), Arabic-Indic and extended
  // Arabic-Indic digits (AN and EN). The Latin after them sets the direction.
  for (const char *text : {"\u05B0Hello", "\u0661 Hello", "\u06F1 Hello"}) {
    INFO(text);
    auto layout = ngn::layoutText(stringOf({fragment(text)}), {}, 300);
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
    auto hebrew = ngn::layoutText(stringOf({fragment(std::string(control) + "שלום Hello")}), {}, 300);
    CHECK(hebrew.lines[0].rightToLeft);
    CHECK(leftmostInk(hebrew, 300, 40) > 150);
    auto latin = ngn::layoutText(stringOf({fragment(std::string(control) + "Hello שלום")}), {}, 300);
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
