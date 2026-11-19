// The app's menus and a window's keys on GTK (menus.h): key presses as the web names them, the
// menu model GTK draws from the core's items, the window's slot showing it, and a window's keys,
// played through the X server under X11 (input-replay.h) so they take GTK's own path.
#include "mounted-views.h"

#include "../host-sources.h"
#include "../input-replay.h"
#include "../menus.h"
#include "../screens.h"
#include "../view-widget.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <memory>
#include <string>
#include <thread>
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
    GMenuModel *shown = placement == ngn::MenuPlacement::MenuBar ? gtk_popover_menu_bar_get_menu_model(GTK_POPOVER_MENU_BAR(slot))
                                                                 : gtk_menu_button_get_menu_model(GTK_MENU_BUTTON(slot));
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
    GMenuModel *next = placement == ngn::MenuPlacement::MenuBar ? gtk_popover_menu_bar_get_menu_model(GTK_POPOVER_MENU_BAR(slot))
                                                                : gtk_menu_button_get_menu_model(GTK_MENU_BUTTON(slot));
    GMenuModel *nextSection = g_menu_model_get_item_link(next, 0, G_MENU_LINK_SECTION);
    CHECK(g_menu_model_get_n_items(nextSection) == 1);
    g_object_unref(nextSection);
    gtk_window_destroy(GTK_WINDOW(window));
  }
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

  // In a text input: the app's shortcut still comes first, the entry keeps Ctrl+C, and Return is
  // the entry's own (activate).
  log.clear();
  gtk_widget_grab_focus(entry);
  play("key k cmd\nkey c cmd\nkey q cmd\nkey return\n");
  CHECK(log == std::vector<std::string>{"shortcut in text", "Quit"});
  gint64 later = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([later] { return g_get_monotonic_time() > later; });
  CHECK(saves == 1);

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
