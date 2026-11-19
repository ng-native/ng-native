// Views mounted into GTK: Yoga's frames and transforms reach the widgets, and each view paints its
// box as GSK nodes, in Fabric's order, cut to its shape when it clips. Read from the pixels the
// window's renderer draws.
#include "mounted-views.h"

#include "../app-windows.h"

#include "ngn/view-transform.h"

#include <doctest/doctest.h>

#include <atomic>
#include <thread>

using namespace facebook::react;
using folly::dynamic;
using ngn::testing::bluish;
using ngn::testing::desktopViewProps;
using ngn::testing::greenish;
using ngn::testing::MountedViews;
using ngn::testing::reddish;

namespace {

constexpr int64_t kRed = 0xffff0000;
constexpr int64_t kGreen = 0xff00ff00;
constexpr int64_t kBlue = 0xff0000ff;

graphene_rect_t boundsIn(GtkWidget *widget, GtkWidget *ancestor) {
  graphene_rect_t bounds;
  REQUIRE(gtk_widget_compute_bounds(widget, ancestor, &bounds));
  return bounds;
}

} // namespace

TEST_CASE("a view's widget is placed at its Yoga frame, and moves when the frame does") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto box = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object()), {{10, 20}, {100, 50}});
  views.add(box);
  auto bounds = boundsIn(views.view(2), views.surface);
  CHECK(bounds.origin.x == doctest::Approx(10));
  CHECK(bounds.origin.y == doctest::Approx(20));
  CHECK(bounds.size.width == doctest::Approx(100));
  CHECK(bounds.size.height == doctest::Approx(50));

  auto moved = views.mounting->tree().find(2)->view;
  auto next = moved;
  next.layoutMetrics.frame = {{30, 40}, {60, 30}};
  views.mount({ShadowViewMutation::UpdateMutation(moved, next, MountedViews::kSurface)});
  bounds = boundsIn(views.view(2), views.surface);
  CHECK(bounds.origin.x == doctest::Approx(30));
  CHECK(bounds.origin.y == doctest::Approx(40));
  CHECK(bounds.size.width == doctest::Approx(60));
}

TEST_CASE("a transform moves and scales the view about its centre, as React Native's does") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto transform = dynamic::array(dynamic::object("translateX", 15), dynamic::object("scale", 2));
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("transform", transform)), {{40, 40}, {20, 20}}));
  auto bounds = boundsIn(views.view(2), views.surface);
  // Scaled twice about its centre (50, 50) and moved right by 15.
  CHECK(bounds.origin.x == doctest::Approx(45));
  CHECK(bounds.origin.y == doctest::Approx(30));
  CHECK(bounds.size.width == doctest::Approx(40));
}

TEST_CASE("a moved, turned or skewed view draws its own paint and children through a 2D-only renderer") {
  REQUIRE(ngn::testing::gtkReady());
  // The pixels come from GSK's cairo renderer, which draws a 3D matrix as a pink box.
  for (const char *name : {"translateX", "rotate", "skewX"}) {
    CAPTURE(name);
    dynamic step = dynamic::object(name, std::string(name) == "translateX" ? dynamic(30) : dynamic(std::string(name) == "rotate" ? "30deg" : "15deg"));
    MountedViews views(false, 200, 200);
    dynamic props = dynamic::object("backgroundColor", kRed)("borderRadius", 10)("transform", dynamic::array(step));
    auto box = MountedViews::shadow(2, "View", desktopViewProps(props), {{40, 40}, {80, 60}});
    auto inner = MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kBlue)), {{30, 20}, {20, 20}});
    views.mount({ShadowViewMutation::CreateMutation(box), ShadowViewMutation::CreateMutation(inner),
                 ShadowViewMutation::InsertMutation(MountedViews::kSurface, box, 0), ShadowViewMutation::InsertMutation(2, inner, 0)});
    graphene_point_t centre{40, 30}, at{};
    REQUIRE(gtk_widget_compute_point(views.view(2), views.surface, &centre, &at));
    CHECK(bluish(views.pixel(static_cast<int>(at.x), static_cast<int>(at.y))));
    graphene_point_t paint{8, 30};
    REQUIRE(gtk_widget_compute_point(views.view(2), views.surface, &paint, &at));
    CHECK(reddish(views.pixel(static_cast<int>(at.x), static_cast<int>(at.y))));
    // Each corner where the full matrix puts it.
    const auto *d = ngn::gtk::viewData(views.view(2));
    auto layer = ngn::layerTransform(*std::static_pointer_cast<const ViewProps>(d->props), d->layout);
    REQUIRE(layer);
    for (graphene_point_t corner : {graphene_point_t{0, 0}, graphene_point_t{80, 0}, graphene_point_t{0, 60}, graphene_point_t{80, 60}}) {
      REQUIRE(gtk_widget_compute_point(views.view(2), views.surface, &corner, &at));
      const auto &m = layer->matrix;
      CHECK(at.x == doctest::Approx(40 + corner.x * m[0] + corner.y * m[4] + m[12]).epsilon(1e-3));
      CHECK(at.y == doctest::Approx(40 + corner.x * m[1] + corner.y * m[5] + m[13]).epsilon(1e-3));
    }
  }
}

TEST_CASE("a view paints its background in its rounded shape and its border along its edge") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("backgroundColor", kRed)("borderWidth", 4)("borderColor", kBlue)("borderRadius", 20);
  views.add(MountedViews::shadow(2, "View", desktopViewProps(props), {{20, 20}, {100, 100}}));
  CHECK(reddish(views.pixel(70, 70)));
  CHECK(bluish(views.pixel(70, 21)));
  CHECK(bluish(views.pixel(21, 70)));
  // The corner outside the radius is not painted.
  CHECK(views.pixel(21, 21).a < 40);
  // Outside the view, nothing.
  CHECK(views.pixel(10, 10).a == 0);
}

TEST_CASE("each side of the border takes its own width and colour") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  dynamic props = dynamic::object("borderLeftWidth", 10)("borderLeftColor", kGreen)("borderTopWidth", 2)("borderTopColor", kBlue);
  views.add(MountedViews::shadow(2, "View", desktopViewProps(props), {{20, 20}, {100, 100}}));
  CHECK(greenish(views.pixel(25, 70)));
  CHECK(bluish(views.pixel(70, 20)));
  CHECK(views.pixel(70, 70).a == 0);
  CHECK(views.pixel(118, 70).a == 0);
}

TEST_CASE("an outer box shadow paints outside the box, an inset one inside it") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto outer = dynamic::array(dynamic::object("offsetX", 10)("offsetY", 0)("blurRadius", 0)("spreadDistance", 0)("color", kBlue));
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("boxShadow", outer)("backgroundColor", kRed)), {{20, 20}, {50, 50}}));
  CHECK(bluish(views.pixel(75, 45)));
  CHECK(reddish(views.pixel(45, 45)));

  auto inset = dynamic::array(dynamic::object("offsetX", 0)("offsetY", 0)("blurRadius", 0)("spreadDistance", 8)("color", kGreen)("inset", true));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("boxShadow", inset)("backgroundColor", kRed)), {{100, 100}, {60, 60}}));
  CHECK(greenish(views.pixel(103, 130)));
  CHECK(reddish(views.pixel(130, 130)));
}

TEST_CASE("a view that clips its overflow cuts its children to its shape, and one that does not shows them") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto parent = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("overflow", "hidden")), {{20, 20}, {50, 50}});
  views.add(parent);
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{0, 0}, {120, 120}}), 2);
  CHECK(reddish(views.pixel(40, 40)));
  CHECK(views.pixel(100, 100).a == 0);

  views.update(parent, desktopViewProps(dynamic::object("overflow", "visible")));
  CHECK(reddish(views.pixel(100, 100)));
}

TEST_CASE("views draw in Fabric's order: a later sibling over an earlier one, an insert at 0 under both") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{20, 20}, {60, 60}}));
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kBlue)), {{40, 40}, {60, 60}}));
  CHECK(bluish(views.pixel(60, 60)));
  views.add(MountedViews::shadow(4, "View", desktopViewProps(dynamic::object("backgroundColor", kGreen)), {{0, 0}, {120, 120}}), MountedViews::kSurface, 0);
  CHECK(bluish(views.pixel(60, 60)));
  CHECK(reddish(views.pixel(30, 30)));
  CHECK(greenish(views.pixel(110, 110)));
}

TEST_CASE("opacity fades the view and its children") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)("opacity", 0.5)), {{20, 20}, {60, 60}}));
  auto p = views.pixel(50, 50);
  CHECK(p.a > 100);
  CHECK(p.a < 160);
}

TEST_CASE("a covered screen is hidden without being unmounted, and shows again") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  views.add(MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{20, 20}, {60, 60}}));
  // Something else stays on screen, so the surface still draws.
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kGreen)), {{150, 150}, {20, 20}}));
  views.backend->setCovered(MountedViews::kSurface, 2, true);
  views.settle();
  CHECK(views.pixel(50, 50).a == 0);
  views.backend->setCovered(MountedViews::kSurface, 2, false);
  views.settle();
  CHECK(reddish(views.pixel(50, 50)));
}

TEST_CASE("a covered screen stays hidden when it is moved, or removed and inserted again") {
  REQUIRE(ngn::testing::gtkReady());
  MountedViews views;
  auto screen = MountedViews::shadow(2, "View", desktopViewProps(dynamic::object("backgroundColor", kRed)), {{20, 20}, {60, 60}});
  views.add(screen);
  views.add(MountedViews::shadow(3, "View", desktopViewProps(dynamic::object("backgroundColor", kGreen)), {{150, 150}, {20, 20}}));
  views.backend->setCovered(MountedViews::kSurface, 2, true);
  // Moved while it has a parent: insertChild takes it out itself.
  views.backend->insertChild(MountedViews::kSurface, MountedViews::kSurface, 2, 1);
  CHECK_FALSE(gtk_widget_get_child_visible(views.view(2)));
  views.mount({ShadowViewMutation::RemoveMutation(MountedViews::kSurface, screen, 0), ShadowViewMutation::InsertMutation(MountedViews::kSurface, screen, 1)});
  CHECK_FALSE(gtk_widget_get_child_visible(views.view(2)));
  CHECK(views.pixel(50, 50).a == 0);
}

TEST_CASE("work queued for the UI thread runs on it, never on the thread that queued it") {
  REQUIRE(ngn::testing::gtkReady());
  std::atomic<bool> ran{false};
  std::thread::id ranOn;
  // Nothing iterates the default context while the worker queues: it could take it and run there.
  std::thread worker([&] {
    ngn::gtk::onMainContext([&] {
      ranOn = std::this_thread::get_id();
      ran = true;
    });
  });
  worker.join();
  ngn::testing::runUntil([&] { return ran.load(); });
  CHECK(ranOn == std::this_thread::get_id());
}

namespace {

// GtkWindows over an application of its own, which outlives them.
struct AppWindows {
  GtkApplication *app;
  ngn::gtk::GtkWindows windows;
  AppWindows(const char *id, ngn::gtk::GtkWindows::Hooks hooks)
      : app(ngn::gtk::startApplication(id)), windows(std::move(hooks), app, ngn::MenuPlacement::PrimaryMenu) {}
  ~AppWindows() {
    g_object_unref(app);
  }
};

} // namespace

TEST_CASE("a window's surface takes its fractional scale, and hears a change of scale, which resizes nothing") {
  REQUIRE(ngn::testing::gtkReady());
  int resized = 0;
  double started = 0, scale = 0;
  std::vector<GtkWidget *> rescaled;
  AppWindows w("dev.ngnative.ScaleTest", {.startSurface = [&](SurfaceId, int, int, double s) { started = s; },
                                          .resizeSurface =
                                              [&](SurfaceId, int, int, double s) {
                                                resized++;
                                                scale = s;
                                              },
                                          .rescaled = [&](GtkWidget *window) { rescaled.push_back(window); }});
  auto &windows = w.windows;
  windows.openWindow(12, ngn::WindowRequest{.title = "Scaled"}, ngn::WindowPlacement{}, nullptr);
  ngn::testing::runUntil([&] { return windows.window(12) != nullptr; });
  GtkWidget *window = windows.window(12);
  GdkSurface *surface = gtk_native_get_surface(GTK_NATIVE(window));
  // Under a compositor at a fractional scale (NGN_TEST_SCALE: 1.25 under headless mutter), the
  // surface starts at it before the window shows, when GDK still rounds it up, and keeps it once it
  // shows; elsewhere, the whole number.
  const char *want = g_getenv("NGN_TEST_SCALE");
  CHECK(started == doctest::Approx(want ? std::stod(want) : gtk_widget_get_scale_factor(window)));
  windows.didMount(12);
  ngn::testing::runUntil([&] { return gtk_widget_get_mapped(window); });
  // GDK's own scale: the surface's `scale` from GTK 4.12, the whole-number factor below it.
  bool fractional = g_object_class_find_property(G_OBJECT_GET_CLASS(surface), "scale") != nullptr;
  double gdkScale = gtk_widget_get_scale_factor(window);
  if (fractional) {
    ngn::testing::runUntil([&] {
      g_object_get(surface, "scale", &gdkScale, nullptr);
      return !want || gdkScale == doctest::Approx(std::stod(want));
    });
  }
  if (want) {
    MESSAGE("started at " << started << ", GDK says " << gdkScale << " shown, gtk_widget_get_scale_factor " << gtk_widget_get_scale_factor(window));
  }
  rescaled.clear();

  int before = resized;
  // As GDK notifies when the window moves to a monitor of another scale, or the scale changes.
  g_object_notify(G_OBJECT(surface), fractional ? "scale" : "scale-factor");
  CHECK(resized == before + 1);
  CHECK(scale == gdkScale);
  CHECK(rescaled == std::vector<GtkWidget *>{window});
}

TEST_CASE("the user closing the last window is the host's to act on; the app or a reload closing it is not") {
  REQUIRE(ngn::testing::gtkReady());
  int quits = 0, lastClosed = 0;
  AppWindows w("dev.ngnative.LastWindowTest", {.quit = [&] { quits++; }, .lastWindowClosed = [&] { lastClosed++; }});
  auto &windows = w.windows;
  windows.openWindow(10, ngn::WindowRequest{.title = "First"}, ngn::WindowPlacement{}, nullptr);
  ngn::testing::runUntil([&] { return windows.window(10) != nullptr; });
  // As WindowHost::reloading closes an unkeyed window.
  windows.closeWindow(10);
  ngn::testing::runUntil([&] { return windows.window(10) == nullptr; });
  CHECK(lastClosed == 0);
  CHECK(quits == 0);

  windows.openWindow(11, ngn::WindowRequest{.title = "Second"}, ngn::WindowPlacement{}, nullptr);
  ngn::testing::runUntil([&] { return windows.window(11) != nullptr; });
  gtk_window_close(GTK_WINDOW(windows.window(11)));
  ngn::testing::runUntil([&] { return windows.window(11) == nullptr; });
  CHECK(lastClosed == 1);
  CHECK(quits == 0);
}
