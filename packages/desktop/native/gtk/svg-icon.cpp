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

} // namespace

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
