package dev.ngnative.expo

import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import com.facebook.react.config.ReactFeatureFlags
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Turns on React Native's W3C pointer events where the app's config plugin asked for them.
 *
 * `ReactSurfaceView` reads the flag as it is made, so it is set as the application starts, before
 * any surface exists.
 */
class PointerEventsPackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context,
  ): List<ApplicationLifecycleListener> = listOf(PointerEventsLifecycle)
}

private object PointerEventsLifecycle : ApplicationLifecycleListener {
  @Suppress("DEPRECATION")
  override fun onCreate(application: Application) {
    val info = application.packageManager.getApplicationInfo(
      application.packageName,
      PackageManager.GET_META_DATA,
    )
    if (info.metaData?.getBoolean("dev.ngnative.expo.POINTER_EVENTS") == true) {
      ReactFeatureFlags.dispatchPointerEvents = true
    }
  }
}
