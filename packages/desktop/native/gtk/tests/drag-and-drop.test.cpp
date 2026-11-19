// Drag and drop on GTK: a drop target on the surface handing drags to the input sink, a drop's
// value as the dispatcher's items, and what a drag out offers. Which view takes a drop, and the
// events it hears, are the core's (input-dispatcher tests).
#include "../drag-and-drop.h"
#include "../surface-input.h"
#include "mounted-views.h"

#include <doctest/doctest.h>

#include <optional>
#include <string>
#include <vector>

namespace {

struct RecordingSink final : ngn::InputSink {
  bool takes{true};
  std::vector<std::pair<facebook::react::Point, ngn::DragItems>> over;
  std::vector<std::pair<facebook::react::Point, ngn::DragItems>> drops;
  std::vector<ngn::ContainerId> exits;

  void addContainer(ngn::ContainerId, facebook::react::SurfaceId, facebook::react::Tag) override {}
  void removeContainer(ngn::ContainerId) override {}
  void pointerDown(const ngn::PointerInput &) override {}
  void pointerMove(const ngn::PointerInput &) override {}
  void pointerUp(const ngn::PointerInput &) override {}
  void pointerLeave(facebook::react::SurfaceId, const ngn::PointerInput &) override {}
  bool contextMenu(const ngn::PointerInput &) override { return false; }
  ngn::WheelResult wheel(const ngn::PointerInput &, const ngn::WheelDelta &) override { return {}; }
  bool dragOver(const ngn::PointerInput &input, const ngn::DragItems &items) override {
    over.emplace_back(input.point, items);
    return takes;
  }
  void dragExit(ngn::ContainerId container) override { exits.push_back(container); }
  bool drop(const ngn::PointerInput &input, const ngn::DragItems &items) override {
    drops.emplace_back(input.point, items);
    return takes;
  }
};

GValue fileListValue(const std::vector<std::string> &uris) {
  GSList *files = nullptr;
  for (const auto &uri : uris) {
    files = g_slist_append(files, g_file_new_for_uri(uri.c_str()));
  }
  GValue value = G_VALUE_INIT;
  g_value_init(&value, GDK_TYPE_FILE_LIST);
  g_value_take_boxed(&value, gdk_file_list_new_from_list(files));
  g_slist_free_full(files, g_object_unref);
  return value;
}

GtkDropTarget *dropTargetOf(GtkWidget *widget) {
  GListModel *controllers = gtk_widget_observe_controllers(widget);
  GtkDropTarget *found = nullptr;
  for (guint i = 0; i < g_list_model_get_n_items(controllers) && !found; ++i) {
    auto *controller = g_list_model_get_item(controllers, i);
    if (GTK_IS_DROP_TARGET(controller)) {
      found = GTK_DROP_TARGET(controller);
    }
    g_object_unref(controller);
  }
  g_object_unref(controllers);
  return found;
}

std::optional<std::string> valueOf(GdkContentProvider *content, GType type) {
  GValue value = G_VALUE_INIT;
  g_value_init(&value, type);
  std::optional<std::string> out;
  if (gdk_content_provider_get_value(content, &value, nullptr)) {
    if (type == G_TYPE_STRING) {
      out = g_value_get_string(&value);
    } else {
      GSList *files = gdk_file_list_get_files(static_cast<GdkFileList *>(g_value_get_boxed(&value)));
      gchar *uri = g_file_get_uri(G_FILE(files->data));
      out = uri;
      g_free(uri);
      g_slist_free(files);
    }
  }
  g_value_unset(&value);
  return out;
}

} // namespace

TEST_CASE("a drop's files and urls come from its file list, and its text from a string") {
  REQUIRE(ngn::testing::gtkReady());
  GValue files = fileListValue({"file:///tmp/a%20report.txt", "https://example.com/page"});
  auto items = ngn::gtk::dropItems(&files);
  REQUIRE(items.files.size() == 1);
  CHECK(items.files[0].uri == "file:///tmp/a%20report.txt");
  CHECK(items.files[0].name == "a report.txt");
  CHECK(items.urls == std::vector<std::string>{"https://example.com/page"});
  g_value_unset(&files);

  GValue text = G_VALUE_INIT;
  g_value_init(&text, G_TYPE_STRING);
  g_value_set_string(&text, "Some words");
  items = ngn::gtk::dropItems(&text);
  CHECK(items.files.empty());
  CHECK(items.text == "Some words");
  g_value_unset(&text);
  // Not loaded yet: nothing.
  CHECK(ngn::gtk::dropItems(nullptr).files.empty());
}

TEST_CASE("a drag over a surface goes to the input sink as its container's, and so does a drop and a leave") {
  REQUIRE(ngn::testing::gtkReady());
  RecordingSink sink;
  GtkWidget *surface = gtk_label_new("surface");
  g_object_ref_sink(surface);
  ngn::gtk::attachPointerInput(surface, 1, 7, &sink);
  GtkDropTarget *target = dropTargetOf(surface);
  REQUIRE(target);

  GdkDragAction action{};
  g_signal_emit_by_name(target, "enter", 12.0, 34.0, &action);
  CHECK(action == GDK_ACTION_COPY);
  REQUIRE(sink.over.size() == 1);
  CHECK(sink.over[0].first.x == 12);
  CHECK(sink.over[0].first.y == 34);
  // No view there takes drops: the drag is refused.
  sink.takes = false;
  g_signal_emit_by_name(target, "motion", 50.0, 60.0, &action);
  CHECK(action == 0);
  sink.takes = true;

  g_signal_emit_by_name(target, "leave");
  CHECK(sink.exits == std::vector<ngn::ContainerId>{7});

  GValue files = fileListValue({"file:///tmp/dropped.png"});
  gboolean taken = FALSE;
  g_signal_emit_by_name(target, "drop", &files, 5.0, 6.0, &taken);
  CHECK(taken);
  REQUIRE(sink.drops.size() == 1);
  CHECK(sink.drops[0].first.x == 5);
  REQUIRE(sink.drops[0].second.files.size() == 1);
  CHECK(sink.drops[0].second.files[0].name == "dropped.png");
  g_value_unset(&files);
  g_object_unref(surface);
}

TEST_CASE("a drag out offers its files as a file list and its text, or its url, as a string and a uri list") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::DragOutItem files{.files = {"file:///tmp/notes.txt"}, .text = std::string("Notes")};
  GdkContentProvider *content = ngn::gtk::dragContent(files);
  CHECK(valueOf(content, GDK_TYPE_FILE_LIST) == "file:///tmp/notes.txt");
  CHECK(valueOf(content, G_TYPE_STRING) == "Notes");
  g_object_unref(content);

  ngn::DragOutItem link{.url = std::string("https://ng-native.dev")};
  content = ngn::gtk::dragContent(link);
  CHECK(valueOf(content, G_TYPE_STRING) == "https://ng-native.dev");
  GdkContentFormats *formats = gdk_content_provider_ref_formats(content);
  CHECK(gdk_content_formats_contain_mime_type(formats, "text/uri-list"));
  CHECK_FALSE(gdk_content_formats_contain_gtype(formats, GDK_TYPE_FILE_LIST));
  gdk_content_formats_unref(formats);
  g_object_unref(content);
}

TEST_CASE("a drag out starts only from the pointer move the input sink is hearing") {
  REQUIRE(ngn::testing::gtkReady());
  GtkWidget *view = gtk_label_new("card");
  g_object_ref_sink(view);
  CHECK_FALSE(ngn::gtk::dragOutOfPointer(view, ngn::DragOutItem{.text = std::string("x")}));
  CHECK(ngn::gtk::beginDragOut(view, nullptr, ngn::DragOutItem{.text = std::string("x")}) == nullptr);
  g_object_unref(view);
}
