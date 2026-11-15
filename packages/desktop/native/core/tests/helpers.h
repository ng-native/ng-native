// Builders shared by the core tests.
#pragma once

#include "ngn/file-system.h"

#include <folly/dynamic.h>

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/mounting/ShadowView.h>

#include <atomic>
#include <chrono>
#include <memory>
#include <thread>

namespace ngn::testing {

// Whether dropping a listener's handle waits for a call to it already running on another thread,
// so a module a reload destroys is never called after. `listen` adds the listener and answers its
// handle; `send` makes the host call it.
template <typename Listen, typename Send>
bool dropWaitsForRunningCall(Listen listen, Send send) {
  std::atomic<bool> running{false};
  std::atomic<bool> finished{false};
  std::shared_ptr<void> handle = listen([&](const folly::dynamic &) {
    running = true;
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    finished = true;
  });
  std::thread sender(send);
  while (!running) {
    std::this_thread::yield();
  }
  handle.reset();
  bool waited = finished;
  sender.join();
  return waited;
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
