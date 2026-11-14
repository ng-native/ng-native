#include "fake-backend.h"
#include "ngn/mounting-manager.h"
#include "ngn/native-controls.h"

#include <doctest/doctest.h>

using namespace facebook::react;

namespace {

class RecordingMeasurer final : public ngn::ControlMeasurer {
 public:
  Size measure(ngn::ControlKind kind, const ngn::NativeControlProps &props) const override {
    kinds.push_back(kind);
    sizes.push_back(props.controlSize);
    return {props.controlSize == ngn::ControlSize::Small ? 60.f : 80.f, 22};
  }
  mutable std::vector<ngn::ControlKind> kinds;
  mutable std::vector<ngn::ControlSize> sizes;
};

template <class Descriptor>
struct Control {
  std::shared_ptr<RecordingMeasurer> measurer = std::make_shared<RecordingMeasurer>();
  std::shared_ptr<ContextContainer> context = [this] {
    auto c = std::make_shared<ContextContainer>();
    ngn::installControlMeasurer(*c, measurer);
    return c;
  }();
  Descriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};

  std::shared_ptr<const ngn::NativeControlProps> props(folly::dynamic raw, Props::Shared source = nullptr) {
    return std::static_pointer_cast<const ngn::NativeControlProps>(
        descriptor.cloneProps(parserContext, source, RawProps(std::move(raw))));
  }

  std::shared_ptr<const ShadowNode> node(folly::dynamic raw) {
    auto family = descriptor.createFamily({.tag = 9, .surfaceId = 1, .instanceHandle = nullptr});
    return descriptor.createShadowNode(ShadowNodeFragment{.props = props(std::move(raw))}, family);
  }
};

Size measure(const ShadowNode &node, Size max = {1000, 1000}) {
  const auto &layoutable = dynamic_cast<const LayoutableShadowNode &>(node);
  return layoutable.measureContent({}, {.minimumSize = {0, 0}, .maximumSize = max});
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
  CHECK(measure(*regular) == Size{80, 22});
  CHECK(measure(*c.node(folly::dynamic::object("controlSize", "small"))) == Size{60, 22});
  // The constraints still win.
  CHECK(measure(*regular, {50, 1000}) == Size{50, 22});
  CHECK(c.measurer->kinds == std::vector<ngn::ControlKind>(3, ngn::ControlKind::Button));

  Control<ngn::DatePickerComponentDescriptor> picker;
  measure(*picker.node(folly::dynamic::object()));
  CHECK(picker.measurer->kinds == std::vector<ngn::ControlKind>{ngn::ControlKind::DatePicker});
}

TEST_CASE("a control measures as nothing without a measurer") {
  auto context = std::make_shared<ContextContainer>();
  ngn::SwitchControlComponentDescriptor descriptor{{{}, context, nullptr}};
  PropsParserContext parserContext{1, *context};
  auto family = descriptor.createFamily({.tag = 9, .surfaceId = 1, .instanceHandle = nullptr});
  auto node = descriptor.createShadowNode(
      ShadowNodeFragment{.props = descriptor.cloneProps(parserContext, nullptr, RawProps(folly::dynamic::object("value", true)))},
      family);
  CHECK(measure(*node) == Size{0, 0});
}

TEST_CASE("every native control is a component the core knows, by the name the element commits") {
  auto backend = std::make_shared<ngn::testing::FakeBackend>();
  auto mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  for (const char *name : {"NgNativeButton", "Switch", "ActivityIndicatorView", "RNCSegmentedControl", "RNDateTimePicker"}) {
    CHECK(mounting->hasComponent(name));
    CHECK(ngn::controlKind(name).has_value());
  }
  CHECK_FALSE(ngn::controlKind("View").has_value());
}
