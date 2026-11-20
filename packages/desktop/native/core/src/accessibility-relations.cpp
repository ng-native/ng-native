#include "ngn/accessibility-relations.h"

#include "ngn/desktop-view-props.h"
#include "ngn/text-input.h"

#include <react/renderer/components/view/ViewProps.h>

using namespace facebook::react;

namespace ngn {

namespace {

// The ids a view's props say describe it: a view's desktop props have them, and so do a text
// input's.
const std::vector<std::string> &describedByIds(const Props &props) {
  static const std::vector<std::string> none;
  if (const auto *input = dynamic_cast<const DesktopTextInputProps *>(&props)) {
    return input->accessibilityDescribedBy;
  }
  const auto *desktop = dynamic_cast<const HasDesktopProps *>(&props);
  return desktop ? desktop->desktop.accessibilityDescribedBy : none;
}

} // namespace

void AccessibilityRelations::update(const ShadowView &view) {
  const auto *props = dynamic_cast<const ViewProps *>(view.props.get());
  std::string id = view.props ? view.props->nativeId : std::string{};
  auto known = idOf_.find(view.tag);
  if (known == idOf_.end() ? !id.empty() : known->second.second != id) {
    forgetId(view.tag);
    if (!id.empty()) {
      ids_[view.surfaceId][id].insert(view.tag);
      idOf_[view.tag] = {view.surfaceId, id};
    }
    dirty_.insert(view.surfaceId);
  }
  Names names{.surfaceId = view.surfaceId};
  if (props) {
    names.labelledBy = props->accessibilityLabelledBy.value;
    names.describedBy = describedByIds(*props);
  }
  auto naming = naming_.find(view.tag);
  bool namesAny = !names.labelledBy.empty() || !names.describedBy.empty();
  if (naming == naming_.end() && !namesAny) {
    return;
  }
  if (naming != naming_.end() && naming->second.labelledBy == names.labelledBy &&
      naming->second.describedBy == names.describedBy) {
    return;
  }
  if (namesAny) {
    naming_[view.tag] = std::move(names);
  } else {
    naming_.erase(view.tag);
  }
  dirty_.insert(view.surfaceId);
}

void AccessibilityRelations::remove(Tag tag) {
  if (auto known = idOf_.find(tag); known != idOf_.end()) {
    dirty_.insert(known->second.first);
  }
  forgetId(tag);
  naming_.erase(tag);
  // Its widget goes with it: nothing to clear.
  reported_.erase(tag);
}

void AccessibilityRelations::forgetId(Tag tag) {
  auto known = idOf_.find(tag);
  if (known == idOf_.end()) {
    return;
  }
  auto &[surfaceId, id] = known->second;
  auto &surface = ids_[surfaceId];
  if (auto views = surface.find(id); views != surface.end()) {
    views->second.erase(tag);
    if (views->second.empty()) {
      surface.erase(views);
    }
  }
  if (surface.empty()) {
    ids_.erase(surfaceId);
  }
  idOf_.erase(known);
}

std::vector<Tag> AccessibilityRelations::resolve(SurfaceId surfaceId, const std::vector<std::string> &ids) const {
  std::vector<Tag> tags;
  auto surface = ids_.find(surfaceId);
  if (surface == ids_.end()) {
    return tags;
  }
  for (const auto &id : ids) {
    if (auto views = surface->second.find(id); views != surface->second.end() && !views->second.empty()) {
      // The lowest tag wins. Fabric counts tags up as views are made, so that is the one made first.
      tags.push_back(*views->second.begin());
    }
  }
  return tags;
}

std::vector<std::pair<Tag, AxRelations>> AccessibilityRelations::didMount(SurfaceId surfaceId) {
  std::vector<std::pair<Tag, AxRelations>> changed;
  if (dirty_.erase(surfaceId) == 0) {
    return changed;
  }
  for (const auto &[tag, names] : naming_) {
    if (names.surfaceId != surfaceId) {
      continue;
    }
    AxRelations now{resolve(surfaceId, names.labelledBy), resolve(surfaceId, names.describedBy)};
    auto it = reported_.find(tag);
    if (it == reported_.end() ? now.empty() : it->second.second == now) {
      continue;
    }
    if (now.empty()) {
      reported_.erase(it);
    } else {
      reported_[tag] = {surfaceId, now};
    }
    changed.emplace_back(tag, std::move(now));
  }
  // A view that stopped naming any: its relations clear.
  for (auto it = reported_.begin(); it != reported_.end();) {
    if (it->second.first == surfaceId && !naming_.contains(it->first)) {
      changed.emplace_back(it->first, AxRelations{});
      it = reported_.erase(it);
    } else {
      ++it;
    }
  }
  return changed;
}

} // namespace ngn
