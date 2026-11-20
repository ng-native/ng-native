#include "auth-session.h"

#include "app-windows.h"
#include "portal.h"
#include "system-access.h"

#include <adwaita.h>

#include <utility>

namespace ngn::gtk {

namespace {

// The dialog while it is up (a weak pointer: null once it is gone, however it went), and whether
// the session took it away or the user answered it.
struct Prompt {
  GtkWidget *dialog{nullptr};
  bool done{false};
  std::function<void()> cancelled;
};

// AdwMessageDialog: libadwaita 1.4's, deprecated from 1.6, where AdwAlertDialog replaces it.
G_GNUC_BEGIN_IGNORE_DEPRECATIONS
void showPrompt(const std::shared_ptr<Prompt> &prompt) {
  if (prompt->done) {
    return;
  }
  GtkWidget *dialog = adw_message_dialog_new(portal::frontWindow(), "Continue in Your Browser",
                                             "Finish signing in in your browser. It brings you back here when you are done.");
  adw_message_dialog_add_response(ADW_MESSAGE_DIALOG(dialog), "cancel", "Cancel");
  adw_message_dialog_set_close_response(ADW_MESSAGE_DIALOG(dialog), "cancel");
  g_signal_connect_data(
      dialog, "response", G_CALLBACK(+[](AdwMessageDialog *, const char *, gpointer data) {
        auto prompt = *static_cast<std::shared_ptr<Prompt> *>(data);
        // Ending the session takes the dialog away, if its button has not closed it already.
        if (!prompt->done) {
          prompt->done = true;
          prompt->cancelled();
        }
      }),
      new std::shared_ptr<Prompt>(prompt), +[](gpointer data, GClosure *) { delete static_cast<std::shared_ptr<Prompt> *>(data); },
      GConnectFlags(0));
  prompt->dialog = dialog;
  // The closure holds the prompt as long as the dialog lives, so the pointer's place outlives it.
  g_object_add_weak_pointer(G_OBJECT(dialog), reinterpret_cast<gpointer *>(&prompt->dialog));
  gtk_window_present(GTK_WINDOW(dialog));
}
G_GNUC_END_IGNORE_DEPRECATIONS

} // namespace

std::shared_ptr<LinkAuthSession> makeAuthSession() {
  return std::make_shared<LinkAuthSession>(LinkAuthSession::Hooks{
      .openUrl = [](const std::string &url, std::function<void(bool)> opened) { openUri(url, std::move(opened)); },
      .prompt =
          [](std::function<void()> cancelled) {
            auto prompt = std::make_shared<Prompt>();
            prompt->cancelled = std::move(cancelled);
            onMainContext([prompt] { showPrompt(prompt); });
            return std::function<void()>([prompt] {
              onMainContext([prompt] {
                prompt->done = true;
                if (GtkWidget *dialog = std::exchange(prompt->dialog, nullptr)) {
                  g_object_remove_weak_pointer(G_OBJECT(dialog), reinterpret_cast<gpointer *>(&prompt->dialog));
                  gtk_window_destroy(GTK_WINDOW(dialog));
                }
              });
            });
          }});
}

} // namespace ngn::gtk
