#include "ngn/accessibility.h"

#include <react/renderer/components/view/accessibilityPropsConversions.h>

#include <unordered_map>
#include <unordered_set>

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

// The roles a press means something on: AppKit's controls, which VoiceOver presses.
bool pressableRole(const std::string &name) {
  static const std::unordered_set<std::string> names{"button", "togglebutton", "link", "imagebutton", "checkbox",
      "switch", "radio", "tab", "menuitem", "combobox", "searchbox", "search"};
  return names.contains(name);
}

bool adjustableRole(const std::string &name) {
  return name == "adjustable" || name == "slider" || name == "spinbutton";
}

bool declares(const ViewProps &props, const std::string &action) {
  for (const auto &declared : props.accessibilityActions) {
    if (declared.name == action) {
      return true;
    }
  }
  return false;
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
  if (props.accessibilityState) {
    info.expanded = props.accessibilityState->expanded;
  }
  for (const auto &action : props.accessibilityActions) {
    const auto &n = action.name;
    if (n != "activate" && n != "increment" && n != "decrement" && n != "escape") {
      info.customActions.push_back({n, action.label.value_or(n)});
    }
  }
  info.offersPress = props.onAccessibilityTap || declares(props, "activate") || pressableRole(name);
  info.offersIncrement = adjustableRole(name) || declares(props, "increment") || declares(props, "decrement");
  info.offersCancel = props.onAccessibilityEscape || declares(props, "escape");
  bool hidden = props.accessibilityElementsHidden ||
      props.importantForAccessibility == ImportantForAccessibility::NoHideDescendants ||
      props.importantForAccessibility == ImportantForAccessibility::No;
  info.element = !hidden && !presentation && (props.accessible || !info.label.empty() || !name.empty());
  return info;
}

AxDispatch axDispatch(const ViewProps &props, AxVerb verb) {
  auto action = [&](const char *name) { return AxDispatch{AxDispatch::Kind::Action, name}; };
  bool actions = props.onAccessibilityAction;
  switch (verb) {
    case AxVerb::Press:
      if (props.onAccessibilityTap) {
        return {AxDispatch::Kind::Tap, ""};
      }
      if (actions && declares(props, "activate")) {
        return action("activate");
      }
      return {AxDispatch::Kind::Click, ""};
    case AxVerb::Increment:
      return actions ? action("increment") : AxDispatch{};
    case AxVerb::Decrement:
      return actions ? action("decrement") : AxDispatch{};
    case AxVerb::Cancel:
      if (props.onAccessibilityEscape) {
        return {AxDispatch::Kind::Escape, ""};
      }
      return actions && declares(props, "escape") ? action("escape") : AxDispatch{};
  }
  return {};
}

} // namespace ngn
