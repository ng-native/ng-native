// Drag and drop on GTK: a drop target on the surface handing drags to the input sink, a drop's
// value as the dispatcher's items, and what a drag out offers. Which view takes a drop, and the
// events it hears, are the core's (input-dispatcher tests).
#include "../drag-and-drop.h"
#include "../input-replay.h"
#include "../surface-input.h"
#include "mounted-views.h"

#include <doctest/doctest.h>
#ifdef GDK_WINDOWING_X11
#include <gdk/x11/gdkx.h>
#endif

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

// What a browser's link drag offers: the link as a uri list, and words as text.
GdkContentProvider *linkAndText(GtkDragSource *, double, double, gpointer) {
  static const char uris[] = "https://ng-native.dev/\r\n";
  GBytes *bytes = g_bytes_new_static(uris, sizeof uris - 1);
  GdkContentProvider *parts[] = {gdk_content_provider_new_for_bytes("text/uri-list", bytes),
                                 gdk_content_provider_new_typed(G_TYPE_STRING, "Read the guide")};
  g_bytes_unref(bytes);
  return gdk_content_provider_new_union(parts, 2);
}

bool onX11() {
#ifdef GDK_WINDOWING_X11
  return GDK_IS_X11_DISPLAY(gdk_display_get_default());
#else
  return false;
#endif
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

// A drag that offers text and fails every read of it, as a source that dies mid-transfer does.
struct FailingProvider {
  GdkContentProvider parent;
};
struct FailingProviderClass {
  GdkContentProviderClass parent_class;
};
G_DEFINE_TYPE(FailingProvider, failing_provider, GDK_TYPE_CONTENT_PROVIDER)
static void failing_provider_init(FailingProvider *) {}
static void failing_provider_class_init(FailingProviderClass *klass) {
  auto *provider = GDK_CONTENT_PROVIDER_CLASS(klass);
  provider->ref_formats = [](GdkContentProvider *) { return gdk_content_formats_new_for_gtype(G_TYPE_STRING); };
  provider->get_value = [](GdkContentProvider *, GValue *, GError **error) {
    g_set_error_literal(error, G_IO_ERROR, G_IO_ERROR_FAILED, "the source went away");
    return FALSE;
  };
}

namespace {

GdkContentProvider *failingText(GtkDragSource *, double, double, gpointer) {
  return GDK_CONTENT_PROVIDER(g_object_new(failing_provider_get_type(), nullptr));
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

TEST_CASE("a drag carrying a link and text hands the view under it both, and the drop goes to the input sink") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    MESSAGE("not X11: no input script to drag with");
    return;
  }
  RecordingSink sink;
  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 400, 100);
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
  GtkWidget *source = gtk_label_new("link");
  gtk_widget_set_size_request(source, 200, 100);
  GtkWidget *surface = gtk_label_new("surface");
  gtk_widget_set_size_request(surface, 200, 100);
  gtk_box_append(GTK_BOX(box), source);
  gtk_box_append(GTK_BOX(box), surface);
  gtk_window_set_child(GTK_WINDOW(window), box);
  ngn::gtk::attachPointerInput(surface, 1, 7, &sink);
  GtkDragSource *drag = gtk_drag_source_new();
  g_signal_connect(drag, "prepare", G_CALLBACK(linkAndText), nullptr);
  gtk_widget_add_controller(source, GTK_EVENT_CONTROLLER(drag));
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window) && gtk_widget_get_width(window) > 0; });

  // X11 drag and drop needs a few positions over the target before it enters, and the drag's data
  // comes a little after: the waits give both time.
  auto script = ngn::parseInputScript(
      "wait 200\nmove 50 50\ndown 50 50\ndrag 80 50\ndrag 150 50\ndrag 250 50\nwait 300\ndrag 270 55\nwait 300\ndrag 290 60\nwait 300\ndrag 300 60\nwait 1500\nup 300 60\nwait 300\n");
  REQUIRE(ngn::gtk::replayInputScript(window, std::move(script)));
  ngn::testing::runUntil([&sink] { return !sink.drops.empty(); });
  REQUIRE(sink.drops.size() == 1);
  const auto &[point, items] = sink.drops[0];
  // At the surface's own point.
  CHECK(point.x == doctest::Approx(100).epsilon(0.1));
  CHECK(items.urls == std::vector<std::string>{"https://ng-native.dev/"});
  CHECK(items.text == "Read the guide");
  // The view under the drag heard what it carries before the drop.
  REQUIRE_FALSE(sink.over.empty());
  // The first enter came before the data was read: hit tested, and told to wait.
  CHECK(sink.over.front().second.pending);
  CHECK_FALSE(sink.over.back().second.pending);
  CHECK(sink.over.back().second.text == "Read the guide");
  CHECK(sink.over.back().second.urls == std::vector<std::string>{"https://ng-native.dev/"});
  gtk_window_destroy(GTK_WINDOW(window));
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

TEST_CASE("a drag whose every read fails is refused, and its drop never reaches the input sink") {
  REQUIRE(ngn::testing::gtkReady());
  if (!onX11()) {
    MESSAGE("not X11: no input script to drag with");
    return;
  }
  RecordingSink sink;
  GtkWidget *window = gtk_window_new();
  gtk_window_set_default_size(GTK_WINDOW(window), 400, 100);
  GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
  GtkWidget *source = gtk_label_new("link");
  gtk_widget_set_size_request(source, 200, 100);
  GtkWidget *surface = gtk_label_new("surface");
  gtk_widget_set_size_request(surface, 200, 100);
  gtk_box_append(GTK_BOX(box), source);
  gtk_box_append(GTK_BOX(box), surface);
  gtk_window_set_child(GTK_WINDOW(window), box);
  ngn::gtk::attachPointerInput(surface, 1, 7, &sink);
  GtkDragSource *drag = gtk_drag_source_new();
  g_signal_connect(drag, "prepare", G_CALLBACK(failingText), nullptr);
  gtk_widget_add_controller(source, GTK_EVENT_CONTROLLER(drag));
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([window] { return gtk_widget_get_mapped(window) && gtk_widget_get_width(window) > 0; });

  auto script = ngn::parseInputScript(
      "wait 200\nmove 50 50\ndown 50 50\ndrag 80 50\ndrag 150 50\ndrag 250 50\nwait 300\ndrag 270 55\nwait 300\ndrag 290 60\nwait 300\ndrag 300 60\nwait 1500\nup 300 60\nwait 1500\n");
  REQUIRE(ngn::gtk::replayInputScript(window, std::move(script)));
  // The script takes about five seconds; the loop is run over it a few at a time.
  for (int i = 0; i < 2; ++i) {
    gint64 until = g_get_monotonic_time() + 4 * G_USEC_PER_SEC;
    ngn::testing::runUntil([until] { return g_get_monotonic_time() > until; });
  }
  // The drag was seen over the surface, but nothing was delivered as dropped.
  CHECK_FALSE(sink.over.empty());
  CHECK(sink.drops.empty());
  gtk_window_destroy(GTK_WINDOW(window));
}
