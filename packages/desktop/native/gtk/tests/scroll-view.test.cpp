// A ScrollView mounted into GTK: its content in a GtkScrolledWindow's document, moved by the
// scroll commands and the `contentOffset` prop, each move told to the core's hit test. Read from
// the pixels the window draws.
#include "../scroll-view.h"
#include "mounted-views.h"

#include <react/renderer/components/scrollview/ScrollViewState.h>
#include <react/renderer/core/ConcreteState.h>

#include <doctest/doctest.h>

#include <vector>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::bluish;
using ngn::testing::desktopViewProps;
using ngn::testing::MountedViews;
using ngn::testing::reddish;

namespace {

constexpr int64_t kRed = 0xffff0000;
constexpr int64_t kBlue = 0xff0000ff;

Props::Shared scrollProps(dynamic raw) {
  return ngn::testing::parsedProps<ngn::DesktopScrollViewComponentDescriptor>(std::move(raw));
}

// A state with no node family behind it, whose updates go nowhere.
State::Shared scrollState(Size content) {
  return std::make_shared<const ConcreteState<ScrollViewState>>(
      std::make_shared<const ScrollViewState>(Point{}, Rect{{0, 0}, content}, 0), ShadowNodeFamily::Weak{});
}

// The offsets the backend told, for the length of a test.
struct Offsets {
  std::vector<std::pair<Tag, Point>> told;
  Offsets() {
    ngn::gtk::onScrollOffset([this](Tag tag, Point offset) { told.emplace_back(tag, offset); });
  }
  ~Offsets() {
    ngn::gtk::onScrollOffset(nullptr);
  }
  Offsets(const Offsets &) = delete;
  Offsets &operator=(const Offsets &) = delete;
};

// A 100 by 100 scroll view over content 300 high: red at the top, blue at the bottom.
void mountScrollView(MountedViews &views, dynamic props = dynamic::object()) {
  auto scroll = MountedViews::shadow(2, "ScrollView", scrollProps(std::move(props)), {{0, 0}, {100, 100}});
  scroll.state = scrollState({100, 300});
  auto content = MountedViews::shadow(3, "View", desktopViewProps(dynamic::object()), {{0, 0}, {100, 300}});
  auto top = MountedViews::shadow(4, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{0, 0}, {100, 100}});
  auto bottom = MountedViews::shadow(5, "View", desktopViewProps(dynamic::object("backgroundColor", kBlue)), {{0, 200}, {100, 100}});
  views.mount({ShadowViewMutation::CreateMutation(scroll), ShadowViewMutation::InsertMutation(MountedViews::kSurface, scroll, 0),
               ShadowViewMutation::CreateMutation(content), ShadowViewMutation::InsertMutation(2, content, 0),
               ShadowViewMutation::CreateMutation(top), ShadowViewMutation::InsertMutation(3, top, 0),
               ShadowViewMutation::CreateMutation(bottom), ShadowViewMutation::InsertMutation(3, bottom, 1)});
}

} // namespace

TEST_CASE("a ScrollView's content mounts into its scrolled window, and scrollTo and scrollToEnd move it") {
  REQUIRE(ngn::testing::gtkReady());
  Offsets offsets;
  MountedViews views;
  mountScrollView(views);
  auto *data = ngn::gtk::viewData(views.view(2));
  REQUIRE(data->scroll);
  CHECK(gtk_widget_is_ancestor(views.view(4), data->scroll->scrolled));
  CHECK(reddish(views.pixel(50, 50)));

  views.backend->dispatchCommand(2, "scrollTo", dynamic::array(0, 200, false));
  views.settle();
  CHECK(bluish(views.pixel(50, 50)));
  REQUIRE_FALSE(offsets.told.empty());
  CHECK(offsets.told.back().first == 2);
  CHECK(offsets.told.back().second == Point{0, 200});

  views.backend->dispatchCommand(2, "scrollTo", dynamic::array(0, 0, false));
  views.settle();
  CHECK(reddish(views.pixel(50, 50)));

  // To the end: as far as the content goes, and no further.
  views.backend->dispatchCommand(2, "scrollToEnd", dynamic::array(false));
  views.settle();
  CHECK(offsets.told.back().second == Point{0, 200});
  CHECK(bluish(views.pixel(50, 50)));
  views.backend->dispatchCommand(2, "scrollTo", dynamic::array(0, 1000, false));
  views.settle();
  CHECK(offsets.told.back().second == Point{0, 200});
}

TEST_CASE("a ScrollView starts at its contentOffset, and moves when the prop changes") {
  REQUIRE(ngn::testing::gtkReady());
  Offsets offsets;
  MountedViews views;
  mountScrollView(views, dynamic::object("contentOffset", dynamic::object("x", 0)("y", 200)));
  views.settle();
  CHECK(bluish(views.pixel(50, 50)));

  auto scroll = views.mounting->tree().find(2)->view;
  views.update(scroll, scrollProps(dynamic::object("contentOffset", dynamic::object("x", 0)("y", 0))));
  views.settle();
  CHECK(reddish(views.pixel(50, 50)));
  CHECK(offsets.told.back().second == Point{0, 0});
}

TEST_CASE("a ScrollView with scrolling turned off leaves the wheel to GTK's controllers no longer") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  mountScrollView(views);
  auto *box = ngn::gtk::viewData(views.view(2))->scroll;
  REQUIRE_FALSE(box->controllers.empty());
  auto phases = [box] {
    std::vector<GtkPropagationPhase> out;
    for (auto &[controller, phase] : box->controllers) {
      out.push_back(gtk_event_controller_get_propagation_phase(controller));
    }
    return out;
  };
  auto before = phases();
  CHECK(std::any_of(before.begin(), before.end(), [](auto phase) { return phase != GTK_PHASE_NONE; }));

  auto scroll = views.mounting->tree().find(2)->view;
  views.update(scroll, scrollProps(dynamic::object("scrollEnabled", false)));
  for (auto phase : phases()) {
    CHECK(phase == GTK_PHASE_NONE);
  }
  views.update(scroll, scrollProps(dynamic::object("scrollEnabled", true)));
  CHECK(phases() == before);
}

TEST_CASE("classic scroll bars take a gutter from the content, which overlay ones do not") {
  REQUIRE(ngn::testing::gtkReady());
  GtkSettings *settings = gtk_settings_get_default();
  gboolean overlay = TRUE;
  g_object_get(settings, "gtk-overlay-scrolling", &overlay, nullptr);
  struct Restore {
    GtkSettings *settings;
    gboolean overlay;
    ~Restore() {
      g_object_set(settings, "gtk-overlay-scrolling", overlay, nullptr);
    }
  } restore{settings, overlay};

  g_object_set(settings, "gtk-overlay-scrolling", TRUE, nullptr);
  {
    MountedViews views;
    mountScrollView(views);
    CHECK(ngn::ScrollerGutters::shared().get(2).right == 0);
  }
  CHECK(ngn::ScrollerGutters::shared().get(2).right == 0);

  g_object_set(settings, "gtk-overlay-scrolling", FALSE, nullptr);
  {
    MountedViews views;
    mountScrollView(views);
    auto *box = ngn::gtk::viewData(views.view(2))->scroll;
    float width = ngn::gtk::classicScrollerWidth(box->scrolled);
    CHECK(width > 0);
    CHECK(ngn::ScrollerGutters::shared().get(2).right == doctest::Approx(width));
    // No gutter across: the content is no wider than the view.
    CHECK(ngn::ScrollerGutters::shared().get(2).bottom == 0);
  }
  // A scroll view that goes takes its gutter with it.
  CHECK(ngn::ScrollerGutters::shared().get(2).right == 0);
}

// Until a change of scroll bar style has eased in and the gutter has been measured again.
void settleScrollers(MountedViews &views, ngn::gtk::ScrollBox *box) {
  ngn::testing::runUntil([&views, box] {
    views.settle();
    return box->remeasure == 0;
  });
}

TEST_CASE("a scroll view's gutter follows the desktop switching scroll bars, and thin ones take less") {
  REQUIRE(ngn::testing::gtkReady());
  GtkSettings *settings = gtk_settings_get_default();
  gboolean overlay = TRUE;
  g_object_get(settings, "gtk-overlay-scrolling", &overlay, nullptr);
  struct Restore {
    GtkSettings *settings;
    gboolean overlay;
    ~Restore() {
      g_object_set(settings, "gtk-overlay-scrolling", overlay, nullptr);
    }
  } restore{settings, overlay};

  g_object_set(settings, "gtk-overlay-scrolling", TRUE, nullptr);
  MountedViews views;
  mountScrollView(views);
  CHECK(ngn::ScrollerGutters::shared().get(2).right == 0);
  auto *box = ngn::gtk::viewData(views.view(2))->scroll;

  // Classic scroll bars while the view is up: it takes their gutter, with no change of its own.
  g_object_set(settings, "gtk-overlay-scrolling", FALSE, nullptr);
  settleScrollers(views, box);
  float regular = ngn::gtk::classicScrollerWidth(box->scrolled);
  CHECK(regular > 0);
  CHECK(ngn::ScrollerGutters::shared().get(2).right == doctest::Approx(regular));

  // scrollbar-width: thin narrows the bar and its gutter; auto widens them again.
  ngn::DesktopProps thin;
  thin.scrollbarWidth = ngn::ScrollbarWidth::Thin;
  views.backend->updateDesktopProps(MountedViews::kSurface, 2, thin);
  settleScrollers(views, box);
  CHECK(gtk_widget_has_css_class(box->scrolled, "ngn-thin-scrollbars"));
  float narrow = ngn::gtk::classicScrollerWidth(box->scrolled);
  CHECK(narrow > 0);
  CHECK(narrow < regular);
  CHECK(ngn::ScrollerGutters::shared().get(2).right == doctest::Approx(narrow));
  views.backend->updateDesktopProps(MountedViews::kSurface, 2, ngn::DesktopProps{});
  settleScrollers(views, box);
  CHECK_FALSE(gtk_widget_has_css_class(box->scrolled, "ngn-thin-scrollbars"));
  CHECK(ngn::ScrollerGutters::shared().get(2).right == doctest::Approx(regular));

  // Overlay again: no gutter.
  g_object_set(settings, "gtk-overlay-scrolling", TRUE, nullptr);
  views.settle();
  CHECK(ngn::ScrollerGutters::shared().get(2).right == 0);
}

TEST_CASE("a thin scroll view mounted under classic scroll bars takes the narrow gutter from the start") {
  REQUIRE(ngn::testing::gtkReady());
  GtkSettings *settings = gtk_settings_get_default();
  gboolean overlay = TRUE;
  g_object_get(settings, "gtk-overlay-scrolling", &overlay, nullptr);
  struct Restore {
    GtkSettings *settings;
    gboolean overlay;
    ~Restore() {
      g_object_set(settings, "gtk-overlay-scrolling", overlay, nullptr);
    }
  } restore{settings, overlay};
  g_object_set(settings, "gtk-overlay-scrolling", FALSE, nullptr);

  MountedViews views;
  auto scroll = MountedViews::shadow(2, "ScrollView", scrollProps(dynamic::object()), {{0, 0}, {100, 100}});
  scroll.state = scrollState({100, 300});
  views.mount({ShadowViewMutation::CreateMutation(scroll)});
  ngn::DesktopProps thin;
  thin.scrollbarWidth = ngn::ScrollbarWidth::Thin;
  views.backend->updateDesktopProps(MountedViews::kSurface, 2, thin);
  views.mount({ShadowViewMutation::InsertMutation(MountedViews::kSurface, scroll, 0)});
  auto *box = ngn::gtk::viewData(views.view(2))->scroll;
  settleScrollers(views, box);
  float narrow = ngn::gtk::classicScrollerWidth(box->scrolled);
  CHECK(narrow > 0);
  CHECK(ngn::ScrollerGutters::shared().get(2).right == doctest::Approx(narrow));
}
