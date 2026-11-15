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
  {
    std::lock_guard lock(mutex_);
    if (urlListeners_.empty()) {
      pendingUrls_.push_back(url);
      return;
    }
  }
  urlListeners_.notify(url);
}

std::shared_ptr<void> HostState::listenForUrls(std::function<void(const std::string &)> listener) {
  std::vector<std::string> pending;
  std::shared_ptr<void> handle;
  {
    // Added under the lock openUrl checks, so a URL arriving now is either pending here or sent.
    std::lock_guard lock(mutex_);
    handle = urlListeners_.add(listener);
    pending.swap(pendingUrls_);
  }
  for (const auto &url : pending) {
    listener(url);
  }
  return handle;
}

} // namespace ngn
