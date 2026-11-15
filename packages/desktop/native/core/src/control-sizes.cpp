#include "ngn/control-sizes.h"

#include <react/renderer/core/ConcreteState.h>

#include <cassert>
#include <cstdio>

using namespace facebook::react;

namespace ngn {

namespace {

class KeyBuilder {
 public:
  explicit KeyBuilder(ControlKind kind) {
    key_ += static_cast<char>('0' + static_cast<int>(kind));
  }
  KeyBuilder &add(const std::string &field) {
    key_ += '\x1f';
    key_ += field;
    return *this;
  }
  KeyBuilder &add(int field) {
    return add(std::to_string(field));
  }
  KeyBuilder &add(bool field) {
    return add(std::string(field ? "1" : "0"));
  }
  KeyBuilder &add(std::optional<double> field) {
    if (!field) {
      return add(std::string("-"));
    }
    char text[32];
    std::snprintf(text, sizeof text, "%.17g", *field);
    return add(std::string(text));
  }
  std::string take() {
    return std::move(key_);
  }

 private:
  std::string key_;
};

void updateMeasured(Tag /*tag*/, const State &state) {
  if (const auto *concrete = dynamic_cast<const ConcreteState<NativeControlState> *>(&state)) {
    concrete->updateState([](const NativeControlState &old) {
      return std::make_shared<const NativeControlState>(NativeControlState{.measured = old.measured + 1});
    });
  }
}

} // namespace

std::string controlSizeKey(ControlKind kind, const NativeControlProps &p) {
  KeyBuilder key(kind);
  key.add(static_cast<int>(p.controlSize));
  switch (kind) {
    case ControlKind::Button:
      key.add(p.title).add(p.kind).add(p.sfSymbol);
      break;
    case ControlKind::Switch:
      break;
    case ControlKind::ActivityIndicator:
      key.add(p.size);
      break;
    case ControlKind::SegmentedControl:
      key.add(p.momentary).add(static_cast<int>(p.values.size()));
      for (const auto &value : p.values) {
        key.add(value);
      }
      break;
    case ControlKind::DatePicker:
      key.add(p.mode).add(p.display).add(p.date);
      break;
    case ControlKind::SearchField:
      key.add(p.text).add(p.placeholder).add(p.fontFamily).add(p.fontSize).add(p.fontWeight.value_or(0)).add(p.italic);
      break;
  }
  return key.take();
}

ControlSizes::ControlSizes(
    std::shared_ptr<const ControlMeasurer> measurer,
    std::function<void(std::function<void()>)> runOnUiThread,
    std::function<bool()> onUiThread,
    Relayout relayout)
    : measurer_(std::move(measurer)),
      runOnUiThread_(std::move(runOnUiThread)),
      onUiThread_(std::move(onUiThread)),
      relayout_(relayout ? std::move(relayout) : Relayout(updateMeasured)) {}

Size ControlSizes::layoutSize(
    Tag tag,
    ControlKind kind,
    std::shared_ptr<const NativeControlProps> props,
    const State::Shared &state) {
  if (!measurer_ || !props) {
    return {0, 0};
  }
  auto key = controlSizeKey(kind, *props);
  {
    std::lock_guard lock(mutex_);
    hold(tag, key);
    auto &control = controls_[tag];
    if (auto found = sizes_.find(key); found != sizes_.end()) {
      control.size = found->second;
      queued_.erase(tag);
      return control.size;
    }
    if (!onUiThread_()) {
      queued_[tag] = Queued{.kind = kind, .props = std::move(props), .state = state};
      if (!posted_ && runOnUiThread_) {
        posted_ = true;
        runOnUiThread_([weak = weak_from_this()] {
          if (auto self = weak.lock()) {
            self->settle();
          }
        });
      }
      // Its last size until the measurement comes, or nothing for a control laid out first.
      return control.size;
    }
  }
  // Layout on the UI thread measures at once.
  auto size = measurer_->measure(kind, *props);
  std::lock_guard lock(mutex_);
  if (holders_.count(key) > 0) {
    sizes_[key] = size;
  }
  if (auto control = controls_.find(tag); control != controls_.end()) {
    control->second.size = size;
  }
  return size;
}

void ControlSizes::settle() {
  assert(onUiThread_() && "control sizes are measured on the UI thread");
  std::map<Tag, Queued> queued;
  {
    std::lock_guard lock(mutex_);
    posted_ = false;
    queued.swap(queued_);
  }
  for (const auto &[tag, request] : queued) {
    auto key = controlSizeKey(request.kind, *request.props);
    bool measure = false;
    {
      std::lock_guard lock(mutex_);
      // A control that has moved on to other inputs, or gone, no longer wants this size.
      auto control = controls_.find(tag);
      if (control == controls_.end() || control->second.key != key) {
        continue;
      }
      measure = sizes_.count(key) == 0;
    }
    if (measure) {
      auto size = measurer_->measure(request.kind, *request.props);
      std::lock_guard lock(mutex_);
      if (holders_.count(key) > 0) {
        sizes_[key] = size;
      }
    }
    if (request.state) {
      {
        std::lock_guard lock(mutex_);
        awaiting_.insert(tag);
      }
      relayout_(tag, *request.state);
    }
  }
}

void ControlSizes::relaidOut(Tag tag) {
  std::lock_guard lock(mutex_);
  awaiting_.erase(tag);
}

void ControlSizes::forget(Tag tag) {
  std::lock_guard lock(mutex_);
  if (auto control = controls_.find(tag); control != controls_.end()) {
    release(control->second.key);
    controls_.erase(control);
  }
  queued_.erase(tag);
  awaiting_.erase(tag);
}

bool ControlSizes::settled() const {
  std::lock_guard lock(mutex_);
  return queued_.empty() && awaiting_.empty();
}

size_t ControlSizes::held() const {
  std::lock_guard lock(mutex_);
  return sizes_.size();
}

void ControlSizes::hold(Tag tag, const std::string &key) {
  auto control = controls_.find(tag);
  if (control != controls_.end() && control->second.key == key) {
    return;
  }
  if (control != controls_.end()) {
    release(control->second.key);
  }
  controls_[tag].key = key;
  holders_[key]++;
}

void ControlSizes::release(const std::string &key) {
  auto holders = holders_.find(key);
  if (holders == holders_.end()) {
    return;
  }
  if (--holders->second == 0) {
    holders_.erase(holders);
    sizes_.erase(key);
  }
}

Size measureControl(const ShadowNode &node, ControlKind kind, const ContextContainer *context) {
  auto sizes = context ? context->find<std::shared_ptr<ControlSizes>>(kControlSizesKey) : std::nullopt;
  if (!sizes || !*sizes) {
    return {0, 0};
  }
  return (*sizes)->layoutSize(
      node.getTag(), kind, std::static_pointer_cast<const NativeControlProps>(node.getProps()), node.getState());
}

} // namespace ngn
