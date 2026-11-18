package dev.ngnative.components

import android.app.UiModeManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * `NgNativeColorScheme`, which `ColorScheme.set` in `@ng-native/device` calls beside React
 * Native's `Appearance.setColorScheme`.
 *
 * React Native sets AppCompat's default night mode, which updates an activity that handles
 * `uiMode` itself in place, and the system reapplies the activity's own configuration over it
 * shortly after launch, so native views go back to the system's scheme. The per-app night mode
 * (Android 12 and later) is part of the configuration the system applies, so it holds, and the
 * system keeps it across launches. Earlier Android has no such setting and this does nothing there.
 */
class ColorSchemeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NgNativeColorScheme")

    Function("setColorScheme") { scheme: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function
      val context = appContext.reactContext ?: return@Function
      val manager = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
      manager?.setApplicationNightMode(nightMode(scheme))
    }
  }
}

/** The `UiModeManager` night mode for a scheme from JavaScript: the system's for any other. */
internal fun nightMode(scheme: String): Int =
  when (scheme) {
    "dark" -> UiModeManager.MODE_NIGHT_YES
    "light" -> UiModeManager.MODE_NIGHT_NO
    else -> UiModeManager.MODE_NIGHT_AUTO
  }
