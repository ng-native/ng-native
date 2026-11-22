// The frames React Native's animated module (AnimatedModule, NativeAnimatedNodesManager) renders
// on, from the host's display frames: what React Native iOS's RCTAnimatedModuleProvider does over a
// display link. The manager starts the loop when an animation or a value it drives needs a frame and
// stops it once nothing does, so an app with nothing animating takes no frames for it.
#pragma once

#include "ngn/animation-frames.h"

#include <functional>
#include <memory>

namespace facebook::react {
class NativeAnimatedNodesManagerProvider;
}

namespace ngn {

class AnimatedFrameLoop {
 public:
  explicit AnimatedFrameLoop(AnimationFrames &frames);
  ~AnimatedFrameLoop();
  AnimatedFrameLoop(const AnimatedFrameLoop &) = delete;
  AnimatedFrameLoop &operator=(const AnimatedFrameLoop &) = delete;

  // Any thread. `render` runs on the UI thread once each display frame until `stop`. A start while
  // running replaces the callback.
  void start(std::function<void()> render);
  // Any thread, the render itself too.
  void stop();
  // Any thread but the render's: stops the loop for good, once a render running on another thread
  // has returned. A reload closes it before it destroys the ReactHost whose manager renders here.
  void close();

  // Whether it renders each frame, and whether it is closed. Any thread.
  bool running() const;
  bool closed() const;
  // How many stops or closes are waiting for a render on another thread to return. Any thread.
  int waiting() const;

  // What a frame waiting for the loop holds: the loop may be gone by the frame.
  struct State;

 private:
  std::shared_ptr<State> state_;
};

// React Native's animated module over this loop, for a ReactHost: one each, as a reload's new
// instance has a new UIManager. Animated's native driver and the engine's native paint then run on
// the host's frames instead of a commit a frame from JavaScript.
std::shared_ptr<facebook::react::NativeAnimatedNodesManagerProvider> animatedNodesManagerProvider(
    std::shared_ptr<AnimatedFrameLoop> loop);

} // namespace ngn
