// react-native-screens' native stack and React Native's <modal> on GTK, over the core's screen
// stacks (screen-stacks.h), header (header-bar.h) and modal sizing (desktop-modal.h).
//
// A surface's window is an AdwWindow whose content is an AdwHeaderBar over a GtkOverlay holding
// the surface: the minimum of libadwaita's chrome the header and the modals need (AdwToolbarView
// and the title-bar modes are later). The front screen's header goes into the header bar as the
// AppKit host puts it into the window's toolbar: the back button, the header's subviews moved into
// slots of their own, its bar buttons and its search fields, with the title between.
//
// A <modal> sheet is an AdwDialog inside the window on libadwaita 1.5 and later, found at run time
// since the build targets 1.4's API, and a drawn overlay on 1.4: a dimmed backdrop with the sheet
// on a card in the middle. A cover is an overlay filling the window below the header bar. Either
// way the modal's view moves into a slot of its own, a container of its own for input, and the
// sheet takes the size the core works out from its content (sheetSize). Escape asks the app to
// close it (onRequestClose), as on macOS.
#pragma once

#include "ngn/desktop-modal.h"
#include "ngn/header-bar.h"
#include "ngn/mounting-backend.h"
#include "ngn/screen-stacks.h"

#include <gtk/gtk.h>

#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>

namespace ngn::gtk {

class GtkBackend;

// What a surface's window holds besides it.
struct WindowChrome {
  GtkWidget *headerBar{nullptr};
  GtkWidget *overlay{nullptr};
};

// The header bar over an overlay holding `surface`, for a window's content; the window's
// chromeOf(surface) from then on.
GtkWidget *wrapInChrome(GtkWidget *surface);
// The chrome of `surface`'s window, or null for a surface wrapInChrome did not wrap.
const WindowChrome *chromeOf(GtkWidget *surface);

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
  // The window's header bar's back button, for tests; null when none shows.
  GtkWidget *backButton(SurfaceId surfaceId) const;

 private:
  struct Shown {
    std::optional<ScreenStacks::FrontHeader> header;
    // What it was laid out from, against which a refresh is a change.
    std::optional<HeaderBar> bar;
    HeaderLayout layout;
    // The widgets it put in the header bar, and the views moved into slots.
    std::vector<GtkWidget *> packed;
    std::vector<Tag> hosted;
    // The search fields packed at the end, kept across a layout that keeps them.
    std::vector<GtkWidget *> searches;
    GtkWidget *back{nullptr};
  };
  void layOut(SurfaceId surfaceId, Shown &shown);
  void clear(SurfaceId surfaceId, Shown &shown, bool keepSearches = false);
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
  // After a transaction: presents the modals mounted in it, and fits each sheet to its content.
  // Also as a window changes size, which a sheet stays within and a cover fills.
  void settle();
  // The presentation a modal shows in, for tests: its slot, and whether it is an AdwDialog.
  GtkWidget *slotOf(Tag tag) const;
  bool inDialog(Tag tag) const;
  // What Escape does: asks the app to close the modal in front.
  void requestClose(Tag tag);
  // Escape over a surface's modals: asks to close the one presented last.
  void requestCloseFront(SurfaceId surfaceId);

 private:
  struct Presented {
    SurfaceId surfaceId;
    ModalPresentation presentation{ModalPresentation::Sheet};
    // When it was presented among the others: the latest is in front.
    int order{0};
    GtkWidget *slot{nullptr};
    // The AdwDialog, or the overlay's backdrop or cover.
    GtkWidget *dialog{nullptr};
    GtkWidget *layer{nullptr};
    std::pair<int, int> size{0, 0};
    // Where the focus was, to go back to.
    GtkWidget *opener{nullptr};
  };
  void present(SurfaceId surfaceId, Tag tag);
  void fit(Tag tag, Presented &presented);
  void dismiss(Tag tag);

  GtkBackend &backend_;
  SheetNodes sheetNodes_;
  std::set<std::pair<SurfaceId, Tag>> pending_;
  std::map<Tag, Presented> presented_;
  int presentations_{0};
};

} // namespace ngn::gtk
