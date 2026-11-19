#include "printing.h"

#include "app-windows.h"
#include "portal.h"

#include <gio/gunixfdlist.h>
#ifdef NGN_UNIX_PRINT
#include <gtk/gtkunixprint.h>
#endif

#include <fcntl.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <memory>

namespace ngn::gtk {

namespace {

constexpr const char *kPrintPortal = "org.freedesktop.portal.Print";

// Draws the content into a page's printable area, `width` by `height` points.
using Drawer = std::function<void(cairo_t *cr, double width, double height)>;

// What `widget` draws now, as GSK's nodes, which cairo draws as vectors into the page: scaled down
// to fit it, never up.
std::optional<Drawer> widgetDrawer(GtkWidget *widget) {
  int width = gtk_widget_get_width(widget), height = gtk_widget_get_height(widget);
  if (width <= 0 || height <= 0) {
    return std::nullopt;
  }
  GdkPaintable *paintable = gtk_widget_paintable_new(widget);
  GtkSnapshot *snapshot = gtk_snapshot_new();
  gdk_paintable_snapshot(paintable, snapshot, width, height);
  g_object_unref(paintable);
  GskRenderNode *node = gtk_snapshot_free_to_node(snapshot);
  if (!node) {
    return std::nullopt;
  }
  auto held = std::shared_ptr<GskRenderNode>(node, gsk_render_node_unref);
  return [held, width, height](cairo_t *cr, double pageWidth, double pageHeight) {
    double scale = std::min({pageWidth / width, pageHeight / height, 1.0});
    cairo_scale(cr, scale, scale);
    gsk_render_node_draw(held.get(), cr);
  };
}

// An image's pixels, scaled to fit the page either way.
std::optional<Drawer> imageDrawer(const std::string &bytes, std::string &error) {
  GBytes *data = g_bytes_new(bytes.data(), bytes.size());
  GError *problem = nullptr;
  GdkTexture *texture = gdk_texture_new_from_bytes(data, &problem);
  g_bytes_unref(data);
  if (!texture) {
    error = problem ? std::string("the image could not be read: ") + problem->message : "the image could not be read";
    g_clear_error(&problem);
    return std::nullopt;
  }
  int width = gdk_texture_get_width(texture), height = gdk_texture_get_height(texture);
  cairo_surface_t *surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, width, height);
  gdk_texture_download(texture, cairo_image_surface_get_data(surface), cairo_image_surface_get_stride(surface));
  cairo_surface_mark_dirty(surface);
  g_object_unref(texture);
  auto held = std::shared_ptr<cairo_surface_t>(surface, cairo_surface_destroy);
  return [held, width, height](cairo_t *cr, double pageWidth, double pageHeight) {
    double scale = std::min(pageWidth / width, pageHeight / height);
    cairo_scale(cr, scale, scale);
    cairo_set_source_surface(cr, held.get(), 0, 0);
    cairo_paint(cr);
  };
}

struct Operation {
  Drawer draw;
  PrintDone done;
  bool answered{false};
  void finish(const std::string &error) {
    if (!answered) {
      answered = true;
      done(error);
    }
  }
};

// One page through GtkPrintOperation: its dialog on `parent`, or written to `exportPath` with none.
// Answers once the operation is done.
void runOperation(Drawer draw, bool landscape, GtkWindow *parent, const std::string &exportPath, PrintDone done) {
  GtkPrintOperation *operation = gtk_print_operation_new();
  gtk_print_operation_set_n_pages(operation, 1);
  gtk_print_operation_set_unit(operation, GTK_UNIT_POINTS);
  gtk_print_operation_set_allow_async(operation, exportPath.empty());
  GtkPageSetup *page = gtk_page_setup_new();
  gtk_page_setup_set_orientation(page, landscape ? GTK_PAGE_ORIENTATION_LANDSCAPE : GTK_PAGE_ORIENTATION_PORTRAIT);
  gtk_print_operation_set_default_page_setup(operation, page);
  g_object_unref(page);
  auto *state = new Operation{std::move(draw), std::move(done)};
  g_signal_connect(operation, "draw-page", G_CALLBACK(+[](GtkPrintOperation *, GtkPrintContext *context, gint, gpointer data) {
    static_cast<Operation *>(data)->draw(gtk_print_context_get_cairo_context(context), gtk_print_context_get_width(context),
                                         gtk_print_context_get_height(context));
  }), state);
  g_signal_connect_data(operation, "done", G_CALLBACK(+[](GtkPrintOperation *operation, GtkPrintOperationResult result, gpointer data) {
    std::string error;
    if (result == GTK_PRINT_OPERATION_RESULT_ERROR) {
      GError *problem = nullptr;
      gtk_print_operation_get_error(operation, &problem);
      error = problem ? problem->message : "printing failed";
      g_clear_error(&problem);
    }
    static_cast<Operation *>(data)->finish(error);
  }), state, +[](gpointer data, GClosure *) { delete static_cast<Operation *>(data); }, GConnectFlags(0));
  auto action = GTK_PRINT_OPERATION_ACTION_PRINT_DIALOG;
  if (!exportPath.empty()) {
    gtk_print_operation_set_export_filename(operation, exportPath.c_str());
    action = GTK_PRINT_OPERATION_ACTION_EXPORT;
  }
  GError *error = nullptr;
  auto result = gtk_print_operation_run(operation, action, parent, &error);
  if (result == GTK_PRINT_OPERATION_RESULT_ERROR) {
    state->finish(error ? error->message : "printing failed");
  } else if (result != GTK_PRINT_OPERATION_RESULT_IN_PROGRESS) {
    state->finish("");
  }
  g_clear_error(&error);
  g_object_unref(operation);
}

GtkWindow *windowOf(GtkWidget *widget) {
  GtkRoot *root = widget ? gtk_widget_get_root(widget) : nullptr;
  return root && GTK_IS_WINDOW(root) ? GTK_WINDOW(root) : portal::frontWindow();
}

// `bytes` in a file of its own, already unlinked, open for reading: the fd the Print portal reads.
int pdfFd(const std::string &bytes) {
  gchar *path = nullptr;
  int fd = g_file_open_tmp("ngn-print-XXXXXX.pdf", &path, nullptr);
  if (fd < 0) {
    return -1;
  }
  unlink(path);
  g_free(path);
  if (write(fd, bytes.data(), bytes.size()) != static_cast<ssize_t>(bytes.size()) || lseek(fd, 0, SEEK_SET) != 0) {
    close(fd);
    return -1;
  }
  return fd;
}

#ifdef NGN_UNIX_PRINT
// A job sent to a printer, and the file it prints, removed once sent.
using SentJob = std::pair<PrintDone, std::string>;

// GTK's print dialog, where no portal answers: the PDF goes as it is to a printer that takes PDF.
void printPdfWithGtk(const std::string &bytes, bool landscape, PrintDone done) {
  GtkWidget *dialog = gtk_print_unix_dialog_new("Print", portal::frontWindow());
  gtk_print_unix_dialog_set_manual_capabilities(GTK_PRINT_UNIX_DIALOG(dialog), GTK_PRINT_CAPABILITY_GENERATE_PDF);
  GtkPageSetup *page = gtk_page_setup_new();
  gtk_page_setup_set_orientation(page, landscape ? GTK_PAGE_ORIENTATION_LANDSCAPE : GTK_PAGE_ORIENTATION_PORTRAIT);
  gtk_print_unix_dialog_set_page_setup(GTK_PRINT_UNIX_DIALOG(dialog), page);
  g_object_unref(page);
  struct Pending {
    std::string bytes;
    PrintDone done;
  };
  g_signal_connect_data(dialog, "response", G_CALLBACK(+[](GtkDialog *dialog, gint response, gpointer data) {
    auto *pending = static_cast<Pending *>(data);
    auto done = std::move(pending->done);
    if (response != GTK_RESPONSE_OK) {
      gtk_window_destroy(GTK_WINDOW(dialog));
      done("");
      return;
    }
    auto *chooser = GTK_PRINT_UNIX_DIALOG(dialog);
    GtkPrinter *printer = gtk_print_unix_dialog_get_selected_printer(chooser);
    if (!printer || !gtk_printer_accepts_pdf(printer)) {
      gtk_window_destroy(GTK_WINDOW(dialog));
      done("the chosen printer does not take PDF");
      return;
    }
    GtkPrintSettings *settings = gtk_print_unix_dialog_get_settings(chooser);
    GtkPrintJob *job = gtk_print_job_new("Print", printer, settings, gtk_print_unix_dialog_get_page_setup(chooser));
    g_object_unref(settings);
    gchar *path = nullptr;
    int fd = g_file_open_tmp("ngn-print-XXXXXX.pdf", &path, nullptr);
    bool written = fd >= 0 && write(fd, pending->bytes.data(), pending->bytes.size()) == static_cast<ssize_t>(pending->bytes.size());
    if (fd >= 0) {
      close(fd);
    }
    GError *error = nullptr;
    if (!written || !gtk_print_job_set_source_file(job, path, &error)) {
      done(error ? error->message : "the PDF could not be written for the printer");
      g_clear_error(&error);
    } else {
      auto *heap = new SentJob(std::move(done), path);
      gtk_print_job_send(job, +[](GtkPrintJob *, gpointer data, const GError *error) {
        std::unique_ptr<SentJob> sent(static_cast<SentJob *>(data));
        unlink(sent->second.c_str());
        sent->first(error ? error->message : "");
      }, heap, nullptr);
    }
    g_free(path);
    g_object_unref(job);
    gtk_window_destroy(GTK_WINDOW(dialog));
  }), new Pending{bytes, std::move(done)}, +[](gpointer data, GClosure *) { delete static_cast<Pending *>(data); }, GConnectFlags(0));
  gtk_window_present(GTK_WINDOW(dialog));
}
#endif

// PreparePrint asks the user for a printer and settings; Print then sends the file with the token
// it answered.
void printPdf(const std::string &bytes, bool landscape, PrintDone done) {
  portal::parentHandle(portal::frontWindow(), [bytes, landscape, done = std::move(done)](const std::string &parent, std::function<void()> drop) mutable {
    GVariantBuilder settings, page;
    g_variant_builder_init(&settings, G_VARIANT_TYPE_VARDICT);
    g_variant_builder_init(&page, G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&page, "{sv}", "Orientation", g_variant_new_string(landscape ? "landscape" : "portrait"));
    auto shared = std::make_shared<std::function<void()>>(std::move(drop));
    portal::request(
        kPrintPortal, "PreparePrint",
        g_variant_new("(ss@a{sv}@a{sv})", parent.c_str(), "Print", g_variant_builder_end(&settings), g_variant_builder_end(&page)),
        g_variant_builder_new(G_VARIANT_TYPE_VARDICT), nullptr,
        [bytes, landscape, parent, shared, done = std::move(done)](portal::Outcome outcome, GVariant *results) mutable {
          if (outcome == portal::Outcome::Absent) {
            (*shared)();
#ifdef NGN_UNIX_PRINT
            printPdfWithGtk(bytes, landscape, std::move(done));
#else
            done("printing a PDF needs the desktop's print portal");
#endif
            return;
          }
          guint32 token = 0;
          if (outcome != portal::Outcome::Done || !results || !g_variant_lookup(results, "token", "u", &token)) {
            (*shared)();
            done(outcome == portal::Outcome::Failed ? "the print portal could not print" : "");
            return;
          }
          int fd = pdfFd(bytes);
          if (fd < 0) {
            (*shared)();
            done("the PDF could not be written for the printer");
            return;
          }
          GUnixFDList *fds = g_unix_fd_list_new_from_array(&fd, 1);
          GVariantBuilder *options = g_variant_builder_new(G_VARIANT_TYPE_VARDICT);
          g_variant_builder_add(options, "{sv}", "token", g_variant_new_uint32(token));
          portal::request(kPrintPortal, "Print", g_variant_new("(ssh)", parent.c_str(), "Print", 0), options, fds,
                          [shared, done = std::move(done)](portal::Outcome outcome, GVariant *) {
                            (*shared)();
                            done(outcome == portal::Outcome::Failed ? "the print portal could not print" : "");
                          });
          g_object_unref(fds);
        });
  });
}

class GtkPrintSystem final : public PrintSystem {
 public:
  explicit GtkPrintSystem(std::function<GtkWidget *(facebook::react::SurfaceId)> surfaceWidget) : surfaceWidget_(std::move(surfaceWidget)) {}

  void print(Document document, bool landscape, PrintDone done) override {
    onMainContext([document = std::move(document), landscape, done = std::move(done)]() mutable {
      switch (document.kind) {
        case Document::Kind::Html:
          done("printing HTML is not available on Linux");
          return;
        case Document::Kind::Pdf:
          printPdf(document.content, landscape, std::move(done));
          return;
        case Document::Kind::Image: {
          std::string error;
          auto draw = imageDrawer(document.content, error);
          if (!draw) {
            done(error);
            return;
          }
          runOperation(std::move(*draw), landscape, portal::frontWindow(), "", std::move(done));
          return;
        }
      }
    });
  }

  void printWindow(facebook::react::SurfaceId surface, bool landscape, PrintDone done) override {
    onMainContext([this, surface, landscape, done = std::move(done)]() mutable {
      GtkWidget *widget = surfaceWidget_ ? surfaceWidget_(surface) : nullptr;
      if (!widget) {
        done("no window shows that surface");
        return;
      }
      printWidget(widget, landscape, std::move(done));
    });
  }

  void renderPdf(std::string, PageSetup, std::string, std::function<void(int, const std::string &)> done) override {
    done(0, "printing HTML to a PDF is not available on Linux");
  }

 private:
  std::function<GtkWidget *(facebook::react::SurfaceId)> surfaceWidget_;
};

} // namespace

void printWidget(GtkWidget *widget, bool landscape, PrintDone done) {
  auto draw = widgetDrawer(widget);
  if (!draw) {
    done("the window has nothing drawn yet");
    return;
  }
  runOperation(std::move(*draw), landscape, windowOf(widget), "", std::move(done));
}

bool exportWidget(GtkWidget *widget, bool landscape, const std::string &path) {
  auto draw = widgetDrawer(widget);
  std::optional<std::string> error;
  if (draw) {
    runOperation(std::move(*draw), landscape, nullptr, path, [&error](const std::string &e) { error = e; });
  }
  return error && error->empty();
}

bool exportImage(const std::string &bytes, bool landscape, const std::string &path) {
  std::string problem;
  auto draw = imageDrawer(bytes, problem);
  std::optional<std::string> error;
  if (draw) {
    runOperation(std::move(*draw), landscape, nullptr, path, [&error](const std::string &e) { error = e; });
  }
  return error && error->empty();
}

std::shared_ptr<PrintSystem> makePrintSystem(std::function<GtkWidget *(facebook::react::SurfaceId)> surfaceWidget) {
  return std::make_shared<GtkPrintSystem>(std::move(surfaceWidget));
}

} // namespace ngn::gtk
