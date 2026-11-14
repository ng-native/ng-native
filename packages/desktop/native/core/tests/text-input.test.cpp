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
