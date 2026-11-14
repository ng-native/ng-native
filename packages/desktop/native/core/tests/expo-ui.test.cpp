#include "fake-backend.h"
#include "helpers.h"
#include "ngn/expo-ui.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/mounting/MountingTransaction.h>

#include <algorithm>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

const std::shared_ptr<const ContextContainer> &context() {
  static auto shared = std::make_shared<const ContextContainer>();
  return shared;
}

// The descriptor for an expo/ui view, made as the registry makes it from its provider.
const ComponentDescriptor &descriptor(const std::string &view) {
  static std::map<std::string, ComponentDescriptor::Unique> made;
  auto &d = made[view];
  if (!d) {
    for (const auto &provider : ngn::expoUIComponentProviders()) {
      if (std::string(provider.name) == std::string(ngn::kExpoUIPrefix) + view) {
        d = provider.constructor({{}, context(), provider.flavor});
      }
    }
  }
  REQUIRE(d);
  return *d;
}

std::shared_ptr<const ngn::ExpoUIProps> props(const std::string &view, dynamic raw, Props::Shared source = nullptr) {
  PropsParserContext parserContext{1, *context()};
  return std::static_pointer_cast<const ngn::ExpoUIProps>(
      descriptor(view).cloneProps(parserContext, source, RawProps(std::move(raw))));
}

std::shared_ptr<ShadowNode> node(
    const std::string &view,
    Tag tag,
    dynamic raw,
    std::vector<std::shared_ptr<const ShadowNode>> children = {},
    std::optional<ngn::ExpoUIState> data = std::nullopt) {
  const auto &d = descriptor(view);
  auto p = props(view, std::move(raw));
  auto family = d.createFamily({.tag = tag, .surfaceId = 1, .instanceHandle = nullptr});
  auto initial = d.createInitialState(p, family);
  State::Shared state = initial;
  if (data) {
    using ConcreteState = ngn::ExpoUIShadowNode::ConcreteState;
    state = std::make_shared<const ConcreteState>(std::make_shared<const ngn::ExpoUIState>(*data), *initial);
  }
  return d.createShadowNode(
      {.props = p,
       .children = std::make_shared<const std::vector<std::shared_ptr<const ShadowNode>>>(std::move(children)),
       .state = state},
      family);
}

Rect layOut(const std::shared_ptr<ShadowNode> &child, Size size) {
  auto root = node("GroupView", 1, dynamic::object(), {child});
  auto &layoutable = static_cast<YogaLayoutableShadowNode &>(*root);
  layoutable.layoutTree(LayoutContext{}, {.minimumSize = size, .maximumSize = size});
  return static_cast<const LayoutableShadowNode &>(*root->getChildren()[0]).getLayoutMetrics().frame;
}

ShadowView ui(Tag tag, const std::string &view, dynamic raw = dynamic::object()) {
  auto name = std::string(ngn::kExpoUIPrefix) + view;
  for (const auto &provider : ngn::expoUIComponentProviders()) {
    if (name == provider.name) {
      return shadowView(tag, provider.name, {}, props(view, std::move(raw)));
    }
  }
  FAIL("no provider for " << view);
  return {};
}

struct Fixture {
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(backend, backend);

  std::vector<std::string> mount(ShadowViewMutationList mutations) {
    backend->calls.clear();
    mounting->executeMount(1, MountingTransaction(1, 1, std::move(mutations), {}));
    backend->drain();
    std::vector<std::string> out;
    for (const auto &line : backend->calls) {
      if (line.starts_with("expo-ui")) {
        out.push_back(line);
      }
    }
    return out;
  }
};

ShadowViewMutationList add(Tag parent, std::vector<ShadowView> children) {
  ShadowViewMutationList out;
  for (const auto &child : children) {
    out.push_back(ShadowViewMutation::CreateMutation(child));
  }
  for (size_t i = 0; i < children.size(); i++) {
    out.push_back(ShadowViewMutation::InsertMutation(parent, children[i], static_cast<int>(i)));
  }
  return out;
}

ShadowViewMutationList operator+(ShadowViewMutationList a, const ShadowViewMutationList &b) {
  a.insert(a.end(), b.begin(), b.end());
  return a;
}

} // namespace

TEST_CASE("every expo/ui view the host draws is a component, under the name iOS commits") {
  auto backend = std::make_shared<FakeBackend>();
  auto mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  for (const auto &view : ngn::expoUIViews()) {
    CHECK(mounting->hasComponent(std::string(ngn::kExpoUIPrefix) + view));
    CHECK(ngn::expoUIViewName(std::string(ngn::kExpoUIPrefix) + view) == view);
  }
  CHECK(mounting->hasComponent("ViewManagerAdapter_ExpoUI_PickerView"));
  CHECK(mounting->hasComponent("ViewManagerAdapter_ExpoUI_DatePickerView"));
  // The absent ones are not, and fall to Fabric's unimplemented view.
  CHECK_FALSE(mounting->hasComponent("ViewManagerAdapter_ExpoUI_SyncToggleView"));
  CHECK_FALSE(mounting->hasComponent("ViewManagerAdapter_ExpoUI_ToolbarView"));
  CHECK_FALSE(ngn::expoUIViewName("ViewManagerAdapter_ExpoUI_ToolbarView").has_value());
  CHECK_FALSE(ngn::expoUIViewName("ViewManagerAdapter_ExpoImage").has_value());

  // Each descriptor is its own name, and its shadow nodes say so.
  const auto &picker = descriptor("PickerView");
  CHECK(std::string(picker.getComponentName()) == "ViewManagerAdapter_ExpoUI_PickerView");
  CHECK(picker.getComponentHandle() != descriptor("SliderView").getComponentHandle());
  auto made = node("PickerView", 5, dynamic::object());
  CHECK(std::string(made->getComponentName()) == "ViewManagerAdapter_ExpoUI_PickerView");
}

TEST_CASE("an expo/ui view keeps every prop it is given, the last value of each, until a null removes it") {
  auto first = props(
      "PickerView",
      dynamic::object("label", "Room")("selection", "kitchen")(
          "modifiers", dynamic::array(dynamic::object("$type", "pickerStyle")("style", "menu"))));
  CHECK(first->values["label"] == "Room");
  CHECK(first->values["modifiers"][0]["style"] == "menu");

  auto next = props("PickerView", dynamic::object("selection", 3), first);
  CHECK(next->values["label"] == "Room");
  CHECK(next->values["selection"] == 3);

  auto cleared = props("PickerView", dynamic::object("label", nullptr), next);
  CHECK(cleared->values.count("label") == 0);
  CHECK(cleared->values["selection"] == 3);
}

TEST_CASE("a HostView takes its content's size on the axes it matches, and its style's on the others") {
  // Before the toolkit reports, the style's size.
  auto unsized = node("HostView", 2, dynamic::object("matchContentsVertical", true)("height", 10));
  CHECK(layOut(unsized, {400, 600}).size == Size{400, 10});

  // Matching vertically: the content's height, the width the container gives.
  auto vertical = node(
      "HostView", 2, dynamic::object("matchContentsVertical", true)("height", 10), {}, ngn::ExpoUIState{{120, 28}});
  CHECK(layOut(vertical, {400, 600}).size == Size{400, 28});

  // Matching both: the content's size.
  auto both = node(
      "HostView",
      2,
      dynamic::object("matchContentsVertical", true)("matchContentsHorizontal", true)("alignSelf", "flex-start"),
      {},
      ngn::ExpoUIState{{120, 28}});
  CHECK(layOut(both, {400, 600}).size == Size{120, 28});

  // Matching neither: the reported size is not taken.
  auto neither = node("HostView", 2, dynamic::object("height", 50), {}, ngn::ExpoUIState{{120, 28}});
  CHECK(layOut(neither, {400, 600}).size == Size{400, 50});
}

TEST_CASE("the views under a HostView reach the backend as one tree, with their props and event emitters") {
  Fixture f;
  auto root = shadowView(1, "RootView", {});
  auto host = ui(2, "HostView", dynamic::object("matchContentsVertical", true));
  auto picker = ui(3, "PickerView", dynamic::object("label", "Room")("selection", "a"));
  picker.eventEmitter = std::make_shared<ViewEventEmitter>(nullptr, std::weak_ptr<const EventDispatcher>());
  auto slot = ui(4, "SlotView", dynamic::object("name", "content"));
  auto option = ui(5, "TextView", dynamic::object("text", "Kitchen"));
  auto viewHost = ui(6, "RNHostView");
  auto own = shadowView(7, "View", {});

  auto lines = f.mount(
      add(1, {host}) + add(2, {picker}) + add(3, {slot, viewHost}) + add(4, {option}) + add(6, {own}));
  CHECK(lines == std::vector<std::string>{"expo-ui 2 with 1"});
  const auto &tree = *f.backend->expoUITrees.at(2);
  CHECK(tree.name == "HostView");
  CHECK(tree.props["matchContentsVertical"] == true);
  REQUIRE(tree.children.size() == 1);
  const auto &p = tree.children[0];
  CHECK(p.name == "PickerView");
  CHECK(p.tag == 3);
  CHECK(p.props["label"] == "Room");
  CHECK(p.eventEmitter == picker.eventEmitter);
  REQUIRE(p.children.size() == 2);
  CHECK(p.children[0].name == "SlotView");
  CHECK(p.children[0].children[0].props["text"] == "Kitchen");
  // The app's own views under an RNHostView are not SwiftUI's.
  CHECK(p.children[1].name == "RNHostView");
  CHECK(p.children[1].children.empty());

  SUBCASE("a change to a prop sends the tree again") {
    auto chosen = ui(3, "PickerView", dynamic::object("label", "Room")("selection", "b"));
    chosen.eventEmitter = picker.eventEmitter;
    CHECK(f.mount({ShadowViewMutation::UpdateMutation(picker, chosen, 2)}) == std::vector<std::string>{"expo-ui 2 with 1"});
    CHECK(f.backend->expoUITrees.at(2)->children[0].props["selection"] == "b");
  }

  SUBCASE("a change to the app's own views under an RNHostView does not") {
    auto moved = own;
    moved.layoutMetrics.frame = Rect{Point{0, 0}, Size{10, 10}};
    CHECK(f.mount({ShadowViewMutation::UpdateMutation(own, moved, 6)}).empty());
  }

  SUBCASE("a child removed and deleted goes from the tree") {
    auto lines = f.mount({ShadowViewMutation::RemoveMutation(4, option, 0), ShadowViewMutation::DeleteMutation(option)});
    CHECK(lines == std::vector<std::string>{"expo-ui 2 with 1"});
    CHECK(f.backend->expoUITrees.at(2)->children[0].children[0].children.empty());
  }

  SUBCASE("a new event emitter sends the tree again") {
    auto next = picker;
    next.eventEmitter = std::make_shared<ViewEventEmitter>(nullptr, std::weak_ptr<const EventDispatcher>());
    CHECK(f.mount({ShadowViewMutation::UpdateMutation(picker, next, 2)}) == std::vector<std::string>{"expo-ui 2 with 1"});
    CHECK(f.backend->expoUITrees.at(2)->children[0].eventEmitter == next.eventEmitter);
  }

  SUBCASE("an update that changes nothing in the tree sends nothing") {
    auto moved = picker;
    moved.layoutMetrics.frame = Rect{Point{0, 0}, Size{10, 10}};
    CHECK(f.mount({ShadowViewMutation::UpdateMutation(picker, moved, 2)}).empty());
  }

  SUBCASE("a deleted host is forgotten, so one made again under its tag is sent") {
    f.mount({ShadowViewMutation::RemoveMutation(1, host, 0), ShadowViewMutation::DeleteMutation(host)});
    auto again = ui(2, "HostView");
    CHECK(f.mount(add(1, {again})) == std::vector<std::string>{"expo-ui 2 with 0"});
  }
}

TEST_CASE("a HostView inside an RNHostView is a tree of its own") {
  Fixture f;
  auto outer = ui(2, "HostView");
  auto viewHost = ui(3, "RNHostView");
  auto inner = ui(4, "HostView");
  auto toggle = ui(5, "ToggleView", dynamic::object("isOn", true));
  auto lines = f.mount(add(1, {outer}) + add(2, {viewHost}) + add(3, {inner}) + add(4, {toggle}));
  std::sort(lines.begin(), lines.end());
  CHECK(lines == std::vector<std::string>{"expo-ui 2 with 1", "expo-ui 4 with 1"});
  CHECK(f.backend->expoUITrees.at(4)->children[0].name == "ToggleView");

  // A change inside the inner tree sends only the inner one.
  auto off = ui(5, "ToggleView", dynamic::object("isOn", false));
  CHECK(f.mount({ShadowViewMutation::UpdateMutation(toggle, off, 4)}) == std::vector<std::string>{"expo-ui 4 with 1"});
}
