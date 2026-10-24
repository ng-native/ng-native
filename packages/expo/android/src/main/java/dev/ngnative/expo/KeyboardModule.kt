package dev.ngnative.expo

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewTreeObserver
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * The keyboard's motion on Android, which React Native reports only as a `keyboardDidShow` once
 * the window's insets have changed, so a layout that waits for it jumps while the keyboard slides.
 *
 * `onKeyboardChange` is the motion starting: where the keyboard is going and how long it takes,
 * what iOS's `keyboardWillShow` carries. `onKeyboardMove` is where the keyboard is at each frame:
 * before the motion, through it, and `end` after it, for a layout to move with it, since Android
 * animates no layout alongside the keyboard by default. The view,
 * `<keyboard-motion-view>`, reports every frame of the motion as how far the keyboard covers the
 * view's own bottom edge, for a native animation to follow it.
 */
class KeyboardModule : Module() {
  private var watcher: KeyboardWatcher? = null
  /** Whether JavaScript is listening: set on its thread, read on the main one. */
  @Volatile private var observing = false
  private val main = Handler(Looper.getMainLooper())

  private val listener = object : KeyboardWatcher.Listener {
    override fun onKeyboardStart(target: Int, duration: Long) {
      val watcher = watcher ?: return
      // Where it is starting from first, so a layout following the frames is not handed the
      // destination before the motion has begun.
      sendEvent("onKeyboardMove", position(watcher, watcher.inset))
      sendEvent("onKeyboardChange", change(watcher, target, duration))
    }

    override fun onKeyboardProgress(inset: Int) {
      val watcher = watcher ?: return
      sendEvent("onKeyboardMove", position(watcher, inset))
    }

    override fun onKeyboardEnd(inset: Int) {
      sendEvent("onKeyboardMove", mapOf("end" to true))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("NgNativeKeyboard")

    Events("onKeyboardChange", "onKeyboardMove")

    OnStartObserving {
      observing = true
      watchActivity()
    }

    OnStopObserving {
      observing = false
      main.post { unwatch() }
    }

    // An activity Android recreates, after the font size changes for one, is a new window while
    // the app's listeners stay: the watcher moves to it rather than keep the old one alive.
    OnActivityEntersForeground {
      if (observing) watchActivity()
    }

    OnActivityDestroys {
      unwatch()
    }

    View(KeyboardMotionView::class) {
      Events("onKeyboardMoveStart", "onKeyboardMove", "onKeyboardMoveEnd")
    }
  }

  /** Watch the keyboard of the activity in front, once. On the main thread. */
  private fun watchActivity() {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      if (watcher == null && observing) {
        val current =
          KeyboardWatcher.watch(activity.window.decorView, listener) ?: return@runOnUiThread
        watcher = current
        // A keyboard already up, and still, sends nothing until it next moves: report it as one
        // that starts and ends at once, as the watcher reports a jump. One that is moving reports
        // itself through the rest of its motion.
        if (current.inset > 0 && !current.moving) {
          listener.onKeyboardStart(current.inset, 0)
          listener.onKeyboardEnd(current.inset)
        }
      }
    }
  }

  private fun unwatch() {
    KeyboardWatcher.unwatch(watcher, listener)
    watcher = null
  }

  /** Where the motion is going and how long it takes. */
  private fun change(watcher: KeyboardWatcher, target: Int, duration: Long): Map<String, Any> =
    position(watcher, target) + mapOf(
      "duration" to duration.toDouble(),
      // Android's own curve decelerates, as `easeOut` does.
      "easing" to "easeOut",
    )

  /**
   * A keyboard `inset` pixels tall as React Native's keyboard events describe one, in points: its
   * height above the system bars, and its top edge on the screen. Zero, and no edge, for none.
   */
  private fun position(watcher: KeyboardWatcher, inset: Int): Map<String, Any> {
    if (inset == 0) return mapOf("height" to 0.0)
    val density = appContext.reactContext?.resources?.displayMetrics?.density ?: 1f
    val bars = appContext.currentActivity?.window?.decorView?.let { decor ->
      ViewCompat.getRootWindowInsets(decor)?.getInsets(WindowInsetsCompat.Type.systemBars())?.bottom
    } ?: 0
    return mapOf(
      "height" to maxOf(0, inset - bars) / density.toDouble(),
      "screenY" to (watcher.bottomOnScreen - inset) / density.toDouble(),
    )
  }
}

/**
 * How far the keyboard covers this view's bottom edge, in points, at every frame of its motion.
 *
 * Laid out over the element it reports for, it moves with whatever moves that element: a sheet
 * that react-native-screens raises with the keyboard covers less of it, so what follows the
 * keyboard by this rises only as far as it still must.
 */
class KeyboardMotionView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext),
  KeyboardWatcher.Listener {
  private val onKeyboardMoveStart by EventDispatcher()
  private val onKeyboardMove by EventDispatcher()
  private val onKeyboardMoveEnd by EventDispatcher()

  private var watcher: KeyboardWatcher? = null
  /** The last height reported once the keyboard stopped, so a layout reports only a change. */
  private var settled = -1.0

  private val laidOut = ViewTreeObserver.OnGlobalLayoutListener {
    val watcher = watcher ?: return@OnGlobalLayoutListener
    if (watcher.moving) return@OnGlobalLayoutListener
    val height = covered(watcher.inset)
    if (height != settled) {
      settled = height
      onKeyboardMoveEnd(mapOf("height" to height))
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    watcher = KeyboardWatcher.watch(this, this)
    viewTreeObserver.addOnGlobalLayoutListener(laidOut)
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnGlobalLayoutListener(laidOut)
    KeyboardWatcher.unwatch(watcher, this)
    watcher = null
    settled = -1.0
    super.onDetachedFromWindow()
  }

  override fun onKeyboardStart(target: Int, duration: Long) {
    onKeyboardMoveStart(mapOf("height" to covered(target)))
  }

  override fun onKeyboardProgress(inset: Int) {
    onKeyboardMove(mapOf("height" to covered(inset)))
  }

  override fun onKeyboardEnd(inset: Int) {
    settled = covered(inset)
    onKeyboardMoveEnd(mapOf("height" to settled))
  }

  /** How far a keyboard `inset` pixels tall covers this view's bottom edge, in points. */
  private fun covered(inset: Int): Double {
    val watcher = watcher ?: return 0.0
    if (inset == 0) return 0.0
    val location = IntArray(2)
    getLocationOnScreen(location)
    val bottom = location[1] + height
    val top = watcher.bottomOnScreen - inset
    return maxOf(0, bottom - top) / resources.displayMetrics.density.toDouble()
  }
}
