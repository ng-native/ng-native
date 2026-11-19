#include "accessible.h"

#include "text-field.h"
#include "view-widget.h"

#include "ngn/native-controls.h"

#include <react/renderer/components/view/ViewProps.h>

#include <dlfcn.h>

#include <string_view>

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

GtkAccessibleRole accessibleRole(const facebook::react::ShadowView &view) {
  auto props = std::dynamic_pointer_cast<const facebook::react::ViewProps>(view.props);
  auto info = accessibilityOf(view);
  // A native control's GTK widget is the accessible element, with its own role and state, as
  // AppKit's control is on macOS: the view holding it is not one too. So is a text input's field,
  // a text box with the label.
  if (!props || !info || controlKind(view.componentName) || std::string_view(view.componentName) == "TextInput") {
    return GTK_ACCESSIBLE_ROLE_GENERIC;
  }
  return gtkRole(ariaRole(roleName(*props), *info));
}

GtkAccessibleRole gtkRole(AriaRole role) {
  switch (role) {
    case AriaRole::Generic: return GTK_ACCESSIBLE_ROLE_GENERIC;
    case AriaRole::None: return GTK_ACCESSIBLE_ROLE_NONE;
    case AriaRole::Presentation: return GTK_ACCESSIBLE_ROLE_PRESENTATION;
    case AriaRole::Alert: return GTK_ACCESSIBLE_ROLE_ALERT;
    case AriaRole::AlertDialog: return GTK_ACCESSIBLE_ROLE_ALERT_DIALOG;
    case AriaRole::Banner: return GTK_ACCESSIBLE_ROLE_BANNER;
    case AriaRole::Button: return GTK_ACCESSIBLE_ROLE_BUTTON;
    case AriaRole::Cell: return GTK_ACCESSIBLE_ROLE_CELL;
    case AriaRole::Checkbox: return GTK_ACCESSIBLE_ROLE_CHECKBOX;
    case AriaRole::ColumnHeader: return GTK_ACCESSIBLE_ROLE_COLUMN_HEADER;
    case AriaRole::ComboBox: return GTK_ACCESSIBLE_ROLE_COMBO_BOX;
    case AriaRole::Dialog: return GTK_ACCESSIBLE_ROLE_DIALOG;
    case AriaRole::Document: return GTK_ACCESSIBLE_ROLE_DOCUMENT;
    case AriaRole::Feed: return GTK_ACCESSIBLE_ROLE_FEED;
    case AriaRole::Form: return GTK_ACCESSIBLE_ROLE_FORM;
    case AriaRole::Grid: return GTK_ACCESSIBLE_ROLE_GRID;
    case AriaRole::GridCell: return GTK_ACCESSIBLE_ROLE_GRID_CELL;
    case AriaRole::Group: return GTK_ACCESSIBLE_ROLE_GROUP;
    case AriaRole::Heading: return GTK_ACCESSIBLE_ROLE_HEADING;
    case AriaRole::Img: return GTK_ACCESSIBLE_ROLE_IMG;
    case AriaRole::Label: return GTK_ACCESSIBLE_ROLE_LABEL;
    case AriaRole::Link: return GTK_ACCESSIBLE_ROLE_LINK;
    case AriaRole::List: return GTK_ACCESSIBLE_ROLE_LIST;
    case AriaRole::ListBox: return GTK_ACCESSIBLE_ROLE_LIST_BOX;
    case AriaRole::ListItem: return GTK_ACCESSIBLE_ROLE_LIST_ITEM;
    case AriaRole::Log: return GTK_ACCESSIBLE_ROLE_LOG;
    case AriaRole::Main: return GTK_ACCESSIBLE_ROLE_MAIN;
    case AriaRole::Marquee: return GTK_ACCESSIBLE_ROLE_MARQUEE;
    case AriaRole::Math: return GTK_ACCESSIBLE_ROLE_MATH;
    case AriaRole::Menu: return GTK_ACCESSIBLE_ROLE_MENU;
    case AriaRole::MenuBar: return GTK_ACCESSIBLE_ROLE_MENU_BAR;
    case AriaRole::MenuItem: return GTK_ACCESSIBLE_ROLE_MENU_ITEM;
    case AriaRole::MenuItemCheckbox: return GTK_ACCESSIBLE_ROLE_MENU_ITEM_CHECKBOX;
    case AriaRole::MenuItemRadio: return GTK_ACCESSIBLE_ROLE_MENU_ITEM_RADIO;
    case AriaRole::Meter: return GTK_ACCESSIBLE_ROLE_METER;
    case AriaRole::Navigation: return GTK_ACCESSIBLE_ROLE_NAVIGATION;
    case AriaRole::Note: return GTK_ACCESSIBLE_ROLE_NOTE;
    case AriaRole::Option: return GTK_ACCESSIBLE_ROLE_OPTION;
    case AriaRole::ProgressBar: return GTK_ACCESSIBLE_ROLE_PROGRESS_BAR;
    case AriaRole::Radio: return GTK_ACCESSIBLE_ROLE_RADIO;
    case AriaRole::RadioGroup: return GTK_ACCESSIBLE_ROLE_RADIO_GROUP;
    case AriaRole::Region: return GTK_ACCESSIBLE_ROLE_REGION;
    case AriaRole::Row: return GTK_ACCESSIBLE_ROLE_ROW;
    case AriaRole::RowGroup: return GTK_ACCESSIBLE_ROLE_ROW_GROUP;
    case AriaRole::RowHeader: return GTK_ACCESSIBLE_ROLE_ROW_HEADER;
    case AriaRole::Scrollbar: return GTK_ACCESSIBLE_ROLE_SCROLLBAR;
    case AriaRole::SearchBox: return GTK_ACCESSIBLE_ROLE_SEARCH_BOX;
    case AriaRole::Separator: return GTK_ACCESSIBLE_ROLE_SEPARATOR;
    case AriaRole::Slider: return GTK_ACCESSIBLE_ROLE_SLIDER;
    case AriaRole::SpinButton: return GTK_ACCESSIBLE_ROLE_SPIN_BUTTON;
    case AriaRole::Status: return GTK_ACCESSIBLE_ROLE_STATUS;
    case AriaRole::Switch: return GTK_ACCESSIBLE_ROLE_SWITCH;
    case AriaRole::Tab: return GTK_ACCESSIBLE_ROLE_TAB;
    case AriaRole::TabList: return GTK_ACCESSIBLE_ROLE_TAB_LIST;
    case AriaRole::TabPanel: return GTK_ACCESSIBLE_ROLE_TAB_PANEL;
    case AriaRole::Table: return GTK_ACCESSIBLE_ROLE_TABLE;
    case AriaRole::Timer: return GTK_ACCESSIBLE_ROLE_TIMER;
    case AriaRole::ToggleButton: return GTK_ACCESSIBLE_ROLE_TOGGLE_BUTTON;
    case AriaRole::Toolbar: return GTK_ACCESSIBLE_ROLE_TOOLBAR;
    case AriaRole::Tooltip: return GTK_ACCESSIBLE_ROLE_TOOLTIP;
    case AriaRole::Tree: return GTK_ACCESSIBLE_ROLE_TREE;
    case AriaRole::TreeGrid: return GTK_ACCESSIBLE_ROLE_TREE_GRID;
    case AriaRole::TreeItem: return GTK_ACCESSIBLE_ROLE_TREE_ITEM;
    // GTK 4.14's ARTICLE is past the 4.10 floor the host builds against.
    case AriaRole::Article: return GTK_ACCESSIBLE_ROLE_GROUP;
  }
  return GTK_ACCESSIBLE_ROLE_GENERIC;
}

GtkWidget *accessibleWidget(const ViewData &view) {
  return view.field ? fieldWidget(*view.field) : view.widget;
}

namespace {

struct AxActions {
  GSimpleActionGroup *group{nullptr};
  std::function<bool(GtkWidget *, AxVerb)> perform;
};

constexpr std::pair<const char *, AxVerb> kVerbs[] = {
    {"press", AxVerb::Press}, {"increment", AxVerb::Increment}, {"decrement", AxVerb::Decrement}, {"cancel", AxVerb::Cancel}};

} // namespace

void applyAccessibleActions(GtkWidget *widget, const AxInfo &info, std::function<bool(GtkWidget *, AxVerb)> perform) {
  auto *actions = static_cast<AxActions *>(g_object_get_data(G_OBJECT(widget), "ngn-ax-actions"));
  bool offers = info.element && !info.disabled && (info.offersPress || info.offersIncrement || info.offersCancel);
  if (!actions && !offers) {
    return;
  }
  if (!actions) {
    actions = new AxActions{g_simple_action_group_new(), std::move(perform)};
    for (const auto &[name, verb] : kVerbs) {
      GSimpleAction *action = g_simple_action_new(name, nullptr);
      g_signal_connect(action, "activate", G_CALLBACK(+[](GSimpleAction *self, GVariant *, gpointer data) {
        auto *widget = static_cast<GtkWidget *>(data);
        auto *actions = static_cast<AxActions *>(g_object_get_data(G_OBJECT(widget), "ngn-ax-actions"));
        const char *name = g_action_get_name(G_ACTION(self));
        for (const auto &[verbName, verb] : kVerbs) {
          if (actions && std::string_view(name) == verbName) {
            actions->perform(widget, verb);
          }
        }
      }), widget);
      g_action_map_add_action(G_ACTION_MAP(actions->group), G_ACTION(action));
      g_object_unref(action);
    }
    gtk_widget_insert_action_group(widget, "accessibility", G_ACTION_GROUP(actions->group));
    g_object_set_data_full(G_OBJECT(widget), "ngn-ax-actions", actions, +[](gpointer data) {
      auto *a = static_cast<AxActions *>(data);
      g_object_unref(a->group);
      delete a;
    });
  }
  auto enable = [actions](const char *name, bool on) {
    g_simple_action_set_enabled(G_SIMPLE_ACTION(g_action_map_lookup_action(G_ACTION_MAP(actions->group), name)), on);
  };
  // GTK checks the widget's sensitivity, not the accessible disabled state, so a disabled view
  // offers no action of its own accord.
  bool live = info.element && !info.disabled;
  enable("press", live && info.offersPress);
  enable("increment", live && info.offersIncrement);
  enable("decrement", live && info.offersIncrement);
  enable("cancel", live && info.offersCancel);
}

bool announceOn(GtkWidget *widget, const Announcement &announcement) {
  using Announce = void (*)(GtkAccessible *, const char *, int);
  static auto announce = reinterpret_cast<Announce>(dlsym(RTLD_DEFAULT, "gtk_accessible_announce"));
  if (!announce || !widget || announcement.text.empty()) {
    return false;
  }
  // GtkAccessibleAnnouncementPriority: LOW, MEDIUM, HIGH, one to one.
  int priority = announcement.priority == AnnouncementPriority::Low ? 0 : announcement.priority == AnnouncementPriority::Medium ? 1 : 2;
  announce(GTK_ACCESSIBLE(widget), announcement.text.c_str(), priority);
  return true;
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
  // Static text is named by what it says, which the core reads as its value (as VoiceOver reads a
  // text's): AT-SPI's name is what Orca speaks, and a label has no value.
  bool namedByValue = info.role == AxRole::StaticText && info.label.empty();
  text(GTK_ACCESSIBLE_PROPERTY_LABEL, namedByValue ? info.value : info.label);
  text(GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, info.hint);
  text(GTK_ACCESSIBLE_PROPERTY_VALUE_TEXT, namedByValue ? std::string() : info.value);
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
  if (info.required) {
    gtk_accessible_update_property(accessible, GTK_ACCESSIBLE_PROPERTY_REQUIRED, TRUE, -1);
  } else {
    gtk_accessible_reset_property(accessible, GTK_ACCESSIBLE_PROPERTY_REQUIRED);
  }
  if (info.invalid) {
    gtk_accessible_update_state(accessible, GTK_ACCESSIBLE_STATE_INVALID, GTK_ACCESSIBLE_INVALID_TRUE, -1);
  } else {
    gtk_accessible_reset_state(accessible, GTK_ACCESSIBLE_STATE_INVALID);
  }
  // GTK has an item's place in its set and a grid's counts as integer relations.
  auto count = [accessible](GtkAccessibleRelation relation, std::optional<int> value) {
    if (value) {
      gtk_accessible_update_relation(accessible, relation, *value, -1);
    } else {
      gtk_accessible_reset_relation(accessible, relation);
    }
  };
  count(GTK_ACCESSIBLE_RELATION_POS_IN_SET, info.positionInSet);
  count(GTK_ACCESSIBLE_RELATION_SET_SIZE, info.setSize);
  count(GTK_ACCESSIBLE_RELATION_ROW_COUNT, info.rowCount);
  count(GTK_ACCESSIBLE_RELATION_COL_COUNT, info.columnCount);
}

} // namespace ngn::gtk
