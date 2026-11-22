// `<split-view>` and its sidebar on GTK, over the core's split views and source lists
// (split-view.h): the same for the window's split view and a plain one in the content.
//
// A placed split view holds an AdwNavigationSplitView in an AdwBreakpointBin, filling its view. The
// window's own runs the full height of the window, as a libadwaita window lays one out: each pane is
// under a header bar of its own in an AdwToolbarView, the window's header bar (its title, history
// pair, sidebar button and header items) moves over the content pane, and it moves back as the split
// view goes. A window whose content already runs under its header bar keeps it there. Each
// pane moves into a slot of its own in a page of the split view, a container of its own for input,
// and its size goes back to its shadow node as state, coalesced to once a frame (FrameSizes). The
// core owns collapse (FoldingSplit): the bin's one AdwBreakpoint, whose condition is the core's
// compact width (sidebarCompactWidth), only tells it the window crossed that width, and the split
// view's `collapsed` and `show-content` show what it decides. The content page cannot be popped, so
// the split view's own back gesture and button stay out of the way of the router's history.
//
// Neighbouring sidebar sections are one source list, a GtkListBox in the navigation-sidebar style
// drawn over the sections' frames in their parent, which the sections give their space to and hide
// in. A titled section starts with its title row, which folds a collapsible section away. An item
// with children is a custom row holding the item's view in a slot. Choosing a row sends
// `sidebarSelect` to its item, and the row the app selects is selected again on each change.
//
// A tabs host (the core's tabs-host.h) is placed as a split view too, as macOS draws one: its tabs
// are a source list filling the sidebar's page, and its screens share the content page, each at the
// page's size, the core covering all but the selected one. Choosing a tab goes to the core
// (GtkBackend::Hooks::chooseTab), which answers with the list's new selection.
#pragma once

#include "ngn/split-view.h"

#include <adwaita.h>

#include <gtk/gtk.h>

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn::gtk {

class GtkBackend;

class SplitViews {
 public:
  explicit SplitViews(GtkBackend &backend) : backend_(backend) {}
  ~SplitViews();

  // The core placed a split view (MountingBackend::setSplitView): `window` for the window's own.
  void place(SurfaceId surfaceId, Tag split, bool window);
  // A view was inserted into `parent`: a pane of a placed split view goes into its page.
  void inserted(Tag parent, Tag child);
  // `child` was taken out of `parent`: a sidebar it leaves is titled by the rows that stay, and a
  // split whose sidebar it was titles its content by nothing.
  void removed(Tag parent, Tag child);
  // A view in a sidebar gained or lost lists of its own: the content takes the sidebar's title.
  void retitleSidebarsHolding(Tag parent);
  // A sidebar's props changed: its widths and whether the app has it collapsed.
  void propsChanged(Tag tag);
  // A view went.
  void deleted(Tag tag);
  // The source lists among `parent`'s children (MountingBackend::setSourceLists).
  void setSourceLists(Tag parent, const std::vector<SourceList> &lists);
  // After a transaction: each source list over its sections' frames.
  void layOut();
  // The window's header bar over the content of the window split view that is shown, else over the
  // whole window: a split view whose screen is covered, or that has left the window, is not shown.
  // Called as a screen is covered or uncovered, and after a transaction.
  void placeHeaders();

  // The app's preferences, where a sidebar with an autosaveName keeps whether it is collapsed
  // (sidebarCollapsedKey): set once by the host. Without them nothing is kept.
  std::function<std::optional<folly::dynamic>(const std::string &key)> readPreference;
  std::function<void(const std::string &key, const folly::dynamic &value)> writePreference;

  // The window split view of `surfaceId`'s window, if it has one.
  std::optional<Tag> windowSplit(SurfaceId surfaceId) const;
  // The full-height sidebar's own header bar while the sidebar shows beside the content, where the
  // sidebar button goes, as macOS puts it over the sidebar; null otherwise, when the button stays
  // in the window's header bar.
  GtkWidget *sidebarHeaderShown(SurfaceId surfaceId) const;
  // Show Sidebar (F9, the header bar's sidebar button) for the window's split view. Whether there
  // was one.
  bool toggle(SurfaceId surfaceId);
  // The same for one split view: a nested tabs host's sidebar button.
  bool toggleHost(Tag split);

  // For tests: the AdwNavigationSplitView and its breakpoint, the window crossing the compact
  // width as the breakpoint says, and a source list's GtkListBox.
  GtkWidget *splitWidget(Tag split) const;
  // The window split view's button in the sidebar's header bar that brings the content back, shown
  // while a compact window shows the sidebar alone.
  GtkWidget *contentButton(Tag split) const;
  AdwBreakpoint *breakpoint(Tag split) const;
  void setCompact(Tag split, bool compact);
  std::vector<GtkWidget *> lists(Tag parent) const;
  // The size a pane's slot last reported.
  std::optional<facebook::react::Size> paneSize(Tag pane) const;
  bool folded(Tag parent, Tag section) const;
  void fold(Tag parent, Tag section, bool folded);

  // A row chosen in `parent`'s source list.
  void chose(Tag parent, Tag row);
  // A pane's slot was allocated at this size.
  void reportSizeFromSlot(Tag pane, int width, int height);

 private:
  struct Split {
    SurfaceId surfaceId{-1};
    bool window{false};
    GtkWidget *bin{nullptr};
    GtkWidget *view{nullptr};
    AdwBreakpoint *breakpoint{nullptr};
    GtkWidget *sidebarSlot{nullptr};
    GtkWidget *contentSlot{nullptr};
    // A window's split view, full height: the sidebar's own header bar, and the toolbar view over
    // the content that holds the window's header bar while the split view is there.
    GtkWidget *sidebarHeader{nullptr};
    GtkWidget *contentButton{nullptr};
    GtkWidget *contentToolbar{nullptr};
    Tag sidebar{-1};
    Tag content{-1};
    SidebarCollapse collapse;
    // The collapsed input as last applied, so an update that leaves it alone does not reapply it.
    std::optional<bool> collapsedProp;
    // Where the sidebar button was last laid out: over the sidebar, or in the window's header bar.
    bool buttonOverSidebar{false};
    FoldingSplit folding;
    SidebarWidths widths;
    // A tabs host: its screens, hosted in the content slot, and the scrolled window in the sidebar
    // slot its tab list fills.
    bool tabs{false};
    std::vector<Tag> screens;
    GtkWidget *tabList{nullptr};
    // A nested tabs host's button over its content that shows the tab list while compact.
    GtkWidget *sidebarButton{nullptr};
  };
  struct Lists {
    std::vector<SourceList> lists;
    std::vector<GtkWidget *> boxes;
    SourceListFolds folds;
    // The custom rows' items, hosted in the rows.
    std::vector<Tag> hosted;
    // A rebuild waiting for the next idle, after a fold.
    guint refill{0};
    // While the boxes are rebuilt or their selection set: no choice to report.
    bool syncing{false};
  };
  void host(Split &s, Tag pane);
  // A tabs host's screen into its content slot, at the slot's size.
  void hostScreen(Split &s, Tag screen);
  // The tab list of the tabs host `split` into its sidebar, once both are there, and the chosen
  // tab's title on its content page.
  void showTabList(Tag split);
  // A sidebar first hosted, by placing the split or inserting the sidebar: its widths, the app's
  // collapsed prop, then the saved preference over it.
  void applySidebar(Split &s);
  // Moves the window's header bar over the content pane, or back over the whole window.
  void moveHeaderBar(Split &s, bool overContent);
  void placeHeader(SurfaceId surfaceId);
  void tearDown(Split &s);
  void refill(Tag parent);
  void applyWidths(Split &s);
  void show(Split &s);
  // Saves the collapsed state under the sidebar's autosaveName.
  void autosave(const Split &s);
  void fill(Tag parent, Lists &l, size_t index);
  // The content page's title, which its header bar shows: the label of `row`, selected in a list
  // `within` a sidebar, or none. A tabs host titles its own (showTabList).
  void titleContent(GtkWidget *within, GtkListBoxRow *row);
  // Builds `parent`'s lists afresh, rows and all.
  void rebuild(Tag parent, const std::vector<SourceList> &lists);
  // Selects the row list `index` has selected, without building it again.
  void select(Lists &l, size_t index);
  void flushSizes();
  std::optional<Tag> splitOf(Tag pane) const;

  GtkBackend &backend_;
  std::map<Tag, Split> splits_;
  std::map<Tag, Lists> lists_;
  FrameSizes sizes_;
  std::map<Tag, facebook::react::Size> reported_;
  guint flush_{0};
  // A tab chosen, sent to the core on the next idle: the core answers with the list's new rows,
  // which must not replace them while the list box is still selecting the row.
  guint choose_{0};
  struct {
    SurfaceId surfaceId{-1};
    Tag host{-1};
    Tag screen{-1};
  } chosenTab_;
};

} // namespace ngn::gtk
