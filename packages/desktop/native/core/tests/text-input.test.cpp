#include "ngn/text-input.h"

#include <doctest/doctest.h>

using namespace facebook::react;

namespace {

struct Parser {
  std::shared_ptr<const ContextContainer> context = std::make_shared<const ContextContainer>();
  ngn::DesktopTextInputComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};

  std::shared_ptr<const ngn::DesktopTextInputProps> clone(const Props::Shared &props, folly::dynamic raw) {
    return std::static_pointer_cast<const ngn::DesktopTextInputProps>(
        descriptor.cloneProps(parserContext, props, RawProps(std::move(raw))));
  }

  ngn::TextInputOptions options(folly::dynamic raw) {
    return ngn::textInputOptions(*clone(nullptr, std::move(raw)));
  }
};

// Capitals for ASCII, and a character that is a surrogate pair or a letter with the combining marks
// after it, as a backend's text system answers.
struct FakeCharacters final : ngn::TextCharacters {
  std::u16string uppercase(const std::u16string &text) const override {
    std::u16string out;
    for (auto unit : text) {
      if (unit >= u'a' && unit <= u'z') {
        out += static_cast<char16_t>(unit - u'a' + u'A');
      } else if (unit == u'\u00DF') {
        // German sharp s: one character in, two out, as a locale's capitals can be.
        out += u"SS";
      } else {
        out += unit;
      }
    }
    return out;
  }
  std::pair<std::size_t, std::size_t> characterAt(const std::u16string &text, std::size_t index) const override {
    std::size_t start = index;
    while (start > 0 && ((text[start] >= 0xDC00 && text[start] <= 0xDFFF) || (text[start] >= 0x0300 && text[start] <= 0x036F))) {
      start--;
    }
    std::size_t end = start + 1;
    while (end < text.size() && ((text[end] >= 0xDC00 && text[end] <= 0xDFFF) || (text[end] >= 0x0300 && text[end] <= 0x036F))) {
      end++;
    }
    return {start, end - start};
  }
};

std::u16string fit(const std::u16string &current, std::size_t location, std::size_t length, const std::u16string &replacement,
                   ngn::TextInputOptions options) {
  return ngn::fitReplacement(current, location, length, replacement, options, FakeCharacters{});
}

} // namespace

TEST_CASE("TextInput's desktop props parse React Native's traits, selection and smartQuotes") {
  Parser p;
  auto props = p.clone(
      nullptr,
      folly::dynamic::object("smartQuotes", false)("autoCorrect", true)("secureTextEntry", true)(
          "selection", folly::dynamic::object("start", 2)("end", 5))("maxLength", 4)("placeholder", "Name"));
  CHECK(props->smartQuotes == false);
  CHECK(props->traits.autoCorrect == true);
  CHECK(props->traits.secureTextEntry);
  REQUIRE(props->selection.has_value());
  CHECK(props->selection->start == 2);
  CHECK(props->selection->end == 5);
  CHECK(props->maxLength == 4);
  CHECK(props->placeholder == "Name");
  CHECK(std::string(p.descriptor.getComponentName()) == "TextInput");

  // An update keeps what it does not mention, and null unsets.
  auto next = p.clone(props, folly::dynamic::object("autoCorrect", false));
  CHECK(next->smartQuotes == false);
  CHECK(next->traits.autoCorrect == false);
  auto cleared = p.clone(next, folly::dynamic::object("smartQuotes", nullptr));
  CHECK_FALSE(cleared->smartQuotes.has_value());
}

TEST_CASE("unset switches leave the system setting, and spellCheck and smartQuotes follow autoCorrect") {
  Parser p;
  auto none = p.options(folly::dynamic::object());
  CHECK_FALSE(none.autoCorrect.has_value());
  CHECK_FALSE(none.spellCheck.has_value());
  CHECK_FALSE(none.smartQuotes.has_value());
  CHECK_FALSE(none.smartInsertDelete.has_value());
  CHECK_FALSE(none.maxLength.has_value());
  CHECK(none.capitalize == ngn::Capitalize::Sentences);

  auto off = p.options(folly::dynamic::object("autoCorrect", false));
  CHECK(off.autoCorrect == false);
  CHECK(off.spellCheck == false);
  CHECK(off.smartQuotes == false);

  auto mixed = p.options(folly::dynamic::object("autoCorrect", false)("spellCheck", true)("smartQuotes", true));
  CHECK(mixed.spellCheck == true);
  CHECK(mixed.smartQuotes == true);

  auto on = p.options(folly::dynamic::object("autoCorrect", true)("smartInsertDelete", false));
  CHECK(on.smartQuotes == true);
  CHECK(on.smartInsertDelete == false);
}

TEST_CASE("autoCapitalize and maxLength reach the options") {
  Parser p;
  CHECK(p.options(folly::dynamic::object("autoCapitalize", "none")).capitalize == ngn::Capitalize::None);
  CHECK(p.options(folly::dynamic::object("autoCapitalize", "words")).capitalize == ngn::Capitalize::Words);
  CHECK(p.options(folly::dynamic::object("autoCapitalize", "characters")).capitalize == ngn::Capitalize::Characters);
  CHECK(p.options(folly::dynamic::object("maxLength", 0)).maxLength == 0u);
  CHECK(p.options(folly::dynamic::object("maxLength", 12)).maxLength == 12u);
}

TEST_CASE("secure entry turns every substitution off, whatever the props ask") {
  Parser p;
  auto secure = p.options(folly::dynamic::object("secureTextEntry", true)("autoCorrect", true)("spellCheck", true)(
      "smartQuotes", true)("autoCapitalize", "words"));
  CHECK(secure.secure);
  CHECK(secure.autoCorrect == false);
  CHECK(secure.spellCheck == false);
  CHECK(secure.smartQuotes == false);
  CHECK(secure.smartInsertDelete == false);
  CHECK(secure.capitalize == ngn::Capitalize::None);
}

TEST_CASE("inputAlignment aligns a field as React Native iOS aligns a TextInput") {
  Parser parser;
  auto aligned = [&](folly::dynamic raw, LayoutDirection direction) {
    return ngn::inputAlignment(parser.clone(nullptr, std::move(raw))->textAttributes.alignment, direction);
  };
  constexpr auto ltr = LayoutDirection::LeftToRight;
  constexpr auto rtl = LayoutDirection::RightToLeft;
  // None set: the layout's direction, so the leading side.
  CHECK(aligned(folly::dynamic::object(), ltr) == TextAlignment::Left);
  CHECK(aligned(folly::dynamic::object(), rtl) == TextAlignment::Right);
  CHECK(aligned(folly::dynamic::object(), LayoutDirection::Undefined) == TextAlignment::Left);
  // Set: as a left-to-right fragment, in either direction.
  for (auto direction : {ltr, rtl}) {
    CHECK(aligned(folly::dynamic::object("textAlign", "auto"), direction) == TextAlignment::Left);
    CHECK(aligned(folly::dynamic::object("textAlign", "left"), direction) == TextAlignment::Left);
    CHECK(aligned(folly::dynamic::object("textAlign", "right"), direction) == TextAlignment::Right);
    CHECK(aligned(folly::dynamic::object("textAlign", "center"), direction) == TextAlignment::Center);
    CHECK(aligned(folly::dynamic::object("textAlign", "justify"), direction) == TextAlignment::Justified);
    CHECK(ngn::inputAlignment(TextAlignment::Start, direction) == TextAlignment::Left);
    CHECK(ngn::inputAlignment(TextAlignment::End, direction) == TextAlignment::Right);
  }
}

TEST_CASE("insertionThatFits keeps a field within maxLength") {
  CHECK(ngn::insertionThatFits(3, 0, 10, std::nullopt) == 10);
  CHECK(ngn::insertionThatFits(3, 0, 1, 5) == 1);
  CHECK(ngn::insertionThatFits(3, 0, 4, 5) == 2);
  CHECK(ngn::insertionThatFits(5, 0, 1, 5) == 0);
  // Replacing a selection frees its length first.
  CHECK(ngn::insertionThatFits(5, 2, 3, 5) == 2);
  // A field already over the limit (text set from code) takes nothing more.
  CHECK(ngn::insertionThatFits(8, 1, 1, 5) == 0);
  CHECK(ngn::insertionThatFits(0, 0, 3, 0) == 0);
}

TEST_CASE("fitReplacement cuts an edit to maxLength between characters") {
  ngn::TextInputOptions limit;
  limit.maxLength = 5;
  CHECK(fit(u"abc", 3, 0, u"defg", limit) == u"de");
  CHECK(fit(u"abcde", 5, 0, u"f", limit).empty());
  CHECK(fit(u"abcde", 1, 2, u"xyz", limit) == u"xy");
  // Never half a surrogate pair, nor a letter without its combining mark.
  CHECK(fit(u"abcd", 4, 0, u"\U0001F600", limit).empty());
  CHECK(fit(u"abc", 3, 0, u"\U0001F600", limit) == u"\U0001F600");
  CHECK(fit(u"abcd", 4, 0, u"e\u0301f", limit).empty());
  CHECK(fit(u"abc", 3, 0, u"xe\u0301f", limit) == u"x");
  CHECK(fit(u"abc", 3, 0, u"e\u0301f", limit) == u"e\u0301");
  // No limit, nothing to do.
  CHECK(fit(u"abc", 3, 0, u"defg", {}) == u"defg");
}

TEST_CASE("fitReplacement capitalizes words or characters, typed or pasted, before it cuts") {
  ngn::TextInputOptions words;
  words.capitalize = ngn::Capitalize::Words;
  CHECK(fit(u"", 0, 0, u"hello world", words) == u"Hello World");
  // A word continues from the text before the edit, and starts after white space or a line break.
  CHECK(fit(u"hel", 3, 0, u"lo there", words) == u"lo There");
  CHECK(fit(u"hello ", 6, 0, u"w", words) == u"W");
  CHECK(fit(u"a\n", 2, 0, u"b\tc\u00A0d", words) == u"B\tC\u00A0D");
  // Replacing a selection looks at what is before it.
  CHECK(fit(u"one two", 4, 3, u"three", words) == u"Three");
  ngn::TextInputOptions characters;
  characters.capitalize = ngn::Capitalize::Characters;
  CHECK(fit(u"ab", 2, 0, u"cd e", characters) == u"CD E");
  characters.maxLength = 4;
  // A capital that is longer than its letter counts at its own length.
  CHECK(fit(u"ab", 2, 0, u"\u00DFx", characters) == u"SS");
  ngn::TextInputOptions none;
  none.capitalize = ngn::Capitalize::None;
  CHECK(fit(u"", 0, 0, u"hello", none) == u"hello");
  CHECK(ngn::isTextSpace(u' '));
  CHECK(ngn::isTextSpace(u'\u3000'));
  CHECK_FALSE(ngn::isTextSpace(u'x'));
}

TEST_CASE("controlledTextIsCurrent takes JavaScript's text only when it answers the latest edit, and never while composing") {
  CHECK(ngn::controlledTextIsCurrent(3, 3, false));
  CHECK(ngn::controlledTextIsCurrent(4, 3, false));
  // Sent before the field's latest edit reached JavaScript: stale.
  CHECK_FALSE(ngn::controlledTextIsCurrent(2, 3, false));
  CHECK_FALSE(ngn::controlledTextIsCurrent(3, 3, true));
}

TEST_CASE("newSelection applies a selection prop only when it is new, start before end") {
  ngn::DesktopTextInputProps none, first, same, other, backwards;
  first.selection = facebook::react::Selection{2, 5};
  same.selection = facebook::react::Selection{2, 5};
  other.selection = facebook::react::Selection{1, 1};
  backwards.selection = facebook::react::Selection{6, 3};
  CHECK_FALSE(ngn::newSelection(nullptr, none));
  CHECK(ngn::newSelection(nullptr, first) == std::make_pair(2, 5));
  CHECK(ngn::newSelection(&none, first) == std::make_pair(2, 5));
  // Unchanged: the user may have moved the selection since, which stays.
  CHECK_FALSE(ngn::newSelection(&first, same));
  CHECK(ngn::newSelection(&first, other) == std::make_pair(1, 1));
  CHECK(ngn::newSelection(&first, backwards) == std::make_pair(3, 6));
}
