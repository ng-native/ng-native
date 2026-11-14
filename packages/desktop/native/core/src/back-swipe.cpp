#include "ngn/back-swipe.h"

#include <algorithm>

namespace ngn {

bool BackSwipe::begin(std::optional<BackSwipeTarget> target, double width) {
  if (phase_ != Phase::Idle || !target || width <= 0) {
    return false;
  }
  phase_ = Phase::Tracking;
  target_ = target;
  width_ = width;
  offset_ = 0;
  lastMove_ = 0;
  return true;
}

BackSwipeFrame BackSwipe::frameAt(double progress, bool belowShown) const {
  progress = std::clamp(progress, 0.0, 1.0);
  if (target_ && target_->style == SwipeStyle::Fade) {
    return {.offset = 0, .opacity = 1 - progress, .belowShown = belowShown};
  }
  return {.offset = progress * width_, .opacity = 1, .belowShown = belowShown};
}

BackSwipeFrame BackSwipe::moved(double dx) {
  if (phase_ != Phase::Tracking) {
    return rest();
  }
  // The screen stops at its home edge: a move away from back past it does not drag it left.
  offset_ = std::clamp(offset_ + dx, 0.0, width_);
  lastMove_ = dx;
  return frameAt(offset_ / width_, offset_ > 0);
}

bool BackSwipe::lifted(bool cancelled) {
  if (phase_ != Phase::Tracking) {
    return false;
  }
  double progress = offset_ / width_;
  bool back = !cancelled && (progress >= 1.0 / 3 || (lastMove_ >= kFlick && progress >= 0.1));
  phase_ = back ? Phase::Leaving : Phase::Returning;
  return back;
}

BackSwipeFrame BackSwipe::settled() const {
  switch (phase_) {
    case Phase::Leaving:
      return frameAt(1, true);
    case Phase::Returning:
      return frameAt(0, true);
    default:
      return rest();
  }
}

void BackSwipe::returned() {
  if (phase_ == Phase::Returning) {
    abandon();
  }
}

bool BackSwipe::mounted(Tag stackTop) {
  if (phase_ != Phase::Leaving || !target_ || stackTop == target_->top) {
    return false;
  }
  abandon();
  return true;
}

void BackSwipe::abandon() {
  phase_ = Phase::Idle;
  target_.reset();
  offset_ = 0;
  lastMove_ = 0;
}

bool BackSwipe::fingersDown() {
  if (phase_ != Phase::Tracking) {
    return false;
  }
  abandon();
  return true;
}

SwipeBounds swipeBounds(bool canGoBack, bool canGoForward) {
  return {.min = canGoForward ? -1.0 : 0.0, .max = canGoBack ? 1.0 : 0.0};
}

} // namespace ngn
