#include "address-search.h"

#import <CoreLocation/CoreLocation.h>
#import <Foundation/Foundation.h>

#include <atomic>
#include <map>

using ngn::AddressCompleter;
using ngn::AddressCompletion;

// A session's MKLocalSearchCompleter, made on the main thread when first asked, and its delegate.
@interface NGNAddressCompleterDelegate : NSObject <MKLocalSearchCompleterDelegate>
@property(nonatomic) AddressCompleter::Callbacks callbacks;
@property(nonatomic, readonly) MKLocalSearchCompleter *completer;
// Clears the callbacks and cancels the completer: nothing reports after it.
- (void)stop;
@end

namespace {

std::vector<AddressCompletion> completionsOf(NSArray<MKLocalSearchCompletion *> *results) {
  std::vector<AddressCompletion> out;
  for (MKLocalSearchCompletion *result in results) {
    // The completion, kept alive for MKLocalSearch while the core holds its handle.
    void *retained = (__bridge_retained void *)result;
    out.push_back({
        .title = result.title.UTF8String,
        .subtitle = result.subtitle.UTF8String,
        .handle = std::shared_ptr<void>(retained, [](void *p) { CFRelease(p); }),
    });
  }
  return out;
}

std::string reasonOf(NSError *error) {
  return error.localizedDescription.length > 0 ? error.localizedDescription.UTF8String : "MapKit's search failed";
}

} // namespace

@implementation NGNAddressCompleterDelegate {
  MKLocalSearchCompleter *_completer;
}

- (MKLocalSearchCompleter *)completer {
  if (_completer == nil) {
    _completer = [MKLocalSearchCompleter new];
    _completer.delegate = self;
    _completer.resultTypes = MKLocalSearchCompleterResultTypeAddress;
  }
  return _completer;
}

- (void)stop {
  _callbacks = {};
  _completer.delegate = nil;
  [_completer cancel];
}

- (void)completerDidUpdateResults:(MKLocalSearchCompleter *)completer {
  if (_callbacks.results) {
    _callbacks.results(completer.queryFragment.UTF8String, completionsOf(completer.results));
  }
}

- (void)completer:(MKLocalSearchCompleter *)completer didFailWithError:(NSError *)error {
  // A fragment nothing matches is no suggestions, not a failure.
  if ([error.domain isEqualToString:MKErrorDomain] && error.code == MKErrorPlacemarkNotFound) {
    [self completerDidUpdateResults:completer];
    return;
  }
  if (_callbacks.failed) {
    _callbacks.failed(completer.queryFragment.UTF8String, reasonOf(error));
  }
}

@end

namespace ngn::appkit {

namespace {

// Countries' regions by code, found once each. Main thread only.
std::map<std::string, MKCoordinateRegion> &regions() {
  static std::map<std::string, MKCoordinateRegion> found;
  return found;
}

class MapKitCompleter final : public AddressCompleter {
 public:
  // The completer itself is made on the main thread, by the first query: never waited for here,
  // since the core may hold its lock, which the main thread's reports take.
  explicit MapKitCompleter(Callbacks callbacks) : delegate_([NGNAddressCompleterDelegate new]) {
    delegate_.callbacks = std::move(callbacks);
  }

  ~MapKitCompleter() override {
    NGNAddressCompleterDelegate *delegate = delegate_;
    dispatch_async(dispatch_get_main_queue(), ^{
      [delegate stop];
    });
  }

  void complete(const std::string &query, const std::string &region, bool pointsOfInterest) override {
    NGNAddressCompleterDelegate *delegate = delegate_;
    NSString *fragment = [NSString stringWithUTF8String:query.c_str()];
    auto ask = ++*asked_;
    auto asked = asked_;
    auto code = uppercase(region);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (delegate.callbacks.results == nullptr) {
        return;
      }
      MKLocalSearchCompleter *completer = delegate.completer;
      completer.resultTypes = pointsOfInterest
          ? MKLocalSearchCompleterResultTypeAddress | MKLocalSearchCompleterResultTypePointOfInterest
          : MKLocalSearchCompleterResultTypeAddress;
      withRegion(completer, code, ^{
        // A region found late applies only to the latest query, of a session not ended.
        if (delegate.callbacks.results == nullptr || ask != *asked) {
          return;
        }
        // The completer says nothing for the query it already has: answer with what it found.
        if ([completer.queryFragment isEqualToString:fragment] && !completer.isSearching) {
          [delegate completerDidUpdateResults:completer];
        } else {
          completer.queryFragment = fragment;
        }
      });
    });
  }

  void cancel() override {
    NGNAddressCompleterDelegate *delegate = delegate_;
    dispatch_async(dispatch_get_main_queue(), ^{
      [delegate stop];
    });
  }

 private:
  static std::string uppercase(std::string text) {
    for (auto &c : text) {
      c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    }
    return text;
  }

  // Looks only in the country's region from macOS 15, and first in it before.
  static void limit(MKLocalSearchCompleter *completer, MKCoordinateRegion region) {
    completer.region = region;
    if (@available(macOS 15.0, *)) {
      completer.regionPriority = MKLocalSearchRegionPriorityRequired;
    }
  }

  // Sets the completer's region to the country `code` names, then calls `then`. Main thread.
  static void withRegion(MKLocalSearchCompleter *completer, const std::string &code, void (^then)(void)) {
    if (code.empty()) {
      then();
      return;
    }
    auto known = regions().find(code);
    if (known != regions().end()) {
      limit(completer, known->second);
      then();
      return;
    }
    NSString *name = [[NSLocale localeWithLocaleIdentifier:@"en_US"]
        localizedStringForCountryCode:[NSString stringWithUTF8String:code.c_str()]];
    if (name == nil) {
      then();
      return;
    }
    [[CLGeocoder new] geocodeAddressString:name
                         completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *) {
                           CLRegion *area = placemarks.firstObject.region;
                           if ([area isKindOfClass:CLCircularRegion.class]) {
                             CLCircularRegion *circle = (CLCircularRegion *)area;
                             auto region = MKCoordinateRegionMakeWithDistance(circle.center, circle.radius * 2, circle.radius * 2);
                             regions()[code] = region;
                             limit(completer, region);
                           }
                           then();
                         }];
  }

  NGNAddressCompleterDelegate *delegate_;
  // Counts the queries asked, on the calling thread; read on the main thread after.
  std::shared_ptr<std::atomic<int>> asked_ = std::make_shared<std::atomic<int>>(0);
};

class MapKitLookup final : public AddressLookup {
 public:
  std::unique_ptr<AddressCompleter> makeCompleter(AddressCompleter::Callbacks callbacks) override {
    return std::make_unique<MapKitCompleter>(std::move(callbacks));
  }

  void lookup(std::shared_ptr<void> completion, std::function<void(std::optional<PostalAddressParts>, std::string)> done) override {
    auto answer = std::make_shared<std::function<void(std::optional<PostalAddressParts>, std::string)>>(std::move(done));
    dispatch_async(dispatch_get_main_queue(), ^{
      MKLocalSearchCompletion *picked = (__bridge MKLocalSearchCompletion *)completion.get();
      MKLocalSearch *search = [[MKLocalSearch alloc] initWithRequest:[[MKLocalSearchRequest alloc] initWithCompletion:picked]];
      [search startWithCompletionHandler:^(MKLocalSearchResponse *response, NSError *error) {
        (void)search;
        if (MKMapItem *item = response.mapItems.firstObject) {
          (*answer)(postalAddressOf(item.placemark), "");
        } else if (error && !([error.domain isEqualToString:MKErrorDomain] && error.code == MKErrorPlacemarkNotFound)) {
          (*answer)(std::nullopt, reasonOf(error));
        } else {
          (*answer)(std::nullopt, "");
        }
      }];
    });
  }
};

std::string text(NSString *value) {
  return value.length > 0 ? value.UTF8String : "";
}

} // namespace

PostalAddressParts postalAddressOf(MKPlacemark *placemark) {
  PostalAddressParts parts;
  NSMutableArray<NSString *> *street = [NSMutableArray array];
  if (placemark.subThoroughfare.length > 0) {
    [street addObject:placemark.subThoroughfare];
  }
  if (placemark.thoroughfare.length > 0) {
    [street addObject:placemark.thoroughfare];
  }
  parts.line1 = text([street componentsJoinedByString:@" "]);
  parts.town = text(placemark.locality);
  parts.postcode = text(placemark.postalCode);
  parts.country = text(placemark.country);
  parts.countryCode = text(placemark.ISOcountryCode);
  if (placemark.subLocality.length > 0) {
    parts.locality = placemark.subLocality.UTF8String;
  }
  if (placemark.administrativeArea.length > 0) {
    parts.region = placemark.administrativeArea.UTF8String;
  }
  parts.latitude = placemark.coordinate.latitude;
  parts.longitude = placemark.coordinate.longitude;
  return parts;
}

std::shared_ptr<AddressLookup> makeAddressLookup() {
  return std::make_shared<MapKitLookup>();
}

} // namespace ngn::appkit
