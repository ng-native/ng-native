// `<text-input>` on the desktop: React Native's iOS TextInput props with `smartQuotes` beside them,
// and the options a toolkit's field applies, resolved from them.
//
// React Native's TextInputProps is final, so DesktopTextInputProps repeats its few own members
// (traits and selection) over the shared BaseTextInputProps, and the TextInput component is
// React Native's BaseTextInputShadowNode over it: it measures and lays out as on iOS.
#pragma once

#include "ngn/desktop-props.h"

#include <react/renderer/components/iostextinput/primitives.h>
#include <react/renderer/components/textinput/BaseTextInputProps.h>
#include <react/renderer/components/textinput/BaseTextInputShadowNode.h>
#include <react/renderer/components/textinput/TextInputEventEmitter.h>
#include <react/renderer/components/textinput/TextInputState.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

class DesktopTextInputProps final : public facebook::react::BaseTextInputProps {
 public:
  DesktopTextInputProps() = default;
  DesktopTextInputProps(
      const facebook::react::PropsParserContext &context,
      const DesktopTextInputProps &sourceProps,
      const facebook::react::RawProps &rawProps);

  facebook::react::TextInputTraits traits{};
  std::optional<facebook::react::Selection> selection{};
  // Curly quotes and em dashes as the user types. Unset follows `autoCorrect`.
  std::optional<bool> smartQuotes{};
  // `accessibilityDescribedBy` (`aria-describedby`), as a view's desktop props have it.
  std::vector<std::string> accessibilityDescribedBy;
  // `aria-required`, `aria-invalid` and the rest, as a view's desktop props have them.
  AriaFields aria;
  // `-webkit-font-smoothing`, as a Paragraph's desktop props have it.
  FontSmoothing fontSmoothing{FontSmoothing::Auto};
};

extern const char DesktopTextInputComponentName[];

class DesktopTextInputShadowNode final : public facebook::react::BaseTextInputShadowNode<
                                             DesktopTextInputComponentName,
                                             DesktopTextInputProps,
                                             facebook::react::TextInputEventEmitter,
                                             facebook::react::TextInputState> {
 public:
  using BaseTextInputShadowNode::BaseTextInputShadowNode;
};

class DesktopTextInputComponentDescriptor final
    : public facebook::react::ConcreteComponentDescriptor<DesktopTextInputShadowNode> {
 public:
  explicit DesktopTextInputComponentDescriptor(const facebook::react::ComponentDescriptorParameters &parameters)
      : ConcreteComponentDescriptor(parameters),
        textLayoutManager_(std::make_shared<facebook::react::TextLayoutManager>(contextContainer_)) {}

 protected:
  void adopt(facebook::react::ShadowNode &shadowNode) const override {
    ConcreteComponentDescriptor::adopt(shadowNode);
    static_cast<DesktopTextInputShadowNode &>(shadowNode).setTextLayoutManager(textLayoutManager_);
  }

 private:
  const std::shared_ptr<facebook::react::TextLayoutManager> textLayoutManager_;
};

// `autoCapitalize`.
enum class Capitalize { None, Sentences, Words, Characters };

// What a field applies. An unset switch leaves the user's system setting in charge.
struct TextInputOptions {
  std::optional<bool> autoCorrect;
  std::optional<bool> spellCheck;
  std::optional<bool> smartQuotes;
  std::optional<bool> smartInsertDelete;
  Capitalize capitalize{Capitalize::Sentences};
  bool secure{false};
  // In UTF-16 code units, as React Native counts. Unset is unlimited.
  std::optional<std::size_t> maxLength;

  bool operator==(const TextInputOptions &) const = default;
};

// React Native iOS's rules: `spellCheck` and `smartQuotes` follow `autoCorrect` when unset, and
// secure entry turns every substitution and check off and never capitalizes.
TextInputOptions textInputOptions(const DesktopTextInputProps &props);

// Where a field puts its text and placeholder, as React Native iOS has a TextInput's: Left, Right,
// Center or Justified. A TextInput's text attributes carry no layout direction, so an alignment that
// is set resolves as RCTResolveTextAlignment resolves a left-to-right fragment's (natural and start
// left, end right, left and right as they are). With none set, UIKit's natural alignment follows the
// view's direction, the layout's: right in a right-to-left layout, left otherwise.
facebook::react::TextAlignment inputAlignment(
    std::optional<facebook::react::TextAlignment> alignment,
    facebook::react::LayoutDirection layoutDirection);

// How much of an insertion of `inserted` units, replacing `replaced` of the field's `current`, fits
// in `maxLength`: all of it, a leading part, or none.
std::size_t insertionThatFits(
    std::size_t current,
    std::size_t replaced,
    std::size_t inserted,
    std::optional<std::size_t> maxLength);

// What a backend's text system knows that the core does not, over UTF-16 as the toolkits keep text:
// capitals in the user's locale, and where a character (a composed character sequence: a surrogate
// pair, a letter with its combining marks) starts.
class TextCharacters {
 public:
  virtual ~TextCharacters() = default;
  virtual std::u16string uppercase(const std::u16string &text) const = 0;
  // Where the character holding the unit at `index` starts, and how many units it has.
  virtual std::pair<std::size_t, std::size_t> characterAt(const std::u16string &text, std::size_t index) const = 0;
};

// Whether a UTF-16 unit is white space or a line break: what ends a word for `words`.
bool isTextSpace(char16_t unit);

// The text an edit puts in a field: `replacement`, replacing `length` units of `current` at
// `location`, capitalized as `autoCapitalize` asks (`characters`, all of it; `words`, each word's
// first character, a word starting at the start or after white space, pasted text too), then cut to
// what fits in `maxLength`, never inside a character.
std::u16string fitReplacement(
    const std::u16string &current,
    std::size_t location,
    std::size_t length,
    const std::u16string &replacement,
    const TextInputOptions &options,
    const TextCharacters &characters);

// React Native's controlled-text rule (iOS's mostRecentEventCount): the text JavaScript sends a
// field replaces what it shows only when it answers the field's latest change
// (`mostRecentEventCount` at least the field's own count), and never while an input method is
// composing.
bool controlledTextIsCurrent(int mostRecentEventCount, int fieldEventCount, bool composing);

// The `selection` prop as a field applies it, start before end in UTF-16 units, when it is new in
// `now` against `before` (null for a field just made): React Native iOS applies it only then, so
// the user moving the selection away is not undone by an unchanged prop.
std::optional<std::pair<int, int>> newSelection(const DesktopTextInputProps *before, const DesktopTextInputProps &now);

} // namespace ngn
