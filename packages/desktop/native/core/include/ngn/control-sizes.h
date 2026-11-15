// The native controls' intrinsic sizes, measured on the UI thread and read by layout.
//
// A toolkit's controls (AppKit's cells) are UI-thread only, and layout runs on the JS thread, which
// never waits on the UI thread. So layout reads a cache, keyed by the inputs a control's size
// depends on (controlSizeKey), and never measures off the UI thread:
//
// - A hit is the size.
// - A miss on the UI thread is measured there at once.
// - A miss anywhere else lays the control out at the size it last had (nothing, for a new one),
//   queues it and posts a settle to the UI thread. The settle measures what is queued, fills the
//   cache and asks each queued control for a layout again with a state update, which lays it out
//   with the size. Until the mount that carries that state, the controls are not settled, and the
//   app window is held as it is for its safe areas: its first frame draws the controls at their
//   size. A control added to a window already on screen draws at its last size, or not at all,
//   for one frame.
//
// Every size belongs to the controls laid out with its inputs: one whose inputs change lets go of
// the old size, a deleted one lets go of its own, and a size no control holds is dropped.
#pragma once

#include "ngn/native-controls.h"

#include <react/renderer/core/State.h>

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <unordered_map>

namespace ngn {

using facebook::react::Tag;

// The inputs a control's size depends on, as one string: its kind and what it draws (title,
// symbol, segments, date, font and so on). Props that do not change its size (enabled, value,
// colours) are not in it.
std::string controlSizeKey(ControlKind kind, const NativeControlProps &props);

// Made with std::make_shared: a posted settle holds it weakly.
class ControlSizes : public std::enable_shared_from_this<ControlSizes> {
 public:
  // Asks the control `tag`, whose state is `state`, for a layout again. The default updates its
  // state.
  using Relayout = std::function<void(Tag tag, const facebook::react::State &state)>;

  // `runOnUiThread` runs a task on the UI thread later, and `onUiThread` says whether the caller is
  // on it.
  ControlSizes(
      std::shared_ptr<const ControlMeasurer> measurer,
      std::function<void(std::function<void()>)> runOnUiThread,
      std::function<bool()> onUiThread,
      Relayout relayout = nullptr);

  // Layout, any thread: the size of the control `tag` with `props`. `state` is the node's.
  facebook::react::Size layoutSize(
      Tag tag,
      ControlKind kind,
      std::shared_ptr<const NativeControlProps> props,
      const facebook::react::State::Shared &state);

  // UI thread: measures every control layout queued, and asks each for a layout again.
  void settle();
  // UI thread: a mount gave `tag` a new state, the one a settle asked for or a later one.
  void relaidOut(Tag tag);
  // UI thread: the control `tag` was deleted.
  void forget(Tag tag);

  // Whether no control waits for a measurement or for the layout after one.
  bool settled() const;
  // How many sizes are held, for the tests.
  size_t held() const;

 private:
  struct Control {
    std::string key;
    facebook::react::Size size{};
  };
  struct Queued {
    ControlKind kind;
    std::shared_ptr<const NativeControlProps> props;
    facebook::react::State::Shared state;
  };
  // With mutex_ held.
  void hold(Tag tag, const std::string &key);
  void release(const std::string &key);

  std::shared_ptr<const ControlMeasurer> measurer_;
  std::function<void(std::function<void()>)> runOnUiThread_;
  std::function<bool()> onUiThread_;
  Relayout relayout_;

  mutable std::mutex mutex_;
  std::unordered_map<std::string, facebook::react::Size> sizes_;
  // How many controls hold each key.
  std::unordered_map<std::string, int> holders_;
  std::unordered_map<Tag, Control> controls_;
  std::map<Tag, Queued> queued_;
  std::set<Tag> awaiting_;
  bool posted_{false};
};

inline constexpr const char *kControlSizesKey = "ngn.ControlSizes";

inline void installControlSizes(facebook::react::ContextContainer &context, std::shared_ptr<ControlSizes> sizes) {
  context.insert(kControlSizesKey, std::move(sizes));
}

} // namespace ngn
