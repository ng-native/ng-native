// Frame callbacks for animations that run on the UI thread: react-native-worklets'
// requestAnimationFrame and Reanimated's frames. What React Native iOS's AnimationFrameQueue and
// REANodesManager do over a CADisplayLink, without the display link: the backend drives `frame`
// from its own (CVDisplayLink, NSView.displayLink) while `wanted`, and stops it after the frame
// that leaves nothing waiting, so an app with nothing animating takes no frames at all.
#pragma once

#include <functional>
#include <mutex>
#include <vector>

namespace ngn {

class AnimationFrames {
 public:
  // Gets the frame's timestamp in milliseconds, on the clock the backend's `now` reads.
  using Callback = std::function<void(double timestampMs)>;

  // Any thread. The callback runs on the next frame, once.
  void request(Callback callback);
  // UI thread: a display frame. Runs the callbacks waiting when it starts; one they request runs
  // on the frame after.
  void frame(double timestampMs);
  // Any thread. Drops what waits, as the runtime that asked goes away.
  void clear();
  bool wanted() const;

  // Told, on the thread that changed it, each time frames start or stop being wanted.
  std::function<void(bool wanted)> onWanted;

 private:
  void setWanted(bool wanted, std::unique_lock<std::mutex> &lock);

  mutable std::mutex mutex_;
  std::vector<Callback> waiting_;
  bool wanted_{false};
};

} // namespace ngn
