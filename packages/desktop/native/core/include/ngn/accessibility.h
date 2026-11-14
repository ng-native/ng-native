// What assistive technology is told about a view, from React Native's accessibility props, in
// terms any desktop toolkit has: a role, a subrole that refines it, and a spoken role description
// for a role the toolkit lacks (a heading or an alert is a group described as one). The backend
// maps the role and subrole to its own (NSAccessibility on macOS).
#pragma once

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/mounting/ShadowView.h>

#include <optional>
#include <string>
#include <vector>

namespace ngn {

enum class AxRole {
  Group,
  Button,
  Link,
  Image,
  StaticText,
  CheckBox,
  RadioButton,
  RadioGroup,
  Slider,
  TextField,
  List,
  Menu,
  MenuItem,
  MenuBar,
  ProgressIndicator,
  ComboBox,
  TabGroup,
  Toolbar,
  ScrollBar,
  Table,
  Row,
  Cell,
  Incrementor,
  // AppKit's heading role from macOS 26; a group described as a heading before it.
  Heading,
  LevelIndicator,
  Outline,
  ScrollArea,
};

enum class AxSubrole { None, Switch, Toggle, Tab, SearchField, OutlineRow };

// A custom action an assistive technology lists by its label and sends back by its name.
struct AxAction {
  std::string name;
  std::string label;
  bool operator==(const AxAction &other) const = default;
};

struct AxInfo {
  // Whether the view is an element of its own, or its children are read in its place.
  bool element{false};
  AxRole role{AxRole::Group};
  AxSubrole subrole{AxSubrole::None};
  // Spoken in place of the toolkit's name for the role; empty for the toolkit's own.
  std::string roleDescription;
  std::string label;
  std::string hint;
  std::string value;
  // Whether the view is read as one element, its text and images part of it rather than elements
  // of their own: an `accessible` view, as on iOS, and a control or heading.
  bool hidesChildren{false};
  // A heading's level, from 1.
  std::optional<int> level;
  bool disabled{false};
  bool selected{false};
  // 0 unchecked, 1 checked, 2 mixed; nothing for a view that is not checkable.
  std::optional<int> checked;
  // Nothing for a view that neither expands nor collapses.
  std::optional<bool> expanded;
  // The declared actions AppKit has no verb of its own for, in their order.
  std::vector<AxAction> customActions;
  // Whether the view offers AppKit's press (VoiceOver's VO-Space), increment and decrement, and
  // cancel (Escape).
  bool offersPress{false};
  bool offersIncrement{false};
  bool offersCancel{false};

  bool operator==(const AxInfo &other) const = default;
};

// The role name React Native goes by: `role` (ARIA) when set, else `accessibilityRole`.
std::string roleName(const facebook::react::ViewProps &props);

AxInfo accessibilityInfo(const facebook::react::ViewProps &props);

// A Paragraph's: static text whose value is the string it shows, unless a role says otherwise, and
// an element only when it says something.
AxInfo paragraphAccessibilityInfo(const facebook::react::ViewProps &props, const std::string &text);

// The string a Paragraph shows, from its state; empty for any other view.
std::string paragraphText(const facebook::react::ShadowView &view);
// The same from a Paragraph's state.
std::string paragraphText(const facebook::react::State::Shared &state);

// AppKit's standard actions on a view.
enum class AxVerb { Press, Increment, Decrement, Cancel };

// What one of them sends, as React Native iOS decides: its accessibility tap or escape when the
// view listens, a declared action (`activate`, `increment`, `decrement`, `escape`) when the view
// listens for actions, and for a press with neither, a click (iOS's synthesized tap).
struct AxDispatch {
  enum class Kind { None, Tap, Escape, Action, Click } kind{Kind::None};
  std::string action;
};

AxDispatch axDispatch(const facebook::react::ViewProps &props, AxVerb verb);

} // namespace ngn
