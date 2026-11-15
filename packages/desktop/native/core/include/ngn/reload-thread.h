// The thread a runtime reloads on, apart from the runtime so the run never touches it once its
// work is done. Each run has its own completion state: a run's `done` may start the next run or
// destroy the owner, and neither leaves a later join waiting on the wrong run or a write to freed
// memory. Once closed, it starts no run, so nothing outlives the owner's close. Toolkit-free.
#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>

namespace ngn {

class ReloadThread {
 public:
  ReloadThread() = default;
  ReloadThread(const ReloadThread &) = delete;
  ReloadThread &operator=(const ReloadThread &) = delete;
  ~ReloadThread() {
    close([] {});
  }

  // Runs `work` on a thread of its own, unless closed: false then, and `work` never runs. The run
  // before must have been joined.
  bool start(std::function<void()> work) {
    auto finished = std::make_shared<std::atomic<bool>>(false);
    std::lock_guard lock(mutex_);
    if (closed_) {
      return false;
    }
    finished_ = finished;
    thread_ = std::thread([work = std::move(work), finished] {
      work();
      // Only the run's own state: the owner may be gone by now.
      *finished = true;
    });
    return true;
  }

  // Starts no run from now on, then joins as `join` does. A `done` that reloads while the close
  // waits starts nothing, so the run joined is the last. From a run's own thread, returns at once.
  void close(const std::function<void()> &service) {
    {
      std::lock_guard lock(mutex_);
      closed_ = true;
    }
    join(service);
  }

  // Waits for the run started last, calling `service` until it ends (the UI thread's queue, which
  // the run can need). From that run's own thread (its `done` reloading or destroying the owner),
  // returns at once and leaves the run to end on its own.
  void join(const std::function<void()> &service) {
    std::thread thread;
    std::shared_ptr<std::atomic<bool>> finished;
    {
      std::lock_guard lock(mutex_);
      if (!thread_.joinable()) {
        return;
      }
      if (thread_.get_id() == std::this_thread::get_id()) {
        thread_.detach();
        return;
      }
      thread = std::move(thread_);
      finished = finished_;
    }
    while (!*finished) {
      service();
      std::this_thread::yield();
    }
    thread.join();
  }

 private:
  std::mutex mutex_;
  std::thread thread_;
  std::shared_ptr<std::atomic<bool>> finished_;
  bool closed_{false};
};

} // namespace ngn
