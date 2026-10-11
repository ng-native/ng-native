package dev.ngnative.expo

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * An ongoing notification drawn from data: a title and text, time Android counts by itself, a
 * progress bar, and actions. It asks to be promoted to a Live Update, which Android 16 grants to a
 * notification of a standard style with a title, and the user can turn off.
 */
class OngoingNotificationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("There is no Android context yet.")

  private val manager: NotificationManager
    get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override fun definition() = ModuleDefinition {
    Name("NgNativeOngoingNotification")

    Events("onChange")

    OnStartObserving {
      OngoingNotificationReceiver.onChange = { sendEvent("onChange", emptyMap()) }
    }

    OnStopObserving {
      OngoingNotificationReceiver.onChange = null
    }

    AsyncFunction("show") { id: String, content: Map<String, Any?>, options: Map<String, Any?>, promise: Promise ->
      whenAllowed(promise) {
        createChannel(options["channel"] as Map<*, *>)
        manager.notify(id, NOTIFICATION, build(id, content, options))
        promise.resolve(mapOf("promoted" to isPromoted(id)))
      }
    }

    Function("cancel") { id: String ->
      manager.cancel(id, NOTIFICATION)
    }

    Function("isActive") { id: String ->
      active(id) != null
    }

    Function("takeTaps") { id: String ->
      OngoingNotificationReceiver.take(context, id)
    }

    Function("openPromotionSettings") {
      val action =
        // Settings.ACTION_MANAGE_APP_PROMOTED_NOTIFICATIONS, which the SDK this builds with does not name.
        if (Build.VERSION.SDK_INT >= 36) "android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS"
        else Settings.ACTION_APP_NOTIFICATION_SETTINGS
      context.startActivity(
        Intent(action)
          .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }
  }

  /**
   * Runs `show` once notifications are allowed, asking first where Android 13 and later need it.
   * Only when it is not granted yet: asking goes through the activity, and answers denied when
   * there is none, as when an action is tapped with the app closed to the background.
   */
  private fun whenAllowed(promise: Promise, show: () -> Unit) {
    val guarded = {
      try {
        if (NotificationManagerCompat.from(context).areNotificationsEnabled()) show()
        else promise.reject(CodedException("Notifications are turned off for this app."))
      } catch (failure: Throwable) {
        promise.reject(CodedException(failure.message ?: "The notification could not be shown.", failure))
      }
    }
    val permissions = appContext.permissions
    if (
      Build.VERSION.SDK_INT < 33 ||
      permissions == null ||
      permissions.hasGrantedPermissions(Manifest.permission.POST_NOTIFICATIONS)
    ) {
      return guarded()
    }
    permissions.askForPermissions(
      { result ->
        if (result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED) guarded()
        else promise.reject(CodedException("The notification permission was not granted."))
      },
      Manifest.permission.POST_NOTIFICATIONS
    )
  }

  private fun createChannel(channel: Map<*, *>) {
    if (Build.VERSION.SDK_INT < 26) return
    val id = channel["id"] as String
    if (manager.getNotificationChannel(id) != null) return
    // Low: it is shown without a sound, and a Live Update needs more than the minimum.
    manager.createNotificationChannel(
      NotificationChannel(id, channel["name"] as String, NotificationManager.IMPORTANCE_LOW)
    )
  }

  private fun build(id: String, content: Map<String, Any?>, options: Map<String, Any?>): Notification {
    val channel = (options["channel"] as Map<*, *>)["id"] as String
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(smallIcon())
      .setContentTitle(content["title"] as String)
      .setContentText(content["text"] as String?)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setRequestPromotedOngoing(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setShowWhen(false)
      .setContentIntent(open(id, options["url"] as String?))
      .setDeleteIntent(broadcast(id, null))

    (content["chip"] as String?)?.let { builder.setShortCriticalText(it) }

    (content["timer"] as Map<*, *>?)?.let { timer ->
      val until = timer["until"] as Number?
      builder
        .setWhen(((until ?: timer["since"]) as Number).toLong())
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(until != null)
    }

    // ponytail: the plain bar every version draws; ProgressStyle's segments and points when an app asks.
    (content["progress"] as Map<*, *>?)?.let { progress ->
      val indeterminate = progress["indeterminate"] == true
      builder.setProgress(
        (progress["max"] as Number?)?.toInt() ?: 100,
        (progress["value"] as Number?)?.toInt() ?: 0,
        indeterminate
      )
    }

    (content["actions"] as List<*>?)?.forEach { action ->
      action as Map<*, *>
      val target = action["target"] as String
      val url = action["url"] as String?
      builder.addAction(
        0,
        action["title"] as String,
        if (url != null) open("$id $target", url) else broadcast(id, target)
      )
    }
    return builder.build()
  }

  /** The app's notification icon, as `expo-notifications` names it, or the app's own icon. */
  private fun smallIcon(): Int {
    val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    return info.metaData?.getInt("expo.modules.notifications.default_notification_icon", 0)
      ?.takeIf { it != 0 } ?: info.icon
  }

  /** Opens the app, at `url` when there is one. */
  private fun open(key: String, url: String?): PendingIntent? {
    val intent =
      if (url != null) Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
      else context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, key.hashCode(), intent, FLAGS)
  }

  /** Tells the receiver of a tap on `target`, or with none, that the notification was swiped away. */
  private fun broadcast(id: String, target: String?): PendingIntent {
    val intent = Intent(context, OngoingNotificationReceiver::class.java)
      .setData(Uri.fromParts("ongoing", id, target))
      .putExtra(OngoingNotificationReceiver.EXTRA_ID, id)
      .putExtra(OngoingNotificationReceiver.EXTRA_TARGET, target)
    return PendingIntent.getBroadcast(context, 0, intent, FLAGS)
  }

  private fun active(id: String) =
    manager.activeNotifications.firstOrNull { it.tag == id && it.id == NOTIFICATION }

  private fun isPromoted(id: String): Boolean =
    Build.VERSION.SDK_INT >= 36 &&
      manager.canPostPromotedNotifications() &&
      active(id)?.notification?.hasPromotableCharacteristics() == true

  companion object {
    /** Every notification shares this number and is told apart by its tag, the id JavaScript gives. */
    private const val NOTIFICATION = 0x6e67
    private const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
  }
}
