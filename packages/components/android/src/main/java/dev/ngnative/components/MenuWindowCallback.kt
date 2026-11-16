package dev.ngnative.components

import android.app.Activity
import android.os.Build
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MotionEvent
import android.view.Window
import android.widget.EditText

/**
 * The activity's window callback with the app's shortcuts and context menus in it. It sees every
 * key and touch the window gets, before React Native or any view, without the app's activity
 * having to subclass anything.
 *
 * - A chord with a modifier reaches `dispatchKeyShortcutEvent` after the focused view has had it:
 *   a text input's own Ctrl-Z, X, C, V and A take it first. An app shortcut then fires.
 * - The Keyboard Shortcuts helper asks `onProvideKeyboardShortcuts`, which adds the app's.
 * - A press on a view with a `[contextMenu]` goes to `ContextMenuGesture` first.
 *
 * Only the activity's window has it: a `<modal>` is a Dialog with a window of its own, where the
 * app's shortcuts and context menus do not reach yet.
 */
internal class MenuWindowCallback private constructor(
  activity: Activity,
  private val base: Window.Callback,
) : Window.Callback by base {
  private val contextMenus = ContextMenuGesture(activity) { event -> base.dispatchTouchEvent(event) }
  private val activity = activity

  override fun dispatchKeyShortcutEvent(event: KeyEvent): Boolean {
    if (base.dispatchKeyShortcutEvent(event)) return true
    val send = MenuHost.send ?: return false
    val shortcut = MenuHost.shortcuts.firstOrNull { it.matches(event) } ?: return false
    send(
      mapOf(
        "type" to "shortcut",
        "id" to shortcut.id,
        "textInputFocused" to (activity.currentFocus is EditText),
      ),
    )
    return true
  }

  override fun onProvideKeyboardShortcuts(
    data: MutableList<KeyboardShortcutGroup>,
    menu: Menu?,
    deviceId: Int,
  ) {
    base.onProvideKeyboardShortcuts(data, menu, deviceId)
    data.addAll(Shortcut.groups(MenuHost.shortcuts))
  }

  override fun onPointerCaptureChanged(hasCapture: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) base.onPointerCaptureChanged(hasCapture)
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean =
    contextMenus.handle(event) || base.dispatchTouchEvent(event)

  companion object {
    private val windows = WindowWrapper<Window>()

    /**
     * Put the callback on `activity`'s window, once for each window, however other code has
     * wrapped the window's callback since. On the main thread.
     */
    fun install(activity: Activity) {
      val window = activity.window ?: return
      windows.wrapOnce(window, window.callback, { MenuWindowCallback(activity, it) }) {
        window.callback = it
      }
    }
  }
}
