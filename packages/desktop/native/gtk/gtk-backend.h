// The GTK 4 backend: the core's mounting and desktop props interfaces over one NgnView per Fabric
// view (view-widget.h), on the GTK thread.
#pragma once

#include "screens.h"
#include "split-view.h"
#include "view-widget.h"

#include "ngn/accessibility.h"
#include "ngn/desktop-view-props.h"
#include "ngn/mounting-backend.h"

#include <gtk/gtk.h>

#include <deque>
#include <functional>
#include <mutex>
#include <thread>
#include <unordered_map>

namespace ngn::gtk {

class GtkBackend final : public MountingBackend, public DesktopPropsSink {
 public:
  // On the thread that runs GLib's default main context, which is the UI thread from then on.
  GtkBackend();
  ~GtkBackend() override;

  // The widget `surfaceId`'s root view mounts into (makeSurfaceWidget).
  void addSurface(SurfaceId surfaceId, GtkWidget *surface);
  void removeSurface(SurfaceId surfaceId);
  // The view's widget, or null.
  GtkWidget *view(Tag tag) const;

  // Told once each transaction has mounted.
  std::function<void(SurfaceId)> onMount;

  // What the screens (screens.h) need of the host: a view whose subtree a container of its own
  // hits (the tree's container roots), and the pointer into a slot as that container.
  struct Hooks {
    std::function<void(Tag, bool)> containerRoot = [](Tag, bool) {};
    std::function<void(GtkWidget *, SurfaceId, Tag)> attachInput = [](GtkWidget *, SurfaceId, Tag) {};
    std::function<void(Tag)> detachInput = [](Tag) {};
    // A press a screen reader sends a view that has no handler of its own for it: a click, as
    // Space on the focused view is (InputDispatcher::activate). Whether it reached the view.
    std::function<bool(SurfaceId, Tag)> activate = [](SurfaceId, Tag) { return false; };
    // The user chose the tab `screen` in the sidebar of the tabs host `host` (MountingManager::chooseTab).
    std::function<void(SurfaceId, Tag host, Tag screen)> chooseTab = [](SurfaceId, Tag, Tag) {};
  } hooks;

  // The widget a surface's root mounts into, or null.
  GtkWidget *surfaceWidget(SurfaceId surfaceId) const;
  // A view's data, or null.
  ViewData *data(Tag tag) const;
  // Moves the view's widget into `slot`, leaving an empty view in its place, so its siblings keep
  // their places and Fabric's indices; unhostView puts it back. A view Fabric moves or removes
  // comes back first.
  void hostView(Tag tag, GtkWidget *slot);
  void unhostView(Tag tag);
  // Whether the view is still in the slot it was hosted in.
  bool isHosted(Tag tag) const;
  // `window`'s scale changed (window-scale.h): each Image in it picks its source again, as one
  // does on macOS when its window's backing scale changes.
  void windowRescaled(GtkWidget *window);
  // A RNSSearchBar's field, or null.
  GtkWidget *searchEntry(Tag tag) const;
  Headers &headers() {
    return *headers_;
  }
  Modals &modals() {
    return *modals_;
  }
  SplitViews &splitViews() {
    return *splitViews_;
  }

  void runOnUiThread(std::function<void()> task) override;
  bool onUiThread() const override;
  void serviceUiThread() override;
  void createView(const ShadowView &view) override;
  void deleteView(SurfaceId surfaceId, Tag tag) override;
  void insertChild(SurfaceId surfaceId, Tag parent, Tag child, int index) override;
  void removeChild(SurfaceId surfaceId, Tag parent, Tag child, int index) override;
  void updateProps(const ShadowView &view) override;
  void updateState(const ShadowView &view) override;
  void updateLayout(const ShadowView &view) override;
  void updateEventEmitter(const ShadowView &view) override;
  void dispatchCommand(Tag tag, const std::string &name, const folly::dynamic &args) override;
  void setCovered(SurfaceId surfaceId, Tag tag, bool covered) override;
  void setPresented(SurfaceId surfaceId, Tag screen, bool presented) override;
  void setFrontHeader(SurfaceId surfaceId, const std::optional<ScreenStacks::FrontHeader> &header) override;
  void didMount(SurfaceId surfaceId) override;
  void updateDesktopProps(SurfaceId surfaceId, Tag tag, const DesktopProps &props) override;
  void setSplitView(SurfaceId surfaceId, Tag split, bool window) override;
  void setSourceLists(SurfaceId surfaceId, Tag parent, const std::vector<SourceList> &lists) override;
  void announce(SurfaceId surfaceId, const Announcement &announcement) override;
  void setAccessibilityRelations(SurfaceId surfaceId, Tag tag, const AxRelations &relations) override;
  void setSvgDrawing(SurfaceId surfaceId, Tag svg, std::shared_ptr<const SvgDocument> document) override;
  std::vector<facebook::react::ComponentDescriptorProvider> componentProviders() const override;

 private:
  void drain();
  // Replaces the view's widget when its GTK role is no longer the one the widget was made with,
  // which GTK fixes for good: the new widget takes the old one's place, children, view data and
  // focus. Making the view never replaces it.
  void followRole(const ShadowView &view);
  // The view's accessible actions (accessible.h applyAccessibleActions), sent through the core.
  void applyActions(ViewData &d, const AxInfo &info);
  // One of a view's accessible actions on its widget, through the core (performAxVerb): a press
  // is its `(accessibilityTap)` or `activate` when it listens, and otherwise a click. Whether it
  // reached the view.
  bool performVerb(GtkWidget *widget, AxVerb verb);
  // Space and Return press the view while its own widget has the focus, as they press a focused
  // view on macOS and a focused button in GTK. A default button takes Return first, as it does on
  // macOS, and a key held down presses once.
  void pressOnKeys(GtkWidget *widget);
  // Points the accessible widget of `tag` at the accessible widgets of the views it is labelled
  // and described by, as relations_ has them.
  void applyRelations(Tag tag);

  std::thread::id uiThread_;
  std::mutex tasksMutex_;
  std::deque<std::function<void()>> tasks_;
  guint drainSource_{0};
  std::unordered_map<Tag, GtkWidget *> views_;
  // Each view's relations while it has any: set again on its new widget, and on the widgets that
  // point at it, when a role change replaces a widget.
  std::unordered_map<Tag, AxRelations> relations_;
  static void surfaceGone(gpointer self, GObject *surface);
  std::unordered_map<SurfaceId, GtkWidget *> surfaces_;
  struct Hosted {
    GtkWidget *placeholder;
    GtkWidget *slot;
  };
  std::unordered_map<Tag, Hosted> hosted_;
  std::unordered_map<Tag, GtkWidget *> searchEntries_;
  std::unique_ptr<Headers> headers_;
  std::unique_ptr<Modals> modals_;
  std::unique_ptr<SplitViews> splitViews_;
};

} // namespace ngn::gtk
