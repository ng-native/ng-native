// Alerts on GTK (alerts.h): an AdwAlertDialog in the window on libadwaita 1.5 and later, else, or
// with no window, an AdwMessageDialog; GNOME's button order and keys; the prompt's fields; and an
// answer however the alert goes.
#include "mounted-views.h"

#include "../alerts.h"
#include "../screens.h"

#include <adwaita.h>
#include <doctest/doctest.h>

#include <optional>
#include <string>
#include <tuple>

namespace {

using Answer = std::tuple<int, std::string, std::string>;

ngn::AlertRequest saveRequest() {
  ngn::AlertRequest request;
  request.title = "Save changes?";
  request.message = "They are lost otherwise.";
  request.buttons = {{"Save"}, {"Don't Save", ngn::AlertButtonRole::Destructive}, {"Cancel", ngn::AlertButtonRole::Cancel}};
  request.cancelIndex = 2;
  return request;
}

} // namespace

TEST_CASE("an alert with no window is a message dialog of its own, Cancel on Escape and Save on Return") {
  REQUIRE(ngn::testing::gtkReady());
  std::optional<Answer> answer;
  ngn::gtk::showAlert(saveRequest(), [&](int i, std::string t, std::string p) { answer = Answer{i, t, p}; }, nullptr);
  GtkWidget *alert = ngn::gtk::shownAlert();
  REQUIRE(alert);
  REQUIRE(ADW_IS_MESSAGE_DIALOG(alert));
  auto *dialog = ADW_MESSAGE_DIALOG(alert);
  CHECK(std::string(adw_message_dialog_get_heading(dialog)) == "Save changes?");
  CHECK(std::string(adw_message_dialog_get_default_response(dialog)) == "b0");
  CHECK(std::string(adw_message_dialog_get_close_response(dialog)) == "b2");
  CHECK(adw_message_dialog_get_response_appearance(dialog, "b1") == ADW_RESPONSE_DESTRUCTIVE);
  CHECK(adw_message_dialog_get_response_appearance(dialog, "b0") == ADW_RESPONSE_SUGGESTED);
  CHECK_FALSE(answer);
  ngn::gtk::respondToAlert(alert, "b1");
  REQUIRE(answer);
  CHECK(std::get<0>(*answer) == 1);
  CHECK(ngn::gtk::shownAlert() == nullptr);
}

TEST_CASE("a prompt's fields reach the answer, and an alert closed with no response answers its cancel") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::AlertRequest request = saveRequest();
  request.input = ngn::AlertInput::LoginPassword;
  request.defaultValue = "ashley";
  std::optional<Answer> answer;
  ngn::gtk::showAlert(request, [&](int i, std::string t, std::string p) { answer = Answer{i, t, p}; }, nullptr);
  GtkWidget *alert = ngn::gtk::shownAlert();
  REQUIRE(alert);
  GtkWidget *extra = adw_message_dialog_get_extra_child(ADW_MESSAGE_DIALOG(alert));
  REQUIRE(extra);
  GtkWidget *login = gtk_widget_get_first_child(extra);
  GtkWidget *password = gtk_widget_get_next_sibling(login);
  CHECK(std::string(gtk_editable_get_text(GTK_EDITABLE(login))) == "ashley");
  gtk_editable_set_text(GTK_EDITABLE(password), "secret");
  ngn::gtk::respondToAlert(alert, "b0");
  REQUIRE(answer);
  CHECK(*answer == Answer{0, "ashley", "secret"});

  // Gone with no response at all: the cancel button's answer, once.
  answer.reset();
  ngn::gtk::showAlert(saveRequest(), [&](int i, std::string t, std::string p) { answer = Answer{i, t, p}; }, nullptr);
  gtk_window_destroy(GTK_WINDOW(ngn::gtk::shownAlert()));
  REQUIRE(answer);
  CHECK(std::get<0>(*answer) == 2);
}

TEST_CASE("an alert over a window is an AdwAlertDialog in it on libadwaita 1.5, else a dialog over it") {
  REQUIRE(ngn::testing::gtkReady());
  ngn::testing::MountedViews views(true, 400, 300);
  // The window is the one an alert goes over, a dialog showing already not counting.
  CHECK(ngn::gtk::activeWindow() == GTK_WINDOW(views.window));
  std::optional<Answer> answer;
  ngn::gtk::showAlert(saveRequest(), [&](int i, std::string t, std::string p) { answer = Answer{i, t, p}; }, GTK_WINDOW(views.window));
  GtkWidget *alert = ngn::gtk::shownAlert();
  REQUIRE(alert);
  if (ngn::gtk::haveAdwDialog()) {
    CHECK(std::string(G_OBJECT_TYPE_NAME(alert)) == "AdwAlertDialog");
    CHECK(gtk_widget_get_root(alert) == GTK_ROOT(views.window));
  } else {
    REQUIRE(ADW_IS_MESSAGE_DIALOG(alert));
    CHECK(gtk_window_get_transient_for(GTK_WINDOW(alert)) == GTK_WINDOW(views.window));
    CHECK(ngn::gtk::activeWindow() == GTK_WINDOW(views.window));
  }
  ngn::gtk::respondToAlert(alert, "b2");
  REQUIRE(answer);
  CHECK(std::get<0>(*answer) == 2);
}
