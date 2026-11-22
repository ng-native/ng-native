#include "alerts.h"

#include "screens.h"

#include <adwaita.h>

#include <memory>
#include <vector>

namespace ngn::gtk {

namespace {

// What an alert answers with, freed with its dialog.
struct Pending {
  std::function<void(int, std::string, std::string)> done;
  int escape{-1};
  GtkWidget *field{nullptr};
  GtkWidget *password{nullptr};
  bool answered{false};
};

GtkWidget *gLast = nullptr;

// libadwaita 1.5's AdwAlertDialog, whose functions take the same arguments as AdwMessageDialog's.
struct AlertDialogApi {
  GtkWidget *(*make)(const char *, const char *);
  void (*addResponse)(GtkWidget *, const char *, const char *);
  void (*setAppearance)(GtkWidget *, const char *, AdwResponseAppearance);
  void (*setDefault)(GtkWidget *, const char *);
  void (*setClose)(GtkWidget *, const char *);
  void (*setExtra)(GtkWidget *, GtkWidget *);
  void (*present)(GtkWidget *, GtkWidget *);
  void (*close)(GtkWidget *);
  bool available() const {
    return make && addResponse && setAppearance && setDefault && setClose && setExtra && present && close;
  }
};

const AlertDialogApi &alertDialogApi() {
  static AlertDialogApi api{
      adwFunction<GtkWidget *(*)(const char *, const char *)>("adw_alert_dialog_new"),
      adwFunction<void (*)(GtkWidget *, const char *, const char *)>("adw_alert_dialog_add_response"),
      adwFunction<void (*)(GtkWidget *, const char *, AdwResponseAppearance)>("adw_alert_dialog_set_response_appearance"),
      adwFunction<void (*)(GtkWidget *, const char *)>("adw_alert_dialog_set_default_response"),
      adwFunction<void (*)(GtkWidget *, const char *)>("adw_alert_dialog_set_close_response"),
      adwFunction<void (*)(GtkWidget *, GtkWidget *)>("adw_alert_dialog_set_extra_child"),
      adwFunction<void (*)(GtkWidget *, GtkWidget *)>("adw_dialog_present"),
      adwFunction<void (*)(GtkWidget *)>("adw_dialog_force_close"),
  };
  return api;
}

// The prompt's fields: a text or password entry, or a login above a password.
GtkWidget *fieldsFor(const AlertRequest &request, Pending &pending) {
  auto entry = [&](bool secure, const char *placeholder) {
    GtkWidget *e = secure ? gtk_password_entry_new() : gtk_entry_new();
    g_object_set(e, "activates-default", TRUE, nullptr);
    if (placeholder) {
      g_object_set(e, "placeholder-text", placeholder, nullptr);
    }
    return e;
  };
  switch (request.input) {
    case AlertInput::None:
      return nullptr;
    case AlertInput::PlainText:
    case AlertInput::SecureText:
      pending.field = entry(request.input == AlertInput::SecureText, nullptr);
      gtk_editable_set_text(GTK_EDITABLE(pending.field), request.defaultValue.c_str());
      return pending.field;
    case AlertInput::LoginPassword: {
      GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 6);
      pending.field = entry(false, "Login");
      gtk_editable_set_text(GTK_EDITABLE(pending.field), request.defaultValue.c_str());
      pending.password = entry(true, "Password");
      gtk_box_append(GTK_BOX(box), pending.field);
      gtk_box_append(GTK_BOX(box), pending.password);
      return box;
    }
  }
  return nullptr;
}

void responseButtons(GtkWidget *root, GtkWidget *skip, std::vector<GtkWidget *> &out) {
  for (GtkWidget *child = gtk_widget_get_first_child(root); child; child = gtk_widget_get_next_sibling(child)) {
    if (child == skip) {
      continue;
    }
    if (GTK_IS_BUTTON(child)) {
      out.push_back(child);
    } else {
      responseButtons(child, skip, out);
    }
  }
}

// More than three buttons stack, one above another, as libadwaita stacks them when they do not fit
// side by side: each asks for a width that four never fit in, even in a wide dialog. The responses
// are the dialog's buttons outside `extra`; with any other count found, libadwaita's own layout
// stands.
void stackResponses(GtkWidget *dialog, GtkWidget *extra, size_t count) {
  constexpr int kStackedWidth = 200;
  std::vector<GtkWidget *> buttons;
  responseButtons(dialog, extra, buttons);
  if (count <= 3 || buttons.size() != count) {
    return;
  }
  for (GtkWidget *button : buttons) {
    gtk_widget_set_size_request(button, kStackedWidth, -1);
  }
}

std::string textOf(GtkWidget *field) {
  return field ? gtk_editable_get_text(GTK_EDITABLE(field)) : "";
}

void answer(GtkWidget *dialog, const char *response) {
  auto *pending = static_cast<Pending *>(g_object_get_data(G_OBJECT(dialog), "ngn-alert"));
  if (!pending || pending->answered) {
    return;
  }
  pending->answered = true;
  std::string id = response ? response : "";
  int index = id.size() > 1 && id[0] == 'b' ? std::stoi(id.substr(1)) : pending->escape;
  pending->done(index, textOf(pending->field), textOf(pending->password));
}

// An alert that refuses Escape (`can-close` false, with no cancel button) refuses its own buttons'
// close too: libadwaita's AdwAlertDialog closes before it responds, and that close keeps the
// property. Once a button has answered, it is closed by force, as a pressed button closes it.
void closeRefused(GtkWidget *dialog) {
  if (!g_object_class_find_property(G_OBJECT_GET_CLASS(dialog), "can-close")) {
    return;
  }
  gboolean canClose = TRUE;
  g_object_get(dialog, "can-close", &canClose, nullptr);
  if (!canClose) {
    if (const auto &api = alertDialogApi(); api.close) {
      api.close(dialog);
    }
  }
}

} // namespace

GtkWindow *activeWindow() {
  GListModel *windows = gtk_window_get_toplevels();
  GtkWindow *visible = nullptr;
  for (guint i = 0; i < g_list_model_get_n_items(windows); i++) {
    auto *window = GTK_WINDOW(g_list_model_get_item(windows, i));
    g_object_unref(window);
    if (!gtk_widget_get_visible(GTK_WIDGET(window)) || g_object_get_data(G_OBJECT(window), "ngn-alert")) {
      continue;
    }
    if (gtk_window_is_active(window)) {
      return window;
    }
    visible = visible ? visible : window;
  }
  // No window manager says which is active (a headless session): the first one shown.
  return visible;
}

void showAlert(const AlertRequest &request, std::function<void(int, std::string, std::string)> done, GtkWindow *parent) {
  auto layout = gnomeAlertLayout(request);
  auto *pending = new Pending{.done = std::move(done), .escape = layout.escapeIndex};
  GtkWidget *extra = fieldsFor(request, *pending);
  const auto &api = alertDialogApi();
  bool inWindow = parent && api.available();
  GtkWidget *dialog = inWindow
      ? api.make(request.title.c_str(), request.message.c_str())
      : adw_message_dialog_new(parent, request.title.c_str(), request.message.c_str());
  auto addResponse = inWindow ? api.addResponse : [](GtkWidget *d, const char *id, const char *label) {
    adw_message_dialog_add_response(ADW_MESSAGE_DIALOG(d), id, label);
  };
  auto setAppearance = inWindow ? api.setAppearance : [](GtkWidget *d, const char *id, AdwResponseAppearance a) {
    adw_message_dialog_set_response_appearance(ADW_MESSAGE_DIALOG(d), id, a);
  };
  for (int index : layout.order) {
    std::string id = "b" + std::to_string(index);
    addResponse(dialog, id.c_str(), request.buttons[static_cast<size_t>(index)].label.c_str());
    if (request.buttons[static_cast<size_t>(index)].role == AlertButtonRole::Destructive) {
      setAppearance(dialog, id.c_str(), ADW_RESPONSE_DESTRUCTIVE);
    } else if (index == layout.returnIndex) {
      setAppearance(dialog, id.c_str(), ADW_RESPONSE_SUGGESTED);
    }
  }
  std::string returnId = layout.returnIndex >= 0 ? "b" + std::to_string(layout.returnIndex) : "";
  // Escape answers the cancel button, or "close", which answers with no button.
  std::string escapeId = layout.escapeIndex >= 0 ? "b" + std::to_string(layout.escapeIndex) : "close";
  if (inWindow) {
    api.setDefault(dialog, returnId.empty() ? nullptr : returnId.c_str());
    api.setClose(dialog, escapeId.c_str());
    // With no cancel button Escape presses nothing, as on macOS: closed with no answer, the app's
    // Alert callback would never run, and a Dialogs promise never settle.
    if (layout.escapeIndex < 0) {
      g_object_set(dialog, "can-close", FALSE, nullptr);
    }
    if (extra) {
      api.setExtra(dialog, extra);
    }
  } else {
    adw_message_dialog_set_default_response(ADW_MESSAGE_DIALOG(dialog), returnId.empty() ? nullptr : returnId.c_str());
    adw_message_dialog_set_close_response(ADW_MESSAGE_DIALOG(dialog), escapeId.c_str());
    if (extra) {
      adw_message_dialog_set_extra_child(ADW_MESSAGE_DIALOG(dialog), extra);
    }
    gtk_window_set_modal(GTK_WINDOW(dialog), TRUE);
  }
  g_object_set_data_full(G_OBJECT(dialog), "ngn-alert", pending, [](gpointer p) { delete static_cast<Pending *>(p); });
  g_signal_connect(dialog, "response", G_CALLBACK(+[](GtkWidget *d, const char *response, gpointer) {
    answer(d, response);
    closeRefused(d);
  }), nullptr);
  // The answer arrives however it goes, even closed with no response. Over a window, after the
  // closing call returns: libadwaita's AdwAlertDialog closes before it emits a clicked button's
  // response, and with no close animation (animations off, as with reduced motion) "closed" comes
  // first, so answering at once would answer the cancel button for a click on any other.
  if (inWindow) {
    g_signal_connect(dialog, "closed", G_CALLBACK(+[](GtkWidget *d, gpointer) {
      if (gLast == d) {
        gLast = nullptr;
      }
      g_idle_add_full(G_PRIORITY_HIGH, +[](gpointer data) -> gboolean {
        answer(GTK_WIDGET(data), "close");
        return G_SOURCE_REMOVE;
      }, g_object_ref(d), g_object_unref);
    }), nullptr);
  } else {
    // A message dialog responds before it goes, and lets go of its fields, which the answer
    // reads, once it is destroyed: it is answered as it is.
    g_signal_connect(dialog, "destroy", G_CALLBACK(+[](GtkWidget *d, gpointer) {
      if (gLast == d) {
        gLast = nullptr;
      }
      answer(d, "close");
    }), nullptr);
  }
  gLast = dialog;
  if (inWindow) {
    api.present(dialog, GTK_WIDGET(parent));
  } else {
    gtk_window_present(GTK_WINDOW(dialog));
  }
  // After presenting: an AdwDialog keeps its content unparented until then (libadwaita 1.5), so its
  // buttons are not reachable from the dialog before.
  stackResponses(dialog, extra, layout.order.size());
  if (pending->field) {
    gtk_widget_grab_focus(pending->field);
  }
}

GtkWidget *shownAlert() {
  return gLast;
}

void respondToAlert(GtkWidget *alert, const char *response) {
  g_signal_emit_by_name(alert, "response", response);
  if (ADW_IS_MESSAGE_DIALOG(alert)) {
    gtk_window_destroy(GTK_WINDOW(alert));
  } else if (const auto &api = alertDialogApi(); api.close) {
    api.close(alert);
  }
}

} // namespace ngn::gtk
