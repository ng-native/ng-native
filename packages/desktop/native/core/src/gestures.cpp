#include "ngn/gestures.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace ngn {

namespace {

constexpr double kMax = std::numeric_limits<double>::max();
constexpr double kMin = std::numeric_limits<double>::lowest();
// How far a mouse drags before a pan with no criteria of its own activates: UIKit's own pan
// hysteresis, which the library's iOS pan keeps when it is given no minDist.
constexpr double kDefaultSlop = 10;
// The library's MouseButton bits.
constexpr int kLeft = 1;
constexpr int kRight = 2;
constexpr int kMiddle = 4;
// `PointerType.MOUSE`.
constexpr int kMouse = 2;
// How far back the velocity looks.
constexpr double kVelocityWindowMs = 100;

std::optional<double> number(const folly::dynamic &config, const char *key) {
  if (!config.isObject()) {
    return std::nullopt;
  }
  auto it = config.find(key);
  if (it == config.items().end() || !it->second.isNumber()) {
    return std::nullopt;
  }
  return it->second.asDouble();
}

std::optional<bool> flag(const folly::dynamic &config, const char *key) {
  if (!config.isObject()) {
    return std::nullopt;
  }
  auto it = config.find(key);
  if (it == config.items().end() || !it->second.isBool()) {
    return std::nullopt;
  }
  return it->second.asBool();
}

std::vector<int> tags(const folly::dynamic &relations, const char *key) {
  std::vector<int> out;
  if (!relations.isObject()) {
    return out;
  }
  auto it = relations.find(key);
  if (it == relations.items().end() || !it->second.isArray()) {
    return out;
  }
  for (const auto &tag : it->second) {
    if (tag.isNumber()) {
      out.push_back(static_cast<int>(tag.asDouble()));
    }
  }
  return out;
}

bool contains(const std::vector<int> &list, int tag) {
  return std::find(list.begin(), list.end(), tag) != list.end();
}

// --- the handlers ---------------------------------------------------------------------------------

class PanHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  void pointerDown(const GesturePointer &pointer) override {
    if (!buttonAllowed(pointer.button)) {
      return;
    }
    track(pointer);
    GestureHandler::pointerDown(pointer);
    last_ = average();
    start_ = last_;
    tryBegin();
    checkBegan();
  }

  void pointerMove(const GesturePointer &pointer, bool inBounds) override {
    if (!inBounds && shouldCancelWhenOutside_) {
      return;
    }
    track(pointer);
    last_ = average();
    velocity_ = velocity();
    checkBegan();
    GestureHandler::pointerMove(pointer, inBounds);
  }

  void pointerUp(const GesturePointer &pointer) override {
    GestureHandler::pointerUp(pointer);
    if (state() == GestureState::Active) {
      last_ = average();
    }
    untrack(pointer.id);
    if (pointers_.empty()) {
      clearTimer();
    }
    if (state() == GestureState::Active) {
      end();
    } else {
      resetProgress();
      fail();
    }
  }

  bool wantsScroll() const override {
    return trackpad_;
  }

  // A trackpad's two fingers drive the pan as one pointer when the gesture asks for it
  // (`enableTrackpadTwoFingerGesture`), as UIKit's pan does with an iPad's trackpad.
  void scroll(const GesturePointer &pointer, Point delta, std::optional<GesturePhase> phase) override {
    if (!trackpad_) {
      return;
    }
    if (phase == GesturePhase::Began || (state() == GestureState::Undetermined && phase == GesturePhase::Changed)) {
      GesturePointer virtualPointer = pointer;
      virtualPointer.id = kScrollPointer;
      scrollAt_ = pointer.page;
      track(virtualPointer);
      owner_.record(*this);
      last_ = average();
      start_ = last_;
      tryBegin();
      return;
    }
    if (!tracks(kScrollPointer)) {
      return;
    }
    if (phase == GesturePhase::Changed) {
      scrollAt_ = {scrollAt_.x + delta.x, scrollAt_.y + delta.y};
      GesturePointer moved = pointer;
      moved.id = kScrollPointer;
      moved.page = scrollAt_;
      track(moved);
      last_ = average();
      velocity_ = velocity();
      checkBegan();
      if (active) {
        owner_.send(*this, state(), state());
      }
      return;
    }
    // Ended or cancelled.
    untrack(kScrollPointer);
    if (state() == GestureState::Active && phase == GesturePhase::Ended) {
      end();
    } else if (state() == GestureState::Active) {
      cancel();
    } else {
      fail();
    }
  }

 protected:
  void readConfig(const folly::dynamic &config) override {
    GestureHandler::readConfig(config);
    auto custom = [&](const char *key, double &into) {
      if (auto value = number(config, key)) {
        into = *value;
        custom_ = true;
      }
    };
    if (auto value = number(config, "minPointers")) {
      minPointers_ = static_cast<size_t>(*value);
    }
    if (auto value = number(config, "maxPointers")) {
      maxPointers_ = static_cast<size_t>(*value);
    }
    if (auto value = number(config, "minVelocity")) {
      minVelocitySq_ = *value * *value;
      custom_ = true;
    }
    custom("minVelocityX", minVelocityX_);
    custom("minVelocityY", minVelocityY_);
    custom("activeOffsetXStart", activeXStart_);
    custom("activeOffsetXEnd", activeXEnd_);
    custom("failOffsetXStart", failXStart_);
    custom("failOffsetXEnd", failXEnd_);
    custom("activeOffsetYStart", activeYStart_);
    custom("activeOffsetYEnd", activeYEnd_);
    custom("failOffsetYStart", failYStart_);
    custom("failOffsetYEnd", failYEnd_);
    if (auto value = number(config, "activateAfterLongPress")) {
      afterLongPress_ = *value;
    }
    if (auto value = flag(config, "enableTrackpadTwoFingerGesture")) {
      trackpad_ = *value;
    }
    if (auto value = number(config, "minDist")) {
      minDist_ = *value;
      minDistSq_ = *value * *value;
    } else if (!minDist_ && custom_) {
      minDistSq_ = kMax;
    }
  }

  void resetConfig() override {
    GestureHandler::resetConfig();
    minPointers_ = 1;
    maxPointers_ = 10;
    minDist_.reset();
    minDistSq_ = kDefaultSlop * kDefaultSlop;
    activeXStart_ = kMax;
    activeXEnd_ = kMin;
    failXStart_ = kMin;
    failXEnd_ = kMax;
    activeYStart_ = kMax;
    activeYEnd_ = kMin;
    failYStart_ = kMin;
    failYEnd_ = kMax;
    minVelocityX_ = kMax;
    minVelocityY_ = kMax;
    minVelocitySq_ = kMax;
    afterLongPress_ = 0;
    trackpad_ = false;
    custom_ = false;
  }

  folly::dynamic extraData() const override {
    auto data = GestureHandler::extraData();
    data["translationX"] = translation().x;
    data["translationY"] = translation().y;
    data["velocityX"] = std::isnan(velocity_.x) ? 0.0 : velocity_.x;
    data["velocityY"] = std::isnan(velocity_.y) ? 0.0 : velocity_.y;
    return data;
  }

  void onCancel() override {
    clearTimer();
  }
  void onReset() override {
    clearTimer();
  }
  void resetProgress() override {
    if (state() == GestureState::Active) {
      return;
    }
    start_ = last_;
  }

 public:
  void activate(bool force) override {
    if (state() != GestureState::Active) {
      resetProgress();
    }
    GestureHandler::activate(force);
  }

 private:
  static constexpr int kScrollPointer = -1;

  Point translation() const {
    return {last_.x - start_.x + offset_.x, last_.y - start_.y + offset_.y};
  }

  void tryBegin() {
    if (state() != GestureState::Undetermined || pointers_.size() < minPointers_) {
      return;
    }
    resetProgress();
    offset_ = {0, 0};
    velocity_ = {0, 0};
    begin();
    if (afterLongPress_ > 0) {
      after(afterLongPress_, [this] { activate(false); });
    }
  }

  void checkBegan() {
    if (state() != GestureState::Began) {
      return;
    }
    if (shouldFail()) {
      fail();
    } else if (shouldActivate()) {
      activate(false);
    }
  }

  bool shouldActivate() const {
    // A pan that waits for a long press activates only when it has waited.
    if (afterLongPress_ > 0) {
      return false;
    }
    auto t = translation();
    if (activeXStart_ != kMax && t.x < activeXStart_) {
      return true;
    }
    if (activeXEnd_ != kMin && t.x > activeXEnd_) {
      return true;
    }
    if (activeYStart_ != kMax && t.y < activeYStart_) {
      return true;
    }
    if (activeYEnd_ != kMin && t.y > activeYEnd_) {
      return true;
    }
    double distanceSq = t.x * t.x + t.y * t.y;
    if (minDistSq_ != kMax && distanceSq >= minDistSq_) {
      return true;
    }
    if (minVelocityX_ != kMax && std::abs(velocity_.x) >= std::abs(minVelocityX_)) {
      return true;
    }
    if (minVelocityY_ != kMax && std::abs(velocity_.y) >= std::abs(minVelocityY_)) {
      return true;
    }
    double velocitySq = velocity_.x * velocity_.x + velocity_.y * velocity_.y;
    return minVelocitySq_ != kMax && velocitySq >= minVelocitySq_;
  }

  bool shouldFail() {
    auto t = translation();
    double distanceSq = t.x * t.x + t.y * t.y;
    if (afterLongPress_ > 0 && distanceSq > kDefaultSlop * kDefaultSlop) {
      clearTimer();
      return true;
    }
    if (failXStart_ != kMin && t.x < failXStart_) {
      return true;
    }
    if (failXEnd_ != kMax && t.x > failXEnd_) {
      return true;
    }
    if (failYStart_ != kMin && t.y < failYStart_) {
      return true;
    }
    return failYEnd_ != kMax && t.y > failYEnd_;
  }

  size_t minPointers_{1};
  size_t maxPointers_{10};
  std::optional<double> minDist_;
  double minDistSq_{kDefaultSlop * kDefaultSlop};
  // As the library's: a start offset that is still its default never activates.
  double activeXStart_{kMax};
  double activeXEnd_{kMin};
  double failXStart_{kMin};
  double failXEnd_{kMax};
  double activeYStart_{kMax};
  double activeYEnd_{kMin};
  double failYStart_{kMin};
  double failYEnd_{kMax};
  double minVelocityX_{kMax};
  double minVelocityY_{kMax};
  double minVelocitySq_{kMax};
  double afterLongPress_{0};
  bool trackpad_{false};
  bool custom_{false};
  Point start_{};
  Point last_{};
  Point offset_{};
  Point velocity_{};
  Point scrollAt_{};
};

class TapHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  void pointerDown(const GesturePointer &pointer) override {
    if (!buttonAllowed(pointer.button)) {
      return;
    }
    track(pointer);
    GestureHandler::pointerDown(pointer);
    if (state() == GestureState::Undetermined) {
      offset_ = {0, 0};
    }
    start_ = pointer.page;
    last_ = pointer.page;
    update(Kind::Down);
  }

  void pointerMove(const GesturePointer &pointer, bool inBounds) override {
    if (!tracks(pointer.id)) {
      return;
    }
    track(pointer);
    last_ = average();
    update(Kind::Move);
    GestureHandler::pointerMove(pointer, inBounds);
  }

  void pointerUp(const GesturePointer &pointer) override {
    if (!tracks(pointer.id)) {
      return;
    }
    GestureHandler::pointerUp(pointer);
    last_ = average();
    untrack(pointer.id);
    update(Kind::Up);
  }

  void activate(bool force) override {
    GestureHandler::activate(force);
    end();
  }

 protected:
  void readConfig(const folly::dynamic &config) override {
    GestureHandler::readConfig(config);
    if (auto value = number(config, "numberOfTaps")) {
      taps_ = static_cast<int>(*value);
    }
    if (auto value = number(config, "maxDurationMs")) {
      maxDuration_ = *value;
    }
    if (auto value = number(config, "maxDelayMs")) {
      maxDelay_ = *value;
    }
    if (auto value = number(config, "maxDeltaX")) {
      maxDeltaX_ = *value;
    }
    if (auto value = number(config, "maxDeltaY")) {
      maxDeltaY_ = *value;
    }
    if (auto value = number(config, "maxDist")) {
      maxDistSq_ = *value * *value;
    }
    if (auto value = number(config, "minPointers")) {
      minPointers_ = static_cast<size_t>(*value);
    }
  }

  void resetConfig() override {
    GestureHandler::resetConfig();
    taps_ = 1;
    maxDuration_ = 500;
    maxDelay_ = 500;
    maxDeltaX_ = kMin;
    maxDeltaY_ = kMin;
    maxDistSq_ = kMin;
    minPointers_ = 1;
  }

  void onCancel() override {
    resetProgress();
  }
  void resetProgress() override {
    clearTimer();
    tapsSoFar_ = 0;
    maxPointersSeen_ = 0;
  }

 private:
  enum class Kind { Down, Move, Up };

  void update(Kind kind) {
    maxPointersSeen_ = std::max(maxPointersSeen_, pointers_.size());
    if (shouldFail()) {
      fail();
      return;
    }
    if (state() == GestureState::Undetermined) {
      if (kind == Kind::Down) {
        begin();
      }
      startTap();
    } else if (state() == GestureState::Began) {
      if (kind == Kind::Up) {
        endTap();
      }
      if (kind == Kind::Down) {
        startTap();
      }
    }
  }

  void startTap() {
    clearTimer();
    after(maxDuration_, [this] { fail(); });
  }

  void endTap() {
    clearTimer();
    if (++tapsSoFar_ == taps_ && maxPointersSeen_ >= minPointers_) {
      activate(false);
    } else {
      after(maxDelay_, [this] { fail(); });
    }
  }

  bool shouldFail() const {
    double dx = last_.x - start_.x + offset_.x;
    double dy = last_.y - start_.y + offset_.y;
    if (maxDeltaX_ != kMin && std::abs(dx) > maxDeltaX_) {
      return true;
    }
    if (maxDeltaY_ != kMin && std::abs(dy) > maxDeltaY_) {
      return true;
    }
    return maxDistSq_ != kMin && dx * dx + dy * dy > maxDistSq_;
  }

  int taps_{1};
  double maxDuration_{500};
  double maxDelay_{500};
  double maxDeltaX_{kMin};
  double maxDeltaY_{kMin};
  double maxDistSq_{kMin};
  size_t minPointers_{1};
  int tapsSoFar_{0};
  size_t maxPointersSeen_{0};
  Point start_{};
  Point last_{};
  Point offset_{};
};

class LongPressHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  void pointerDown(const GesturePointer &pointer) override {
    if (!buttonAllowed(pointer.button)) {
      return;
    }
    track(pointer);
    GestureHandler::pointerDown(pointer);
    start_ = pointer.page;
    if (state() == GestureState::Undetermined) {
      startTime_ = pointer.time;
      begin();
    }
    if (pointers_.size() == pointerCount_) {
      if (minDuration_ > 0) {
        after(minDuration_, [this] { activate(false); });
      } else {
        activate(false);
      }
    }
  }

  void pointerMove(const GesturePointer &pointer, bool inBounds) override {
    if (!tracks(pointer.id)) {
      return;
    }
    GestureHandler::pointerMove(pointer, inBounds);
    track(pointer);
    auto now = average();
    double dx = now.x - start_.x;
    double dy = now.y - start_.y;
    if (dx * dx + dy * dy <= maxDistSq_) {
      return;
    }
    if (state() == GestureState::Active) {
      cancel();
    } else {
      fail();
    }
  }

  void pointerUp(const GesturePointer &pointer) override {
    if (!tracks(pointer.id)) {
      return;
    }
    GestureHandler::pointerUp(pointer);
    untrack(pointer.id);
    if (state() == GestureState::Active) {
      end();
    } else {
      fail();
    }
  }

 protected:
  void readConfig(const folly::dynamic &config) override {
    GestureHandler::readConfig(config);
    if (auto value = number(config, "minDurationMs")) {
      minDuration_ = *value;
    }
    if (auto value = number(config, "maxDist")) {
      maxDistSq_ = *value * *value;
    }
    if (auto value = number(config, "numberOfPointers")) {
      pointerCount_ = static_cast<size_t>(*value);
    }
  }
  void resetConfig() override {
    GestureHandler::resetConfig();
    minDuration_ = 500;
    maxDistSq_ = 100;
    pointerCount_ = 1;
  }
  void onStateChange(GestureState, GestureState) override {
    clearTimer();
  }
  folly::dynamic extraData() const override {
    auto data = GestureHandler::extraData();
    data["duration"] = owner_.now() - startTime_;
    return data;
  }

 private:
  double minDuration_{500};
  // UIKit's default allowable movement: 10 points.
  double maxDistSq_{100};
  size_t pointerCount_{1};
  Point start_{};
  double startTime_{0};
};

// The native view's own recogniser. With a mouse, a scroll view scrolls by the wheel and the
// trackpad, not by a drag, so a native handler on one activates as it scrolls; on any other view
// it activates once a press drags past the slop, as the library's web handler does.
class NativeHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  void pointerDown(const GesturePointer &pointer) override {
    track(pointer);
    GestureHandler::pointerDown(pointer);
    start_ = average();
    if (state() != GestureState::Undetermined) {
      return;
    }
    begin();
    if (activateOnStart_) {
      activate(false);
    }
  }

  void pointerMove(const GesturePointer &pointer, bool inBounds) override {
    if (!tracks(pointer.id)) {
      return;
    }
    track(pointer);
    if (!inBounds && shouldCancelWhenOutside_) {
      if (state() == GestureState::Active) {
        cancel();
      } else {
        fail();
      }
      return;
    }
    auto now = average();
    double dx = now.x - start_.x;
    double dy = now.y - start_.y;
    if (state() == GestureState::Began && !scrollView() && dx * dx + dy * dy >= kDefaultSlop * kDefaultSlop) {
      activate(false);
    }
    GestureHandler::pointerMove(pointer, inBounds);
  }

  void pointerUp(const GesturePointer &pointer) override {
    if (!tracks(pointer.id)) {
      return;
    }
    GestureHandler::pointerUp(pointer);
    untrack(pointer.id);
    if (!pointers_.empty()) {
      return;
    }
    if (state() == GestureState::Active) {
      end();
    } else {
      fail();
    }
  }

  bool wantsScroll() const override {
    return scrollView();
  }

  void scroll(const GesturePointer &pointer, Point, std::optional<GesturePhase> phase) override {
    if (phase == GesturePhase::Ended || phase == GesturePhase::Cancelled) {
      if (state() == GestureState::Active && !tracks(pointer.id)) {
        end();
      }
      return;
    }
    if (state() == GestureState::Undetermined) {
      owner_.record(*this);
      begin();
    }
    if (state() == GestureState::Began) {
      activate(false);
    }
    // A wheel has no phases: the scroll is over when the wheel stops.
    if (!phase) {
      after(kWheelIdleMs, [this] {
        if (state() == GestureState::Active) {
          end();
        }
      });
    }
  }

 protected:
  void readConfig(const folly::dynamic &config) override {
    GestureHandler::readConfig(config);
    if (auto value = flag(config, "shouldActivateOnStart")) {
      activateOnStart_ = *value;
    }
  }
  void resetConfig() override {
    GestureHandler::resetConfig();
    shouldCancelWhenOutside_ = true;
    activateOnStart_ = false;
  }

 private:
  static constexpr double kWheelIdleMs = 100;

  bool scrollView() const {
    const auto *node = owner_.tree().find(view());
    return node != nullptr && std::string_view(node->view.componentName) == "ScrollView";
  }

  bool activateOnStart_{false};
  Point start_{};
};

// Driven only by its own state manager (manual activation from a worklet).
class ManualHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  void pointerDown(const GesturePointer &pointer) override {
    track(pointer);
    GestureHandler::pointerDown(pointer);
    begin();
  }
  void pointerMove(const GesturePointer &pointer, bool inBounds) override {
    if (!tracks(pointer.id)) {
      return;
    }
    track(pointer);
    GestureHandler::pointerMove(pointer, inBounds);
  }
  void pointerUp(const GesturePointer &pointer) override {
    if (!tracks(pointer.id)) {
      return;
    }
    GestureHandler::pointerUp(pointer);
    untrack(pointer.id);
  }
};

// The pointer over the view with no button down, as UIKit's hover recogniser reports a mouse.
class HoverHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  bool wantsHover() const override {
    return true;
  }

  void hover(const GesturePointer &pointer, bool inside) override {
    lastAverage_ = pointer.page;
    if (inside) {
      if (state() == GestureState::Undetermined) {
        owner_.record(*this);
        begin();
        activate(false);
      } else if (state() == GestureState::Active) {
        owner_.send(*this, state(), state());
      }
    } else if (state() == GestureState::Active || state() == GestureState::Began) {
      end();
    }
  }

  void pointerDown(const GesturePointer &) override {}
  void pointerMove(const GesturePointer &, bool) override {}
  void pointerUp(const GesturePointer &) override {}
};

class PinchHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  bool wantsMagnify() const override {
    return true;
  }

  void pointerDown(const GesturePointer &) override {}
  void pointerMove(const GesturePointer &, bool) override {}
  void pointerUp(const GesturePointer &) override {}

  void magnify(const GesturePointer &pointer, double magnification, GesturePhase phase) override {
    lastAverage_ = pointer.page;
    if (phase == GesturePhase::Began) {
      owner_.record(*this);
      scale_ = 1;
      velocity_ = 0;
      lastTime_ = pointer.time;
      begin();
      return;
    }
    if (phase == GesturePhase::Changed) {
      double before = scale_;
      scale_ *= 1 + magnification;
      double dt = pointer.time - lastTime_;
      velocity_ = dt > 0 ? (scale_ - before) / dt * 1000 : velocity_;
      lastTime_ = pointer.time;
      if (state() == GestureState::Began) {
        activate(false);
      } else if (state() == GestureState::Active) {
        owner_.send(*this, state(), state());
      }
      return;
    }
    if (state() == GestureState::Active && phase == GesturePhase::Ended) {
      end();
    } else if (state() == GestureState::Active) {
      cancel();
    } else {
      fail();
    }
  }

 protected:
  folly::dynamic extraData() const override {
    auto origin = viewOrigin();
    return folly::dynamic::object("scale", scale_)("focalX", lastAverage_.x - origin.x)("focalY", lastAverage_.y - origin.y)(
        "velocity", velocity_)("numberOfPointers", 2)("pointerType", kMouse);
  }

 private:
  double scale_{1};
  double velocity_{0};
  double lastTime_{0};
};

class RotationHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  bool wantsRotate() const override {
    return true;
  }

  void pointerDown(const GesturePointer &) override {}
  void pointerMove(const GesturePointer &, bool) override {}
  void pointerUp(const GesturePointer &) override {}

  void rotate(const GesturePointer &pointer, double degrees, GesturePhase phase) override {
    lastAverage_ = pointer.page;
    if (phase == GesturePhase::Began) {
      owner_.record(*this);
      rotation_ = 0;
      velocity_ = 0;
      lastTime_ = pointer.time;
      begin();
      return;
    }
    if (phase == GesturePhase::Changed) {
      // AppKit's degrees are anticlockwise; UIKit's rotation, which the library reports, is
      // clockwise radians.
      double step = -degrees * M_PI / 180;
      rotation_ += step;
      double dt = pointer.time - lastTime_;
      velocity_ = dt > 0 ? step / dt * 1000 : velocity_;
      lastTime_ = pointer.time;
      if (state() == GestureState::Began) {
        activate(false);
      } else if (state() == GestureState::Active) {
        owner_.send(*this, state(), state());
      }
      return;
    }
    if (state() == GestureState::Active && phase == GesturePhase::Ended) {
      end();
    } else if (state() == GestureState::Active) {
      cancel();
    } else {
      fail();
    }
  }

 protected:
  folly::dynamic extraData() const override {
    auto origin = viewOrigin();
    return folly::dynamic::object("rotation", rotation_)("anchorX", lastAverage_.x - origin.x)(
        "anchorY", lastAverage_.y - origin.y)("velocity", velocity_)("numberOfPointers", 2)("pointerType", kMouse);
  }

 private:
  double rotation_{0};
  double velocity_{0};
  double lastTime_{0};
};

// A quick drag in one of its directions (RIGHT 1, LEFT 2, UP 4, DOWN 8).
class FlingHandler final : public GestureHandler {
 public:
  using GestureHandler::GestureHandler;

  void pointerDown(const GesturePointer &pointer) override {
    if (!buttonAllowed(pointer.button)) {
      return;
    }
    track(pointer);
    GestureHandler::pointerDown(pointer);
    start_ = pointer.page;
    if (state() == GestureState::Undetermined) {
      begin();
      after(kMaxDurationMs, [this] { fail(); });
    }
  }

  void pointerMove(const GesturePointer &pointer, bool inBounds) override {
    if (!tracks(pointer.id)) {
      return;
    }
    track(pointer);
    GestureHandler::pointerMove(pointer, inBounds);
    if (state() != GestureState::Began) {
      return;
    }
    auto now = average();
    auto v = velocity();
    double dx = now.x - start_.x;
    double dy = now.y - start_.y;
    bool swiped = ((direction_ & 1) && dx > kMinDistance && v.x > kMinVelocity) ||
        ((direction_ & 2) && -dx > kMinDistance && -v.x > kMinVelocity) ||
        ((direction_ & 4) && -dy > kMinDistance && -v.y > kMinVelocity) ||
        ((direction_ & 8) && dy > kMinDistance && v.y > kMinVelocity);
    if (swiped) {
      clearTimer();
      activate(false);
    }
  }

  void pointerUp(const GesturePointer &pointer) override {
    if (!tracks(pointer.id)) {
      return;
    }
    GestureHandler::pointerUp(pointer);
    untrack(pointer.id);
    if (state() == GestureState::Active) {
      end();
    } else {
      fail();
    }
  }

 protected:
  void readConfig(const folly::dynamic &config) override {
    GestureHandler::readConfig(config);
    if (auto value = number(config, "direction")) {
      direction_ = static_cast<int>(*value);
    }
  }
  void resetConfig() override {
    GestureHandler::resetConfig();
    direction_ = 1;
  }

 private:
  static constexpr double kMaxDurationMs = 800;
  static constexpr double kMinDistance = 40;
  static constexpr double kMinVelocity = 300;
  int direction_{1};
  Point start_{};
};

std::unique_ptr<GestureHandler> makeHandler(Gestures &owner, const std::string &name, int tag) {
  if (name == "PanGestureHandler") {
    return std::make_unique<PanHandler>(owner, tag, name);
  }
  if (name == "TapGestureHandler") {
    return std::make_unique<TapHandler>(owner, tag, name);
  }
  if (name == "LongPressGestureHandler") {
    return std::make_unique<LongPressHandler>(owner, tag, name);
  }
  if (name == "NativeViewGestureHandler") {
    return std::make_unique<NativeHandler>(owner, tag, name);
  }
  if (name == "ManualGestureHandler") {
    return std::make_unique<ManualHandler>(owner, tag, name);
  }
  if (name == "HoverGestureHandler") {
    return std::make_unique<HoverHandler>(owner, tag, name);
  }
  if (name == "PinchGestureHandler") {
    return std::make_unique<PinchHandler>(owner, tag, name);
  }
  if (name == "RotationGestureHandler") {
    return std::make_unique<RotationHandler>(owner, tag, name);
  }
  if (name == "FlingGestureHandler") {
    return std::make_unique<FlingHandler>(owner, tag, name);
  }
  return nullptr;
}

} // namespace

// --- GestureHandler -------------------------------------------------------------------------------

GestureHandler::GestureHandler(Gestures &owner, int tag, std::string name)
    : owner_(owner), tag_(tag), name_(std::move(name)) {}

void GestureHandler::configure(const folly::dynamic &config, bool reset) {
  if (reset) {
    resetConfig();
  }
  readConfig(config);
}

void GestureHandler::readConfig(const folly::dynamic &config) {
  if (auto value = flag(config, "enabled")) {
    enabled_ = *value;
    if (!enabled_ && state_ != GestureState::Undetermined) {
      state_ == GestureState::Active ? cancel() : fail();
    }
  }
  if (auto value = flag(config, "shouldCancelWhenOutside")) {
    shouldCancelWhenOutside_ = *value;
  }
  if (auto value = flag(config, "needsPointerData")) {
    needsPointerData_ = *value;
  }
  if (auto value = flag(config, "manualActivation")) {
    manualActivation_ = *value;
  }
  if (auto value = number(config, "mouseButton")) {
    mouseButton_ = static_cast<int>(*value);
  }
}

void GestureHandler::resetConfig() {
  enabled_ = true;
  shouldCancelWhenOutside_ = false;
  needsPointerData_ = false;
  manualActivation_ = false;
  mouseButton_.reset();
}

void GestureHandler::attach(Tag view, GestureAction action) {
  if (view_ != -1 && view_ != view) {
    state_ == GestureState::Active ? cancel() : fail();
  }
  view_ = view;
  action_ = action;
}

void GestureHandler::setRelations(std::vector<int> waitFor, std::vector<int> simultaneous, std::vector<int> blocks) {
  waitFor_ = std::move(waitFor);
  simultaneous_ = std::move(simultaneous);
  blocks_ = std::move(blocks);
}

bool GestureHandler::shouldWaitFor(const GestureHandler &other) const {
  return &other != this && contains(waitFor_, other.tag_);
}
bool GestureHandler::requiresToWaitFor(const GestureHandler &other) const {
  return &other != this && contains(blocks_, other.tag_);
}
bool GestureHandler::recognizesSimultaneously(const GestureHandler &other) const {
  return &other == this || contains(simultaneous_, other.tag_);
}
bool GestureHandler::cancelledBy(const GestureHandler &other) const {
  // As the library's InteractionManager: an active native view's recogniser takes over from the
  // handlers it does not run beside.
  return &other != this && other.isNative() && other.active;
}

bool GestureHandler::sharesPointers(const GestureHandler &other) const {
  return std::any_of(pointers_.begin(), pointers_.end(), [&](const auto &entry) { return other.tracks(entry.first); });
}

bool GestureHandler::buttonAllowed(int button) const {
  int bit = button == 0 ? kLeft : button == 2 ? kRight : kMiddle;
  return mouseButton_ ? (*mouseButton_ & bit) != 0 : bit == kLeft;
}

void GestureHandler::pointerDown(const GesturePointer &pointer) {
  owner_.record(*this);
  if (needsPointerData_) {
    sendTouches(1, pointer);
  }
}

void GestureHandler::pointerMove(const GesturePointer &pointer, bool inBounds) {
  if ((!inBounds && shouldCancelWhenOutside_) || !enabled_) {
    return;
  }
  if (needsPointerData_) {
    sendTouches(2, pointer);
  }
  if (active) {
    owner_.send(*this, state_, state_);
  }
}

void GestureHandler::pointerUp(const GesturePointer &pointer) {
  if (needsPointerData_) {
    sendTouches(3, pointer);
  }
}

void GestureHandler::pointerCancel() {
  if (owner_.recorded(*this)) {
    cancel();
  }
}

void GestureHandler::track(const GesturePointer &pointer) {
  auto &tracked = pointers_[pointer.id];
  tracked.page = pointer.page;
  tracked.samples.emplace_back(pointer.time, pointer.page);
  while (tracked.samples.size() > 1 && pointer.time - tracked.samples.front().first > kVelocityWindowMs) {
    tracked.samples.pop_front();
  }
  lastAverage_ = average();
}

void GestureHandler::untrack(int pointerId) {
  pointers_.erase(pointerId);
}

Point GestureHandler::average() const {
  if (pointers_.empty()) {
    return lastAverage_;
  }
  Point sum{0, 0};
  for (const auto &[id, tracked] : pointers_) {
    sum.x += tracked.page.x;
    sum.y += tracked.page.y;
  }
  auto n = static_cast<facebook::react::Float>(pointers_.size());
  return {sum.x / n, sum.y / n};
}

Point GestureHandler::velocity() const {
  // Points a second, over the samples of the last 100 ms, averaged over the pointers.
  Point sum{0, 0};
  int counted = 0;
  for (const auto &[id, tracked] : pointers_) {
    if (tracked.samples.size() < 2) {
      continue;
    }
    const auto &[t0, p0] = tracked.samples.front();
    const auto &[t1, p1] = tracked.samples.back();
    if (t1 <= t0) {
      continue;
    }
    sum.x += (p1.x - p0.x) / (t1 - t0) * 1000;
    sum.y += (p1.y - p0.y) / (t1 - t0) * 1000;
    ++counted;
  }
  return counted ? Point{sum.x / counted, sum.y / counted} : Point{0, 0};
}

Point GestureHandler::viewOrigin() const {
  return owner_.tree().originIn(view_, owner_.surface()).value_or(Point{0, 0});
}

void GestureHandler::after(double ms, std::function<void()> fn) {
  clearTimer();
  if (!owner_.schedule()) {
    return;
  }
  cancelTimer_ = owner_.schedule()(ms, std::move(fn));
}

void GestureHandler::clearTimer() {
  if (auto cancel = std::exchange(cancelTimer_, nullptr)) {
    cancel();
  }
}

void GestureHandler::moveToState(GestureState next) {
  if (state_ == next) {
    return;
  }
  auto previous = state_;
  state_ = next;
  owner_.stateChanged(*this, next, previous);
  onStateChange(next, previous);
  if (!enabled_ && (next == GestureState::End || next == GestureState::Failed || next == GestureState::Cancelled)) {
    state_ = GestureState::Undetermined;
  }
}

void GestureHandler::begin() {
  if (state_ == GestureState::Undetermined) {
    moveToState(GestureState::Began);
  }
}

void GestureHandler::fail() {
  if (state_ == GestureState::Active || state_ == GestureState::Began) {
    moveToState(GestureState::Failed);
  }
  resetProgress();
}

void GestureHandler::cancel() {
  if (state_ == GestureState::Active || state_ == GestureState::Undetermined || state_ == GestureState::Began) {
    onCancel();
    moveToState(GestureState::Cancelled);
  }
}

void GestureHandler::activate(bool force) {
  if ((!manualActivation_ || force) && state_ == GestureState::Began) {
    moveToState(GestureState::Active);
  }
}

void GestureHandler::end() {
  if (state_ == GestureState::Began || state_ == GestureState::Active) {
    moveToState(GestureState::End);
  }
  resetProgress();
}

void GestureHandler::reset() {
  clearTimer();
  pointers_.clear();
  onReset();
  resetProgress();
  state_ = GestureState::Undetermined;
  lastSent_.reset();
}

folly::dynamic GestureHandler::extraData() const {
  auto origin = viewOrigin();
  return folly::dynamic::object("x", lastAverage_.x - origin.x)("y", lastAverage_.y - origin.y)("absoluteX", lastAverage_.x)(
      "absoluteY", lastAverage_.y)("numberOfPointers", static_cast<int>(pointers_.size()))("pointerType", kMouse);
}

folly::dynamic GestureHandler::eventData() const {
  auto data = extraData();
  data["target"] = view_;
  data["handlerTag"] = tag_;
  data["state"] = static_cast<int>(state_);
  return data;
}

void GestureHandler::sendTouches(int eventType, const GesturePointer &changed) {
  auto origin = viewOrigin();
  auto touch = [&](int id, Point page) {
    return folly::dynamic::object("id", id)("x", page.x - origin.x)("y", page.y - origin.y)("absoluteX", page.x)("absoluteY", page.y);
  };
  folly::dynamic all = folly::dynamic::array();
  for (const auto &[id, tracked] : pointers_) {
    all.push_back(touch(id, tracked.page));
  }
  int count = static_cast<int>(pointers_.size()) - (eventType == 3 ? 1 : 0);
  auto body = folly::dynamic::object("handlerTag", tag_)("state", static_cast<int>(state_))("eventType", eventType)(
      "allTouches", all)("changedTouches", folly::dynamic::array(touch(changed.id, changed.page)))(
      "numberOfTouches", count)("pointerType", kMouse)("target", view_);
  owner_.sendEvent(*this, "onGestureHandlerEvent", std::move(body));
}

// --- Gestures --------------------------------------------------------------------------------------

Gestures::Gestures(const ViewTree &tree, Schedule schedule) : tree_(tree), schedule_(std::move(schedule)) {}

Gestures::~Gestures() {
  for (auto &[tag, handler] : handlers_) {
    handler->reset();
  }
}

GestureHandler *Gestures::find(int handlerTag) const {
  auto it = handlers_.find(handlerTag);
  return it == handlers_.end() ? nullptr : it->second.get();
}

void Gestures::create(const std::string &name, int handlerTag, const folly::dynamic &config) {
  auto handler = makeHandler(*this, name, handlerTag);
  if (!handler) {
    return;
  }
  drop(handlerTag);
  handler->configure(config, true);
  handlers_[handlerTag] = std::move(handler);
}

void Gestures::attach(int handlerTag, Tag view, GestureAction action) {
  if (auto *handler = find(handlerTag)) {
    handler->attach(view, action);
  }
}

void Gestures::configure(int handlerTag, const folly::dynamic &config, bool reset) {
  if (auto *handler = find(handlerTag)) {
    handler->configure(config, reset);
  }
}

void Gestures::relations(int handlerTag, const folly::dynamic &config) {
  if (auto *handler = find(handlerTag)) {
    handler->setRelations(tags(config, "waitFor"), tags(config, "simultaneousHandlers"), tags(config, "blocksHandlers"));
  }
}

void Gestures::drop(int handlerTag) {
  auto it = handlers_.find(handlerTag);
  if (it == handlers_.end()) {
    return;
  }
  auto *handler = it->second.get();
  handler->reset();
  std::erase(recorded_, handler);
  std::erase(awaiting_, handler);
  for (auto *list : {&pressed_, &hovered_, &scrolling_, &magnifying_, &rotating_}) {
    std::erase(*list, handlerTag);
  }
  handlers_.erase(it);
}

void Gestures::clear() {
  while (!handlers_.empty()) {
    drop(handlers_.begin()->first);
  }
}

void Gestures::setState(int handlerTag, int state) {
  auto *handler = find(handlerTag);
  if (!handler) {
    return;
  }
  switch (static_cast<GestureState>(state)) {
    case GestureState::Began:
      handler->begin();
      break;
    case GestureState::Active:
      handler->activate(true);
      break;
    case GestureState::End:
      handler->end();
      break;
    case GestureState::Failed:
      handler->fail();
      break;
    case GestureState::Cancelled:
      handler->cancel();
      break;
    default:
      break;
  }
  settle();
}

std::vector<GestureHandler *> Gestures::handlersOn(const std::vector<Tag> &chain) const {
  // Deepest first, as the event reaches a view's own listeners before its ancestors'.
  std::vector<GestureHandler *> out;
  for (auto view = chain.rbegin(); view != chain.rend(); ++view) {
    for (const auto &[tag, handler] : handlers_) {
      if (handler->view() == *view && handler->enabled()) {
        out.push_back(handler.get());
      }
    }
  }
  return out;
}

bool Gestures::handles(const std::vector<Tag> &chain) const {
  return !handlersOn(chain).empty();
}

bool Gestures::inBounds(const GestureHandler &handler, Point page) const {
  const auto *node = tree_.find(handler.view());
  auto origin = tree_.originIn(handler.view(), surface_);
  if (!node || !origin) {
    return false;
  }
  const auto &size = node->view.layoutMetrics.frame.size;
  return page.x >= origin->x && page.y >= origin->y && page.x <= origin->x + size.width && page.y <= origin->y + size.height;
}

void Gestures::pointerDown(SurfaceId surface, const std::vector<Tag> &chain, const GesturePointer &pointer) {
  surface_ = surface;
  now_ = pointer.time;
  pressed_.clear();
  for (auto *handler : handlersOn(chain)) {
    pressed_.push_back(handler->tag());
  }
  for (int tag : std::vector<int>(pressed_)) {
    if (auto *handler = find(tag)) {
      handler->pointerDown(pointer);
    }
  }
  settle();
}

void Gestures::pointerMove(const GesturePointer &pointer) {
  now_ = pointer.time;
  for (int tag : std::vector<int>(pressed_)) {
    if (auto *handler = find(tag)) {
      handler->pointerMove(pointer, inBounds(*handler, pointer.page));
    }
  }
  settle();
}

void Gestures::pointerUp(const GesturePointer &pointer) {
  now_ = pointer.time;
  auto pressed = std::exchange(pressed_, {});
  for (int tag : pressed) {
    if (auto *handler = find(tag)) {
      handler->pointerUp(pointer);
    }
  }
  settle();
}

void Gestures::pointerCancel() {
  auto pressed = std::exchange(pressed_, {});
  for (int tag : pressed) {
    if (auto *handler = find(tag)) {
      handler->pointerCancel();
    }
  }
  settle();
}

void Gestures::hover(SurfaceId surface, const std::vector<Tag> &chain, const GesturePointer &pointer) {
  surface_ = surface;
  now_ = pointer.time;
  std::vector<int> over;
  for (auto *handler : handlersOn(chain)) {
    if (handler->wantsHover()) {
      over.push_back(handler->tag());
    }
  }
  for (int tag : std::vector<int>(hovered_)) {
    if (!contains(over, tag)) {
      if (auto *handler = find(tag)) {
        handler->hover(pointer, false);
      }
    }
  }
  for (int tag : over) {
    if (auto *handler = find(tag)) {
      handler->hover(pointer, true);
    }
  }
  hovered_ = over;
  settle();
}

bool Gestures::scroll(
    SurfaceId surface,
    const std::vector<Tag> &chain,
    const GesturePointer &pointer,
    Point delta,
    std::optional<GesturePhase> phase) {
  surface_ = surface;
  now_ = pointer.time;
  // The handlers a scroll begins on keep it until it ends, wherever the pointer goes.
  if (phase == GesturePhase::Began || scrolling_.empty()) {
    scrolling_.clear();
    for (auto *handler : handlersOn(chain)) {
      if (handler->wantsScroll()) {
        scrolling_.push_back(handler->tag());
      }
    }
  }
  bool took = false;
  for (int tag : std::vector<int>(scrolling_)) {
    if (auto *handler = find(tag)) {
      handler->scroll(pointer, delta, phase);
      took = took || (!handler->isNative() && handler->state() == GestureState::Active);
    }
  }
  if (phase == GesturePhase::Ended || phase == GesturePhase::Cancelled) {
    scrolling_.clear();
  }
  settle();
  return took;
}

void Gestures::magnify(
    SurfaceId surface,
    const std::vector<Tag> &chain,
    const GesturePointer &pointer,
    double magnification,
    GesturePhase phase) {
  surface_ = surface;
  now_ = pointer.time;
  if (phase == GesturePhase::Began) {
    magnifying_.clear();
    for (auto *handler : handlersOn(chain)) {
      if (handler->wantsMagnify()) {
        magnifying_.push_back(handler->tag());
      }
    }
  }
  for (int tag : std::vector<int>(magnifying_)) {
    if (auto *handler = find(tag)) {
      handler->magnify(pointer, magnification, phase);
    }
  }
  if (phase == GesturePhase::Ended || phase == GesturePhase::Cancelled) {
    magnifying_.clear();
  }
  settle();
}

void Gestures::rotate(
    SurfaceId surface,
    const std::vector<Tag> &chain,
    const GesturePointer &pointer,
    double degrees,
    GesturePhase phase) {
  surface_ = surface;
  now_ = pointer.time;
  if (phase == GesturePhase::Began) {
    rotating_.clear();
    for (auto *handler : handlersOn(chain)) {
      if (handler->wantsRotate()) {
        rotating_.push_back(handler->tag());
      }
    }
  }
  for (int tag : std::vector<int>(rotating_)) {
    if (auto *handler = find(tag)) {
      handler->rotate(pointer, degrees, phase);
    }
  }
  if (phase == GesturePhase::Ended || phase == GesturePhase::Cancelled) {
    rotating_.clear();
  }
  settle();
}

// --- the orchestrator (GestureHandlerOrchestrator.ts) -------------------------------------------

bool Gestures::finished(GestureState state) {
  return state == GestureState::End || state == GestureState::Failed || state == GestureState::Cancelled;
}

bool Gestures::recorded(const GestureHandler &handler) const {
  return std::find(recorded_.begin(), recorded_.end(), &handler) != recorded_.end();
}

void Gestures::record(GestureHandler &handler) {
  // Handlers that never began and track nothing drop out first.
  std::erase_if(recorded_, [](GestureHandler *h) {
    return h->state() == GestureState::Undetermined && h->trackedPointers() == 0 && !h->wantsHover() && !h->wantsScroll() &&
        !h->wantsMagnify() && !h->wantsRotate();
  });
  if (recorded(handler)) {
    return;
  }
  handler.active = false;
  handler.awaiting = false;
  handler.activationIndex = std::numeric_limits<size_t>::max();
  recorded_.push_back(&handler);
}

void Gestures::cleanHandler(GestureHandler &handler) {
  handler.reset();
  handler.active = false;
  handler.awaiting = false;
  handler.activationIndex = std::numeric_limits<size_t>::max();
}

void Gestures::cleanup() {
  std::vector<GestureHandler *> keep;
  for (auto *handler : recorded_) {
    if (finished(handler->state()) && !handler->awaiting) {
      cleanHandler(*handler);
    } else {
      keep.push_back(handler);
    }
  }
  recorded_ = std::move(keep);
}

void Gestures::settle() {
  if (changing_ == 0) {
    cleanup();
  }
}

bool Gestures::waitsFor(const GestureHandler &handler, const GestureHandler &other) const {
  return &handler != &other && (handler.shouldWaitFor(other) || other.requiresToWaitFor(handler));
}

bool Gestures::simultaneous(const GestureHandler &a, const GestureHandler &b) const {
  return &a == &b || a.recognizesSimultaneously(b) || b.recognizesSimultaneously(a);
}

bool Gestures::cancelledBy(const GestureHandler &handler, const GestureHandler &other) const {
  if (simultaneous(handler, other)) {
    return false;
  }
  if (handler.awaiting || handler.state() == GestureState::Active) {
    return handler.cancelledBy(other);
  }
  // Handlers with no pointer in common on different views (a hover beside a press, a pinch beside
  // a drag) are not rivals; the library checks such handlers' bounds for overlap, which the
  // desktop's one pointer never reaches.
  if (!handler.sharesPointers(other) && handler.view() != other.view()) {
    return false;
  }
  return true;
}

bool Gestures::hasToWait(const GestureHandler &handler) const {
  return std::any_of(recorded_.begin(), recorded_.end(), [&](GestureHandler *other) {
    return !finished(other->state()) && waitsFor(handler, *other);
  });
}

bool Gestures::cancelledByFinished(const GestureHandler &handler) const {
  return std::any_of(recorded_.begin(), recorded_.end(), [&](GestureHandler *other) {
    return waitsFor(handler, *other) && other->state() == GestureState::End;
  });
}

bool Gestures::shouldActivate(GestureHandler &handler) const {
  return std::none_of(recorded_.begin(), recorded_.end(), [&](GestureHandler *other) {
    return other != &handler && cancelledBy(handler, *other);
  });
}

void Gestures::tryActivate(GestureHandler &handler) {
  if (cancelledByFinished(handler)) {
    handler.cancel();
    return;
  }
  if (hasToWait(handler)) {
    addAwaiting(handler);
    return;
  }
  auto state = handler.state();
  if (state == GestureState::Cancelled || state == GestureState::Failed) {
    return;
  }
  if (shouldActivate(handler)) {
    makeActive(handler);
    return;
  }
  if (state == GestureState::Active) {
    handler.fail();
  } else if (state == GestureState::Began) {
    handler.cancel();
  }
}

void Gestures::addAwaiting(GestureHandler &handler) {
  if (std::find(awaiting_.begin(), awaiting_.end(), &handler) != awaiting_.end()) {
    return;
  }
  awaiting_.push_back(&handler);
  handler.awaiting = true;
  handler.activationIndex = activationIndex_++;
}

void Gestures::cleanupAwaiting(GestureHandler &handler) {
  std::erase_if(awaiting_, [&](GestureHandler *other) {
    if (!other->awaiting && waitsFor(*other, handler)) {
      cleanHandler(*other);
      return true;
    }
    return false;
  });
}

void Gestures::makeActive(GestureHandler &handler) {
  auto current = handler.state();
  handler.active = true;
  handler.activationIndex = activationIndex_++;
  for (auto it = recorded_.rbegin(); it != recorded_.rend(); ++it) {
    if (*it != &handler && cancelledBy(**it, handler)) {
      (*it)->cancel();
    }
  }
  for (auto *other : awaiting_) {
    if (cancelledBy(*other, handler)) {
      other->awaiting = false;
    }
  }
  if (!handler.isNative() && onClaim) {
    onClaim();
  }
  send(handler, GestureState::Active, GestureState::Began);
  if (current != GestureState::Active) {
    send(handler, GestureState::End, GestureState::Active);
    if (current != GestureState::End) {
      send(handler, GestureState::Undetermined, GestureState::End);
    }
  }
  if (handler.awaiting) {
    handler.awaiting = false;
    std::erase(awaiting_, &handler);
  }
}

void Gestures::stateChanged(GestureHandler &handler, GestureState next, GestureState previous) {
  ++changing_;
  if (finished(next)) {
    for (auto *other : std::vector<GestureHandler *>(awaiting_)) {
      if (!waitsFor(*other, handler) || !other->awaiting) {
        continue;
      }
      if (next != GestureState::End) {
        tryActivate(*other);
        continue;
      }
      other->cancel();
      // A discrete handler that ended while it waited was never reported active: it is told it
      // was cancelled from where it began, as the library does.
      if (other->state() == GestureState::End) {
        send(*other, GestureState::Cancelled, GestureState::Began);
      }
      other->awaiting = false;
    }
  }
  if (next == GestureState::Active) {
    tryActivate(handler);
  } else if (previous == GestureState::Active || previous == GestureState::End) {
    if (handler.active) {
      send(handler, next, previous);
    } else if (previous == GestureState::Active && (next == GestureState::Cancelled || next == GestureState::Failed)) {
      send(handler, next, GestureState::Began);
    }
  } else if (previous != GestureState::Undetermined || next != GestureState::Cancelled) {
    send(handler, next, previous);
  }
  --changing_;
  if (std::find(awaiting_.begin(), awaiting_.end(), &handler) == awaiting_.end()) {
    cleanupAwaiting(handler);
  }
}

void Gestures::send(GestureHandler &handler, GestureState next, GestureState previous) {
  // makeActive's own sequence (ACTIVE, then END and UNDETERMINED for a handler that already ended)
  // is the library's: a discrete handler that activated while waiting reports each step.
  if (next == previous) {
    if (handler.state() == GestureState::Active) {
      auto body = handler.eventData();
      sendEvent(handler, "onGestureHandlerEvent", std::move(body));
    }
    return;
  }
  auto body = handler.eventData();
  body["state"] = static_cast<int>(next);
  body["oldState"] = static_cast<int>(previous);
  sendEvent(handler, "onGestureHandlerStateChange", body);
  if (next == GestureState::Active) {
    body.erase("oldState");
    sendEvent(handler, "onGestureHandlerEvent", std::move(body));
  }
}

void Gestures::sendEvent(GestureHandler &handler, const std::string &name, folly::dynamic body) {
  switch (handler.action()) {
    case GestureAction::ReanimatedWorklet:
      if (onWorkletEvent) {
        onWorkletEvent(name, handler.view(), body);
      }
      break;
    case GestureAction::JsFunctionOldApi:
    case GestureAction::JsFunctionNewApi:
      if (onDeviceEvent) {
        onDeviceEvent(body);
      }
      break;
    default:
      break;
  }
}

} // namespace ngn
