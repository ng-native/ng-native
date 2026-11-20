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
#include <clocale>
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
  // With no history from the app, the pair pops the stack: forward has nowhere to go.
  REQUIRE(views.backend->headers().forwardButton(MountedViews::kSurface) != nullptr);
  CHECK_FALSE(gtk_widget_get_sensitive(views.backend->headers().forwardButton(MountedViews::kSurface)));
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

TEST_CASE("the window's history is the header bar's back and forward pair, each listing its entries") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 400, 300);
  auto &headers = views.backend->headers();
  std::vector<std::pair<ngn::NavigationDirection, int>> asked;
  headers.navigate = [&asked](SurfaceId, ngn::NavigationDirection direction, int steps) { asked.emplace_back(direction, steps); };
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {400, 300}});
  auto screen = shadow(3, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", header("Notes"), {{0, 0}, {400, 44}});
  mountAll(views, {{stack, MountedViews::kSurface}, {screen, 2}, {config, 3}});
  // Nothing to go back to, and no history: no pair.
  CHECK(headers.backButton(MountedViews::kSurface) == nullptr);

  using enum ngn::NavigationDirection;
  headers.setHistory(MountedViews::kSurface, ngn::WindowHistory{.back = {"Inbox", "Home"}, .forward = {"Sent"}});
  GtkWidget *back = headers.backButton(MountedViews::kSurface);
  GtkWidget *forward = headers.forwardButton(MountedViews::kSurface);
  REQUIRE(back);
  REQUIRE(forward);
  CHECK(gtk_widget_get_parent(back) == gtk_widget_get_parent(forward));
  CHECK(gtk_widget_get_next_sibling(back) == forward);
  CHECK(gtk_widget_is_ancestor(back, ngn::gtk::chromeOf(views.surface)->headerBar));
  CHECK(gtk_widget_get_sensitive(back));
  CHECK(gtk_widget_get_sensitive(forward));
  // A press goes one step through the history.
  g_signal_emit_by_name(back, "clicked");
  g_signal_emit_by_name(forward, "clicked");
  CHECK(asked == std::vector<std::pair<ngn::NavigationDirection, int>>{{Back, 1}, {Forward, 1}});

  // The list behind the back chevron: the entries that way, nearest first, each its steps away.
  asked.clear();
  REQUIRE(headers.showHistoryMenu(MountedViews::kSurface, Back));
  GtkWidget *popover = nullptr;
  for (GtkWidget *c = gtk_widget_get_first_child(back); c; c = gtk_widget_get_next_sibling(c)) {
    popover = GTK_IS_POPOVER_MENU(c) ? c : popover;
  }
  REQUIRE(popover);
  GMenuModel *menu = gtk_popover_menu_get_menu_model(GTK_POPOVER_MENU(popover));
  REQUIRE(g_menu_model_get_n_items(menu) == 1);
  GMenuModel *model = g_menu_model_get_item_link(menu, 0, G_MENU_LINK_SECTION);
  REQUIRE(model);
  REQUIRE(g_menu_model_get_n_items(model) == 2);
  auto attribute = [model](int index, const char *name) {
    char *value = nullptr;
    REQUIRE(g_menu_model_get_item_attribute(model, index, name, "s", &value));
    std::string text = value;
    g_free(value);
    return text;
  };
  CHECK(attribute(0, G_MENU_ATTRIBUTE_LABEL) == "Inbox");
  CHECK(attribute(1, G_MENU_ATTRIBUTE_LABEL) == "Home");
  CHECK(gtk_widget_activate_action(popover, attribute(1, G_MENU_ATTRIBUTE_ACTION).c_str(), nullptr));
  CHECK(asked == std::vector<std::pair<ngn::NavigationDirection, int>>{{Back, 2}});
  g_object_unref(model);

  // Nothing behind: the back chevron is off, and has no list.
  headers.setHistory(MountedViews::kSurface, ngn::WindowHistory{.back = {}, .forward = {"Sent"}});
  REQUIRE(headers.backButton(MountedViews::kSurface));
  CHECK_FALSE(gtk_widget_get_sensitive(headers.backButton(MountedViews::kSurface)));
  CHECK(gtk_widget_get_sensitive(headers.forwardButton(MountedViews::kSurface)));
  CHECK_FALSE(headers.showHistoryMenu(MountedViews::kSurface, Back));

  // The header's hideBackButton hides the pair.
  auto hiding = std::make_shared<HeaderProps>();
  hiding->bar.title = "Notes";
  hiding->bar.hideBackButton = true;
  views.update(config, hiding);
  CHECK(headers.backButton(MountedViews::kSurface) == nullptr);
  views.update(config, header("Notes"));
  CHECK(headers.forwardButton(MountedViews::kSurface) != nullptr);

  // An empty history, as the router reports once the window has none: no pair.
  headers.setHistory(MountedViews::kSurface, ngn::WindowHistory{});
  CHECK(headers.backButton(MountedViews::kSurface) == nullptr);

  // The surface gone, its history goes with it: a header shown again has no pair.
  headers.setHistory(MountedViews::kSurface, ngn::WindowHistory{.back = {"Inbox"}});
  REQUIRE(headers.backButton(MountedViews::kSurface));
  headers.removeSurface(MountedViews::kSurface);
  CHECK(headers.backButton(MountedViews::kSurface) == nullptr);
  headers.show(MountedViews::kSurface, ngn::ScreenStacks::FrontHeader{.config = 4, .screen = 3, .canGoBack = false});
  CHECK(headers.backButton(MountedViews::kSurface) == nullptr);
  CHECK(std::string(titleOf(ngn::gtk::chromeOf(views.surface)->headerBar)) == "Notes");
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

TEST_CASE("the presentation in front of a window is the one shown last, which Ctrl+W closes before the window") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views(true, 800, 600);
  auto *window = GTK_WINDOW(gtk_widget_get_root(views.surface));
  auto &modals = views.backend->modals();
  CHECK_FALSE(modals.front(window));
  // Presented in the other order from their tags.
  auto first = shadow(6, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{first, MountedViews::kSurface}});
  modals.settle();
  CHECK(modals.front(window) == 6);
  auto second = shadow(3, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{second, MountedViews::kSurface}});
  modals.settle();
  CHECK(modals.front(window) == 3);
  // Another window has none in front of it.
  GtkWidget *other = gtk_window_new();
  CHECK_FALSE(modals.front(GTK_WINDOW(other)));
  gtk_window_destroy(GTK_WINDOW(other));

  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, second, 1)});
  CHECK(modals.front(window) == 6);
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, first, 0)});
  CHECK_FALSE(modals.front(window));
  views.mount({ShadowViewMutation::DeleteMutation(first), ShadowViewMutation::DeleteMutation(second)});
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
  GMenuModel *model = ngn::testing::menuButtonModel(menus[0]);
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
  // The layer is the overlay's child that holds the slot: the cover itself, or a sheet's backdrop.
  GtkWidget *overlay = ngn::gtk::chromeOf(views.surface)->overlay;
  GtkWidget *layer = slot;
  while (layer && gtk_widget_get_parent(layer) != overlay) {
    layer = gtk_widget_get_parent(layer);
  }
  REQUIRE(layer);
  GListModel *controllers = gtk_widget_observe_controllers(layer);
  bool ran = false;
  for (guint i = 0; i < g_list_model_get_n_items(controllers) && !ran; ++i) {
    auto *controller = g_list_model_get_item(controllers, i);
    if (GTK_IS_SHORTCUT_CONTROLLER(controller)) {
      auto *shortcut = GTK_SHORTCUT(g_list_model_get_item(G_LIST_MODEL(controller), 0));
      // Return is consumed too while a modal is in front, so pick Escape's shortcut by its trigger.
      char *label = gtk_shortcut_trigger_to_string(gtk_shortcut_get_trigger(shortcut));
      if (std::string(label).find("Escape") != std::string::npos) {
        ran = gtk_shortcut_action_activate(gtk_shortcut_get_action(shortcut), GtkShortcutActionFlags(0), layer, nullptr);
      }
      g_free(label);
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

TEST_CASE("Return presses the default button of the modal in front, whichever layer's shortcut runs") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 800, 600);
  // Not resizable: the sheets are drawn over the window, not AdwDialogs.
  gtk_window_set_resizable(GTK_WINDOW(views.window), FALSE);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  auto firstConfig = shadow(4, "RNSScreenStackHeaderConfig", header("Notes"), {{0, 0}, {800, 44}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {firstConfig, 3}});

  auto withDefault = [](const std::string &id) {
    auto props = std::make_shared<HeaderProps>();
    props->bar.title = id;
    props->bar.right = {barButton(id, "Save")};
    return props;
  };
  auto back = shadow(7, "RNSScreen", presented("formSheet"), {{0, 0}, {800, 600}});
  auto backConfig = shadow(8, "RNSScreenStackHeaderConfig", withDefault("back-save"), {{0, 0}, {800, 44}});
  mountAll(views, {{back, 2}, {backConfig, 7}});
  views.backend->modals().settle();
  auto front = shadow(9, "RNSScreen", presented("formSheet"), {{0, 0}, {800, 600}});
  auto frontConfig = shadow(10, "RNSScreenStackHeaderConfig", withDefault("front-save"), {{0, 0}, {800, 44}});
  mountAll(views, {{front, 2}, {frontConfig, 9}});
  views.backend->modals().settle();
  REQUIRE_FALSE(views.backend->modals().inDialog(7));
  REQUIRE_FALSE(views.backend->modals().inDialog(9));
  SentEvents<> backSent(*ngn::gtk::viewData(views.view(8)));
  SentEvents<> frontSent(*ngn::gtk::viewData(views.view(10)));

  // The back sheet's layer registered its Return first, so GTK runs it first.
  GtkWidget *slot = views.backend->modals().slotOf(7);
  REQUIRE(slot);
  GtkWidget *overlay = ngn::gtk::chromeOf(views.surface)->overlay;
  GtkWidget *layer = slot;
  while (layer && gtk_widget_get_parent(layer) != overlay) {
    layer = gtk_widget_get_parent(layer);
  }
  REQUIRE(layer);
  GListModel *controllers = gtk_widget_observe_controllers(layer);
  bool ran = false;
  for (guint i = 0; i < g_list_model_get_n_items(controllers); ++i) {
    auto *controller = g_list_model_get_item(controllers, i);
    if (GTK_IS_SHORTCUT_CONTROLLER(controller)) {
      auto *shortcut = GTK_SHORTCUT(g_list_model_get_item(G_LIST_MODEL(controller), 0));
      char *label = gtk_shortcut_trigger_to_string(gtk_shortcut_get_trigger(shortcut));
      if (std::string(label).find("Return") != std::string::npos) {
        ran = gtk_shortcut_action_activate(gtk_shortcut_get_action(shortcut), GtkShortcutActionFlags(0), layer, nullptr);
      }
      g_free(label);
      g_object_unref(shortcut);
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  CHECK(ran);
  CHECK(frontSent.count("topPressHeaderBarButtonItem") == 1);
  CHECK(backSent.count("topPressHeaderBarButtonItem") == 0);
  views.mount({ShadowViewMutation::RemoveMutation(2, front, 2), ShadowViewMutation::DeleteMutation(front),
               ShadowViewMutation::RemoveMutation(2, back, 1), ShadowViewMutation::DeleteMutation(back)});
}

TEST_CASE("Return is the sheet's when it has no default button, so a default button behind it is not pressed") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 800, 600);
  gtk_window_set_resizable(GTK_WINDOW(views.window), FALSE);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  auto firstConfig = shadow(4, "RNSScreenStackHeaderConfig", header("Notes"), {{0, 0}, {800, 44}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {firstConfig, 3}});
  auto sheet = shadow(7, "RNSScreen", presented("formSheet"), {{0, 0}, {800, 600}});
  auto sheetConfig = shadow(8, "RNSScreenStackHeaderConfig", header("Plain"), {{0, 0}, {800, 44}});
  mountAll(views, {{sheet, 2}, {sheetConfig, 7}});
  views.backend->modals().settle();
  REQUIRE_FALSE(views.backend->modals().inDialog(7));

  GtkWidget *slot = views.backend->modals().slotOf(7);
  REQUIRE(slot);
  GtkWidget *overlay = ngn::gtk::chromeOf(views.surface)->overlay;
  GtkWidget *layer = slot;
  while (layer && gtk_widget_get_parent(layer) != overlay) {
    layer = gtk_widget_get_parent(layer);
  }
  REQUIRE(layer);
  GListModel *controllers = gtk_widget_observe_controllers(layer);
  bool found = false, consumed = false;
  for (guint i = 0; i < g_list_model_get_n_items(controllers); ++i) {
    auto *controller = g_list_model_get_item(controllers, i);
    if (GTK_IS_SHORTCUT_CONTROLLER(controller)) {
      auto *shortcut = GTK_SHORTCUT(g_list_model_get_item(G_LIST_MODEL(controller), 0));
      char *label = gtk_shortcut_trigger_to_string(gtk_shortcut_get_trigger(shortcut));
      if (std::string(label).find("Return") != std::string::npos) {
        found = true;
        consumed = gtk_shortcut_action_activate(gtk_shortcut_get_action(shortcut), GtkShortcutActionFlags(0), layer, nullptr);
      }
      g_free(label);
      g_object_unref(shortcut);
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  REQUIRE(found);
  CHECK(consumed);
  views.mount({ShadowViewMutation::RemoveMutation(2, sheet, 1), ShadowViewMutation::DeleteMutation(sheet)});
}

TEST_CASE("a colour's CSS rule writes its alpha with a point in a locale that writes a comma") {
  std::string saved = setlocale(LC_NUMERIC, nullptr);
  struct Restore {
    std::string locale;
    ~Restore() { setlocale(LC_NUMERIC, locale.c_str()); }
  } restore{saved};
  if (!setlocale(LC_NUMERIC, "de_DE.UTF-8")) {
    MESSAGE("de_DE.UTF-8 is not installed");
    return;
  }
  std::string rule = ngn::gtk::colorRule("ngn-x", "color", 1.0f, 0.0f, 0.0f, 0.5f);
  CHECK(rule == ".ngn-x { color: rgba(255, 0, 0, 0.500); }");
}

TEST_CASE("a disabled submenu leaves none of its entries to choose") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 400, 300);
  GtkWidget *bar = ngn::gtk::chromeOf(views.surface)->headerBar;
  auto props = std::make_shared<HeaderProps>();
  props->bar.title = "Notes";
  ngn::BarButton more = barButton("more", "More");
  ngn::HeaderMenuItem leaf;
  leaf.title = "Rename";
  leaf.menuId = "rename";
  ngn::HeaderMenuItem nested;
  nested.title = "Nested";
  nested.items = {leaf};
  ngn::HeaderMenuItem sub;
  sub.title = "Edit";
  sub.disabled = true;
  sub.items = {leaf, nested};
  ngn::HeaderMenuItem open;
  open.title = "Open";
  open.items = {leaf};
  more.menu = ngn::HeaderMenuItem{};
  more.menu->items = {sub, open};
  props->bar.right = {more};
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {400, 300}});
  auto screen = shadow(3, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", props, {{0, 0}, {400, 44}});
  mountAll(views, {{stack, MountedViews::kSurface}, {screen, 2}, {config, 3}});

  auto menus = findAll(bar, [](GtkWidget *w) -> bool { return GTK_IS_MENU_BUTTON(w) && gtk_widget_get_visible(w); });
  REQUIRE(menus.size() == 1);
  GMenuModel *model = ngn::testing::menuButtonModel(menus[0]);
  auto *group = G_ACTION_GROUP(g_object_get_data(G_OBJECT(menus[0]), "ngn-menu-actions"));
  REQUIRE((model && group));
  auto enabled = [&](GMenuModel *menu, int index) {
    char *action = nullptr;
    REQUIRE(g_menu_model_get_item_attribute(menu, index, G_MENU_ATTRIBUTE_ACTION, "s", &action));
    bool on = g_action_group_get_action_enabled(group, std::string(action).substr(4).c_str());
    g_free(action);
    return on;
  };
  GMenuModel *disabled = g_menu_model_get_item_link(model, 0, G_MENU_LINK_SUBMENU);
  GMenuModel *deeper = g_menu_model_get_item_link(disabled, 1, G_MENU_LINK_SUBMENU);
  GMenuModel *enabledSub = g_menu_model_get_item_link(model, 1, G_MENU_LINK_SUBMENU);
  REQUIRE((disabled && deeper && enabledSub));
  CHECK_FALSE(enabled(disabled, 0));
  CHECK_FALSE(enabled(deeper, 0));
  CHECK(enabled(enabledSub, 0));
  g_object_unref(disabled);
  g_object_unref(deeper);
  g_object_unref(enabledSub);
}

TEST_CASE("two submenus with one title in a bar button's menu each open their own entries") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 400, 300);
  GtkWidget *bar = ngn::gtk::chromeOf(views.surface)->headerBar;
  auto props = std::make_shared<HeaderProps>();
  props->bar.title = "Notes";
  ngn::BarButton more = barButton("more", "More");
  ngn::HeaderMenuItem open;
  open.title = "Open";
  open.menuId = "open";
  ngn::HeaderMenuItem exportItem;
  exportItem.title = "Export";
  exportItem.menuId = "export";
  ngn::HeaderMenuItem first;
  first.title = "File";
  first.items = {open};
  ngn::HeaderMenuItem second;
  second.title = "File";
  second.items = {exportItem};
  more.menu = ngn::HeaderMenuItem{};
  more.menu->items = {first, second};
  props->bar.right = {more};
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {400, 300}});
  auto screen = shadow(3, "RNSScreen", nullptr, {{0, 0}, {400, 300}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", props, {{0, 0}, {400, 44}});
  mountAll(views, {{stack, MountedViews::kSurface}, {screen, 2}, {config, 3}});

  auto menus = findAll(bar, [](GtkWidget *w) -> bool { return GTK_IS_MENU_BUTTON(w) && gtk_widget_get_visible(w); });
  REQUIRE(menus.size() == 1);
  GtkPopover *popover = gtk_menu_button_get_popover(GTK_MENU_BUTTON(menus[0]));
  REQUIRE(GTK_IS_POPOVER_MENU(popover));
  // A sliding menu would open both by the one title, so the second would show Open.
  CHECK_FALSE(ngn::testing::sharedPageName(GTK_WIDGET(popover)));
  GMenuModel *model = ngn::testing::menuButtonModel(menus[0]);
  REQUIRE(model);
  REQUIRE(g_menu_model_get_n_items(model) == 2);
  auto entryOf = [model](int index) {
    GMenuModel *submenu = g_menu_model_get_item_link(model, index, G_MENU_LINK_SUBMENU);
    char *label = nullptr;
    REQUIRE(submenu);
    REQUIRE(g_menu_model_get_item_attribute(submenu, 0, G_MENU_ATTRIBUTE_LABEL, "s", &label));
    std::string entry = label;
    g_free(label);
    g_object_unref(submenu);
    return entry;
  };
  CHECK(entryOf(0) == "Open");
  CHECK(entryOf(1) == "Export");
}

TEST_CASE("an anchor the stack has covered leaves a presentation a sheet, not a popover nobody sees") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 800, 600);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  auto anchor = shadow(5, "View", nullptr, {{20, 20}, {80, 30}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {anchor, 3}});
  views.backend->setCovered(MountedViews::kSurface, 3, true);

  auto sheet = shadow(7, "RNSScreen", presented("formSheet", 5), {{0, 0}, {800, 600}});
  mountAll(views, {{sheet, 2}});
  views.backend->modals().settle();
  CHECK(views.backend->modals().popoverOf(7) == nullptr);
  CHECK(views.backend->modals().slotOf(7) != nullptr);
  views.mount({ShadowViewMutation::RemoveMutation(2, sheet, 1), ShadowViewMutation::DeleteMutation(sheet)});
}

TEST_CASE("a popover presented before its window is shown stays a popover, and shows with the window") {
  REQUIRE(ngn::testing::gtkReady());
  int criticals = 0;
  // Removed on every exit path: runUntil throws on a timeout, and the handler holds &criticals.
  struct Handler {
    guint id;
    ~Handler() {
      g_log_remove_handler("Gtk", id);
    }
  } handler{g_log_set_handler("Gtk", G_LOG_LEVEL_CRITICAL, [](const gchar *, GLogLevelFlags, const gchar *, gpointer count) {
    ++*static_cast<int *>(count);
  }, &criticals)};
  Glue glue;
  MountedViews views(true, 800, 600);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  auto anchor = shadow(5, "View", nullptr, {{20, 20}, {80, 30}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {anchor, 3}});
  // As at launch: the first mount settles the modals before GtkWindows::didMount shows the window.
  gtk_widget_set_visible(views.window, FALSE);
  REQUIRE_FALSE(gtk_widget_get_mapped(views.surface));

  auto popover = shadow(7, "RNSScreen", presented("formSheet", 5), {{0, 0}, {800, 600}});
  auto content = shadow(9, "View", nullptr, {{0, 0}, {200, 100}});
  mountAll(views, {{popover, 2}, {content, 7}});
  views.backend->modals().settle();
  GtkWidget *shown = views.backend->modals().popoverOf(7);
  REQUIRE(shown);

  gtk_window_present(GTK_WINDOW(views.window));
  ngn::testing::runUntil([shown] { return gtk_widget_get_mapped(shown); });
  CHECK(criticals == 0);
  views.mount({ShadowViewMutation::RemoveMutation(2, popover, 1), ShadowViewMutation::DeleteMutation(popover)});
  CHECK(views.backend->modals().popoverOf(7) == nullptr);
}

TEST_CASE("a popover GTK closed stays up while the app has not unmounted its modal") {
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
  REQUIRE(gtk_widget_get_visible(shown));

  // A click outside hides it, and asks the app; the app has not answered.
  gtk_popover_popdown(GTK_POPOVER(shown));
  ngn::testing::runUntil([shown] { return gtk_widget_get_visible(shown); });
  CHECK(gtk_widget_get_visible(shown));

  // The app accepts: it goes.
  views.mount({ShadowViewMutation::RemoveMutation(2, popover, 1), ShadowViewMutation::DeleteMutation(popover)});
  CHECK(views.backend->modals().popoverOf(7) == nullptr);
}

TEST_CASE("a popover opens over a window with nothing focused without a GTK critical, and a field in it takes the focus") {
  REQUIRE(ngn::testing::gtkReady());
  int criticals = 0;
  // Removed on every exit path: runUntil throws on a timeout, and the handler holds &criticals.
  struct Handler {
    guint id;
    ~Handler() {
      g_log_remove_handler("Gtk", id);
    }
  } handler{g_log_set_handler("Gtk", G_LOG_LEVEL_CRITICAL, [](const gchar *, GLogLevelFlags, const gchar *, gpointer count) {
    ++*static_cast<int *>(count);
  }, &criticals)};
  Glue glue;
  MountedViews views(true, 800, 600);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  auto anchor = shadow(5, "View", nullptr, {{20, 20}, {80, 30}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {anchor, 3}});
  GtkRoot *root = gtk_widget_get_root(views.view(5));
  REQUIRE(root);
  REQUIRE(gtk_root_get_focus(root) == nullptr);

  // Nothing in it takes the focus: it holds the focus itself, as it opens and as it opens again.
  auto popover = shadow(7, "RNSScreen", presented("formSheet", 5), {{0, 0}, {800, 600}});
  auto content = shadow(9, "View", nullptr, {{0, 0}, {200, 100}});
  mountAll(views, {{popover, 2}, {content, 7}});
  views.backend->modals().settle();
  views.settle();
  GtkWidget *shown = views.backend->modals().popoverOf(7);
  REQUIRE(shown);
  REQUIRE(gtk_widget_get_visible(shown));
  CHECK(gtk_root_get_focus(root) == shown);
  gtk_popover_popdown(GTK_POPOVER(shown));
  ngn::testing::runUntil([shown] { return gtk_widget_get_visible(shown); });
  CHECK(gtk_root_get_focus(root) == shown);
  CHECK(criticals == 0);
  views.mount({ShadowViewMutation::RemoveMutation(2, popover, 1), ShadowViewMutation::DeleteMutation(popover)});
  CHECK(gtk_root_get_focus(root) == nullptr);

  // A field in it still takes the focus as it opens.
  auto withField = shadow(11, "RNSScreen", presented("formSheet", 5), {{0, 0}, {800, 600}});
  auto field = shadow(13, "TextInput", ngn::testing::textInputProps(folly::dynamic::object()), {{10, 10}, {150, 40}});
  mountAll(views, {{withField, 2}, {field, 11}});
  views.backend->modals().settle();
  views.settle();
  REQUIRE(views.backend->modals().popoverOf(11));
  GtkWidget *focus = gtk_root_get_focus(root);
  REQUIRE(focus);
  CHECK((focus == views.view(13) || gtk_widget_is_ancestor(focus, views.view(13))));
  views.mount({ShadowViewMutation::RemoveMutation(2, withField, 1), ShadowViewMutation::DeleteMutation(withField)});

  // Focus elsewhere in the window stays there while one with nothing to focus is up, as GTK leaves it.
  gtk_widget_set_focusable(views.view(5), TRUE);
  REQUIRE(gtk_widget_grab_focus(views.view(5)));
  auto empty = shadow(15, "RNSScreen", presented("formSheet", 5), {{0, 0}, {800, 600}});
  mountAll(views, {{empty, 2}});
  views.backend->modals().settle();
  views.settle();
  REQUIRE(views.backend->modals().popoverOf(15));
  CHECK(gtk_root_get_focus(root) == views.view(5));
  views.mount({ShadowViewMutation::RemoveMutation(2, empty, 1), ShadowViewMutation::DeleteMutation(empty)});
  CHECK(criticals == 0);
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

namespace {

// Whether a click in the middle of `widget` reaches it, or something in it.
bool takesPointer(GtkWidget *window, GtkWidget *widget) {
  graphene_point_t middle{static_cast<float>(gtk_widget_get_width(widget)) / 2, static_cast<float>(gtk_widget_get_height(widget)) / 2};
  graphene_point_t at{};
  if (!gtk_widget_compute_point(widget, window, &middle, &at)) {
    return false;
  }
  GtkWidget *picked = gtk_widget_pick(window, at.x, at.y, GTK_PICK_DEFAULT);
  return picked && (picked == widget || gtk_widget_is_ancestor(picked, widget));
}

// Whether Tab, walked round the window's GTK focus chain, reaches `widget` or something in it.
bool reachedByTab(GtkWidget *window, GtkWidget *widget) {
  for (int i = 0; i < 60; ++i) {
    gtk_widget_child_focus(window, GTK_DIR_TAB_FORWARD);
    GtkWidget *focus = gtk_root_get_focus(GTK_ROOT(window));
    if (focus && (focus == widget || gtk_widget_is_ancestor(focus, widget))) {
      return true;
    }
  }
  return false;
}

GtkWidget *buttonLabelled(GtkWidget *root, const std::string &label) {
  for (GtkWidget *button : findAll(root, isButton)) {
    if (labelOf(button) == label) {
      return button;
    }
  }
  return nullptr;
}

bool isWindowControlButton(GtkWidget *w) {
  return GTK_IS_BUTTON(w) && gtk_widget_get_ancestor(w, GTK_TYPE_WINDOW_CONTROLS);
}

ShadowView focusableView(Tag tag, Rect frame) {
  return MountedViews::shadow(tag, "View", ngn::testing::desktopViewProps(folly::dynamic::object("focusable", true)), frame);
}

} // namespace

TEST_CASE("a cover or a drawn sheet holds the rest of the window still, its window controls aside, until it goes") {
  REQUIRE(ngn::testing::gtkReady());
  Glue glue;
  MountedViews views(true, 800, 600);
  // Not resizable: the sheet is drawn over the window on every libadwaita, not an AdwDialog.
  gtk_window_set_resizable(GTK_WINDOW(views.window), FALSE);
  GtkWidget *window = views.window;
  GtkWidget *bar = ngn::gtk::chromeOf(views.surface)->headerBar;
  auto notes = std::make_shared<HeaderProps>();
  notes->bar.title = "Notes";
  notes->bar.right = {barButton("add", "Add")};
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  auto config = shadow(4, "RNSScreenStackHeaderConfig", notes, {{0, 0}, {800, 44}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {config, 3}, {focusableView(5, {{20, 80}, {100, 30}}), 3}});
  views.settle();
  GtkWidget *add = buttonLabelled(bar, "Add");
  REQUIRE(add);
  // GTK's macOS backend (the Mac's dev loop) draws the window's own buttons, not GTK ones.
  auto controls = findAll(bar, isWindowControlButton);
  if (std::string(G_OBJECT_TYPE_NAME(gdk_display_get_default())) != "GdkMacosDisplay") {
    REQUIRE_FALSE(controls.empty());
  }
  CHECK(takesPointer(window, add));
  CHECK(reachedByTab(window, add));
  CHECK(reachedByTab(window, views.view(5)));

  // A drawn sheet over it.
  auto modal = shadow(6, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{modal, MountedViews::kSurface}, {focusableView(7, {{0, 0}, {100, 30}}), 6}});
  views.backend->modals().settle();
  views.settle();
  REQUIRE_FALSE(views.backend->modals().inDialog(6));
  CHECK_FALSE(takesPointer(window, add));
  CHECK_FALSE(reachedByTab(window, add));
  CHECK_FALSE(reachedByTab(window, views.view(5)));
  CHECK(reachedByTab(window, views.view(7)));
  // The window still closes, moves and resizes.
  for (GtkWidget *control : controls) {
    CHECK(takesPointer(window, control));
  }
  // An item the header gains while the sheet is up is held too.
  auto more = std::make_shared<HeaderProps>(*notes);
  more->bar.right = {barButton("add", "Add"), barButton("share", "Share")};
  views.update(config, more);
  views.settle();
  GtkWidget *share = buttonLabelled(bar, "Share");
  REQUIRE(share);
  CHECK_FALSE(takesPointer(window, share));
  CHECK_FALSE(reachedByTab(window, share));

  // Gone: the window takes input again.
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, modal, 1), ShadowViewMutation::DeleteMutation(modal)});
  views.settle();
  CHECK(takesPointer(window, share));
  CHECK(reachedByTab(window, share));
  CHECK(reachedByTab(window, views.view(5)));

  // A cover holds it the same way, and a sheet over the cover holds the cover too.
  auto cover = shadow(8, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  views.mount({ShadowViewMutation::CreateMutation(cover)});
  ngn::DesktopProps asCover;
  asCover.presentation = ngn::ModalPresentation::Cover;
  views.backend->updateDesktopProps(MountedViews::kSurface, 8, asCover);
  views.mount({ShadowViewMutation::InsertMutation(MountedViews::kSurface, cover, 1)});
  mountAll(views, {{focusableView(9, {{0, 0}, {100, 30}}), 8}});
  views.backend->modals().settle();
  views.settle();
  REQUIRE(views.backend->modals().slotOf(8));
  CHECK_FALSE(takesPointer(window, share));
  CHECK_FALSE(reachedByTab(window, share));
  CHECK_FALSE(reachedByTab(window, views.view(5)));
  CHECK(reachedByTab(window, views.view(9)));
  auto over = shadow(10, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{over, MountedViews::kSurface}, {focusableView(11, {{0, 0}, {100, 30}}), 10}});
  views.backend->modals().settle();
  views.settle();
  CHECK(reachedByTab(window, views.view(11)));
  CHECK_FALSE(reachedByTab(window, views.view(9)));
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, over, 2), ShadowViewMutation::DeleteMutation(over)});
  views.settle();
  CHECK(reachedByTab(window, views.view(9)));
  CHECK_FALSE(reachedByTab(window, share));
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, cover, 1), ShadowViewMutation::DeleteMutation(cover)});
  views.settle();
  CHECK(takesPointer(window, share));
  CHECK(reachedByTab(window, views.view(5)));
}

TEST_CASE("a drawn sheet with nothing to focus takes the focus from a background field, without a Tab first") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views(true, 800, 600);
  gtk_window_set_resizable(GTK_WINDOW(views.window), FALSE);
  auto stack = shadow(2, "RNSScreenStack", nullptr, {{0, 0}, {800, 600}});
  auto first = shadow(3, "RNSScreen", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{stack, MountedViews::kSurface}, {first, 2}, {focusableView(5, {{20, 80}, {100, 30}}), 3}});
  views.settle();
  GtkWidget *field = views.view(5);
  gtk_window_set_focus(GTK_WINDOW(views.window), field);
  REQUIRE(gtk_root_get_focus(GTK_ROOT(views.window)) == field);
  auto modal = shadow(6, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
  mountAll(views, {{modal, MountedViews::kSurface}});
  views.backend->modals().settle();
  views.settle();
  REQUIRE_FALSE(views.backend->modals().inDialog(6));
  GtkWidget *slot = views.backend->modals().slotOf(6);
  REQUIRE(slot);
  GtkWidget *focus = gtk_root_get_focus(GTK_ROOT(views.window));
  CHECK(focus != field);
  CHECK(focus == slot);
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, modal, 1), ShadowViewMutation::DeleteMutation(modal)});
}

TEST_CASE("a cover holds the menus still: the menu bar takes nothing, and F10 opens no primary menu") {
  REQUIRE(ngn::testing::gtkReady());
  for (auto placement : {ngn::MenuPlacement::MenuBar, ngn::MenuPlacement::PrimaryMenu}) {
    CAPTURE(static_cast<int>(placement));
    MountedViews views(true, 800, 600, {.menus = placement});
    const auto *chrome = ngn::gtk::chromeOf(views.surface);
    auto cover = shadow(3, "ModalHostView", nullptr, {{0, 0}, {800, 600}});
    views.mount({ShadowViewMutation::CreateMutation(cover)});
    ngn::DesktopProps asCover;
    asCover.presentation = ngn::ModalPresentation::Cover;
    views.backend->updateDesktopProps(MountedViews::kSurface, 3, asCover);
    views.mount({ShadowViewMutation::InsertMutation(MountedViews::kSurface, cover, 0)});
    views.backend->modals().settle();
    REQUIRE(views.backend->modals().slotOf(3));
    auto menusTakeInput = [chrome] {
      return chrome->menuBar ? gtk_widget_get_sensitive(chrome->menuBar) != FALSE
                             : gtk_menu_button_get_primary(GTK_MENU_BUTTON(chrome->primaryMenu)) != FALSE;
    };
    CHECK_FALSE(menusTakeInput());
    views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, cover, 0), ShadowViewMutation::DeleteMutation(cover)});
    CHECK(menusTakeInput());
  }
}
