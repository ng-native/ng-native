#include "ngn/address-search.h"

#include <doctest/doctest.h>

#include <map>
#include <optional>

using folly::dynamic;

namespace {

struct FakeCompleter final : ngn::AddressCompleter {
  Callbacks callbacks;
  // Outlives the completer, which the module destroys when its session ends.
  std::shared_ptr<bool> stopped = std::make_shared<bool>(false);
  std::vector<std::string> asked;
  std::string region;
  bool pointsOfInterest{false};
  bool cancelled{false};
  void complete(const std::string &query, const std::string &r, bool poi) override {
    asked.push_back(query);
    region = r;
    pointsOfInterest = poi;
  }
  void cancel() override {
    cancelled = true;
    *stopped = true;
  }
};

struct FakeLookup final : ngn::AddressLookup {
  std::map<int, FakeCompleter *> completers;
  int made{0};
  std::vector<std::string> looked;
  std::optional<ngn::PostalAddressParts> address;
  std::string error;
  std::unique_ptr<ngn::AddressCompleter> makeCompleter(ngn::AddressCompleter::Callbacks callbacks) override {
    auto completer = std::make_unique<FakeCompleter>();
    completer->callbacks = std::move(callbacks);
    completers[++made] = completer.get();
    return completer;
  }
  void lookup(std::shared_ptr<void> completion, std::function<void(std::optional<ngn::PostalAddressParts>, std::string)> done) override {
    looked.push_back(*static_cast<std::string *>(completion.get()));
    done(address, error);
  }
};

std::vector<ngn::AddressCompletion> completions(std::initializer_list<const char *> titles) {
  std::vector<ngn::AddressCompletion> out;
  for (const char *title : titles) {
    out.push_back({.title = title, .subtitle = std::string(title) + " town", .handle = std::make_shared<std::string>(title)});
  }
  return out;
}

struct Answer {
  std::optional<dynamic> value;
  std::optional<std::string> error;
};

std::shared_ptr<Answer> ask(const ngn::NativeModule &module, const std::string &method, dynamic args) {
  auto answer = std::make_shared<Answer>();
  module.callWithPromise(
      method, args, {.resolve = [answer](dynamic v) { answer->value = v; }, .reject = [answer](const std::string &e) { answer->error = e; }});
  return answer;
}

std::shared_ptr<Answer> complete(const ngn::NativeModule &module, int session, const std::string &query, dynamic options = dynamic::object()) {
  return ask(module, "complete", dynamic::array(session, query, options));
}

} // namespace

TEST_CASE("NgNativeAddressSearch answers a query with its completer's suggestions, each with an id") {
  auto lookup = std::make_shared<FakeLookup>();
  auto module = ngn::makeAddressSearchModule(lookup);
  auto answer = complete(*module, 4, "22 Hyde", dynamic::object("region", "gb")("pointsOfInterest", true));
  auto &completer = *lookup->completers[1];
  CHECK(completer.asked == std::vector<std::string>{"22 Hyde"});
  CHECK(completer.region == "gb");
  CHECK(completer.pointsOfInterest);
  CHECK_FALSE(answer->value);
  completer.callbacks.results("22 Hyde", completions({"22 Hyde Park Terrace", "22 Hyde Park Road"}));
  REQUIRE(answer->value);
  CHECK(*answer->value == dynamic::array(
      dynamic::object("id", "4:1:0")("title", "22 Hyde Park Terrace")("subtitle", "22 Hyde Park Terrace town"),
      dynamic::object("id", "4:1:1")("title", "22 Hyde Park Road")("subtitle", "22 Hyde Park Road town")));
  // Another query in the session uses the same completer.
  complete(*module, 4, "22 Hyde P");
  CHECK(lookup->made == 1);
  // A second session has its own.
  complete(*module, 5, "Leeds");
  CHECK(lookup->made == 2);
}

TEST_CASE("NgNativeAddressSearch settles an older query with none, and sends a later report as an event") {
  auto lookup = std::make_shared<FakeLookup>();
  auto module = ngn::makeAddressSearchModule(lookup);
  std::vector<std::pair<std::string, dynamic>> events;
  module->setEmitter([&](const std::string &event, dynamic body) { events.emplace_back(event, body); });
  auto older = complete(*module, 1, "22");
  auto newer = complete(*module, 1, "22 H");
  CHECK(*older->value == dynamic::array());
  auto &completer = *lookup->completers[1];
  // A report for the fragment before is not this query's.
  completer.callbacks.results("22", completions({"22 Acacia Avenue"}));
  CHECK_FALSE(newer->value);
  completer.callbacks.results("22 H", completions({"22 Hyde Park Terrace"}));
  CHECK((*newer->value)[0]["id"] == dynamic("1:1:0"));
  CHECK(events.empty());
  completer.callbacks.results("22 H", completions({"22 Hyde Park Terrace", "22 High Street"}));
  REQUIRE(events.size() == 1);
  CHECK(events[0].first == "ngNativeAddressSearch");
  CHECK(events[0].second["session"] == dynamic(1));
  CHECK(events[0].second["query"] == dynamic("22 H"));
  CHECK(events[0].second["suggestions"][1]["id"] == dynamic("1:2:1"));
}

TEST_CASE("NgNativeAddressSearch rejects a failed query with the reason, and only the latest") {
  auto lookup = std::make_shared<FakeLookup>();
  auto module = ngn::makeAddressSearchModule(lookup);
  auto answer = complete(*module, 1, "zz");
  auto &completer = *lookup->completers[1];
  completer.callbacks.failed("z", "an older fragment's failure");
  CHECK_FALSE(answer->error);
  completer.callbacks.failed("zz", "The operation couldn't be completed. (MKErrorDomain error 4.)");
  CHECK(*answer->error == "The operation couldn't be completed. (MKErrorDomain error 4.)");
}

TEST_CASE("NgNativeAddressSearch resolves a suggestion of the latest answer only, into the parts a form fills") {
  auto lookup = std::make_shared<FakeLookup>();
  auto module = ngn::makeAddressSearchModule(lookup);
  complete(*module, 2, "22 Hyde");
  auto &completer = *lookup->completers[1];
  completer.callbacks.results("22 Hyde", completions({"22 Hyde Park Terrace", "22 Hyde Park Road"}));
  lookup->address = ngn::PostalAddressParts{
      .line1 = "22 Hyde Park Terrace", .town = "Leeds", .postcode = "LS6 1BJ", .region = "England",
      .country = "United Kingdom", .countryCode = "GB", .latitude = 53.81, .longitude = -1.56};
  auto resolved = ask(*module, "resolve", dynamic::array("2:1:1"));
  CHECK(lookup->looked == std::vector<std::string>{"22 Hyde Park Road"});
  REQUIRE(resolved->value);
  CHECK(*resolved->value == dynamic::object("line1", "22 Hyde Park Terrace")("town", "Leeds")("postcode", "LS6 1BJ")(
      "region", "England")("country", "United Kingdom")("countryCode", "GB")(
      "coordinates", dynamic::object("latitude", 53.81)("longitude", -1.56)));
  // A later answer makes the ids before it stale; so does a malformed id or another session's.
  completer.callbacks.results("22 Hyde", completions({"22 Hyde Park Terrace"}));
  for (const char *stale : {"2:1:0", "2:2:5", "9:2:0", "nonsense", "2:2"}) {
    CHECK(*ask(*module, "resolve", dynamic::array(stale))->value == dynamic(nullptr));
  }
  CHECK(lookup->looked.size() == 1);
  // A place MapKit cannot find is null, and a failure rejects.
  lookup->address.reset();
  CHECK(*ask(*module, "resolve", dynamic::array("2:2:0"))->value == dynamic(nullptr));
  lookup->error = "The Internet connection appears to be offline.";
  CHECK(*ask(*module, "resolve", dynamic::array("2:2:0"))->error == "The Internet connection appears to be offline.");
}

TEST_CASE("NgNativeAddressSearch ends a session: its query settles with none, its completer stops, and its ids go") {
  auto lookup = std::make_shared<FakeLookup>();
  auto module = ngn::makeAddressSearchModule(lookup);
  complete(*module, 3, "a");
  lookup->completers[1]->callbacks.results("a", completions({"A Street"}));
  auto pending = complete(*module, 3, "ab");
  auto stopped = lookup->completers[1]->stopped;
  auto callbacks = lookup->completers[1]->callbacks;
  module->call("end", dynamic::array(3));
  CHECK(*pending->value == dynamic::array());
  CHECK(*stopped);
  CHECK(*ask(*module, "resolve", dynamic::array("3:1:0"))->value == dynamic(nullptr));
  // A late report after the end goes nowhere.
  std::vector<std::string> events;
  module->setEmitter([&](const std::string &event, dynamic) { events.push_back(event); });
  callbacks.results("ab", completions({"AB Road"}));
  CHECK(events.empty());
}

TEST_CASE("NgNativeAddressSearch drops every session when it goes with its runtime") {
  auto lookup = std::make_shared<FakeLookup>();
  auto module = ngn::makeAddressSearchModule(lookup);
  std::vector<std::string> events;
  module->setEmitter([&](const std::string &event, dynamic) { events.push_back(event); });
  complete(*module, 1, "a");
  lookup->completers[1]->callbacks.results("a", completions({"A Street"}));
  auto callbacks = lookup->completers[1]->callbacks;
  auto stopped = lookup->completers[1]->stopped;
  std::weak_ptr<ngn::NativeModule> gone = module;
  module.reset();
  CHECK(gone.expired());
  CHECK(*stopped);
  // A report still in flight from the completer finds nothing to answer.
  callbacks.results("a", completions({"A Street", "A Road"}));
  CHECK(events.empty());
}
