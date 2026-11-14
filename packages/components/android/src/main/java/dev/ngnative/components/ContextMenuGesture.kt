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
    val (view, nativeId) = menuViewAt(event.x, event.y) ?: return false
    if (isSecondaryClick(event)) {
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
    main.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
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
   * or the nearest view above it with a menu, and that menu's `nativeID`.
   */
  private fun menuViewAt(x: Float, y: Float): Pair<View, String>? {
    val root = activity.window?.decorView as? ViewGroup ?: return null
    val path = TouchTargetHelper.findTargetPathAndCoordinatesForTouch(x, y, root, FloatArray(2))
    var view: View? = path.firstNotNullOfOrNull { it.getView() }
    while (view != null) {
      val nativeId = view.getTag(R.id.view_tag_native_id) as? String
      if (nativeId != null && MenuHost.contextMenus.containsKey(nativeId)) return view to nativeId
      view = view.parent as? View
    }
    return null
  }

  private fun isSecondaryClick(event: MotionEvent): Boolean =
    event.isFromSource(InputDevice.SOURCE_MOUSE) &&
      event.buttonState and MotionEvent.BUTTON_SECONDARY != 0
}
