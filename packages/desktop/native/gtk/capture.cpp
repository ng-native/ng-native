#include "capture.h"

namespace ngn::gtk {

GdkTexture *renderWidget(GtkWidget *widget) {
  int width = gtk_widget_get_width(widget);
  int height = gtk_widget_get_height(widget);
  GtkNative *native = gtk_widget_get_native(widget);
  GskRenderer *renderer = native ? gtk_native_get_renderer(native) : nullptr;
  if (width <= 0 || height <= 0 || !renderer) {
    return nullptr;
  }
  float scale = static_cast<float>(gtk_widget_get_scale_factor(widget));
  GdkPaintable *paintable = gtk_widget_paintable_new(widget);
  GtkSnapshot *snapshot = gtk_snapshot_new();
  gtk_snapshot_scale(snapshot, scale, scale);
  gdk_paintable_snapshot(paintable, snapshot, width, height);
  g_object_unref(paintable);
  GskRenderNode *node = gtk_snapshot_free_to_node(snapshot);
  if (!node) {
    return nullptr;
  }
  graphene_rect_t bounds;
  graphene_rect_init(&bounds, 0, 0, static_cast<float>(width) * scale, static_cast<float>(height) * scale);
  GdkTexture *texture = gsk_renderer_render_texture(renderer, node, &bounds);
  gsk_render_node_unref(node);
  return texture;
}

bool captureWidget(GtkWidget *widget, const std::string &path) {
  GdkTexture *texture = renderWidget(widget);
  if (!texture) {
    return false;
  }
  bool saved = gdk_texture_save_to_png(texture, path.c_str());
  g_object_unref(texture);
  return saved;
}

} // namespace ngn::gtk
