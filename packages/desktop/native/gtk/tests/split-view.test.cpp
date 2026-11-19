// `<split-view>` and its source lists on GTK (split-view.h): an AdwNavigationSplitView whose
// collapse the core decides, and the sections drawn as a GtkListBox.
#include "mounted-views.h"

#include "../screens.h"
#include "../split-view.h"

#include "ngn/split-view.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <map>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::MountedViews;
using ngn::testing::parsedProps;

namespace {

ShadowView view(Tag tag, const char *component, Props::Shared props, Rect frame) {
  return MountedViews::shadow(tag, component, std::move(props), frame);
}

Props::Shared sidebarProps(bool collapsed) {
  return parsedProps<ngn::SidebarComponentDescriptor>(dynamic::object("collapsed", collapsed));
}

Props::Shared item(const char *label, bool selected) {
  return parsedProps<ngn::SidebarItemComponentDescriptor>(dynamic::object("label", label)("selected", selected));
}

// A window's split view: the sidebar (3) with a titled, collapsible section (5) of two items (6, 7),
// and the content pane (4).
struct Split {
  MountedViews views{true, 800, 500};
  ShadowView split = view(2, "NgNativeSplitView", nullptr, {{0, 0}, {800, 500}});
  ShadowView sidebar = view(3, "NgNativeSidebar", sidebarProps(false), {{0, 0}, {240, 500}});
  ShadowView content = view(4, "NgNativeSplitContent", nullptr, {{240, 0}, {560, 500}});
  ShadowView section = view(
      5, "NgNativeSidebarSection",
      parsedProps<ngn::SidebarSectionComponentDescriptor>(dynamic::object("title", "Mailboxes")("collapsible", true)),
      {{0, 0}, {240, 84}});
  ShadowView inbox = view(6, "NgNativeSidebarItem", item("Inbox", false), {{0, 28}, {240, 28}});
  ShadowView sent = view(7, "NgNativeSidebarItem", item("Sent", true), {{0, 56}, {240, 28}});

  Split() {
    ShadowViewMutationList mutations;
    for (const auto *v : {&split, &sidebar, &content, &section, &inbox, &sent}) {
      mutations.push_back(ShadowViewMutation::CreateMutation(*v));
    }
    mutations.push_back(ShadowViewMutation::InsertMutation(MountedViews::kSurface, split, 0));
    mutations.push_back(ShadowViewMutation::InsertMutation(2, sidebar, 0));
    mutations.push_back(ShadowViewMutation::InsertMutation(2, content, 1));
    mutations.push_back(ShadowViewMutation::InsertMutation(3, section, 0));
    mutations.push_back(ShadowViewMutation::InsertMutation(5, inbox, 0));
    mutations.push_back(ShadowViewMutation::InsertMutation(5, sent, 1));
    views.mount(std::move(mutations));
  }

  ngn::gtk::SplitViews &splits() {
    return views.backend->splitViews();
  }
  AdwNavigationSplitView *widget() {
    return ADW_NAVIGATION_SPLIT_VIEW(splits().splitWidget(2));
  }
  bool collapsed() {
    return adw_navigation_split_view_get_collapsed(widget());
  }
  bool showsContent() {
    return adw_navigation_split_view_get_show_content(widget());
  }
};

std::vector<GtkWidget *> rowsOf(GtkWidget *box) {
  std::vector<GtkWidget *> rows;
  for (GtkWidget *c = gtk_widget_get_first_child(box); c; c = gtk_widget_get_next_sibling(c)) {
    if (GTK_IS_LIST_BOX_ROW(c)) {
      rows.push_back(c);
    }
  }
  return rows;
}

} // namespace

TEST_CASE("a window's split view is an AdwNavigationSplitView holding its panes, each sized by its slot") {
  REQUIRE(ngn::testing::gtkReady());
  Split s;
  REQUIRE(s.widget());
  CHECK(gtk_widget_is_ancestor(s.views.view(3), GTK_WIDGET(s.widget())));
  CHECK(gtk_widget_is_ancestor(s.views.view(4), GTK_WIDGET(s.widget())));
  CHECK_FALSE(s.collapsed());
  // Each pane hears the size its page gives it, the content wider than the sidebar.
  ngn::testing::runUntil([&] { return s.splits().paneSize(3) && s.splits().paneSize(4); });
  CHECK(s.splits().paneSize(3)->width >= 150);
  CHECK(s.splits().paneSize(4)->width > s.splits().paneSize(3)->width);
  // The breakpoint is the core's compact width, the sidebar's narrowest plus the content's.
  char *condition = adw_breakpoint_condition_to_string(adw_breakpoint_get_condition(s.splits().breakpoint(2)));
  CHECK(std::string(condition) == "max-width: 509px");
  g_free(condition);
  // The window's header bar has the sidebar button.
  CHECK(s.views.backend->headers().sidebarButton(MountedViews::kSurface) != nullptr);

  // Full height: the window's header bar is over the content pane, the sidebar has one of its own,
  // and both start at the window's top edge.
  const auto *chrome = ngn::gtk::chromeOf(s.views.surface);
  REQUIRE(chrome);
  GtkWidget *over = gtk_widget_get_ancestor(chrome->headerBar, ADW_TYPE_TOOLBAR_VIEW);
  CHECK(over != chrome->toolbarView);
  CHECK(gtk_widget_is_ancestor(over, GTK_WIDGET(s.widget())));
  CHECK(gtk_widget_is_ancestor(s.views.view(4), over));
  CHECK_FALSE(gtk_widget_is_ancestor(s.views.view(3), over));
  GtkWidget *sidebarToolbar = gtk_widget_get_ancestor(s.views.view(3), ADW_TYPE_TOOLBAR_VIEW);
  CHECK(sidebarToolbar != chrome->toolbarView);
  CHECK(gtk_widget_is_ancestor(sidebarToolbar, GTK_WIDGET(s.widget())));
  s.views.settle();
  graphene_point_t origin{0, 0}, headerTop, sidebarTop;
  REQUIRE(gtk_widget_compute_point(chrome->headerBar, s.views.window, &origin, &headerTop));
  REQUIRE(gtk_widget_compute_point(sidebarToolbar, s.views.window, &origin, &sidebarTop));
  // Within its edge: a header bar left with only its title (the sidebar button is over the sidebar)
  // measures 1px taller than its top bar on libadwaita 1.4, which the bar's top clips.
  CHECK(headerTop.y <= 0);
  CHECK(headerTop.y >= -1);
  CHECK(sidebarTop.y == 0);
  // The sidebar's pane starts under its own header bar.
  graphene_point_t paneTop;
  REQUIRE(gtk_widget_compute_point(s.views.view(3), s.views.window, &origin, &paneTop));
  CHECK(paneTop.y > 0);

  // The split view gone, so are its widget and the button, and the header bar is over the whole
  // window again.
  s.views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, s.split, 0), ShadowViewMutation::DeleteMutation(s.split)});
  CHECK(s.splits().splitWidget(2) == nullptr);
  CHECK(s.views.backend->headers().sidebarButton(MountedViews::kSurface) == nullptr);
  CHECK(gtk_widget_get_ancestor(chrome->headerBar, ADW_TYPE_TOOLBAR_VIEW) == chrome->toolbarView);
}

TEST_CASE("Show Sidebar collapses the sidebar while wide and swaps the stack's front pane while compact") {
  REQUIRE(ngn::testing::gtkReady());
  Split s;
  // Wide: collapsed is the content alone.
  CHECK(s.splits().toggle(MountedViews::kSurface));
  CHECK(s.collapsed());
  CHECK(s.showsContent());
  CHECK(s.splits().toggle(MountedViews::kSurface));
  CHECK_FALSE(s.collapsed());

  // The app collapsing it does the same.
  s.views.update(s.sidebar, sidebarProps(true));
  CHECK(s.collapsed());
  s.views.update(s.sidebar, sidebarProps(false));
  CHECK_FALSE(s.collapsed());

  // Compact: a stack with the content in front, Show Sidebar brings the sidebar forward, and a
  // choice in it the content again.
  s.splits().setCompact(2, true);
  CHECK(s.collapsed());
  CHECK(s.showsContent());
  CHECK(s.splits().toggle(MountedViews::kSurface));
  CHECK_FALSE(s.showsContent());
  s.splits().chose(3, 6);
  CHECK(s.showsContent());
  // Wide again: side by side.
  s.splits().setCompact(2, false);
  CHECK_FALSE(s.collapsed());
}

namespace {

// The header bar `widget` is packed in.
GtkWidget *headerBarOf(GtkWidget *widget) {
  return widget ? gtk_widget_get_ancestor(widget, ADW_TYPE_HEADER_BAR) : nullptr;
}

} // namespace

TEST_CASE("the sidebar button sits over the full-height sidebar beside the content, and in the window's header bar once it folds") {
  REQUIRE(ngn::testing::gtkReady());
  Split s;
  s.views.settle();
  const auto *chrome = ngn::gtk::chromeOf(s.views.surface);
  auto &headers = s.views.backend->headers();
  GtkWidget *sidebarToolbar = gtk_widget_get_ancestor(s.views.view(3), ADW_TYPE_TOOLBAR_VIEW);
  REQUIRE(sidebarToolbar);
  CHECK(gtk_widget_is_ancestor(headers.sidebarButton(MountedViews::kSurface), sidebarToolbar));
  CHECK(headerBarOf(headers.sidebarButton(MountedViews::kSurface)) != chrome->headerBar);
  // Collapsed, the sidebar is out of sight: the button is in the window's header bar.
  CHECK(s.splits().toggle(MountedViews::kSurface));
  CHECK(headerBarOf(headers.sidebarButton(MountedViews::kSurface)) == chrome->headerBar);
  CHECK(s.splits().toggle(MountedViews::kSurface));
  CHECK(gtk_widget_is_ancestor(headers.sidebarButton(MountedViews::kSurface), sidebarToolbar));
  // A compact window stacks the panes: the window's header bar again.
  s.splits().setCompact(2, true);
  CHECK(headerBarOf(headers.sidebarButton(MountedViews::kSurface)) == chrome->headerBar);
  s.splits().setCompact(2, false);
  CHECK(gtk_widget_is_ancestor(headers.sidebarButton(MountedViews::kSurface), sidebarToolbar));
}

TEST_CASE("a cover beside a full-height split view starts below both header bars, which stay the window's") {
  REQUIRE(ngn::testing::gtkReady());
  Split s;
  s.views.settle();
  const auto *chrome = ngn::gtk::chromeOf(s.views.surface);
  auto cover = view(9, "ModalHostView", std::make_shared<const ViewProps>(), {{0, 0}, {800, 500}});
  s.views.mount({ShadowViewMutation::CreateMutation(cover)});
  ngn::DesktopProps asCover;
  asCover.presentation = ngn::ModalPresentation::Cover;
  s.views.backend->updateDesktopProps(MountedViews::kSurface, 9, asCover);
  s.views.mount({ShadowViewMutation::InsertMutation(MountedViews::kSurface, cover, 1)});
  s.views.backend->modals().settle();
  s.views.settle();
  GtkWidget *slot = s.views.backend->modals().slotOf(9);
  REQUIRE(slot);
  graphene_rect_t header, below;
  REQUIRE(gtk_widget_compute_bounds(chrome->headerBar, s.views.window, &header));
  REQUIRE(gtk_widget_compute_bounds(slot, s.views.window, &below));
  CHECK(header.size.height > 30);
  CHECK(below.origin.y == doctest::Approx(header.origin.y + header.size.height));
  // The sidebar's header bar shows above the cover: a point in it is the header bar's, not the cover's.
  GtkWidget *sidebarToolbar = gtk_widget_get_ancestor(s.views.view(3), ADW_TYPE_TOOLBAR_VIEW);
  REQUIRE(sidebarToolbar);
  graphene_point_t inBar{20, static_cast<float>(header.size.height) / 2}, at{};
  REQUIRE(gtk_widget_compute_point(sidebarToolbar, s.views.window, &inBar, &at));
  GtkWidget *picked = gtk_widget_pick(s.views.window, at.x, at.y, GTK_PICK_DEFAULT);
  REQUIRE(picked);
  CHECK_FALSE(gtk_widget_is_ancestor(picked, slot));
  CHECK(gtk_widget_get_ancestor(picked, ADW_TYPE_HEADER_BAR));
  s.views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, cover, 1), ShadowViewMutation::DeleteMutation(cover)});
}

TEST_CASE("a sidebar with an autosave name keeps whether it is collapsed, which wins over the app's prop next launch") {
  REQUIRE(ngn::testing::gtkReady());
  std::map<std::string, folly::dynamic> preferences;
  auto launch = [&preferences](bool propCollapsed, auto &&check) {
    MountedViews views{true, 800, 500};
    auto &splits = views.backend->splitViews();
    splits.readPreference = [&preferences](const std::string &key) -> std::optional<folly::dynamic> {
      auto it = preferences.find(key);
      return it == preferences.end() ? std::nullopt : std::optional(it->second);
    };
    splits.writePreference = [&preferences](const std::string &key, const folly::dynamic &value) { preferences[key] = value; };
    auto split = view(2, "NgNativeSplitView", nullptr, {{0, 0}, {800, 500}});
    auto sidebar = view(
        3, "NgNativeSidebar",
        parsedProps<ngn::SidebarComponentDescriptor>(dynamic::object("collapsed", propCollapsed)("autosaveName", "mail")),
        {{0, 0}, {240, 500}});
    auto content = view(4, "NgNativeSplitContent", nullptr, {{240, 0}, {560, 500}});
    views.mount({ShadowViewMutation::CreateMutation(split), ShadowViewMutation::CreateMutation(sidebar),
                 ShadowViewMutation::CreateMutation(content)});
    ngn::testing::SentEvents<ViewEventEmitter> sent(*ngn::gtk::viewData(views.view(3)));
    views.mount({ShadowViewMutation::InsertMutation(MountedViews::kSurface, split, 0), ShadowViewMutation::InsertMutation(2, sidebar, 0),
                 ShadowViewMutation::InsertMutation(2, content, 1)});
    check(views, sent);
  };
  auto collapsed = [](MountedViews &views) {
    return adw_navigation_split_view_get_collapsed(ADW_NAVIGATION_SPLIT_VIEW(views.backend->splitViews().splitWidget(2))) != FALSE;
  };
  // Nothing saved: the app's prop, and the user's toggle is saved.
  launch(false, [&](MountedViews &views, auto &sent) {
    CHECK_FALSE(collapsed(views));
    CHECK(sent.count("topSidebarCollapse") + sent.count("sidebarCollapse") == 0);
    CHECK(views.backend->splitViews().toggle(MountedViews::kSurface));
  });
  REQUIRE(preferences.count("NgNativeSidebarCollapsed mail"));
  CHECK(preferences["NgNativeSidebarCollapsed mail"] == true);
  // Next launch: collapsed as the user left it, which the app hears.
  launch(false, [&](MountedViews &views, auto &sent) {
    CHECK(collapsed(views));
    CHECK(sent.count("topSidebarCollapse") + sent.count("sidebarCollapse") == 1);
    // An update that leaves the collapsed input alone (a width) keeps it as restored and saved.
    views.update(views.mounting->tree().find(3)->view,
                 parsedProps<ngn::SidebarComponentDescriptor>(dynamic::object("collapsed", false)("autosaveName", "mail")("paneMinWidth", 200)));
    CHECK(collapsed(views));
    CHECK(preferences["NgNativeSidebarCollapsed mail"] == true);
    // The app changing the input is saved too.
    views.update(views.mounting->tree().find(3)->view,
                 parsedProps<ngn::SidebarComponentDescriptor>(dynamic::object("collapsed", true)("autosaveName", "mail")("paneMinWidth", 200)));
    views.update(views.mounting->tree().find(3)->view,
                 parsedProps<ngn::SidebarComponentDescriptor>(dynamic::object("collapsed", false)("autosaveName", "mail")("paneMinWidth", 200)));
    CHECK_FALSE(collapsed(views));
  });
  CHECK(preferences["NgNativeSidebarCollapsed mail"] == false);
}

TEST_CASE("a sidebar inserted after its split was placed restores what the user left too") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views{true, 800, 500};
  auto &splits = views.backend->splitViews();
  std::map<std::string, folly::dynamic> preferences{{"NgNativeSidebarCollapsed mail", true}};
  splits.readPreference = [&preferences](const std::string &key) -> std::optional<folly::dynamic> {
    auto it = preferences.find(key);
    return it == preferences.end() ? std::nullopt : std::optional(it->second);
  };
  splits.writePreference = [&preferences](const std::string &key, const folly::dynamic &value) { preferences[key] = value; };
  auto split = view(2, "NgNativeSplitView", nullptr, {{0, 0}, {800, 500}});
  auto sidebar = view(
      3, "NgNativeSidebar",
      parsedProps<ngn::SidebarComponentDescriptor>(dynamic::object("collapsed", false)("autosaveName", "mail")), {{0, 0}, {240, 500}});
  auto content = view(4, "NgNativeSplitContent", nullptr, {{240, 0}, {560, 500}});
  views.mount({ShadowViewMutation::CreateMutation(split), ShadowViewMutation::CreateMutation(sidebar),
               ShadowViewMutation::CreateMutation(content)});
  views.mount({ShadowViewMutation::InsertMutation(MountedViews::kSurface, split, 0), ShadowViewMutation::InsertMutation(2, content, 0)});
  views.mount({ShadowViewMutation::InsertMutation(2, sidebar, 0)});
  CHECK(adw_navigation_split_view_get_collapsed(ADW_NAVIGATION_SPLIT_VIEW(splits.splitWidget(2))));
  CHECK(preferences["NgNativeSidebarCollapsed mail"] == true);
}

TEST_CASE("a sidebar's sections are a list box over their frames, its rows selected as the app says") {
  REQUIRE(ngn::testing::gtkReady());
  Split s;
  auto boxes = s.splits().lists(3);
  REQUIRE(boxes.size() == 1);
  CHECK(gtk_widget_get_parent(boxes[0]) == s.views.view(3));
  // The section draws in its list: its own widget is hidden.
  CHECK_FALSE(gtk_widget_get_child_visible(s.views.view(5)));
  auto rows = rowsOf(boxes[0]);
  REQUIRE(rows.size() == 3);
  CHECK_FALSE(gtk_list_box_row_get_selectable(GTK_LIST_BOX_ROW(rows[0])));
  CHECK(gtk_list_box_get_selected_row(GTK_LIST_BOX(boxes[0])) == GTK_LIST_BOX_ROW(rows[2]));
  // Over the section's frame, once laid out.
  ngn::testing::runUntil([&] { return gtk_widget_get_height(boxes[0]) == 84; });

  // The app selects another: the list follows.
  s.views.update(s.inbox, item("Inbox", true));
  s.views.update(s.sent, item("Sent", false));
  rows = rowsOf(s.splits().lists(3)[0]);
  CHECK(gtk_list_box_get_selected_row(GTK_LIST_BOX(s.splits().lists(3)[0])) == GTK_LIST_BOX_ROW(rows[1]));

  // Folded from its title, the section is only that, until it opens again.
  s.splits().fold(3, 5, true);
  ngn::testing::runUntil([&] { return rowsOf(s.splits().lists(3)[0]).size() == 1; });
  s.splits().fold(3, 5, false);
  ngn::testing::runUntil([&] { return rowsOf(s.splits().lists(3)[0]).size() == 3; });

  // The sections gone, so is the list.
  s.views.mount({ShadowViewMutation::RemoveMutation(3, s.section, 0)});
  CHECK(s.splits().lists(3).empty());
}
