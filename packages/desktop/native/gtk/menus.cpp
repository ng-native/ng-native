#include "menus.h"

#include "app-windows.h"
#include "screens.h"

#include <algorithm>
#include <cstring>
#include <map>
#include <string>

namespace ngn::gtk {

namespace {

// GDK's names for the keys the web names otherwise, both ways.
const std::map<std::string, guint> &namedKeys() {
  static const std::map<std::string, guint> keys{
      {"ArrowLeft", GDK_KEY_Left}, {"ArrowRight", GDK_KEY_Right}, {"ArrowUp", GDK_KEY_Up}, {"ArrowDown", GDK_KEY_Down},
      {"Enter", GDK_KEY_Return}, {"Escape", GDK_KEY_Escape}, {"Backspace", GDK_KEY_BackSpace}, {"Delete", GDK_KEY_Delete},
      {"Tab", GDK_KEY_Tab}, {"Home", GDK_KEY_Home}, {"End", GDK_KEY_End}, {"PageUp", GDK_KEY_Page_Up},
      {"PageDown", GDK_KEY_Page_Down}, {"F1", GDK_KEY_F1}, {"F2", GDK_KEY_F2}, {"F3", GDK_KEY_F3}, {"F4", GDK_KEY_F4},
      {"F5", GDK_KEY_F5}, {"F6", GDK_KEY_F6}, {"F7", GDK_KEY_F7}, {"F8", GDK_KEY_F8}, {"F9", GDK_KEY_F9},
      {"F10", GDK_KEY_F10}, {"F11", GDK_KEY_F11}, {"F12", GDK_KEY_F12},
  };
  return keys;
}

const char *webName(guint keyval) {
  switch (keyval) {
    case GDK_KEY_KP_Enter:
      return "Enter";
    case GDK_KEY_ISO_Left_Tab:
      return "Tab";
  }
  for (const auto &[name, value] : namedKeys()) {
    if (value == keyval) {
      return name.c_str();
    }
  }
  return nullptr;
}

std::string actionName(int index) {
  return "item-" + std::to_string(index);
}

struct Chosen {
  MenuItem item;
  std::function<void(const MenuItem &)> chosen;
};

void addItems(GMenu *menu, const std::vector<MenuItem> &items, GSimpleActionGroup *group, const std::function<void(const MenuItem &)> &chosen, int &next) {
  GMenu *section = g_menu_new();
  auto flush = [&] {
    if (g_menu_model_get_n_items(G_MENU_MODEL(section)) > 0) {
      g_menu_append_section(menu, nullptr, G_MENU_MODEL(section));
      g_object_unref(section);
      section = g_menu_new();
    }
  };
  for (const auto &item : items) {
    if (item.separator) {
      flush();
      continue;
    }
    // A menu with nothing in it, such as the Window menu AppKit fills, which GTK has no list for.
    if (item.items.empty() && item.command == MenuCommand::None) {
      continue;
    }
    if (!item.items.empty()) {
      GMenu *sub = g_menu_new();
      addItems(sub, item.items, group, chosen, next);
      if (item.inlineItems) {
        flush();
        g_menu_append_section(menu, nullptr, G_MENU_MODEL(sub));
      } else {
        g_menu_append_submenu(section, item.title.c_str(), G_MENU_MODEL(sub));
      }
      g_object_unref(sub);
      continue;
    }
    std::string name = actionName(next++);
    GSimpleAction *action = item.checked ? g_simple_action_new_stateful(name.c_str(), nullptr, g_variant_new_boolean(TRUE))
                                         : g_simple_action_new(name.c_str(), nullptr);
    g_simple_action_set_enabled(action, !item.disabled);
    g_signal_connect_data(
        action, item.checked ? "change-state" : "activate", G_CALLBACK(+[](GSimpleAction *, GVariant *, gpointer data) {
          auto *c = static_cast<Chosen *>(data);
          c->chosen(c->item);
        }),
        new Chosen{item, chosen}, [](gpointer data, GClosure *) { delete static_cast<Chosen *>(data); }, GConnectFlags(0));
    g_action_map_add_action(G_ACTION_MAP(group), G_ACTION(action));
    g_object_unref(action);
    GMenuItem *entry = g_menu_item_new(item.title.c_str(), ("menu." + name).c_str());
    if (auto accel = acceleratorOf(item); !accel.empty()) {
      g_menu_item_set_attribute(entry, "accel", "s", accel.c_str());
    }
    g_menu_append_item(section, entry);
    g_object_unref(entry);
  }
  flush();
  g_object_unref(section);
}

// A button kind's role for the window's keys, set by native-controls.cpp as "default" or "cancel".
GtkWidget *findKeyButton(GtkWidget *widget, const char *role) {
  if (!gtk_widget_get_mapped(widget) || !gtk_widget_is_sensitive(widget)) {
    return nullptr;
  }
  if (const char *kind = static_cast<const char *>(g_object_get_data(G_OBJECT(widget), "ngn-key-role")); kind && std::strcmp(kind, role) == 0) {
    return widget;
  }
  for (GtkWidget *child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) {
    if (GtkWidget *found = findKeyButton(child, role)) {
      return found;
    }
  }
  return nullptr;
}

} // namespace

KeyChord chordOf(guint keyval, GdkModifierType state) {
  KeyChord chord;
  if (const char *name = webName(keyval)) {
    chord.key = name;
  } else if (gunichar c = gdk_keyval_to_unicode(keyval); c != 0) {
    char text[8] = {};
    g_unichar_to_utf8(c, text);
    chord.key = text;
  }
  if (state & GDK_CONTROL_MASK) chord.modifiers |= Control;
  if (state & GDK_SHIFT_MASK) chord.modifiers |= Shift;
  if (state & GDK_ALT_MASK) chord.modifiers |= Option;
  return chord;
}

std::string acceleratorOf(const MenuItem &item) {
  if (item.key.empty()) {
    return {};
  }
  guint keyval = 0;
  if (auto named = namedKeys().find(item.key); named != namedKeys().end()) {
    keyval = named->second;
  } else {
    keyval = gdk_unicode_to_keyval(g_utf8_get_char(item.key.c_str()));
  }
  unsigned state = 0;
  if (item.modifiers & (Control | Command)) state |= GDK_CONTROL_MASK;
  if (item.modifiers & Shift) state |= GDK_SHIFT_MASK;
  if (item.modifiers & Option) state |= GDK_ALT_MASK;
  gchar *name = gtk_accelerator_name(gdk_keyval_to_lower(keyval), static_cast<GdkModifierType>(state));
  std::string out = name ? name : "";
  g_free(name);
  return out;
}

GMenuModel *buildMenu(const std::vector<MenuItem> &items, GSimpleActionGroup *group, std::function<void(const MenuItem &)> chosen) {
  GMenu *menu = g_menu_new();
  int next = 0;
  addItems(menu, items, group, chosen, next);
  return G_MENU_MODEL(menu);
}

GtkMenus::GtkMenus(std::function<void(const MenuItem &item)> chosen) : chosen_(std::move(chosen)) {}

GtkMenus::~GtkMenus() {
  for (auto &slot : slots_) {
    if (*slot) {
      g_object_remove_weak_pointer(G_OBJECT(*slot), reinterpret_cast<gpointer *>(slot.get()));
    }
  }
  g_clear_object(&model_);
  g_clear_object(&actions_);
}

void GtkMenus::setMenuBar(std::vector<MenuItem> bar) {
  onMainContext([this, bar = std::move(bar)]() mutable {
    bar_ = std::move(bar);
    g_clear_object(&model_);
    g_clear_object(&actions_);
    actions_ = g_simple_action_group_new();
    model_ = buildMenu(bar_, actions_, chosen_);
    for (auto &slot : slots_) {
      if (*slot) {
        show(*slot);
      }
    }
  });
}

void GtkMenus::attach(GtkWidget *surface) {
  const WindowChrome *chrome = chromeOf(surface);
  if (!chrome) {
    return;
  }
  GtkWidget *slot = chrome->menuBar ? chrome->menuBar : chrome->primaryMenu;
  if (!slot) {
    return;
  }
  // The slots of windows that have gone.
  std::erase_if(slots_, [](const std::unique_ptr<GtkWidget *> &held) { return *held == nullptr; });
  auto held = std::make_unique<GtkWidget *>(slot);
  g_object_add_weak_pointer(G_OBJECT(slot), reinterpret_cast<gpointer *>(held.get()));
  slots_.push_back(std::move(held));
  if (model_) {
    show(slot);
  }
}

void GtkMenus::show(GtkWidget *slot) {
  if (GTK_IS_POPOVER_MENU_BAR(slot)) {
    gtk_popover_menu_bar_set_menu_model(GTK_POPOVER_MENU_BAR(slot), model_);
  } else {
    gtk_menu_button_set_menu_model(GTK_MENU_BUTTON(slot), model_);
  }
  // The items' actions are the window's `menu` group, so each window's slot reaches them.
  if (GtkRoot *root = gtk_widget_get_root(slot)) {
    gtk_widget_insert_action_group(GTK_WIDGET(root), "menu", G_ACTION_GROUP(actions_));
  }
  gtk_widget_set_visible(slot, model_ != nullptr && g_menu_model_get_n_items(model_) > 0);
}

bool popUpContextMenu(GtkWidget *widget, facebook::react::Point point, const std::vector<MenuItem> &items, std::function<void(const MenuItem &)> chosen) {
  if (items.empty()) {
    return false;
  }
  GSimpleActionGroup *group = g_simple_action_group_new();
  GMenuModel *model = buildMenu(items, group, std::move(chosen));
  GtkWidget *popover = gtk_popover_menu_new_from_model(model);
  g_object_unref(model);
  gtk_widget_insert_action_group(popover, "menu", G_ACTION_GROUP(group));
  g_object_unref(group);
  gtk_widget_set_parent(popover, widget);
  gtk_popover_set_has_arrow(GTK_POPOVER(popover), FALSE);
  gtk_widget_set_halign(popover, gtk_widget_get_direction(widget) == GTK_TEXT_DIR_RTL ? GTK_ALIGN_END : GTK_ALIGN_START);
  GdkRectangle at{static_cast<int>(point.x), static_cast<int>(point.y), 1, 1};
  gtk_popover_set_pointing_to(GTK_POPOVER(popover), &at);
  // It goes once closed, after the item chosen has run.
  // Held until then, so a view that goes first takes nothing from under it.
  g_signal_connect(popover, "closed", G_CALLBACK(+[](GtkPopover *p, gpointer) {
    g_idle_add_full(G_PRIORITY_DEFAULT_IDLE, [](gpointer data) -> gboolean {
      if (gtk_widget_get_parent(GTK_WIDGET(data))) {
        gtk_widget_unparent(GTK_WIDGET(data));
      }
      return G_SOURCE_REMOVE;
    }, g_object_ref(p), g_object_unref);
  }), nullptr);
  gtk_popover_popup(GTK_POPOVER(popover));
  return true;
}

bool textInputFocused(GtkWindow *window) {
  GtkWidget *focus = gtk_root_get_focus(GTK_ROOT(window));
  for (GtkWidget *w = focus; w; w = gtk_widget_get_parent(w)) {
    if (GTK_IS_EDITABLE(w) || GTK_IS_TEXT_VIEW(w)) {
      return true;
    }
  }
  return false;
}

GtkWidget *keyButton(GtkWindow *window, bool cancel) {
  GtkWidget *content = gtk_window_get_child(window);
  return content ? findKeyButton(content, cancel ? "cancel" : "default") : nullptr;
}

void routeKeys(GtkWindow *window, std::shared_ptr<KeyRouting> routing) {
  // Before the focused widget, as an app's shortcuts and the menus' keys come first.
  GtkEventController *first = gtk_event_controller_key_new();
  gtk_event_controller_set_propagation_phase(first, GTK_PHASE_CAPTURE);
  g_signal_connect_data(
      first, "key-pressed", G_CALLBACK(+[](GtkEventControllerKey *c, guint keyval, guint, GdkModifierType state, gpointer data) -> gboolean {
        auto *routing = static_cast<std::shared_ptr<KeyRouting> *>(data)->get();
        auto *window = GTK_WINDOW(gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(c)));
        // The browser keys some keyboards have go back and forward too.
        if (keyval == GDK_KEY_Back || keyval == GDK_KEY_Forward) {
          routing->navigate(keyval == GDK_KEY_Back ? NavigationDirection::Back : NavigationDirection::Forward, window);
          return TRUE;
        }
        // Super is the desktop's, never an app's.
        if (state & GDK_SUPER_MASK) {
          return FALSE;
        }
        auto chord = chordOf(keyval, static_cast<GdkModifierType>(state & gtk_accelerator_get_default_mod_mask()));
        if (chord.key.empty()) {
          return FALSE;
        }
        bool text = textInputFocused(window);
        if (routing->shortcut && routing->shortcut(chord, text)) {
          return TRUE;
        }
        if (auto direction = routing->navigation ? routing->navigation(chord) : std::nullopt) {
          routing->navigate(*direction, window);
          return TRUE;
        }
        const MenuItem *item = routing->menuKey ? routing->menuKey(chord) : nullptr;
        if (!item || (text && isEditingCommand(item->command))) {
          return FALSE;
        }
        routing->choose(*item, window);
        return TRUE;
      }),
      new std::shared_ptr<KeyRouting>(routing), [](gpointer data, GClosure *) { delete static_cast<std::shared_ptr<KeyRouting> *>(data); },
      GConnectFlags(0));
  gtk_widget_add_controller(GTK_WIDGET(window), first);

  // After it, for a press nothing in the window used: Return and Escape on the window's buttons.
  GtkEventController *last = gtk_event_controller_key_new();
  g_signal_connect(last, "key-pressed", G_CALLBACK(+[](GtkEventControllerKey *c, guint keyval, guint, GdkModifierType state, gpointer) -> gboolean {
    if ((state & gtk_accelerator_get_default_mod_mask()) != 0) {
      return FALSE;
    }
    bool cancel = keyval == GDK_KEY_Escape;
    if (!cancel && keyval != GDK_KEY_Return && keyval != GDK_KEY_KP_Enter) {
      return FALSE;
    }
    GtkWidget *button = keyButton(GTK_WINDOW(gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(c))), cancel);
    if (!button) {
      return FALSE;
    }
    // As a press of it: GTK shows it pressed, then clicks it.
    gtk_widget_activate(button);
    return TRUE;
  }), nullptr);
  gtk_widget_add_controller(GTK_WIDGET(window), last);

  // Mouse buttons 8 and 9, GDK's numbers for the side buttons, go back and forward.
  GtkGesture *side = gtk_gesture_click_new();
  gtk_gesture_single_set_button(GTK_GESTURE_SINGLE(side), 0);
  gtk_event_controller_set_propagation_phase(GTK_EVENT_CONTROLLER(side), GTK_PHASE_CAPTURE);
  g_signal_connect_data(
      side, "pressed", G_CALLBACK(+[](GtkGestureClick *g, int, double, double, gpointer data) {
        guint button = gtk_gesture_single_get_current_button(GTK_GESTURE_SINGLE(g));
        if (button != 8 && button != 9) {
          gtk_gesture_set_state(GTK_GESTURE(g), GTK_EVENT_SEQUENCE_DENIED);
          return;
        }
        auto *routing = static_cast<std::shared_ptr<KeyRouting> *>(data)->get();
        auto *window = GTK_WINDOW(gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(g)));
        routing->navigate(*navigationFor(button == 8 ? NavigationInput::MouseButton4 : NavigationInput::MouseButton5), window);
        gtk_gesture_set_state(GTK_GESTURE(g), GTK_EVENT_SEQUENCE_CLAIMED);
      }),
      new std::shared_ptr<KeyRouting>(routing), [](gpointer data, GClosure *) { delete static_cast<std::shared_ptr<KeyRouting> *>(data); },
      GConnectFlags(0));
  gtk_widget_add_controller(GTK_WIDGET(window), GTK_EVENT_CONTROLLER(side));
}

} // namespace ngn::gtk
