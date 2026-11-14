// react-native-gesture-handler's recognisers on the desktop, toolkit-free: the handlers
// RNGestureHandlerModule creates (pan, tap, long press, pinch, rotation, hover, native, manual,
// fling), their state machine, and the orchestrator that settles them against each other through
// their relations (simultaneous, requireToFail, blocksHandlers). Ported from the library's own
// shared implementation (src/web/handlers and src/web/tools/GestureHandlerOrchestrator.ts), which
// is the logic UIKit's recognisers give it on iOS.
//
// The backend's input comes in through the core's InputDispatcher, which hit-tests it against the
// ViewTree and hands it here in page coordinates (the surface's): presses and drags of the mouse,
// a trackpad's two-finger scroll, magnify and rotate, and hover. Events leave as the library's
// iOS module sends them: a JavaScript gesture's as RCTDeviceEventEmitter's
// `onGestureHandlerStateChange`, a worklet gesture's to Reanimated on the UI thread.
//
// UI thread only, like the tree it reads.
#pragma once

#include "ngn/input.h"
#include "ngn/view-tree.h"

#include <folly/dynamic.h>
#include <react/renderer/graphics/Point.h>

#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

using facebook::react::Point;

// `State` in react-native-gesture-handler.
enum class GestureState : int { Undetermined = 0, Failed = 1, Began = 2, Cancelled = 3, Active = 4, End = 5 };

// `ActionType`: how the handler's events reach JavaScript.
enum class GestureAction : int {
  None = 0,
  ReanimatedWorklet = 1,
  NativeAnimatedEvent = 2,
  JsFunctionOldApi = 3,
  JsFunctionNewApi = 4,
};

// A pointer as the handlers see it: in the surface's coordinates, the time in milliseconds.
struct GesturePointer {
  int id{0};
  Point page{};
  double time{0};
  // The DOM's `button`: 0 primary, 1 middle, 2 secondary.
  int button{0};
};


class Gestures;

class GestureHandler {
 public:
  GestureHandler(Gestures &owner, int tag, std::string name);
  virtual ~GestureHandler() = default;

  int tag() const {
    return tag_;
  }
  const std::string &name() const {
    return name_;
  }
  GestureState state() const {
    return state_;
  }
  Tag view() const {
    return view_;
  }
  GestureAction action() const {
    return action_;
  }
  bool enabled() const {
    return enabled_;
  }
  size_t trackedPointers() const {
    return pointers_.size();
  }
  bool tracks(int pointerId) const {
    return pointers_.count(pointerId) > 0;
  }
  bool isNative() const {
    return name_ == "NativeViewGestureHandler";
  }

  // Config from JavaScript (the library's ALLOWED_PROPS). `reset` starts from the defaults
  // (setGestureHandlerConfig); without it the keys given change what they name.
  void configure(const folly::dynamic &config, bool reset);
  void attach(Tag view, GestureAction action);
  void setRelations(std::vector<int> waitFor, std::vector<int> simultaneous, std::vector<int> blocks);

  // The input, as the orchestrator routes it.
  virtual void pointerDown(const GesturePointer &pointer);
  virtual void pointerMove(const GesturePointer &pointer, bool inBounds);
  virtual void pointerUp(const GesturePointer &pointer);
  virtual void pointerCancel();
  // The pointer moved over the view, or out of it, with no button down.
  virtual void hover(const GesturePointer &, bool /*inside*/) {}
  // A trackpad's two-finger scroll over the view, `delta` as the fingers moved, in points.
  virtual void scroll(const GesturePointer &, Point /*delta*/, std::optional<GesturePhase> /*phase*/) {}
  virtual void magnify(const GesturePointer &, double /*magnification*/, GesturePhase) {}
  // `degrees` anticlockwise, as AppKit reports a rotation.
  virtual void rotate(const GesturePointer &, double /*degrees*/, GesturePhase) {}
  // Whether the handler wants this kind of input at all, to be routed to it.
  virtual bool wantsHover() const {
    return false;
  }
  virtual bool wantsScroll() const {
    return false;
  }
  virtual bool wantsMagnify() const {
    return false;
  }
  virtual bool wantsRotate() const {
    return false;
  }

  void begin();
  void fail();
  void cancel();
  virtual void activate(bool force = false);
  void end();
  void reset();

  // The orchestrator's bookkeeping.
  bool active{false};
  bool awaiting{false};
  size_t activationIndex{0};

  bool shouldWaitFor(const GestureHandler &other) const;
  bool requiresToWaitFor(const GestureHandler &other) const;
  bool recognizesSimultaneously(const GestureHandler &other) const;
  bool cancelledBy(const GestureHandler &other) const;
  bool sharesPointers(const GestureHandler &other) const;

  // The event payload: what this handler adds (translation, scale) to the position and pointers.
  folly::dynamic eventData() const;
  // A touch event (onTouchesDown and the rest) for a handler that needs pointer data.
  void sendTouches(int eventType, const GesturePointer &changed);

 protected:
  virtual void readConfig(const folly::dynamic &config);
  virtual void resetConfig();
  virtual folly::dynamic extraData() const;
  virtual void onCancel() {}
  virtual void onReset() {}
  virtual void resetProgress() {}
  virtual void onStateChange(GestureState, GestureState) {}

  void moveToState(GestureState next);
  bool buttonAllowed(int button) const;
  void track(const GesturePointer &pointer);
  void untrack(int pointerId);
  Point average() const;
  Point velocity() const;
  // The view's origin in the surface, and its size.
  Point viewOrigin() const;
  // Runs `fn` after `ms` unless the handler resets first.
  void after(double ms, std::function<void()> fn);
  void clearTimer();

  Gestures &owner_;
  struct Track {
    Point page;
    std::deque<std::pair<double, Point>> samples;
  };
  std::map<int, Track> pointers_;
  Point lastAverage_{};
  bool shouldCancelWhenOutside_{false};
  bool needsPointerData_{false};
  bool manualActivation_{false};
  // A bitmask of the library's MouseButton (1 left, 2 right, 4 middle); nothing means left.
  std::optional<int> mouseButton_;

 private:
  int tag_;
  std::string name_;
  Tag view_{-1};
  GestureAction action_{GestureAction::None};
  GestureState state_{GestureState::Undetermined};
  std::optional<GestureState> lastSent_;
  bool enabled_{true};
  std::vector<int> waitFor_, simultaneous_, blocks_;
  std::function<void()> cancelTimer_;
};

// The registry and the orchestrator.
class Gestures {
 public:
  using Schedule = std::function<std::function<void()>(double ms, std::function<void()> fn)>;

  Gestures(const ViewTree &tree, Schedule schedule);
  ~Gestures();

  // RNGestureHandlerModule's methods.
  void create(const std::string &name, int handlerTag, const folly::dynamic &config);
  void attach(int handlerTag, Tag view, GestureAction action);
  void configure(int handlerTag, const folly::dynamic &config, bool reset);
  void relations(int handlerTag, const folly::dynamic &relations);
  void drop(int handlerTag);
  // A worklet's GestureStateManager (manual activation): begin, activate, fail, end or cancel.
  void setState(int handlerTag, int state);
  // Every handler, as a runtime reloads.
  void clear();

  // The input. `chain` is the hit test under the pointer, from the surface's root to the deepest.
  void pointerDown(SurfaceId surface, const std::vector<Tag> &chain, const GesturePointer &pointer);
  void pointerMove(const GesturePointer &pointer);
  void pointerUp(const GesturePointer &pointer);
  void pointerCancel();
  void hover(SurfaceId surface, const std::vector<Tag> &chain, const GesturePointer &pointer);
  // True when a handler took the scroll, so it should not also scroll the view under it.
  bool scroll(
      SurfaceId surface,
      const std::vector<Tag> &chain,
      const GesturePointer &pointer,
      Point delta,
      std::optional<GesturePhase> phase);
  void magnify(SurfaceId surface, const std::vector<Tag> &chain, const GesturePointer &pointer, double magnification, GesturePhase phase);
  void rotate(SurfaceId surface, const std::vector<Tag> &chain, const GesturePointer &pointer, double degrees, GesturePhase phase);

  // Whether any handler is attached to a view of `chain`.
  bool handles(const std::vector<Tag> &chain) const;

  // Where events go. `name` is `onGestureHandlerEvent` or `onGestureHandlerStateChange`.
  // A JavaScript gesture's events: RCTDeviceEventEmitter, under `onGestureHandlerStateChange` for
  // both kinds, as the library's iOS module sends them.
  std::function<void(const folly::dynamic &body)> onDeviceEvent;
  // A worklet gesture's: Reanimated's event handlers registered on the view.
  std::function<void(const std::string &name, Tag view, const folly::dynamic &body)> onWorkletEvent;
  // A handler other than a native one went active: the press JavaScript was told of is cancelled,
  // as the library's root view recogniser cancels React Native's touches on iOS.
  std::function<void()> onClaim;

  const ViewTree &tree() const {
    return tree_;
  }
  SurfaceId surface() const {
    return surface_;
  }
  double now() const {
    return now_;
  }
  const Schedule &schedule() const {
    return schedule_;
  }
  GestureHandler *find(int handlerTag) const;

  // From the handlers.
  void stateChanged(GestureHandler &handler, GestureState next, GestureState previous);
  void send(GestureHandler &handler, GestureState next, GestureState previous);
  void sendEvent(GestureHandler &handler, const std::string &name, folly::dynamic body);
  void record(GestureHandler &handler);
  bool recorded(const GestureHandler &handler) const;

 private:
  std::vector<GestureHandler *> handlersOn(const std::vector<Tag> &chain) const;
  bool inBounds(const GestureHandler &handler, Point page) const;
  void cleanup();
  void tryActivate(GestureHandler &handler);
  bool shouldActivate(GestureHandler &handler) const;
  void makeActive(GestureHandler &handler);
  void addAwaiting(GestureHandler &handler);
  void cleanupAwaiting(GestureHandler &handler);
  bool waitsFor(const GestureHandler &handler, const GestureHandler &other) const;
  bool simultaneous(const GestureHandler &a, const GestureHandler &b) const;
  bool cancelledBy(const GestureHandler &handler, const GestureHandler &other) const;
  bool hasToWait(const GestureHandler &handler) const;
  bool cancelledByFinished(const GestureHandler &handler) const;
  static bool finished(GestureState state);
  void cleanHandler(GestureHandler &handler);
  // Handlers the input is going to, settled after it as the library's microtask does.
  void settle();

  const ViewTree &tree_;
  Schedule schedule_;
  std::map<int, std::unique_ptr<GestureHandler>> handlers_;
  std::vector<GestureHandler *> recorded_;
  std::vector<GestureHandler *> awaiting_;
  size_t activationIndex_{0};
  int changing_{0};
  SurfaceId surface_{-1};
  double now_{0};
  // The handlers the press went to, which follow it until it is released.
  std::vector<int> pressed_;
  std::vector<int> hovered_;
  std::vector<int> scrolling_;
  std::vector<int> magnifying_;
  std::vector<int> rotating_;
};

} // namespace ngn
