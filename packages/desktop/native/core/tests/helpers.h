// Builders shared by the core tests.
#pragma once

#include "ngn/file-system.h"

#include <folly/dynamic.h>

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/mounting/ShadowView.h>

#include <atomic>
#include <chrono>
#include <memory>
#include <stdexcept>
#include <thread>

namespace ngn::testing {

// Whether dropping a listener's handle waits for a call to it already running on another thread,
// so a module a reload destroys is never called after. `listen` adds the listener and answers its
// handle; `send` makes the host call it. The call is held until the drop has had time to finish,
// and the answer is whether the drop finished only once the call was let go. A call that never
// comes answers false rather than hanging, and a held call that gives up at `deadline` throws.
template <typename Listen, typename Send>
bool dropWaitsForRunningCall(Listen listen, Send send, std::chrono::milliseconds deadline = std::chrono::seconds(10)) {
  using Clock = std::chrono::steady_clock;
  auto waitFor = [](const std::atomic<bool> &flag, Clock::duration limit) {
    auto until = Clock::now() + limit;
    while (!flag && Clock::now() < until) {
      std::this_thread::yield();
    }
    return flag.load();
  };
  std::atomic<bool> running{false};
  std::atomic<bool> release{false};
  std::atomic<bool> dropping{false};
  std::atomic<bool> dropped{false};
  std::atomic<bool> gaveUp{false};
  std::shared_ptr<void> handle = listen([&](const auto &) {
    running = true;
    if (!waitFor(release, deadline)) {
      gaveUp = true;
    }
  });
  std::thread sender(send);
  if (!waitFor(running, deadline)) {
    sender.join();
    return false;
  }
  std::thread dropper([&] {
    dropping = true;
    handle.reset();
    dropped = true;
  });
  // The time allowed starts once the dropper is dropping, so one slow to start cannot pass for a
  // drop that waits. A drop that does not wait finishes at once; one that waits is still held when
  // this gives up.
  waitFor(dropping, deadline);
  bool droppedWhileRunning = waitFor(dropped, std::chrono::milliseconds(200));
  release = true;
  dropper.join();
  sender.join();
  // A held call that gave up before the drop was measured lets even a drop that waits finish, so
  // the answer would say nothing about the handle.
  if (gaveUp) {
    throw std::runtime_error("dropWaitsForRunningCall: the held call gave up before the drop was measured");
  }
  return !droppedWhileRunning;
}

inline facebook::react::ShadowView shadowView(
    facebook::react::Tag tag,
    const char *componentName,
    facebook::react::Rect frame,
    facebook::react::Props::Shared props = std::make_shared<const facebook::react::ViewProps>()) {
  facebook::react::ShadowView view;
  view.tag = tag;
  view.surfaceId = 1;
  view.componentName = componentName;
  view.layoutMetrics.frame = frame;
  view.props = std::move(props);
  return view;
}

// ViewProps with some fields set, for the hit test and hover tests.
inline std::shared_ptr<const facebook::react::ViewProps> viewProps(
    facebook::react::PointerEventsMode pointerEvents = facebook::react::PointerEventsMode::Auto,
    bool hover = false) {
  auto props = std::make_shared<facebook::react::ViewProps>();
  props->pointerEvents = pointerEvents;
  if (hover) {
    props->events[facebook::react::ViewEvents::Offset::PointerEnter] = true;
    props->events[facebook::react::ViewEvents::Offset::PointerLeave] = true;
  }
  return props;
}

// File access that lets a module read any path (capabilities.paths declaring `/`), for the tests
// of what a module does with a file rather than whether it may read it.
inline std::shared_ptr<ngn::FileAccess> readsEverywhere() {
  return std::make_shared<ngn::FileAccess>(
      ngn::FileAccess::Folders{}, folly::dynamic::array(folly::dynamic::object("path", "/")("access", "read")));
}

// The views' file access (ngn::viewFileAccess) set for a test, and the one before put back however
// the test ends.
struct ViewFileAccess {
  std::shared_ptr<ngn::FileAccess> before = ngn::viewFileAccess();
  explicit ViewFileAccess(std::shared_ptr<ngn::FileAccess> access) {
    ngn::useViewFileAccess(std::move(access));
  }
  ViewFileAccess(const ViewFileAccess &) = delete;
  ViewFileAccess &operator=(const ViewFileAccess &) = delete;
  ~ViewFileAccess() {
    ngn::useViewFileAccess(before);
  }
};

} // namespace ngn::testing
