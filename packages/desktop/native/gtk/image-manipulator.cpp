#include "image-manipulator.h"

#include <gdk/gdk.h>
#include <gdk-pixbuf/gdk-pixbuf.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <stdexcept>
#include <string>

namespace ngn::gtk {

namespace {

struct Header {
  bool prepared{false};
  int width{0};
  int height{0};
};

// The orientation tag's value (1 to 8) a decoded image carries, 1 where it has none.
int orientationOf(GdkPixbuf *pixbuf) {
  const gchar *value = pixbuf ? gdk_pixbuf_get_option(pixbuf, "orientation") : nullptr;
  int orientation = value ? std::atoi(value) : 1;
  return orientation >= 1 && orientation <= 8 ? orientation : 1;
}

// The image decoded and turned the right way up, or null for bytes no loader reads.
GdkPixbuf *uprightPixbuf(const std::string &bytes) {
  GdkPixbufLoader *loader = gdk_pixbuf_loader_new();
  bool written = gdk_pixbuf_loader_write(loader, reinterpret_cast<const guchar *>(bytes.data()), bytes.size(), nullptr);
  bool closed = gdk_pixbuf_loader_close(loader, nullptr);
  GdkPixbuf *decoded = written && closed ? gdk_pixbuf_loader_get_pixbuf(loader) : nullptr;
  GdkPixbuf *upright = decoded ? gdk_pixbuf_apply_embedded_orientation(decoded) : nullptr;
  g_object_unref(loader);
  return upright;
}

// `pixbuf`'s colour channels in a new pixbuf without alpha, or a new reference to it where it has
// none.
GdkPixbuf *withoutAlpha(GdkPixbuf *pixbuf) {
  if (!gdk_pixbuf_get_has_alpha(pixbuf)) {
    return GDK_PIXBUF(g_object_ref(pixbuf));
  }
  int width = gdk_pixbuf_get_width(pixbuf), height = gdk_pixbuf_get_height(pixbuf);
  GdkPixbuf *opaque = gdk_pixbuf_new(GDK_COLORSPACE_RGB, FALSE, 8, width, height);
  const guchar *from = gdk_pixbuf_read_pixels(pixbuf);
  guchar *to = gdk_pixbuf_get_pixels(opaque);
  int fromStride = gdk_pixbuf_get_rowstride(pixbuf), toStride = gdk_pixbuf_get_rowstride(opaque);
  int channels = gdk_pixbuf_get_n_channels(pixbuf);
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      std::copy_n(from + y * fromStride + x * channels, 3, to + y * toStride + x * 3);
    }
  }
  return opaque;
}

// Cairo reports a failure (a size it cannot allocate, say) as an error object, not null: a later
// step drawing on it would go on to a blank image that encodes as if it were the edit.
void throwUnlessOk(cairo_status_t status) {
  if (status != CAIRO_STATUS_SUCCESS) {
    throw std::runtime_error(std::string("Could not draw the image: ") + cairo_status_to_string(status));
  }
}

cairo_surface_t *surfaceOf(GdkPixbuf *pixbuf) {
  int width = gdk_pixbuf_get_width(pixbuf), height = gdk_pixbuf_get_height(pixbuf);
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
  cairo_t *cr = cairo_create(surface);
  gdk_cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
  cairo_paint(cr);
  auto status = cairo_status(cr) != CAIRO_STATUS_SUCCESS ? cairo_status(cr) : cairo_surface_status(surface);
  cairo_destroy(cr);
  if (status != CAIRO_STATUS_SUCCESS) {
    cairo_surface_destroy(surface);
    throwUnlessOk(status);
  }
  return surface;
}

// A new surface of the step's size with `image` drawn into it as the step says.
cairo_surface_t *apply(cairo_surface_t *image, const ImageStep &step) {
  double width = cairo_image_surface_get_width(image), height = cairo_image_surface_get_height(image);
  double outWidth = step.size.width, outHeight = step.size.height;
  cairo_surface_t *out = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, step.size.width, step.size.height);
  cairo_t *cr = cairo_create(out);
  switch (step.kind) {
    case ImageStep::Kind::Crop:
      cairo_set_source_surface(cr, image, -step.x, -step.y);
      break;
    case ImageStep::Kind::Resize:
      cairo_scale(cr, outWidth / width, outHeight / height);
      cairo_set_source_surface(cr, image, 0, 0);
      // The edge pixels repeat outward, so an upscale does not blend them with transparent black.
      cairo_pattern_set_extend(cairo_get_source(cr), CAIRO_EXTEND_PAD);
      cairo_pattern_set_filter(cairo_get_source(cr), CAIRO_FILTER_GOOD);
      break;
    case ImageStep::Kind::FlipHorizontal:
      cairo_translate(cr, outWidth, 0);
      cairo_scale(cr, -1, 1);
      cairo_set_source_surface(cr, image, 0, 0);
      break;
    case ImageStep::Kind::FlipVertical:
      cairo_translate(cr, 0, outHeight);
      cairo_scale(cr, 1, -1);
      cairo_set_source_surface(cr, image, 0, 0);
      break;
    case ImageStep::Kind::Rotate:
      // Cairo's y runs down, so a positive angle turns clockwise on screen.
      cairo_translate(cr, outWidth / 2, outHeight / 2);
      cairo_rotate(cr, step.degrees * G_PI / 180);
      cairo_set_source_surface(cr, image, -width / 2, -height / 2);
      cairo_pattern_set_filter(cairo_get_source(cr), CAIRO_FILTER_GOOD);
      break;
  }
  cairo_paint(cr);
  auto status = cairo_status(cr) != CAIRO_STATUS_SUCCESS ? cairo_status(cr) : cairo_surface_status(out);
  cairo_destroy(cr);
  if (status != CAIRO_STATUS_SUCCESS) {
    cairo_surface_destroy(out);
    throwUnlessOk(status);
  }
  return out;
}

class PixbufCodec final : public ImageCodec {
 public:
  // The header's size, read until the loader knows it, and the orientation, which a JPEG's
  // loader has read by then too.
  std::optional<ImageSize> size(const std::string &bytes) override {
    GdkPixbufLoader *loader = gdk_pixbuf_loader_new();
    Header header;
    g_signal_connect(loader, "area-prepared", G_CALLBACK(+[](GdkPixbufLoader *, gpointer data) {
      static_cast<Header *>(data)->prepared = true;
    }), &header);
    g_signal_connect(loader, "size-prepared", G_CALLBACK(+[](GdkPixbufLoader *, int width, int height, gpointer data) {
      static_cast<Header *>(data)->width = width;
      static_cast<Header *>(data)->height = height;
    }), &header);
    constexpr size_t chunk = 64 * 1024;
    bool failed = false;
    for (size_t at = 0; at < bytes.size() && !header.prepared && !failed; at += chunk) {
      failed = !gdk_pixbuf_loader_write(loader, reinterpret_cast<const guchar *>(bytes.data() + at), std::min(chunk, bytes.size() - at), nullptr);
    }
    // All of it written and no image yet: closing finishes what the loader can read.
    bool closed = !header.prepared && !failed;
    if (closed) {
      gdk_pixbuf_loader_close(loader, nullptr);
    }
    std::optional<ImageSize> size;
    if (header.prepared && header.width > 0 && header.height > 0) {
      size = ImageSize{header.width, header.height};
      // 5 to 8 turn the image a quarter.
      if (orientationOf(gdk_pixbuf_loader_get_pixbuf(loader)) >= 5) {
        std::swap(size->width, size->height);
      }
    }
    // A loader left part way through says so as it closes; that is expected here.
    if (!closed) {
      gdk_pixbuf_loader_close(loader, nullptr);
    }
    g_object_unref(loader);
    return size;
  }

  bool encodes(const std::string &format) override {
    std::string name = format == "jpg" ? "jpeg" : format;
    GSList *formats = gdk_pixbuf_get_formats();
    bool found = false;
    for (GSList *at = formats; at && !found; at = at->next) {
      auto *candidate = static_cast<GdkPixbufFormat *>(at->data);
      gchar *candidateName = gdk_pixbuf_format_get_name(candidate);
      found = name == candidateName && gdk_pixbuf_format_is_writable(candidate);
      g_free(candidateName);
    }
    g_slist_free(formats);
    return found;
  }

  std::string render(const std::string &bytes, const std::vector<ImageStep> &steps, const std::string &format, double quality) override {
    GdkPixbuf *upright = uprightPixbuf(bytes);
    if (!upright) {
      throw std::runtime_error("Image cannot be found");
    }
    cairo_surface_t *image = nullptr;
    try {
      image = surfaceOf(upright);
    } catch (...) {
      g_object_unref(upright);
      throw;
    }
    g_object_unref(upright);
    for (const auto &step : steps) {
      cairo_surface_t *next = nullptr;
      try {
        next = apply(image, step);
      } catch (...) {
        cairo_surface_destroy(image);
        throw;
      }
      cairo_surface_destroy(image);
      image = next;
    }
    cairo_surface_flush(image);
    GdkPixbuf *result = gdk_pixbuf_get_from_surface(image, 0, 0, cairo_image_surface_get_width(image), cairo_image_surface_get_height(image));
    cairo_surface_destroy(image);
    if (!result) {
      throw std::runtime_error("Could not read the image from the drawing context");
    }
    gchar *buffer = nullptr;
    gsize length = 0;
    GError *error = nullptr;
    bool saved = false;
    if (format == "png") {
      saved = gdk_pixbuf_save_to_buffer(result, &buffer, &length, "png", &error, nullptr);
    } else if (format == "webp") {
      auto level = std::to_string(static_cast<int>(std::lround(std::clamp(quality, 0.0, 1.0) * 100)));
      saved = gdk_pixbuf_save_to_buffer(result, &buffer, &length, "webp", &error, "quality", level.c_str(), nullptr);
    } else {
      // JPEG has no alpha, so it is given the colour channels only: gdk-pixbuf 2.44 and later
      // write JPEG through glycin, whose encoder refuses an image with alpha.
      auto level = std::to_string(static_cast<int>(std::lround(std::clamp(quality, 0.0, 1.0) * 100)));
      GdkPixbuf *opaque = withoutAlpha(result);
      saved = gdk_pixbuf_save_to_buffer(opaque, &buffer, &length, "jpeg", &error, "quality", level.c_str(), nullptr);
      g_object_unref(opaque);
    }
    g_object_unref(result);
    if (!saved) {
      g_clear_error(&error);
      throw std::runtime_error("Cannot create image data for given image format");
    }
    std::string out(buffer, length);
    g_free(buffer);
    return out;
  }
};

} // namespace

std::shared_ptr<ImageCodec> makeImageCodec() {
  return std::make_shared<PixbufCodec>();
}

std::optional<std::pair<double, double>> imagePixelSize(const std::string &path) {
  int width = 0, height = 0;
  if (!gdk_pixbuf_get_file_info(path.c_str(), &width, &height) || width <= 0 || height <= 0) {
    return std::nullopt;
  }
  return std::pair<double, double>(width, height);
}

} // namespace ngn::gtk
