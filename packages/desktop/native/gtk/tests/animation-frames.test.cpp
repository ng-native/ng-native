// The animation frames on GTK (animation-frames.h): what react-native-worklets' requestAnimationFrame
// and Reanimated's frames run on. A shown window's frame clock drives them while they are wanted,
// stamped on the clock `now` reads; a timer drives them while no window is shown; and none run once
// nothing waits.
#include "mounted-views.h"

#include "../animation-frames.h"

#include "ngn/worklet-host.h"

#include <doctest/doctest.h>

#include <memory>
#include <vector>

using ngn::testing::MountedViews;
using ngn::testing::runUntil;

namespace {

// The worklet host installed over a backend for the test, and put back as it was after.
struct InstalledHost {
  ngn::WorkletHost &host = ngn::workletHost();
  decltype(ngn::WorkletHost::runOnUiThread) runOnUiThread = host.runOnUiThread;
  decltype(ngn::WorkletHost::isUiThread) isUiThread = host.isUiThread;
  decltype(ngn::WorkletHost::now) now = host.now;
  decltype(ngn::AnimationFrames::onWanted) onWanted = host.frames.onWanted;
  decltype(ngn::WorkletHost::synchronouslyUpdateView) synchronouslyUpdateView = host.synchronouslyUpdateView;
  decltype(ngn::WorkletHost::readMountedProps) readMountedProps = host.readMountedProps;

  InstalledHost(std::shared_ptr<ngn::MountingManager> mounting, std::shared_ptr<ngn::gtk::GtkBackend> backend) {
    ngn::gtk::installWorkletHost(std::move(mounting), std::move(backend));
  }
  ~InstalledHost() {
    host.frames.clear();
    ngn::gtk::updateAnimationFrames();
    host.runOnUiThread = runOnUiThread;
    host.isUiThread = isUiThread;
    host.now = now;
    host.frames.onWanted = onWanted;
    host.synchronouslyUpdateView = synchronouslyUpdateView;
    host.readMountedProps = readMountedProps;
  }
  InstalledHost(const InstalledHost &) = delete;
  InstalledHost &operator=(const InstalledHost &) = delete;
};

// Requests `count` frames one after another, each from the one before as an animation does, and
// keeps their timestamps.
std::shared_ptr<std::vector<double>> animate(int count) {
  auto stamps = std::make_shared<std::vector<double>>();
  auto next = std::make_shared<std::function<void(double)>>();
  *next = [stamps, next, count](double ms) {
    stamps->push_back(ms);
    if (static_cast<int>(stamps->size()) < count) {
      ngn::workletHost().frames.request(*next);
    } else {
      *next = nullptr;
    }
  };
  ngn::workletHost().frames.request(*next);
  return stamps;
}

// Runs GLib's loop for `ms` milliseconds.
void runFor(int ms) {
  gint64 until = g_get_monotonic_time() + ms * 1000;
  runUntil([until] { return g_get_monotonic_time() >= until; });
}

} // namespace

TEST_CASE("a shown window's frame clock runs the animation frames, on the clock now reads, until none waits") {
  if (!ngn::testing::gtkReady()) {
    return;
  }
  MountedViews views;
  InstalledHost installed(views.mounting, views.backend);
  auto &host = ngn::workletHost();

  double before = host.now();
  auto stamps = animate(3);
  runUntil([&] { return stamps->size() == 3; });
  CHECK(stamps->front() >= before - 100);
  CHECK(stamps->back() <= host.now() + 100);
  CHECK(stamps->at(1) > stamps->at(0));
  CHECK(stamps->at(2) > stamps->at(1));
  CHECK_FALSE(host.frames.wanted());

  // Nothing waits: no frame runs, and a later request starts them again.
  runFor(100);
  CHECK(stamps->size() == 3);
  auto again = animate(1);
  runUntil([&] { return again->size() == 1; });
}

TEST_CASE("the animation frames run with no window shown, and go on as the window driving them hides") {
  if (!ngn::testing::gtkReady()) {
    return;
  }
  MountedViews views;
  InstalledHost installed(views.mounting, views.backend);

  // Hidden mid-animation: the window's frame clock stops, and the frames do not.
  auto stamps = animate(1000);
  runUntil([&] { return stamps->size() >= 2; });
  gtk_widget_set_visible(views.window, FALSE);
  size_t hidden = stamps->size();
  runUntil([&] { return stamps->size() >= hidden + 3; });

  // Shown again: its frame clock takes them back.
  gtk_widget_set_visible(views.window, TRUE);
  runUntil([&] { return gtk_widget_get_mapped(views.window); });
  size_t shown = stamps->size();
  runUntil([&] { return stamps->size() >= shown + 3; });
}

TEST_CASE("clearing the animation frames between frames stops them") {
  if (!ngn::testing::gtkReady()) {
    return;
  }
  MountedViews views;
  InstalledHost installed(views.mounting, views.backend);
  auto &host = ngn::workletHost();

  auto stamps = animate(1000);
  runUntil([&] { return stamps->size() >= 2; });
  host.frames.clear();
  runFor(20);
  size_t cleared = stamps->size();
  runFor(150);
  CHECK(stamps->size() == cleared);
}
