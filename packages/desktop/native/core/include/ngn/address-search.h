// NgNativeAddressSearch: @ng-native/expo's AddressSearch, the same module the iOS app has, over an
// AddressLookup, which the AppKit backend implements with MapKit's MKLocalSearchCompleter and
// MKLocalSearch. Neither needs a permission.
//
// - complete(session, query, {region, pointsOfInterest}): [{id, title, subtitle}]. Each session
//   has a completer of its own; a newer query in a session settles the one before with []. What
//   the completer reports for the query after that goes out as `ngNativeAddressSearch` on
//   DeviceEventEmitter: {session, query, suggestions}. A failure rejects with MapKit's reason.
// - resolve(id): {line1, locality?, town, postcode, region?, country, countryCode, coordinates}
//   for a suggestion of its session's latest answer, or null for one no longer current or a place
//   MapKit cannot find.
// - end(session): drops the session, settling its query with [].
#pragma once

#include "ngn/native-module.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct AddressCompletion {
  std::string title;
  std::string subtitle;
  // The OS's own completion, handed back to look it up.
  std::shared_ptr<void> handle;
};

struct PostalAddressParts {
  std::string line1;
  std::optional<std::string> locality;
  std::string town;
  std::string postcode;
  std::optional<std::string> region;
  std::string country;
  std::string countryCode;
  double latitude{0};
  double longitude{0};
};

// One session's completer. Its callbacks may come on any thread, more than once per query, and
// for a query before the latest; the module keeps only what is for the latest.
class AddressCompleter {
 public:
  struct Callbacks {
    std::function<void(const std::string &query, std::vector<AddressCompletion> completions)> results;
    std::function<void(const std::string &query, const std::string &reason)> failed;
  };
  virtual ~AddressCompleter() = default;
  // `region` is an ISO 3166-1 alpha-2 code, or empty for anywhere.
  virtual void complete(const std::string &query, const std::string &region, bool pointsOfInterest) = 0;
  virtual void cancel() = 0;
};

class AddressLookup {
 public:
  virtual ~AddressLookup() = default;
  virtual std::unique_ptr<AddressCompleter> makeCompleter(AddressCompleter::Callbacks callbacks) = 0;
  // The address of a completion: answers once, on any thread, with the address, or nothing and
  // the reason (empty for a place that cannot be found).
  virtual void lookup(std::shared_ptr<void> completion, std::function<void(std::optional<PostalAddressParts>, std::string error)> done) = 0;
};

std::shared_ptr<NativeModule> makeAddressSearchModule(std::shared_ptr<AddressLookup> lookup);

} // namespace ngn
