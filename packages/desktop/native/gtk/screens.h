// react-native-screens' native stack and React Native's <modal> on GTK, over the core's screen
// stacks (screen-stacks.h), header (header-bar.h) and modal sizing (desktop-modal.h).
//
// A surface's window is an AdwApplicationWindow whose content is an AdwToolbarView: an
// AdwHeaderBar on top, over a GtkOverlay holding the surface. The window's title-bar mode
// (app-windows.h's TitleBar) is how the two meet. `default` keeps the content below a raised header
// bar; `transparent` runs it under a flat one, which the safe area's top inset clears; `hidden` does
// the same and hides the title, keeping the window controls, as AppKit does. The front screen's
// header goes into the header bar as the AppKit host puts it into the window's toolbar: the back
// and forward pair, the header's subviews moved into slots of their own, its bar buttons and its
// search fields, with the title between. The pair follows the window's history as the app's router
// reports it (app-menus.h's historyButtons), and a secondary click or a long press on either lists
// the entries that way (historyMenu).
//
// Where the app's menus go (default-menu.h's MenuPlacement) is set up with the chrome: an empty
// GtkPopoverMenuBar under the header bar, or a primary GtkMenuButton at its end, each hidden until
// the window lifecycle gives it a menu.
//
// A <modal>, and a react-native-screens screen presented with `present()` (screen-presentation.h),
// shows the way the macOS host shows it. A sheet is an AdwDialog inside the window on libadwaita
// 1.5 and later, found at run time since the build targets 1.4's API, and a drawn overlay on 1.4: a
// dimmed backdrop with the sheet on a card in the middle. A cover is an overlay filling the window
// below the header bar. One with an anchor on screen is a GtkPopover pointing at the anchor. Each
// way the view moves into a slot of its own, a container of its own for input, and takes the size
// the core works out from its content (sheetSize, popoverSize).
//
// A presented screen's header becomes the sheet's own header bar: its title in the middle, its left
// items (Cancel) at the start and its right ones at the end, the last the default on Return. Escape
// presses Cancel, or without one asks the app to close the sheet: onRequestClose for a <modal>,
// `dismissed` for a screen, which the router follows. A click outside a popover asks the same.
#pragma once

#include "ngn/app-menus.h"
#include "ngn/app-windows.h"
#include "ngn/default-menu.h"
#include "ngn/desktop-modal.h"
#include "ngn/header-bar.h"
#include "ngn/mounting-backend.h"
#include "ngn/safe-areas.h"
#include "ngn/screen-presentation.h"
#include "ngn/screen-stacks.h"

#include <gtk/gtk.h>

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>

namespace ngn::gtk {

class GtkBackend;

// How a window's chrome is made.
struct ChromeOptions {
  TitleBar titleBar{TitleBar::Default};
  MenuPlacement menus{MenuPlacement::PrimaryMenu};
};

// What a surface's window holds besides it.
struct WindowChrome {
  GtkWidget *toolbarView{nullptr};
  GtkWidget *headerBar{nullptr};
  GtkWidget *overlay{nullptr};
  // Where the menus go: the bar under the header bar, or the header bar's menu button. One of the
  // two, hidden until it has a menu.
  GtkWidget *menuBar{nullptr};
  GtkWidget *primaryMenu{nullptr};
  TitleBar titleBar{TitleBar::Default};
};

// The toolbar view holding `surface` under the header bar, for a window's content; the window's
// chromeOf(surface) from then on.
GtkWidget *wrapInChrome(GtkWidget *surface, const ChromeOptions &options = {});
// The chrome of `surface`'s window, or null for a surface wrapInChrome did not wrap.
const WindowChrome *chromeOf(GtkWidget *surface);
// Whether the surface's content runs under its header bar: `transparent` and `hidden`.
bool runsUnderHeaderBar(const WindowChrome &chrome);
// The surface's size and the insets its chrome gives it: none while its content stays below the
// header bar. Under it, the top bars' height on top, and how far the window controls reach in from
// each side (titlebarLeading and titlebarTrailing), as gtk-decoration-layout places them.
ContainerInsets chromeInsets(GtkWidget *surface);

// A slot holding one view moved out of the tree's widgets: it measures as the view's frame, or as
// the size set on it, and puts the view at its top left.
GtkWidget *makeHostSlot();
void setSlotSize(GtkWidget *slot, std::optional<std::pair<int, int>> size);

// A RNSSearchBar's field for the header bar, reporting to the view `tag`'s emitter as
// react-native-screens' iOS search bar does (searchBarEvents); its config and commands.
GtkWidget *makeSearchEntry(GtkBackend &backend, Tag tag);
void applySearchBar(GtkWidget *entry, const facebook::react::Props &props);
void runSearchBarCommand(GtkWidget *entry, const std::string &name, const folly::dynamic &args);

// Whether AdwDialog is there to present a sheet with: libadwaita 1.5 or later at run time.
bool haveAdwDialog();

// A CSS class setting `property` ("color" or "background-color") to `color`, added to the display's
// sheet the first time it is asked for; empty for no colour. The class names its colour, so its rule
// never goes stale.
std::string colorClass(const char *property, const facebook::react::SharedColor &color);

// The header the window of each surface shows.
class Headers {
 public:
  explicit Headers(GtkBackend &backend) : backend_(backend) {}
  ~Headers();
  void show(SurfaceId surfaceId, const std::optional<ScreenStacks::FrontHeader> &header);
  // After a transaction: a header whose config, subviews or props changed is laid out again.
  void refresh();
  // A view went: a header showing it lets it go.
  void forget(Tag tag);
  // The window's split view came or went: its sidebar button with it (split-view.h).
  void refreshChrome(SurfaceId surfaceId);
  // Show Sidebar, from the sidebar button.
  void toggleSidebar(SurfaceId surfaceId);
  // The sidebar button, for tests; null when the window has no split view of its own.
  GtkWidget *sidebarButton(SurfaceId surfaceId) const;
  // A surface went: its header, history and pair with it.
  void removeSurface(SurfaceId surfaceId);
  // The window's history, as the app's router reports it (MenuHost::history), for the pair.
  void setHistory(SurfaceId surfaceId, const std::optional<WindowHistory> &history);
  // What a press of the pair, or an entry chosen from its list, asks of the window's history.
  std::function<void(SurfaceId, NavigationDirection, int steps)> navigate;
  // A chevron pressed: through the history, or, for an app that reports none, the stack's back.
  void pressChevron(SurfaceId surfaceId, NavigationDirection direction);
  // The list of the entries `direction` way, at the chevron, as a secondary click shows it. Whether
  // there was one to show.
  bool showHistoryMenu(SurfaceId surfaceId, NavigationDirection direction);
  // The window's header bar's back and forward chevrons, for tests; null when the pair is not shown.
  GtkWidget *backButton(SurfaceId surfaceId) const;
  GtkWidget *forwardButton(SurfaceId surfaceId) const;

 private:
  struct Shown {
    std::optional<ScreenStacks::FrontHeader> header;
    // What it was laid out from, against which a refresh is a change.
    std::optional<HeaderBar> bar;
    HeaderLayout layout;
    // The widgets it put in the header bar, and the views moved into slots.
    std::vector<GtkWidget *> packed;
    std::vector<Tag> hosted;
    // The window's history, and the pair it shows.
    std::optional<WindowHistory> history;
    HistoryButtons buttons;
    GtkWidget *back{nullptr};
    GtkWidget *forward{nullptr};
    GtkWidget *sidebarButton{nullptr};
    // The bar's background colour class.
    std::string background;
  };
  void layOut(SurfaceId surfaceId, Shown &shown);
  void clear(SurfaceId surfaceId, Shown &shown);
  GtkWidget *headerBarOf(SurfaceId surfaceId) const;

  GtkBackend &backend_;
  std::map<SurfaceId, Shown> shown_;
};

// The <modal>s presented on each surface.
class Modals {
 public:
  // The shadow tree's view of a modal's content, which sizes a sheet (Runtime::sheetNode).
  using SheetNodes = std::function<std::optional<SheetNode>(SurfaceId, Tag)>;

  explicit Modals(GtkBackend &backend) : backend_(backend) {}
  ~Modals();
  void setSheetNodes(SheetNodes nodes) {
    sheetNodes_ = std::move(nodes);
  }
  // A modal was mounted into the tree: it presents once the transaction has mounted, with its
  // presentation known.
  void mounted(SurfaceId surfaceId, Tag tag);
  // A modal left the tree, or went: it is dismissed.
  void unmounted(Tag tag);
  // The core presents a screen over its stack, or takes it back (ScreenStacks::takePresented): it
  // presents once the transaction has mounted, as a modal does.
  void setPresented(SurfaceId surfaceId, Tag screen, bool presented);
  // After a transaction: presents the modals mounted in it, and fits each sheet to its content.
  // Also as a window changes size, which a sheet stays within and a cover fills.
  void settle();
  // The presentation a modal shows in, for tests: its slot, and whether it is an AdwDialog.
  GtkWidget *slotOf(Tag tag) const;
  bool inDialog(Tag tag) const;
  // Its GtkPopover, and the header bar a presented screen's sheet draws, for tests; null for none.
  GtkWidget *popoverOf(Tag tag) const;
  GtkWidget *sheetHeaderOf(Tag tag) const;
  // What Escape does: presses a sheet's Cancel, or asks the app to close the presentation.
  void requestClose(Tag tag);
  // The presentation shown last over `window`'s surfaces, which Ctrl+W closes before the window, as
  // Cmd-W does on macOS.
  std::optional<Tag> front(GtkWindow *window) const;
  // What Return does: presses a sheet's default button. Whether there was one to press.
  bool pressDefault(Tag tag);

 private:
  struct Presented {
    SurfaceId surfaceId;
    ModalPresentation presentation{ModalPresentation::Sheet};
    // A presented RNSScreen, not a <modal>.
    bool screen{false};
    GtkWidget *slot{nullptr};
    // The AdwDialog, the overlay's backdrop or cover, or the popover.
    GtkWidget *dialog{nullptr};
    GtkWidget *layer{nullptr};
    GtkWidget *popover{nullptr};
    // A sheet's box of its header and the slot, and the header, when the screen has one.
    GtkWidget *card{nullptr};
    GtkWidget *header{nullptr};
    SheetChrome chrome;
    // The name it was last given (presentationLabel).
    std::string label;
    bool labelled{false};
    std::pair<int, int> size{0, 0};
    // Where the focus was, to go back to.
    GtkWidget *opener{nullptr};
    // When it was presented, against the others: the front one is the latest.
    uint64_t order{0};
  };
  void present(SurfaceId surfaceId, Tag tag);
  void fit(Tag tag, Presented &presented);
  // Brings a presented screen's sheet header and the presentation's label in step with its props.
  void dress(Tag tag, Presented &presented);
  void press(Tag tag, const std::string &buttonId);
  void dismiss(Tag tag);

  GtkBackend &backend_;
  SheetNodes sheetNodes_;
  std::set<std::pair<SurfaceId, Tag>> pending_;
  std::map<Tag, Presented> presented_;
  uint64_t presentations_{0};
};

} // namespace ngn::gtk
