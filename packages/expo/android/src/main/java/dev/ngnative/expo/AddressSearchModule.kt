package dev.ngnative.expo

import android.location.Address
import android.location.Geocoder
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** What `suggest()` was given, the same for every query of a search. */
class AddressSearchOptions : Record {
  /** An ISO 3166-1 alpha-2 code: the only country to answer addresses in. */
  @Field val region: String? = null
  /** iOS only: Android's geocoder answers addresses and places alike. */
  @Field val pointsOfInterest: Boolean = false
}

/**
 * Postal addresses that match a query, from the platform's `Geocoder`, which needs no permission.
 *
 * Android has no completer like MapKit's: the geocoder answers whole addresses for a query, and
 * goes to the network for each. So a query is looked up only once it has stood for a moment with
 * no newer one in its session, and each answer keeps its addresses, so resolving a suggestion
 * needs no second lookup. A suggestion's id names its session and the answer it came in.
 */
class AddressSearchModule : Module() {
  private class Search {
    /** Counts the queries asked, so only the latest is looked up and answered. */
    @Volatile var asked = 0
    /** Counts the answers given, which a suggestion's id carries. */
    var generation = 0
    var answered: List<Address> = emptyList()
  }

  private val searches = ConcurrentHashMap<Int, Search>()

  override fun definition() = ModuleDefinition {
    Name("NgNativeAddressSearch")

    AsyncFunction("complete") Coroutine { session: Int, query: String, options: AddressSearchOptions ->
      val search = searches.getOrPut(session) { Search() }
      val ask = synchronized(search) { ++search.asked }
      delay(SETTLE_MS)
      if (search.asked != ask || searches[session] !== search) return@Coroutine emptyList()
      val found = withContext(Dispatchers.IO) { lookUp(query, options.region) }
      synchronized(search) {
        if (search.asked != ask) return@Coroutine emptyList()
        search.generation += 1
        search.answered = found
        found.mapIndexed { index, address ->
          mapOf(
            "id" to "$session:${search.generation}:$index",
            "title" to title(address),
            "subtitle" to listOfNotNull(address.locality, address.postalCode, address.countryName)
              .joinToString(", "),
          )
        }
      }
    }

    AsyncFunction("resolve") { id: String ->
      val parts = id.split(":").mapNotNull { it.toIntOrNull() }
      if (parts.size != 3) return@AsyncFunction null
      val search = searches[parts[0]] ?: return@AsyncFunction null
      synchronized(search) {
        if (parts[1] != search.generation) return@AsyncFunction null
        search.answered.getOrNull(parts[2])?.let(::postalAddress)
      }
    }

    AsyncFunction("end") { session: Int ->
      searches.remove(session)
    }

    OnDestroy {
      searches.clear()
    }
  }

  /** The addresses the geocoder has for `query`, in `region` where one is given. */
  private fun lookUp(query: String, region: String?): List<Address> {
    val context = appContext.reactContext ?: return emptyList()
    if (!Geocoder.isPresent()) return emptyList()
    // The blocking form: the listener form is API 33 and up, and this runs off the main thread.
    @Suppress("DEPRECATION")
    val found = Geocoder(context, Locale.getDefault()).getFromLocationName(query, MAX_RESULTS)
    return found.orEmpty().filter { region == null || it.countryCode.equals(region, ignoreCase = true) }
  }

  private fun street(address: Address): String =
    listOfNotNull(address.subThoroughfare, address.thoroughfare).joinToString(" ")

  /** The first line: the street, or the place's name, or the first part of the full address. */
  private fun title(address: Address): String =
    street(address).ifEmpty { address.featureName ?: address.getAddressLine(0)?.substringBefore(",") ?: "" }

  /** An address in the parts a form fills, leaving out the optional ones it does not know. */
  private fun postalAddress(address: Address): Map<String, Any> {
    val parts = mutableMapOf<String, Any>(
      "line1" to street(address),
      "town" to (address.locality ?: address.subAdminArea ?: ""),
      "postcode" to (address.postalCode ?: ""),
      "country" to (address.countryName ?: ""),
      "countryCode" to (address.countryCode ?: ""),
    )
    address.subLocality?.let { parts["locality"] = it }
    address.adminArea?.let { parts["region"] = it }
    if (address.hasLatitude() && address.hasLongitude()) {
      parts["coordinates"] = mapOf("latitude" to address.latitude, "longitude" to address.longitude)
    }
    return parts
  }

  private companion object {
    /** How long a query stands before it is looked up, in milliseconds. */
    const val SETTLE_MS = 300L
    const val MAX_RESULTS = 10
  }
}
