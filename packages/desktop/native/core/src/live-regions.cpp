#include "ngn/live-regions.h"

#include <react/renderer/components/view/ViewProps.h>

using namespace facebook::react;

namespace ngn {

namespace {

const ViewProps *viewProps(const ShadowView &view) {
  return dynamic_cast<const ViewProps *>(view.props.get());
}

bool hidden(const ViewProps &props) {
  return props.accessibilityElementsHidden ||
      props.importantForAccessibility == ImportantForAccessibility::NoHideDescendants;
}

void append(std::string &out, const std::string &text) {
  if (text.empty()) {
    return;
  }
  if (!out.empty()) {
    out += ' ';
  }
  out += text;
}

} // namespace

LiveRegions::LiveRegions(const ViewTree &tree, TextOf textOf) : tree_(tree), textOf_(std::move(textOf)) {}

void LiveRegions::update(const ShadowView &view) {
  const auto *props = viewProps(view);
  auto live = props ? props->accessibilityLiveRegion : AccessibilityLiveRegion::None;
  if (live == AccessibilityLiveRegion::None) {
    regions_.erase(view.tag);
    return;
  }
  auto priority = live == AccessibilityLiveRegion::Assertive ? AnnouncementPriority::High : AnnouncementPriority::Medium;
  auto [it, added] = regions_.try_emplace(view.tag, Region{view.surfaceId, priority, "", true});
  it->second.priority = priority;
}

void LiveRegions::remove(Tag tag) {
  regions_.erase(tag);
}

std::vector<Announcement> LiveRegions::didMount(SurfaceId surfaceId) {
  std::vector<Announcement> said;
  for (auto &[tag, region] : regions_) {
    if (region.surfaceId != surfaceId || !tree_.contains(tag)) {
      continue;
    }
    // A hidden region, or one under a hidden view or a covered screen, says nothing, and what it
    // held stays the text its next change is compared with.
    if (hiddenAt(tag)) {
      continue;
    }
    auto text = textOf(tag);
    bool news = !region.fresh && !text.empty() && text != region.text;
    region.fresh = false;
    region.text = text;
    if (news) {
      said.push_back({text, region.priority});
    }
  }
  return said;
}

bool LiveRegions::hiddenAt(Tag tag) const {
  for (const auto *node = tree_.find(tag); node != nullptr; node = tree_.find(node->parent)) {
    // A covered screen (an unselected tab, a screen under a pushed one) is out of the
    // accessibility tree, as a hidden view is.
    if (tree_.covered(node->view.tag)) {
      return true;
    }
    if (const auto *props = viewProps(node->view); props && hidden(*props)) {
      return true;
    }
  }
  return false;
}

std::string LiveRegions::textOf(Tag tag) const {
  const auto *node = tree_.find(tag);
  if (node == nullptr) {
    return "";
  }
  if (const auto *props = viewProps(node->view); props && !props->accessibilityLabel.empty()) {
    return props->accessibilityLabel;
  }
  std::string out;
  append(out, textOf_(node->view));
  for (auto child : node->children) {
    collect(child, out);
  }
  return out;
}

void LiveRegions::collect(Tag tag, std::string &out) const {
  const auto *node = tree_.find(tag);
  if (node == nullptr) {
    return;
  }
  const auto *props = viewProps(node->view);
  if (props && hidden(*props)) {
    return;
  }
  if (props && !props->accessibilityLabel.empty()) {
    append(out, props->accessibilityLabel);
    return;
  }
  append(out, textOf_(node->view));
  for (auto child : node->children) {
    collect(child, out);
  }
}

} // namespace ngn
