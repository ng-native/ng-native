package dev.ngnative.expo

import android.app.Activity
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps the app's snapshot out of recent apps, for `ScreenCapture.protectAppSwitcher()` in
 * `@ng-native/expo`, without `FLAG_SECURE`, so screenshots and recordings still work. Android 13
 * and later; earlier Android has no such setting and this does nothing there.
 */
class RecentsModule : Module() {
  /** Whether recents shows the app's snapshot. On the main thread only. */
  private var screenshotEnabled = true

  override fun definition() = ModuleDefinition {
    Name("NgNativeRecents")

    AsyncFunction("setScreenshotEnabled") { enabled: Boolean ->
      screenshotEnabled = enabled
      apply()
    }.runOnQueue(Queues.MAIN)

    // A recreated activity starts with the snapshot shown again. One never hidden is left alone.
    OnActivityEntersForeground {
      if (!screenshotEnabled) apply()
    }

    // A reload makes a new module, which starts with the snapshot shown: the activity follows it.
    OnDestroy {
      val activity = appContext.currentActivity
      Handler(Looper.getMainLooper()).post {
        if (!screenshotEnabled) {
          screenshotEnabled = true
          apply(activity)
        }
      }
    }
  }

  private fun apply(activity: Activity? = appContext.currentActivity) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    activity?.setRecentsScreenshotEnabled(screenshotEnabled)
  }
}
