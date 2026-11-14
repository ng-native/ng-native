#include "fake-backend.h"
#include "helpers.h"
#include "ngn/desktop-view-props.h"
#include "ngn/mounting-manager.h"
#include "ngn/screen-presentation.h"

#include <doctest/doctest.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;
using ngn::ModalPresentation;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

using Lines = std::vector<std::string>;

std::shared_ptr<const ngn::ScreenProps> screenProps(std::string presentation, int anchor = 0) {
  auto props = std::make_shared<ngn::ScreenProps>();
  props->stackPresentation = std::move(presentation);
  props->anchor = anchor;
  return props;
}

ShadowView screen(Tag tag, std::string presentation = "push", int anchor = 0) {
  return shadowView(tag, "RNSScreen", {{0, 0}, {400, 300}}, screenProps(std::move(presentation), anchor));
}

struct RecordingStacks final : ngn::ScreenStacks {
  Lines *events;
  explicit RecordingStacks(Lines *events) : events(events) {}
  void emit(const ngn::ViewTree::Node &node, const char *event) override {
    events->push_back(std::string(event) + " " + std::to_string(node.view.tag));
  }
};

struct Fixture {
  Lines events;
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting =
      std::make_shared<ngn::MountingManager>(backend, backend, std::make_unique<RecordingStacks>(&events));
  ShadowView stack = shadowView(2, "RNSScreenStack", {{0, 0}, {400, 300}});

  Fixture() {
    mount({ShadowViewMutation::CreateMutation(stack), ShadowViewMutation::InsertMutation(1, stack, 0)});
  }

  void mount(ShadowViewMutationList mutations) {
    backend->calls.clear();
    events.clear();
    mounting->executeMount(1, MountingTransaction(1, 1, std::move(mutations), {}));
    backend->drain();
  }

  ShadowViewMutationList add(const ShadowView &view, int index, bool header = false) {
    ShadowViewMutationList out{ShadowViewMutation::CreateMutation(view)};
    if (header) {
      auto config = shadowView(view.tag + 5, "RNSScreenStackHeaderConfig", {{0, 0}, {400, 44}});
      out.push_back(ShadowViewMutation::CreateMutation(config));
      out.push_back(ShadowViewMutation::InsertMutation(view.tag, config, 0));
    }
    out.push_back(ShadowViewMutation::InsertMutation(2, view, index));
    return out;
  }

  // What the backend heard about covering, presenting and the header.
  Lines calls() const {
    Lines out;
    for (const auto &c : backend->calls) {
      if (c.starts_with("cover") || c.starts_with("uncover") || c.starts_with("present") ||
          c.starts_with("unpresent") || c.starts_with("header") || c == "no header") {
        out.push_back(c);
      }
    }
    return out;
  }
};

ngn::BarButton button(std::string id, std::string title) {
  return ngn::BarButton{.id = std::move(id), .title = std::move(title)};
}

} // namespace

TEST_CASE("a screen is presented as a sheet, a cover or, with an anchor, a popover") {
  CHECK_FALSE(ngn::screenPresentation(*screenProps("push")));
  CHECK(ngn::screenPresentation(*screenProps("modal")) == ModalPresentation::Sheet);
  CHECK(ngn::screenPresentation(*screenProps("formSheet")) == ModalPresentation::Sheet);
  CHECK(ngn::screenPresentation(*screenProps("pageSheet")) == ModalPresentation::Sheet);
  CHECK(ngn::screenPresentation(*screenProps("fullScreenModal")) == ModalPresentation::Cover);
  CHECK(ngn::screenPresentation(*screenProps("transparentModal")) == ModalPresentation::Cover);
  CHECK(ngn::screenPresentation(*screenProps("containedModal")) == ModalPresentation::Cover);
  CHECK(ngn::screenPresentation(*screenProps("modal", 7)) == ModalPresentation::Popover);
  // A pushed screen with an anchor is still pushed.
  CHECK_FALSE(ngn::screenPresentation(*screenProps("push", 7)));
  // The backend learns it as it learns a modal's.
  auto desktop = ngn::desktopProps(*screenProps("formSheet", 9));
  CHECK(desktop.presentation == ModalPresentation::Popover);
  CHECK(desktop.anchor == 9);
}

TEST_CASE("the props are read from what the router commits, anchor included") {
  static auto context = std::make_shared<const ContextContainer>();
  PropsParserContext parserContext{1, *context};
  RawPropsParser parser;
  parser.prepare<ngn::ScreenProps>();
  RawProps raw(folly::dynamic::object("stackPresentation", "formSheet")("anchor", 12));
  raw.parse(parser);
  ngn::ScreenProps empty;
  ngn::ScreenProps props(parserContext, empty, raw);
  CHECK(props.stackPresentation == "formSheet");
  CHECK(props.anchor == 12);
}

TEST_CASE("a presented screen leaves the screen under it showing, its header in the toolbar") {
  Fixture f;
  f.mount(f.add(screen(10), 0, true));
  f.mount(f.add(screen(20, "formSheet"), 1, true));
  CHECK(f.calls() == Lines{"present 20"});
  CHECK(f.events == Lines{"willDisappear 10", "willAppear 20", "disappear 10", "appear 20", "finishTransitioning 2"});

  // A push over the sheet covers the screen in front of the window, not the sheet.
  f.mount(f.add(screen(30, "formSheet"), 2, true));
  CHECK(f.calls() == Lines{"present 30"});

  // The app makes the top one a pushed screen: the screens under it are covered, and a sheet
  // under a pushed screen is no longer presented.
  f.mount({ShadowViewMutation::UpdateMutation(screen(30, "formSheet"), screen(30), 2)});
  CHECK(f.calls() ==
        Lines{"cover 10", "cover 20", "unpresent 20", "unpresent 30", "header 35 of 30 with back"});
}

TEST_CASE("a cover's header takes the window's toolbar while it is presented, a sheet's does not") {
  Fixture f;
  f.mount(f.add(screen(10), 0, true));
  // A cover fills the window under its toolbar, so its header is the toolbar's, with nothing to
  // go back to: on iOS a full-screen modal has a navigation bar of its own.
  f.mount(f.add(screen(20, "fullScreenModal"), 1, true));
  CHECK(f.calls() == Lines{"present 20", "header 25 of 20"});

  // A sheet over the cover draws its own header; the toolbar keeps the cover's.
  f.mount(f.add(screen(30, "formSheet"), 2, true));
  CHECK(f.calls() == Lines{"present 30"});

  // Dismissed, the cover gives the toolbar back to the screen under it.
  f.mount({ShadowViewMutation::RemoveMutation(2, screen(30, "formSheet"), 2), ShadowViewMutation::DeleteMutation(screen(30, "formSheet"))});
  f.mount({ShadowViewMutation::RemoveMutation(2, screen(20, "fullScreenModal"), 1),
           ShadowViewMutation::DeleteMutation(screen(20, "fullScreenModal"))});
  CHECK(f.calls() == Lines{"header 15 of 10"});
}

TEST_CASE("a sheet's header is a heading and a row of buttons, Cancel first and the last one default") {
  ngn::HeaderBar header{.title = "Filters", .left = {button("cancel", "Cancel")}, .right = {button("reset", "Reset"), button("done", "Done")}};
  auto chrome = ngn::sheetChrome(header, ModalPresentation::Sheet);
  CHECK(chrome.heading == "Filters");
  CHECK(chrome.buttons == std::vector<ngn::SheetButton>{
                              {.id = "cancel", .title = "Cancel", .cancel = true},
                              {.id = "reset", .title = "Reset"},
                              {.id = "done", .title = "Done", .isDefault = true},
                          });
  CHECK(chrome.top() == ngn::kSheetHeadingHeight);
  CHECK(chrome.bottom() == ngn::kSheetButtonRowHeight);

  // A popover draws no header: its title only labels it.
  auto popover = ngn::sheetChrome(header, ModalPresentation::Popover);
  CHECK(popover.heading.empty());
  CHECK(popover.buttons.empty());
  CHECK(popover.label == "Filters");

  // Only a Cancel is no default; a hidden header draws nothing; a space is no button.
  ngn::HeaderBar cancelOnly{.title = "Hi", .left = {button("x", "Cancel")}, .right = {ngn::BarButton{.spacing = 8.0}}};
  auto only = ngn::sheetChrome(cancelOnly, ModalPresentation::Sheet);
  REQUIRE(only.buttons.size() == 1);
  CHECK_FALSE(only.buttons[0].isDefault);
  header.hidden = true;
  CHECK(ngn::sheetChrome(header, ModalPresentation::Sheet).top() == 0);
}
