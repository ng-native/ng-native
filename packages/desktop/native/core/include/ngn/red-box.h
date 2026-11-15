// The dev red box: JavaScript's errors, fatal and soft, as React Native iOS's RCTRedBox shows
// them, in a window the backend draws. A dev run only.
//
// The runtime hands over every error React Native's error pipeline sees (its ProcessedError, from
// an exception listener registered before the bundle runs), whether or not LogBox, which draws
// nothing in an Angular app, takes it. The box shows the newest error with its stack, which the
// dev server symbolicates (`/symbolicate`) to the app's own sources, and keeps the earlier ones
// to step through. Dismiss clears them; a reload clears them and hides the box.
#pragma once

#include "ngn/network.h"

#include <folly/dynamic.h>

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct JsStackFrame {
  std::string methodName;
  std::string file;
  int line{-1};
  int column{-1};
  // React Native's own frames, which the dev server marks for hiding.
  bool collapse{false};
};

struct JsError {
  std::string message;
  std::vector<JsStackFrame> stack;
  std::string componentStack;
  bool fatal{false};
};

// The error the pipeline hands its listeners (message, stack, isFatal, componentStack), or
// nothing when it has no message.
std::optional<JsError> jsErrorFrom(const folly::dynamic &data);

// What the dev run's JavaScript hook (red-box-errors.js) hands over for an error logged with
// console.error or caught by ErrorUtils: its message, its Error's stack as a string, and whether
// it is fatal. Nothing when it has no message.
std::optional<JsError> jsErrorFromConsole(const folly::dynamic &data);

// The frames of a Hermes stack string ("    at name (file:line:column)", "    at file:line:column",
// "    at name (native)"); the message line and anything else are skipped.
std::vector<JsStackFrame> parseJsStack(const std::string &stack);

// A frame as the box lists it: "file:line:column", the file without the bundle URL's query or
// any directory.
std::string frameLocation(const JsStackFrame &frame);

// The frames the box lists: those the dev server did not collapse, or all of them when it
// collapsed every one.
std::vector<JsStackFrame> shownFrames(const JsError &error);

// What the window shows.
struct RedBoxContent {
  JsError error;
  // The error's place among those kept, from 0, and how many there are.
  size_t index{0};
  size_t count{0};
};

class RedBoxBackend {
 public:
  virtual ~RedBoxBackend() = default;
  // Shows the window, or updates it in place. Any thread; the backend moves to its own.
  virtual void show(const RedBoxContent &content) = 0;
  virtual void hide() = 0;
};

class RedBox {
 public:
  // `devServer` is the dev server's origin (http://localhost:8081), for symbolication; empty for
  // none. `http` may be null.
  RedBox(std::shared_ptr<RedBoxBackend> backend, std::shared_ptr<Http> http, std::string devServer);
  ~RedBox();
  RedBox(const RedBox &) = delete;
  RedBox &operator=(const RedBox &) = delete;

  // Any thread. An error with the newest kept one's message is that error reported again (by the
  // console and by React Native's pipeline): it is not kept twice, and makes the kept one fatal or
  // gives it a stack it lacked.
  void report(JsError error);
  // Steps to an earlier (-1) or later (+1) error.
  void step(int delta);
  void dismiss();
  // The app is reloading: everything kept is cleared and the box hides.
  void reloaded();

  bool showing() const;
  size_t count() const;

 private:
  // Asks for `error`'s stack for the kept error numbered `serial`. Called with the lock held.
  void symbolicate(uint64_t serial, const JsError &error);
  void showLocked(std::unique_lock<std::mutex> &lock);

  std::shared_ptr<RedBoxBackend> backend_;
  std::shared_ptr<Http> http_;
  std::string devServer_;
  mutable std::mutex mutex_;
  std::vector<JsError> errors_;
  // Each kept error's number, beside it: a symbolication finds its error by number, whatever was
  // pushed out or reported since it was asked for.
  std::vector<uint64_t> serials_;
  uint64_t nextSerial_{0};
  // Bumped by each clear, so a symbolication that answers after one is dropped.
  uint64_t generation_{0};
  size_t selected_{0};
  bool showing_{false};
  std::vector<std::unique_ptr<HttpTask>> tasks_;
};

} // namespace ngn
