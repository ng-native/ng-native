#include "file-dialogs.h"

#include "app-windows.h"
#include "portal.h"

#include <gtk/gtk.h>

#include <cstdio>

namespace ngn::gtk {

namespace {

constexpr const char *kFileChooser = "org.freedesktop.portal.FileChooser";

using Paths = std::function<void(std::optional<std::vector<std::string>>)>;
using Path = std::function<void(std::optional<std::string>)>;

std::string joined(const std::vector<std::string> &types) {
  std::string out;
  for (const auto &type : types) {
    out += (out.empty() ? "" : ", ") + type;
  }
  return out;
}

// One filter of every type, as the portal takes it: (name, [(1, mime type)]), named `name` or the
// types listed.
GVariant *portalFilter(const std::vector<std::string> &types, const std::string &name) {
  GVariantBuilder patterns;
  g_variant_builder_init(&patterns, G_VARIANT_TYPE("a(us)"));
  for (const auto &type : types) {
    g_variant_builder_add(&patterns, "(us)", 1u, type.c_str());
  }
  return g_variant_new("(s@a(us))", (name.empty() ? joined(types) : name).c_str(), g_variant_builder_end(&patterns));
}

void addFilter(GVariantBuilder *options, const std::vector<std::string> &types, const std::string &name = "") {
  if (types.empty()) {
    return;
  }
  GVariant *filter = g_variant_ref_sink(portalFilter(types, name));
  GVariantBuilder filters;
  g_variant_builder_init(&filters, G_VARIANT_TYPE("a(sa(us))"));
  g_variant_builder_add_value(&filters, filter);
  g_variant_builder_add(options, "{sv}", "filters", g_variant_builder_end(&filters));
  g_variant_builder_add(options, "{sv}", "current_filter", filter);
  g_variant_unref(filter);
}

std::vector<std::string> urisOf(GVariant *results) {
  std::vector<std::string> out;
  GVariant *uris = results ? g_variant_lookup_value(results, "uris", G_VARIANT_TYPE_STRING_ARRAY) : nullptr;
  if (!uris) {
    return out;
  }
  gsize count = 0;
  const gchar **each = g_variant_get_strv(uris, &count);
  for (gsize i = 0; i < count; ++i) {
    out.emplace_back(each[i]);
  }
  g_free(each);
  g_variant_unref(uris);
  return out;
}

// Asks the FileChooser portal, against the front window: `fallBack` runs when no portal answers.
void askPortal(const char *method, std::string title, GVariantBuilder *options, Paths done, std::function<void(Paths)> fallBack) {
  portal::parentHandle(portal::frontWindow(), [method, title = std::move(title), options, done = std::move(done), fallBack = std::move(fallBack)](
                                                  const std::string &parent, std::function<void()> drop) mutable {
    portal::request(kFileChooser, method, g_variant_new("(ss)", parent.c_str(), title.c_str()), options, nullptr,
                    [done = std::move(done), fallBack = std::move(fallBack), drop = std::move(drop)](portal::Outcome outcome, GVariant *results) mutable {
                      drop();
                      if (outcome == portal::Outcome::Absent) {
                        fallBack(std::move(done));
                      } else if (outcome == portal::Outcome::Done) {
                        done(pathsOfUris(urisOf(results)));
                      } else {
                        done(std::nullopt);
                      }
                    });
  });
}

// GTK's own dialog, where no portal answers.
GtkFileDialog *gtkDialog(const char *title, const std::vector<std::string> &types, const std::string &name = "") {
  GtkFileDialog *dialog = gtk_file_dialog_new();
  gtk_file_dialog_set_title(dialog, title);
  gtk_file_dialog_set_modal(dialog, TRUE);
  if (!types.empty()) {
    GtkFileFilter *filter = gtk_file_filter_new();
    gtk_file_filter_set_name(filter, (name.empty() ? joined(types) : name).c_str());
    for (const auto &type : types) {
      gtk_file_filter_add_mime_type(filter, type.c_str());
    }
    GListStore *filters = g_list_store_new(GTK_TYPE_FILE_FILTER);
    g_list_store_append(filters, filter);
    gtk_file_dialog_set_filters(dialog, G_LIST_MODEL(filters));
    gtk_file_dialog_set_default_filter(dialog, filter);
    g_object_unref(filters);
    g_object_unref(filter);
  }
  return dialog;
}

std::optional<std::string> pathOf(GFile *file) {
  if (!file) {
    return std::nullopt;
  }
  gchar *path = g_file_get_path(file);
  g_object_unref(file);
  if (!path) {
    return std::nullopt;
  }
  std::string out = path;
  g_free(path);
  return out;
}

// A dialog's finish, given its result: the files, or nothing when the user dismissed it.
using Finish = std::function<std::optional<std::vector<std::string>>(GtkFileDialog *, GAsyncResult *, GError **)>;

void finished(GObject *source, GAsyncResult *result, gpointer data) {
  auto *pair = static_cast<std::pair<Finish, Paths> *>(data);
  GError *error = nullptr;
  auto paths = pair->first(GTK_FILE_DIALOG(source), result, &error);
  if (error) {
    if (!g_error_matches(error, GTK_DIALOG_ERROR, GTK_DIALOG_ERROR_DISMISSED)) {
      fprintf(stderr, "[ngn] file dialog: %s\n", error->message);
    }
    g_error_free(error);
  }
  pair->second(paths);
  g_object_unref(source);
  delete pair;
}

gpointer later(Finish finish, Paths done) {
  return new std::pair<Finish, Paths>(std::move(finish), std::move(done));
}

class PortalFileDialogs final : public FileDialogs {
 public:
  void openFiles(const OpenRequest &request, Paths done) override {
    onMainContext([request, done = std::move(done)]() mutable {
      GVariantBuilder *options = g_variant_builder_new(G_VARIANT_TYPE_VARDICT);
      g_variant_builder_add(options, "{sv}", "modal", g_variant_new_boolean(TRUE));
      g_variant_builder_add(options, "{sv}", "multiple", g_variant_new_boolean(request.multiple));
      addFilter(options, request.types, request.filterName);
      std::string title = !request.title.empty() ? request.title : request.multiple ? "Open Files" : "Open File";
      askPortal("OpenFile", title, options, std::move(done), [request, title](Paths done) {
        GtkFileDialog *dialog = gtkDialog(title.c_str(), request.types, request.filterName);
        if (request.multiple) {
          gtk_file_dialog_open_multiple(dialog, portal::frontWindow(), nullptr, finished, later([](GtkFileDialog *d, GAsyncResult *r, GError **e) {
            std::optional<std::vector<std::string>> out;
            if (GListModel *files = gtk_file_dialog_open_multiple_finish(d, r, e)) {
              out.emplace();
              for (guint i = 0, n = g_list_model_get_n_items(files); i < n; ++i) {
                if (auto path = pathOf(G_FILE(g_list_model_get_item(files, i)))) {
                  out->push_back(*path);
                }
              }
              g_object_unref(files);
            }
            return out;
          }, std::move(done)));
        } else {
          gtk_file_dialog_open(dialog, portal::frontWindow(), nullptr, finished, later([](GtkFileDialog *d, GAsyncResult *r, GError **e) {
            auto path = pathOf(gtk_file_dialog_open_finish(d, r, e));
            return path ? std::optional<std::vector<std::string>>({*path}) : std::nullopt;
          }, std::move(done)));
        }
      });
    });
  }

  void saveFile(const SaveRequest &request, Path done) override {
    onMainContext([request, done = std::move(done)]() mutable {
      GVariantBuilder *options = g_variant_builder_new(G_VARIANT_TYPE_VARDICT);
      g_variant_builder_add(options, "{sv}", "modal", g_variant_new_boolean(TRUE));
      if (!request.suggestedName.empty()) {
        g_variant_builder_add(options, "{sv}", "current_name", g_variant_new_string(request.suggestedName.c_str()));
      }
      addFilter(options, request.types);
      askPortal("SaveFile", "Save File", options, first(std::move(done)), [request](Paths done) {
        GtkFileDialog *dialog = gtkDialog("Save File", request.types);
        if (!request.suggestedName.empty()) {
          gtk_file_dialog_set_initial_name(dialog, request.suggestedName.c_str());
        }
        gtk_file_dialog_save(dialog, portal::frontWindow(), nullptr, finished, later([](GtkFileDialog *d, GAsyncResult *r, GError **e) {
          auto path = pathOf(gtk_file_dialog_save_finish(d, r, e));
          return path ? std::optional<std::vector<std::string>>({*path}) : std::nullopt;
        }, std::move(done)));
      });
    });
  }

  void chooseFolder(Path done) override {
    onMainContext([done = std::move(done)]() mutable {
      GVariantBuilder *options = g_variant_builder_new(G_VARIANT_TYPE_VARDICT);
      g_variant_builder_add(options, "{sv}", "modal", g_variant_new_boolean(TRUE));
      g_variant_builder_add(options, "{sv}", "directory", g_variant_new_boolean(TRUE));
      askPortal("OpenFile", "Choose Folder", options, first(std::move(done)), [](Paths done) {
        GtkFileDialog *dialog = gtkDialog("Choose Folder", {});
        gtk_file_dialog_select_folder(dialog, portal::frontWindow(), nullptr, finished, later([](GtkFileDialog *d, GAsyncResult *r, GError **e) {
          auto path = pathOf(gtk_file_dialog_select_folder_finish(d, r, e));
          return path ? std::optional<std::vector<std::string>>({*path}) : std::nullopt;
        }, std::move(done)));
      });
    });
  }

 private:
  // A one-path answer from a list of them.
  static Paths first(Path done) {
    return [done = std::move(done)](std::optional<std::vector<std::string>> paths) {
      done(paths && !paths->empty() ? std::optional<std::string>(paths->front()) : std::nullopt);
    };
  }
};

} // namespace

std::optional<std::vector<std::string>> pathsOfUris(const std::vector<std::string> &uris) {
  std::vector<std::string> out;
  for (const auto &uri : uris) {
    if (gchar *path = g_filename_from_uri(uri.c_str(), nullptr, nullptr)) {
      out.emplace_back(path);
      g_free(path);
    }
  }
  return out.empty() ? std::nullopt : std::optional<std::vector<std::string>>(std::move(out));
}

std::shared_ptr<FileDialogs> makeFileDialogs() {
  return std::make_shared<PortalFileDialogs>();
}

} // namespace ngn::gtk
