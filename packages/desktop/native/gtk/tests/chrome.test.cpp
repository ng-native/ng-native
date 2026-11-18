// A window's chrome on GTK (screens.h): the toolbar view and header bar each title-bar mode makes,
// the insets content running under the header bar gets, where the menus go, and the application
// window GtkWindows opens.
#include "mounted-views.h"

#include "../app-windows.h"
#include "../screens.h"
#include "../view-widget.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <react/renderer/components/view/ViewProps.h>

#include <string>

namespace {

using ngn::MenuPlacement;
using ngn::TitleBar;

// gtk-decoration-layout set for a test, and put back after it.
struct DecorationLayout {
  std::string saved;
  explicit DecorationLayout(const char *layout) {
    gchar *was = nullptr;
    g_object_get(gtk_settings_get_default(), "gtk-decoration-layout", &was, nullptr);
    saved = was ? was : "";
    g_free(was);
    set(layout);
  }
  ~DecorationLayout() {
    set(saved.c_str());
  }
  static void set(const char *layout) {
    g_object_set(gtk_settings_get_default(), "gtk-decoration-layout", layout, nullptr);
  }
};

// The default text direction for a test, as the host sets it before its first window.
struct Direction {
  GtkTextDirection saved = gtk_widget_get_default_direction();
  explicit Direction(GtkTextDirection direction) {
    gtk_widget_set_default_direction(direction);
  }
  ~Direction() {
    gtk_widget_set_default_direction(saved);
  }
};

// Whether the window controls go where gtk-decoration-layout says: everywhere but GTK's macOS
// backend (the Mac's dev loop), which puts them on the left as a Mac window has them.
bool layoutFollowsSetting() {
  return std::string(G_OBJECT_TYPE_NAME(gdk_display_get_default())) != "GdkMacosDisplay";
}

// On GTK's macOS backend: the controls on the leading side, whatever the layout.
void checkMacControls(const ngn::ContainerInsets &insets) {
  MESSAGE("GTK's macOS backend puts the window controls on the left");
  CHECK(insets.titlebarLeading > 20);
  CHECK(insets.titlebarTrailing == 0);
}

// A decorated window 400 by 300 whose content is a surface in the chrome `options` makes.
struct ChromeWindow {
  GtkWidget *window = adw_window_new();
  GtkWidget *surface = ngn::gtk::makeSurfaceWidget(9, nullptr);
  const ngn::gtk::WindowChrome *chrome = nullptr;

  explicit ChromeWindow(ngn::gtk::ChromeOptions options) {
    gtk_window_set_default_size(GTK_WINDOW(window), 400, 300);
    adw_window_set_content(ADW_WINDOW(window), ngn::gtk::wrapInChrome(surface, options));
    chrome = ngn::gtk::chromeOf(surface);
    gtk_window_present(GTK_WINDOW(window));
    settle();
  }
  ~ChromeWindow() {
    gtk_window_destroy(GTK_WINDOW(window));
  }
  // Until GTK has laid the window out again, after a setting changed.
  void settle() const {
    ngn::testing::runUntil([this] { return gtk_widget_get_mapped(surface) && gtk_widget_get_width(chrome->headerBar) > 0; });
    for (int i = 0; i < 100; ++i) {
      g_main_context_iteration(nullptr, FALSE);
      g_usleep(1000);
    }
  }
};

} // namespace

TEST_CASE("a default title bar is a raised header bar over the content, which it leaves its whole safe area") {
  REQUIRE(ngn::testing::gtkReady());
  DecorationLayout layout(":minimize,maximize,close");
  ChromeWindow w({});
  REQUIRE(w.chrome);
  auto *toolbar = ADW_TOOLBAR_VIEW(w.chrome->toolbarView);
  CHECK(adw_toolbar_view_get_top_bar_style(toolbar) == ADW_TOOLBAR_RAISED);
  CHECK_FALSE(adw_toolbar_view_get_extend_content_to_top_edge(toolbar));
  CHECK(adw_header_bar_get_show_title(ADW_HEADER_BAR(w.chrome->headerBar)));
  CHECK(gtk_widget_is_ancestor(w.chrome->headerBar, w.chrome->toolbarView));
  auto insets = ngn::gtk::chromeInsets(w.surface);
  CHECK(insets.size.width == gtk_widget_get_width(w.surface));
  CHECK(insets.size.height == gtk_widget_get_height(w.surface));
  CHECK(insets.insets.top == 0);
  CHECK(insets.titlebarLeading == 0);
  CHECK(insets.titlebarTrailing == 0);
}

TEST_CASE("content runs under a transparent title bar, clear of the bar's height and of the window controls on each side") {
  REQUIRE(ngn::testing::gtkReady());
  DecorationLayout layout(":minimize,maximize,close");
  ChromeWindow w({.titleBar = TitleBar::Transparent});
  auto *toolbar = ADW_TOOLBAR_VIEW(w.chrome->toolbarView);
  CHECK(adw_toolbar_view_get_top_bar_style(toolbar) == ADW_TOOLBAR_FLAT);
  CHECK(adw_toolbar_view_get_extend_content_to_top_edge(toolbar));
  CHECK(adw_header_bar_get_show_title(ADW_HEADER_BAR(w.chrome->headerBar)));
  // The surface fills the window, the bar over it.
  CHECK(gtk_widget_get_height(w.surface) == gtk_widget_get_height(w.window));

  auto insets = ngn::gtk::chromeInsets(w.surface);
  int bar = adw_toolbar_view_get_top_bar_height(toolbar);
  CHECK(bar > 30);
  CHECK(insets.insets.top == bar);
  CHECK(insets.insets.left == 0);
  CHECK(insets.insets.right == 0);
  CHECK(insets.insets.bottom == 0);
  if (!layoutFollowsSetting()) {
    checkMacControls(insets);
    return;
  }
  // Three buttons at the end, none at the start.
  CHECK(insets.titlebarLeading == 0);
  CHECK(insets.titlebarTrailing > 60);
  CHECK(insets.titlebarTrailing < 200);
  double three = insets.titlebarTrailing;

  // The layout moving the close button to the start, as elementary's does, moves its inset there.
  DecorationLayout::set("close:");
  w.settle();
  insets = ngn::gtk::chromeInsets(w.surface);
  CHECK(insets.titlebarLeading > 20);
  CHECK(insets.titlebarLeading < three);
  CHECK(insets.titlebarTrailing == 0);

  // No buttons on either side.
  DecorationLayout::set(":");
  w.settle();
  insets = ngn::gtk::chromeInsets(w.surface);
  CHECK(insets.titlebarLeading == 0);
  CHECK(insets.titlebarTrailing == 0);
  CHECK(insets.insets.top == bar);
}

TEST_CASE("right to left, the end's window controls are on the left and still the trailing inset") {
  REQUIRE(ngn::testing::gtkReady());
  DecorationLayout layout(":close");
  Direction direction(GTK_TEXT_DIR_RTL);
  ChromeWindow w({.titleBar = TitleBar::Transparent});
  REQUIRE(gtk_widget_get_direction(w.surface) == GTK_TEXT_DIR_RTL);
  auto insets = ngn::gtk::chromeInsets(w.surface);
  if (!layoutFollowsSetting()) {
    MESSAGE("GTK's macOS backend places the window controls itself");
    CHECK(insets.titlebarLeading + insets.titlebarTrailing > 20);
    return;
  }
  CHECK(insets.titlebarLeading == 0);
  CHECK(insets.titlebarTrailing > 20);
  CHECK(insets.titlebarTrailing < 120);
}

TEST_CASE("a hidden title bar runs the content under the bar as a transparent one does, with no title") {
  REQUIRE(ngn::testing::gtkReady());
  DecorationLayout layout(":close");
  ChromeWindow w({.titleBar = TitleBar::Hidden});
  auto *toolbar = ADW_TOOLBAR_VIEW(w.chrome->toolbarView);
  CHECK(adw_toolbar_view_get_extend_content_to_top_edge(toolbar));
  CHECK(adw_toolbar_view_get_top_bar_style(toolbar) == ADW_TOOLBAR_FLAT);
  CHECK_FALSE(adw_header_bar_get_show_title(ADW_HEADER_BAR(w.chrome->headerBar)));
  auto insets = ngn::gtk::chromeInsets(w.surface);
  CHECK(insets.insets.top == adw_toolbar_view_get_top_bar_height(toolbar));
  CHECK(insets.titlebarLeading + insets.titlebarTrailing > 20);
}

TEST_CASE("the menus have a hidden menu bar under the header bar on KDE, and a hidden primary menu in it elsewhere") {
  REQUIRE(ngn::testing::gtkReady());
  {
    ChromeWindow w({.menus = MenuPlacement::MenuBar});
    REQUIRE(w.chrome->menuBar);
    CHECK(GTK_IS_POPOVER_MENU_BAR(w.chrome->menuBar));
    CHECK(gtk_widget_is_ancestor(w.chrome->menuBar, w.chrome->toolbarView));
    CHECK_FALSE(gtk_widget_is_ancestor(w.chrome->menuBar, w.chrome->headerBar));
    CHECK_FALSE(gtk_widget_get_visible(w.chrome->menuBar));
    CHECK(w.chrome->primaryMenu == nullptr);
  }
  {
    ChromeWindow w({.menus = MenuPlacement::PrimaryMenu});
    REQUIRE(w.chrome->primaryMenu);
    CHECK(gtk_menu_button_get_primary(GTK_MENU_BUTTON(w.chrome->primaryMenu)));
    CHECK(gtk_widget_is_ancestor(w.chrome->primaryMenu, w.chrome->headerBar));
    CHECK_FALSE(gtk_widget_get_visible(w.chrome->primaryMenu));
    CHECK(w.chrome->menuBar == nullptr);
  }
}

TEST_CASE("a window the app opens is an AdwApplicationWindow of the app, in its title bar's chrome") {
  REQUIRE(ngn::testing::gtkReady());
  GtkApplication *app = ngn::gtk::startApplication("dev.ngnative.ChromeTest");
  CHECK(g_application_get_is_registered(G_APPLICATION(app)));
  CHECK(std::string(g_application_get_application_id(G_APPLICATION(app))) == "dev.ngnative.ChromeTest");
  int laidOut = 0;
  bool stopped = false;
  auto windows = std::make_shared<ngn::gtk::GtkWindows>(
      ngn::gtk::GtkWindows::Hooks{
          .stopSurface = [&stopped](ngn::SurfaceId) { stopped = true; },
          .laidOut = [&laidOut](ngn::SurfaceId surface) { laidOut += surface == 7; },
          .quit = [] {},
      },
      app, MenuPlacement::MenuBar);
  bool opened = false;
  windows->openWindow(7, {.title = "Chrome", .titleBar = TitleBar::Hidden}, {.frame = {0, 0, 400, 300}}, [&opened] { opened = true; });
  ngn::testing::runUntil([&opened] { return opened; });
  GtkWidget *window = windows->window(7);
  REQUIRE(window);
  CHECK(ADW_IS_APPLICATION_WINDOW(window));
  CHECK(gtk_window_get_application(GTK_WINDOW(window)) == app);
  const auto *chrome = ngn::gtk::chromeOf(windows->surfaceWidget(7));
  REQUIRE(chrome);
  CHECK(chrome->titleBar == TitleBar::Hidden);
  CHECK(chrome->menuBar);
  // Laid out as it shows: the host checks its chrome's insets each time.
  windows->didMount(7);
  ngn::testing::runUntil([&laidOut] { return laidOut > 0; });
  windows->closeWindow(7);
  ngn::testing::runUntil([&stopped] { return stopped; });
  windows.reset();
  g_object_unref(app);

  // An app id that is not a valid application id leaves the application unnamed.
  GtkApplication *unnamed = ngn::gtk::startApplication("My Notes");
  CHECK(g_application_get_application_id(G_APPLICATION(unnamed)) == nullptr);
  g_object_unref(unnamed);
}

TEST_CASE("a cover starts below the header bar, whether or not the window's content runs under it") {
  REQUIRE(ngn::testing::gtkReady());
  using facebook::react::ShadowViewMutation;
  using ngn::testing::MountedViews;
  for (TitleBar titleBar : {TitleBar::Default, TitleBar::Transparent}) {
    CAPTURE(static_cast<int>(titleBar));
    MountedViews views(true, 400, 300, {.titleBar = titleBar});
    auto props = std::make_shared<const facebook::react::ViewProps>();
    auto content = MountedViews::shadow(2, "View", props, {{0, 0}, {400, 300}});
    auto modal = MountedViews::shadow(3, "ModalHostView", props, {{0, 0}, {400, 300}});
    views.add(content);
    views.mount({ShadowViewMutation::CreateMutation(modal)});
    ngn::DesktopProps cover;
    cover.presentation = ngn::ModalPresentation::Cover;
    views.backend->updateDesktopProps(MountedViews::kSurface, 3, cover);
    views.mount({ShadowViewMutation::InsertMutation(MountedViews::kSurface, modal, 1)});
    views.backend->modals().settle();
    views.settle();

    GtkWidget *slot = views.backend->modals().slotOf(3);
    REQUIRE(slot);
    graphene_rect_t bounds;
    REQUIRE(gtk_widget_compute_bounds(slot, views.window, &bounds));
    // The top bars' height, a raised bar's edge included.
    int below = adw_toolbar_view_get_top_bar_height(ADW_TOOLBAR_VIEW(ngn::gtk::chromeOf(views.surface)->toolbarView));
    CHECK(below > 30);
    CHECK(bounds.origin.y == doctest::Approx(below));
  }
}
