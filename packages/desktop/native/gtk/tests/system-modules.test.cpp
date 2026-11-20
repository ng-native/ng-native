// DocumentPicker's dialogs, the clipboard and printing on GTK: the FileChooser and Print portals
// against a stand-in, the display's GdkClipboard, and GtkPrintOperation's output as a PDF.
#include "../app-windows.h"
#include "../file-dialogs.h"
#include "../host-sources.h"
#include "../image-manipulator.h"
#include "../printing.h"
#include "ngn/photo-library.h"
#include "mounted-views.h"
#include "stand-in-portal.h"

#include <doctest/doctest.h>
#ifdef GDK_WINDOWING_X11
#include <gdk/x11/gdkx.h>
#endif

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

using ngn::testing::StandInPortal;
using Paths = std::optional<std::vector<std::string>>;

namespace {

std::string readFile(const std::string &path) {
  std::ifstream in(path, std::ios::binary);
  std::stringstream text;
  text << in.rdbuf();
  return text.str();
}

// The first page's MediaBox width and height, from cairo's PDF.
std::pair<double, double> pageSize(const std::string &pdf) {
  std::smatch box;
  if (!std::regex_search(pdf, box, std::regex(R"(/MediaBox \[\s*0 0 ([0-9.]+) ([0-9.]+)\s*\])"))) {
    return {0, 0};
  }
  return {std::stod(box[1]), std::stod(box[2])};
}

std::string pngBytes(int width, int height) {
  std::vector<guchar> pixels(width * height * 4, 0x80);
  GBytes *bytes = g_bytes_new(pixels.data(), pixels.size());
  GdkTexture *texture = gdk_memory_texture_new(width, height, GDK_MEMORY_R8G8B8A8, bytes, width * 4);
  g_bytes_unref(bytes);
  GBytes *png = gdk_texture_save_to_png_bytes(texture);
  g_object_unref(texture);
  gsize size = 0;
  auto *data = static_cast<const char *>(g_bytes_get_data(png, &size));
  std::string out(data, size);
  g_bytes_unref(png);
  return out;
}

std::string temporaryPath(const char *name) {
  return (std::filesystem::temp_directory_path() / (std::string(name) + "-" + std::to_string(getpid()))).string();
}

} // namespace

TEST_CASE("DocumentPicker opens files through the FileChooser portal, with its types as one filter") {
  REQUIRE(ngn::testing::gtkReady());
  StandInPortal portal;
  portal.uris = {"file:///tmp/a.txt", "file:///tmp/b%20c.png"};
  auto dialogs = ngn::gtk::makeFileDialogs();
  std::optional<Paths> chosen;
  dialogs->openFiles({.types = {"text/plain", "image/png"}, .multiple = true}, [&chosen](Paths paths) { chosen = paths; });
  ngn::testing::runUntil([&] { return chosen.has_value(); });
  REQUIRE(*chosen);
  CHECK(**chosen == std::vector<std::string>{"/tmp/a.txt", "/tmp/b c.png"});
  REQUIRE(portal.calls.size() == 1);
  CHECK(portal.calls[0].method == "OpenFile");
  CHECK(portal.calls[0].second == "Open Files");
  CHECK(portal.calls[0].multiple);
  CHECK_FALSE(portal.calls[0].directory);
  CHECK(portal.calls[0].types == std::vector<std::string>{"text/plain", "image/png"});

  // Cancelled.
  portal.response = 1;
  chosen.reset();
  dialogs->openFiles({}, [&chosen](Paths paths) { chosen = paths; });
  ngn::testing::runUntil([&] { return chosen.has_value(); });
  CHECK_FALSE(*chosen);
  CHECK_FALSE(portal.calls.back().multiple);
  CHECK(portal.calls.back().types.empty());
}

TEST_CASE("ImagePicker chooses images and videos through the FileChooser portal, and reads an image's size with gdk-pixbuf") {
  REQUIRE(ngn::testing::gtkReady());
  StandInPortal portal;
  auto photo = temporaryPath("ngn-picked") + ".png";
  std::ofstream(photo, std::ios::binary) << pngBytes(30, 20);
  gchar *uri = g_filename_to_uri(photo.c_str(), nullptr, nullptr);
  portal.uris = {uri};
  g_free(uri);
  auto caches = temporaryPath("ngn-picker-caches");
  auto picker = ngn::makeFilePhotoPicker(ngn::gtk::makeFileDialogs(), caches, ngn::gtk::imagePixelSize);
  std::optional<std::optional<std::vector<ngn::PhotoPicker::Picked>>> picked;
  picker->pick(folly::dynamic::object("mediaTypes", folly::dynamic::array("images", "videos"))("allowsMultipleSelection", true),
               [&picked](auto answer) { ngn::gtk::onMainContext([&picked, answer]() mutable { picked = std::move(answer); }); });
  ngn::testing::runUntil([&] { return picked.has_value(); });
  REQUIRE(portal.calls.size() == 1);
  CHECK(portal.calls[0].method == "OpenFile");
  CHECK(portal.calls[0].second == "Choose Images or Videos");
  CHECK(portal.calls[0].multiple);
  CHECK(portal.calls[0].types == std::vector<std::string>{"image/*", "video/*"});
  CHECK(portal.calls[0].filterName == "Images and Videos");
  REQUIRE(*picked);
  REQUIRE((*picked)->size() == 1);
  const auto &image = (**picked)[0];
  CHECK(image.uri.starts_with(ngn::fileUri(caches)));
  CHECK(image.mimeType == "image/png");
  CHECK(image.width == 30);
  CHECK(image.height == 20);
  CHECK_FALSE(ngn::gtk::imagePixelSize(caches + "/none.png"));

  // Cancelled.
  portal.response = 1;
  picked.reset();
  picker->pick(folly::dynamic::object(), [&picked](auto answer) { ngn::gtk::onMainContext([&picked, answer]() mutable { picked = std::move(answer); }); });
  ngn::testing::runUntil([&] { return picked.has_value(); });
  CHECK_FALSE(*picked);
  CHECK(portal.calls.back().second == "Choose an Image");
  CHECK(portal.calls.back().types == std::vector<std::string>{"image/*"});
  std::filesystem::remove_all(caches);
  std::filesystem::remove(photo);
}

TEST_CASE("DocumentPicker saves through SaveFile with the suggested name, and chooses a folder through OpenFile") {
  REQUIRE(ngn::testing::gtkReady());
  StandInPortal portal;
  portal.uris = {"file:///home/ada/Notes/report.pdf"};
  auto dialogs = ngn::gtk::makeFileDialogs();
  std::optional<std::optional<std::string>> saved;
  dialogs->saveFile({.suggestedName = "report.pdf", .types = {"application/pdf"}}, [&saved](std::optional<std::string> path) { saved = path; });
  ngn::testing::runUntil([&] { return saved.has_value(); });
  CHECK(*saved == "/home/ada/Notes/report.pdf");
  CHECK(portal.calls[0].method == "SaveFile");
  CHECK(portal.calls[0].name == "report.pdf");
  CHECK(portal.calls[0].types == std::vector<std::string>{"application/pdf"});

  portal.uris = {"file:///home/ada/Notes"};
  std::optional<std::optional<std::string>> folder;
  dialogs->chooseFolder([&folder](std::optional<std::string> path) { folder = path; });
  ngn::testing::runUntil([&] { return folder.has_value(); });
  CHECK(*folder == "/home/ada/Notes");
  CHECK(portal.calls[1].method == "OpenFile");
  CHECK(portal.calls[1].directory);

  // A uri that is not a local file is no path.
  CHECK_FALSE(ngn::gtk::pathsOfUris({"https://example.com/a"}));
}

TEST_CASE("The clipboard is GDK's: the app's text is there at once, and another app's arrives as a change") {
  REQUIRE(ngn::testing::gtkReady());
  std::vector<int64_t> changes;
  auto system = ngn::gtk::makeSystem("ngn.clipboard.test", g_get_tmp_dir(), [&changes](int64_t count) { changes.push_back(count); });
  auto before = system->clipboardChangeCount();
  system->setClipboardText("from the app");
  CHECK(system->clipboardText() == "from the app");
  CHECK(system->clipboardChangeCount() == before + 1);
  // On the display's clipboard, for other apps.
  GdkClipboard *clipboard = gdk_display_get_clipboard(gdk_display_get_default());
  ngn::testing::runUntil([&] { return gdk_clipboard_is_local(clipboard); });
  std::optional<std::string> read;
  gdk_clipboard_read_text_async(clipboard, nullptr, +[](GObject *source, GAsyncResult *result, gpointer out) {
    gchar *text = gdk_clipboard_read_text_finish(GDK_CLIPBOARD(source), result, nullptr);
    *static_cast<std::optional<std::string> *>(out) = text ? text : "";
    g_free(text);
  }, &read);
  ngn::testing::runUntil([&] { return read.has_value(); });
  CHECK(*read == "from the app");
  // Its own copy is not announced again.
  CHECK(changes.empty());

#ifdef GDK_WINDOWING_X11
  if (!GDK_IS_X11_DISPLAY(gdk_display_get_default())) {
    MESSAGE("skipped another app's copy: not an X11 display");
    return;
  }
  // Another app: a second connection to the X server the display is on (not $DISPLAY, which a test
  // bus unsets), which owns the clipboard as it copies.
  GdkDisplay *other = gdk_display_open(gdk_display_get_name(gdk_display_get_default()));
  REQUIRE(other);
  gdk_clipboard_set_text(gdk_display_get_clipboard(other), "from another app");
  ngn::testing::runUntil([&] { return system->clipboardText() == "from another app"; });
  REQUIRE_FALSE(changes.empty());
  CHECK(changes.back() == system->clipboardChangeCount());
  CHECK(system->clipboardChangeCount() > before + 1);
  gdk_display_close(other);
#endif
}

TEST_CASE("Printing a window or an image draws it onto one page, turned for landscape") {
  REQUIRE(ngn::testing::gtkReady());
  GtkWidget *window = gtk_window_new();
  GtkWidget *label = gtk_label_new("Printed");
  gtk_window_set_child(GTK_WINDOW(window), label);
  gtk_window_set_default_size(GTK_WINDOW(window), 300, 200);
  gtk_window_present(GTK_WINDOW(window));
  ngn::testing::runUntil([&] { return gtk_widget_get_width(label) > 0; });

  auto portrait = temporaryPath("ngn-print-portrait.pdf"), landscape = temporaryPath("ngn-print-landscape.pdf"),
       image = temporaryPath("ngn-print-image.pdf");
  CHECK(ngn::gtk::exportWidget(label, false, portrait));
  CHECK(ngn::gtk::exportWidget(label, true, landscape));
  CHECK(ngn::gtk::exportImage(pngBytes(40, 20), false, image));
  for (const auto &path : {portrait, landscape, image}) {
    auto pdf = readFile(path);
    CHECK(pdf.rfind("%PDF", 0) == 0);
    CHECK(pdf.find("/Count 1") != std::string::npos);
  }
  auto [width, height] = pageSize(readFile(portrait));
  CHECK(height > width);
  auto turned = pageSize(readFile(landscape));
  CHECK(turned.first > turned.second);
  CHECK_FALSE(ngn::gtk::exportImage("not an image", false, image + ".bad"));
  for (const auto &path : {portrait, landscape, image}) {
    std::remove(path.c_str());
  }
  gtk_window_destroy(GTK_WINDOW(window));
}

TEST_CASE("A PDF prints through the Print portal, the file sent with the token PreparePrint answered") {
  REQUIRE(ngn::testing::gtkReady());
  StandInPortal portal;
  auto printing = ngn::gtk::makePrintSystem(nullptr);
  std::optional<std::string> error;
  std::string pdf = "%PDF-1.4 a stand-in document";
  printing->print({.kind = ngn::PrintSystem::Document::Kind::Pdf, .content = pdf}, false, [&error](const std::string &e) { error = e; });
  ngn::testing::runUntil([&] { return error.has_value(); });
  CHECK(*error == "");
  REQUIRE(portal.calls.size() == 2);
  CHECK(portal.calls[0].method == "PreparePrint");
  CHECK(portal.calls[1].method == "Print");
  CHECK(portal.calls[1].printToken == 7);
  CHECK(portal.calls[1].printed == pdf);

  // Cancelled in the portal's dialog: nothing is sent, and that is not an error.
  portal.response = 1;
  error.reset();
  printing->print({.kind = ngn::PrintSystem::Document::Kind::Pdf, .content = pdf}, false, [&error](const std::string &e) { error = e; });
  ngn::testing::runUntil([&] { return error.has_value(); });
  CHECK(*error == "");
  CHECK(portal.calls.size() == 3);

  // HTML has no engine to lay it out, and a surface no window shows cannot print.
  error.reset();
  printing->print({.kind = ngn::PrintSystem::Document::Kind::Html, .content = "<p>hi</p>"}, false, [&error](const std::string &e) { error = e; });
  ngn::testing::runUntil([&] { return error.has_value(); });
  CHECK(error->find("HTML") != std::string::npos);
  error.reset();
  printing->printWindow(4, false, [&error](const std::string &e) { error = e; });
  ngn::testing::runUntil([&] { return error.has_value(); });
  CHECK_FALSE(error->empty());
}
