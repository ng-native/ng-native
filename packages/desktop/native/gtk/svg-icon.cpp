#include "svg-icon.h"

#include "cairo-canvas.h"

#include "ngn/svg-markup.h"

#include <algorithm>
#include <cmath>
#include <memory>

namespace ngn::gtk {

namespace {

uint32_t argbOf(const GdkRGBA &color) {
  auto channel = [](float v) { return static_cast<uint32_t>(std::lround(std::clamp(v, 0.0f, 1.0f) * 255)); };
  return channel(color.alpha) << 24 | channel(color.red) << 16 | channel(color.green) << 8 | channel(color.blue);
}

void drawIcon(GtkDrawingArea *area, cairo_t *cr, int width, int height, gpointer data) {
  const auto &document = *static_cast<const SvgDocument *>(data);
  GdkRGBA color;
  gtk_widget_get_color(GTK_WIDGET(area), &color);
  auto canvas = makeCairoCanvas(cr, width, height, gtk_widget_get_scale_factor(GTK_WIDGET(area)));
  drawSvg(svgPaintedIn(document, argbOf(color)), width, height, *canvas);
}

// `document` drawn `size` pixels square in `argb` on an ARGB32 surface, which the caller destroys;
// null where cairo could not make the surface or draw on it, such as at a size past its limit.
cairo_surface_t *drawnSurface(const SvgDocument &document, int size, uint32_t argb) {
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, size, size);
  cairo_t *cr = cairo_create(surface);
  if (cairo_status(cr) == CAIRO_STATUS_SUCCESS) {
    auto canvas = makeCairoCanvas(cr, size, size, 1);
    drawSvg(svgPaintedIn(document, argb), size, size, *canvas);
  }
  cairo_status_t status = cairo_status(cr);
  cairo_destroy(cr);
  cairo_surface_flush(surface);
  if (status != CAIRO_STATUS_SUCCESS || cairo_surface_status(surface) != CAIRO_STATUS_SUCCESS) {
    cairo_surface_destroy(surface);
    return nullptr;
  }
  return surface;
}

} // namespace

std::string svgIconPng(const std::string &markup, int size, uint32_t argb) {
  auto document = parseSvgMarkup(markup);
  if (!document || size <= 0) {
    return {};
  }
  cairo_surface_t *surface = drawnSurface(*document, size, argb);
  if (surface == nullptr) {
    return {};
  }
  std::string png;
  cairo_status_t status = cairo_surface_write_to_png_stream(
      surface,
      [](void *out, const unsigned char *data, unsigned int length) {
        static_cast<std::string *>(out)->append(reinterpret_cast<const char *>(data), length);
        return CAIRO_STATUS_SUCCESS;
      },
      &png);
  cairo_surface_destroy(surface);
  // A PNG cut short by a failed write is none.
  return status == CAIRO_STATUS_SUCCESS ? png : std::string{};
}

GVariant *svgIconPixmaps(const std::string &markup, uint32_t argb, std::initializer_list<int> sizes) {
  GVariantBuilder pixmaps;
  g_variant_builder_init(&pixmaps, G_VARIANT_TYPE("a(iiay)"));
  if (auto document = parseSvgMarkup(markup)) {
    for (int size : sizes) {
      cairo_surface_t *surface = drawnSurface(*document, size, argb);
      if (surface == nullptr) {
        continue;
      }
      const unsigned char *data = cairo_image_surface_get_data(surface);
      int stride = cairo_image_surface_get_stride(surface);
      std::string bytes;
      bytes.reserve(static_cast<size_t>(size) * size * 4);
      for (int y = 0; y < size; y++) {
        const auto *row = reinterpret_cast<const uint32_t *>(data + static_cast<size_t>(y) * stride);
        for (int x = 0; x < size; x++) {
          // Cairo's pixel is premultiplied, in the machine's byte order.
          uint32_t p = row[x];
          uint32_t a = p >> 24;
          auto un = [a](uint32_t c) { return static_cast<char>(a == 0 ? 0 : std::min<uint32_t>(255, (c * 255 + a / 2) / a)); };
          bytes += static_cast<char>(a);
          bytes += un((p >> 16) & 0xff);
          bytes += un((p >> 8) & 0xff);
          bytes += un(p & 0xff);
        }
      }
      cairo_surface_destroy(surface);
      g_variant_builder_add(
          &pixmaps, "(ii@ay)", size, size,
          g_variant_new_fixed_array(G_VARIANT_TYPE_BYTE, bytes.data(), bytes.size(), 1));
    }
  }
  return g_variant_builder_end(&pixmaps);
}

GtkWidget *makeSvgIcon(const std::string &markup, int size) {
  auto document = parseSvgMarkup(markup);
  if (!document) {
    return nullptr;
  }
  GtkWidget *area = gtk_drawing_area_new();
  gtk_drawing_area_set_content_width(GTK_DRAWING_AREA(area), size);
  gtk_drawing_area_set_content_height(GTK_DRAWING_AREA(area), size);
  gtk_widget_set_valign(area, GTK_ALIGN_CENTER);
  gtk_drawing_area_set_draw_func(
      GTK_DRAWING_AREA(area), drawIcon, new SvgDocument(std::move(*document)), [](gpointer data) {
        delete static_cast<SvgDocument *>(data);
      });
  gtk_accessible_update_state(GTK_ACCESSIBLE(area), GTK_ACCESSIBLE_STATE_HIDDEN, TRUE, -1);
  g_object_set_data_full(G_OBJECT(area), "ngn-svg-icon", g_strdup(markup.c_str()), g_free);
  return area;
}

} // namespace ngn::gtk
