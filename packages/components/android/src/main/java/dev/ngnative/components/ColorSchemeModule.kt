package dev.ngnative.components

import android.app.UiModeManager
import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.DrawableContainer
import android.graphics.drawable.LayerDrawable
import android.graphics.drawable.NinePatchDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
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
 * It also retints the activity's switches and text inputs after each configuration change the
 * activity takes in place, whatever made it, as React Native's keep the colours they were created
 * with.
 */
class ColorSchemeModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var watched: WeakReference<ComponentActivity>? = null
  /** The theme's selection colour before the change, which a field showing it took by default. */
  private var highlight = 0
  private val onConfigurationChanged = Consumer<Configuration> {
    val activity = watched?.get() ?: return@Consumer
    val was = highlight
    highlight = themeHighlight(activity)
    activity.window?.decorView?.let { refreshControls(it, was, highlight) }
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
      highlight = themeHighlight(activity)
    }
  }

  private fun unwatch() {
    watched?.get()?.removeOnConfigurationChangedListener(onConfigurationChanged)
    watched = null
  }
}

/**
 * Retint every switch and text input under [view] from its theme as it is now. `SwitchCompat`,
 * which React Native's `AndroidSwitch` is, takes its thumb and track tints and its press ripple
 * from the theme once, when it is created, and an `EditText` its selection colour, cursor and
 * selection handles, so after a scheme change that an activity handling `uiMode` takes in place,
 * by the system or by `setColorScheme`, those on screen keep the old scheme's. Colours React
 * Native set from JavaScript stay: its `trackColor`, `thumbColor`, `cursorColor` and
 * `selectionHandleColor` are colour filters, which draw in place of a tint and are left alone, and
 * a `selectionColor` is kept unless it is the old theme's own, [was]. A modal's controls are
 * reached too: its host hands out its dialog's views as its children.
 */
internal fun refreshControls(view: View, was: Int, highlight: Int) {
  if (view is SwitchCompat) refreshSwitch(view)
  if (view is EditText) refreshField(view, was, highlight)
  if (view is ViewGroup) {
    for (i in 0 until view.childCount) refreshControls(view.getChildAt(i), was, highlight)
  }
}

/** The theme's `textColorHighlight`, which React Native gives a field with no `selectionColor`. */
private fun themeHighlight(context: Context): Int {
  val styled = context.obtainStyledAttributes(intArrayOf(android.R.attr.textColorHighlight))
  try {
    return styled.getColorStateList(0)?.defaultColor ?: 0
  } finally {
    styled.recycle()
  }
}

/**
 * A field's selection colour after a change from [was] to [now]: the new theme's when it showed
 * the old theme's, and its own otherwise.
 *
 * ponytail: a `selectionColor` set to exactly the old theme's colour follows the theme too.
 */
internal fun followedHighlight(current: Int, was: Int, now: Int): Int =
  if (current == was) now else current

private fun refreshField(field: EditText, was: Int, highlight: Int) {
  field.highlightColor = followedHighlight(field.highlightColor, was, highlight)
  // Android 10 added the getters and setters; earlier, React Native reaches these by reflection.
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
  // The platform's cursor and handles are tinted `colorControlActivated`. Loading them again does
  // not do: the drawable cache keeps the old scheme's tint, as a theme attribute is not a `uiMode`
  // dependency it knows of. So they are tinted again in place.
  val styled = field.context.obtainStyledAttributes(intArrayOf(android.R.attr.colorControlActivated))
  val tint =
    try {
      styled.getColorStateList(0)
    } finally {
      styled.recycle()
    } ?: return
  field.textCursorDrawable?.takeIf { it.colorFilter == null }?.let {
    it.mutate().setTintList(tint)
    field.textCursorDrawable = it
  }
  // React Native filters all three handles or none.
  if (field.textSelectHandle?.colorFilter != null) return
  field.textSelectHandle?.let { field.setTextSelectHandle(it.mutate().apply { setTintList(tint) }) }
  field.textSelectHandleLeft?.let {
    field.setTextSelectHandleLeft(it.mutate().apply { setTintList(tint) })
  }
  field.textSelectHandleRight?.let {
    field.setTextSelectHandleRight(it.mutate().apply { setTintList(tint) })
  }
}

/** The tints AppCompat gives its own switch drawables, read again; others it leaves alone. */
private fun refreshSwitch(switch: SwitchCompat) {
  // React Native's `thumbColor` colours the ripple too, and filters the thumb: a state list, whose
  // nine-patch states keep the filter on their paint and report none.
  val ownRipple = switch.thumbDrawable?.let(::hasFilter) == true
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
  if (ownRipple) return
  val ripple = themeRipple(switch.background) ?: return
  val highlight = context.obtainStyledAttributes(intArrayOf(R.attr.colorControlHighlight))
  try {
    highlight.getColorStateList(0)?.let(ripple::setColor)
  } finally {
    highlight.recycle()
  }
}

/** Whether a colour filter is on [drawable], or on the state a state list shows. */
private fun hasFilter(drawable: Drawable): Boolean {
  val shown = if (drawable is DrawableContainer) drawable.current ?: drawable else drawable
  return drawable.colorFilter != null ||
    shown.colorFilter != null ||
    (shown as? NinePatchDrawable)?.paint?.colorFilter != null ||
    (shown as? BitmapDrawable)?.paint?.colorFilter != null
}

/**
 * The theme's borderless item background, whose colour is `colorControlHighlight`: a ripple with
 * no layers, where React Native's `backgroundColor` makes one around a colour. Found inside the
 * layers React Native wraps it in for an outline, a border or a shadow.
 */
private fun themeRipple(drawable: Drawable?): RippleDrawable? =
  when (drawable) {
    is RippleDrawable -> drawable.takeIf { it.numberOfLayers == 0 }
    is LayerDrawable ->
      (0 until drawable.numberOfLayers).firstNotNullOfOrNull { themeRipple(drawable.getDrawable(it)) }
    else -> null
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
