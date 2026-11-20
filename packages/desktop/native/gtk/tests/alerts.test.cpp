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
#include <vector>

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
    // In the window, or, in a plain GtkWindow (this test's), a window of its own over it.
    GtkRoot *root = gtk_widget_get_root(alert);
    CHECK((root == GTK_ROOT(views.window) || gtk_window_get_transient_for(GTK_WINDOW(root)) == GTK_WINDOW(views.window)));
  } else {
    REQUIRE(ADW_IS_MESSAGE_DIALOG(alert));
    CHECK(gtk_window_get_transient_for(GTK_WINDOW(alert)) == GTK_WINDOW(views.window));
    CHECK(ngn::gtk::activeWindow() == GTK_WINDOW(views.window));
  }
  ngn::gtk::respondToAlert(alert, "b2");
  REQUIRE(answer);
  CHECK(std::get<0>(*answer) == 2);
}

namespace {

void buttonsIn(GtkWidget *root, std::vector<GtkWidget *> &out) {
  for (GtkWidget *child = gtk_widget_get_first_child(root); child; child = gtk_widget_get_next_sibling(child)) {
    if (GTK_IS_BUTTON(child)) {
      out.push_back(child);
    } else {
      buttonsIn(child, out);
    }
  }
}

// Whether the alert's buttons, laid out, sit one above another rather than side by side.
bool stacked(GtkWidget *alert, size_t count) {
  std::vector<GtkWidget *> buttons;
  buttonsIn(alert, buttons);
  REQUIRE(buttons.size() == count);
  ngn::testing::runUntil([&] { return gtk_widget_get_mapped(buttons[0]) && gtk_widget_get_width(buttons[0]) > 0; });
  // Two more frames, for a layout that changes its mind once it knows its width.
  for (int i = 0; i < 20; i++) {
    g_main_context_iteration(nullptr, FALSE);
    g_usleep(5000);
  }
  graphene_rect_t first, second;
  REQUIRE(gtk_widget_compute_bounds(buttons[0], alert, &first));
  REQUIRE(gtk_widget_compute_bounds(buttons[1], alert, &second));
  return first.origin.x == doctest::Approx(second.origin.x) && first.origin.y != doctest::Approx(second.origin.y);
}

ngn::AlertRequest choice(int count) {
  ngn::AlertRequest request;
  request.title = "Pick one";
  for (int i = 0; i < count; i++) {
    request.buttons.push_back({std::string(1, static_cast<char>('A' + i))});
  }
  return request;
}

} // namespace

// libadwaita 1.6 narrowed its dialog to 300sp and gave each response button a 100px minimum, so a
// dialog of three never fits in one row there and libadwaita stacks them itself; older ones keep
// three in one row up to 550px. Two fit in one row on both.
TEST_CASE("a choice of more than three buttons stacks them, and two sit side by side, and three where libadwaita fits them") {
  REQUIRE(ngn::testing::gtkReady());
  // The host starts libadwaita before it shows a dialog, which loads its stylesheet; a test that
  // runs first would otherwise measure the buttons without it.
  adw_init();
  bool threeFit = adw_get_major_version() == 1 && adw_get_minor_version() < 6;
  for (int count : {2, 3, 4, 5}) {
    CAPTURE(count);
    CAPTURE(adw_get_minor_version());
    std::optional<Answer> answer;
    ngn::gtk::showAlert(choice(count), [&](int i, std::string t, std::string p) { answer = Answer{i, t, p}; }, nullptr);
    GtkWidget *alert = ngn::gtk::shownAlert();
    REQUIRE(alert);
    bool sideBySide = count == 2 || (count == 3 && threeFit);
    bool forced = count > 3;
    if (sideBySide || forced) {
      CHECK(stacked(alert, static_cast<size_t>(count)) == forced);
    } else {
      // Three on libadwaita 1.6 and later: the host leaves it to libadwaita, which stacks them.
      CHECK(stacked(alert, static_cast<size_t>(count)));
    }
    ngn::gtk::respondToAlert(alert, "b1");
    REQUIRE(answer);
    CHECK(std::get<0>(*answer) == 1);
  }
}

// With a window, the dialog is an AdwAlertDialog on libadwaita 1.5 and later, whose buttons are
// reachable only once it is presented.
TEST_CASE("a choice of four buttons over a window stacks them") {
  REQUIRE(ngn::testing::gtkReady());
  adw_init();
  ngn::testing::MountedViews views(true, 400, 480);
  std::optional<Answer> answer;
  ngn::gtk::showAlert(choice(4), [&](int i, std::string t, std::string p) { answer = Answer{i, t, p}; }, GTK_WINDOW(views.window));
  GtkWidget *alert = ngn::gtk::shownAlert();
  REQUIRE(alert);
  CHECK(stacked(alert, 4));
  ngn::gtk::respondToAlert(alert, "b1");
  REQUIRE(answer);
}

// Libadwaita 1.6 and later mark an AdwDialog in a window under 360px tall as short, and set an
// AdwAlertDialog's buttons in one row there on purpose, so they keep their height; older ones, and
// AdwMessageDialog, stack them there too.
TEST_CASE("a choice of four buttons over a short window sits in a row from libadwaita 1.6") {
  REQUIRE(ngn::testing::gtkReady());
  adw_init();
  ngn::testing::MountedViews views(true, 600, 300);
  std::optional<Answer> answer;
  ngn::gtk::showAlert(choice(4), [&](int i, std::string t, std::string p) { answer = Answer{i, t, p}; }, GTK_WINDOW(views.window));
  GtkWidget *alert = ngn::gtk::shownAlert();
  REQUIRE(alert);
  CAPTURE(adw_get_minor_version());
  CHECK(stacked(alert, 4) == !(ngn::gtk::haveAdwDialog() && adw_get_minor_version() >= 6));
  ngn::gtk::respondToAlert(alert, "b1");
  REQUIRE(answer);
}
