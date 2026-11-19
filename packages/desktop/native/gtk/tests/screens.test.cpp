// The native stack's header in the window's AdwHeaderBar, and <modal> presented over the window,
// on GTK (screens.h). react-native-screens' props come through the library glue, which the test
// installs over props of its own, as the core's tests do.
#include "mounted-views.h"

#include "../screens.h"

#include "ngn/library-glue.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <react/renderer/components/FBReactNativeSpec/EventEmitters.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::SentEvents;

namespace {

struct HeaderProps final : ViewProps {
  ngn::HeaderBar bar;
};

struct ItemProps final : ViewProps {
  std::string type;
};

struct Glue {
  ngn::LibraryGlue saved = ngn::libraryGlue();
  Glue() {
    ngn::libraryGlue().headerBar = [](const Props &props) -> std::optional<ngn::HeaderBar> {
      const auto *p = dynamic_cast<const HeaderProps *>(&props);
      return p ? std::optional(p->bar) : std::nullopt;
    };
    ngn::libraryGlue().headerItemType = [](const Props &props) -> std::optional<std::string> {
      const auto *p = dynamic_cast<const ItemProps *>(&props);
      return p ? std::optional(p->type) : std::nullopt;
    };
  }
  ~Glue() {
    ngn::libraryGlue() = saved;
  }
};

Props::Shared header(const std::string &title) {
  auto props = std::make_shared<HeaderProps>();
  props->bar.title = title;
  return props;
}

Props::Shared item(const std::string &type) {
  auto props = std::make_shared<ItemProps>();
  props->type = type;
  return props;
}

ShadowView shadow(Tag tag, const char *component, Props::Shared props, Rect frame) {
  return MountedViews::shadow(tag, component, props ? std::move(props) : std::make_shared<const ViewProps>(), frame);
}

// Creates and inserts each view under its parent, in order, in one transaction.
void mountAll(MountedViews &views, const std::vector<std::pair<ShadowView, Tag>> &tree) {
  ShadowViewMutationList mutations;
  std::map<Tag, int> counts;
  for (const auto &[view, parent] : tree) {
    mutations.push_back(ShadowViewMutation::CreateMutation(view));
  }
  for (const auto &[view, parent] : tree) {
    int index = counts[parent]++;
    if (const auto *node = views.mounting->tree().find(parent)) {
      index += static_cast<int>(node->children.size());
    }
    mutations.push_back(ShadowViewMutation::InsertMutation(parent, view, index));
  }
  views.mount(std::move(mutations));
}

const char *titleOf(GtkWidget *headerBar) {
  GtkWidget *title = adw_header_bar_get_title_widget(ADW_HEADER_BAR(headerBar));
  return title && ADW_IS_WINDOW_TITLE(title) ? adw_window_title_get_title(ADW_WINDOW_TITLE(title)) : nullptr;
}

} // namespace

TEST_CASE("the front screen's header is the window's header bar: its title, its items in slots, and back") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 400, 300);
  GtkWidget *bar = ngn::gtk::chromeOf(views.surface)->headerBar;
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {400, 300}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", header("Notes"), {{0, 0}, {400, 44}});
  auto plus = shadow(5, "RNSScreenStackHeaderSubview", item("right"), {{360, 8}, {28, 28}});
  auto icon = shadow(6, "View", nullptr, {{0, 0}, {28, 28}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {config, 3}, {plus, 4}, {icon, 5}});

  CHECK(std::string(titleOf(bar)) == "Notes");
  // The item is in the header bar, at its own size, and not in the content.
  CHECK(gtk_widget_is_ancestor(views.view(5), bar));
  CHECK(gtk_widget_get_width(gtk_widget_get_parent(views.view(5))) == 28);
  CHECK_FALSE(gtk_widget_get_child_visible(views.view(4)));
  CHECK(views.backend->headers().backButton(MountedViews::kSurface) == nullptr);

  // A second screen pushed: its header in front, with a back button, and the first's item home.
  auto second = shadow(7, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto secondConfig = shadow(8, "RNSScreenStackHeaderConfig", header("Detail"), {{0, 0}, {400, 44}});
  mountAll(views, {{second, 2}, {secondConfig, 7}});
  CHECK(std::string(titleOf(bar)) == "Detail");
  CHECK(views.backend->headers().backButton(MountedViews::kSurface) != nullptr);
  CHECK(gtk_widget_get_parent(views.view(5)) == views.view(4));

  // Popped: the first's header again, and no back button.
  views.mount({ShadowViewMutation::RemoveMutation(2, second, 1), ShadowViewMutation::DeleteMutation(second)});
  CHECK(std::string(titleOf(bar)) == "Notes");
  CHECK(views.backend->headers().backButton(MountedViews::kSurface) == nullptr);
  CHECK(gtk_widget_is_ancestor(views.view(5), bar));

  // A view inserted into the config after the hosted item lands after it: the item's place holds.
  auto left = shadow(9, "RNSScreenStackHeaderSubview", item("left"), {{0, 8}, {40, 28}});
  views.add(left, 4, 1);
  CHECK(gtk_widget_is_ancestor(views.view(9), bar));
  CHECK(gtk_widget_is_ancestor(views.view(5), bar));

  // The item removed goes from the header bar; the title stays.
  views.mount({ShadowViewMutation::RemoveMutation(4, plus, 0)});
  CHECK_FALSE(gtk_widget_get_parent(views.view(5)));
  CHECK(std::string(titleOf(bar)) == "Notes");
  views.mount({ShadowViewMutation::DeleteMutation(plus)});
}

TEST_CASE("a header's item changing side moves in the header bar, and a hidden header shows nothing") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 400, 300);
  GtkWidget *bar = ngn::gtk::chromeOf(views.surface)->headerBar;
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {400, 300}});
  auto screen = shadow(3, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", header("Notes"), {{0, 0}, {400, 44}});
  auto subview = shadow(5, "RNSScreenStackHeaderSubview", item("center"), {{0, 8}, {80, 28}});
  mountAll(views, {{stack, MountedViews::kSurface}, {screen, 2}, {config, 3}, {subview, 4}});
  // A center item is the title.
  GtkWidget *title = adw_header_bar_get_title_widget(ADW_HEADER_BAR(bar));
  REQUIRE(title);
  CHECK(gtk_widget_is_ancestor(views.view(5), title));

  views.update(subview, item("right"));
  CHECK(ADW_IS_WINDOW_TITLE(adw_header_bar_get_title_widget(ADW_HEADER_BAR(bar))));
  CHECK(gtk_widget_is_ancestor(views.view(5), bar));

  auto hidden = std::make_shared<HeaderProps>();
  hidden->bar.hidden = true;
  views.update(config, hidden);
  CHECK_FALSE(gtk_widget_is_ancestor(views.view(5), bar));
  CHECK(adw_header_bar_get_title_widget(ADW_HEADER_BAR(bar)) == nullptr);
}

TEST_CASE("a modal is presented over the window as a sheet at its content's size, and dismissed as it goes") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views(true, 800, 600);
  GtkWidget *overlay = ngn::gtk::chromeOf(views.surface)->overlay;
  auto content = shadow(2, "View", nullptr, {{0, 0}, {800, 600}});
  auto modal = shadow(3, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  auto inside = shadow(4, "View", nullptr, {{0, 0}, {480, 200}});
  mountAll(views, {{content, MountedViews::kSurface}, {modal, MountedViews::kSurface}, {inside, 3}});
  // Fitted again once the window has its size, as on a resize.
  views.backend->modals().settle();
  views.settle();

  GtkWidget *slot = views.backend->modals().slotOf(3);
  REQUIRE(slot);
  CHECK(gtk_widget_get_parent(views.view(3)) == slot);
  if (ngn::gtk::haveAdwDialog()) {
    CHECK(views.backend->modals().inDialog(3));
    // In the window, not in one of its own.
    CHECK(gtk_widget_get_root(slot) == gtk_widget_get_root(views.surface));
  } else {
    // libadwaita 1.4: the drawn sheet, on the overlay over the surface.
    CHECK(gtk_widget_is_ancestor(slot, overlay));
    // With no shadow tree to read here, the core's size for empty content.
    auto size = ngn::sheetSize(ngn::SheetNode{}, {800, 600});
    CHECK(size.width < 800);
    CHECK(gtk_widget_get_width(slot) == static_cast<int>(size.width));
    CHECK(gtk_widget_get_height(slot) == static_cast<int>(size.height));
  }
  // A sibling inserted after the modal goes after the place it left.
  auto after = shadow(5, "View", nullptr, {{0, 0}, {10, 10}});
  views.add(after, MountedViews::kSurface, 2);
  CHECK(gtk_widget_get_prev_sibling(views.view(5)) != views.view(2));

  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, modal, 1)});
  CHECK(views.backend->modals().slotOf(3) == nullptr);
  CHECK_FALSE(gtk_widget_get_parent(views.view(3)));
  // Only the surface is left in the overlay.
  int children = 0;
  for (GtkWidget *c = gtk_widget_get_first_child(overlay); c; c = gtk_widget_get_next_sibling(c)) {
    ++children;
  }
  CHECK(children == 1);
  CHECK(gtk_widget_get_prev_sibling(views.view(5)) == views.view(2));
  views.mount({ShadowViewMutation::DeleteMutation(modal)});
}

TEST_CASE("a header item that changes size changes its slot's") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 400, 300);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {400, 300}});
  auto screen = shadow(3, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", header("Notes"), {{0, 0}, {400, 44}});
  auto plus = shadow(5, "RNSScreenStackHeaderSubview", item("right"), {{360, 8}, {28, 28}});
  mountAll(views, {{stack, MountedViews::kSurface}, {screen, 2}, {config, 3}, {plus, 4}});
  GtkWidget *slot = gtk_widget_get_parent(views.view(5));
  REQUIRE(gtk_widget_get_width(slot) == 28);

  auto current = views.mounting->tree().find(5)->view;
  auto wider = current;
  wider.layoutMetrics.frame.size = {80, 28};
  views.mount({ShadowViewMutation::UpdateMutation(current, wider, 4)});
  CHECK(gtk_widget_get_parent(views.view(5)) == slot);
  CHECK(gtk_widget_get_width(slot) == 80);
}

TEST_CASE("a header item removed and deleted in one transaction lets go of its input") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 400, 300);
  std::vector<Tag> detached;
  views.backend->hooks.detachInput = [&detached](Tag tag) { detached.push_back(tag); };
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {400, 300}});
  auto screen = shadow(3, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", header("Notes"), {{0, 0}, {400, 44}});
  auto plus = shadow(5, "RNSScreenStackHeaderSubview", item("right"), {{360, 8}, {28, 28}});
  mountAll(views, {{stack, MountedViews::kSurface}, {screen, 2}, {config, 3}, {plus, 4}});
  detached.clear();

  views.mount({ShadowViewMutation::RemoveMutation(4, plus, 0), ShadowViewMutation::DeleteMutation(plus)});
  CHECK(std::count(detached.begin(), detached.end(), 5) == 1);
}

TEST_CASE("a header's search field keeps the focus as its title changes, and reports only the user's typing") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 600, 300);
  GtkWidget *bar = ngn::gtk::chromeOf(views.surface)->headerBar;
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {600, 300}});
  auto screen = shadow(3, "RNSScreen", nullptr, {{0, 0}, {600, 300}});
  // A bar button beside the field, which focus would move to were the field taken out.
  auto withButton = [](const std::string &title) {
    auto props = std::make_shared<HeaderProps>();
    props->bar.title = title;
    props->bar.right.push_back({.id = "add", .title = "Add"});
    return props;
  };
  auto config = shadow(4, "RNSScreenStackHeaderConfig", withButton("Notes"), {{0, 0}, {600, 44}});
  auto subview = shadow(5, "RNSScreenStackHeaderSubview", item("searchBar"), {{0, 0}, {220, 36}});
  auto search = shadow(6, "RNSSearchBar", nullptr, {{0, 0}, {220, 36}});
  mountAll(views, {{stack, MountedViews::kSurface}, {screen, 2}, {config, 3}, {subview, 4}, {search, 5}});
  GtkWidget *entry = views.backend->searchEntry(6);
  REQUIRE(entry);
  REQUIRE(gtk_widget_is_ancestor(entry, bar));
  SentEvents<> sent(*ngn::gtk::viewData(views.view(6)));

  gtk_widget_grab_focus(entry);
  auto focusInEntry = [&] {
    GtkWidget *focus = gtk_root_get_focus(gtk_widget_get_root(entry));
    return focus && (focus == entry || gtk_widget_is_ancestor(focus, entry));
  };
  REQUIRE(focusInEntry());
  views.update(config, withButton("Notes, 2"));
  CHECK(std::string(titleOf(bar)) == "Notes, 2");
  CHECK(gtk_widget_is_ancestor(entry, bar));
  CHECK(focusInEntry());
  CHECK(sent.count("topSearchBlur") == 0);

  // Text the app sets is not the user's, however long the field waits.
  views.backend->dispatchCommand(6, "setText", folly::dynamic::array("abc"));
  gint64 until = g_get_monotonic_time() + 400 * 1000;
  ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
  CHECK(sent.count("topChangeText") == 0);
  // What the user types is, as they type it.
  int position = -1;
  gtk_editable_insert_text(GTK_EDITABLE(entry), "d", -1, &position);
  CHECK(sent.count("topChangeText") == 1);
}

TEST_CASE("a sheet over a window that is not resizable is drawn over it") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views(true, 800, 600);
  gtk_window_set_resizable(GTK_WINDOW(views.window), FALSE);
  GtkWidget *overlay = ngn::gtk::chromeOf(views.surface)->overlay;
  auto modal = shadow(3, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{modal, MountedViews::kSurface}});
  GtkWidget *slot = views.backend->modals().slotOf(3);
  REQUIRE(slot);
  CHECK_FALSE(views.backend->modals().inDialog(3));
  CHECK(gtk_widget_is_ancestor(slot, overlay));
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, modal, 0), ShadowViewMutation::DeleteMutation(modal)});
}

TEST_CASE("Escape asks the modal in front to close, whichever layer's shortcut runs") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views(true, 800, 600);
  // A window that cannot be resized gets its modals as overlay layers on every libadwaita version,
  // never as AdwDialog sheets, so the layers' own Escape shortcuts and requestCloseFront always run.
  gtk_window_set_resizable(GTK_WINDOW(views.window), FALSE);
  auto back = shadow(3, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{back, MountedViews::kSurface}});
  auto front = shadow(5, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{front, MountedViews::kSurface}});
  SentEvents<ModalHostViewEventEmitter> backSent(*ngn::gtk::viewData(views.view(3)));
  SentEvents<ModalHostViewEventEmitter> frontSent(*ngn::gtk::viewData(views.view(5)));

  // The back modal's layer registered its Escape first, so GTK runs it first.
  GtkWidget *slot = views.backend->modals().slotOf(3);
  REQUIRE(slot);
  REQUIRE_FALSE(views.backend->modals().inDialog(3));
  GtkWidget *layer = gtk_widget_get_parent(slot) == ngn::gtk::chromeOf(views.surface)->overlay ? slot : gtk_widget_get_parent(slot);
  GListModel *controllers = gtk_widget_observe_controllers(layer);
  bool ran = false;
  for (guint i = 0; i < g_list_model_get_n_items(controllers) && !ran; ++i) {
    auto *controller = g_list_model_get_item(controllers, i);
    if (GTK_IS_SHORTCUT_CONTROLLER(controller)) {
      auto *shortcut = GTK_SHORTCUT(g_list_model_get_item(G_LIST_MODEL(controller), 0));
      ran = gtk_shortcut_action_activate(gtk_shortcut_get_action(shortcut), GtkShortcutActionFlags(0), layer, nullptr);
      g_object_unref(shortcut);
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  REQUIRE(ran);
  CHECK(frontSent.count("topRequestClose") == 1);
  CHECK(backSent.count("topRequestClose") == 0);
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, front, 1), ShadowViewMutation::DeleteMutation(front),
               ShadowViewMutation::RemoveMutation(MountedViews::kSurface, back, 0), ShadowViewMutation::DeleteMutation(back)});
}

TEST_CASE("a surface finalized with its window is the backend's no more, for a header or modal let go of later") {
  REQUIRE(ngn::testing::gtkReady());
  auto backend = std::make_shared<ngn::gtk::GtkBackend>();
  GtkWidget *window = adw_window_new();
  GtkWidget *surface = ngn::gtk::makeSurfaceWidget(7, nullptr);
  adw_window_set_content(ADW_WINDOW(window), ngn::gtk::wrapInChrome(surface));
  backend->addSurface(7, surface);
  REQUIRE(backend->surfaceWidget(7) == surface);
  gpointer alive = surface;
  g_object_add_weak_pointer(G_OBJECT(surface), &alive);
  gtk_window_destroy(GTK_WINDOW(window));
  REQUIRE(alive == nullptr);
  CHECK(backend->surfaceWidget(7) == nullptr);
}
