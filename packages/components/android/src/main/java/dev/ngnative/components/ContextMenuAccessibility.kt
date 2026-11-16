package dev.ngnative.components

import android.app.Activity
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat.AccessibilityActionCompat
import com.facebook.react.R
import com.facebook.react.uimanager.ReactAccessibilityDelegate
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.util.ReactFindViewUtil

/**
 * Offers each `[contextMenu]` to TalkBack and other accessibility services as its view's long-press
 * action, which opens the menu at the view's centre. The menu otherwise opens only from touches,
 * and TalkBack's double-tap and hold performs the action instead of sending one.
 *
 * React Native tells `ReactFindViewUtil` each time it gives a view a `nativeID`, so a view that
 * mounts after its menu was set gets the action too. On the main thread only.
 */
internal object ContextMenuAccessibility {
  private val found = ReactFindViewUtil.OnMultipleViewsFoundListener { view, nativeId ->
    if (nativeId in MenuHost.contextMenus) bind(view)
  }

  /** Follow a change to `nativeId`'s menu in `MenuHost`, on its view in `activity`'s window. */
  fun update(activity: Activity?, nativeId: String) {
    if (MenuHost.contextMenus.isEmpty()) {
      ReactFindViewUtil.removeViewsListener(found)
    } else {
      ReactFindViewUtil.addViewsListener(found, HashSet(MenuHost.contextMenus.keys))
    }
    val root = activity?.window?.decorView ?: return
    val view = ReactFindViewUtil.findView(root, nativeId) ?: return
    if (nativeId in MenuHost.contextMenus) bind(view) else unbind(view)
  }

  /** Stop following views, once no module is there to send the choice. */
  fun stop() {
    ReactFindViewUtil.removeViewsListener(found)
  }

  private fun bind(view: View) {
    // React Native gives a view its own delegate only when it has none. The action needs one, so
    // the view gets React Native's, as it would for a role, rather than a bare one in its place.
    if (!ViewCompat.hasAccessibilityDelegate(view)) {
      ReactAccessibilityDelegate.resetDelegate(view, view.isFocusable, view.importantForAccessibility)
    }
    ViewCompat.replaceAccessibilityAction(view, AccessibilityActionCompat.ACTION_LONG_CLICK, null) { v, _ ->
      open(v)
    }
  }

  private fun unbind(view: View) {
    ViewCompat.removeAccessibilityAction(view, AccessibilityActionCompat.ACTION_LONG_CLICK.id)
  }

  /** Open `view`'s menu at its centre. A recycled view that has another id now lets go of it. */
  private fun open(view: View): Boolean {
    val nativeId = view.getTag(R.id.view_tag_native_id) as? String
    if (nativeId == null || nativeId !in MenuHost.contextMenus) {
      unbind(view)
      return false
    }
    val entries = MenuHost.contextMenus[nativeId] ?: return false
    val activity = UIManagerHelper.getReactContext(view).currentActivity ?: return false
    // A view in a <modal> is in the dialog's window, where the menu does not open yet.
    if (!view.isAttachedToWindow || view.rootView !== activity.window?.decorView) return false
    val at = IntArray(2).also(view::getLocationInWindow)
    return ContextMenuPopup.show(activity, view, entries, at[0] + view.width / 2f, at[1] + view.height / 2f)
  }
}
