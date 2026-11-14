// react-native-screens' tabs (RNSTabsHostIOS and its RNSTabsScreenIOS children) as a desktop draws
// them: the window's sidebar lists the tabs and the content pane shows the selected one. The tabs
// outlet commits the same props as on iOS, so the selection handshake is iOS's:
//
// - The host holds the navigation state, a selected screen key and a provenance that counts each
//   change. The app asks for a tab with `navStateRequest` {selectedScreenKey, baseProvenance}; a
//   request is rejected as stale (with `rejectStaleNavStateUpdates`) when it is older than the last
//   change the user made, and as repeated when it names the tab already selected.
// - Every change is reported with `tabSelected` {selectedScreenKey, provenance, isRepeated,
//   hasTriggeredSpecialEffect, actionOrigin}: `user` for a click, `programmatic-js` for a request.
//   A click on a tab with `preventNativeSelection` selects nothing and sends
//   `tabSelectionPrevented` instead.
// - Before the app asks for one, the first tab shows, as UIKit's tab bar controller does.
//
// The screens not selected are covered (screen-stacks.h): mounted, but neither drawn nor hit. The
// selected one hears willAppear and didAppear, the one it replaces willDisappear and didDisappear.
#pragma once

#include "ngn/split-view.h"
#include "ngn/view-tree.h"

#include <react/renderer/core/Props.h>

#include <folly/dynamic.h>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <variant>
#include <vector>

namespace ngn {

// The navigation state machine of one tabs host, as RNSTabBarController keeps it.
class TabsNavigation {
 public:
  struct Selected {
    std::string screenKey;
    int provenance{0};
    bool isRepeated{false};
    std::string actionOrigin;
    bool operator==(const Selected &) const = default;
  };
  struct Rejected {
    std::string selectedScreenKey;
    int provenance{0};
    std::string rejectedScreenKey;
    int rejectedBaseProvenance{0};
    std::string reason;
    bool operator==(const Rejected &) const = default;
  };
  struct Prevented {
    std::string selectedScreenKey;
    int provenance{0};
    std::string preventedScreenKey;
    bool operator==(const Prevented &) const = default;
  };
  using Outcome = std::variant<std::monostate, Selected, Rejected, Prevented>;

  // The app's request. `known` says whether a screen with the key is mounted: one that is not is
  // left for when it is.
  Outcome request(const std::string &screenKey, int baseProvenance, bool rejectStale);
  // A click on a tab.
  Outcome userSelect(const std::string &screenKey, bool preventNativeSelection);

  // The selected key, or empty before the first change.
  const std::string &selected() const {
    return selected_;
  }
  bool started() const {
    return started_;
  }

  // The event an outcome sends from the host, and its payload: nothing for monostate.
  static std::optional<std::pair<std::string, folly::dynamic>> event(const Outcome &outcome);

 private:
  void progress(const std::string &screenKey, bool fromJs);

  bool started_{false};
  std::string selected_;
  int provenance_{0};
  // The provenance of the last change that was not the app's own request.
  std::optional<int> lastUi_;
};

// A tab as the host reads it from its RNSTabsScreenIOS props (library-glue.h).
struct TabScreen {
  std::string screenKey;
  std::string title;
  std::string badge;
  // The SF Symbol, when the tab's icon is one.
  std::string sfSymbol;
  bool preventNativeSelection{false};
};

// The request a RNSTabsHostIOS's props carry.
struct TabsRequest {
  std::string screenKey;
  int baseProvenance{0};
  bool rejectStale{false};
  bool operator==(const TabsRequest &) const = default;
};

// What the tabs' props say, through the library's glue: nothing for other props or a host built
// without react-native-screens.
std::optional<TabScreen> tabScreen(const facebook::react::Props &props);
std::optional<TabsRequest> tabsRequest(const facebook::react::Props &props);

// Every tabs host of the surfaces, kept by the mounting manager as ScreenStacks is.
class TabsHosts {
 public:
  virtual ~TabsHosts() = default;

  void childrenChanged(const ViewTree &tree, Tag parent);
  void propsChanged(const ViewTree &tree, Tag tag);
  void deleted(Tag tag);

  // A click on the tab `screen` of `host`.
  void userSelect(const ViewTree &tree, Tag host, Tag screen);

  struct Change {
    Tag host{-1};
    // The tabs, as one untitled source list, with the selected one marked.
    SourceList list;
    bool operator==(const Change &) const = default;
  };
  struct Covered {
    Tag tag;
    bool covered;
  };
  struct Changes {
    std::vector<Change> hosts;
    std::vector<Covered> covered;
  };
  // Applies the requests and clicks since the last call: sends the events, covers the screens not
  // selected in `tree`, and answers what the toolkit must redraw.
  Changes settle(ViewTree &tree);

  // Whether `tag` is a tabs host.
  static bool isHost(const ViewTree::Node *node);

 protected:
  // Where events leave the core: through the view's event emitter by default, recorded in tests.
  virtual void emit(const ViewTree::Node &node, const std::string &event, folly::dynamic payload);

 private:
  struct Host {
    TabsNavigation navigation;
    TabsRequest request;
    // The last request applied: a request is applied once, when its props change.
    std::optional<TabsRequest> applied;
    // The screen shown, which hears appear and disappear.
    Tag shown{-1};
    std::optional<SourceList> drawn;
  };
  void send(const ViewTree &tree, Tag host, const TabsNavigation::Outcome &outcome);

  std::unordered_map<Tag, Host> hosts_;
  std::unordered_set<Tag> dirty_;
};

} // namespace ngn
