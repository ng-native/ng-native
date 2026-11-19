// The GTK 4 backend: the core's mounting and desktop props interfaces over one NgnView per Fabric
// view (view-widget.h), on the GTK thread.
#pragma once

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
  void didMount(SurfaceId surfaceId) override;
  void updateDesktopProps(SurfaceId surfaceId, Tag tag, const DesktopProps &props) override;
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
  std::unordered_map<SurfaceId, GtkWidget *> surfaces_;
};

} // namespace ngn::gtk
