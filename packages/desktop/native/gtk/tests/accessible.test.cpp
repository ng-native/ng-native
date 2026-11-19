// A view's accessibility through GTK's own: the role GTK makes its widget with, and the label,
// description, level and states it updates as the props change. GTK fixes a role for good, so a
// view whose role changes gets a new widget.
#include "mounted-views.h"

#include "../focus.h"

#include "../accessible.h"
#include "../text-field.h"

#include <doctest/doctest.h>

#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::desktopViewProps;
using ngn::testing::MountedViews;
using ngn::testing::reddish;
using ngn::testing::textInputProps;

namespace {

GtkAccessibleRole roleOf(GtkWidget *widget) {
  return gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(widget));
}

// A Paragraph's state, showing `text`.
State::Shared paragraphState(const std::string &text) {
  ParagraphState data;
  TextAttributes attributes;
  attributes.fontSize = 14;
  data.attributedString.appendFragment({.string = text, .textAttributes = attributes, .parentShadowView = {}});
  return std::make_shared<ConcreteState<ParagraphState>>(
      std::make_shared<const ParagraphState>(std::move(data)), ShadowNodeFamily::Weak());
}

bool hasProperty(GtkWidget *widget, GtkAccessibleProperty property, const char *value) {
  char *error = gtk_test_accessible_check_property(GTK_ACCESSIBLE(widget), property, value);
  bool ok = error == nullptr;
  if (!ok) {
    MESSAGE(std::string(error));
    g_free(error);
  }
  return ok;
}

} // namespace

TEST_CASE("a view is made with GTK's role for its accessibility role, and a plain one is read through") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("accessibilityRole", "button")("accessible", true)), {{0, 0}, {50, 20}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("role", "heading")("accessible", true)), {{0, 30}, {50, 20}}));
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object()), {{0, 60}, {50, 20}}));
  views.add(MountedViews::shadow(5, "View", desktopViewProps(dynamic::object("role", "checkbox")("accessible", true)), {{0, 90}, {50, 20}}));
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(2))) == GTK_ACCESSIBLE_ROLE_BUTTON);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(3))) == GTK_ACCESSIBLE_ROLE_HEADING);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(4))) == GTK_ACCESSIBLE_ROLE_GENERIC);
  CHECK(gtk_accessible_get_accessible_role(GTK_ACCESSIBLE(views.view(5))) == GTK_ACCESSIBLE_ROLE_CHECKBOX);
}

TEST_CASE("a view's label and hint follow its props, and go when the props drop them") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto button = MountedViews::shadow(
      2, "View", desktopViewProps(dynamic::object("accessibilityRole", "button")("accessible", true)("accessibilityLabel", "Save")("accessibilityHint", "Saves the note")),
      {{0, 0}, {50, 20}});
  views.add(button);
  CHECK(hasProperty(views.view(2), GTK_ACCESSIBLE_PROPERTY_LABEL, "Save"));
  CHECK(hasProperty(views.view(2), GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, "Saves the note"));

  views.update(button, desktopViewProps(dynamic::object("accessibilityRole", "button")("accessible", true)("accessibilityLabel", "Save as")));
  CHECK(hasProperty(views.view(2), GTK_ACCESSIBLE_PROPERTY_LABEL, "Save as"));
  CHECK_FALSE(gtk_test_accessible_has_property(GTK_ACCESSIBLE(views.view(2)), GTK_ACCESSIBLE_PROPERTY_DESCRIPTION));
}

TEST_CASE("a heading's level and a checkbox's checked and disabled states reach GTK") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("role", "heading")("accessible", true)("accessibilityLevel", 2)), {{0, 0}, {50, 20}}));
  char *level = gtk_test_accessible_check_property(GTK_ACCESSIBLE(views.view(2)), GTK_ACCESSIBLE_PROPERTY_LEVEL, 2);
  CHECK(level == nullptr);
  g_free(level);

  auto box = MountedViews::shadow(
      3, "View", desktopViewProps(dynamic::object("role", "checkbox")("accessible", true)("accessibilityState", dynamic::object("checked", true)("disabled", true))),
      {{0, 30}, {50, 20}});
  views.add(box);
  CHECK(gtk_test_accessible_has_state(GTK_ACCESSIBLE(views.view(3)), GTK_ACCESSIBLE_STATE_CHECKED));
  char *error = gtk_test_accessible_check_state(GTK_ACCESSIBLE(views.view(3)), GTK_ACCESSIBLE_STATE_CHECKED, GTK_ACCESSIBLE_TRISTATE_TRUE);
  CHECK(error == nullptr);
  g_free(error);
  error = gtk_test_accessible_check_state(GTK_ACCESSIBLE(views.view(3)), GTK_ACCESSIBLE_STATE_DISABLED, TRUE);
  CHECK(error == nullptr);
  g_free(error);

  // Not checkable any more: the state goes.
  views.update(box, desktopViewProps(dynamic::object("role", "checkbox")("accessible", true)));
  CHECK_FALSE(gtk_test_accessible_has_state(GTK_ACCESSIBLE(views.view(3)), GTK_ACCESSIBLE_STATE_CHECKED));
}

TEST_CASE("each ARIA role reaches GTK by its own name, and a landmark keeps its specific role") {
  CHECK(ngn::gtk::gtkRole(ngn::AriaRole::Main) == GTK_ACCESSIBLE_ROLE_MAIN);
  CHECK(ngn::gtk::gtkRole(ngn::AriaRole::Navigation) == GTK_ACCESSIBLE_ROLE_NAVIGATION);
  CHECK(ngn::gtk::gtkRole(ngn::AriaRole::Table) == GTK_ACCESSIBLE_ROLE_TABLE);
  CHECK(ngn::gtk::gtkRole(ngn::AriaRole::Grid) == GTK_ACCESSIBLE_ROLE_GRID);
  CHECK(ngn::gtk::gtkRole(ngn::AriaRole::ToggleButton) == GTK_ACCESSIBLE_ROLE_TOGGLE_BUTTON);
  CHECK(ngn::gtk::gtkRole(ngn::AriaRole::MenuItemRadio) == GTK_ACCESSIBLE_ROLE_MENU_ITEM_RADIO);
  CHECK(ngn::gtk::gtkRole(ngn::AriaRole::None) == GTK_ACCESSIBLE_ROLE_NONE);
  // Past the GTK the host builds against.
  CHECK(ngn::gtk::gtkRole(ngn::AriaRole::Article) == GTK_ACCESSIBLE_ROLE_GROUP);

  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("role", "main")("accessibilityLabel", "Inbox")), {{0, 0}, {50, 20}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("role", "complementary")), {{0, 30}, {50, 20}}));
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object("accessibilityRole", "togglebutton")), {{0, 60}, {50, 20}}));
  CHECK(roleOf(views.view(2)) == GTK_ACCESSIBLE_ROLE_MAIN);
  CHECK(roleOf(views.view(3)) == GTK_ACCESSIBLE_ROLE_REGION);
  CHECK(roleOf(views.view(4)) == GTK_ACCESSIBLE_ROLE_TOGGLE_BUTTON);
}

TEST_CASE("a view whose role changes gets a widget in the new role, in its place, with its children") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto card = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("role", "button")("accessibilityLabel", "Open")), {{10, 10}, {100, 100}});
  views.add(card);
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", 0xffff0000)), {{0, 0}, {40, 40}}), 2);
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object()), {{50, 50}, {40, 40}}), 2);
  views.add(MountedViews::shadow(5, "View", desktopViewProps(dynamic::object()), {{0, 150}, {40, 40}}));
  GtkWidget *before = views.view(2);
  g_object_ref(before);
  CHECK(roleOf(before) == GTK_ACCESSIBLE_ROLE_BUTTON);

  // Only the label changes: the same widget.
  views.update(card, desktopViewProps(dynamic::object("role", "button")("accessibilityLabel", "Open card")));
  CHECK(views.view(2) == before);

  views.update(card, desktopViewProps(dynamic::object("role", "heading")("accessibilityLabel", "Card")("accessibilityLevel", 3)));
  GtkWidget *after = views.view(2);
  CHECK(after != before);
  CHECK(roleOf(after) == GTK_ACCESSIBLE_ROLE_HEADING);
  char *level = gtk_test_accessible_check_property(GTK_ACCESSIBLE(after), GTK_ACCESSIBLE_PROPERTY_LEVEL, 3);
  CHECK(level == nullptr);
  g_free(level);
  // The old widget is out of the tree and holds nothing.
  CHECK(gtk_widget_get_parent(before) == nullptr);
  CHECK(gtk_widget_get_first_child(before) == nullptr);
  g_object_unref(before);
  // Where the old one was, before its sibling, with its children in their order, drawn at their
  // frames.
  CHECK(gtk_widget_get_parent(after) == views.view(MountedViews::kSurface));
  CHECK(gtk_widget_get_next_sibling(after) == views.view(5));
  CHECK(gtk_widget_get_first_child(after) == views.view(3));
  CHECK(gtk_widget_get_next_sibling(views.view(3)) == views.view(4));
  CHECK(ngn::gtk::viewData(after)->tag == 2);
  CHECK(reddish(views.pixel(20, 20)));
}

TEST_CASE("a view whose role changes keeps the focus, in itself or in a field inside it") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto group = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("role", "group")), {{0, 0}, {180, 100}});
  views.add(group);
  views.add(MountedViews::shadow(3, "TextInput", textInputProps(dynamic::object()), {{10, 10}, {150, 40}}), 2);
  GtkWidget *text = ngn::gtk::viewData(views.view(3))->field->text;
  REQUIRE(gtk_widget_grab_focus(text));
  views.update(group, desktopViewProps(dynamic::object("role", "form")));
  CHECK(roleOf(views.view(2)) == GTK_ACCESSIBLE_ROLE_FORM);
  CHECK(gtk_root_get_focus(gtk_widget_get_root(text)) == text);
  CHECK(gtk_widget_is_ancestor(text, views.view(2)));
  // The field still hears the user.
  CHECK(ngn::gtk::viewData(views.view(3))->field->view == ngn::gtk::viewData(views.view(3)));

  ngn::gtk::trackFocus(GTK_WINDOW(views.window));
  views.update(group, desktopViewProps(dynamic::object("role", "form")("focusable", true)));
  REQUIRE(gtk_widget_grab_focus(views.view(2)));
  views.update(group, desktopViewProps(dynamic::object("role", "region")("focusable", true)));
  CHECK(roleOf(views.view(2)) == GTK_ACCESSIBLE_ROLE_REGION);
  CHECK(gtk_widget_get_focusable(views.view(2)));
  CHECK(gtk_root_get_focus(gtk_widget_get_root(views.view(2))) == views.view(2));
  // Its focus ring moves with it.
  CHECK(gtk_widget_has_css_class(views.view(2), "ngn-focused"));
}

TEST_CASE("a view whose role changes leaves a focused field's caret where it was, selecting nothing") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto group = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("role", "group")), {{0, 0}, {180, 100}});
  views.add(group);
  views.add(MountedViews::shadow(3, "TextInput", textInputProps(dynamic::object("text", "draft")), {{10, 10}, {150, 40}}), 2);
  GtkWidget *text = ngn::gtk::viewData(views.view(3))->field->text;
  REQUIRE(gtk_text_grab_focus_without_selecting(GTK_TEXT(text)));
  gtk_editable_set_position(GTK_EDITABLE(text), 2);
  views.update(group, desktopViewProps(dynamic::object("role", "form")));
  REQUIRE(gtk_root_get_focus(gtk_widget_get_root(text)) == text);
  int start = 0, end = 0;
  CHECK_FALSE(gtk_editable_get_selection_bounds(GTK_EDITABLE(text), &start, &end));
  CHECK(gtk_editable_get_position(GTK_EDITABLE(text)) == 2);
}

TEST_CASE("a view whose role changes keeps a covered child hidden, and the others shown") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto stack = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("role", "group")), {{0, 0}, {100, 100}});
  views.add(stack);
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object()), {{0, 0}, {100, 100}}), 2);
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object()), {{0, 0}, {100, 100}}), 2);
  views.backend->setCovered(MountedViews::kSurface, 3, true);
  REQUIRE_FALSE(gtk_widget_get_child_visible(views.view(3)));
  views.update(stack, desktopViewProps(dynamic::object("role", "region")));
  CHECK(roleOf(views.view(2)) == GTK_ACCESSIBLE_ROLE_REGION);
  CHECK_FALSE(gtk_widget_get_child_visible(views.view(3)));
  CHECK(gtk_widget_get_child_visible(views.view(4)));
}

TEST_CASE("a paragraph that stops saying anything is read through, and is static text again when it does") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto paragraph = MountedViews::shadow(2, "Paragraph", desktopViewProps(dynamic::object()), {{0, 0}, {150, 20}});
  paragraph.state = paragraphState("Saved");
  views.add(paragraph);
  CHECK(roleOf(views.view(2)) == GTK_ACCESSIBLE_ROLE_LABEL);
  // Named by its text, which is what Orca speaks.
  CHECK(hasProperty(views.view(2), GTK_ACCESSIBLE_PROPERTY_LABEL, "Saved"));
  CHECK_FALSE(gtk_test_accessible_has_property(GTK_ACCESSIBLE(views.view(2)), GTK_ACCESSIBLE_PROPERTY_VALUE_TEXT));

  auto setText = [&](const std::string &text) {
    auto current = views.mounting->tree().find(2)->view;
    auto next = current;
    next.state = paragraphState(text);
    views.mount({ShadowViewMutation::UpdateMutation(current, next, MountedViews::kSurface)});
  };
  setText("");
  CHECK(roleOf(views.view(2)) == GTK_ACCESSIBLE_ROLE_GENERIC);
  setText("Saved again");
  CHECK(roleOf(views.view(2)) == GTK_ACCESSIBLE_ROLE_LABEL);
  CHECK(hasProperty(views.view(2), GTK_ACCESSIBLE_PROPERTY_LABEL, "Saved again"));
}

TEST_CASE("a paragraph whose state alone changes its role keeps its opacity") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto paragraph = MountedViews::shadow(2, "Paragraph", desktopViewProps(dynamic::object("opacity", 0)), {{0, 0}, {150, 20}});
  paragraph.state = paragraphState("");
  views.add(paragraph);
  GtkWidget *before = views.view(2);
  CHECK(gtk_widget_get_opacity(before) == 0);
  // A state update only, with the same props: the new widget is made with GTK's opacity of 1.
  auto current = views.mounting->tree().find(2)->view;
  auto next = current;
  next.state = paragraphState("Hidden");
  views.mount({ShadowViewMutation::UpdateMutation(current, next, MountedViews::kSurface)});
  CHECK(views.view(2) != before);
  CHECK(gtk_widget_get_opacity(views.view(2)) == 0);
}

TEST_CASE("a text input's wrapper is generic, its field the text box with the label") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto field = MountedViews::shadow(2, "TextInput", textInputProps(dynamic::object("accessibilityLabel", "Title")), {{10, 10}, {150, 40}});
  views.add(field);
  GtkWidget *text = ngn::gtk::viewData(views.view(2))->field->text;
  CHECK(roleOf(views.view(2)) == GTK_ACCESSIBLE_ROLE_GENERIC);
  CHECK_FALSE(gtk_test_accessible_has_property(GTK_ACCESSIBLE(views.view(2)), GTK_ACCESSIBLE_PROPERTY_LABEL));
  CHECK(hasProperty(text, GTK_ACCESSIBLE_PROPERTY_LABEL, "Title"));
  // And it follows the props.
  views.update(field, textInputProps(dynamic::object("accessibilityLabel", "Name")));
  CHECK(hasProperty(text, GTK_ACCESSIBLE_PROPERTY_LABEL, "Name"));
}

TEST_CASE("an announcement is said through the window on GTK 4.14 and later, and nothing is said below") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  bool said = ngn::gtk::announceOn(views.surface, {.text = "Saved", .priority = ngn::AnnouncementPriority::Medium});
  CHECK(said == (gtk_get_minor_version() >= 14));
  CHECK_FALSE(ngn::gtk::announceOn(views.surface, {.text = ""}));
}

namespace {

// Whether `widget` has `relation` to exactly `target`.
bool relates(GtkWidget *widget, GtkAccessibleRelation relation, GtkWidget *target) {
  char *error = gtk_test_accessible_check_relation(GTK_ACCESSIBLE(widget), relation, target, nullptr);
  if (error) {
    MESSAGE(error);
  }
  bool ok = error == nullptr;
  g_free(error);
  return ok;
}

} // namespace

TEST_CASE("a field is labelled and described by the views its props name, and follows them as they go") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("nativeID", "name")("accessibilityLabel", "Name")), {{0, 0}, {100, 20}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("nativeID", "hint")("accessibilityLabel", "As on your passport")), {{0, 20}, {100, 20}}));
  auto field = MountedViews::shadow(4, "TextInput",
      textInputProps(dynamic::object("accessibilityLabelledBy", dynamic::array("name"))("accessibilityDescribedBy", dynamic::array("hint", "missing"))),
      {{0, 50}, {150, 40}});
  views.add(field);
  GtkWidget *text = ngn::gtk::viewData(views.view(4))->field->text;
  CHECK(relates(text, GTK_ACCESSIBLE_RELATION_LABELLED_BY, views.view(2)));
  CHECK(relates(text, GTK_ACCESSIBLE_RELATION_DESCRIBED_BY, views.view(3)));

  // The view named goes: the relation goes with it.
  auto hint = views.mounting->tree().find(3)->view;
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, hint, 1), ShadowViewMutation::DeleteMutation(hint)});
  CHECK_FALSE(gtk_test_accessible_has_relation(GTK_ACCESSIBLE(text), GTK_ACCESSIBLE_RELATION_DESCRIBED_BY));
  CHECK(relates(text, GTK_ACCESSIBLE_RELATION_LABELLED_BY, views.view(2)));

  // The props stop naming it.
  views.update(field, textInputProps(dynamic::object()));
  CHECK_FALSE(gtk_test_accessible_has_relation(GTK_ACCESSIBLE(text), GTK_ACCESSIBLE_RELATION_LABELLED_BY));
}

TEST_CASE("a relation moves to the new widget of a view whose role changes, at either end") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto label = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("nativeID", "name")("accessibilityLabel", "Name")), {{0, 0}, {100, 20}});
  views.add(label);
  auto button = MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("role", "button")("accessibilityLabelledBy", dynamic::array("name"))), {{0, 30}, {100, 20}});
  views.add(button);
  CHECK(relates(views.view(3), GTK_ACCESSIBLE_RELATION_LABELLED_BY, views.view(2)));

  // The view named becomes a heading: the button points at its new widget.
  GtkWidget *before = views.view(2);
  views.update(label, desktopViewProps(dynamic::object("nativeID", "name")("accessibilityLabel", "Name")("role", "heading")));
  REQUIRE(views.view(2) != before);
  CHECK(relates(views.view(3), GTK_ACCESSIBLE_RELATION_LABELLED_BY, views.view(2)));

  // The view naming it becomes a link: its new widget has the relation.
  before = views.view(3);
  views.update(button, desktopViewProps(dynamic::object("role", "link")("accessibilityLabelledBy", dynamic::array("name"))));
  REQUIRE(views.view(3) != before);
  CHECK(relates(views.view(3), GTK_ACCESSIBLE_RELATION_LABELLED_BY, views.view(2)));
}
