#include "ngn/absent-views.h"
#include "fake-backend.h"
#include "helpers.h"
#include "ngn/library-glue.h"
#include "ngn/mounting-manager.h"

#include <doctest/doctest.h>

#include <algorithm>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

MountingTransaction transaction(ShadowViewMutationList mutations) {
  return MountingTransaction(1, 1, std::move(mutations), {});
}

struct Fixture {
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(backend, backend);

  void mount(ShadowViewMutationList mutations) {
    mounting->executeMount(1, transaction(std::move(mutations)));
    backend->drain();
  }
};

std::shared_ptr<const Props> desktop(folly::dynamic raw) {
  auto context = std::make_shared<const ContextContainer>();
  ngn::DesktopViewComponentDescriptor descriptor({{}, context, nullptr});
  PropsParserContext parserContext{1, *context};
  return descriptor.cloneProps(parserContext, nullptr, RawProps(std::move(raw)));
}

} // namespace

TEST_CASE("each commit's time is reported, from its transaction's telemetry") {
  Fixture f;
  std::vector<double> commits;
  f.mounting->onCommit = [&](SurfaceId surfaceId, double ms) {
    CHECK(surfaceId == 1);
    commits.push_back(ms);
  };
  auto timed = transaction({});
  timed.getTelemetry().willCommit();
  timed.getTelemetry().didCommit();
  f.mounting->executeMount(1, std::move(timed));
  REQUIRE(commits.size() == 1);
  CHECK(commits[0] >= 0);
  CHECK(commits[0] < 1000);
  // A transaction no commit timed (a mount the core made itself) reports nothing.
  f.mounting->executeMount(1, transaction({}));
  CHECK(commits.size() == 1);
}

TEST_CASE("a transaction reaches the backend in order, on the UI thread") {
  Fixture f;
  auto box = shadowView(2, "View", {{0, 0}, {100, 50}});
  auto label = shadowView(3, "Paragraph", {{4, 4}, {60, 17}});

  f.mounting->executeMount(
      1,
      transaction({
          ShadowViewMutation::CreateMutation(box),
          ShadowViewMutation::CreateMutation(label),
          ShadowViewMutation::InsertMutation(1, box, 0),
          ShadowViewMutation::InsertMutation(2, label, 0),
      }));

  // Nothing touches the toolkit on the JS thread.
  CHECK(f.backend->calls.empty());
  CHECK(f.backend->pending() == 1);

  f.backend->drain();
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{
          "create 2 View 0,0 100x50",
          "create 3 Paragraph 4,4 60x17",
          // The surface's root is made the first time a mutation names it.
          "create 1 RootView 0,0 0x0",
          "insert 2 into 1 at 0",
          "insert 3 into 2 at 0",
          "mounted 1",
      });

  f.backend->calls.clear();
  auto moved = label;
  moved.layoutMetrics.frame.origin = {8, 8};
  f.mount({
      ShadowViewMutation::UpdateMutation(label, moved, 2),
      ShadowViewMutation::RemoveMutation(2, moved, 0),
      ShadowViewMutation::DeleteMutation(moved),
  });
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{
          // Only what changed: the layout, not the props, state or event emitter.
          "layout 3 8,8 60x17",
          "remove 3 from 2 at 0",
          "delete 3",
          "mounted 1",
      });
}

TEST_CASE("transactions mount in the order they were committed") {
  Fixture f;
  auto a = shadowView(2, "View", {{0, 0}, {10, 10}});
  auto b = shadowView(3, "View", {{0, 0}, {10, 10}});
  f.mounting->executeMount(1, transaction({ShadowViewMutation::CreateMutation(a)}));
  f.mounting->executeMount(1, transaction({ShadowViewMutation::CreateMutation(b)}));
  CHECK(f.backend->pending() == 2);
  f.backend->drain();
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{"create 2 View 0,0 10x10", "mounted 1", "create 3 View 0,0 10x10", "mounted 1"});
}

TEST_CASE("an update reports each part that changed") {
  Fixture f;
  auto before = shadowView(2, "View", {{0, 0}, {10, 10}});
  f.mount({ShadowViewMutation::CreateMutation(before), ShadowViewMutation::InsertMutation(1, before, 0)});
  f.backend->calls.clear();

  auto after = before;
  after.props = std::make_shared<const ViewProps>();
  after.layoutMetrics.frame.size = {20, 20};
  f.mount({ShadowViewMutation::UpdateMutation(before, after, 1)});
  CHECK(f.backend->calls == std::vector<std::string>{"props 2", "layout 2 0,0 20x20", "mounted 1"});
}

TEST_CASE("the view tree follows the mounted tree") {
  Fixture f;
  auto box = shadowView(2, "View", {{10, 20}, {100, 50}});
  auto label = shadowView(3, "Paragraph", {{4, 4}, {60, 17}});
  f.mount({
      ShadowViewMutation::CreateMutation(box),
      ShadowViewMutation::CreateMutation(label),
      ShadowViewMutation::InsertMutation(1, box, 0),
      ShadowViewMutation::InsertMutation(2, label, 0),
  });
  const auto &tree = f.mounting->tree();
  REQUIRE(tree.find(2) != nullptr);
  CHECK(tree.find(1)->children == std::vector<Tag>{2});
  CHECK(tree.find(2)->children == std::vector<Tag>{3});
  CHECK(tree.find(3)->parent == 2);
  CHECK(tree.originIn(3, 1) == Point{14, 24});

  f.mount({ShadowViewMutation::RemoveMutation(2, label, 0), ShadowViewMutation::DeleteMutation(label)});
  CHECK(tree.find(2)->children.empty());
  CHECK(tree.find(3) == nullptr);
}

TEST_CASE("commands run on the UI thread") {
  Fixture f;
  f.mounting->dispatchCommand(shadowView(2, "TextInput", {}), "focus", folly::dynamic::array());
  CHECK(f.backend->calls.empty());
  f.backend->drain();
  CHECK(f.backend->calls == std::vector<std::string>{"command 2 focus"});
}

TEST_CASE("the after-mount callback runs once a transaction is mounted") {
  Fixture f;
  std::vector<SurfaceId> mounted;
  f.mounting->setAfterMountCallback([&](SurfaceId surfaceId) { mounted.push_back(surfaceId); });
  f.mount({ShadowViewMutation::CreateMutation(shadowView(2, "View", {}))});
  CHECK(mounted == std::vector<SurfaceId>{1});
}

TEST_CASE("desktop props reach the backend when set and when they change") {
  Fixture f;
  auto plain = shadowView(2, "View", {});
  auto focusable = shadowView(3, "View", {}, desktop(folly::dynamic::object("focusable", true)("tabIndex", 2)));
  f.mount({ShadowViewMutation::CreateMutation(plain), ShadowViewMutation::CreateMutation(focusable)});
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{
          "create 2 View 0,0 0x0",
          "create 3 View 0,0 0x0",
          // A view that sets none of them is not reported.
          "desktop 3 focusable=true tabIndex=2",
          "mounted 1",
      });

  f.backend->calls.clear();
  auto sameAgain = focusable;
  sameAgain.props = desktop(folly::dynamic::object("focusable", true)("tabIndex", 2)("opacity", 0.5));
  f.mount({ShadowViewMutation::UpdateMutation(focusable, sameAgain, 1)});
  CHECK(f.backend->calls == std::vector<std::string>{"props 3", "mounted 1"});

  f.backend->calls.clear();
  auto cleared = sameAgain;
  cleared.props = std::make_shared<const ViewProps>();
  f.mount({ShadowViewMutation::UpdateMutation(sameAgain, cleared, 1)});
  CHECK(
      f.backend->calls ==
      std::vector<std::string>{"props 3", "desktop 3 focusable=unset tabIndex=unset", "mounted 1"});
}

TEST_CASE("the core registers its components and the backend's") {
  Fixture f;
  for (const char *name : {"View", "Paragraph", "Text", "RawText", "ScrollView", "TextInput", "Image", "ModalHostView", "ViewManagerAdapter_SymbolModule", "UnimplementedNativeView"}) {
    CHECK_MESSAGE(f.mounting->hasComponent(name), name);
  }
  CHECK_FALSE(f.mounting->hasComponent("RNSScreen"));
}

namespace {
const char KeyboardControllerViewName[] = "KeyboardControllerView";
const char LibraryViewName[] = "SomeLibraryView";
using KeyboardControllerDescriptor =
    ConcreteComponentDescriptor<ConcreteViewShadowNode<KeyboardControllerViewName, ViewProps>>;
using LibraryDescriptor = ConcreteComponentDescriptor<ConcreteViewShadowNode<LibraryViewName, ViewProps>>;
} // namespace

TEST_CASE("the registry reports refresh controls, keyboard views and the community views it has none for absent, though a library compiled in has one") {
  auto backend = std::make_shared<FakeBackend>();
  backend->providers = {
      concreteComponentDescriptorProvider<KeyboardControllerDescriptor>(),
      concreteComponentDescriptorProvider<LibraryDescriptor>(),
  };
  auto mounting = std::make_shared<ngn::MountingManager>(backend, backend);
  CHECK(mounting->hasComponent("SomeLibraryView"));
  for (const char *name : {"KeyboardControllerView", "PullToRefreshView", "AndroidSwipeRefreshLayout", "KeyboardGestureArea", "InputAccessoryView"}) {
    CHECK_FALSE_MESSAGE(mounting->hasComponent(name), name);
    REQUIRE_MESSAGE(ngn::absentReason(name), name);
  }
  CHECK(*ngn::absentReason("PullToRefreshView") == "a Mac has no pull to refresh: a scroll view stops at its top");
  CHECK(ngn::absentReason("KeyboardControllerView")->find("no software keyboard") != std::string_view::npos);
  CHECK(ngn::absentReason("RNCSlider")->find("ui-slider") != std::string_view::npos);
  CHECK(ngn::absentReason("RNCMaskedView")->find("unmasked") != std::string_view::npos);
  CHECK_FALSE(ngn::absentReason("View"));
  // Every absent view is out of the registry, whoever offers it.
  for (const auto &view : ngn::absentViews()) {
    CHECK_FALSE(mounting->hasComponent(std::string(view.name)));
  }
}

namespace {

// A view's svg element, read by the glue react-native-svg's build installs.
struct SvgProps : Props {
  ngn::SvgElement element;
};

std::shared_ptr<const Props> svgProps(ngn::SvgKind kind, std::string d = "") {
  auto p = std::make_shared<SvgProps>();
  p->element.kind = kind;
  p->element.d = std::move(d);
  return p;
}

// Installs the glue for a test, and takes it out again however the test ends.
struct SvgGlue {
  SvgGlue() {
    ngn::libraryGlue().svgElement = [](const Props &p) -> std::optional<ngn::SvgElement> {
      const auto *svg = dynamic_cast<const SvgProps *>(&p);
      return svg ? std::optional<ngn::SvgElement>(svg->element) : std::nullopt;
    };
  }
  ~SvgGlue() { ngn::libraryGlue().svgElement = nullptr; }
};

std::vector<std::string> svgCalls(const std::vector<std::string> &calls) {
  std::vector<std::string> out;
  for (const auto &c : calls) {
    if (c.rfind("svg ", 0) == 0) {
      out.push_back(c);
    }
  }
  return out;
}

} // namespace

TEST_CASE("an svg is drawn when it mounts, when an element in it is made, changed or removed, and not otherwise") {
  SvgGlue glue;
  Fixture f;
  auto svg = shadowView(2, "RNSVGSvgView", {{0, 0}, {24, 24}}, svgProps(ngn::SvgKind::Svg));
  auto path = shadowView(3, "RNSVGPath", {{0, 0}, {24, 0}}, svgProps(ngn::SvgKind::Path, "M0 0H1"));
  f.mount({
      ShadowViewMutation::CreateMutation(svg),
      ShadowViewMutation::CreateMutation(path),
      ShadowViewMutation::InsertMutation(2, path, 0),
      ShadowViewMutation::InsertMutation(1, svg, 0),
  });
  CHECK(svgCalls(f.backend->calls) == std::vector<std::string>{"svg 2 with 1"});

  f.backend->calls.clear();
  auto changed = path;
  changed.props = svgProps(ngn::SvgKind::Path, "M0 0H2");
  f.mount({ShadowViewMutation::UpdateMutation(path, changed, 0)});
  CHECK(svgCalls(f.backend->calls) == std::vector<std::string>{"svg 2 with 1"});

  // New props equal to the old: the svg is not drawn again.
  f.backend->calls.clear();
  auto same = changed;
  same.props = svgProps(ngn::SvgKind::Path, "M0 0H2");
  f.mount({ShadowViewMutation::UpdateMutation(changed, same, 0)});
  CHECK(svgCalls(f.backend->calls).empty());

  f.backend->calls.clear();
  f.mount({ShadowViewMutation::RemoveMutation(2, same, 0), ShadowViewMutation::DeleteMutation(same)});
  CHECK(svgCalls(f.backend->calls) == std::vector<std::string>{"svg 2 with 0"});
}

TEST_CASE("an svg is drawn again when a view in its foreignObject is relaid out or its state changes, and not for one outside it") {
  SvgGlue glue;
  Fixture f;
  auto svg = shadowView(2, "RNSVGSvgView", {{0, 0}, {24, 24}}, svgProps(ngn::SvgKind::Svg));
  auto object = shadowView(3, "RNSVGForeignObject", {{0, 0}, {24, 24}}, svgProps(ngn::SvgKind::ForeignObject));
  auto label = shadowView(4, "Paragraph", {{0, 0}, {24, 10}});
  auto beside = shadowView(5, "View", {{0, 30}, {24, 10}});
  f.mount({
      ShadowViewMutation::CreateMutation(svg),
      ShadowViewMutation::CreateMutation(object),
      ShadowViewMutation::CreateMutation(label),
      ShadowViewMutation::CreateMutation(beside),
      ShadowViewMutation::InsertMutation(3, label, 0),
      ShadowViewMutation::InsertMutation(2, object, 0),
      ShadowViewMutation::InsertMutation(1, svg, 0),
      ShadowViewMutation::InsertMutation(1, beside, 1),
  });
  CHECK(svgCalls(f.backend->calls) == std::vector<std::string>{"svg 2 with 1"});

  f.backend->calls.clear();
  auto moved = label;
  moved.layoutMetrics.frame.origin.y = 5;
  f.mount({ShadowViewMutation::UpdateMutation(label, moved, 0)});
  CHECK(svgCalls(f.backend->calls) == std::vector<std::string>{"svg 2 with 1"});

  f.backend->calls.clear();
  auto stated = moved;
  stated.state = std::make_shared<const ConcreteState<int>>(std::make_shared<const int>(1), ShadowNodeFamily::Weak{});
  f.mount({ShadowViewMutation::UpdateMutation(moved, stated, 0)});
  CHECK(svgCalls(f.backend->calls) == std::vector<std::string>{"svg 2 with 1"});

  f.backend->calls.clear();
  auto besideMoved = beside;
  besideMoved.layoutMetrics.frame.origin.y = 40;
  f.mount({ShadowViewMutation::UpdateMutation(beside, besideMoved, 1)});
  CHECK(svgCalls(f.backend->calls).empty());
}

TEST_CASE("a view's relations reach the backend after the transaction, and follow the view they name") {
  Fixture f;
  auto props = [](std::string id, std::vector<std::string> labelledBy, std::vector<std::string> describedBy) {
    auto p = std::make_shared<ngn::DesktopViewProps>();
    p->nativeId = std::move(id);
    p->accessibilityLabelledBy.value = std::move(labelledBy);
    p->desktop.accessibilityDescribedBy = std::move(describedBy);
    return p;
  };
  auto label = shadowView(2, "View", {}, props("name", {}, {}));
  auto hint = shadowView(3, "View", {}, props("hint", {}, {}));
  auto field = shadowView(4, "View", {}, props("", {"name"}, {"hint"}));
  f.mount({ShadowViewMutation::CreateMutation(field), ShadowViewMutation::InsertMutation(1, field, 0),
           ShadowViewMutation::CreateMutation(label), ShadowViewMutation::InsertMutation(1, label, 1),
           ShadowViewMutation::CreateMutation(hint), ShadowViewMutation::InsertMutation(1, hint, 2)});
  auto &calls = f.backend->calls;
  auto at = std::find(calls.begin(), calls.end(), "relations 4 labelledBy=2 describedBy=3");
  REQUIRE(at != calls.end());
  CHECK(*(at + 1) == "mounted 1");

  f.backend->calls.clear();
  f.mount({ShadowViewMutation::RemoveMutation(1, label, 1), ShadowViewMutation::DeleteMutation(label)});
  CHECK(std::count(calls.begin(), calls.end(), "relations 4 labelledBy= describedBy=3") == 1);

  f.backend->calls.clear();
  auto plain = field;
  plain.props = props("", {}, {});
  f.mount({ShadowViewMutation::UpdateMutation(field, plain, 0)});
  CHECK(std::count(calls.begin(), calls.end(), "relations 4 labelledBy= describedBy=") == 1);
}

TEST_CASE("a live region's new text is announced after the transaction that changed it") {
  Fixture f;
  auto live = [](std::string label) {
    auto props = std::make_shared<ViewProps>();
    props->accessibilityLiveRegion = AccessibilityLiveRegion::Assertive;
    props->accessibilityLabel = std::move(label);
    return props;
  };
  auto region = shadowView(2, "View", {}, live("Idle"));
  f.mount({ShadowViewMutation::CreateMutation(region), ShadowViewMutation::InsertMutation(1, region, 0)});
  auto busy = region;
  busy.props = live("Uploading");
  f.backend->calls.clear();
  f.mount({ShadowViewMutation::UpdateMutation(region, busy, 1)});
  CHECK(f.backend->calls == std::vector<std::string>{"props 2", "announce 1 high Uploading", "mounted 1"});

  // Once it is deleted nothing is said for it.
  f.backend->calls.clear();
  f.mount({ShadowViewMutation::RemoveMutation(1, busy, 0), ShadowViewMutation::DeleteMutation(busy)});
  CHECK(f.backend->calls == std::vector<std::string>{"remove 2 from 1 at 0", "delete 2", "mounted 1"});
}

TEST_CASE("a synchronous update on the UI thread merges the changed props into the mounted view's") {
  Fixture f;
  auto box = shadowView(2, "View", {{0, 0}, {100, 50}}, desktop(folly::dynamic::object("opacity", 1.0)("nativeID", "box")));
  f.mount({ShadowViewMutation::CreateMutation(box), ShadowViewMutation::InsertMutation(1, box, 0)});
  f.backend->calls.clear();

  f.mounting->synchronouslyUpdateViewOnUIThread(2, folly::dynamic::object("opacity", 0.25));
  // At once, with no transaction: Reanimated and Animated move a view this way every frame.
  CHECK(f.backend->calls == std::vector<std::string>{"props 2"});
  CHECK(f.backend->pending() == 0);
  auto props = std::static_pointer_cast<const ViewProps>(f.mounting->tree().find(2)->view.props);
  CHECK(props->opacity == doctest::Approx(0.25));
  CHECK(props->nativeId == "box");
  CHECK(f.backend->props.at(2) == f.mounting->tree().find(2)->view.props);

  // A view that is not mounted, or has gone, takes nothing.
  f.backend->calls.clear();
  f.mounting->synchronouslyUpdateViewOnUIThread(99, folly::dynamic::object("opacity", 0.5));
  CHECK(f.backend->calls.empty());
}

TEST_CASE("a synchronous update of a relation or an id reaches the backend at once") {
  Fixture f;
  auto props = [](std::string id) {
    auto p = std::make_shared<ngn::DesktopViewProps>();
    p->nativeId = std::move(id);
    return p;
  };
  auto field = shadowView(4, "View", {}, props(""));
  auto label = shadowView(2, "View", {}, props("name"));
  f.mount({ShadowViewMutation::CreateMutation(field), ShadowViewMutation::InsertMutation(1, field, 0),
           ShadowViewMutation::CreateMutation(label), ShadowViewMutation::InsertMutation(1, label, 1)});
  auto &calls = f.backend->calls;
  calls.clear();

  folly::dynamic names = folly::dynamic::array("name");
  f.mounting->synchronouslyUpdateViewOnUIThread(4, folly::dynamic::object("accessibilityLabelledBy", names));
  CHECK(std::count(calls.begin(), calls.end(), "relations 4 labelledBy=2 describedBy=") == 1);

  // The view it names takes another id: the relation goes, with no transaction.
  calls.clear();
  f.mounting->synchronouslyUpdateViewOnUIThread(2, folly::dynamic::object("nativeID", "other"));
  CHECK(std::count(calls.begin(), calls.end(), "relations 4 labelledBy= describedBy=") == 1);
}
