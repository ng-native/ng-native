#include "ngn/accessibility.h"
#include "ngn/desktop-props.h"

#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/components/view/accessibilityPropsConversions.h>
#include <react/renderer/core/ConcreteState.h>

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
      {"header", {AxRole::Heading, AxSubrole::None, "heading"}},
      {"heading", {AxRole::Heading, AxSubrole::None, "heading"}},
      {"meter", {AxRole::LevelIndicator}},
      {"tree", {AxRole::Outline}},
      {"treegrid", {AxRole::Outline}},
      {"treeitem", {AxRole::Row, AxSubrole::OutlineRow}},
      {"scrollview", {AxRole::ScrollArea}},
      {"horizontalscrollview", {AxRole::ScrollArea}},
      {"tabbar", {AxRole::TabGroup}},
      {"iconmenu", {AxRole::Menu}},
      {"keyboardkey", {AxRole::Button}},
      {"directory", {AxRole::List, AxSubrole::None, "directory"}},
      {"feed", {AxRole::List, AxSubrole::None, "feed"}},
      {"option", {AxRole::Row, AxSubrole::None, "option"}},
      {"columnheader", {AxRole::Cell, AxSubrole::None, "column header"}},
      {"rowheader", {AxRole::Cell, AxSubrole::None, "row header"}},
      {"term", {AxRole::StaticText, AxSubrole::None, "term"}},
      {"application", {AxRole::Group, AxSubrole::None, "application"}},
      {"article", {AxRole::Group, AxSubrole::None, "article"}},
      {"complementary", {AxRole::Group, AxSubrole::None, "complementary"}},
      {"contentinfo", {AxRole::Group, AxSubrole::None, "content information"}},
      {"definition", {AxRole::Group, AxSubrole::None, "definition"}},
      {"document", {AxRole::Group, AxSubrole::None, "document"}},
      {"figure", {AxRole::Group, AxSubrole::None, "figure"}},
      {"form", {AxRole::Group, AxSubrole::None, "form"}},
      {"log", {AxRole::Group, AxSubrole::None, "log"}},
      {"marquee", {AxRole::Group, AxSubrole::None, "marquee"}},
      {"math", {AxRole::Group, AxSubrole::None, "math"}},
      {"note", {AxRole::Group, AxSubrole::None, "note"}},
      {"region", {AxRole::Group, AxSubrole::None, "region"}},
      {"rowgroup", {AxRole::Group, AxSubrole::None, "row group"}},
      {"separator", {AxRole::Group, AxSubrole::None, "separator"}},
      {"tabpanel", {AxRole::Group, AxSubrole::None, "tab panel"}},
      {"pager", {AxRole::Group, AxSubrole::None, "pager"}},
      {"drawerlayout", {AxRole::Group, AxSubrole::None, "drawer"}},
      {"slidingdrawer", {AxRole::Group, AxSubrole::None, "drawer"}},
      {"webview", {AxRole::Group, AxSubrole::None, "web view"}},
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

// The roles that are one thing to read, whatever views draw them.
bool leafRole(AxRole role) {
  switch (role) {
    case AxRole::Button:
    case AxRole::Link:
    case AxRole::Image:
    case AxRole::StaticText:
    case AxRole::CheckBox:
    case AxRole::RadioButton:
    case AxRole::Slider:
    case AxRole::TextField:
    case AxRole::MenuItem:
    case AxRole::ProgressIndicator:
    case AxRole::ComboBox:
    case AxRole::Incrementor:
    case AxRole::Heading:
    case AxRole::LevelIndicator:
      return true;
    default:
      return false;
  }
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
  if (const auto *desktop = dynamic_cast<const HasDesktopProps *>(&props); desktop && info.role == AxRole::Heading) {
    info.level = desktop->desktop.accessibilityLevel;
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
  info.hidesChildren = info.element && (props.accessible || leafRole(info.role));
  return info;
}

AxInfo paragraphAccessibilityInfo(const ViewProps &props, const std::string &text) {
  auto info = accessibilityInfo(props);
  if (roleName(props).empty()) {
    info.role = AxRole::StaticText;
  }
  if (info.value.empty()) {
    info.value = text;
  }
  // A paragraph in another role (a heading, a link) is named by its text, as VoiceOver reads a
  // title rather than a value for those.
  if (info.role != AxRole::StaticText && info.label.empty()) {
    info.label = text;
  }
  bool hidden = props.accessibilityElementsHidden ||
      props.importantForAccessibility == ImportantForAccessibility::NoHideDescendants ||
      props.importantForAccessibility == ImportantForAccessibility::No;
  auto name = roleName(props);
  info.element = !hidden && name != "none" && name != "presentation" && (!text.empty() || !info.label.empty());
  // Its text is its own; anything under it (an inline view) is part of what it says.
  info.hidesChildren = info.element;
  return info;
}

std::string paragraphText(const ShadowView &view) {
  if (std::string_view(view.componentName) != "Paragraph" || !view.state) {
    return "";
  }
  return paragraphText(view.state);
}

std::string paragraphText(const State::Shared &state) {
  if (!state) {
    return "";
  }
  // A Paragraph's state is always ParagraphState (its component descriptor makes it).
  return std::static_pointer_cast<const ConcreteState<ParagraphState>>(state)->getData().attributedString.getString();
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
