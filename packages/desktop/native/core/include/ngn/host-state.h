// What the host knows about the app that JavaScript reads and listens to: whether it is active,
// its window's size, the colour scheme and the URLs it was asked to open. One for the app, set by
// the backend as things change; each runtime's modules subscribe to it, so a reload keeps it.
#pragma once

#include <folly/dynamic.h>

#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

// Listeners that can be dropped from any thread at any time. Dropping one waits for a call to it
// already running elsewhere, so once its handle is gone nothing calls into what it captured (a
// module a reload is destroying). A listener may drop its own handle while it is being called.
template <typename T>
class Listeners {
 public:
  using Listener = std::function<void(const T &)>;

  // Listens until the returned handle is destroyed.
  std::shared_ptr<void> add(Listener listener) {
    auto entry = std::make_shared<Entry>();
    entry->call = std::move(listener);
    int id;
    {
      std::lock_guard lock(state_->mutex);
      id = state_->next++;
      state_->entries[id] = entry;
    }
    std::weak_ptr<State> state = state_;
    return std::shared_ptr<void>(nullptr, [state, entry, id](void *) {
      {
        // Waits for a call in progress on another thread; the same thread re-enters.
        std::lock_guard calling(entry->calling);
        entry->live = false;
      }
      if (auto shared = state.lock()) {
        std::lock_guard lock(shared->mutex);
        shared->entries.erase(id);
      }
    });
  }

  bool empty() const {
    std::lock_guard lock(state_->mutex);
    return state_->entries.empty();
  }

  // Calls each listener, and answers how many were called: none when the last handle went while
  // this ran.
  size_t notify(const T &value) const {
    std::map<int, std::shared_ptr<Entry>> entries;
    {
      std::lock_guard lock(state_->mutex);
      entries = state_->entries;
    }
    size_t called = 0;
    for (auto &[_, entry] : entries) {
      std::lock_guard calling(entry->calling);
      if (entry->live) {
        entry->call(value);
        called++;
      }
    }
    return called;
  }

 private:
  struct Entry {
    std::recursive_mutex calling;
    bool live{true};
    Listener call;
  };
  // Shared with each handle, which may outlive these listeners.
  struct State {
    std::mutex mutex;
    std::map<int, std::shared_ptr<Entry>> entries;
    int next{0};
  };
  std::shared_ptr<State> state_ = std::make_shared<State>();
};

// A value with listeners. Setting it to what it already is notifies nobody. Listeners hear the
// values in the order they were set, a value set by a listener after the one it is hearing, and
// a set made while another thread is notifying returns at once, that thread notifying for it.
template <typename T>
class Watched {
 public:
  using Listener = std::function<void(const T &)>;

  explicit Watched(T value = T{}) : value_(std::move(value)) {}

  T get() const {
    std::lock_guard lock(mutex_);
    return value_;
  }

  void set(T value) {
    {
      std::lock_guard lock(mutex_);
      if (value_ == value) {
        return;
      }
      value_ = value;
      queued_.push_back(std::move(value));
      if (notifying_) {
        return;
      }
      notifying_ = true;
    }
    notifyQueued();
  }

  // Listens until the returned handle is destroyed.
  std::shared_ptr<void> listen(Listener listener) {
    return listeners_.add(std::move(listener));
  }

  // Listens, with `current` set to the value the listener's first call follows: a change made
  // between reading the value and listening is heard.
  std::shared_ptr<void> listen(Listener listener, T &current) {
    std::lock_guard lock(mutex_);
    current = value_;
    return listeners_.add(std::move(listener));
  }

 private:
  void notifyQueued() {
    for (;;) {
      std::optional<T> next;
      {
        std::lock_guard lock(mutex_);
        if (queued_.empty()) {
          notifying_ = false;
          return;
        }
        next = std::move(queued_.front());
        queued_.pop_front();
      }
      try {
        listeners_.notify(*next);
      } catch (...) {
        std::lock_guard lock(mutex_);
        queued_.clear();
        notifying_ = false;
        throw;
      }
    }
  }

  mutable std::mutex mutex_;
  T value_;
  // Set, and not yet sent to the listeners.
  std::deque<T> queued_;
  bool notifying_{false};
  Listeners<T> listeners_;
};

enum class Activity { Active, Inactive, Background };

struct Dimensions {
  double width{0};
  double height{0};
  double scale{1};
  double fontScale{1};
  bool operator==(const Dimensions &) const = default;
};

// The system's accessibility settings that apps adapt to, as React Native's AccessibilityInfo
// names them. A desktop without one of them reports it off.
struct AccessibilitySettings {
  // A screen reader is running (VoiceOver on macOS).
  bool screenReader{false};
  bool reduceMotion{false};
  bool reduceTransparency{false};
  bool invertColors{false};
  bool boldText{false};
  // Increase contrast, which iOS calls darker system colours.
  bool increaseContrast{false};
  bool grayscale{false};
  bool operator==(const AccessibilitySettings &) const = default;
};

struct WindowMetrics {
  Dimensions window;
  Dimensions screen;
  bool operator==(const WindowMetrics &) const = default;
};

class HostState {
 public:
  Watched<Activity> activity{Activity::Active};
  Watched<WindowMetrics> metrics;
  // "light" or "dark".
  Watched<std::string> colorScheme{"light"};
  // Set by the backend from the system's notifications, never by polling.
  Watched<AccessibilitySettings> accessibility;
  // The clipboard's change count (System::clipboardChangeCount), as the backend last checked it.
  // There is no change notification: the backend checks when the app becomes active and after
  // each key press, click and menu command, so an idle app never wakes to poll.
  Watched<int64_t> clipboardChangeCount{0};

  // The URL the app was launched to open, if any.
  void setInitialUrl(std::string url);
  std::optional<std::string> initialUrl() const;
  // A URL the app was asked to open while running. Each one is delivered once: to the listeners
  // there are, or, when there are none yet, to the first listener when it starts listening.
  void openUrl(const std::string &url);
  // A URL from the OS: a link to the app's scheme, or a file from Open With or a drop on the Dock
  // icon. Before the app has finished launching the first is the initial URL and the rest wait
  // for a listener; once it has, each is an event.
  void receiveUrl(std::string url, bool launched);
  std::shared_ptr<void> listenForUrls(std::function<void(const std::string &)> listener);

 private:
  mutable std::mutex mutex_;
  std::optional<std::string> initialUrl_;
  std::vector<std::string> pendingUrls_;
  Listeners<std::string> urlListeners_;
};

} // namespace ngn
