#include "ngn/animation-frames.h"

namespace ngn {

void AnimationFrames::request(Callback callback) {
  std::unique_lock lock(mutex_);
  waiting_.push_back(std::move(callback));
  setWanted(true, lock);
}

void AnimationFrames::frame(double timestampMs) {
  std::vector<Callback> running;
  {
    std::lock_guard lock(mutex_);
    running.swap(waiting_);
  }
  for (auto &callback : running) {
    callback(timestampMs);
  }
  std::unique_lock lock(mutex_);
  if (waiting_.empty()) {
    setWanted(false, lock);
  }
}

void AnimationFrames::clear() {
  std::unique_lock lock(mutex_);
  waiting_.clear();
  setWanted(false, lock);
}

bool AnimationFrames::wanted() const {
  std::lock_guard lock(mutex_);
  return wanted_;
}

void AnimationFrames::setWanted(bool wanted, std::unique_lock<std::mutex> &lock) {
  if (wanted_ == wanted) {
    return;
  }
  wanted_ = wanted;
  auto told = onWanted;
  lock.unlock();
  if (told) {
    told(wanted);
  }
}

} // namespace ngn
