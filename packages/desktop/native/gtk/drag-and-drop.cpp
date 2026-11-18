#include "drag-and-drop.h"

#include <memory>
#include <string>
#include <vector>

namespace ngn::gtk {

namespace {

struct DropState {
  ContainerId container;
  InputSink *input;
  double x{0}, y{0};
  bool over{false};
};

PointerInput dropInput(const DropState &s) {
  PointerInput input;
  input.container = s.container;
  input.point = {static_cast<float>(s.x), static_cast<float>(s.y)};
  input.screenPoint = input.point;
  input.buttons = 1;
  return input;
}

GdkDragAction dragOver(GtkDropTarget *target, double x, double y, gpointer user) {
  auto *s = static_cast<DropState *>(user);
  s->x = x;
  s->y = y;
  s->over = true;
  // Read ahead (preload): empty until the drag's data has come.
  return s->input->dragOver(dropInput(*s), dropItems(gtk_drop_target_get_value(target))) ? GDK_ACTION_COPY : GdkDragAction(0);
}

// The drag's data came after it entered: the view under it hears what it carries.
void valueCame(GtkDropTarget *target, GParamSpec *, gpointer user) {
  auto *s = static_cast<DropState *>(user);
  if (s->over && gtk_drop_target_get_value(target)) {
    s->input->dragOver(dropInput(*s), dropItems(gtk_drop_target_get_value(target)));
  }
}

void dragLeft(GtkDropTarget *, gpointer user) {
  auto *s = static_cast<DropState *>(user);
  s->over = false;
  s->input->dragExit(s->container);
}

gboolean dropped(GtkDropTarget *, const GValue *value, double x, double y, gpointer user) {
  auto *s = static_cast<DropState *>(user);
  s->x = x;
  s->y = y;
  s->over = false;
  return s->input->drop(dropInput(*s), dropItems(value));
}

using Uses = std::vector<std::shared_ptr<FileAccess::Use>>;

// The drag is over, dropped or cancelled: its reference goes, and with it the file uses it held.
void dragEnded(GdkDrag *drag, gpointer) {
  g_signal_handlers_disconnect_by_data(drag, nullptr);
  g_object_unref(drag);
}

void dragCancelled(GdkDrag *drag, GdkDragCancelReason, gpointer) {
  dragEnded(drag, nullptr);
}

} // namespace

DragItems dropItems(const GValue *value) {
  std::vector<std::string> urls;
  std::optional<std::string> text;
  if (value && G_VALUE_HOLDS(value, GDK_TYPE_FILE_LIST)) {
    if (auto *list = static_cast<GdkFileList *>(g_value_get_boxed(value))) {
      GSList *files = gdk_file_list_get_files(list);
      for (GSList *at = files; at; at = at->next) {
        gchar *uri = g_file_get_uri(G_FILE(at->data));
        urls.emplace_back(uri);
        g_free(uri);
      }
      g_slist_free(files);
    }
  } else if (value && G_VALUE_HOLDS_STRING(value) && g_value_get_string(value)) {
    text = g_value_get_string(value);
  }
  return dragItems(urls, std::move(text));
}

void attachDropTarget(GtkWidget *widget, ContainerId container, InputSink *input) {
  auto *state = new DropState{.container = container, .input = input};
  GtkDropTarget *target = gtk_drop_target_new(G_TYPE_INVALID, GDK_ACTION_COPY);
  // Files first: a file manager's drag offers its paths as text too.
  GType types[] = {GDK_TYPE_FILE_LIST, G_TYPE_STRING};
  gtk_drop_target_set_gtypes(target, types, G_N_ELEMENTS(types));
  gtk_drop_target_set_preload(target, TRUE);
  g_signal_connect(target, "enter", G_CALLBACK(dragOver), state);
  g_signal_connect(target, "motion", G_CALLBACK(dragOver), state);
  g_signal_connect(target, "notify::value", G_CALLBACK(valueCame), state);
  g_signal_connect(target, "leave", G_CALLBACK(dragLeft), state);
  g_signal_connect(target, "drop", G_CALLBACK(dropped), state);
  g_object_set_data_full(G_OBJECT(target), "ngn-drop", state, [](gpointer p) { delete static_cast<DropState *>(p); });
  gtk_widget_add_controller(widget, GTK_EVENT_CONTROLLER(target));
}

GdkContentProvider *dragContent(const DragOutItem &item) {
  std::vector<GdkContentProvider *> parts;
  std::string uriList;
  if (!item.files.empty()) {
    GSList *files = nullptr;
    for (const auto &uri : item.files) {
      files = g_slist_append(files, g_file_new_for_uri(uri.c_str()));
    }
    GdkFileList *list = gdk_file_list_new_from_list(files);
    g_slist_free_full(files, g_object_unref);
    // GDK serializes it as text/uri-list, and for a sandboxed taker through the file transfer portal.
    parts.push_back(gdk_content_provider_new_typed(GDK_TYPE_FILE_LIST, list));
    g_boxed_free(GDK_TYPE_FILE_LIST, list);
  } else if (item.url) {
    uriList = *item.url + "\r\n";
    GBytes *bytes = g_bytes_new(uriList.data(), uriList.size());
    parts.push_back(gdk_content_provider_new_for_bytes("text/uri-list", bytes));
    g_bytes_unref(bytes);
  }
  if (auto text = item.text ? item.text : item.url) {
    parts.push_back(gdk_content_provider_new_typed(G_TYPE_STRING, text->c_str()));
  }
  return gdk_content_provider_new_union(parts.data(), parts.size());
}

GdkDrag *beginDragOut(GtkWidget *view, GdkEvent *event, const DragOutItem &item) {
  GtkNative *native = view ? gtk_widget_get_native(view) : nullptr;
  GdkDevice *device = event ? gdk_event_get_device(event) : nullptr;
  if (!native || !device) {
    return nullptr;
  }
  GdkSurface *surface = gtk_native_get_surface(native);
  GdkContentProvider *content = dragContent(item);
  GdkDrag *drag = gdk_drag_begin(surface, device, content, GDK_ACTION_COPY, 0, 0);
  g_object_unref(content);
  if (!drag) {
    return nullptr;
  }
  // The view's look under the pointer, held where the press took it.
  double x = 0, y = 0, tx = 0, ty = 0;
  gdk_event_get_position(event, &x, &y);
  gtk_native_get_surface_transform(native, &tx, &ty);
  graphene_point_t in, at;
  graphene_point_init(&in, static_cast<float>(x - tx), static_cast<float>(y - ty));
  if (!gtk_widget_compute_point(GTK_WIDGET(native), view, &in, &at)) {
    graphene_point_init(&at, 0, 0);
  }
  GdkPaintable *look = gtk_widget_paintable_new(view);
  gtk_drag_icon_set_from_paintable(drag, look, static_cast<int>(at.x), static_cast<int>(at.y));
  g_object_unref(look);
  g_object_set_data_full(G_OBJECT(drag), "ngn-uses", new Uses(item.uses), [](gpointer p) { delete static_cast<Uses *>(p); });
  g_signal_connect(drag, "dnd-finished", G_CALLBACK(dragEnded), nullptr);
  g_signal_connect(drag, "cancel", G_CALLBACK(dragCancelled), nullptr);
  return drag;
}

} // namespace ngn::gtk
