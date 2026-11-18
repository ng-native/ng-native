#include "fake-backend.h"
#include "helpers.h"
#include "ngn/control-sizes.h"
#include "ngn/mounting-manager.h"
#include "ngn/native-controls.h"

#include <doctest/doctest.h>

#include <functional>
#include <utility>

#include <folly/json.h>
#include <react/renderer/core/ConcreteState.h>

using namespace facebook::react;

namespace {

// Ten points a character of the title, so a new title is a new size. It fails a check when it is
// called off the UI thread.
class RecordingMeasurer final : public ngn::ControlMeasurer {
 public:
  explicit RecordingMeasurer(const ngn::testing::FakeBackend *backend) : backend(backend) {}
  Size measure(ngn::ControlKind kind, const ngn::NativeControlProps &props) const override {
    CHECK(backend->onUiThread());
    kinds.push_back(kind);
    sizes.push_back(props.controlSize);
    titles.push_back(props.title);
    if (auto next = std::exchange(whileMeasuring, nullptr)) {
      next();
    }
    return {(props.controlSize == ngn::ControlSize::Small ? 60.f : 80.f) + 10.f * props.title.size(), 22};
  }
  const ngn::testing::FakeBackend *backend;
  mutable std::vector<ngn::ControlKind> kinds;
  mutable std::vector<ngn::ControlSize> sizes;
  mutable std::vector<std::string> titles;
  // Run once, inside the next measurement.
  mutable std::function<void()> whileMeasuring;
};

template <class Descriptor>
struct Control {
  std::shared_ptr<ngn::testing::FakeBackend> backend = std::make_shared<ngn::testing::FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  std::shared_ptr<RecordingMeasurer> measurer = std::make_shared<RecordingMeasurer>(backend.get());
  // The tags each relayout was asked for, in order.
  std::shared_ptr<std::vector<Tag>> relaidOut = std::make_shared<std::vector<Tag>>();
  std::shared_ptr<ngn::ControlSizes> sizes = mounting->startControlSizes(measurer, [out = relaidOut](Tag tag, const State &) {
    out->push_back(tag);
  });
  std::shared_ptr<ContextContainer> context = [this] {
    auto c = std::make_shared<ContextContainer>();
    ngn::installControlSizes(*c, sizes);
    return c;
  }();
  Descriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};

  std::shared_ptr<const ngn::NativeControlProps> props(folly::dynamic raw, Props::Shared source = nullptr) {
    return std::static_pointer_cast<const ngn::NativeControlProps>(
        descriptor.cloneProps(parserContext, source, RawProps(std::move(raw))));
  }

  std::shared_ptr<const ShadowNode> node(folly::dynamic raw, Tag tag = 9) {
    auto family = descriptor.createFamily({.tag = tag, .surfaceId = 1, .instanceHandle = nullptr});
    auto p = props(std::move(raw));
    return descriptor.createShadowNode(
        ShadowNodeFragment{.props = p, .state = descriptor.createInitialState(p, family)}, family);
  }

  // A layout on the UI thread, which measures what it misses at once.
  Size measureOnUiThread(const ShadowNode &node, Size max = {1000, 1000});

  // A mount of `node`'s view at a state of its own, as the layout a settle asked for arrives with.
  void mountRelaidOut(const ShadowNode &node) {
    auto view = ngn::testing::shadowView(node.getTag(), node.getComponentName(), {}, node.getProps());
    auto next = view;
    next.state = node.getState();
    mounting->executeMount(1, MountingTransaction(1, 1, {ShadowViewMutation::UpdateMutation(view, next, 1)}, {}));
    backend->drain();
  }

  void mountDeleted(const ShadowNode &node) {
    auto view = ngn::testing::shadowView(node.getTag(), node.getComponentName(), {}, node.getProps());
    mounting->executeMount(1, MountingTransaction(1, 1, {ShadowViewMutation::DeleteMutation(view)}, {}));
    backend->drain();
  }
};

// A layout off the UI thread, as the JS thread's.
Size measure(const ShadowNode &node, Size max = {1000, 1000}) {
  const auto &layoutable = dynamic_cast<const LayoutableShadowNode &>(node);
  return layoutable.measureContent({}, {.minimumSize = {0, 0}, .maximumSize = max});
}

template <class Descriptor>
Size Control<Descriptor>::measureOnUiThread(const ShadowNode &node, Size max) {
  Size size;
  backend->runOnUiThread([&] { size = measure(node, max); });
  backend->drain();
  return size;
}

} // namespace

TEST_CASE("a native button's props are parsed, with enabled and controlSize") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  auto p = c.props(folly::dynamic::object("title", "Delete")("kind", "destructive")("controlSize", "small")(
      "sfSymbol", "trash")("enabled", false)("opacity", 0.5));
  CHECK(p->title == "Delete");
  CHECK(p->kind == "destructive");
  CHECK(p->controlSize == ngn::ControlSize::Small);
  CHECK(p->sfSymbol == "trash");
  CHECK_FALSE(p->enabled);
  CHECK(p->opacity == doctest::Approx(0.5));

  // An update keeps what it does not mention, and enabled comes back when it is unset.
  auto next = c.props(folly::dynamic::object("title", "Remove"), p);
  CHECK(next->kind == "destructive");
  CHECK_FALSE(next->enabled);
  CHECK(c.props(folly::dynamic::object("enabled", nullptr), next)->enabled);
  CHECK(c.props(folly::dynamic::object("controlSize", nullptr), next)->controlSize == ngn::ControlSize::Regular);
}

TEST_CASE("a switch is disabled by React Native's disabled prop, and takes its value") {
  Control<ngn::SwitchControlComponentDescriptor> c;
  auto p = c.props(folly::dynamic::object("value", true)("disabled", true));
  CHECK(p->value);
  CHECK_FALSE(p->enabled);
  CHECK(c.props(folly::dynamic::object("disabled", false), p)->enabled);
}

TEST_CASE("a segmented control and a date picker parse what their elements commit") {
  Control<ngn::SegmentedControlComponentDescriptor> segments;
  auto s = segments.props(folly::dynamic::object("values", folly::dynamic::array("Day", "Week"))("selectedIndex", 1));
  CHECK(s->values == std::vector<std::string>{"Day", "Week"});
  CHECK(s->selectedIndex == 1);

  Control<ngn::DatePickerComponentDescriptor> picker;
  auto d = picker.props(folly::dynamic::object("date", 1.7e12)("mode", "time")("displayIOS", "compact"));
  CHECK(d->date == doctest::Approx(1.7e12));
  CHECK(d->mode == "time");
  CHECK(d->display == "compact");
  CHECK_FALSE(d->minimumDate.has_value());
}

TEST_CASE("a control measures as the toolkit draws it at its control size") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  auto regular = c.node(folly::dynamic::object("title", "Save"));
  CHECK(regular->getTraits().check(ShadowNodeTraits::Trait::MeasurableYogaNode));
  CHECK(regular->getTraits().check(ShadowNodeTraits::Trait::LeafYogaNode));
  CHECK(c.measureOnUiThread(*regular) == Size{120, 22});
  CHECK(c.measureOnUiThread(*c.node(folly::dynamic::object("controlSize", "small"), 10)) == Size{60, 22});
  // The constraints still win, over a size already measured.
  CHECK(c.measureOnUiThread(*regular, {50, 1000}) == Size{50, 22});
  CHECK(c.measurer->kinds == std::vector<ngn::ControlKind>(2, ngn::ControlKind::Button));

  Control<ngn::DatePickerComponentDescriptor> picker;
  picker.measureOnUiThread(*picker.node(folly::dynamic::object()));
  CHECK(picker.measurer->kinds == std::vector<ngn::ControlKind>{ngn::ControlKind::DatePicker});
}

TEST_CASE("a control measures as nothing without control sizes") {
  auto context = std::make_shared<ContextContainer>();
  ngn::SwitchControlComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto family = descriptor.createFamily({.tag = 9, .surfaceId = 1, .instanceHandle = nullptr});
  auto node = descriptor.createShadowNode(
      ShadowNodeFragment{.props = descriptor.cloneProps(parserContext, nullptr, RawProps(folly::dynamic::object("value", true)))},
      family);
  CHECK(measure(*node) == Size{0, 0});
}

TEST_CASE("a control's state counts its measurements, from none") {
  Control<ngn::SwitchControlComponentDescriptor> c;
  auto node = c.node(folly::dynamic::object());
  const auto *state = dynamic_cast<const ConcreteState<ngn::NativeControlState> *>(node->getState().get());
  REQUIRE(state != nullptr);
  CHECK(state->getData().measured == 0);
}

TEST_CASE("layout off the UI thread reads the sizes, and the UI thread measures what it misses") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  auto save = c.node(folly::dynamic::object("title", "Save"));

  // Nothing measured yet: nothing for now, no measurement on this thread, and a settle posted once.
  CHECK(measure(*save) == Size{0, 0});
  CHECK(measure(*save) == Size{0, 0});
  CHECK(c.measurer->kinds.empty());
  CHECK(c.backend->pending() == 1);
  CHECK_FALSE(c.mounting->controlSizesSettled());

  // The settle measures on the UI thread, holds the size and asks the control for a layout again.
  c.backend->drain();
  CHECK(c.measurer->titles == std::vector<std::string>{"Save"});
  CHECK(*c.relaidOut == std::vector<Tag>{9});
  CHECK(c.sizes->held() == 1);
  // Not settled until the layout it asked for is mounted.
  CHECK_FALSE(c.mounting->controlSizesSettled());

  // That layout reads the size, with no measurement and nothing posted.
  CHECK(measure(*save) == Size{120, 22});
  CHECK(c.measurer->kinds.size() == 1);
  CHECK(c.backend->pending() == 0);
  c.mountRelaidOut(*save);
  CHECK(c.mounting->controlSizesSettled());
}

TEST_CASE("a control's size is measured again when a measured input changes, and only then") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  CHECK(c.measureOnUiThread(*c.node(folly::dynamic::object("title", "Save"))) == Size{120, 22});

  // A new title: the old size until the UI thread measures the new one, which replaces it.
  auto longer = c.node(folly::dynamic::object("title", "Save all"));
  CHECK(measure(*longer) == Size{120, 22});
  c.backend->drain();
  CHECK(c.measurer->titles == std::vector<std::string>{"Save", "Save all"});
  CHECK(*c.relaidOut == std::vector<Tag>{9});
  CHECK(measure(*longer) == Size{160, 22});
  CHECK(c.sizes->held() == 1);

  // A change of control size is measured too.
  auto small = c.node(folly::dynamic::object("title", "Save all")("controlSize", "small"));
  CHECK(measure(*small) == Size{160, 22});
  c.backend->drain();
  CHECK(measure(*small) == Size{140, 22});

  // Disabling it changes nothing it is measured by.
  CHECK(measure(*c.node(folly::dynamic::object("title", "Save all")("controlSize", "small")("enabled", false))) ==
        Size{140, 22});
  CHECK(c.measurer->kinds.size() == 3);
  CHECK(c.backend->pending() == 0);
}

TEST_CASE("a measurement a control no longer wants is not made") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  auto first = c.node(folly::dynamic::object("title", "One"));
  CHECK(measure(*first) == Size{0, 0});
  // Laid out again with other inputs before the settle: only those are measured.
  auto second = c.node(folly::dynamic::object("title", "Two!"));
  CHECK(measure(*second) == Size{0, 0});
  c.backend->drain();
  CHECK(c.measurer->titles == std::vector<std::string>{"Two!"});
  CHECK(*c.relaidOut == std::vector<Tag>{9});
  CHECK(c.sizes->held() == 1);
}

TEST_CASE("a control laid out with other inputs while a settle runs is not measured for its old ones") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  measure(*c.node(folly::dynamic::object("title", "Nine"), 9));
  measure(*c.node(folly::dynamic::object("title", "Ten"), 10));
  // A layout of 10 with a new title lands while the settle measures 9.
  auto renamed = c.node(folly::dynamic::object("title", "Ten again"), 10);
  c.measurer->whileMeasuring = [&] { measure(*renamed); };
  c.backend->drain();
  CHECK(c.measurer->titles == std::vector<std::string>{"Nine", "Ten again"});
  CHECK(*c.relaidOut == std::vector<Tag>{9});
  CHECK(measure(*renamed) == Size{170, 22});
}

TEST_CASE("controls with the same inputs share a size, which goes with the last of them") {
  Control<ngn::SwitchControlComponentDescriptor> c;
  auto a = c.node(folly::dynamic::object("value", true), 9);
  auto b = c.node(folly::dynamic::object("value", false), 10);
  measure(*a);
  measure(*b);
  c.backend->drain();
  CHECK(c.measurer->kinds.size() == 1);
  CHECK(*c.relaidOut == std::vector<Tag>{9, 10});
  CHECK(c.sizes->held() == 1);

  // Each waits for its own layout's mount.
  c.mountRelaidOut(*a);
  CHECK_FALSE(c.mounting->controlSizesSettled());
  c.mountRelaidOut(*b);
  CHECK(c.mounting->controlSizesSettled());

  c.mountDeleted(*a);
  CHECK(c.sizes->held() == 1);
  c.mountDeleted(*b);
  CHECK(c.sizes->held() == 0);

  // A switch laid out after them is measured afresh.
  measure(*c.node(folly::dynamic::object(), 11));
  c.backend->drain();
  CHECK(c.measurer->kinds.size() == 2);
}

TEST_CASE("a control deleted while it waits for its layout settles, and lets go of its size") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  auto save = c.node(folly::dynamic::object("title", "Save"));
  measure(*save);
  c.backend->drain();
  CHECK(c.sizes->held() == 1);
  CHECK_FALSE(c.mounting->controlSizesSettled());
  c.mountDeleted(*save);
  CHECK(c.sizes->held() == 0);
  CHECK(c.mounting->controlSizesSettled());
}

TEST_CASE("a new instance's control sizes start empty") {
  Control<ngn::SwitchControlComponentDescriptor> c;
  c.measureOnUiThread(*c.node(folly::dynamic::object()));
  CHECK(c.sizes->held() == 1);
  auto next = c.mounting->startControlSizes(c.measurer);
  CHECK(next->held() == 0);
  CHECK(next->layoutSize(9, ngn::ControlKind::Switch, c.props(folly::dynamic::object()), nullptr) == Size{0, 0});
}

TEST_CASE("a control's size key holds every input it is measured by, and nothing else") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  auto key = [&](ngn::ControlKind kind, folly::dynamic raw) { return ngn::controlSizeKey(kind, *c.props(std::move(raw))); };
  using K = ngn::ControlKind;
  struct Case {
    K kind;
    folly::dynamic base;
    folly::dynamic changed;
  };
  auto object = [] { return folly::dynamic::object(); };
  std::vector<Case> measured = {
      {K::Button, object(), folly::dynamic::object("title", "Go")},
      {K::Button, object(), folly::dynamic::object("kind", "plain")},
      {K::Button, object(), folly::dynamic::object("sfSymbol", "trash")},
      {K::Button, object(), folly::dynamic::object("controlSize", "large")},
      {K::Switch, object(), folly::dynamic::object("controlSize", "mini")},
      {K::ActivityIndicator, object(), folly::dynamic::object("size", "large")},
      {K::ActivityIndicator, object(), folly::dynamic::object("controlSize", "small")},
      {K::SegmentedControl, object(), folly::dynamic::object("values", folly::dynamic::array("Day"))},
      {K::SegmentedControl,
       folly::dynamic::object("values", folly::dynamic::array("Day", "Week")),
       folly::dynamic::object("values", folly::dynamic::array("Day\x1fWeek"))},
      {K::SegmentedControl, object(), folly::dynamic::object("momentary", true)},
      {K::DatePicker, object(), folly::dynamic::object("mode", "time")},
      {K::DatePicker, object(), folly::dynamic::object("displayIOS", "inline")},
      {K::DatePicker, object(), folly::dynamic::object("date", 1.7e12)},
      {K::DatePicker, folly::dynamic::object("date", 0), object()},
      {K::SearchField, object(), folly::dynamic::object("text", "teal")},
      {K::SearchField, object(), folly::dynamic::object("placeholder", "Search")},
      {K::SearchField, object(), folly::dynamic::object("fontFamily", "Georgia")},
      {K::SearchField, object(), folly::dynamic::object("fontSize", 20)},
      {K::SearchField, object(), folly::dynamic::object("fontWeight", 700)},
      {K::SearchField, object(), folly::dynamic::object("fontStyle", "italic")},
  };
  for (const auto &m : measured) {
    CAPTURE(folly::toJson(m.changed));
    CHECK(key(m.kind, m.base) != key(m.kind, m.changed));
  }
  // The kind is in it, and what only changes how a control looks or acts is not.
  CHECK(key(K::Button, object()) != key(K::Switch, object()));
  std::vector<std::pair<K, folly::dynamic>> unmeasured = {
      {K::Button, folly::dynamic::object("enabled", false)},
      {K::Switch, folly::dynamic::object("value", true)},
      {K::ActivityIndicator, folly::dynamic::object("animating", false)("color", 0xff0000ff)},
      {K::SegmentedControl, folly::dynamic::object("selectedIndex", 1)},
      {K::DatePicker, folly::dynamic::object("minimumDate", 1.0)},
      {K::SearchField, folly::dynamic::object("mostRecentEventCount", 4)},
      {K::Button, folly::dynamic::object("opacity", 0.5)},
  };
  for (const auto &[kind, raw] : unmeasured) {
    CAPTURE(folly::toJson(raw));
    CHECK(key(kind, object()) == key(kind, raw));
  }
}

TEST_CASE("every native control is a component the core knows, by the name the element commits") {
  auto backend = std::make_shared<ngn::testing::FakeBackend>();
  auto mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  for (const char *name :
       {"NgNativeButton",
        "Switch",
        "ActivityIndicatorView",
        "RNCSegmentedControl",
        "RNDateTimePicker",
        "ViewManagerAdapter_NgNativeSearchField"}) {
    CHECK(mounting->hasComponent(name));
    CHECK(ngn::controlKind(name).has_value());
  }
  CHECK_FALSE(ngn::controlKind("View").has_value());
}

TEST_CASE("a search field parses what <search-field> commits, its type included") {
  Control<ngn::SearchFieldComponentDescriptor> c;
  auto p = c.props(folly::dynamic::object("text", "teal")("mostRecentEventCount", 3)("placeholder", "Search colours")(
      "autoCapitalize", "none")("enabled", false)("controlSize", "small")("tintColor", 0xff00ff00)(
      "fontFamily", "Georgia")("fontSize", 20)("fontWeight", "bold")("fontStyle", "italic"));
  CHECK(p->text == "teal");
  CHECK(p->mostRecentEventCount == 3);
  CHECK(p->placeholder == "Search colours");
  CHECK(p->autoCapitalize == "none");
  CHECK_FALSE(p->enabled);
  CHECK(p->controlSize == ngn::ControlSize::Small);
  CHECK(p->tintColor);
  CHECK(p->fontFamily == "Georgia");
  CHECK(p->fontSize == 20);
  CHECK(p->fontWeight == 700);
  CHECK(p->italic);

  // A weight as a number or a numeric string, and an update that keeps what it does not mention.
  auto next = c.props(folly::dynamic::object("fontWeight", 300)("text", ""), p);
  CHECK(next->fontWeight == 300);
  CHECK(next->text.empty());
  CHECK(next->italic);
  CHECK(next->fontFamily == "Georgia");
  CHECK(c.props(folly::dynamic::object("fontWeight", "600"), next)->fontWeight == 600);
  CHECK(c.props(folly::dynamic::object("fontWeight", "normal"), next)->fontWeight == 400);
  auto cleared = c.props(folly::dynamic::object("fontWeight", nullptr)("fontStyle", nullptr)("fontSize", nullptr), next);
  CHECK_FALSE(cleared->fontWeight.has_value());
  CHECK_FALSE(cleared->italic);
  CHECK_FALSE(cleared->fontSize.has_value());

  c.measureOnUiThread(*c.node(folly::dynamic::object("controlSize", "large")));
  CHECK(c.measurer->kinds == std::vector<ngn::ControlKind>{ngn::ControlKind::SearchField});
  CHECK(c.measurer->sizes == std::vector<ngn::ControlSize>{ngn::ControlSize::Large});
}

TEST_CASE("a button's kind is empty until the element sets one") {
  Control<ngn::NativeButtonComponentDescriptor> c;
  CHECK(c.props(folly::dynamic::object("title", "Save"))->kind.empty());
  CHECK(c.props(folly::dynamic::object("kind", "default"))->kind == "default");
}
