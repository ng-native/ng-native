// What VoiceOver reads from a mounted view: the role, label, value and state the core maps from
// React Native's accessibility props (accessibility.h), as NGNView reports them through AppKit's
// NSAccessibility properties.
#include "mounted-views.h"

#include <doctest/doctest.h>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::SentEvents;
using ngn::testing::viewProps;

TEST_CASE("Space, Return and keypad Enter press the focused view once each") {
  SentEvents<ViewEventEmitter> sent;
  MountedViews m;
  auto button = MountedViews::shadow(
      2, "View", viewProps(folly::dynamic::object("focusable", true)("onAccessibilityTap", true)));
  button.eventEmitter = sent.emitter;
  m.add(button);
  NGNView *view = m.view(2);
  REQUIRE([m.window makeFirstResponder:view]);
  REQUIRE((m.window.firstResponder == view));

  auto keyDown = [&](NSString *key, unsigned short keyCode, NSEventModifierFlags flags, BOOL repeat = NO) {
    [view keyDown:[NSEvent keyEventWithType:NSEventTypeKeyDown
                                  location:NSZeroPoint
                             modifierFlags:flags
                                 timestamp:0
                              windowNumber:m.window.windowNumber
                                   context:nil
                                characters:key
               charactersIgnoringModifiers:key
                                 isARepeat:repeat
                                   keyCode:keyCode]];
  };
  keyDown(@" ", 49, 0);
  keyDown(@"\r", 36, 0);
  REQUIRE(sent.count("topAccessibilityTap") == 2);
  keyDown(@"\x03", 76, NSEventModifierFlagNumericPad);
  CHECK(sent.count("topAccessibilityTap") == 3);
  keyDown(@"\x03", 76, NSEventModifierFlagNumericPad | NSEventModifierFlagCommand);
  keyDown(@"\x03", 76, NSEventModifierFlagNumericPad, YES);
  CHECK(sent.count("topAccessibilityTap") == 3);
}

TEST_CASE("a button has its role, label, hint and enabled state") {
  MountedViews m;
  auto save = MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("accessible", true)("role", "button")(
      "accessibilityLabel", "Save")("accessibilityHint", "Saves the file")));
  m.add(save);
  NGNView *view = m.view(2);
  REQUIRE((view != nil));

  CHECK(view.isAccessibilityElement);
  CHECK([view.accessibilityRole isEqualToString:NSAccessibilityButtonRole]);
  CHECK([view.accessibilityLabel isEqualToString:@"Save"]);
  CHECK([view.accessibilityHelp isEqualToString:@"Saves the file"]);
  CHECK([view.accessibilityRoleDescription isEqualToString:NSAccessibilityRoleDescription(NSAccessibilityButtonRole, nil)]);
  CHECK(view.isAccessibilityEnabled);

  // Disabled, then enabled again, by a later commit.
  m.update(save, viewProps(folly::dynamic::object("accessible", true)("role", "button")("accessibilityLabel", "Save")(
      "accessibilityState", folly::dynamic::object("disabled", true))));
  CHECK_FALSE(view.isAccessibilityEnabled);
  m.update(save, viewProps(folly::dynamic::object("accessible", true)("role", "button")("accessibilityLabel", "Save")(
      "accessibilityState", folly::dynamic::object("disabled", false))));
  CHECK(view.isAccessibilityEnabled);
}

TEST_CASE("a label and a hint a later commit removes are no longer read") {
  MountedViews m;
  auto logo = MountedViews::shadow(
      2, "View", viewProps(folly::dynamic::object("accessibilityLabel", "Logo")("accessibilityHint", "Goes home")));
  m.add(logo);
  NGNView *view = m.view(2);
  REQUIRE([view.accessibilityLabel isEqualToString:@"Logo"]);
  m.update(logo, viewProps(folly::dynamic::object("accessibilityLabel", "Brand")));
  CHECK([view.accessibilityLabel isEqualToString:@"Brand"]);
  CHECK((view.accessibilityHelp == nil));
  m.update(logo, viewProps(folly::dynamic::object()));
  CHECK((view.accessibilityLabel == nil));
  CHECK_FALSE(view.isAccessibilityElement);
}

TEST_CASE("a switch is a checkbox with the switch subrole whose value says whether it is on") {
  MountedViews m;
  auto toggle = MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("accessible", true)("role", "switch")(
      "accessibilityLabel", "Wi-Fi")("accessibilityState", folly::dynamic::object("checked", true))));
  m.add(toggle);
  NGNView *view = m.view(2);
  CHECK([view.accessibilityRole isEqualToString:NSAccessibilityCheckBoxRole]);
  CHECK([view.accessibilitySubrole isEqualToString:NSAccessibilitySwitchSubrole]);
  CHECK([view.accessibilityValue isEqual:@1]);

  m.update(toggle, viewProps(folly::dynamic::object("accessible", true)("role", "switch")(
      "accessibilityState", folly::dynamic::object("checked", false))));
  CHECK([view.accessibilityValue isEqual:@0]);
  // A checkbox in neither state is mixed.
  m.update(toggle, viewProps(folly::dynamic::object("accessible", true)("role", "checkbox")(
      "accessibilityState", folly::dynamic::object("checked", "mixed"))));
  CHECK((view.accessibilitySubrole == nil));
  CHECK([view.accessibilityValue isEqual:@2]);
}

TEST_CASE("a value is the text, or else the number now, and none once removed") {
  MountedViews m;
  auto progress = MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("accessible", true)("role", "progressbar")(
      "accessibilityValue", folly::dynamic::object("now", 40)("min", 0)("max", 100))));
  m.add(progress);
  NGNView *view = m.view(2);
  CHECK([view.accessibilityRole isEqualToString:NSAccessibilityProgressIndicatorRole]);
  CHECK([view.accessibilityValue isEqual:@"40"]);
  m.update(progress, viewProps(folly::dynamic::object("accessible", true)("role", "progressbar")(
      "accessibilityValue", folly::dynamic::object("text", "Almost done"))));
  m.update(progress, viewProps(folly::dynamic::object("accessible", true)("role", "progressbar")));
  CHECK((view.accessibilityValue == nil));
}

TEST_CASE("selected and expanded are reported from the state") {
  MountedViews m;
  auto tab = MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("accessible", true)("role", "tab")(
      "accessibilityLabel", "Inbox")("accessibilityState", folly::dynamic::object("selected", true))));
  m.add(tab);
  NGNView *view = m.view(2);
  CHECK([view.accessibilityRole isEqualToString:NSAccessibilityRadioButtonRole]);
  CHECK([view.accessibilitySubrole isEqualToString:NSAccessibilityTabButtonSubrole]);
  CHECK(view.isAccessibilitySelected);
  CHECK_FALSE(view.isAccessibilityExpanded);

  m.update(tab, viewProps(folly::dynamic::object("accessible", true)("role", "button")(
      "accessibilityState", folly::dynamic::object("expanded", true))));
  CHECK_FALSE(view.isAccessibilitySelected);
  CHECK(view.isAccessibilityExpanded);
}

TEST_CASE("an item's place in its set, a table's counts and a refused value are read while the props say them") {
  MountedViews m;
  auto item = MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("accessible", true)("role", "listitem")(
      "accessibilityPosInSet", 3)("accessibilitySetSize", 10)("accessibilityRequired", true)("accessibilityInvalid", true)));
  m.add(item);
  m.add(MountedViews::shadow(3, "View", viewProps(folly::dynamic::object("role", "grid")("accessibilityRowCount", 50)(
      "accessibilityColumnCount", 4))));
  NGNView *view = m.view(2);
  NGNView *grid = m.view(3);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  CHECK([[view accessibilityAttributeValue:@"AXARIAPosInSet"] isEqual:@3]);
  CHECK([[view accessibilityAttributeValue:@"AXARIASetSize"] isEqual:@10]);
  CHECK([[view accessibilityAttributeValue:@"AXInvalid"] isEqual:@"true"]);
  CHECK([view.accessibilityAttributeNames containsObject:@"AXARIAPosInSet"]);
  CHECK(view.isAccessibilityRequired);
  CHECK([[grid accessibilityAttributeValue:NSAccessibilityRowCountAttribute] isEqual:@50]);
  CHECK([[grid accessibilityAttributeValue:NSAccessibilityColumnCountAttribute] isEqual:@4]);

  m.update(item, viewProps(folly::dynamic::object("accessible", true)("role", "listitem")));
  CHECK_FALSE([view.accessibilityAttributeNames containsObject:@"AXARIAPosInSet"]);
  CHECK(([view accessibilityAttributeValue:@"AXInvalid"] == nil));
  CHECK_FALSE(view.isAccessibilityRequired);
#pragma clang diagnostic pop
}

TEST_CASE("a text input's field is required and refused as its props say") {
  MountedViews m;
  auto input = MountedViews::shadow(2, "TextInput", ngn::testing::textInputProps(folly::dynamic::object(
      "accessibilityRequired", true)("accessibilityInvalid", true)));
  m.add(input);
  NSView *field = (NSView *)[m.view(2) keyboardResponder];
  CHECK(field.isAccessibilityRequired);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  CHECK([[field accessibilityAttributeValue:@"AXInvalid"] isEqual:@"true"]);
  m.update(input, ngn::testing::textInputProps(folly::dynamic::object()));
  CHECK_FALSE(field.isAccessibilityRequired);
  CHECK([[field accessibilityAttributeValue:@"AXInvalid"] isEqual:@"false"]);

  // A multiline input's text view, the same.
  auto notes = MountedViews::shadow(3, "TextInput", ngn::testing::textInputProps(folly::dynamic::object("multiline", true)(
      "accessibilityRequired", true)("accessibilityInvalid", true)));
  m.add(notes);
  NSView *text = (NSView *)[m.view(3) keyboardResponder];
  CHECK([text isKindOfClass:NSTextView.class]);
  CHECK(text.isAccessibilityRequired);
  CHECK([[text accessibilityAttributeValue:@"AXInvalid"] isEqual:@"true"]);
#pragma clang diagnostic pop
}

TEST_CASE("a role AppKit lacks is a group that says what it is") {
  MountedViews m;
  m.add(MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("role", "alert")("accessibilityLabel", "Offline"))));
  NGNView *view = m.view(2);
  CHECK([view.accessibilityRole isEqualToString:NSAccessibilityGroupRole]);
  CHECK([view.accessibilityRoleDescription isEqualToString:@"alert"]);
}

TEST_CASE("a view read as one element is named by the labels inside it, not hidden ones, and has no children") {
  MountedViews m;
  m.add(MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("accessible", true)("role", "button"))));
  m.add(MountedViews::shadow(3, "View", viewProps(folly::dynamic::object("accessibilityLabel", "Download"))), 2);
  auto hidden = MountedViews::shadow(4, "View", viewProps(folly::dynamic::object("accessibilityLabel", "Secret")));
  hidden.layoutMetrics.displayType = DisplayType::None;
  m.add(hidden, 2);
  m.add(MountedViews::shadow(5, "View", viewProps(folly::dynamic::object("accessibilityLabel", "2 MB"))), 2);
  NGNView *view = m.view(2);
  REQUIRE(m.view(4).hidden);
  CHECK([view.accessibilityLabel isEqualToString:@"Download 2 MB"]);
  CHECK(view.accessibilityChildren.count == 0);

  // A container that is not one element leaves its children to be read on their own.
  m.add(MountedViews::shadow(6, "View", viewProps(folly::dynamic::object())));
  m.add(MountedViews::shadow(7, "View", viewProps(folly::dynamic::object("accessibilityLabel", "Inside"))), 6);
  CHECK((m.view(6).accessibilityLabel == nil));
  CHECK([m.view(6).accessibilityChildren containsObject:m.view(7)]);
}

TEST_CASE("hidden and presentational views are no elements") {
  MountedViews m;
  m.add(MountedViews::shadow(2, "View", viewProps(folly::dynamic::object())));
  m.add(MountedViews::shadow(
      3, "View", viewProps(folly::dynamic::object("role", "button")("accessibilityElementsHidden", true))));
  m.add(MountedViews::shadow(4, "View", viewProps(folly::dynamic::object("role", "presentation")("accessible", true))));
  m.add(MountedViews::shadow(
      5, "View", viewProps(folly::dynamic::object("accessible", true)("importantForAccessibility", "no-hide-descendants"))));
  for (Tag tag : {2, 3, 4, 5}) {
    CAPTURE(tag);
    CHECK_FALSE(m.view(tag).isAccessibilityElement);
  }
}

TEST_CASE("a view is labelled and described by the views its props name, ahead of its own label and hint") {
  MountedViews m;
  m.add(MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("nativeID", "name")("accessibilityLabel", "Name"))));
  m.add(MountedViews::shadow(3, "View", viewProps(folly::dynamic::object("nativeID", "hint")("accessibilityLabel", "As on your passport"))));
  auto field = MountedViews::shadow(4, "View", viewProps(folly::dynamic::object("accessible", true)("role", "button")(
      "accessibilityLabel", "Own")("accessibilityHint", "Own hint")("accessibilityLabelledBy", folly::dynamic::array("name"))(
      "accessibilityDescribedBy", folly::dynamic::array("hint"))));
  m.add(field);
  NGNView *view = m.view(4);
  CHECK([view.accessibilityLabel isEqualToString:@"Name"]);
  CHECK([view.accessibilityHelp isEqualToString:@"As on your passport"]);
  CHECK((view.accessibilityTitleUIElement == m.view(2)));

  // The view named goes: the view's own hint is read again.
  auto hint = m.mounting->tree().find(3)->view;
  m.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, hint, 1), ShadowViewMutation::DeleteMutation(hint)});
  CHECK([view.accessibilityHelp isEqualToString:@"Own hint"]);
  // The props stop naming the label: the view's own label is read again.
  m.update(field, viewProps(folly::dynamic::object("accessible", true)("role", "button")("accessibilityLabel", "Own")));
  CHECK([view.accessibilityLabel isEqualToString:@"Own"]);
  CHECK((view.accessibilityTitleUIElement == nil));
}

TEST_CASE("a native control is labelled and described by the views its props name, on the control that is the element") {
  MountedViews m;
  auto name = MountedViews::shadow(2, "View", viewProps(folly::dynamic::object("nativeID", "name")("accessibilityLabel", "Notifications")));
  m.add(name);
  m.add(MountedViews::shadow(3, "View", viewProps(folly::dynamic::object("nativeID", "hint")("accessibilityLabel", "Sent by email"))));
  auto props = [](bool related) {
    folly::dynamic raw = folly::dynamic::object("title", "Go");
    if (related) {
      raw["accessibilityLabelledBy"] = folly::dynamic::array("name");
      raw["accessibilityDescribedBy"] = folly::dynamic::array("hint");
    }
    return ngn::testing::nativeButtonProps(std::move(raw));
  };
  auto button = MountedViews::shadow(4, "NgNativeButton", props(true));
  m.add(button);
  NGNView *view = m.view(4);
  NSView *control = [view accessibilityControl];
  REQUIRE((control != nil));
  CHECK_FALSE(view.isAccessibilityElement);
  CHECK([control.accessibilityLabel isEqualToString:@"Notifications"]);
  CHECK([control.accessibilityHelp isEqualToString:@"Sent by email"]);
  CHECK((control.accessibilityTitleUIElement == m.view(2)));

  // The text of the view named changes: the control reads the new one.
  m.update(name, viewProps(folly::dynamic::object("nativeID", "name")("accessibilityLabel", "Alerts")));
  CHECK([control.accessibilityLabel isEqualToString:@"Alerts"]);
  // The control's own props applied again keep what the relations say.
  m.update(button, props(true));
  CHECK([control.accessibilityLabel isEqualToString:@"Alerts"]);

  // The props stop naming them: the label and help they gave go.
  m.update(button, props(false));
  CHECK_FALSE([control.accessibilityLabel isEqualToString:@"Alerts"]);
  CHECK((control.accessibilityHelp == nil));
  CHECK((control.accessibilityTitleUIElement == nil));
}
