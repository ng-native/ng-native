#include "ngn/red-box.h"

#include <folly/json.h>
#include <glog/logging.h>

#include <algorithm>

namespace ngn {

namespace {

int intOr(const folly::dynamic &value, int fallback) {
  return value.isNumber() ? static_cast<int>(value.asDouble()) : fallback;
}

std::string stringOr(const folly::dynamic &value) {
  return value.isString() ? value.asString() : std::string{};
}

std::vector<JsStackFrame> framesFrom(const folly::dynamic &stack) {
  std::vector<JsStackFrame> frames;
  if (!stack.isArray()) {
    return frames;
  }
  for (const auto &f : stack) {
    if (!f.isObject()) {
      continue;
    }
    frames.push_back({
        .methodName = stringOr(f.getDefault("methodName")),
        .file = stringOr(f.getDefault("file")),
        .line = intOr(f.getDefault("lineNumber"), -1),
        .column = intOr(f.getDefault("column"), -1),
        .collapse = f.getDefault("collapse").isBool() && f.getDefault("collapse").asBool(),
    });
  }
  return frames;
}

// "file:line:column" (or "file:line"), split from the right, as a URL has colons of its own.
JsStackFrame location(std::string methodName, std::string place) {
  const std::string address = "address at ";
  if (place.rfind(address, 0) == 0) {
    place = place.substr(address.size());
  }
  JsStackFrame frame{.methodName = std::move(methodName), .file = place};
  auto number = [](const std::string &s) -> std::optional<int> {
    if (s.empty() || !std::all_of(s.begin(), s.end(), [](char c) { return c >= '0' && c <= '9'; })) {
      return std::nullopt;
    }
    return std::stoi(s);
  };
  auto last = place.rfind(':');
  if (last == std::string::npos) {
    return frame;
  }
  auto tail = number(place.substr(last + 1));
  if (!tail) {
    return frame;
  }
  auto before = place.rfind(':', last - 1);
  auto middle = before == std::string::npos ? std::nullopt : number(place.substr(before + 1, last - before - 1));
  if (middle) {
    frame.file = place.substr(0, before);
    frame.line = *middle;
    frame.column = *tail;
  } else {
    frame.file = place.substr(0, last);
    frame.line = *tail;
  }
  return frame;
}

// How many errors the box keeps; the oldest go first.
constexpr size_t kKept = 50;

} // namespace

std::optional<JsError> jsErrorFrom(const folly::dynamic &data) {
  if (!data.isObject()) {
    return std::nullopt;
  }
  auto message = stringOr(data.getDefault("message"));
  if (message.empty()) {
    return std::nullopt;
  }
  return JsError{
      .message = std::move(message),
      .stack = framesFrom(data.getDefault("stack")),
      .componentStack = stringOr(data.getDefault("componentStack")),
      .fatal = data.getDefault("isFatal").isBool() && data.getDefault("isFatal").asBool(),
  };
}

std::vector<JsStackFrame> parseJsStack(const std::string &stack) {
  std::vector<JsStackFrame> frames;
  size_t start = 0;
  while (start <= stack.size()) {
    auto end = stack.find('\n', start);
    auto line = stack.substr(start, end == std::string::npos ? std::string::npos : end - start);
    start = end == std::string::npos ? stack.size() + 1 : end + 1;
    auto at = line.find_first_not_of(" \t");
    if (at == std::string::npos || line.compare(at, 3, "at ") != 0) {
      continue;
    }
    auto rest = line.substr(at + 3);
    while (!rest.empty() && (rest.back() == '\r' || rest.back() == ' ')) {
      rest.pop_back();
    }
    auto open = rest.rfind(" (");
    if (open != std::string::npos && rest.back() == ')') {
      frames.push_back(location(rest.substr(0, open), rest.substr(open + 2, rest.size() - open - 3)));
    } else {
      frames.push_back(location("", rest));
    }
  }
  return frames;
}

std::optional<JsError> jsErrorFromConsole(const folly::dynamic &data) {
  if (!data.isObject()) {
    return std::nullopt;
  }
  auto message = stringOr(data.getDefault("message"));
  if (message.empty()) {
    return std::nullopt;
  }
  return JsError{
      .message = std::move(message),
      .stack = parseJsStack(stringOr(data.getDefault("stack"))),
      .fatal = data.getDefault("isFatal").isBool() && data.getDefault("isFatal").asBool(),
  };
}

std::string frameLocation(const JsStackFrame &frame) {
  std::string file = frame.file.substr(0, frame.file.find('?'));
  if (auto slash = file.rfind('/'); slash != std::string::npos) {
    file = file.substr(slash + 1);
  }
  if (file.empty() || frame.line < 0) {
    return file;
  }
  return file + ":" + std::to_string(frame.line) + (frame.column >= 0 ? ":" + std::to_string(frame.column) : "");
}

std::vector<JsStackFrame> shownFrames(const JsError &error) {
  std::vector<JsStackFrame> shown;
  std::copy_if(error.stack.begin(), error.stack.end(), std::back_inserter(shown), [](const JsStackFrame &f) {
    return !f.collapse;
  });
  return shown.empty() ? error.stack : shown;
}

RedBox::RedBox(std::shared_ptr<RedBoxBackend> backend, std::shared_ptr<Http> http, std::string devServer)
    : log([](const std::string &text) { LOG(ERROR) << "JavaScript error, symbolicated: " << text; }),
      backend_(std::move(backend)),
      http_(std::move(http)),
      devServer_(std::move(devServer)) {}

// The error's message, then "    at <method> (<file>:<line>:<column>)" for each frame the box lists.
static std::string symbolicatedText(const JsError &error) {
  std::string text = error.message;
  for (const auto &frame : shownFrames(error)) {
    text += "\n    at " + (frame.methodName.empty() ? std::string{"<anonymous>"} : frame.methodName) + " (" + frame.file;
    if (frame.line >= 0) {
      text += ":" + std::to_string(frame.line) + (frame.column >= 0 ? ":" + std::to_string(frame.column) : "");
    }
    text += ")";
  }
  return text;
}

void RedBox::report(JsError error) {
  std::unique_lock lock(mutex_);
  if (!errors_.empty() && errors_.back().message == error.message) {
    auto &kept = errors_.back();
    bool fatal = error.fatal && !kept.fatal;
    bool stack = !error.stack.empty() && kept.stack.empty();
    if (!fatal && !stack) {
      return;
    }
    kept.fatal = kept.fatal || error.fatal;
    if (stack) {
      kept.stack = std::move(error.stack);
    }
    if (error.componentStack.size() > kept.componentStack.size()) {
      kept.componentStack = std::move(error.componentStack);
    }
    if (!holdsFatal()) {
      selected_ = errors_.size() - 1;
    }
    // Taken before the show lets the lock go.
    uint64_t serial = serials_.back();
    JsError copy = kept;
    showLocked(lock);
    if (stack) {
      symbolicate(serial, copy);
    }
    return;
  }
  bool hold = holdsFatal();
  if (errors_.size() == kKept) {
    errors_.erase(errors_.begin());
    serials_.erase(serials_.begin());
    // The error on show moved down a place, unless it was the one pushed out.
    hold = hold && selected_ > 0;
    selected_ = hold ? selected_ - 1 : selected_;
  }
  errors_.push_back(error);
  uint64_t serial = nextSerial_++;
  serials_.push_back(serial);
  if (!hold) {
    selected_ = errors_.size() - 1;
  }
  showLocked(lock);
  symbolicate(serial, error);
}

// A fatal error on show keeps the box: the errors after it (AppRegistry's `"main" has not been
// registered` after a module that threw as the bundle loaded) follow from it, so they are kept
// behind it, as React Native's LogBox keeps its first fatal error open. Stepped away from it, or
// showing a soft one, the box moves to each new error as it comes.
bool RedBox::holdsFatal() const {
  return showing_ && selected_ < errors_.size() && errors_[selected_].fatal;
}

void RedBox::step(int delta) {
  std::unique_lock lock(mutex_);
  if (errors_.empty()) {
    return;
  }
  auto next = static_cast<long>(selected_) + delta;
  selected_ = static_cast<size_t>(std::clamp<long>(next, 0, static_cast<long>(errors_.size()) - 1));
  showLocked(lock);
}

RedBox::~RedBox() {
  std::vector<std::unique_ptr<HttpTask>> tasks;
  {
    std::lock_guard lock(mutex_);
    tasks.swap(tasks_);
  }
  for (auto &task : tasks) {
    task->cancel();
  }
}

void RedBox::dismiss() {
  std::unique_lock lock(mutex_);
  errors_.clear();
  serials_.clear();
  ++generation_;
  std::vector<std::unique_ptr<HttpTask>> tasks;
  tasks.swap(tasks_);
  bool wasShowing = showing_;
  showing_ = false;
  lock.unlock();
  // Outside the lock: a cancel may wait for a callback that is waiting for it.
  for (auto &task : tasks) {
    task->cancel();
  }
  if (wasShowing) {
    backend_->hide();
  }
}

void RedBox::reloaded() {
  dismiss();
}

bool RedBox::showing() const {
  std::lock_guard lock(mutex_);
  return showing_;
}

size_t RedBox::count() const {
  std::lock_guard lock(mutex_);
  return errors_.size();
}

void RedBox::showLocked(std::unique_lock<std::mutex> &lock) {
  RedBoxContent content{.error = errors_[selected_], .index = selected_, .count = errors_.size()};
  showing_ = true;
  lock.unlock();
  backend_->show(content);
  lock.lock();
}

void RedBox::symbolicate(uint64_t serial, const JsError &error) {
  if (!http_ || devServer_.empty() || error.stack.empty()) {
    return;
  }
  folly::dynamic stack = folly::dynamic::array();
  for (const auto &frame : error.stack) {
    stack.push_back(folly::dynamic::object("methodName", frame.methodName)("file", frame.file)("lineNumber", frame.line)(
        "column", frame.column));
  }
  HttpRequest request;
  request.method = "POST";
  request.url = devServer_ + "/symbolicate";
  request.headers = {{"Content-Type", "application/json"}};
  request.body = folly::toJson(folly::dynamic::object("stack", std::move(stack))("extraData", folly::dynamic::object()));
  request.withCredentials = false;

  auto body = std::make_shared<std::string>();
  auto ok = std::make_shared<bool>(false);
  auto generation = generation_;
  HttpCallbacks callbacks;
  callbacks.onResponse = [ok](const HttpResponse &response) { *ok = response.status == 200; };
  callbacks.onData = [body](std::string chunk, int64_t) { body->append(chunk); };
  callbacks.onComplete = [this, body, ok, generation, serial](const std::string &failure, bool) {
    if (!failure.empty() || !*ok) {
      return;
    }
    folly::dynamic answer;
    try {
      answer = folly::parseJson(*body);
    } catch (const std::exception &) {
      return;
    }
    auto frames = framesFrom(answer.getDefault("stack"));
    if (frames.empty()) {
      return;
    }
    std::unique_lock lock(mutex_);
    auto found = std::find(serials_.begin(), serials_.end(), serial);
    if (generation != generation_ || found == serials_.end()) {
      return;
    }
    size_t index = static_cast<size_t>(found - serials_.begin());
    errors_[index].stack = std::move(frames);
    std::string logged = errors_[index].fatal ? symbolicatedText(errors_[index]) : std::string{};
    if (showing_ && selected_ == index) {
      showLocked(lock);
    }
    lock.unlock();
    if (!logged.empty() && log) {
      log(logged);
    }
  };
  tasks_.push_back(http_->send(std::move(request), std::move(callbacks)));
}

} // namespace ngn
