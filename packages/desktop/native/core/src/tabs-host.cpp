#include "ngn/tabs-host.h"

#include "ngn/library-glue.h"

#include <algorithm>
#include <string_view>

namespace ngn {

void TabsNavigation::progress(const std::string &screenKey, bool fromJs) {
  selected_ = screenKey;
  if (!started_) {
    // The first state is where the count starts, and no change the user made.
    started_ = true;
    provenance_ = 0;
    return;
  }
  provenance_++;
  if (!fromJs) {
    lastUi_ = provenance_;
  }
}

TabsNavigation::Outcome TabsNavigation::request(const std::string &screenKey, int baseProvenance, bool rejectStale) {
  if (rejectStale && started_ && lastUi_ && baseProvenance < *lastUi_) {
    return Rejected{
        .selectedScreenKey = selected_,
        .provenance = provenance_,
        .rejectedScreenKey = screenKey,
        .rejectedBaseProvenance = baseProvenance,
        .reason = "stale"};
  }
  if (started_ && screenKey == selected_) {
    return Rejected{
        .selectedScreenKey = selected_,
        .provenance = provenance_,
        .rejectedScreenKey = screenKey,
        .rejectedBaseProvenance = baseProvenance,
        .reason = "repeated"};
  }
  progress(screenKey, true);
  return Selected{.screenKey = screenKey, .provenance = provenance_, .actionOrigin = "programmatic-js"};
}

TabsNavigation::Outcome TabsNavigation::userSelect(const std::string &screenKey, bool preventNativeSelection) {
  if (preventNativeSelection) {
    return Prevented{.selectedScreenKey = selected_, .provenance = provenance_, .preventedScreenKey = screenKey};
  }
  bool repeated = started_ && screenKey == selected_;
  progress(screenKey, false);
  return Selected{.screenKey = screenKey, .provenance = provenance_, .isRepeated = repeated, .actionOrigin = "user"};
}

std::optional<std::pair<std::string, folly::dynamic>> TabsNavigation::event(const Outcome &outcome) {
  if (const auto *selected = std::get_if<Selected>(&outcome)) {
    return std::pair<std::string, folly::dynamic>{
        "tabSelected",
        folly::dynamic::object("selectedScreenKey", selected->screenKey)("provenance", selected->provenance)(
            "isRepeated", selected->isRepeated)("hasTriggeredSpecialEffect", false)(
            "actionOrigin", selected->actionOrigin)};
  }
  if (const auto *rejected = std::get_if<Rejected>(&outcome)) {
    return std::pair<std::string, folly::dynamic>{
        "tabSelectionRejected",
        folly::dynamic::object("selectedScreenKey", rejected->selectedScreenKey)("provenance", rejected->provenance)(
            "rejectedScreenKey", rejected->rejectedScreenKey)("rejectedBaseProvenance", rejected->rejectedBaseProvenance)(
            "rejectionReason", rejected->reason)};
  }
  if (const auto *prevented = std::get_if<Prevented>(&outcome)) {
    return std::pair<std::string, folly::dynamic>{
        "tabSelectionPrevented",
        folly::dynamic::object("selectedScreenKey", prevented->selectedScreenKey)("provenance", prevented->provenance)(
            "preventedScreenKey", prevented->preventedScreenKey)};
  }
  return std::nullopt;
}

bool TabsHosts::isHost(const ViewTree::Node *node) {
  return node != nullptr && std::string_view(node->view.componentName) == "RNSTabsHostIOS";
}

namespace {

std::optional<TabScreen> screenOf(const ViewTree::Node *node) {
  return node != nullptr && node->view.props ? tabScreen(*node->view.props) : std::nullopt;
}

} // namespace

void TabsHosts::childrenChanged(const ViewTree &tree, Tag parent) {
  if (isHost(tree.find(parent))) {
    dirty_.insert(parent);
  }
}

void TabsHosts::propsChanged(const ViewTree &tree, Tag tag) {
  const auto *node = tree.find(tag);
  if (isHost(node)) {
    hosts_[tag].request = node->view.props ? tabsRequest(*node->view.props).value_or(TabsRequest{}) : TabsRequest{};
    dirty_.insert(tag);
  } else if (node != nullptr && isHost(tree.find(node->parent))) {
    // A tab's title, symbol or badge.
    dirty_.insert(node->parent);
  }
}

void TabsHosts::deleted(Tag tag) {
  hosts_.erase(tag);
  dirty_.erase(tag);
}

void TabsHosts::send(const ViewTree &tree, Tag host, const TabsNavigation::Outcome &outcome) {
  const auto *node = tree.find(host);
  auto event = TabsNavigation::event(outcome);
  if (node != nullptr && event) {
    emit(*node, event->first, std::move(event->second));
  }
}

void TabsHosts::userSelect(const ViewTree &tree, Tag host, Tag screen) {
  const auto *node = tree.find(screen);
  auto tab = screenOf(node);
  if (!tab || node->parent != host || !isHost(tree.find(host))) {
    return;
  }
  auto &state = hosts_[host];
  send(tree, host, state.navigation.userSelect(tab->screenKey, tab->preventNativeSelection));
  // The toolkit already moved its selection to the click: it is told again what is selected, which
  // takes it back where the click selected nothing.
  state.drawn.reset();
  dirty_.insert(host);
}

TabsHosts::Changes TabsHosts::settle(ViewTree &tree) {
  Changes changes;
  auto dirty = std::vector<Tag>(dirty_.begin(), dirty_.end());
  dirty_.clear();
  std::sort(dirty.begin(), dirty.end());
  for (Tag tag : dirty) {
    const auto *node = tree.find(tag);
    if (!isHost(node)) {
      continue;
    }
    auto &host = hosts_[tag];
    std::vector<std::pair<Tag, TabScreen>> screens;
    for (Tag child : node->children) {
      if (auto tab = screenOf(tree.find(child))) {
        screens.emplace_back(child, *tab);
      }
    }
    auto withKey = [&](const std::string &key) {
      return std::find_if(screens.begin(), screens.end(), [&](const auto &s) { return s.second.screenKey == key; });
    };

    // The app's request, once the tab it names is mounted.
    if (!host.request.screenKey.empty() && host.request != host.applied &&
        withKey(host.request.screenKey) != screens.end()) {
      host.applied = host.request;
      send(tree, tag,
           host.navigation.request(host.request.screenKey, host.request.baseProvenance, host.request.rejectStale));
    }

    auto selected = withKey(host.navigation.selected());
    if (selected == screens.end()) {
      selected = screens.begin();
    }
    Tag shown = selected == screens.end() ? -1 : selected->first;
    for (const auto &[screen, tab] : screens) {
      bool covered = screen != shown;
      if (tree.covered(screen) != covered) {
        tree.setCovered(screen, covered);
        changes.covered.push_back({screen, covered});
      }
    }
    if (shown != host.shown) {
      const auto *leaving = host.shown == -1 ? nullptr : tree.find(host.shown);
      if (leaving != nullptr && leaving->parent != tag) {
        leaving = nullptr;
      }
      const auto *arriving = shown == -1 ? nullptr : tree.find(shown);
      if (leaving != nullptr) {
        emit(*leaving, "willDisappear", folly::dynamic::object());
      }
      if (arriving != nullptr) {
        emit(*arriving, "willAppear", folly::dynamic::object());
      }
      if (leaving != nullptr) {
        emit(*leaving, "didDisappear", folly::dynamic::object());
      }
      if (arriving != nullptr) {
        emit(*arriving, "didAppear", folly::dynamic::object());
      }
      host.shown = shown;
    }

    SidebarGroup group{.tag = tag};
    for (const auto &[screen, tab] : screens) {
      group.rows.push_back(SidebarRow{
          .tag = screen, .label = tab.title, .badge = tab.badge, .sfSymbol = tab.sfSymbol, .selected = screen == shown});
    }
    SourceList list{.groups = {std::move(group)}};
    if (host.drawn != list) {
      host.drawn = list;
      changes.hosts.push_back({.host = tag, .list = std::move(list)});
    }
  }
  return changes;
}

void TabsHosts::emit(const ViewTree::Node &node, const std::string &event, folly::dynamic payload) {
  if (node.view.eventEmitter) {
    node.view.eventEmitter->dispatchEvent(event, std::move(payload), facebook::react::RawEvent::Category::Discrete);
  }
}

} // namespace ngn
