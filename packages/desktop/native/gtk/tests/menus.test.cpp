// The app's menus and a window's keys on GTK (menus.h): key presses as the web names them, the
// menu model GTK draws from the core's items, the window's slot showing it, and a window's keys,
// played through the X server under X11 (input-replay.h) so they take GTK's own path.
#include "mounted-views.h"

#include "../focus.h"
#include "../host-sources.h"
#include "../input-replay.h"
#include "../menus.h"
#include "../screens.h"
#include "../text-field.h"
#include "../view-widget.h"

#include <adwaita.h>
#include <doctest/doctest.h>
#include <react/renderer/components/textinput/TextInputEventEmitter.h>

#include <algorithm>

#include <memory>
#include <new>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#ifdef GDK_WINDOWING_X11
#include <gdk/x11/gdkx.h>
#endif

namespace {

using ngn::MenuCommand;
using ngn::MenuItem;

bool onX11() {
#ifdef GDK_WINDOWING_X11
  return GDK_IS_X11_DISPLAY(gdk_display_get_default());
#else
  return false;
#endif
}

// The model a menu bar, or a primary menu button's popover, draws.
GMenuModel *shownModel(GtkWidget *slot) {
  if (GTK_IS_POPOVER_MENU_BAR(slot)) {
    return gtk_popover_menu_bar_get_menu_model(GTK_POPOVER_MENU_BAR(slot));
  }
  return ngn::testing::menuButtonModel(slot);
}

void settle() {
  for (int i = 0; i < 100; ++i) {
    g_main_context_iteration(nullptr, FALSE);
    g_usleep(1000);
  }
}

} // namespace

TEST_CASE("a key press is named as the web names it, with Ctrl, Shift and Alt") {
  REQUIRE(ngn::testing::gtkReady());
  using ngn::gtk::chordOf;
  CHECK(chordOf(GDK_KEY_q, GDK_CONTROL_MASK) == ngn::KeyChord{.key = "q", .modifiers = ngn::Control});
  CHECK(chordOf(GDK_KEY_Z, static_cast<GdkModifierType>(GDK_CONTROL_MASK | GDK_SHIFT_MASK)) ==
        ngn::KeyChord{.key = "Z", .modifiers = ngn::Control | ngn::Shift});
  CHECK(chordOf(GDK_KEY_Left, GDK_ALT_MASK) == ngn::KeyChord{.key = "ArrowLeft", .modifiers = ngn::Option});
  CHECK(chordOf(GDK_KEY_KP_Enter, GdkModifierType(0)).key == "Enter");
  CHECK(chordOf(GDK_KEY_F11, GdkModifierType(0)).key == "F11");
  CHECK(chordOf(GDK_KEY_comma, GDK_CONTROL_MASK).key == ",");
  // Alt+Left is Linux's back key.
  CHECK(ngn::navigationFor(chordOf(GDK_KEY_Left, GDK_ALT_MASK), ngn::linuxOs()) == ngn::NavigationDirection::Back);
  CHECK(ngn::navigationFor(chordOf(GDK_KEY_Right, GDK_ALT_MASK), ngn::linuxOs()) == ngn::NavigationDirection::Forward);

  CHECK(ngn::gtk::acceleratorOf({.key = "q", .modifiers = ngn::Control}) == "<Control>q");
  CHECK(ngn::gtk::acceleratorOf({.key = "z", .modifiers = ngn::Control | ngn::Shift}) == "<Shift><Control>z");
  CHECK(ngn::gtk::acceleratorOf({.key = "ArrowLeft", .modifiers = ngn::Option}) == "<Alt>Left");
  CHECK(ngn::gtk::acceleratorOf({.key = "F11"}) == "F11");
  CHECK(ngn::gtk::acceleratorOf({.title = "None"}).empty());
}

TEST_CASE("Insert is named both ways, and a key GTK has no name for shows no accelerator") {
  REQUIRE(ngn::testing::gtkReady());
  CHECK(ngn::gtk::chordOf(GDK_KEY_Insert, GDK_CONTROL_MASK) == ngn::KeyChord{.key = "Insert", .modifiers = ngn::Control});
  CHECK(ngn::gtk::acceleratorOf({.key = "Insert", .modifiers = ngn::Control}) == "<Control>Insert");
  // Not its first letter, which would show Ctrl+P for a key no press reaches.
  CHECK(ngn::gtk::acceleratorOf({.key = "Pause", .modifiers = ngn::Control}).empty());
  CHECK(ngn::gtk::acceleratorOf({.key = ",", .modifiers = ngn::Control}) == "<Control>comma");
}

TEST_CASE("F13 to F20 are named both ways, as F1 to F12 are") {
  REQUIRE(ngn::testing::gtkReady());
  const std::pair<guint, std::string> keys[] = {
      {GDK_KEY_F13, "F13"}, {GDK_KEY_F14, "F14"}, {GDK_KEY_F15, "F15"}, {GDK_KEY_F16, "F16"},
      {GDK_KEY_F17, "F17"}, {GDK_KEY_F18, "F18"}, {GDK_KEY_F19, "F19"}, {GDK_KEY_F20, "F20"},
  };
  for (const auto &[keyval, name] : keys) {
    CAPTURE(name);
    CHECK(ngn::gtk::chordOf(keyval, GDK_CONTROL_MASK) == ngn::KeyChord{.key = name, .modifiers = ngn::Control});
    CHECK(ngn::gtk::acceleratorOf({.key = name}) == name);
  }
}

TEST_CASE("an item on Command shows no accelerator, as no press on Linux is Command") {
  REQUIRE(ngn::testing::gtkReady());
  // `meta+k`: Super is the desktop's, so the window's keys never report it.
  CHECK(ngn::gtk::acceleratorOf({.key = "k", .modifiers = ngn::Command}).empty());
  CHECK(ngn::gtk::acceleratorOf({.key = "k", .modifiers = ngn::Command | ngn::Control}).empty());
  // `mod+k` is Ctrl on Linux.
  CHECK(ngn::gtk::acceleratorOf({.key = "k", .modifiers = ngn::Control}) == "<Control>k");
}

TEST_CASE("the menu model holds the core's items, in sections between separators, each an action of the menu group") {
  REQUIRE(ngn::testing::gtkReady());
  std::vector<std::string> chosen;
  std::vector<MenuItem> bar{
      {.title = "Note",
       .items = {{.title = "New", .command = MenuCommand::AppItem, .key = "n", .modifiers = ngn::Control, .id = "new"},
                 {.separator = true},
                 {.title = "Pinned", .command = MenuCommand::AppItem, .id = "pin", .checked = true},
                 {.title = "Archive", .command = MenuCommand::AppItem, .id = "archive", .disabled = true}}},
      // An empty menu (AppKit's Window list) is left out.
      {.title = "Window", .role = ngn::MenuRole::Window},
  };
  GSimpleActionGroup *group = g_simple_action_group_new();
  GMenuModel *model = ngn::gtk::buildMenu(bar, group, [&chosen](const MenuItem &item) { chosen.push_back(item.id); });
  REQUIRE(g_menu_model_get_n_items(model) == 1);
  GMenuModel *section = g_menu_model_get_item_link(model, 0, G_MENU_LINK_SECTION);
  CHECK(g_menu_model_get_n_items(section) == 1);
  GMenuModel *note = g_menu_model_get_item_link(section, 0, G_MENU_LINK_SUBMENU);
  REQUIRE(note);
  // New, then a section break, then Pinned and Archive.
  CHECK(g_menu_model_get_n_items(note) == 2);
  GMenuModel *first = g_menu_model_get_item_link(note, 0, G_MENU_LINK_SECTION);
  gchar *accel = nullptr;
  REQUIRE(g_menu_model_get_item_attribute(first, 0, "accel", "s", &accel));
  CHECK(std::string(accel) == "<Control>n");
  g_free(accel);

  g_action_group_activate_action(G_ACTION_GROUP(group), "item-0", nullptr);
  g_action_group_change_action_state(G_ACTION_GROUP(group), "item-1", g_variant_new_boolean(FALSE));
  CHECK(chosen == std::vector<std::string>{"new", "pin"});
  CHECK(g_action_group_get_action_state(G_ACTION_GROUP(group), "item-1") != nullptr);
  CHECK_FALSE(g_action_group_get_action_enabled(G_ACTION_GROUP(group), "item-2"));
  g_object_unref(first);
  g_object_unref(note);
  g_object_unref(section);
  g_object_unref(model);
  g_object_unref(group);
}

TEST_CASE("every item in a disabled menu is a disabled action, as a key press finds none of them") {
  REQUIRE(ngn::testing::gtkReady());
  std::vector<std::string> chosen;
  std::vector<MenuItem> bar{
      {.title = "Note",
       .items = {{.title = "New", .command = MenuCommand::AppItem, .id = "new"},
                 {.title = "Share",
                  .items = {{.title = "Mail", .command = MenuCommand::AppItem, .key = "m", .modifiers = ngn::Control, .id = "mail"},
                            {.title = "More", .items = {{.title = "Fax", .command = MenuCommand::AppItem, .id = "fax"}}}},
                  .disabled = true}}},
  };
  GSimpleActionGroup *group = g_simple_action_group_new();
  GMenuModel *model = ngn::gtk::buildMenu(bar, group, [&chosen](const MenuItem &item) { chosen.push_back(item.id); });
  CHECK(ngn::findMenuItem(bar, ngn::KeyChord{.key = "m", .modifiers = ngn::Control}) == nullptr);
  // New, an enabled menu's item, stays enabled; Mail, under the disabled Share, does not, nor Fax,
  // in an enabled menu under it.
  CHECK(g_action_group_get_action_enabled(G_ACTION_GROUP(group), "item-0"));
  CHECK_FALSE(g_action_group_get_action_enabled(G_ACTION_GROUP(group), "item-1"));
  CHECK_FALSE(g_action_group_get_action_enabled(G_ACTION_GROUP(group), "item-2"));
  g_action_group_activate_action(G_ACTION_GROUP(group), "item-1", nullptr);
  g_action_group_activate_action(G_ACTION_GROUP(group), "item-2", nullptr);
  g_action_group_activate_action(G_ACTION_GROUP(group), "item-0", nullptr);
  CHECK(chosen == std::vector<std::string>{"new"});
  g_object_unref(model);
  g_object_unref(group);
}

TEST_CASE("a window's primary menu or KDE menu bar shows the bar once it has one, and takes the new one") {
  REQUIRE(ngn::testing::gtkReady());
  for (auto placement : {ngn::MenuPlacement::PrimaryMenu, ngn::MenuPlacement::MenuBar}) {
    CAPTURE(static_cast<int>(placement));
    std::vector<std::string> chosen;
    ngn::gtk::GtkMenus menus([&chosen](const MenuItem &item) { chosen.push_back(item.title); });
    GtkWidget *window = adw_window_new();
    GtkWidget *surface = ngn::gtk::makeSurfaceWidget(9, nullptr);
    adw_window_set_content(ADW_WINDOW(window), ngn::gtk::wrapInChrome(surface, {.menus = placement}));
    const auto *chrome = ngn::gtk::chromeOf(surface);
    GtkWidget *slot = placement == ngn::MenuPlacement::MenuBar ? chrome->menuBar : chrome->primaryMenu;
    menus.attach(surface);
    CHECK_FALSE(gtk_widget_get_visible(slot));

    menus.setMenuBar(ngn::linuxMenuBar({.appName = "Notes", .os = ngn::linuxOs()}));
    settle();
    CHECK(gtk_widget_get_visible(slot));
    GMenuModel *shown = shownModel(slot);
    REQUIRE(shown);
    // File, Edit, View and the app's menu.
    GMenuModel *section = g_menu_model_get_item_link(shown, 0, G_MENU_LINK_SECTION);
    CHECK(g_menu_model_get_n_items(section) == 4);
    g_object_unref(section);
    // The window reaches the items' actions.
    CHECK(gtk_widget_activate_action(slot, "menu.item-0", nullptr));
    CHECK(chosen == std::vector<std::string>{"Close Window"});

    // A new bar replaces it.
    menus.setMenuBar({{.title = "Only", .items = {{.title = "One", .command = MenuCommand::AppItem, .id = "one"}}}});
    settle();
    GMenuModel *next = shownModel(slot);
    REQUIRE(next);
    GMenuModel *nextSection = g_menu_model_get_item_link(next, 0, G_MENU_LINK_SECTION);
    CHECK(g_menu_model_get_n_items(nextSection) == 1);
    g_object_unref(nextSection);
    gtk_window_destroy(GTK_WINDOW(window));
  }
}

namespace {

// Two menus with one name, each with its own item.
std::vector<MenuItem> twinMenus() {
  return {{.title = "File", .items = {{.title = "Open", .command = MenuCommand::AppItem, .id = "open"}}},
          {.title = "File", .items = {{.title = "Export", .command = MenuCommand::AppItem, .id = "export"}}}};
}

} // namespace

TEST_CASE("two menus with one name in the primary menu each open their own submenu") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::gtk::GtkMenus menus([](const MenuItem &) {});
  GtkWidget *window = adw_window_new();
  GtkWidget *surface = ngn::gtk::makeSurfaceWidget(9, nullptr);
  adw_window_set_content(ADW_WINDOW(window), ngn::gtk::wrapInChrome(surface, {.menus = ngn::MenuPlacement::PrimaryMenu}));
  menus.attach(surface);
  menus.setMenuBar(twinMenus());
  settle();
  GtkWidget *slot = ngn::gtk::chromeOf(surface)->primaryMenu;
  CHECK(gtk_widget_get_visible(slot));
  GtkPopover *popover = gtk_menu_button_get_popover(GTK_MENU_BUTTON(slot));
  REQUIRE(GTK_IS_POPOVER_MENU(popover));
  CHECK_FALSE(ngn::testing::sharedPageName(GTK_WIDGET(popover)));
  gtk_window_destroy(GTK_WINDOW(window));
}

TEST_CASE("a bar set just before its menus go is never drawn into them") {
  REQUIRE(ngn::testing::gtkReady());
  // The next menus in the same memory, so a queued update of the old ones shows as their bar.
  alignas(ngn::gtk::GtkMenus) unsigned char storage[sizeof(ngn::gtk::GtkMenus)];
  auto *old = new (storage) ngn::gtk::GtkMenus([](const MenuItem &) {});
  old->setMenuBar({{.title = "Only", .items = {{.title = "One", .command = MenuCommand::AppItem, .id = "one"}}}});
  old->~GtkMenus();
  auto *next = new (storage) ngn::gtk::GtkMenus([](const MenuItem &) {});
  settle();
  CHECK(next->bar().empty());
  next->~GtkMenus();
}

TEST_CASE("a window's keys: the app's shortcuts first, then the focus keys, then a menu item's key, then Return and Escape on its buttons") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    MESSAGE("not X11: no keys can be played into GTK here");
    return;
  }
  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 300, 160);
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
  GtkWidget *entry = gtk_entry_new();
  GtkWidget *save = gtk_button_new_with_label("Save");
  GtkWidget *cancel = gtk_button_new_with_label("Cancel");
  g_object_set_data(G_OBJECT(save), "ngn-key-role", const_cast<char *>("default"));
  g_object_set_data(G_OBJECT(cancel), "ngn-key-role", const_cast<char *>("cancel"));
  gtk_box_append(GTK_BOX(box), entry);
  gtk_box_append(GTK_BOX(box), save);
  gtk_box_append(GTK_BOX(box), cancel);
  gtk_window_set_child(GTK_WINDOW(window), box);
  int saves = 0, cancels = 0;
  g_signal_connect(save, "clicked", G_CALLBACK(+[](GtkButton *, gpointer n) { ++*static_cast<int *>(n); }), &saves);
  g_signal_connect(cancel, "clicked", G_CALLBACK(+[](GtkButton *, gpointer n) { ++*static_cast<int *>(n); }), &cancels);

  std::vector<std::string> log;
  std::vector<MenuItem> bar = ngn::linuxMenuBar({.appName = "Notes", .os = ngn::linuxOs()});
  ngn::gtk::routeKeys(GTK_WINDOW(window), std::make_shared<ngn::gtk::KeyRouting>(ngn::gtk::KeyRouting{
      .shortcut = [&log](const ngn::KeyChord &chord, bool text) {
        if (chord.key == "k" && chord.modifiers == ngn::Control) {
          log.push_back(std::string("shortcut") + (text ? " in text" : ""));
          return true;
        }
        return false;
      },
      .focus = [&log](GtkWindow *, guint keyval, GdkModifierType) {
        if (keyval == GDK_KEY_Tab || keyval == GDK_KEY_k) {
          log.push_back("focus");
          return true;
        }
        return false;
      },
      .navigation = [](const ngn::KeyChord &chord) { return ngn::navigationFor(chord, ngn::linuxOs()); },
      .editingKey = [](const ngn::KeyChord &chord) { return ngn::editingChord(chord, ngn::linuxOs()); },
      .navigate = [&log](ngn::NavigationDirection d, GtkWindow *) { log.push_back(d == ngn::NavigationDirection::Back ? "back" : "forward"); },
      .menuKey = [&bar](const ngn::KeyChord &chord) { return ngn::findMenuItem(bar, chord); },
      .choose = [&log](const MenuItem &item, GtkWindow *) { log.push_back(item.title); },
  }));
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window) && gtk_window_is_active(GTK_WINDOW(window)); });

  // The focus on nothing (a button would take Return itself): Ctrl+K is the app's, Ctrl+Q is Quit,
  // Ctrl+C is Copy, Return and Escape press the default and cancel buttons.
  gtk_widget_set_focusable(cancel, FALSE);
  gtk_widget_set_focusable(save, FALSE);
  gtk_root_set_focus(GTK_ROOT(window), nullptr);
  auto play = [window](const char *script) {
    REQUIRE(ngn::gtk::replayInputScript(window, ngn::parseInputScript(script)));
    settle();
    settle();
  };
  play("key k cmd\nkey q cmd\nkey c cmd\nkey return\nkey escape\nkey tab\n");
  // Ctrl+K is the app's before the focus sees it; Tab is the focus's.
  CHECK(log == std::vector<std::string>{"shortcut", "Quit", "Copy", "focus"});
  // GTK shows a button pressed for a moment before it clicks.
  ngn::testing::runUntil([&saves, &cancels] { return saves == 1 && cancels == 1; });

  // In a text input: the app's shortcut still comes first, the entry keeps Ctrl+C and Ctrl+X, even
  // from an item of the app's on Ctrl+X, and Return is the entry's own (activate).
  bar.insert(bar.begin(), MenuItem{.title = "Note", .items = {{.title = "Cut Note", .command = MenuCommand::AppItem, .key = "x", .modifiers = ngn::Control, .id = "cut-note"}}});
  log.clear();
  gtk_widget_grab_focus(entry);
  play("key k cmd\nkey c cmd\nkey x cmd\nkey q cmd\nkey return\n");
  CHECK(log == std::vector<std::string>{"shortcut in text", "Quit"});
  gint64 later = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([later] { return g_get_monotonic_time() > later; });
  CHECK(saves == 1);
  // Out of one, the app's item takes it.
  log.clear();
  gtk_root_set_focus(GTK_ROOT(window), nullptr);
  play("key x cmd\n");
  CHECK(log == std::vector<std::string>{"Cut Note"});

  // A disabled default button takes no Return.
  gtk_root_set_focus(GTK_ROOT(window), nullptr);
  gtk_widget_set_sensitive(save, FALSE);
  play("key return\n");
  gint64 until = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
  CHECK(saves == 1);
  gtk_window_destroy(GTK_WINDOW(window));
}

TEST_CASE("a context menu shows its items at the click, and goes once closed, even after its view") {
  REQUIRE(ngn::testing::gtkReady());
  GtkWidget *window = gtk_window_new();
  GtkWidget *view = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
  gtk_widget_set_size_request(view, 200, 100);
  gtk_window_set_child(GTK_WINDOW(window), view);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window); });
  std::vector<std::string> chosen;
  CHECK_FALSE(ngn::gtk::popUpContextMenu(view, {10, 10}, {}, [](const MenuItem &) {}));
  // Nothing GTK would draw: the view's own context menu instead.
  CHECK_FALSE(ngn::gtk::popUpContextMenu(view, {10, 10}, {{.separator = true}, {.title = "Window", .role = ngn::MenuRole::Window}},
                                         [](const MenuItem &) {}));
  CHECK(gtk_widget_get_first_child(view) == nullptr);
  // Two submenus with one name each open their own.
  REQUIRE(ngn::gtk::popUpContextMenu(view, {10, 10}, twinMenus(), [](const MenuItem &) {}));
  GtkWidget *twins = gtk_widget_get_last_child(view);
  REQUIRE(GTK_IS_POPOVER_MENU(twins));
  CHECK_FALSE(ngn::testing::sharedPageName(twins));
  gtk_popover_popdown(GTK_POPOVER(twins));
  settle();
  REQUIRE(ngn::gtk::popUpContextMenu(view, {10, 10}, {{.title = "Rename", .command = MenuCommand::AppItem, .id = "rename"}},
                                     [&chosen](const MenuItem &item) { chosen.push_back(item.id); }));
  GtkWidget *popover = gtk_widget_get_last_child(view);
  REQUIRE(GTK_IS_POPOVER_MENU(popover));
  CHECK(gtk_widget_activate_action(popover, "menu.item-0", nullptr));
  CHECK(chosen == std::vector<std::string>{"rename"});
  // GTK's own complaints from here on, as a widget used after it went.
  int criticals = 0;
  guint handler = g_log_set_handler("Gtk", G_LOG_LEVEL_CRITICAL, [](const gchar *, GLogLevelFlags, const gchar *, gpointer n) {
    ++*static_cast<int *>(n);
  }, &criticals);
  gtk_popover_popdown(GTK_POPOVER(popover));
  // The window, its view and the popover go before the idle that lets the popover go.
  gtk_window_destroy(GTK_WINDOW(window));
  settle();
  g_log_remove_handler("Gtk", handler);
  CHECK(criticals == 0);
}

TEST_CASE("a press's menu opens under its view, pointing at the whole of it, and runs the item chosen") {
  REQUIRE(ngn::testing::gtkReady());
  GtkWidget *window = gtk_window_new();
  GtkWidget *view = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
  gtk_widget_set_size_request(view, 200, 100);
  gtk_window_set_child(GTK_WINDOW(window), view);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([view] { return gtk_widget_get_width(view) > 0; });
  CHECK_FALSE(ngn::gtk::popUpMenuUnder(view, {{.separator = true}}, [](const MenuItem &) {}));
  std::vector<std::string> chosen;
  REQUIRE(ngn::gtk::popUpMenuUnder(view, {{.title = "Name", .command = MenuCommand::AppItem, .id = "name", .checked = true}},
                                   [&chosen](const MenuItem &item) { chosen.push_back(item.id); }));
  GtkWidget *popover = gtk_widget_get_last_child(view);
  REQUIRE(GTK_IS_POPOVER_MENU(popover));
  GdkRectangle at{};
  REQUIRE(gtk_popover_get_pointing_to(GTK_POPOVER(popover), &at));
  CHECK(at.x == 0);
  CHECK(at.y == 0);
  CHECK(at.width == 200);
  CHECK(at.height == 100);
  CHECK(gtk_popover_get_position(GTK_POPOVER(popover)) == GTK_POS_BOTTOM);
  CHECK(gtk_widget_get_halign(popover) == GTK_ALIGN_START);
  CHECK(gtk_widget_activate_action(popover, "menu.item-0", nullptr));
  CHECK(chosen == std::vector<std::string>{"name"});
  gtk_popover_popdown(GTK_POPOVER(popover));
  gtk_window_destroy(GTK_WINDOW(window));
  settle();
}

TEST_CASE("the app's undo history runs its actions on the UI thread, whichever thread registers them") {
  REQUIRE(ngn::testing::gtkReady());
  auto undo = ngn::gtk::makeUndoManager();
  GThread *ui = g_thread_self();
  std::vector<std::string> ran;
  bool onUi = true;
  std::thread js([&] {
    undo->registerAction("Add a Star", [&] {
      onUi = onUi && g_thread_self() == ui;
      ran.push_back(undo->undoing() ? "undo" : "redo");
    });
  });
  js.join();
  settle();
  undo->undo();
  settle();
  CHECK(ran == std::vector<std::string>{"undo"});
  CHECK(onUi);
  // The action registered no inverse, so there is nothing to redo.
  undo->redo();
  settle();
  CHECK(ran.size() == 1);
}

namespace {

void collectShortcuts(GtkWidget *widget, std::vector<std::pair<std::string, std::string>> &out) {
  for (GtkWidget *c = gtk_widget_get_first_child(widget); c; c = gtk_widget_get_next_sibling(c)) {
    if (std::string(G_OBJECT_TYPE_NAME(c)) == "GtkShortcutsShortcut") {
      gchar *title = nullptr;
      gchar *accelerator = nullptr;
      g_object_get(c, "title", &title, "accelerator", &accelerator, nullptr);
      out.emplace_back(title ? title : "", accelerator ? accelerator : "");
      g_free(title);
      g_free(accelerator);
    }
    collectShortcuts(c, out);
  }
}

// The text an AdwShortcutsDialog shows, in order: each label's and each shortcut label's accelerator.
void collectDialogText(GtkWidget *widget, std::vector<std::string> &out) {
  for (GtkWidget *c = gtk_widget_get_first_child(widget); c; c = gtk_widget_get_next_sibling(c)) {
    std::string type = G_OBJECT_TYPE_NAME(c);
    if (type == "AdwShortcutLabel") {
      gchar *accelerator = nullptr;
      g_object_get(c, "accelerator", &accelerator, nullptr);
      out.emplace_back(accelerator ? accelerator : "");
      g_free(accelerator);
      continue;
    }
    if (GTK_IS_LABEL(c)) {
      out.emplace_back(gtk_label_get_text(GTK_LABEL(c)));
    }
    collectDialogText(c, out);
  }
}

} // namespace

TEST_CASE("Keyboard Shortcuts is a window over the app's, listing each group's keys as GTK writes them") {
  REQUIRE(ngn::testing::gtkReady());
  GtkWidget *parent = gtk_window_new();
  std::vector<ngn::ShortcutGroup> groups{
      {.title = "File & Edit", .entries = {{.title = "Save <now>", .chord = {.key = "s", .modifiers = ngn::Control}},
                                           {.title = "Redo", .chord = {.key = "z", .modifiers = ngn::Control | ngn::Shift}}}},
      {.title = "Notes", .entries = {{.title = "Keyboard Shortcuts", .chord = {.key = "?", .modifiers = ngn::Control | ngn::Shift}}}},
  };
  GtkWidget *window = ngn::gtk::keyboardShortcutsWindow(groups, GTK_WINDOW(parent));
  REQUIRE(window);
  // libadwaita 1.8's dialog where the libadwaita running has it, a section a group.
  if (adw_get_major_version() == 1 && adw_get_minor_version() >= 8) {
    CHECK(std::string(G_OBJECT_TYPE_NAME(window)) == "AdwShortcutsDialog");
    // Shown over the parent, which builds its rows.
    gtk_window_present(GTK_WINDOW(parent));
    g_object_ref(window);
    ngn::gtk::presentKeyboardShortcuts(window, GTK_WINDOW(parent));
    for (int i = 0; i < 50; ++i) {
      g_main_context_iteration(nullptr, FALSE);
    }
    std::vector<std::string> text;
    collectDialogText(window, text);
    auto at = [&text](const std::string &s) { return std::find(text.begin(), text.end(), s) - text.begin(); };
    for (const char *said : {"File & Edit", "Save <now>", "<Control>s", "Redo", "<Shift><Control>z", "Notes", "Keyboard Shortcuts", "<Shift><Control>question"}) {
      CHECK_MESSAGE(at(said) < static_cast<long>(text.size()), said);
    }
    CHECK(at("Save <now>") < at("<Control>s"));
    CHECK(at("File & Edit") < at("Notes"));
    g_object_unref(window);
    gtk_window_destroy(GTK_WINDOW(parent));
    return;
  }
  CHECK(std::string(G_OBJECT_TYPE_NAME(window)) == "GtkShortcutsWindow");
  CHECK(gtk_window_get_transient_for(GTK_WINDOW(window)) == GTK_WINDOW(parent));
  std::vector<std::pair<std::string, std::string>> shown;
  collectShortcuts(window, shown);
  // The section first; the window's search page lists them again after it.
  REQUIRE(shown.size() >= 3);
  shown.resize(3);
  CHECK(shown == std::vector<std::pair<std::string, std::string>>{
                     {"Save <now>", "<Control>s"}, {"Redo", "<Shift><Control>z"}, {"Keyboard Shortcuts", "<Shift><Control>question"}});
  gtk_window_destroy(GTK_WINDOW(window));
  gtk_window_destroy(GTK_WINDOW(parent));
}

TEST_CASE("the keypad's navigation keys reach the focus callback as the plain ones do, and no binding of the plain key hears them") {
  REQUIRE(ngn::testing::gtkReady());
  GtkWidget *window = gtk_window_new();
  std::vector<guint> focused;
  std::vector<std::string> bound;
  ngn::gtk::routeKeys(GTK_WINDOW(window), std::make_shared<ngn::gtk::KeyRouting>(ngn::gtk::KeyRouting{
      .shortcut = [&bound](const ngn::KeyChord &chord, bool) {
        bound.push_back(chord.key);
        return false;
      },
      .focus = [&focused](GtkWindow *, guint keyval, GdkModifierType) {
        focused.push_back(keyval);
        return true;
      },
  }));
  // The window's capture-phase key controller, as GTK would hand it the press.
  GtkEventController *routing = nullptr;
  GListModel *controllers = gtk_widget_observe_controllers(window);
  for (guint i = 0; i < g_list_model_get_n_items(controllers) && !routing; i++) {
    auto *c = static_cast<GtkEventController *>(g_list_model_get_item(controllers, i));
    if (GTK_IS_EVENT_CONTROLLER_KEY(c) && gtk_event_controller_get_propagation_phase(c) == GTK_PHASE_CAPTURE) {
      routing = c;
    }
    g_object_unref(c);
  }
  g_object_unref(controllers);
  REQUIRE(routing);
  auto press = [routing](guint keyval) {
    gboolean used = FALSE;
    g_signal_emit_by_name(routing, "key-pressed", keyval, 0u, GdkModifierType(0), &used);
    return used;
  };
  for (guint keyval : {GDK_KEY_Home, GDK_KEY_KP_Home, GDK_KEY_KP_Left, GDK_KEY_KP_Up, GDK_KEY_KP_End, GDK_KEY_KP_Down}) {
    CHECK(press(keyval));
  }
  CHECK(focused == std::vector<guint>{GDK_KEY_Home, GDK_KEY_KP_Home, GDK_KEY_KP_Left, GDK_KEY_KP_Up, GDK_KEY_KP_End, GDK_KEY_KP_Down});
  // The shortcut lookup saw the plain Home only.
  CHECK(bound == std::vector<std::string>{"Home"});
  gtk_window_destroy(GTK_WINDOW(window));
}

TEST_CASE("an undo's own registration is the redo, so Redo is there after one Undo") {
  REQUIRE(ngn::testing::gtkReady());
  auto undo = ngn::gtk::makeUndoManager();
  std::vector<std::string> ran;
  std::function<void()> step = [&] {
    ran.push_back(undo->undoing() ? "undo" : "redo");
    // As an app's handler does: the inverse of what it just ran.
    undo->registerAction("Add a Star", step);
  };
  undo->registerAction("Add a Star", step);
  settle();
  undo->undo();
  settle();
  undo->redo();
  settle();
  CHECK(ran == std::vector<std::string>{"undo", "redo"});
}

TEST_CASE("a window's Tab and Shift-Tab send a focused text input's keyPress before the focus moves, once") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    MESSAGE("not X11: no keys can be played into GTK here");
    return;
  }
  using facebook::react::TextInputEventEmitter;
  ngn::testing::MountedViews views{false, 300, 200};
  views.add(ngn::testing::MountedViews::shadow(2, "TextInput", ngn::testing::textInputProps(folly::dynamic::object()), {{10, 10}, {150, 40}}));
  views.add(ngn::testing::MountedViews::shadow(3, "TextInput", ngn::testing::textInputProps(folly::dynamic::object()), {{10, 60}, {150, 40}}));
  auto *window = GTK_WINDOW(views.window);
  ngn::gtk::trackFocus(window);
  bool moves = true;
  ngn::gtk::routeKeys(window, std::make_shared<ngn::gtk::KeyRouting>(ngn::gtk::KeyRouting{
      .focus = [&views, &moves](GtkWindow *w, guint keyval, GdkModifierType state) {
        return moves && ngn::gtk::moveFocusByKey(w, keyval, state, *views.backend, views.mounting->tree());
      },
  }));
  ngn::testing::runUntil([window] { return gtk_window_is_active(window); });
  auto *first = ngn::gtk::viewData(views.view(2));
  auto *second = ngn::gtk::viewData(views.view(3));
  ngn::testing::SentEvents<TextInputEventEmitter> fromFirst(*first);
  ngn::testing::SentEvents<TextInputEventEmitter> fromSecond(*second);
  auto play = [window](const char *script) {
    REQUIRE(ngn::gtk::replayInputScript(GTK_WIDGET(window), ngn::parseInputScript(script)));
    settle();
    settle();
  };
  auto focused = [window](ngn::gtk::ViewData *d) {
    for (GtkWidget *w = gtk_root_get_focus(GTK_ROOT(window)); w; w = gtk_widget_get_parent(w)) {
      if (w == d->widget) {
        return true;
      }
    }
    return false;
  };
  gtk_widget_grab_focus(first->field->text);
  REQUIRE(focused(first));

  // The window's focus keys take Tab: the first input sends it, and the second has the focus.
  play("key tab\n");
  CHECK(fromFirst.count("topKeyPress") == 1);
  CHECK(fromSecond.count("topKeyPress") == 0);
  CHECK(focused(second));
  // Shift-Tab, from the second, back.
  play("key tab shift\n");
  CHECK(fromSecond.count("topKeyPress") == 1);
  CHECK(fromFirst.count("topKeyPress") == 1);
  CHECK(focused(first));

  // Tab the focus keys leave alone reaches the input, which sends no second keyPress for it.
  moves = false;
  play("key tab\n");
  CHECK(fromFirst.count("topKeyPress") == 2);
  first->emitter = nullptr;
  second->emitter = nullptr;
}
