// What assistive technology is told about a view, from React Native's accessibility props, in
// terms any desktop toolkit has: a role, a subrole that refines it, and a spoken role description
// for a role the toolkit lacks (a heading or an alert is a group described as one). The backend
// maps the role and subrole to its own (NSAccessibility on macOS).
#pragma once

#include <react/renderer/components/view/ViewProps.h>

#include <optional>
#include <string>

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
};

enum class AxSubrole { None, Switch, Toggle, Tab, SearchField };

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
  bool disabled{false};
  bool selected{false};
  // 0 unchecked, 1 checked, 2 mixed; nothing for a view that is not checkable.
  std::optional<int> checked;

  bool operator==(const AxInfo &other) const = default;
};

// The role name React Native goes by: `role` (ARIA) when set, else `accessibilityRole`.
std::string roleName(const facebook::react::ViewProps &props);

AxInfo accessibilityInfo(const facebook::react::ViewProps &props);

} // namespace ngn
