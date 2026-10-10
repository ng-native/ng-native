package dev.ngnative.expo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray

/**
 * Receives a tap on one of an ongoing notification's actions, and the notification being swiped
 * away. Android starts the app's process for it when there is none, so the tap is stored, and
 * handed to JavaScript when it asks: nothing here needs the app's JavaScript to be running.
 */
class OngoingNotificationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(EXTRA_ID) ?: return
    intent.getStringExtra(EXTRA_TARGET)?.let { store(context, id, it) }
    onChange?.invoke()
  }

  companion object {
    const val EXTRA_ID = "dev.ngnative.expo.ongoing.id"
    const val EXTRA_TARGET = "dev.ngnative.expo.ongoing.target"
    private const val PREFERENCES = "dev.ngnative.expo.ongoing.taps"

    /** Set while the module is listening, to tell JavaScript there is something to take. */
    @Volatile
    var onChange: (() -> Unit)? = null

    private fun preferences(context: Context) =
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    @Synchronized
    private fun store(context: Context, id: String, target: String) {
      val taps = JSONArray(preferences(context).getString(id, "[]")).put(target)
      preferences(context).edit().putString(id, taps.toString()).commit()
    }

    /** The targets tapped on `id` and not yet taken, oldest first, which are then taken. */
    @Synchronized
    fun take(context: Context, id: String): List<String> {
      val taps = JSONArray(preferences(context).getString(id, "[]"))
      preferences(context).edit().remove(id).commit()
      return List(taps.length()) { taps.getString(it) }
    }
  }
}
