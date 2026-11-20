// An `Image` on GTK: its source read through the core (loadImageSource, over the host's HTTP client
// and an in-memory cache), decoded by GDK off the UI thread, and drawn in the view's snapshot where
// its resizeMode puts it, cut to the view's shape, as the macOS host's layer draws it. It reports
// load start, load (with the image's size in pixels), error and load end.
#pragma once

#include "view-widget.h"

#include "ngn/expo-image.h"
#include "ngn/network.h"
#include "ngn/view-box.h"

#include <react/renderer/imagemanager/primitives.h>

#include <gtk/gtk.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn::gtk {

struct ImageLoad {
  // The view the load draws in, until it goes.
  ViewData *view{nullptr};
  // The source picked, which a change of props loads again only when it is a new request.
  std::optional<facebook::react::ImageSource> source;
  // Moved on by each load: an answer for an earlier one, even of the same uri, is ignored.
  uint64_t turn{0};
  GdkTexture *texture{nullptr};
  // What the last load answered: the texture shown, or why there is none.
  std::string error;
};

// The client and the cache every Image loads through. Without them, a load fails.
void useImageLoading(std::shared_ptr<Http> http, std::shared_ptr<ImageCache> cache);

// Reads `source` as an Image does and decodes it off the UI thread, answering once, in a later turn
// of the UI thread: a texture the caller owns, or null and why.
void readImage(const facebook::react::ImageSource &source, std::function<void(GdkTexture *texture, const std::string &error)> done);

// Loads the source the view's props pick, and picks again as the widget's scale changes: in a
// window on another monitor, or moved to one, a whole step at a time; GtkBackend::windowRescaled
// picks again at a fractional one.
void makeImageView(GtkWidget *widget, ViewData &view);
// Loads the source the view's props pick when it is a new request.
void applyImageProps(ViewData &view, double screenScale);
// Draws the loaded image inside `box`'s shape.
void snapshotImage(const ViewData &view, GtkSnapshot *snapshot, const BoxDescription &box);
void destroyImage(ViewData &view);

} // namespace ngn::gtk
