// `<text-input>` on the desktop: React Native's iOS TextInput props with `smartQuotes` beside them,
// and the options a toolkit's field applies, resolved from them.
//
// React Native's TextInputProps is final, so DesktopTextInputProps repeats its few own members
// (traits and selection) over the shared BaseTextInputProps, and the TextInput component is
// React Native's BaseTextInputShadowNode over it: it measures and lays out as on iOS.
#pragma once

#include <react/renderer/components/iostextinput/primitives.h>
#include <react/renderer/components/textinput/BaseTextInputProps.h>
#include <react/renderer/components/textinput/BaseTextInputShadowNode.h>
#include <react/renderer/components/textinput/TextInputEventEmitter.h>
#include <react/renderer/components/textinput/TextInputState.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

#include <cstddef>
#include <optional>

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

// How much of an insertion of `inserted` units, replacing `replaced` of the field's `current`, fits
// in `maxLength`: all of it, a leading part, or none.
std::size_t insertionThatFits(
    std::size_t current,
    std::size_t replaced,
    std::size_t inserted,
    std::optional<std::size_t> maxLength);

} // namespace ngn
