#include "accessible.h"

#include <react/renderer/components/view/ViewProps.h>

namespace ngn::gtk {

std::optional<AxInfo> accessibilityOf(const facebook::react::ShadowView &view) {
  auto props = std::dynamic_pointer_cast<const facebook::react::ViewProps>(view.props);
  if (!props) {
    return std::nullopt;
  }
  if (view.componentName == std::string("Paragraph")) {
    return paragraphAccessibilityInfo(*props, paragraphText(view.state));
  }
  return accessibilityInfo(*props);
}

GtkAccessibleRole accessibleRole(const AxInfo &info) {
  if (!info.element) {
    return GTK_ACCESSIBLE_ROLE_GENERIC;
  }
  switch (info.role) {
    case AxRole::Group: return GTK_ACCESSIBLE_ROLE_GROUP;
    case AxRole::Button:
      if (info.subrole == AxSubrole::Switch) {
        return GTK_ACCESSIBLE_ROLE_SWITCH;
      }
      return info.subrole == AxSubrole::Tab ? GTK_ACCESSIBLE_ROLE_TAB : GTK_ACCESSIBLE_ROLE_BUTTON;
    case AxRole::Link: return GTK_ACCESSIBLE_ROLE_LINK;
    case AxRole::Image: return GTK_ACCESSIBLE_ROLE_IMG;
    case AxRole::StaticText: return GTK_ACCESSIBLE_ROLE_LABEL;
    case AxRole::CheckBox: return info.subrole == AxSubrole::Switch ? GTK_ACCESSIBLE_ROLE_SWITCH : GTK_ACCESSIBLE_ROLE_CHECKBOX;
    case AxRole::RadioButton: return info.subrole == AxSubrole::Tab ? GTK_ACCESSIBLE_ROLE_TAB : GTK_ACCESSIBLE_ROLE_RADIO;
    case AxRole::RadioGroup: return GTK_ACCESSIBLE_ROLE_RADIO_GROUP;
    case AxRole::Slider: return GTK_ACCESSIBLE_ROLE_SLIDER;
    case AxRole::TextField: return info.subrole == AxSubrole::SearchField ? GTK_ACCESSIBLE_ROLE_SEARCH_BOX : GTK_ACCESSIBLE_ROLE_TEXT_BOX;
    case AxRole::List: return GTK_ACCESSIBLE_ROLE_LIST;
    case AxRole::Menu: return GTK_ACCESSIBLE_ROLE_MENU;
    case AxRole::MenuItem: return GTK_ACCESSIBLE_ROLE_MENU_ITEM;
    case AxRole::MenuBar: return GTK_ACCESSIBLE_ROLE_MENU_BAR;
    case AxRole::ProgressIndicator: return GTK_ACCESSIBLE_ROLE_PROGRESS_BAR;
    case AxRole::ComboBox: return GTK_ACCESSIBLE_ROLE_COMBO_BOX;
    case AxRole::TabGroup: return GTK_ACCESSIBLE_ROLE_TAB_LIST;
    case AxRole::Toolbar: return GTK_ACCESSIBLE_ROLE_TOOLBAR;
    case AxRole::ScrollBar: return GTK_ACCESSIBLE_ROLE_SCROLLBAR;
    case AxRole::Table: return GTK_ACCESSIBLE_ROLE_GRID;
    case AxRole::Row: return GTK_ACCESSIBLE_ROLE_ROW;
    case AxRole::Cell: return GTK_ACCESSIBLE_ROLE_GRID_CELL;
    case AxRole::Incrementor: return GTK_ACCESSIBLE_ROLE_SPIN_BUTTON;
    case AxRole::Heading: return GTK_ACCESSIBLE_ROLE_HEADING;
    case AxRole::LevelIndicator: return GTK_ACCESSIBLE_ROLE_METER;
    case AxRole::Outline: return GTK_ACCESSIBLE_ROLE_TREE_GRID;
    case AxRole::ScrollArea: return GTK_ACCESSIBLE_ROLE_GROUP;
  }
  return GTK_ACCESSIBLE_ROLE_GROUP;
}

void applyAccessibility(GtkWidget *widget, const AxInfo &info) {
  GtkAccessible *accessible = GTK_ACCESSIBLE(widget);
  auto text = [accessible](GtkAccessibleProperty property, const std::string &value) {
    if (value.empty()) {
      gtk_accessible_reset_property(accessible, property);
    } else {
      gtk_accessible_update_property(accessible, property, value.c_str(), -1);
    }
  };
  text(GTK_ACCESSIBLE_PROPERTY_LABEL, info.label);
  text(GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, info.hint);
  text(GTK_ACCESSIBLE_PROPERTY_VALUE_TEXT, info.value);
  text(GTK_ACCESSIBLE_PROPERTY_ROLE_DESCRIPTION, info.roleDescription);
  if (info.level) {
    gtk_accessible_update_property(accessible, GTK_ACCESSIBLE_PROPERTY_LEVEL, *info.level, -1);
  } else {
    gtk_accessible_reset_property(accessible, GTK_ACCESSIBLE_PROPERTY_LEVEL);
  }
  gtk_accessible_update_state(accessible, GTK_ACCESSIBLE_STATE_DISABLED, info.disabled, GTK_ACCESSIBLE_STATE_SELECTED, info.selected, -1);
  if (info.checked) {
    auto state = *info.checked == 2 ? GTK_ACCESSIBLE_TRISTATE_MIXED : *info.checked == 1 ? GTK_ACCESSIBLE_TRISTATE_TRUE : GTK_ACCESSIBLE_TRISTATE_FALSE;
    gtk_accessible_update_state(accessible, GTK_ACCESSIBLE_STATE_CHECKED, state, -1);
  } else {
    gtk_accessible_reset_state(accessible, GTK_ACCESSIBLE_STATE_CHECKED);
  }
  if (info.expanded) {
    gtk_accessible_update_state(accessible, GTK_ACCESSIBLE_STATE_EXPANDED, *info.expanded ? TRUE : FALSE, -1);
  } else {
    gtk_accessible_reset_state(accessible, GTK_ACCESSIBLE_STATE_EXPANDED);
  }
}

} // namespace ngn::gtk
