// The size a presented modal sends its state (modal-host-view.mm): the cover's, sent again only
// when the state holds another, so the state that sending commits does not send it once more.
#import "../../modal-host-view.h"

#include "mounted-views.h"

#include <react/renderer/components/modal/ModalHostViewState.h>
#include <react/renderer/core/ConcreteState.h>

#include <doctest/doctest.h>

#include <objc/runtime.h>

#include <vector>

using namespace facebook::react;
using ngn::testing::MountedViews;
using ngn::testing::viewProps;
using RNSize = facebook::react::Size;

namespace {

State::Shared modalState(RNSize size) {
  return std::make_shared<const ConcreteState<ModalHostViewState>>(
      std::make_shared<const ModalHostViewState>(size), ShadowNodeFamily::Weak{});
}

// Every size a modal sends its state while it lives.
struct SentSizes {
  std::vector<NSSize> sent;
  Method method = class_getInstanceMethod(NGNModalHostView.class, @selector(applyPresentedSize:));
  IMP original = method_getImplementation(method);

  SentSizes() {
    auto *list = &sent;
    IMP forward = original;
    method_setImplementation(method, imp_implementationWithBlock(^(NGNModalHostView *view, NSSize size) {
                               list->push_back(size);
                               reinterpret_cast<void (*)(id, SEL, NSSize)>(forward)(view, @selector(applyPresentedSize:), size);
                             }));
  }
  ~SentSizes() {
    method_setImplementation(method, original);
  }
  SentSizes(const SentSizes &) = delete;
  SentSizes &operator=(const SentSizes &) = delete;
};

} // namespace

TEST_CASE("A presented modal does not send its state the size that state already holds") {
  MountedViews mounted;
  struct Restore {
    ngn::InputSink *modal = NGNModalHostView.input;
    ~Restore() {
      NGNModalHostView.input = modal;
    }
  } restore;
  NGNModalHostView.input = &mounted.input;
  SentSizes sizes;
  // Wider than tall, so a size with its sides swapped is another size.
  [mounted.window setContentSize:NSMakeSize(480, 320)];
  auto modal = MountedViews::shadow(5, "ModalHostView", viewProps(folly::dynamic::object()));
  modal.state = modalState({0, 0});
  mounted.add(modal);
  auto *view = (NGNModalHostView *)mounted.view(5);
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
  while (sizes.sent.empty() && deadline.timeIntervalSinceNow > 0) {
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
  REQUIRE(sizes.sent.size() == 1);
  NSSize cover = sizes.sent[0];
  CHECK(cover.width > 0);

  // The state that send commits comes back holding the cover's size.
  RNSize held{static_cast<Float>(cover.width), static_cast<Float>(cover.height)};
  [view updateState:modalState(held)];
  [view updateState:modalState(held)];
  CHECK(sizes.sent.size() == 1);

  // A state holding another size, such as a new node's, is sent the cover's.
  [view updateState:modalState({0, 0})];
  REQUIRE(sizes.sent.size() == 2);
  CHECK(NSEqualSizes(sizes.sent[1], cover));
  CHECK(NSEqualSizes(view.frame.size, cover));

  // A cover a float holds only roughly: the state comes back with the float, which is still the
  // size that was sent.
  [view.superview setFrameSize:NSMakeSize(300.3, 200.7)];
  REQUIRE(sizes.sent.size() == 3);
  CHECK(NSEqualSizes(sizes.sent[2], NSMakeSize(300.3, 200.7)));
  // Laid out again at that size before the state comes back: nothing new to send.
  [view.superview setFrameSize:NSMakeSize(300.3, 200.7)];
  CHECK(sizes.sent.size() == 3);
  [view updateState:modalState({static_cast<Float>(300.3), static_cast<Float>(200.7)})];
  CHECK(sizes.sent.size() == 3);
}
