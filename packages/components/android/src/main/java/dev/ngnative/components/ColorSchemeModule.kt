package dev.ngnative.components

import android.app.UiModeManager
import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.appcompat.R
import androidx.appcompat.content.res.AppCompatResources
import androidx.appcompat.widget.SwitchCompat
import androidx.core.util.Consumer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * `NgNativeColorScheme`, which `ColorScheme.set` in `@ng-native/device` calls beside React
 * Native's `Appearance.setColorScheme`.
 *
 * React Native sets AppCompat's default night mode, which updates an activity that handles
 * `uiMode` itself in place, and the system reapplies the activity's own configuration over it
 * shortly after launch, so native views go back to the system's scheme. The per-app night mode
 * (Android 12 and later) is part of the configuration the system applies, so it holds, and the
 * system keeps it across launches. Earlier Android has no such setting and this does nothing there.
 *
 * It also retints the activity's switches after each configuration change the activity takes in
 * place, whatever made it, as React Native's switch keeps the tints it was created with.
 */
class ColorSchemeModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var watched: WeakReference<ComponentActivity>? = null
  private val onConfigurationChanged = Consumer<Configuration> {
    watched?.get()?.window?.decorView?.let(::refreshSwitches)
  }

  override fun definition() = ModuleDefinition {
    Name("NgNativeColorScheme")

    Function("setColorScheme") { scheme: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function
      val context = appContext.reactContext ?: return@Function
      val manager = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
      manager?.setApplicationNightMode(nightMode(scheme))
    }

    OnCreate { watchActivity() }

    // A recreated activity is a new one to listen to.
    OnActivityEntersForeground { watchActivity() }

    OnDestroy { main.post { unwatch() } }
  }

  private fun watchActivity() {
    val activity = appContext.currentActivity as? ComponentActivity ?: return
    main.post {
      if (watched?.get() === activity) return@post
      unwatch()
      activity.addOnConfigurationChangedListener(onConfigurationChanged)
      watched = WeakReference(activity)
    }
  }

  private fun unwatch() {
    watched?.get()?.removeOnConfigurationChangedListener(onConfigurationChanged)
    watched = null
  }
}

/**
 * Retint every switch under [view] from its theme as it is now. `SwitchCompat`, which React
 * Native's `AndroidSwitch` is, takes its thumb and track tints from the theme once, when it is
 * created, so after a scheme change that an activity handling `uiMode` takes in place, by the
 * system or by `setColorScheme`, a switch on screen keeps the old scheme's. The colour filters
 * React Native sets for `trackColor` and `thumbColor` stay, as a filter draws in place of a tint.
 * A modal's switches are reached too: its host hands out its dialog's views as its children.
 */
internal fun refreshSwitches(view: View) {
  if (view is SwitchCompat) refreshSwitch(view)
  if (view is ViewGroup) for (i in 0 until view.childCount) refreshSwitches(view.getChildAt(i))
}

/** The tints AppCompat gives its own switch drawables, read again; others it leaves alone. */
private fun refreshSwitch(switch: SwitchCompat) {
  val context = switch.context
  val styled =
    context.obtainStyledAttributes(null, R.styleable.SwitchCompat, R.attr.switchStyle, 0)
  val thumb = styled.getResourceId(R.styleable.SwitchCompat_android_thumb, 0)
  val track = styled.getResourceId(R.styleable.SwitchCompat_track, 0)
  styled.recycle()
  if (thumb == R.drawable.abc_switch_thumb_material) {
    thumbTint(context)?.let { switch.thumbTintList = it }
  }
  if (track == R.drawable.abc_switch_track_mtrl_alpha) {
    switch.trackTintList =
      AppCompatResources.getColorStateList(context, R.color.abc_tint_switch_track)
  }
}

/**
 * AppCompat's thumb tint, which it builds in code: `colorSwitchThumbNormal`, and
 * `colorControlActivated` when checked.
 */
private fun thumbTint(context: Context): ColorStateList? {
  val attrs = intArrayOf(R.attr.colorSwitchThumbNormal, R.attr.colorControlActivated)
  val theme = context.obtainStyledAttributes(attrs)
  try {
    val normal = theme.getColorStateList(0) ?: return null
    val activated = theme.getColor(1, 0)
    val disabled = intArrayOf(-android.R.attr.state_enabled)
    return ColorStateList(
      arrayOf(disabled, intArrayOf(android.R.attr.state_checked), intArrayOf()),
      intArrayOf(
        normal.getColorForState(disabled, normal.defaultColor),
        activated,
        normal.defaultColor,
      ),
    )
  } finally {
    theme.recycle()
  }
}

/** The `UiModeManager` night mode for a scheme from JavaScript: the system's for any other. */
internal fun nightMode(scheme: String): Int =
  when (scheme) {
    "dark" -> UiModeManager.MODE_NIGHT_YES
    "light" -> UiModeManager.MODE_NIGHT_NO
    else -> UiModeManager.MODE_NIGHT_AUTO
  }
