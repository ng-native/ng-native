package dev.ngnative.components

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import com.facebook.react.R
import com.facebook.react.uimanager.TouchTargetHelper
import kotlin.math.hypot

/**
 * Opens a `[contextMenu]` on a long press or a right-click, at the press point.
 *
 * It watches the window's touches before React Native does. A press is matched to a menu by the
 * view React Native would send it to, or the nearest view above that with a menu, by `nativeID`.
 * A long press lets React Native have the touch until the menu opens, then cancels it there, so a
 * `<pressable>` neither presses nor long-presses; a right-click is never React Native's at all.
 * Either way the rest of the gesture is the menu's.
 *
 * The innermost handler wins a long press: a view on the way up that takes one itself (a
 * `(longPress)`, in `MenuHost.longPressTakers`) keeps it, and no menu above it opens. A right-click
 * still opens the menu.
 */
internal class ContextMenuGesture(
  private val activity: Activity,
  /** Hands an event on to the window as it would have gone without menus. */
  private val forward: (MotionEvent) -> Boolean,
) {
  private val main = Handler(Looper.getMainLooper())
  private val slop = ViewConfiguration.get(activity).scaledTouchSlop
  private var down: MotionEvent? = null
  private var pending: Runnable? = null

  /** Whether the menu took this gesture, so its remaining events go nowhere. */
  private var taken = false

  /** Whether `event` is the menu's. */
  fun handle(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> return pressed(event)
      MotionEvent.ACTION_MOVE -> {
        val start = down
        if (pending != null && start != null &&
          hypot(event.x - start.x, event.y - start.y) > slop
        ) {
          stopWaiting()
        }
      }
      MotionEvent.ACTION_POINTER_DOWN -> stopWaiting()
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        stopWaiting()
        val wasTaken = taken
        taken = false
        return wasTaken
      }
    }
    return taken
  }

  private fun pressed(event: MotionEvent): Boolean {
    stopWaiting()
    taken = false
    if (MenuHost.contextMenus.isEmpty()) return false
    val secondary = isSecondaryClick(event)
    val (view, nativeId) = menuViewAt(event.x, event.y, longPress = !secondary) ?: return false
    if (secondary) {
      taken = open(view, nativeId, event)
      return taken
    }
    val start = MotionEvent.obtain(event)
    down = start
    val longPress = Runnable {
      pending = null
      if (!open(view, nativeId, start)) return@Runnable
      view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
      taken = true
      // React Native had the touch until now: it hears it cancelled, so nothing presses.
      val cancel = MotionEvent.obtain(start).apply { action = MotionEvent.ACTION_CANCEL }
      forward(cancel)
      cancel.recycle()
    }
    pending = longPress
    main.postDelayed(longPress, longPressDelay(ViewConfiguration.getLongPressTimeout()))
    return false
  }

  private fun stopWaiting() {
    pending?.let(main::removeCallbacks)
    pending = null
    down?.recycle()
    down = null
  }

  /** Open the menu for `nativeId` on `view` at `event`'s point, in the window. */
  private fun open(view: View, nativeId: String, event: MotionEvent): Boolean {
    val entries = MenuHost.contextMenus[nativeId] ?: return false
    if (!view.isAttachedToWindow) return false
    return ContextMenuPopup.show(activity, view, entries, event.x, event.y)
  }

  /**
   * The view a press at (`x`, `y`) in the window lands on, as React Native finds its touch target,
   * or the nearest view above it with a menu, and that menu's `nativeID`. For a `longPress`, none
   * where a view on the way takes the long press itself.
   */
  private fun menuViewAt(x: Float, y: Float, longPress: Boolean): Pair<View, String>? {
    val root = activity.window?.decorView as? ViewGroup ?: return null
    val path = TouchTargetHelper.findTargetPathAndCoordinatesForTouch(x, y, root, FloatArray(2))
    val views = generateSequence(path.firstNotNullOfOrNull { it.getView() }) { it.parent as? View }.toList()
    val ids = views.map { it.getTag(R.id.view_tag_native_id) as? String }
    val owner = menuOwner(
      ids,
      longPress,
      MenuHost.contextMenus::containsKey,
      MenuHost.longPressTakers::contains,
    ) ?: return null
    return views[owner] to (ids[owner] ?: return null)
  }

  private fun isSecondaryClick(event: MotionEvent): Boolean =
    isSecondaryClick(event.isFromSource(InputDevice.SOURCE_MOUSE), event.buttonState)

  companion object {
    /** A `<pressable>`'s `delayLongPress` unless the app sets one, in milliseconds. */
    private const val PRESSABLE_LONG_PRESS = 500

    /**
     * How long a press is held before the menu opens: the system's long-press timeout, but no
     * longer than a `<pressable>` around the menu waits to fire its own `(longPress)`. Android 11
     * and earlier, and the Touch & hold delay setting, wait longer than that.
     */
    fun longPressDelay(systemTimeout: Int): Long = minOf(systemTimeout, PRESSABLE_LONG_PRESS).toLong()

    /**
     * Which of `chain`, the `nativeID`s from the pressed view outwards, has the menu a press
     * opens: the nearest with one. For a `longPress`, none where a view on the way takes the long
     * press itself.
     */
    fun menuOwner(
      chain: List<String?>,
      longPress: Boolean,
      hasMenu: (String) -> Boolean,
      takesLongPress: (String) -> Boolean,
    ): Int? {
      for ((index, nativeId) in chain.withIndex()) {
        if (nativeId == null) continue
        if (hasMenu(nativeId)) return index
        if (longPress && takesLongPress(nativeId)) return null
      }
      return null
    }

    /** Whether a press is a right-click: a mouse's, with its secondary button down. */
    fun isSecondaryClick(fromMouse: Boolean, buttonState: Int): Boolean =
      fromMouse && buttonState and MotionEvent.BUTTON_SECONDARY != 0
  }
}
