#include "ngn/host-state.h"

namespace ngn {

void HostState::setInitialUrl(std::string url) {
  std::lock_guard lock(mutex_);
  initialUrl_ = std::move(url);
}

std::optional<std::string> HostState::initialUrl() const {
  std::lock_guard lock(mutex_);
  return initialUrl_;
}

void HostState::receiveUrl(std::string url, bool launched) {
  if (!launched) {
    std::lock_guard lock(mutex_);
    if (!initialUrl_) {
      initialUrl_ = std::move(url);
      return;
    }
  }
  openUrl(url);
}

void HostState::openUrl(const std::string &url) {
  std::map<int, std::function<void(const std::string &)>> listeners;
  {
    std::lock_guard lock(mutex_);
    if (urlListeners_.empty()) {
      pendingUrls_.push_back(url);
      return;
    }
    listeners = urlListeners_;
  }
  for (auto &[_, listener] : listeners) {
    listener(url);
  }
}

std::shared_ptr<void> HostState::listenForUrls(std::function<void(const std::string &)> listener) {
  std::vector<std::string> pending;
  int id;
  {
    std::lock_guard lock(mutex_);
    id = next_++;
    urlListeners_[id] = listener;
    pending.swap(pendingUrls_);
  }
  for (const auto &url : pending) {
    listener(url);
  }
  return std::shared_ptr<void>(nullptr, [this, id](void *) {
    std::lock_guard lock(mutex_);
    urlListeners_.erase(id);
  });
}

} // namespace ngn
