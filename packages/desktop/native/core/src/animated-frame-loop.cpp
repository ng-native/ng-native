#include "ngn/animated-frame-loop.h"

#include <react/renderer/animated/NativeAnimatedNodesManagerProvider.h>

#include <cstdint>
#include <mutex>
#include <utility>

namespace ngn {

// What a frame's request reads when it runs. A stop and a start between two frames leave the first
// start's request waiting: the run it belongs to (`run`) tells it from the new one, so it renders
// nothing and asks for no frame after.
struct AnimatedFrameLoop::State {
  explicit State(AnimationFrames &frames) : frames(frames) {}

  AnimationFrames &frames;
  std::mutex mutex;
  // Held for the length of a render, which a stop waits on: React Native's manager is destroyed,
  // stopping the loop on the way, on a reload's own thread, while the UI thread may be inside its
  // render. Recursive, as the manager stops the loop from inside its render too.
  std::recursive_mutex rendering;
  std::function<void()> render;
  std::uint64_t run = 0;
  bool running = false;
  // Closed for good, as its ReactHost goes: a start from the manager that is going does nothing.
  bool closed = false;
  // While a render runs, and whether a start came during it. React Native clears its own started
  // flag before it stops the loop from inside its render, so JavaScript can start it again in
  // between: that start comes before the stop, which must not drop it, or no frame comes and React
  // Native, taking the loop to be running, never starts it again.
  bool inRender = false;
  bool startedInRender = false;
};

namespace {

void requestFrame(const std::shared_ptr<AnimatedFrameLoop::State> &state, std::uint64_t run);

void onFrame(const std::weak_ptr<AnimatedFrameLoop::State> &weak, std::uint64_t run) {
  auto state = weak.lock();
  if (!state) {
    return;
  }
  {
    std::lock_guard rendering(state->rendering);
    std::function<void()> render;
    {
      std::lock_guard lock(state->mutex);
      if (!state->running || state->run != run) {
        return;
      }
      render = state->render;
      state->inRender = true;
      state->startedInRender = false;
    }
    // Outside the lock: the manager stops the loop from inside its render once nothing animates.
    render();
  }
  {
    std::lock_guard lock(state->mutex);
    state->inRender = false;
    if (!state->running || state->run != run) {
      return;
    }
  }
  requestFrame(state, run);
}

void requestFrame(const std::shared_ptr<AnimatedFrameLoop::State> &state, std::uint64_t run) {
  std::weak_ptr<AnimatedFrameLoop::State> weak = state;
  state->frames.request([weak, run](double) { onFrame(weak, run); });
}

} // namespace

AnimatedFrameLoop::AnimatedFrameLoop(AnimationFrames &frames) : state_(std::make_shared<State>(frames)) {}

AnimatedFrameLoop::~AnimatedFrameLoop() {
  close();
}

void AnimatedFrameLoop::start(std::function<void()> render) {
  std::uint64_t run = 0;
  {
    std::lock_guard lock(state_->mutex);
    if (state_->closed) {
      return;
    }
    state_->render = std::move(render);
    state_->startedInRender = state_->startedInRender || state_->inRender;
    if (state_->running) {
      return;
    }
    state_->running = true;
    run = ++state_->run;
  }
  requestFrame(state_, run);
}

void AnimatedFrameLoop::stop() {
  // Released after the lock, in case its closure's destructor reaches the loop.
  std::function<void()> released;
  {
    std::lock_guard lock(state_->mutex);
    // A stop from a render that a start overtook: what the start asked for stands, and the loop goes
    // on with it. Not once closed, which stops it whatever came before.
    if (state_->inRender && state_->startedInRender && !state_->closed) {
      return;
    }
    state_->running = false;
    released = std::move(state_->render);
    state_->render = nullptr;
  }
  // A render running on another thread returns before this does, so what it renders with outlives
  // it; none starts after, as the loop no longer runs.
  std::lock_guard rendering(state_->rendering);
}

void AnimatedFrameLoop::close() {
  {
    std::lock_guard lock(state_->mutex);
    state_->closed = true;
  }
  // Waits for a render on another thread, whether or not that render stopped the loop itself.
  stop();
}

bool AnimatedFrameLoop::running() const {
  std::lock_guard lock(state_->mutex);
  return state_->running;
}

bool AnimatedFrameLoop::closed() const {
  std::lock_guard lock(state_->mutex);
  return state_->closed;
}

std::shared_ptr<facebook::react::NativeAnimatedNodesManagerProvider> animatedNodesManagerProvider(
    std::shared_ptr<AnimatedFrameLoop> loop) {
  std::weak_ptr<AnimatedFrameLoop> weak = loop;
  return std::make_shared<facebook::react::NativeAnimatedNodesManagerProvider>(
      // The loop is the provider's to keep: the runtime holds the provider through its ReactHost.
      [loop](std::function<void()> &&render, bool /*isAsync*/) { loop->start(std::move(render)); },
      [weak](bool /*isAsync*/) {
        if (auto loop = weak.lock()) {
          loop->stop();
        }
      });
}

} // namespace ngn
