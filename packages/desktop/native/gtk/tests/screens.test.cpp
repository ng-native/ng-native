// The native stack's header in the window's AdwHeaderBar, and <modal> presented over the window,
// on GTK (screens.h). react-native-screens' props come through the library glue, which the test
// installs over props of its own, as the core's tests do.
#include "mounted-views.h"

#include "../app-windows.h"
#include "../screens.h"

#include "ngn/library-components.h"
#include "ngn/library-glue.h"
#include "ngn/screen-presentation.h"

#include <adwaita.h>
#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;

namespace {

struct HeaderProps final : ViewProps {
  ngn::HeaderBar bar;
};

struct ItemProps final : ViewProps {
  std::string type;
};

struct Glue {
  // The libraries' own glue is installed the first time their components are asked for, which
  // would replace this one in the first test to mount: it goes in first, and is what is restored.
  ngn::LibraryGlue saved = (ngn::libraryComponents(), ngn::libraryGlue());
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

namespace {

Props::Shared presented(const std::string &how, Tag anchor = 0) {
  auto props = std::make_shared<ngn::ScreenProps>();
  props->stackPresentation = how;
  props->anchor = static_cast<int>(anchor);
  return props;
}

ngn::BarButton barButton(const std::string &id, const std::string &title) {
  ngn::BarButton b;
  b.id = id;
  b.title = title;
  return b;
}

// The widgets under `root` that `match`, in order.
std::vector<GtkWidget *> findAll(GtkWidget *root, bool (*match)(GtkWidget *)) {
  std::vector<GtkWidget *> found;
  for (GtkWidget *c = gtk_widget_get_first_child(root); c; c = gtk_widget_get_next_sibling(c)) {
    if (match(c)) {
      found.push_back(c);
    }
    auto deeper = findAll(c, match);
    found.insert(found.end(), deeper.begin(), deeper.end());
  }
  return found;
}

bool isButton(GtkWidget *w) {
  return GTK_IS_BUTTON(w) && gtk_button_get_label(GTK_BUTTON(w)) != nullptr;
}

// What names a sheet: its AdwDialog, or libadwaita 1.4's backdrop.
GtkWidget *sheetOf(GtkWidget *slot) {
  for (GtkWidget *w = slot; w; w = gtk_widget_get_parent(w)) {
    if (gtk_widget_has_css_class(w, "ngn-backdrop") || std::string(G_OBJECT_TYPE_NAME(w)) == "AdwDialog") {
      return w;
    }
  }
  return nullptr;
}

bool named(GtkWidget *widget, const char *label) {
  char *error = gtk_test_accessible_check_property(GTK_ACCESSIBLE(widget), GTK_ACCESSIBLE_PROPERTY_LABEL, label);
  if (error) {
    MESSAGE(std::string(error));
    g_free(error);
  }
  return error == nullptr;
}

std::string labelOf(GtkWidget *button) {
  const char *label = gtk_button_get_label(GTK_BUTTON(button));
  return label ? label : "";
}

} // namespace

TEST_CASE("a screen presented with present() is a sheet over the window, its header the sheet's header bar") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 800, 600);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  auto firstConfig = shadow(4, "RNSScreenStackHeaderConfig", header("Notes"), {{0, 0}, {800, 44}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {firstConfig, 3}});

  auto editHeader = std::make_shared<HeaderProps>();
  editHeader->bar.title = "Edit";
  editHeader->bar.left = {barButton("cancel", "Cancel")};
  editHeader->bar.right = {barButton("save", "Save")};
  auto sheet = shadow(7, "RNSScreen", presented("formSheet"), {{0, 0}, {800, 600}});
  auto sheetConfig = shadow(8, "RNSScreenStackHeaderConfig", editHeader, {{0, 0}, {800, 44}});
  auto content = shadow(9, "View", nullptr, {{0, 0}, {480, 200}});
  mountAll(views, {{sheet, 2}, {sheetConfig, 7}, {content, 7}});
  views.backend->modals().settle();
  views.settle();

  // Out of the stack and into a presentation of its own.
  GtkWidget *slot = views.backend->modals().slotOf(7);
  REQUIRE(slot);
  CHECK(gtk_widget_get_parent(views.view(7)) == slot);
  CHECK_FALSE(gtk_widget_is_ancestor(views.view(7), views.view(2)));
  CHECK(views.backend->modals().popoverOf(7) == nullptr);
  // The header, drawn by the sheet: the title, Cancel at the start and Save, the default, at the end.
  GtkWidget *sheetHeader = views.backend->modals().sheetHeaderOf(7);
  REQUIRE(sheetHeader);
  CHECK(std::string(titleOf(sheetHeader)) == "Edit");
  auto buttons = findAll(sheetHeader, isButton);
  REQUIRE(buttons.size() == 2);
  CHECK(labelOf(buttons[0]) == "Cancel");
  CHECK(labelOf(buttons[1]) == "Save");
  CHECK_FALSE(gtk_widget_has_css_class(buttons[0], "suggested-action"));
  CHECK(gtk_widget_has_css_class(buttons[1], "suggested-action"));
  graphene_point_t origin{}, cancel{}, save{};
  REQUIRE(gtk_widget_compute_point(buttons[0], sheetHeader, &origin, &cancel));
  REQUIRE(gtk_widget_compute_point(buttons[1], sheetHeader, &origin, &save));
  CHECK(cancel.x < save.x);
  // Named by its title.
  GtkWidget *presentation = sheetOf(slot);
  REQUIRE(presentation);
  CHECK(named(presentation, "Edit"));

  // The header changing redraws the sheet's.
  auto renamed = std::make_shared<HeaderProps>(*editHeader);
  renamed->bar.title = "Rename";
  renamed->bar.left.clear();
  views.update(sheetConfig, renamed);
  views.backend->modals().settle();
  sheetHeader = views.backend->modals().sheetHeaderOf(7);
  REQUIRE(sheetHeader);
  CHECK(std::string(titleOf(sheetHeader)) == "Rename");
  CHECK(findAll(sheetHeader, isButton).size() == 1);
  CHECK(named(presentation, "Rename"));

  // Taken away: no presentation left.
  views.mount({ShadowViewMutation::RemoveMutation(2, sheet, 1), ShadowViewMutation::DeleteMutation(sheet)});
  CHECK(views.backend->modals().slotOf(7) == nullptr);
  CHECK(views.backend->modals().sheetHeaderOf(7) == nullptr);
}

TEST_CASE("a presentation with an anchor is a popover pointing at the anchor, and goes with the screen") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 800, 600);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  auto anchor = shadow(5, "View", nullptr, {{20, 20}, {80, 30}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {anchor, 3}});

  auto popover = shadow(7, "RNSScreen", presented("formSheet", 5), {{0, 0}, {800, 600}});
  auto content = shadow(9, "View", nullptr, {{0, 0}, {200, 100}});
  mountAll(views, {{popover, 2}, {content, 7}});
  views.backend->modals().settle();
  views.settle();

  GtkWidget *shown = views.backend->modals().popoverOf(7);
  REQUIRE(shown);
  CHECK(gtk_widget_get_parent(shown) == views.view(5));
  CHECK(gtk_popover_get_child(GTK_POPOVER(shown)) == views.backend->modals().slotOf(7));
  CHECK(gtk_widget_get_visible(shown));
  CHECK(views.backend->modals().sheetHeaderOf(7) == nullptr);

  views.mount({ShadowViewMutation::RemoveMutation(2, popover, 1), ShadowViewMutation::DeleteMutation(popover)});
  CHECK(views.backend->modals().popoverOf(7) == nullptr);
  CHECK(gtk_widget_get_first_child(views.view(5)) == nullptr);

  // A <modal> with an anchor is a popover too.
  auto anchored = std::make_shared<ngn::DesktopModalProps>();
  anchored->anchor = 5;
  auto modal = shadow(11, "ModalHostView", anchored, {{0, 0}, {800, 600}});
  mountAll(views, {{modal, 3}});
  views.backend->modals().settle();
  REQUIRE(views.backend->modals().popoverOf(11));
  CHECK(gtk_widget_get_parent(views.backend->modals().popoverOf(11)) == views.view(5));
  views.mount({ShadowViewMutation::RemoveMutation(3, modal, 1), ShadowViewMutation::DeleteMutation(modal)});
  CHECK(views.backend->modals().popoverOf(11) == nullptr);

  // An anchor that is not mounted leaves it a sheet.
  auto lost = shadow(10, "RNSScreen", presented("formSheet", 99), {{0, 0}, {800, 600}});
  mountAll(views, {{lost, 2}});
  views.backend->modals().settle();
  CHECK(views.backend->modals().popoverOf(10) == nullptr);
  CHECK(views.backend->modals().slotOf(10) != nullptr);
}

TEST_CASE("a bar button's menu is a menu button, and the header's colours reach its bar, title and buttons") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 400, 300);
  GtkWidget *bar = ngn::gtk::chromeOf(views.surface)->headerBar;
  auto props = std::make_shared<HeaderProps>();
  props->bar.title = "Notes";
  props->bar.color = colorFromRGBA(255, 0, 0, 255);
  props->bar.titleColor = colorFromRGBA(0, 0, 255, 255);
  props->bar.backgroundColor = colorFromRGBA(0, 255, 0, 255);
  ngn::BarButton sort = barButton("sort", "Sort");
  ngn::HeaderMenuItem menu;
  ngn::HeaderMenuItem byName;
  byName.title = "By name";
  byName.menuId = "name";
  byName.on = true;
  ngn::HeaderMenuItem byDate;
  byDate.title = "By date";
  byDate.menuId = "date";
  byDate.disabled = true;
  menu.items = {byName, byDate};
  sort.menu = menu;
  ngn::BarButton plain = barButton("add", "Add");
  plain.tint = colorFromRGBA(0, 0, 0, 255);
  props->bar.right = {sort, plain};
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {400, 300}});
  auto screen = shadow(3, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", props, {{0, 0}, {400, 44}});
  mountAll(views, {{stack, MountedViews::kSurface}, {screen, 2}, {config, 3}});

  // The bar button's, not the window's primary menu, hidden until the app has menus.
  auto menus = findAll(bar, [](GtkWidget *w) -> bool { return GTK_IS_MENU_BUTTON(w) && gtk_widget_get_visible(w); });
  REQUIRE(menus.size() == 1);
  GMenuModel *model = gtk_menu_button_get_menu_model(GTK_MENU_BUTTON(menus[0]));
  REQUIRE(model);
  REQUIRE(g_menu_model_get_n_items(model) == 2);
  // The disabled entry's action is off; the checked one's carries its state.
  GActionGroup *group = G_ACTION_GROUP(g_object_get_data(G_OBJECT(menus[0]), "ngn-menu-actions"));
  REQUIRE(group);
  auto actionOf = [model](int index) {
    char *action = nullptr;
    REQUIRE(g_menu_model_get_item_attribute(model, index, G_MENU_ATTRIBUTE_ACTION, "s", &action));
    std::string name = std::string(action).substr(4);
    g_free(action);
    return name;
  };
  CHECK_FALSE(g_action_group_get_action_enabled(group, actionOf(1).c_str()));
  CHECK(g_action_group_get_action_enabled(group, actionOf(0).c_str()));
  GVariant *state = g_action_group_get_action_state(group, actionOf(0).c_str());
  REQUIRE(state);
  CHECK(g_variant_get_boolean(state));
  g_variant_unref(state);

  auto red = ngn::gtk::colorClass("color", props->bar.color);
  auto green = ngn::gtk::colorClass("background-color", props->bar.backgroundColor);
  CHECK(gtk_widget_has_css_class(menus[0], red.c_str()));
  auto add = findAll(bar, [](GtkWidget *w) { return isButton(w) && labelOf(w) == "Add"; });
  REQUIRE(add.size() == 1);
  CHECK(gtk_widget_has_css_class(add[0], ngn::gtk::colorClass("color", plain.tint).c_str()));
  CHECK_FALSE(gtk_widget_has_css_class(add[0], red.c_str()));
  CHECK(gtk_widget_has_css_class(
      adw_header_bar_get_title_widget(ADW_HEADER_BAR(bar)), ngn::gtk::colorClass("color", props->bar.titleColor).c_str()));
  CHECK(gtk_widget_has_css_class(bar, green.c_str()));

  // The colour gone, its class goes from the bar.
  auto plainProps = std::make_shared<HeaderProps>();
  plainProps->bar.title = "Notes";
  views.update(config, plainProps);
  CHECK_FALSE(gtk_widget_has_css_class(bar, green.c_str()));
}

TEST_CASE("a window shows with no widget focused, unless one was focused before") {
  REQUIRE(ngn::testing::gtkReady());
  for (bool focusFirst : {false, true}) {
    CAPTURE(focusFirst);
    GtkWidget *window = gtk_window_new();
    GtkWidget *bar = adw_header_bar_new();
    GtkWidget *search = gtk_search_entry_new();
    adw_header_bar_pack_end(ADW_HEADER_BAR(bar), search);
    gtk_window_set_child(GTK_WINDOW(window), bar);
    bool entered = false;
    GtkEventController *focus = gtk_event_controller_focus_new();
    g_signal_connect(
        focus, "enter", G_CALLBACK(+[](GtkEventControllerFocus *, gpointer data) { *static_cast<bool *>(data) = true; }),
        &entered);
    gtk_widget_add_controller(search, focus);
    if (focusFirst) {
      gtk_window_set_focus(GTK_WINDOW(window), search);
    }
    ngn::gtk::presentWithoutInitialFocus(GTK_WINDOW(window));
    for (int i = 0; i < 50; ++i) {
      g_main_context_iteration(nullptr, FALSE);
    }
    GtkWidget *focused = gtk_root_get_focus(GTK_ROOT(window));
    CHECK(((focused == search) || (focused && gtk_widget_is_ancestor(focused, search))) == focusFirst);
    if (!focusFirst) {
      CHECK_FALSE(entered);
    }
    gtk_window_destroy(GTK_WINDOW(window));
  }
}
