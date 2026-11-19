#include "image-view.h"

#include "app-windows.h"
#include "box-paint.h"

#include "ngn/file-system.h"
#include "ngn/image-source.h"

#include <react/renderer/components/image/ImageEventEmitter.h>
#include <react/renderer/components/image/ImageProps.h>

#include <algorithm>
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

// What a read answers, on the UI thread: a texture the caller then owns, or null and why.
struct Answer {
  std::function<void(GdkTexture *, const std::string &)> done;
  GdkTexture *texture{nullptr};
  std::string error;
  Answer() = default;
  Answer(const Answer &) = delete;
  Answer &operator=(const Answer &) = delete;
  ~Answer() {
    if (texture) {
      g_object_unref(texture);
    }
  }
};

// Queued for the UI thread's loop, never run in the caller's turn, which can be the UI thread's
// own (a cache hit) or a network thread that took the main context between two of its turns.
void answer(std::shared_ptr<Answer> answer) {
  onMainContext([answer = std::move(answer)] { answer->done(std::exchange(answer->texture, nullptr), answer->error); });
}

struct Decode {
  std::shared_ptr<Answer> answer;
  std::string bytes;
};

// GDK decodes on any thread: the UI thread only draws, even for bytes the cache held.
void decode(gpointer data, gpointer) {
  std::unique_ptr<Decode> job(static_cast<Decode *>(data));
  GBytes *bytes = g_bytes_new(job->bytes.data(), job->bytes.size());
  GError *problem = nullptr;
  job->answer->texture = gdk_texture_new_from_bytes(bytes, &problem);
  g_bytes_unref(bytes);
  if (!job->answer->texture) {
    job->answer->error = std::string("Could not decode the image: ") + (problem ? problem->message : "unknown format");
  }
  if (problem) {
    g_error_free(problem);
  }
  answer(std::move(job->answer));
}

void decodeOffThread(std::shared_ptr<Answer> answer, std::string bytes) {
  static GThreadPool *pool = g_thread_pool_new(decode, nullptr, static_cast<gint>(std::max(1u, g_get_num_processors())), FALSE, nullptr);
  g_thread_pool_push(pool, new Decode{std::move(answer), std::move(bytes)}, nullptr);
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
  if (!http) {
    auto reply = std::make_shared<Answer>();
    reply->done = std::move(done);
    reply->error = "Images cannot load: the host gave no HTTP client";
    answer(std::move(reply));
    return;
  }
  loadImageSource(http, cache, viewFileAccess().get(), source, [done = std::move(done)](std::string bytes, const std::string &error) {
    auto reply = std::make_shared<Answer>();
    reply->done = done;
    reply->error = error;
    if (!error.empty()) {
      answer(std::move(reply));
    } else {
      decodeOffThread(std::move(reply), std::move(bytes));
    }
  });
}

void useImageLoading(std::shared_ptr<Http> http, std::shared_ptr<ImageCache> cache) {
  std::lock_guard lock(gLoadingMutex);
  gHttp = std::move(http);
  gCache = std::move(cache);
}

void makeImageView(GtkWidget *widget, ViewData &view) {
  g_signal_connect(widget, "notify::scale-factor", G_CALLBACK(+[](GtkWidget *scaled, GParamSpec *, gpointer) {
    if (ViewData *d = viewData(scaled); d && d->image) {
      applyImageProps(*d, gtk_widget_get_scale_factor(scaled));
    }
  }), nullptr);
  applyImageProps(view, gtk_widget_get_scale_factor(widget));
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
