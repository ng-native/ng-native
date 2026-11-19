// The GTK 4 backend: the core's mounting and desktop props interfaces over one NgnView per Fabric
// view (view-widget.h), on the GTK thread.
#pragma once

#include "screens.h"
#include "split-view.h"
#include "view-widget.h"

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
  void setSvgDrawing(SurfaceId surfaceId, Tag svg, std::shared_ptr<const SvgDocument> document) override;
  std::vector<facebook::react::ComponentDescriptorProvider> componentProviders() const override;

 private:
  void drain();
  // Replaces the view's widget when its GTK role is no longer the one the widget was made with,
  // which GTK fixes for good: the new widget takes the old one's place, children, view data and
  // focus. Making the view never replaces it.
  void followRole(const ShadowView &view);

  std::thread::id uiThread_;
  std::mutex tasksMutex_;
  std::deque<std::function<void()>> tasks_;
  guint drainSource_{0};
  std::unordered_map<Tag, GtkWidget *> views_;
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
