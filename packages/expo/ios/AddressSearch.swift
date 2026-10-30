import CoreLocation
import ExpoModulesCore
import MapKit

/// What `suggest()` was given, the same for every query of a search.
struct AddressSearchOptions: Record {
  /// An ISO 3166-1 alpha-2 code: the country to look in.
  @Field var region: String?
  @Field var pointsOfInterest: Bool = false
}

/**
 Postal addresses that match a partial query, from MapKit's `MKLocalSearchCompleter`, and the
 structured address of one, from `MKLocalSearch`. Neither needs the location permission.

 Each `suggest()` in JavaScript is a session with a completer of its own, so two address fields
 do not answer each other's queries. A suggestion's id names its session and the answer it came
 in, and resolves only while that answer is the session's latest.
 */
public final class AddressSearchModule: Module {
  /// Read and written on the main queue only.
  private var searches: [Int: AddressCompleter] = [:]

  public func definition() -> ModuleDefinition {
    Name("NgNativeAddressSearch")

    AsyncFunction("complete") { (session: Int, query: String, options: AddressSearchOptions, promise: Promise) in
      let search = self.searches[session] ?? AddressCompleter(session: session)
      self.searches[session] = search
      search.complete(query, options: options, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("resolve") { (id: String, promise: Promise) in
      guard let completion = self.completion(for: id) else {
        promise.resolve(nil)
        return
      }
      MKLocalSearch(request: MKLocalSearch.Request(completion: completion)).start { response, error in
        if let item = response?.mapItems.first {
          promise.resolve(Self.address(of: item.placemark))
        } else if let error, (error as? MKError)?.code != .placemarkNotFound {
          promise.reject("ERR_ADDRESS_SEARCH", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("end") { (session: Int) in
      self.searches.removeValue(forKey: session)?.cancel()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async {
        self.searches.values.forEach { $0.cancel() }
        self.searches.removeAll()
      }
    }
  }

  /// The completion an id names, while its answer is still its session's latest.
  private func completion(for id: String) -> MKLocalSearchCompletion? {
    let parts = id.split(separator: ":").compactMap { Int($0) }
    guard parts.count == 3, let search = searches[parts[0]] else { return nil }
    return search.completion(generation: parts[1], index: parts[2])
  }

  /// A placemark in the parts a form fills, leaving out the optional ones it does not know.
  private static func address(of placemark: MKPlacemark) -> [String: Any] {
    let street = [placemark.subThoroughfare, placemark.thoroughfare]
      .compactMap { $0 }
      .joined(separator: " ")
    var address: [String: Any] = [
      "line1": street,
      "town": placemark.locality ?? "",
      "postcode": placemark.postalCode ?? "",
      "country": placemark.country ?? "",
      "countryCode": placemark.isoCountryCode ?? "",
      "coordinates": [
        "latitude": placemark.coordinate.latitude,
        "longitude": placemark.coordinate.longitude,
      ],
    ]
    if let locality = placemark.subLocality { address["locality"] = locality }
    if let region = placemark.administrativeArea { address["region"] = region }
    return address
  }
}

/// One session's completer, and the promise for its latest query.
final class AddressCompleter: NSObject, MKLocalSearchCompleterDelegate {
  /// Countries' regions by code, found once each with `CLGeocoder`.
  private static var regions: [String: MKCoordinateRegion] = [:]

  private let session: Int
  private let completer = MKLocalSearchCompleter()
  private var pending: Promise?
  /// Counts the queries asked, so a country's region found late applies only to the latest.
  private var asked = 0
  /// Counts the answers given, which a suggestion's id carries.
  private var generation = 0
  private var answered: [MKLocalSearchCompletion] = []

  init(session: Int) {
    self.session = session
    super.init()
    completer.delegate = self
    completer.resultTypes = .address
  }

  func complete(_ query: String, options: AddressSearchOptions, promise: Promise) {
    // A newer query settles the one before: JavaScript keeps only the latest answer.
    pending?.resolve([[String: Any]]())
    pending = promise
    asked += 1
    let ask = asked
    completer.resultTypes = options.pointsOfInterest ? [.address, .pointOfInterest] : .address
    withRegion(options.region) { [weak self] in
      guard let self, ask == self.asked else { return }
      // The completer says nothing for the query it already has: answer with what it found.
      if self.completer.queryFragment == query && !self.completer.isSearching {
        self.answer(self.completer.results)
      } else {
        self.completer.queryFragment = query
      }
    }
  }

  func completion(generation: Int, index: Int) -> MKLocalSearchCompletion? {
    guard generation == self.generation, answered.indices.contains(index) else { return nil }
    return answered[index]
  }

  func cancel() {
    completer.cancel()
    pending?.resolve([[String: Any]]())
    pending = nil
    answered = []
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    answer(completer.results)
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    // A fragment nothing matches is no suggestions, not a failure.
    if (error as? MKError)?.code == .placemarkNotFound {
      answer([])
      return
    }
    pending?.reject("ERR_ADDRESS_SEARCH", error.localizedDescription)
    pending = nil
  }

  /// Settles the pending query with `results`, which ids now name. An update with no query
  /// waiting, a refinement after the answer, is left for the next query to read.
  private func answer(_ results: [MKLocalSearchCompletion]) {
    guard let pending else { return }
    self.pending = nil
    generation += 1
    answered = results
    pending.resolve(results.enumerated().map { index, completion in
      [
        "id": "\(session):\(generation):\(index)",
        "title": completion.title,
        "subtitle": completion.subtitle,
      ]
    })
  }

  /// Looks only in `region` from iOS 18, and first in it before.
  private func limit(to region: MKCoordinateRegion) {
    completer.region = region
    if #available(iOS 18.0, *) {
      completer.regionPriority = .required
    }
  }

  /// Sets the completer's region to the country `code` names, then calls `then`. MapKit takes a
  /// region rather than a country, so the country's is found once, by name, with `CLGeocoder`.
  private func withRegion(_ code: String?, then: @escaping () -> Void) {
    guard let code = code?.uppercased(), !code.isEmpty else {
      then()
      return
    }
    if let region = Self.regions[code] {
      limit(to: region)
      then()
      return
    }
    guard let name = Locale(identifier: "en_US").localizedString(forRegionCode: code) else {
      then()
      return
    }
    CLGeocoder().geocodeAddressString(name) { [weak self] placemarks, _ in
      if let circle = placemarks?.first?.region as? CLCircularRegion {
        let region = MKCoordinateRegion(
          center: circle.center,
          latitudinalMeters: circle.radius * 2,
          longitudinalMeters: circle.radius * 2
        )
        Self.regions[code] = region
        self?.limit(to: region)
      }
      then()
    }
  }
}
