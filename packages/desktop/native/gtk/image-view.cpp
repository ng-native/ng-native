#include "image-view.h"

#include "box-paint.h"

#include "ngn/file-system.h"
#include "ngn/image-source.h"

#include <react/renderer/components/image/ImageEventEmitter.h>
#include <react/renderer/components/image/ImageProps.h>

#include <mutex>
#include <utility>

using namespace facebook::react;

namespace ngn::gtk {

namespace {

std::mutex gLoadingMutex;
std::shared_ptr<Http> gHttp;
std::shared_ptr<ImageCache> gCache;

std::shared_ptr<const ImageEventEmitter> emitterOf(const ViewData &view) {
  return std::dynamic_pointer_cast<const ImageEventEmitter>(view.emitter);
}

void setTexture(ImageLoad &load, GdkTexture *texture) {
  if (load.texture) {
    g_object_unref(load.texture);
  }
  load.texture = texture;
}

void failed(ViewData &view, const std::string &message) {
  view.image->error = message;
  if (auto e = emitterOf(view)) {
    e->onError({.error = message});
    e->onLoadEnd();
  }
}

void load(ViewData &view) {
  ImageLoad &load = *view.image;
  uint64_t turn = ++load.turn;
  setTexture(load, nullptr);
  load.error.clear();
  if (view.widget) {
    gtk_widget_queue_draw(view.widget);
  }
  if (!load.source) {
    return;
  }
  if (auto e = emitterOf(view)) {
    e->onLoadStart();
  }
  std::weak_ptr<ImageLoad> weak = view.image;
  readImage(*load.source, [weak, turn](GdkTexture *texture, const std::string &error) {
    auto load = weak.lock();
    // An answer for a load since superseded, or for a view that went, shows nothing.
    if (!load || load->turn != turn || !load->view) {
      if (texture) {
        g_object_unref(texture);
      }
      return;
    }
    ViewData &view = *load->view;
    if (!texture) {
      failed(view, error);
    } else {
      setTexture(*load, texture);
      load->error.clear();
      if (auto e = emitterOf(view)) {
        ImageSource source;
        source.uri = load->source->uri;
        source.size = {static_cast<Float>(gdk_texture_get_width(texture)), static_cast<Float>(gdk_texture_get_height(texture))};
        e->onLoad(source);
        e->onLoadEnd();
      }
    }
    if (view.widget) {
      gtk_widget_queue_draw(view.widget);
    }
  });
}

} // namespace

void readImage(const ImageSource &source, std::function<void(GdkTexture *texture, const std::string &error)> done) {
  std::shared_ptr<Http> http;
  std::shared_ptr<ImageCache> cache;
  {
    std::lock_guard lock(gLoadingMutex);
    http = gHttp;
    cache = gCache;
  }
  struct Answer {
    std::function<void(GdkTexture *, const std::string &)> done;
    GdkTexture *texture{nullptr};
    std::string error;
  };
  auto answer = [](gpointer data) -> gboolean {
    std::unique_ptr<Answer> a(static_cast<Answer *>(data));
    a->done(a->texture, a->error);
    return G_SOURCE_REMOVE;
  };
  if (!http) {
    g_main_context_invoke(nullptr, answer, new Answer{.done = std::move(done), .error = "Images cannot load: the host gave no HTTP client"});
    return;
  }
  loadImageSource(http, cache, viewFileAccess().get(), source, [done = std::move(done), answer](std::string bytes, const std::string &error) {
    auto *a = new Answer{.done = done, .error = error};
    if (error.empty()) {
      // GDK decodes on any thread: the UI thread only draws.
      GBytes *data = g_bytes_new(bytes.data(), bytes.size());
      GError *problem = nullptr;
      a->texture = gdk_texture_new_from_bytes(data, &problem);
      g_bytes_unref(data);
      if (!a->texture) {
        a->error = std::string("Could not decode the image: ") + (problem ? problem->message : "unknown format");
      }
      if (problem) {
        g_error_free(problem);
      }
    }
    g_main_context_invoke(nullptr, answer, a);
  });
}

void useImageLoading(std::shared_ptr<Http> http, std::shared_ptr<ImageCache> cache) {
  std::lock_guard lock(gLoadingMutex);
  gHttp = std::move(http);
  gCache = std::move(cache);
}

void applyImageProps(ViewData &view, int screenScale) {
  auto props = std::dynamic_pointer_cast<const ImageProps>(view.props);
  if (!props) {
    return;
  }
  if (!view.image) {
    view.image = std::make_shared<ImageLoad>();
    view.image->view = &view;
  }
  // The source whose scale is nearest the screen's, as React Native iOS picks.
  auto source = pickImageSource(props->sources, screenScale);
  auto &current = view.image->source;
  if (source.has_value() == current.has_value() && (!source || sameImageRequest(*source, *current))) {
    return;
  }
  current = std::move(source);
  load(view);
}

void snapshotImage(const ViewData &view, GtkSnapshot *snapshot, const BoxDescription &box) {
  auto props = std::dynamic_pointer_cast<const ImageProps>(view.props);
  if (!view.image || !view.image->texture || !props || box.bounds.width <= 0 || box.bounds.height <= 0) {
    return;
  }
  GdkTexture *texture = view.image->texture;
  auto rect = placeImage(
      imageContentFit(props->resizeMode), nullptr,
      {static_cast<double>(gdk_texture_get_width(texture)), static_cast<double>(gdk_texture_get_height(texture))},
      {box.bounds.width, box.bounds.height});
  // The image is cut to the view, in its rounded shape, as the macOS host's layer masks it.
  GskRoundedRect outline = gskRoundedRect(box.bounds, box.radii);
  gtk_snapshot_push_rounded_clip(snapshot, &outline);
  graphene_rect_t at;
  graphene_rect_init(
      &at, static_cast<float>(box.bounds.x + rect.x), static_cast<float>(box.bounds.y + rect.y), static_cast<float>(rect.width),
      static_cast<float>(rect.height));
  gtk_snapshot_append_texture(snapshot, texture, &at);
  gtk_snapshot_pop(snapshot);
}

void destroyImage(ViewData &view) {
  if (view.image) {
    view.image->view = nullptr;
    setTexture(*view.image, nullptr);
    view.image.reset();
  }
}

} // namespace ngn::gtk
