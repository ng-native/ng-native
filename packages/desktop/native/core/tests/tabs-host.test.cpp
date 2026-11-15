#include "fake-backend.h"
#include "helpers.h"
#include "ngn/library-glue.h"
#include "ngn/mounting-manager.h"
#include "ngn/tabs-host.h"

#include <doctest/doctest.h>
#include <folly/json.h>
#include <react/renderer/mounting/MountingTransaction.h>

using namespace facebook::react;
using ngn::TabsNavigation;
using ngn::testing::FakeBackend;
using ngn::testing::shadowView;

namespace {

using Lines = std::vector<std::string>;

TabsNavigation::Selected selected(const TabsNavigation::Outcome &outcome) {
  REQUIRE(std::holds_alternative<TabsNavigation::Selected>(outcome));
  return std::get<TabsNavigation::Selected>(outcome);
}

TabsNavigation::Rejected rejected(const TabsNavigation::Outcome &outcome) {
  REQUIRE(std::holds_alternative<TabsNavigation::Rejected>(outcome));
  return std::get<TabsNavigation::Rejected>(outcome);
}

// What a host built with react-native-screens reads from RNSTabsScreenIOS and RNSTabsHostIOS, in
// props of the tests' own.
struct TabProps final : ViewProps {
  ngn::TabScreen tab;
};
struct HostProps final : ViewProps {
  ngn::TabsRequest request;
};

// Installs the glue that reads them, and puts back what was there.
struct Glue {
  ngn::LibraryGlue saved = ngn::libraryGlue();
  Glue() {
    ngn::libraryGlue().tabScreen = [](const Props &props) -> std::optional<ngn::TabScreen> {
      const auto *p = dynamic_cast<const TabProps *>(&props);
      return p ? std::optional(p->tab) : std::nullopt;
    };
    ngn::libraryGlue().tabsRequest = [](const Props &props) -> std::optional<ngn::TabsRequest> {
      const auto *p = dynamic_cast<const HostProps *>(&props);
      return p ? std::optional(p->request) : std::nullopt;
    };
  }
  ~Glue() {
    ngn::libraryGlue() = saved;
  }
};

std::string json(const folly::dynamic &payload) {
  folly::json::serialization_opts opts;
  opts.sort_keys = true;
  return folly::json::serialize(payload, opts);
}

struct RecordingTabs final : ngn::TabsHosts {
  Lines *events;
  explicit RecordingTabs(Lines *events) : events(events) {}
  void emit(const ngn::ViewTree::Node &node, const std::string &event, folly::dynamic payload) override {
    std::string line = event + " " + std::to_string(node.view.tag);
    if (!payload.empty()) {
      line += " " + json(payload);
    }
    events->push_back(line);
  }
};

ShadowView tab(Tag tag, std::string key, std::string title, bool prevent = false) {
  auto props = std::make_shared<TabProps>();
  props->tab = {.screenKey = key, .title = title, .sfSymbol = key == "library" ? "books.vertical" : "",
                .preventNativeSelection = prevent};
  return shadowView(tag, "RNSTabsScreenIOS", {}, props);
}

ShadowView host(ngn::TabsRequest request = {}) {
  auto props = std::make_shared<HostProps>();
  props->request = request;
  return shadowView(2, "RNSTabsHostIOS", {}, props);
}

struct Fixture {
  Glue glue;
  Lines events;
  std::shared_ptr<FakeBackend> backend = std::make_shared<FakeBackend>();
  std::shared_ptr<ngn::MountingManager> mounting = std::make_shared<ngn::MountingManager>(
      backend, backend, nullptr, nullptr, std::make_unique<RecordingTabs>(&events));

  // The calls the backend got that are about tabs.
  Lines calls() {
    Lines out;
    for (const auto &line : backend->calls) {
      if (line.starts_with("lists") || line.starts_with("cover") || line.starts_with("uncover")) {
        out.push_back(line);
      }
    }
    return out;
  }

  void mount(ShadowViewMutationList mutations) {
    backend->calls.clear();
    events.clear();
    mounting->executeMount(1, MountingTransaction(1, 1, std::move(mutations), {}));
    backend->drain();
  }

  void choose(Tag screen) {
    backend->calls.clear();
    events.clear();
    mounting->chooseTab(1, 2, screen);
  }
};

ShadowViewMutationList tabsApp(ngn::TabsRequest request = {}) {
  auto h = host(request);
  auto library = tab(3, "library", "Library");
  auto search = tab(4, "search", "Search");
  auto locked = tab(5, "locked", "Locked", true);
  return {
      ShadowViewMutation::CreateMutation(h),
      ShadowViewMutation::CreateMutation(library),
      ShadowViewMutation::CreateMutation(search),
      ShadowViewMutation::CreateMutation(locked),
      ShadowViewMutation::InsertMutation(2, library, 0),
      ShadowViewMutation::InsertMutation(2, search, 1),
      ShadowViewMutation::InsertMutation(2, locked, 2),
      ShadowViewMutation::InsertMutation(1, h, 0),
  };
}

} // namespace

TEST_CASE("a tabs host's first change starts the count, and each later one adds to it") {
  TabsNavigation nav;
  auto first = selected(nav.request("library", 0, true));
  CHECK(first == TabsNavigation::Selected{.screenKey = "library", .provenance = 0, .actionOrigin = "programmatic-js"});
  auto click = selected(nav.userSelect("search", false));
  CHECK(click == TabsNavigation::Selected{.screenKey = "search", .provenance = 1, .actionOrigin = "user"});
  auto request = selected(nav.request("library", 1, true));
  CHECK(request.provenance == 2);
  CHECK(nav.selected() == "library");
}

TEST_CASE("a request for the tab already selected, or older than the user's last click, is rejected") {
  TabsNavigation nav;
  nav.request("library", 0, true);
  auto repeated = rejected(nav.request("library", 0, true));
  CHECK(repeated.reason == "repeated");
  CHECK(repeated.selectedScreenKey == "library");

  nav.userSelect("search", false);
  // Sent before the app heard of the click: stale, when the app asks for stale ones to be refused.
  auto stale = rejected(nav.request("library", 0, true));
  CHECK(stale == TabsNavigation::Rejected{
                     .selectedScreenKey = "search",
                     .provenance = 1,
                     .rejectedScreenKey = "library",
                     .rejectedBaseProvenance = 0,
                     .reason = "stale"});
  CHECK(selected(nav.request("library", 0, false)).provenance == 2);
}

TEST_CASE("a click on the selected tab is a repeat, and one on a tab that prevents it selects nothing") {
  TabsNavigation nav;
  nav.request("library", 0, true);
  auto again = selected(nav.userSelect("library", false));
  CHECK(again.isRepeated);
  CHECK(again.provenance == 1);
  auto prevented = nav.userSelect("locked", true);
  REQUIRE(std::holds_alternative<TabsNavigation::Prevented>(prevented));
  CHECK(std::get<TabsNavigation::Prevented>(prevented) ==
        TabsNavigation::Prevented{.selectedScreenKey = "library", .provenance = 1, .preventedScreenKey = "locked"});
  CHECK(nav.selected() == "library");
}

TEST_CASE("the first tab shows until the app asks for one, and the rest are covered") {
  Fixture f;
  f.mount(tabsApp());
  CHECK(f.calls() == Lines{"cover 4", "cover 5", "lists of 2: [2: 3 Library <books.vertical> *, 4 Search, 5 Locked]"});
  CHECK(f.events == Lines{"willAppear 3", "didAppear 3"});
}

TEST_CASE("the app's request selects its tab, which the app hears as its own") {
  Fixture f;
  f.mount(tabsApp({.screenKey = "search", .baseProvenance = 0, .rejectStale = true}));
  CHECK(f.events == Lines{
                        R"(tabSelected 2 {"actionOrigin":"programmatic-js","hasTriggeredSpecialEffect":false,"isRepeated":false,"provenance":0,"selectedScreenKey":"search"})",
                        "willAppear 4",
                        "didAppear 4",
                    });
  CHECK(f.calls() == Lines{"cover 3", "cover 5", "lists of 2: [2: 3 Library <books.vertical>, 4 Search *, 5 Locked]"});

  // The same request again is no change: the prop did not move.
  ngn::TabsRequest same{.screenKey = "search", .baseProvenance = 0, .rejectStale = true};
  f.mount({ShadowViewMutation::UpdateMutation(host(same), host(same), 1)});
  CHECK(f.events.empty());
  CHECK(f.calls().empty());
}

TEST_CASE("a click selects its tab and the app hears it from the user") {
  Fixture f;
  f.mount(tabsApp({.screenKey = "library", .baseProvenance = 0, .rejectStale = true}));
  f.choose(4);
  CHECK(f.events == Lines{
                        R"(tabSelected 2 {"actionOrigin":"user","hasTriggeredSpecialEffect":false,"isRepeated":false,"provenance":1,"selectedScreenKey":"search"})",
                        "willDisappear 3",
                        "willAppear 4",
                        "didDisappear 3",
                        "didAppear 4",
                    });
  CHECK(f.calls() == Lines{"cover 3", "uncover 4", "lists of 2: [2: 3 Library <books.vertical>, 4 Search *, 5 Locked]"});

  // The app's request from before the click arrives late: refused as stale, and nothing moves.
  auto before = host({.screenKey = "library", .baseProvenance = 0, .rejectStale = false});
  auto request = host({.screenKey = "library", .baseProvenance = -1, .rejectStale = true});
  f.mount({ShadowViewMutation::UpdateMutation(before, request, 1)});
  CHECK(f.events.size() == 1);
  CHECK(f.events[0].starts_with("tabSelectionRejected 2"));
  CHECK(f.events[0].find(R"("rejectionReason":"stale")") != std::string::npos);
  CHECK(f.calls().empty());
}

TEST_CASE("a click on a tab that prevents selection leaves the selection where it was") {
  Fixture f;
  f.mount(tabsApp({.screenKey = "library", .baseProvenance = 0, .rejectStale = true}));
  f.choose(5);
  CHECK(f.events == Lines{R"(tabSelectionPrevented 2 {"preventedScreenKey":"locked","provenance":0,"selectedScreenKey":"library"})"});
  // The toolkit had already moved its own selection to the click: it is told the tabs again.
  CHECK(f.calls() == Lines{"lists of 2: [2: 3 Library <books.vertical> *, 4 Search, 5 Locked]"});
}

TEST_CASE("a tab's title and badge reach the sidebar") {
  Fixture f;
  f.mount(tabsApp());
  auto renamed = tab(4, "search", "Find");
  auto props = std::make_shared<TabProps>(*std::static_pointer_cast<const TabProps>(renamed.props));
  props->tab.badge = "2";
  renamed.props = props;
  f.mount({ShadowViewMutation::UpdateMutation(tab(4, "search", "Search"), renamed, 1)});
  CHECK(f.calls() == Lines{"lists of 2: [2: 3 Library <books.vertical> *, 4 Find (2), 5 Locked]"});
}
