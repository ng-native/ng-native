#include "ngn/accessibility.h"

#include <react/renderer/components/view/accessibilityPropsConversions.h>

#include <unordered_map>

using namespace facebook::react;

namespace ngn {

namespace {

struct Mapping {
  AxRole role;
  AxSubrole subrole{AxSubrole::None};
  // For a role the toolkit has no equivalent of.
  const char *description{""};
};

// React Native's accessibilityRole values and the ARIA roles `role` takes, as AppKit has them.
// A role with no AppKit counterpart is a group that says what it is.
const std::unordered_map<std::string, Mapping> &roles() {
  static const std::unordered_map<std::string, Mapping> table{
      {"button", {AxRole::Button}},
      {"togglebutton", {AxRole::CheckBox, AxSubrole::Toggle}},
      {"link", {AxRole::Link}},
      {"image", {AxRole::Image}},
      {"img", {AxRole::Image}},
      {"imagebutton", {AxRole::Button}},
      {"text", {AxRole::StaticText}},
      {"checkbox", {AxRole::CheckBox}},
      {"switch", {AxRole::CheckBox, AxSubrole::Switch}},
      {"radio", {AxRole::RadioButton}},
      {"radiogroup", {AxRole::RadioGroup}},
      {"adjustable", {AxRole::Slider}},
      {"slider", {AxRole::Slider}},
      {"search", {AxRole::TextField, AxSubrole::SearchField}},
      {"searchbox", {AxRole::TextField, AxSubrole::SearchField}},
      {"list", {AxRole::List}},
      {"menu", {AxRole::Menu}},
      {"menuitem", {AxRole::MenuItem}},
      {"menubar", {AxRole::MenuBar}},
      {"progressbar", {AxRole::ProgressIndicator}},
      {"combobox", {AxRole::ComboBox}},
      {"tablist", {AxRole::TabGroup}},
      {"tab", {AxRole::RadioButton, AxSubrole::Tab}},
      {"toolbar", {AxRole::Toolbar}},
      {"scrollbar", {AxRole::ScrollBar}},
      {"grid", {AxRole::Table}},
      {"table", {AxRole::Table}},
      {"row", {AxRole::Row}},
      {"cell", {AxRole::Cell}},
      {"spinbutton", {AxRole::Incrementor}},
      {"header", {AxRole::Group, AxSubrole::None, "heading"}},
      {"heading", {AxRole::Group, AxSubrole::None, "heading"}},
      {"alert", {AxRole::Group, AxSubrole::None, "alert"}},
      {"alertdialog", {AxRole::Group, AxSubrole::None, "alert dialog"}},
      {"dialog", {AxRole::Group, AxSubrole::None, "dialog"}},
      {"listitem", {AxRole::Group, AxSubrole::None, "list item"}},
      {"navigation", {AxRole::Group, AxSubrole::None, "navigation"}},
      {"main", {AxRole::Group, AxSubrole::None, "main"}},
      {"banner", {AxRole::Group, AxSubrole::None, "banner"}},
      {"summary", {AxRole::Group, AxSubrole::None, "summary"}},
      {"timer", {AxRole::Group, AxSubrole::None, "timer"}},
      {"status", {AxRole::Group, AxSubrole::None, "status"}},
      {"tooltip", {AxRole::Group, AxSubrole::None, "tooltip"}},
  };
  return table;
}

} // namespace

std::string roleName(const ViewProps &props) {
  if (props.role != Role::None) {
    return toString(props.role);
  }
  return props.accessibilityRole;
}

AxInfo accessibilityInfo(const ViewProps &props) {
  AxInfo info;
  auto name = roleName(props);
  bool presentation = name == "none" || name == "presentation";
  if (auto it = roles().find(name); it != roles().end()) {
    info.role = it->second.role;
    info.subrole = it->second.subrole;
    info.roleDescription = it->second.description;
  }
  info.label = props.accessibilityLabel;
  info.hint = props.accessibilityHint;
  if (props.accessibilityValue.text) {
    info.value = *props.accessibilityValue.text;
  } else if (props.accessibilityValue.now) {
    info.value = std::to_string(*props.accessibilityValue.now);
  }
  if (const auto &state = props.accessibilityState) {
    info.disabled = state->disabled;
    info.selected = state->selected;
    switch (state->checked) {
      case AccessibilityState::Unchecked:
        info.checked = 0;
        break;
      case AccessibilityState::Checked:
        info.checked = 1;
        break;
      case AccessibilityState::Mixed:
        info.checked = 2;
        break;
      case AccessibilityState::None:
        break;
    }
  }
  bool hidden = props.accessibilityElementsHidden ||
      props.importantForAccessibility == ImportantForAccessibility::NoHideDescendants ||
      props.importantForAccessibility == ImportantForAccessibility::No;
  info.element = !hidden && !presentation && (props.accessible || !info.label.empty() || !name.empty());
  return info;
}

} // namespace ngn
