#include "drag-and-drop.h"

#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn::gtk {

namespace {

// A drag over the surface: where it is, and what it carries once both reads have come. A drop
// made before then is answered as they do.
struct DropState {
  ContainerId container;
  InputSink *input;
  double x{0}, y{0};
  bool over{false};
  // The drag being read, and what it carries once read: one at a time.
  GdkDrop *drop{nullptr};
  std::optional<DragItems> items;
  // Drops made before their items came, with where each was made.
  std::vector<std::pair<GdkDrop *, PointerInput>> waiting;
  // Reads still running, which hold this state.
  int reading{0};
  bool detached{false};
};

PointerInput dropInput(const DropState &s) {
  PointerInput input;
  input.container = s.container;
  input.point = {static_cast<float>(s.x), static_cast<float>(s.y)};
  input.screenPoint = input.point;
  input.buttons = 1;
  return input;
}

// What a drop offers, with what GDK makes of it: a uri list as a GdkFileList, text as a string.
std::pair<bool, bool> offers(GdkDrop *drop) {
  GdkContentFormats *formats = gdk_content_formats_union_deserialize_gtypes(gdk_content_formats_ref(gdk_drop_get_formats(drop)));
  std::pair<bool, bool> out{gdk_content_formats_contain_gtype(formats, GDK_TYPE_FILE_LIST), gdk_content_formats_contain_gtype(formats, G_TYPE_STRING)};
  gdk_content_formats_unref(formats);
  return out;
}

void forget(DropState *s) {
  if (--s->reading == 0 && s->detached) {
    delete s;
  }
}

// Both reads came: the drop waiting for them is answered, and the drag still over the surface
// carries them.
void itemsCame(DropState *s, GdkDrop *drop, DragItems items) {
  for (auto it = s->waiting.begin(); it != s->waiting.end(); ++it) {
    if (it->first == drop) {
      bool taken = s->input->drop(it->second, items);
      gdk_drop_finish(drop, taken ? GDK_ACTION_COPY : GdkDragAction(0));
      g_object_unref(drop);
      s->waiting.erase(it);
      return;
    }
  }
  if (drop == s->drop) {
    s->items = items;
    if (s->over) {
      s->input->dragOver(dropInput(*s), items);
    }
  }
}

struct Read {
  DropState *state;
  GdkDrop *drop;
  bool text;
  std::vector<std::string> urls;
};

void finishRead(std::unique_ptr<Read> read, std::optional<std::string> text) {
  if (!read->state->detached) {
    itemsCame(read->state, read->drop, dragItems(read->urls, std::move(text)));
  }
  forget(read->state);
  g_object_unref(read->drop);
}

void textRead(GObject *source, GAsyncResult *result, gpointer data) {
  std::unique_ptr<Read> read(static_cast<Read *>(data));
  const GValue *value = gdk_drop_read_value_finish(GDK_DROP(source), result, nullptr);
  std::optional<std::string> text;
  if (value && G_VALUE_HOLDS_STRING(value) && g_value_get_string(value)) {
    text = g_value_get_string(value);
  }
  finishRead(std::move(read), std::move(text));
}

void readText(std::unique_ptr<Read> read) {
  if (!read->text) {
    finishRead(std::move(read), std::nullopt);
    return;
  }
  GdkDrop *drop = read->drop;
  gdk_drop_read_value_async(drop, G_TYPE_STRING, G_PRIORITY_DEFAULT, nullptr, textRead, read.release());
}

void filesRead(GObject *source, GAsyncResult *result, gpointer data) {
  std::unique_ptr<Read> read(static_cast<Read *>(data));
  const GValue *value = gdk_drop_read_value_finish(GDK_DROP(source), result, nullptr);
  if (value) {
    auto items = dropItems(value);
    for (const auto &file : items.files) {
      read->urls.push_back(file.uri);
    }
    read->urls.insert(read->urls.end(), items.urls.begin(), items.urls.end());
  }
  readText(std::move(read));
}

// Reads the drop's file list, then its text, as macOS hands a view both.
void readDrop(DropState *s, GdkDrop *drop) {
  auto [files, text] = offers(drop);
  ++s->reading;
  auto read = std::make_unique<Read>(Read{.state = s, .drop = GDK_DROP(g_object_ref(drop)), .text = text});
  if (!files) {
    readText(std::move(read));
    return;
  }
  gdk_drop_read_value_async(drop, GDK_TYPE_FILE_LIST, G_PRIORITY_DEFAULT, nullptr, filesRead, read.release());
}

gboolean accepts(GtkDropTargetAsync *, GdkDrop *drop, gpointer) {
  auto [files, text] = offers(drop);
  return files || text;
}

GdkDragAction over(DropState *s, GdkDrop *drop, double x, double y) {
  s->x = x;
  s->y = y;
  s->over = true;
  if (drop != s->drop) {
    s->drop = drop;
    s->items.reset();
    readDrop(s, drop);
  }
  // Empty until the drag's data has come, as the view under it then hears.
  return s->input->dragOver(dropInput(*s), s->items.value_or(DragItems{})) ? GDK_ACTION_COPY : GdkDragAction(0);
}

GdkDragAction dragEntered(GtkDropTargetAsync *, GdkDrop *drop, double x, double y, gpointer user) {
  return over(static_cast<DropState *>(user), drop, x, y);
}

void dragLeft(GtkDropTargetAsync *, GdkDrop *, gpointer user) {
  auto *s = static_cast<DropState *>(user);
  s->over = false;
  s->drop = nullptr;
  s->items.reset();
  s->input->dragExit(s->container);
}

gboolean dropped(GtkDropTargetAsync *, GdkDrop *drop, double x, double y, gpointer user) {
  auto *s = static_cast<DropState *>(user);
  s->x = x;
  s->y = y;
  s->over = false;
  auto input = dropInput(*s);
  if (drop == s->drop && s->items) {
    bool taken = s->input->drop(input, *s->items);
    gdk_drop_finish(drop, taken ? GDK_ACTION_COPY : GdkDragAction(0));
    return TRUE;
  }
  // Its items have not come yet: answered as they do.
  if (drop != s->drop) {
    s->drop = drop;
    readDrop(s, drop);
  }
  s->waiting.emplace_back(GDK_DROP(g_object_ref(drop)), input);
  return TRUE;
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
  // Async, so that a drag's file list and its text are both read: a GtkDropTarget takes one.
  GtkDropTargetAsync *target = gtk_drop_target_async_new(nullptr, GDK_ACTION_COPY);
  g_signal_connect(target, "accept", G_CALLBACK(accepts), state);
  g_signal_connect(target, "drag-enter", G_CALLBACK(dragEntered), state);
  g_signal_connect(target, "drag-motion", G_CALLBACK(dragEntered), state);
  g_signal_connect(target, "drag-leave", G_CALLBACK(dragLeft), state);
  g_signal_connect(target, "drop", G_CALLBACK(dropped), state);
  // Reads still running hold the state until they finish.
  g_object_set_data_full(G_OBJECT(target), "ngn-drop", state, [](gpointer p) {
    auto *s = static_cast<DropState *>(p);
    for (auto &[drop, input] : s->waiting) {
      gdk_drop_finish(drop, GdkDragAction(0));
      g_object_unref(drop);
    }
    s->waiting.clear();
    s->detached = true;
    if (s->reading == 0) {
      delete s;
    }
  });
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
